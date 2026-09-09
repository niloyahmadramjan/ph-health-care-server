import {
  AppointmentStatus,
  PaymentStatus,
  ScheduleStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import httpStatus from "http-status";
import type {
  IBookAppointmentPayload,
  ICancelAppointmentPayload,
  IPayAppointmentPayload,
  IUpdateAppointment,
} from "./appointment.interface";
import { addMinutes, isAfter, isBefore, isSameDay, subHours } from "date-fns";
import { sentEmail } from "../../utils/sentEmail";
import PDFDocument from "pdfkit";

const appointmentBook = async (
  payload: IBookAppointmentPayload,
  user: RequestUser,
) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const patient = await prisma.patient.findUnique({
      where: { id: user.userId },
    });
    if (!patient) {
      throw new AppError(httpStatus.NOT_FOUND, "Patien profile not found");
    }

    const schedule = await prisma.schedule.findUnique({
      where: { id: payload.scheduleId },
      include: {
        doctor: true,
      },
    });
    if (!schedule || schedule.isDeleted) {
      throw new AppError(httpStatus.NOT_FOUND, "Schedule not found");
    }
    if (schedule.status !== ScheduleStatus.PUBLISHED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Schedule is not published yet",
      );
    }

    const now = new Date();
    if (!isSameDay(now, schedule.startDateTime)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        " This schedule is not available for today",
      );
    }

    if (isAfter(now, schedule.startDateTime)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        " This schedule has been started",
      );
    }

    const existingAppointment = await prisma.appointment.findFirst({
      where: {
        patientId: patient.id,
        scheduleId: schedule.id,
        // status: {not : AppointmentStatus.CANCELLED}
      },
    });

    if (existingAppointment?.status === AppointmentStatus.PENDING) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You have a pedding Appointment this schedule plase pay for that",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.ONGOING) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You have a on-going Appointment this schedule plase pay for that",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.CONFIRMED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You have a confirmed Appointment this schedule plase pay for that",
      );
    }

    if (existingAppointment?.status === AppointmentStatus.COMPLETED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You already have completed an appointment on This schedule. please try agian another day",
      );
    }

    if (schedule.availableSlots === 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "This schedule is no available slots is already fully book",
      );
    }

    if (!schedule.doctor.consultationFee) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Doctor has not set a consultation fee yet",
      );
    }

    const amount = schedule.doctor.consultationFee.toString();

    const appointment = await tx.appointment.create({
      data: {
        status: AppointmentStatus.PENDING,
        patientId: patient.id,
        doctorId: schedule.doctor.id,
        scheduleId: schedule.id,
      },
    });

    const bkashIdToken = await getBkashIdToken();
    if (!bkashIdToken) {
      throw new Error("No bkash id token");
    }
    const bkashCreatePayment = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/create`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          Authorization: bkashIdToken,
          "X-APP-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          mode: "0011",
          // payerReference: "01770618575",
          payerReference: user.email,
          callbackURL: `${config.bkase_call_back_url}/appointment/book-appointment/payment/callback`,
          amount: amount,
          currency: "BDT",
          intent: "sale",
          // merchantInvoiceNumber: "inv123",
          merchantInvoiceNumber: appointment.id,
        }),
      },
    );

    const bkashCreatePaymentResult = await bkashCreatePayment.json();

    // payment model create
    await tx.payment.create({
      data: {
        merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
        appointmentID: appointment.id,
        amount: amount,
        getwayResponse: bkashCreatePaymentResult,
        bkashPyamentId: bkashCreatePaymentResult.paymentID,
        payerRefence: user.email,
      },
    });
    return {
      paymentUrl: bkashCreatePaymentResult.bkashURL,
    };
  });
  return transactionResult;
};

const payAppointment = async (
  payload: IPayAppointmentPayload,
  user: RequestUser,
) => {
  const appointmentId = payload.appointmentId;
  const existingAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
    include: {
      schedule: {
        include: { doctor: true },
      },
    },
  });

  if (!existingAppointment) {
    throw new Error("Appointment does not exists");
  }
  if (existingAppointment.status !== "PENDING") {
    throw new Error("Appointment is not PENDING");
  }
  if (existingAppointment.status !== "PENDING") {
    throw new Error("Appointment is not PENDING");
  }
  if (existingAppointment.status !== "PENDING") {
    throw new Error("Appointment is not PENDING");
  }
  if (existingAppointment.status !== "PENDING") {
    throw new Error("Appointment is not PENDING");
  }

  // if (existingAppointment.status === "COMPLETED") {
  //   throw new Error("Appointment already completed");
  // }

  // if (
  //   existingAppointment.status === "CANCELLED" ||
  //   existingAppointment.status === "ONGOING"
  // ) {
  //   const appoimentStatus = existingAppointment.status;
  //   throw new Error(`Appointment is already ${appoimentStatus.toUpperCase()}`);
  // }

  // payment create

  if (!existingAppointment.schedule.doctor.consultationFee) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Doctor not set consoltation fee for this schedule",
    );
  }
  const amount = existingAppointment.schedule.doctor.consultationFee.toString();
  const bkashIdToken = await getBkashIdToken();
  if (!bkashIdToken) {
    throw new Error("No bkash id token");
  }

  const bkashCreatePayment = await fetch(
    `${config.bkash_base_url}/tokenized/checkout/create`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        Authorization: bkashIdToken,
        "X-APP-Key": config.bkash_app_key,
      },
      body: JSON.stringify({
        mode: "0011",
        payerReference: user.email,
        callbackURL: `${config.bkase_call_back_url}/appointment/book-appointment/payment/callback`,
        amount: amount,
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: existingAppointment.id,
      }),
    },
  );

  const bkashCreatePaymentResult = await bkashCreatePayment.json();

  await prisma.payment.update({
    where: {
      appointmentID: existingAppointment.id,
    },
    data: {
      merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
      getwayResponse: bkashCreatePaymentResult,
      bkashPyamentId: bkashCreatePaymentResult.paymentID,
    },
  });

  return {
    paymentUrl: bkashCreatePaymentResult.bkashURL,
  };
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
  const transaction = await prisma.$transaction(async (tx) => {
    const paymentId = query.paymentID;
    if (!paymentId) {
      throw new Error("Payment id is missing");
    }
    const status = query.status;

    if (!status) {
      throw new Error("payment status is missing");
    }

    const bkashIdToken = await getBkashIdToken();
    if (!bkashIdToken) {
      throw new Error("bkash id token missing");
    }

    const executePayment = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: bkashIdToken,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          paymentID: paymentId,
        }),
      },
    );

    const executedPaymentResult = await executePayment.json();
    if (status === "success") {
      const appointment = await prisma.appointment.findUnique({
        where: {
          id: executedPaymentResult.merchantInvoiceNumber,
        },
        include: {
          schedule: true,
          patient: true,
          doctor: true,
        },
      });

      if (!appointment) {
        throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
      }
      const newAvaiblableSlots = appointment.schedule.availableSlots - 1;

      // total slot =3 , available slot = 2
      // (totalslot - availableslot) + 1
      const bookedSlots =
        appointment.schedule.totalSlots - appointment.schedule.availableSlots;
      const serialNumber = bookedSlots + 1;

      // 25 august => 3pm to 4pm
      // 1st person joining time => startDateTime = 2026-08-25T15:00:00:436z => 3:00 pm
      // serial number = 1 -1 * 20 = 0 minutes
      // 2nd person joining time => startDateTime = 2026-08-25T15:20:00:436z => 3:20 pm
      //  serial number (2) - 1 * 20 = 20
      // 3rd person joining time => startDateTime = 2026-08-25T15:20:00:436z => 3:40 pm
      //  serial number (3) - 1 * 20 = 40

      const joiningTime = addMinutes(
        appointment.schedule.startDateTime,
        (serialNumber - 1) * 20,
      );

      await tx.appointment.update({
        where: {
          id: executedPaymentResult.merchantInvoiceNumber,
        },
        data: {
          status: AppointmentStatus.CONFIRMED,
          joiningTime: joiningTime,
          serialNumber: serialNumber,
        },
      });
      await prisma.schedule.update({
        where: {
          id: appointment.schedule.id,
        },
        data: {
          availableSlots: newAvaiblableSlots,
        },
      });
      await tx.payment.update({
        where: {
          appointmentID: executedPaymentResult.merchantInvoiceNumber,
          bkashPyamentId: paymentId,
        },
        data: {
          status: PaymentStatus.PAID,
          bkashIrxId: executedPaymentResult.trxID,
          paidAt: executedPaymentResult.paymentExecuteTime,
          getwayResponse: executedPaymentResult,
        },
      });

      /// generate the invoice pdf buffer
      const pdfDocument = new PDFDocument({ margin: 50 });

      const pdfChunks: Buffer[] = [];

      pdfDocument.on("data", (chunk: Buffer) => {
        pdfChunks.push(chunk);
      });

      const pdfReadyPromise = new Promise<Buffer>((resolve) => {
        pdfDocument.on("end", () => {
          resolve(Buffer.concat(pdfChunks));
        });
      });

      pdfDocument
        .fontSize(20)
        .text("PH Healthcare System", { align: "center" });
      pdfDocument.fontSize(14).text("Appointment Invoice", { align: "center" });
      pdfDocument.moveDown(2);

      pdfDocument
        .fontSize(12)
        .text(`Patient Name: ${appointment.patient?.name}`);
      pdfDocument.text(`Patient Email: ${appointment.patient?.email}`);
      pdfDocument.moveDown();

      pdfDocument.text(`Doctor Name: ${appointment.doctor?.name || "John"}`);
      pdfDocument.text(`Specialization: ${appointment.doctor?.specialization}`);
      pdfDocument.moveDown();

      pdfDocument.text(
        `Appointment Date: ${appointment.schedule.startDateTime.toDateString()}`,
      );
      pdfDocument.text(`Your Joining Time: ${joiningTime.toString()}`);
      pdfDocument.text(`Your Serial Number: ${serialNumber}`);
      pdfDocument.text(`Meeting Link: ${appointment.schedule.meetingLink}`);
      pdfDocument.moveDown();

      pdfDocument.text(`Amount Paid: ${executedPaymentResult.amount} BDT`);
      pdfDocument.text(`Payment Method: bKash`);
      pdfDocument.text(`Transaction Id: ${executedPaymentResult.trxID}`);
      pdfDocument.text(`Paid At: ${executedPaymentResult.paymentExecuteTime}`);

      pdfDocument.end();

      const pdfBuffer = await pdfReadyPromise;

      await sentEmail.sendMail({
        from: config.admin_email,
        to: appointment.patient.email,
        subject: "Your Appointment Invoice - PH Healthcare System",
        text: "Thank you for booking an appointment. Please find your invoice attached.",
        attachments: [
          {
            filename: "invoice.pdf",
            content: pdfBuffer,
          },
        ],
      });

      return {
        executedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
      };
    } else if (status === "failure") {
      await tx.payment.update({
        where: {
          appointmentID: executedPaymentResult.merchantInvoiceNumber,
          bkashPyamentId: paymentId,
        },
        data: {
          status: PaymentStatus.FAILED,
          getwayResponse: executedPaymentResult,
        },
      });
      return {
        executedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=failue`,
      };
    } else if (status === "cancel") {
      await tx.payment.update({
        where: {
          appointmentID: executedPaymentResult.merchantInvoiceNumber,
          bkashPyamentId: paymentId,
        },
        data: {
          status: PaymentStatus.CANCELLED,
          getwayResponse: executedPaymentResult,
        },
      });
      return {
        executedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
      };
    } else {
      return {
        executedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments`,
      };
    }
  });

  return transaction;
};

const cancelAppointment = async (
  payload: ICancelAppointmentPayload,
  user: RequestUser,
) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointmentId = payload.appointmentId;
    const existingAppointment = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
        patient: {
          email: user.email,
        },
      },
      include: {
        payment: true,
        schedule: true,
      },
    });

    if (!existingAppointment) {
      throw new AppError(httpStatus.NOT_FOUND, "Appointment does not exists");
    }
    if (
      existingAppointment.status === "ONGOING" ||
      existingAppointment.status === "COMPLETED"
    ) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Appointment is ongoing or compeleted",
      );
    }
    if (existingAppointment.status === "CANCELLED") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Appointment already cancelled",
      );
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },
      data: {
        status: AppointmentStatus.CANCELLED,
      },
    });

    await prisma.schedule.update({
      where: {
        id: existingAppointment.schedule.id,
      },
      data: {
        availableSlots: { increment: 1 },
      },
    });

    // refund process
    const now = new Date();
    const startDateTime = existingAppointment.schedule.startDateTime;
    const refundCutOfTime = subHours(startDateTime, 1);
    const isEligibleForRefund = isBefore(now, refundCutOfTime);

    if (isEligibleForRefund) {
      const bkashIdToken = await getBkashIdToken();
      if (!bkashIdToken) {
        throw new Error("No bkash id token");
      }

      const bkashRefundPaymentResponse = await fetch(
        `${config.bkash_base_url}/tokenized/checkout/payment/refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: bkashIdToken,
            "X-App-Key": config.bkash_app_key,
          },
          body: JSON.stringify({
            paymentID: existingAppointment.payment?.bkashPyamentId,
            trxID: existingAppointment.payment?.bkashIrxId,
            amount: existingAppointment.payment?.amount.toString(),
            sku: "Appointment Cancellation",
            reason: "Patient Cancelled The Appointment",
          }),
        },
      );

      const bkashRefundResult = await bkashRefundPaymentResponse.json();
      await tx.payment.update({
        where: {
          appointmentID: existingAppointment.id,
        },
        data: {
          refundTrxId: bkashRefundResult.refundTrxID,
          refundedAt: bkashRefundResult.completedTime,
          refundAmmount: bkashRefundResult.amount,
          refundReason: "patiant cancelled the appointment",
          status: PaymentStatus.REFUNDED,
          getwayResponse: bkashRefundResult,
        },
      });
    }

    const newPaymentInfo = await prisma.payment.findUnique({
      where: {
        appointmentID: existingAppointment.id,
      },
    });

    return {
      appoinment: updatedAppointment,
      payment: newPaymentInfo,
    };
  });
  return transactionResult;
};

