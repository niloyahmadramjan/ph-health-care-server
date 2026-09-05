export interface doctorPayload {
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
  email: string,
  otp: string
}