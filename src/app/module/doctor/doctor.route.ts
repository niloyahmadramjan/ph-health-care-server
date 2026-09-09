import { Router } from "express";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
import { validateRequest } from "../../middleware/userValidation";
import { DoctorController } from "./doctor.controller";
import { UpdateDoctorProfileValidationZodSchema } from "./doctor.validation";

const router = Router();

router.post(
	"/apply-doctor",
	upload.fields([
		{ name: "resume", maxCount: 1 },
		{ name: "additionalFiles", maxCount: 10 },
	]),
	DoctorController.appliedAsDoctor,
);

router.post("/appy-as-doctor/verify-email", DoctorController.verifyDoctorEmail);

router.post(
	"/approve-doctor",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	DoctorController.approvedDoctor,
);

router.get(
	"/all-doctors",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	DoctorController.getAllDoctor,
);

router.patch(
	"/update-my-profile",
	auth(Role.DOCTOR),
	validateRequest(UpdateDoctorProfileValidationZodSchema),
	DoctorController.updateDoctorProfile,
);

// Public doctor-discovery routes (no auth) — meant for patients browsing before login.
router.get(
	"/public/available-today",
	DoctorController.getAvailableDoctorByTodaysSchedule,
);

router.get(
	"/public/all-doctors",
	DoctorController.getAllDoctorsListPublic,
);

router.get(
	"/public/:doctorId",
	DoctorController.getSingleDoctorPublicProfile,
);

export const DoctorRouter = router;
