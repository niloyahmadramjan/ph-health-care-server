import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { appointmentService } from "./appointment.service";

//bookAppointmentCallback
const appointmentPaymentCreate = catchAsync(
  async (req: Request, res: Response) => {
    const payload = req.body;
    const user = req.user!;
    const result = await appointmentService.appointmentBook(payload, user);
    console.log(result);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "payment initiated successfully",
      data: result,
    });
  },
);

const payAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user!;
  const result = await appointmentService.appointmentBook(payload, user);
  console.log(result);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "payment initiated successfully",
    data: result,
  });
});

const bookAppointmentCallback = catchAsync(
  async (req: Request, res: Response) => {
    console.log(req.query);

    const { exeutedPaymentResult, rediredUrl } =
      await appointmentService.bookAppointmentCallback(req.query);
    console.log(exeutedPaymentResult, "callback controller");
    res.redirect(rediredUrl);

    // sendResponse(res, {
    //   statusCode: httpStatus.OK,
    //   success: true,
    //   message: "",
    //   data: result,
    // });
  },
);

const cancelAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const result = await appointmentService.cancelAppointment(payload);
  // console.log(result);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "payment cancelled successfully",
    data: result,
  });
});

export const appointmentController = {
  appointmentPaymentCreate,
  payAppointment,
  bookAppointmentCallback,
  cancelAppointment,
};
