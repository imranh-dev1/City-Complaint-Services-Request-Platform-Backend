import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { FeedbackService } from "./feedback.service";
import type { Role } from "../../../generated/prisma/enums";

const getActor = (req: Request) => ({
	userId: req.user?.userId as string,
	role: req.user?.role as Role,
	name: req.user?.name,
});

const createFeedback = catchAsync(async (req: Request, res: Response) => {
	const result = await FeedbackService.createFeedback(
		req.params.id as string,
		getActor(req),
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Feedback submitted successfully. Complaint closed.",
		data: result,
	});
});

const getFeedbackByComplaint = catchAsync(
	async (req: Request, res: Response) => {
		const result = await FeedbackService.getFeedbackByComplaint(
			req.params.id as string,
			getActor(req),
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Feedback retrieved successfully",
			data: result,
		});
	},
);

export const FeedbackController = {
	createFeedback,
	getFeedbackByComplaint,
};
