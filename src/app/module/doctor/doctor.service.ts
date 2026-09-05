import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import {
  IDoctorPayload,
  IDoctorEmailVerify,
  IApprovedDoctor,
  IQuery,
} from "./doctor.interface";
import { cloudinaryUpload } from "../../lib/cloudinary";
import crypto from "crypto";
import { redisClient } from "../../lib/redisConfig";
import path from "path";
import { sentEmail } from "../../utils/sentEmail";
import config from "../../config";
import ejs from "ejs";
import { DoctorVerifyStatus, Role } from "../../../generated/prisma/enums";
import { RequestUser } from "../../middleware/checkAuth";
import { DoctorWhereInput } from "../../../generated/prisma/models";

const applyAsDoctor = async (
  payload: IDoctorPayload,
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

const approvedDoctorProfile = async (
  payload: IApprovedDoctor,
  reviewer: RequestUser,
) => {
  const { doctorId, verificationStatus, rejectionReason } = payload;

  const existingDoctor = await prisma.doctor.findUnique({
    where: {
      id: doctorId,
    },
    include: { user: true },
  });

  if (!existingDoctor) {
    throw new Error("Doctor application not found");
  }
  if (existingDoctor.isDeleted) {
    throw new Error("Doctor has been deleted");
  }
  if (!existingDoctor.user.emailVerified) {
    throw new Error(
      "Doctor has not verify their email yet. Application cannot be reviewed",
    );
  }
  if (existingDoctor.status !== DoctorVerifyStatus.PEDDING) {
    throw new Error(
      `Doctor application has been ${existingDoctor.status.toLowerCase()}`,
    );
  }
  if (verificationStatus === DoctorVerifyStatus.REJECTED && !rejectionReason) {
    throw new Error(
      "Rejection reason is required when rejection a doctor application",
    );
  }

  const updateDoctor = await prisma.doctor.update({
    where: {
      id: doctorId,
    },
    data: {
      status: verificationStatus,
      rejectionReason:
        verificationStatus === DoctorVerifyStatus.REJECTED
          ? rejectionReason
          : null,
      reviewedBy: reviewer.userId,
      reviewedAt: new Date(),
    },
    include: { user: true },
  });

  // sent email for reject or approve

  const isApproved = verificationStatus === DoctorVerifyStatus.APPROVED;

  const templatePath = path.join(
    process.cwd(),
    `src/app/templates/${isApproved ? "doctor-application-approved.ejs" : "doctor-application-rejected.ejs"}`,
  );

  const templeteData = {
    name: updateDoctor.user.name,
    reason: updateDoctor.rejectionReason,
  };

  const html = await ejs.renderFile(templatePath, templeteData);

  await sentEmail.sendMail({
    from: `"PH HEALTH CARE" <${config.smtp_user}>`,
    to: updateDoctor.email,
    subject: isApproved
      ? "Your Doctor Application Has Been Approved"
      : "Your Doctor Application Has Been Rejected",
    html,
  });

  return updateDoctor;
};

const getAllDoctor = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  const andConditions: DoctorWhereInput[] = [];

  //  searching

  if (query.searchTerm) {
    andConditions.push({
      OR: [
        {
          licenseNumber: {
            contains: query.searchTerm,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: query.searchTerm,
            mode: "insensitive",
          },
        },
        {
          specialization: {
            contains: query.searchTerm,
            mode: "insensitive",
          },
        },
        {
          address: {
            contains: query.searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  // filtering

  if (query.specialization) {
    andConditions.push({
      specialization: { equals: query.specialization, mode: "insensitive" },
    });
  }

  if (query.email) {
    andConditions.push({
      email: { equals: query.email, mode: "insensitive" },
    });
  }

  if (query.licenseNumber) {
    andConditions.push({
      licenseNumber: { equals: query.licenseNumber, mode: "insensitive" },
    });
  }

  if (query.status) {
    andConditions.push({
      status: { equals: query.status as DoctorVerifyStatus },
    });
  }
  // if (query.isDeleted) {
  //   andConditions.push({
  //     isDeleted: query.isDeleted === "true" ? true : false,
  //   });
  // }

  andConditions.push({ isDeleted: false });

  // search filter sorting  pagination
  const allDoctors = await prisma.doctor.findMany({
    where: {
      AND: andConditions.length > 0 ? andConditions : undefined,
    },
    take: limit,
    skip: skip,
    orderBy: {
      [sortBy]: sortOrder,
    },
    include: {
      user: {
        omit: { password: true },
      },
    },
    // schedule : true,
    // appointment: true,
    // prescriptions: true
  });
  

   const totalDoctorCount = await prisma.doctor.count({
        where : {
            AND : andConditions
        }
    })

    return {
        data : allDoctors,
        meta : {
            page : page,
            limit : limit,
            total : totalDoctorCount,
            totalPages : Math.ceil(totalDoctorCount / limit)
        }
    }
};

export const doctorServices = {
  applyAsDoctor,
  verifyDoctorEmail,
  approvedDoctorProfile,
  getAllDoctor,
};
