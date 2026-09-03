import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import { doctorPayload } from "./doctor.interface";
import { cloudinaryUpload } from "../../lib/cloudinary";

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
  
  const resumeUploadResult = await new Promise<UploadApiResponse>(   (resolve, reject) => {
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

  return {
    resumeUploadResult,
    additionalFilesUploadResults,
    doctorApplicagtion
  };
};

export const doctorServices = {
  applyAsDoctor,
};
