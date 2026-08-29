import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";

const appointmentBook = async () => {
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
        payerReference: "01770618575",
        callbackURL: `${config.bkase_call_back_url}/appointment/book-appointment/payment/callback`,
        amount: "500",
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: "inv123",
      }),
    },
  );

  const bkashCreatePaymentResponse = await bkashCreatePayment.json();
  return bkashCreatePaymentResponse;
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
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
    return {
     exeutedPaymentResult,
      rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
    };
  }
   if (status === "failure") {
    return {
     exeutedPaymentResult,
      rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=failue`,
    };
  }
   if (status === "cancel") {
    return {
     exeutedPaymentResult,
      rediredUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
    };
  }

  return {
    exeutedPaymentResult,
      rediredUrl: `${config.frontend_url}/dashboard/my-appointments`,
  };
};

export const appointmentService = {
  appointmentBook,
  bookAppointmentCallback,
};
