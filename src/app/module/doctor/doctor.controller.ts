import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { doctorServices } from "./doctor.service";
import { ApplyAsDoctorValidationZodSchema } from "./doctor.validation";
import { AppError } from "../../utils/AppError";

const appliedAsDoctor = catchAsync(async (req: Request, res: Response) => {
  // const payload = req.body.data;
  // const resume = req.file
  // const additionalFiles = req.files

  // console.log(resume, additionalFiles, payload)

  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const resume = files?.["resume"] ? files["resume"][0] : null;
  const additionalFiles = files?.["additionalFiles"] || [];

  const zodValidationResult = ApplyAsDoctorValidationZodSchema.safeParse(
    JSON.parse(req.body.data),
  );

  if (!zodValidationResult.success) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      zodValidationResult.error.issues[0].message,
    );
  } 
  const payload = zodValidationResult.data;

  // console.log(resume,additionalFiles,payload)

  const result = await doctorServices.applyAsDoctor(
    payload,
    resume,
    additionalFiles,
  );
  // console.log(result)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Applied as doctor successfully",
    data: result,
  });
});

export const DoctorController = {
  appliedAsDoctor,
};
