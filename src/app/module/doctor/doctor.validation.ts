import z, { string } from "zod";

export const ApplyAsDoctorValidationZodSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters long "),
  email: z.email("Invalid email address").trim().toLowerCase(),
  address: string()
    .trim()
    .min(5, "Address at least minimun 5 characters")
    .optional(),
  specialization: z
    .string()
    .trim()
    .min(2, "Specialization at least 2 characters long"),
  licenseNumber: z.string().trim().min(3, "License number is required"),

  qualification: z.string().trim().min(2, "Qualifications are required"),
  experienceYears: z
    .number()
    .int("Experience years must be an integer")
    .min(0, "Experience years cannot be negative"),

  bio: z
    .string()
    .trim()
    .max(1000, "Bio cannot exceed 1000 characters")
    .optional(),

  // Handles converting incoming FormData strings like "150.00" into a float number
  consultationFee: z
    .number()
    .min(0, "Consultation fee cannot be negative")
    .optional(),
  contactNumber: z
    .string()
    .trim()
    .min(5, "Contact number is invalid")
    .optional(),
});
