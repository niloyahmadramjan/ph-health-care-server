import type { DoctorVerifyStatus } from "../../../generated/prisma/enums";

export interface IDoctorPayload {
	name: string;
	email: string;
	specialization: string;
	licenseNumber: string;
	qualification: string;
	experienceYears: number;
	bio?: string;
	contactNumber?: string;
	consultationFee?: number;
	address?: string;
}

export interface IDoctorEmailVerify {
	email: string;
	otp: string;
}

export interface IApprovedDoctor {
	doctorId: string;
	verificationStatus: DoctorVerifyStatus;
	rejectionReason?: string;
}

export interface IQuery {
	searchTerm?: string;
	page?: string;
	limit?: string;
	sortOrder?: string;
	sortBy?: string;
	// any others filter fields can be added here
	[key: string]: any;
}
