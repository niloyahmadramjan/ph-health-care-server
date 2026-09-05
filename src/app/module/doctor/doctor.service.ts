import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import { doctorPayload, IDoctorEmailVerify } from "./doctor.interface";
import { cloudinaryUpload } from "../../lib/cloudinary";
import crypto from "crypto";
import { redisClient } from "../../lib/redisConfig";
import path from "path";
import { sentEmail } from "../../utils/sentEmail";
import config from "../../config";
import ejs from "ejs";
import { Role } from "../../../generated/prisma/enums";

const applyAsDoctor = async (
  payload: doctorPayload,
  resume: Express.Multer.File | null,
  additionalFiles: Express.Multer.File[],
) => {
  const isExistUser = await prisma.user.findUnique({
    where: {
      email: payload.email,
    },
  });

  if (isExistUser) {
    throw new Error("User already exists with this email");
  }
  // single file upload

  const resumeUploadResult = await new Promise<UploadApiResponse>(
    (resolve, reject) => {
      cloudinaryUpload.uploader
        .upload_stream(
          {
            resource_type: "auto",
          },
          async (error, result) => {
            if (error) {
              return reject(error);
            }
            if (!result) {
              return reject(new Error("No result returned form cloudinary"));
            }
            resolve(result);
          },
        )
        .end(resume?.buffer);
    },
  );

  // additional files upload

  const additionalFilesUploadResults = await Promise.all(
    additionalFiles.map((file) => {
      return new Promise<UploadApiResponse>((resolve, reject) => {
        cloudinaryUpload.uploader
          .upload_stream(
            {
              resource_type: "auto",
            },
            async (error, result) => {
              if (error) {
                return reject(error);
              }
              if (!result) {
                return reject(new Error("No result returned form cloudinary"));
              }
              resolve(result);
            },
          )
          .end(file.buffer);
      });
    }),
  );

  const doctorApplicagtion = await prisma.user.create({
    data: {
      name: payload.name,
      email: payload.email,
      needPasswordChange: true,

      doctor: {
        create: {
          email: payload.email,
          specialization: payload.specialization,
          licenseNumber: payload.licenseNumber,
          qualification: payload.qualification,
          experienceYears: Number(payload.experienceYears),

          resume: resumeUploadResult.secure_url,
          resumePublicId: resumeUploadResult.public_id,

          addionalFiles: additionalFilesUploadResults.map((file) => ({
            url: file.secure_url,
            publicId: file.public_id,
          })),
        },
      },
    },
  });

  const expirationseconds = 60 * 60; // 1h
  const otpKey = `doctor-application:otp${payload.email}`;

  const otpValue = crypto.randomInt(1000000, 10000000).toString();

  await redisClient.set(otpKey, otpValue, {
    expiration: {
      type: "EX",
      value: expirationseconds,
    },
  });

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/forget-password.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name: name,
    otp: otpValue,
    year: new Date().getFullYear(),
  });

  /// email sent function

  await sentEmail.sendMail({
    from: `"PH HEALTH CARE" <${config.smtp_user}>`,
    to: payload.email,
    subject: "Email verify OTP",
    html,
  });

  return {
    resumeUploadResult,
    additionalFilesUploadResults,
    doctorApplicagtion,
  };
};

const verifyDoctorEmail = async (payload: IDoctorEmailVerify) => {
  const otp = payload.otp;
  const email = payload.email;

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
      role: Role.DOCTOR,
    },
  });

  if (!existingUser) {
    throw new Error("Doctor Application not found. please apply again");
  }

  if (existingUser.emailVerified) {
    throw new Error("Email already verified");
  }

  const otpKey = `doctor-application:otp${email}`;
  const redisOtp = await redisClient.get(otpKey);

  if (!redisOtp) {
    throw new Error(
      "OTP expired. Your application window has been closed. please apply again",
    );
  }
  if (redisOtp !== otp) {
    throw new Error("OTP does not match");
  }
  await redisClient.del(otpKey);

  const verifyDoctorEmail = await prisma.user.update({
    where: {
      id: existingUser.id,
    },
    data: {
      emailVerified: true,
    },
    omit: { password: true },
    include: { doctor: true },
  });

  return verifyDoctorEmail;
};

export const doctorServices = {
  applyAsDoctor,
  verifyDoctorEmail,
};
