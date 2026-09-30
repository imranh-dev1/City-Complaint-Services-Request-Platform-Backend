import { z } from "zod";

export const createFeedbackSchema = z.object({
	rating: z
		.number({ message: "Rating is required" })
		.int("Rating must be a whole number")
		.min(1, "Rating must be between 1 and 5")
		.max(5, "Rating must be between 1 and 5"),

	comment: z
		.string()
		.trim()
		.max(1000, "Comment cannot exceed 1000 characters")
		.optional(),
});
