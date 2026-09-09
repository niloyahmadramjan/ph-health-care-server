import type { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import type {
	IDoctorPayload,
	IDoctorEmailVerify,
	IApprovedDoctor,
	IQuery,
	IUpdateDoctorProfilePayload,
} from "./doctor.interface";
import { cloudinaryUpload } from "../../lib/cloudinary";
import crypto from "crypto";
import { redisClient } from "../../lib/redisConfig";
import path from "path";
import { sentEmail } from "../../utils/sentEmail";
import config from "../../config";
import ejs from "ejs";
import { DoctorVerifyStatus, Role, ScheduleStatus } from "../../../generated/prisma/enums";
import type { RequestUser } from "../../middleware/checkAuth";
import type { DoctorWhereInput } from "../../../generated/prisma/models";
import { AppError } from "../../utils/AppError";
import httpStatus from "http-status"
import { addDays, startOfDay } from "date-fns";

const applyAsDoctor = async (
	payload: IDoctorPayload,
	resume: Express.Multer.File | null,
	additionalFiles: Express.Multer.File[],
) => {
	const isExistUser = await prisma.user.findUnique({
		where: {
			email: payload.email,
		},
	});

	if (isExistUser) {
		throw new Error("User already exists with this email");
	}
	// single file upload

	const resumeUploadResult = await new Promise<UploadApiResponse>(
		(resolve, reject) => {
			cloudinaryUpload.uploader
				.upload_stream(
					{
						resource_type: "auto",
					},
					async (error, result) => {
						if (error) {
							return reject(error);
						}
						if (!result) {
							return reject(new Error("No result returned form cloudinary"));
						}
						resolve(result);
					},
				)
				.end(resume?.buffer);
		},
	);

	// additional files upload

	const additionalFilesUploadResults = await Promise.all(
		additionalFiles.map((file) => {
			return new Promise<UploadApiResponse>((resolve, reject) => {
				cloudinaryUpload.uploader
					.upload_stream(
						{
							resource_type: "auto",
						},
						async (error, result) => {
							if (error) {
								return reject(error);
							}
							if (!result) {
								return reject(new Error("No result returned form cloudinary"));
							}
							resolve(result);
						},
					)
					.end(file.buffer);
			});
		}),
	);

	const doctorApplicagtion = await prisma.user.create({
		data: {
			name: payload.name,
			email: payload.email,
			needPasswordChange: true,

			doctor: {
				create: {
					name: payload.name,
					email: payload.email,
					specialization: payload.specialization,
					licenseNumber: payload.licenseNumber,
					qualification: payload.qualification,
					experienceYears: Number(payload.experienceYears),

					resume: resumeUploadResult.secure_url,
					resumePublicId: resumeUploadResult.public_id,

					addionalFiles: additionalFilesUploadResults.map((file) => ({
						url: file.secure_url,
						publicId: file.public_id,
					})),
				},
			},
		},
	});

	const expirationseconds = 60 * 60; // 1h
	const otpKey = `doctor-application:otp${payload.email}`;

	const otpValue = crypto.randomInt(1000000, 10000000).toString();

	await redisClient.set(otpKey, otpValue, {
		expiration: {
			type: "EX",
			value: expirationseconds,
		},
	});

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/forget-password.ejs",
	);

	const html = await ejs.renderFile(templatePath, {
		name: name,
		otp: otpValue,
		year: new Date().getFullYear(),
	});

	/// email sent function

	await sentEmail.sendMail({
		from: `"PH HEALTH CARE" <${config.smtp_user}>`,
		to: payload.email,
		subject: "Email verify OTP",
		html,
	});

	return {
		resumeUploadResult,
		additionalFilesUploadResults,
		doctorApplicagtion,
	};
};

