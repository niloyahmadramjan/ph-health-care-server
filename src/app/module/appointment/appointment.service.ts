import {
  AppointmentStatus,
  PaymentStatus,
  ScheduleStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import httpStatus from "http-status";
import { IBookAppointmentPayload } from "./appointment.interface";
import { isAfter, isBefore, isSameDay } from "date-fns";

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

const payAppointment = async (payload: any, user: RequestUser) => {
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

    const exeutedPaymentResult = await executePayment.json();
    if (status === "success") {
      await tx.appointment.update({
        where: {
          id: exeutedPaymentResult.merchantInvoiceNumber,
        },
        data: {
          status: AppointmentStatus.CONFIRMED,
        },
      });
      await tx.payment.update({
        where: {
          appointmentID: exeutedPaymentResult.merchantInvoiceNumber,
          bkashPyamentId: paymentId,
        },
        data: {
          status: PaymentStatus.PAID,
          bkashIrxId: exeutedPaymentResult.trxID,
          paidAt: exeutedPaymentResult.paymentExecuteTime,
          getwayResponse: exeutedPaymentResult,
        },
      });
      return {
        exeutedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
      };
    } else if (status === "failure") {
      await tx.payment.update({
        where: {
          appointmentID: exeutedPaymentResult.merchantInvoiceNumber,
          bkashPyamentId: paymentId,
        },
        data: {
          status: PaymentStatus.FAILED,
          getwayResponse: exeutedPaymentResult,
        },
      });
      return {
        exeutedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=failue`,
      };
    } else if (status === "cancel") {
      await tx.payment.update({
        where: {
          appointmentID: exeutedPaymentResult.merchantInvoiceNumber,
          bkashPyamentId: paymentId,
        },
        data: {
          status: PaymentStatus.CANCELLED,
          getwayResponse: exeutedPaymentResult,
        },
      });
      return {
        exeutedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
      };
    } else {
      return {
        exeutedPaymentResult,
        rediredUrl: `${config.frontend_url}/dashboard/my-appointments`,
      };
    }
  });

  return transaction;
};

const cancelAppointment = async (payload: any) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointmentId = payload.appointmentId;
    const existingAppointment = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      include: {
        payment: true,
      },
    });

    if (!existingAppointment) {
      throw new Error("Appointment does not exists");
    }
    if (
      existingAppointment.status === "ONGOING" ||
      existingAppointment.status === "COMPLETED"
    ) {
      throw new Error("Appointment is ongoing or compeleted");
    }
    if (existingAppointment.status === "CANCELLED") {
      throw new Error("Appointment already cancelled");
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },
      data: {
        status: "CANCELLED",
      },
    });

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
    const updatedPayment = await tx.payment.update({
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

    return {
      appoinment: updatedAppointment,
      payment: updatedPayment,
    };
  });
  return transactionResult;
};

export const appointmentService = {
  appointmentBook,
  bookAppointmentCallback,
  payAppointment,
  cancelAppointment,
};
