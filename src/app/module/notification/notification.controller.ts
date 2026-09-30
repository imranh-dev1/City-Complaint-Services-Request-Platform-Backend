import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { NotificationService } from "./notification.service";

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
	const result = await NotificationService.getMyNotifications(
		req.user?.userId as string,
		req.query as Record<string, unknown>,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Notifications retrieved successfully",
		data: result.data,
		meta: result.meta
	});
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
	const result = await NotificationService.markAsRead(
		req.user?.userId as string,
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Notification marked as read",
		data: result,
	});
});

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
	const result = await NotificationService.markAllAsRead(
		req.user?.userId as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "All notifications marked as read",
		data: result,
	});
});

export const NotificationController = {
	getMyNotifications,
	markAsRead,
	markAllAsRead,
};
