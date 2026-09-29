import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AuthServices } from "./auth.service";
import type { IRequestUser } from "./auth.interface";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { clearAuthCookies, setAuthCookies } from "../../utils/authCookie";
import { AppError } from "../../utils/AppError";

const registerCitizen = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthServices.registerUser(payload);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Verification OTP Sent",
		data: null,
	});
});

const registerEmailVerification = catchAsync(
	async (req: Request, res: Response) => {
		const payload = req.body;
		const result = await AuthServices.registerCitizenVerification(payload);

		const { accessToken, refreshToken, user, citizen } = result;

		setAuthCookies(res, accessToken, refreshToken);

		sendResponse(res, {
			statusCode: httpStatus.CREATED,
			success: true,
			message:
				"Citizen Email verification Successfully & Citizen registered successfully",
			data: {
				accessToken,
				refreshToken,
				user,
				citizen,
			},
		});
	},
);

const loginUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const result = await AuthServices.loginUser(payload);
	const { accessToken, refreshToken } = result;

	setAuthCookies(res, accessToken, refreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged in successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});

const getMe = catchAsync(async (req: Request, res: Response) => {
	const user = req.user as unknown as IRequestUser;

	if (!user) {
		throw new AppError(400, "User information is missing in the request");
	}

	const result = await AuthServices.getMe(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User profile fetched successfully",
		data: result,
	});
});

const googleLogin = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthServices.googleLogin(req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged in successfully",
		data: result,
	});
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
	if (!req.cookies.refreshToken) {
		throw new AppError(401, "Refresh token is missing");
	}
	const result = await AuthServices.refreshToken(req.cookies.refreshToken);
	const { accessToken, refreshToken: newRefreshToken } = result;

	setAuthCookies(res, accessToken, newRefreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: {
			accessToken,
			refreshToken: newRefreshToken,
		},
	});
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthServices.forgotPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: `User Password Forgot successfully, This email, ${payload.email}`,
		data: null,
	});
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthServices.resetPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Password reset successfully..",
		data: null,
	});
});

const logoutUser = catchAsync(async (req: Request, res: Response) => {
	clearAuthCookies(res);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged out successfully",
		data: null,
	});
});

const registerStaff = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthServices.registerStaff(
		req.body,
		req.user?.userId as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Staff/Technician account created successfully",
		data: result,
	});
});

export const AuthControllers = {
	registerCitizen,
	registerEmailVerification,
	loginUser,
	getMe,
	googleLogin,
	refreshToken,
	forgotPassword,
	resetPassword,
	logoutUser,
	registerStaff,
};