const updateAppointmentStatus = async (
  payload: IUpdateAppointment,
  appointmentId: string,
  user: RequestUser,
) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor profile not found");
  }

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
      doctorId: doctor.id,
    },
  });

  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
  }
  if (appointment.status === AppointmentStatus.COMPLETED) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Appointment is already completed",
    );
  }

  if (appointment.status === AppointmentStatus.CANCELLED) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Appointment is already cancelled",
    );
  }

  if (appointment.status === AppointmentStatus.PENDING) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Appointment is pending. Your can change the status after appointment is confirmed",
    );
  }
  if (appointment.status === AppointmentStatus.CONFIRMED) {
    if (payload.status !== "ONGOING") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Confirmed appointment must be onging at frist",
      );
    }

    await prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: AppointmentStatus.ONGOING,
      },
    });
  }

  if (appointment.status === AppointmentStatus.ONGOING) {
    if (payload.status !== "COMPLETED") {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Ongoing appointment must be completed",
      );
    }

    await prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: AppointmentStatus.COMPLETED,
      },
    });
  }

  const updatedAppointment = await prisma.appointment.findUnique({
    where: { id: appointment.id },
  });

  return updatedAppointment;
};

export const appointmentService = {
  appointmentBook,
  bookAppointmentCallback,
  payAppointment,
  cancelAppointment,
  updateAppointmentStatus,
};