const verifyDoctorEmail = async (payload: IDoctorEmailVerify) => {
	const otp = payload.otp;
	const email = payload.email;

	const existingUser = await prisma.user.findUnique({
		where: {
			email,
			role: Role.DOCTOR,
		},
	});

	if (!existingUser) {
		throw new Error("Doctor Application not found. please apply again");
	}

	if (existingUser.emailVerified) {
		throw new Error("Email already verified");
	}

	const otpKey = `doctor-application:otp${email}`;
	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new Error(
			"OTP expired. Your application window has been closed. please apply again",
		);
	}
	if (redisOtp !== otp) {
		throw new Error("OTP does not match");
	}
	await redisClient.del(otpKey);

	const verifyDoctorEmail = await prisma.user.update({
		where: {
			id: existingUser.id,
		},
		data: {
			emailVerified: true,
		},
		omit: { password: true },
		include: { doctor: true },
	});

	return verifyDoctorEmail;
};

const approvedDoctorProfile = async (
	payload: IApprovedDoctor,
	reviewer: RequestUser,
) => {
	const { doctorId, verificationStatus, rejectionReason } = payload;

	const existingDoctor = await prisma.doctor.findUnique({
		where: {
			id: doctorId,
		},
		include: { user: true },
	});

	if (!existingDoctor) {
		throw new Error("Doctor application not found");
	}
	if (existingDoctor.isDeleted) {
		throw new Error("Doctor has been deleted");
	}
	if (!existingDoctor.user.emailVerified) {
		throw new Error(
			"Doctor has not verify their email yet. Application cannot be reviewed",
		);
	}
	if (existingDoctor.status !== DoctorVerifyStatus.PENDING) {
		throw new Error(
			`Doctor application has been ${existingDoctor.status.toLowerCase()}`,
		);
	}
	if (verificationStatus === DoctorVerifyStatus.REJECTED && !rejectionReason) {
		throw new Error(
			"Rejection reason is required when rejection a doctor application",
		);
	}

	const updateDoctor = await prisma.doctor.update({
		where: {
			id: doctorId,
		},
		data: {
			status: verificationStatus,
			rejectionReason:
				verificationStatus === DoctorVerifyStatus.REJECTED
					? rejectionReason
					: null,
			reviewedBy: reviewer.userId,
			reviewedAt: new Date(),
		},
		include: { user: true },
	});

	// sent email for reject or approve

	const isApproved = verificationStatus === DoctorVerifyStatus.APPROVED;

	const templatePath = path.join(
		process.cwd(),
		`src/app/templates/${isApproved ? "doctor-application-approved.ejs" : "doctor-application-rejected.ejs"}`,
	);

	const templeteData = {
		name: updateDoctor.user.name,
		reason: updateDoctor.rejectionReason,
	};

	const html = await ejs.renderFile(templatePath, templeteData);

	await sentEmail.sendMail({
		from: `"PH HEALTH CARE" <${config.smtp_user}>`,
		to: updateDoctor.email,
		subject: isApproved
			? "Your Doctor Application Has Been Approved"
			: "Your Doctor Application Has Been Rejected",
		html,
	});

	return updateDoctor;
};

const getAllDoctor = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: DoctorWhereInput[] = [];

	//  searching

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{
					licenseNumber: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
				{
					email: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
				{
					specialization: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
				{
					address: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
			],
		});
	}

	// filtering

	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	if (query.email) {
		andConditions.push({
			email: { equals: query.email, mode: "insensitive" },
		});
	}

	if (query.licenseNumber) {
		andConditions.push({
			licenseNumber: { equals: query.licenseNumber, mode: "insensitive" },
		});
	}

	if (query.status) {
		andConditions.push({
			status: { equals: query.status as DoctorVerifyStatus },
		});
	}
	// if (query.isDeleted) {
	//   andConditions.push({
	//     isDeleted: query.isDeleted === "true" ? true : false,
	//   });
	// }

	andConditions.push({ isDeleted: false });

	// search filter sorting  pagination
	const allDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions.length > 0 ? andConditions : undefined,
		},
		take: limit,
		skip: skip,
		orderBy: {
			[sortBy]: sortOrder,
		},
		include: {
			user: {
				omit: { password: true },
			},
		},
		// schedule : true,
		// appointment: true,
		// prescriptions: true
	});

	const totalDoctorCount = await prisma.doctor.count({
		where: {
			AND: andConditions,
		},
	});

	return {
		data: allDoctors,
		meta: {
			page: page,
			limit: limit,
			total: totalDoctorCount,
			totalPages: Math.ceil(totalDoctorCount / limit),
		},
	};
};

