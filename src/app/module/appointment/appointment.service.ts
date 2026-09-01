import {
  AppointmentStatus,
  PaymentStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";

const appointmentBook = async (payload: any, user: RequestUser) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        status: AppointmentStatus.PEDDING,
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
          amount: "500",
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
        amount: "500",
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
  });

  if (!existingAppointment) {
    throw new Error("Appointment does not exists");
  }
  if (existingAppointment.status !== "PEDDING") {
    throw new Error("Appointment is not pedding");
  }
  if (existingAppointment.status !== "PEDDING") {
    throw new Error("Appointment is not pedding");
  }
  if (existingAppointment.status !== "PEDDING") {
    throw new Error("Appointment is not pedding");
  }
  if (existingAppointment.status !== "PEDDING") {
    throw new Error("Appointment is not pedding");
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
        amount: "500",
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
        getwayResponse: bkashRefundResult
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
