import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";

const UploadProfileImage = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Profile image uploaded successfully!",
    data: null,
  });
});


export const UserController = {
    UploadProfileImage
}