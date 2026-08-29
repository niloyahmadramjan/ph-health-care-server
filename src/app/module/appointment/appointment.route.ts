import { Router } from "express";
import { appointmentController } from "./appointment.controller";
const router = Router();

router.post("/appointment-book", appointmentController.appointmentPaymentCreate);
router.get("/book-appointment/payment/callback",
  appointmentController.bookAppointmentCallback,
);

export const AppointmentRoutes = router;
