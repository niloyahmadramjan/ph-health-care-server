import { Router } from "express";
import { appointmentController } from "./appointment.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
const router = Router();

router.post("/appointment-book",auth(Role.PATIENT), appointmentController.appointmentPaymentCreate);
router.get("/book-appointment/payment/callback",
  appointmentController.bookAppointmentCallback,
);

export const AppointmentRoutes = router;
