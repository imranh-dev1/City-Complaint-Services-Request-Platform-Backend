import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { AppError } from "../../utils/AppError";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { UserServices } from "./user.service";
import type { JwtPayload } from "jsonwebtoken";

const profileImageUpload = catchAsync(async (req: Request, res: Response) => {
	if (!req.file) {
		throw new AppError(400, "Profile image not Provided.");
	}
	if (!req.user?.userId) {
		throw new AppError(404, "User Not Found, this profile image upload.");
	}

	const result = await UserServices.profileImageUpload(
		req.file.buffer,
		req.user?.userId,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile image Uploded Successfully",
		data: result,
	});
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
	const result = await UserServices.updateMyProfile(
		req.user as JwtPayload,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile updated successfully.",
		data: result,
	});
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
	const userId = (req.user as JwtPayload & { userId: string }).userId;

	const result = await UserServices.changePassword(userId, req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password changed successfully.",
		data: result,
	});
});

export const UserController = {
	profileImageUpload,
	updateMyProfile,
	changePassword,
};