const updateDoctorProfile = async (payload : IUpdateDoctorProfilePayload, user : RequestUser) => {
	const existingDoctor = await prisma.doctor.findUnique({
		where: { userId: user.userId },
	});

	if (!existingDoctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
	}

	const updatedDoctor = await prisma.doctor.update({
		where: { id: existingDoctor.id },
		data: payload,
	});

	return updatedDoctor;

}

// Fields safe to expose on the public (unauthenticated) doctor-discovery endpoints.
// Deliberately excludes resume/additionalFiles, verification review metadata, and
// anything relation/auth related (user, userId, isDeleted, deletedAt...).


const getAvailableDoctorByTodaysSchedule = async (query: IQuery) => {

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const now = new Date();
	const startOfToday = startOfDay(now);
	const startOfTomorrow = addDays(startOfToday, 1);

	// A doctor is "available today" if they have at least one published,
	// not-yet-started schedule today with open slots left.

	const andConditions: DoctorWhereInput[] = [
		{ isDeleted: false },
		{ status: DoctorVerifyStatus.APPROVED },
		{
			schedules: {
				some: {
					isDeleted: false,
					status: ScheduleStatus.PUBLISHED,
					availableSlots: { gt: 0 },
					startDateTime: {
						gte: startOfToday,
						lt: startOfTomorrow,
						gt: now,
					},
				} } },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ specialization: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	const availableDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consultationFee: true,
			createdAt: true,
			schedules: {
				where: {
					isDeleted: false,
					status: ScheduleStatus.PUBLISHED,
					availableSlots: { gt: 0 },
					startDateTime: {
						gte: startOfToday,
						lt: startOfTomorrow,
						gt: now,
					},
				},
				orderBy: { [sortBy] : sortOrder },
				select: {
					id: true,
					startDateTime: true,
					endDateTime: true,
					availableSlots: true,
					totalSlots: true,
				},
			},
		},
	});

	const totalAvailableDoctorCount = await prisma.doctor.count({
		where: { AND: andConditions },
	});

	return {
		data: availableDoctors,
		meta: {
			page,
			limit,
			total: totalAvailableDoctorCount,
			totalPages: Math.ceil(totalAvailableDoctorCount / limit),
		},
	};
}

const getAllDoctorsListPublic = async (query: IQuery) => {

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const andConditions: DoctorWhereInput[] = [
		{ isDeleted: false },
		{ status: DoctorVerifyStatus.APPROVED },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ specialization: { contains: query.searchTerm, mode: "insensitive" } },
				{ qualification: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	const allDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consultationFee: true,
			createdAt: true,
		},
	});

	const totalDoctorCount = await prisma.doctor.count({
		where: { AND: andConditions },
	});

	return {
		data: allDoctors,
		meta: {
			page,
			limit,
			total: totalDoctorCount,
			totalPages: Math.ceil(totalDoctorCount / limit),
		},
	};
}

const getSingleDoctorPublicProfile = async (doctorId: string) => {

	const doctor = await prisma.doctor.findUnique({
		where: {
			id: doctorId,
			isDeleted: false,
			verificationStatus: DoctorVerifyStatus.APPROVED,
		},
		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consultationFee: true,
			createdAt: true,
		},
	});

	if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Not Found");
	}

	return doctor;
}



export const DoctorServices = {
	applyAsDoctor,
	verifyDoctorEmail,
	approvedDoctorProfile,
	getAllDoctor,
	updateDoctorProfile,
	getAvailableDoctorByTodaysSchedule,
	getAllDoctorsListPublic,
	getSingleDoctorPublicProfile
};