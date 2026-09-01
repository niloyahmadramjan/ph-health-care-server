import { Router } from "express";
import { appointmentController } from "./appointment.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
const router = Router();

router.post(
  "/book-appointment",
  auth(Role.PATIENT),
  appointmentController.appointmentPaymentCreate,
);
router.post(
  "/pay-appointment",
  auth(Role.PATIENT),
  appointmentController.payAppointment,
);

router.post(
  "/cancel-appointment",
  auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
  appointmentController.cancelAppointment,
);

// book appointment callback url
router.get(
  "/book-appointment/payment/callback",
  appointmentController.bookAppointmentCallback,
);

export const AppointmentRoutes = router;
