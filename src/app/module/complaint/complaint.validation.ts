import { z } from "zod";
import { ComplaintStatus, Priority } from "../../../generated/prisma/enums";

export const createComplaintValidation = z.object({
	title: z
		.string()
		.trim()
		.min(5, "Complaint title must be at least 5 characters")
		.max(200, "Complaint title cannot exceed 200 characters"),

	description: z
		.string()
		.trim()
		.min(10, "Complaint description must be at least 10 characters")
		.max(2000, "Complaint description cannot exceed 2000 characters"),

	address: z
		.string()
		.trim()
		.min(5, "Address must be at least 5 characters")
		.max(500, "Address cannot exceed 500 characters"),

	latitude: z
		.number()
		.min(-90, "Latitude must be between -90 and 90")
		.max(90, "Latitude must be between -90 and 90")
		.optional(),

	longitude: z
		.number()
		.min(-180, "Longitude must be between -180 and 180")
		.max(180, "Longitude must be between -180 and 180")
		.optional(),

	priority: z
		.enum(["LOW", "MEDIUM", "HIGH", "URGENT"], {
			message: "Invalid priority value",
		})
		.default("MEDIUM"),

	categoryId: z.string().uuid("Invalid category ID"),
});

export const updateComplaintValidation = z.object({
	title: z.string().trim().min(5).max(200).optional(),
	description: z.string().trim().min(10).max(2000).optional(),
	address: z.string().trim().min(5).max(500).optional(),
	latitude: z.number().min(-90).max(90).optional(),
	longitude: z.number().min(-180).max(180).optional(),
	priority: z.nativeEnum(Priority).optional(),
});

export const changeComplaintStatusValidation = z.object({
	status: z.nativeEnum(ComplaintStatus, {
		message: "Invalid complaint status",
	}),
	note: z.string().trim().max(1000).optional(),
});

export const assignTechnicianValidation = z.object({
	technicianId: z.string().uuid("Invalid technician ID"),
});

export const addNoteValidation = z.object({
	message: z
		.string()
		.trim()
		.min(3, "Note must be at least 3 characters")
		.max(2000, "Note cannot exceed 2000 characters"),
	status: z.nativeEnum(ComplaintStatus).optional(),
});
