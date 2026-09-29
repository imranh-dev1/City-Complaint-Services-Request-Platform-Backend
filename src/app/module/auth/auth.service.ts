import bcrypt from "bcryptjs";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type {
	ICreateStaffPayload,
	IEmailVerifyPayload,
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRequestUser,
	IResetPassword,
	IUserRegisterPayload,
} from "./auth.interface";
import httpStatus from "http-status";
import crypto from "crypto";
import sendEmail from "../../utils/sendEmail";
import { jwtUtils } from "../../utils/jwt";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import type { TokenPayload } from "google-auth-library"; 
import { redisClient } from "../../lib/redis";
import { AuthProvider, Role, UserStatus } from "../../../generated/prisma/enums";
import { googleClient } from "../../lib/googleAuth";

const registerUser = async (payload: IUserRegisterPayload) => {
	const { name, email: rawEmail, password, phone } = payload;
	const email = rawEmail.trim().toLowerCase();

	if (!password) {
		throw new AppError(httpStatus.BAD_REQUEST, "Password is required");
	}

	const isUserExists = await prisma.user.findFirst({
		where: { email },
	});

	if (isUserExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User with this email already exists",
		);
	}

	const saltRounds = Number(config.bcrypt_salt_rounds);

	const hashedPassword = await bcrypt.hash(password, saltRounds);

	const expirationSeconds = 10 * 60;
	const otpKey = `citizen-registration-otp:${email}`;
	const otpValue = crypto.randomInt(100000, 1000000).toString();

	await redisClient.set(otpKey, otpValue, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	const citizenRegistrationKey = `citizen-registration-data:${email}`;
	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
		phone: phone,
		role: Role.CITIZEN,
		citizen: payload.citizen,
	};

	await redisClient.set(
		citizenRegistrationKey,
		JSON.stringify(redisUserDataPayload),
		{
			expiration: {
				type: "EX",
				value: expirationSeconds,
			},
		},
	);

	await sendEmail({
		to: email,
		subject:
			"Verify Your City Complaint & Service Request Platform Email Address",
		template: "email-verification",
		data: {
			otp: otpValue,
			expirationMinutes: Math.ceil(expirationSeconds / 60),
		},
	});

	return {
		success: true,
		message: "Verification OTP sent to email successfully.",
	};
};

const registerCitizenVerification = async (payload: IEmailVerifyPayload) => {
	const email = payload.email.trim().toLowerCase();
	const otp = payload.otp;

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User with this email already exists.",
		);
	}

	const otpKey = `citizen-registration-otp:${email}`;

	const storedOtp = await redisClient.get(otpKey);

	if (!storedOtp) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"OTP has expired. Please register again.",
		);
	}

	if (storedOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP.");
	}

	const citizenRegistrationKey = `citizen-registration-data:${email}`;

	const storedUserData = await redisClient.get(citizenRegistrationKey);

	if (!storedUserData) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Registration data has expired. Please register again.",
		);
	}

	const redisUserDataPayload = JSON.parse(storedUserData);

	const citizenPayload: IUserRegisterPayload = redisUserDataPayload;

	const createdUser = await prisma.user.create({
		data: {
			name: citizenPayload.name,
			email: citizenPayload.email,
			password: citizenPayload.password,
			role: Role.CITIZEN,
			status: UserStatus.ACTIVE,
			emailVerified: true,
			citizen: {
				create: {
					nid: citizenPayload.citizen?.nid ?? null,
					address: citizenPayload.citizen?.address ?? null,
					wardNo: citizenPayload.citizen?.wardNo ?? null,
					area: citizenPayload.citizen?.area ?? null,
				},
			},
		},

		omit: {
			password: true,
		},

		include: {
			citizen: true,
		},
	});

	await redisClient.del([otpKey, citizenRegistrationKey]);

	await sendEmail({
		to: citizenPayload.email,
		subject: "Welcome to City Complaint & Service Request Platform",
		template: "registration-success",
		data: {
			name: citizenPayload.name,
			email: citizenPayload.email,
		},
	});

	const { citizen: createdCitizen, ...user } = createdUser;

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		user,
		citizen: createdCitizen,
		accessToken,
		refreshToken,
	};
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new AppError(404, "User not found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new AppError(403, "User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new AppError(404, "User is deleted");
	}

	if (user.password === null && user.googleId !== null) {
		throw new AppError(
			400,
			"User Already Has Account Registerd with Google, try to login with google.",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new AppError(401, "Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			citizen: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new AppError(404, "User not found");
	}

	return isUserExists;
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;
	try {
		const tiket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});

		googleIdTokenPayload = tiket.getPayload();
	} catch (error) {
		console.log("Google id Token Verification Faild", error);
		throw new AppError(401, "Invalid or Expired Google Id Token");
	}

	if (!googleIdTokenPayload) {
		throw new AppError(401, "Invalid or Expired Google Id Token");
	}

	if (!googleIdTokenPayload.email) {
		throw new AppError(400, "Google email not found");
	}

	if (!googleIdTokenPayload.name) {
		throw new AppError(400, "Google email User name not found");
	}

	const ifPatientExsitWithGoogleAuth = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
			role: Role.CITIZEN,
			googleId: googleIdTokenPayload.sub,
		},
	});

	let user = ifPatientExsitWithGoogleAuth;

	if (!ifPatientExsitWithGoogleAuth) {
		const ifPatientExistWithCredentials = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				role: Role.CITIZEN,
				authProvider: AuthProvider.CREDENTIAL,
			},
		});

		if (ifPatientExistWithCredentials) {
			if (!ifPatientExistWithCredentials.emailVerified) {
				throw new AppError(400, "User Email not verified");
			}

			if (ifPatientExistWithCredentials.status === UserStatus.BLOCKED) {
				throw new AppError(403, "User is Blocked");
			}

			if (
				ifPatientExistWithCredentials.isDeleted ||
				ifPatientExistWithCredentials.status === UserStatus.DELETED
			) {
				throw new AppError(404, "User is Deleted");
			}

			user = await prisma.user.update({
				where: {
					id: ifPatientExistWithCredentials.id,
				},
				data: {
					googleId: googleIdTokenPayload.sub,
				},
			});
		} else {
			user = await prisma.user.create({
				data: {
					name: googleIdTokenPayload.name,
					email: googleIdTokenPayload.email,
					role: Role.CITIZEN,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
					citizen: {
						create: {
							address: "",
							wardNo: "",
							area: "",
							nid: null,
						},
					},
				},
			});
			await sendEmail({
				to: user.email,
				subject: "Welcome to City Complaint & Service Request Platform",
				template: "registration-success",
				data: {
					name: user.name,
					email: user.email,
				},
			});
		}
	}

	if (!user) {
		throw new AppError(404, "User Not Found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new AppError(403, "User is Blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new AppError(404, "User is Deleted");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new AppError(
			401,
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new AppError(401, "User is inactive or not found");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const isUserExist = await prisma.user.findUnique({
		where: {
			email: payload.email,
		},
	});

	if (!isUserExist) {
		throw new AppError(404, "User Does Not Exist!");
	}

	if (isUserExist.status === "BLOCKED") {
		throw new AppError(
			403,
			"User is BLocked, Contact support, and try again..",
		);
	}
	if (isUserExist.status === "DELETED") {
		throw new AppError(
			404,
			"User is Deleted, Contact support, and try again..",
		);
	}

	if (!isUserExist.emailVerified) {
		throw new AppError(400, "User Email not verified.");
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new AppError(400, "This User Has Account With Google Login...");
	}

	const otp = crypto.randomInt(100000, 1000000).toString();

	const otpKey = `forgot-password-otp:${isUserExist.email}`;

	const expirationSeconds = 5 * 60;

	await redisClient.set(otpKey, otp, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	await sendEmail({
		to: isUserExist.email,
		subject: "Your Password Reset OTP",
		template: "forgot-password-otp",
		data: {
			otp,
		},
	});
};

const resetPassword = async (payload: IResetPassword) => {
	const { newPassword, otp, email } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email: email,
		},
	});

	if (!isUserExist) {
		throw new AppError(404, "User Does Not Exist!");
	}

	if (isUserExist.status === "BLOCKED") {
		throw new AppError(
			403,
			"User is BLocked, Contact support, and try again..",
		);
	}
	if (isUserExist.status === "DELETED") {
		throw new AppError(
			404,
			"User is Deleted, Contact support, and try again..",
		);
	}

	if (!isUserExist.emailVerified) {
		throw new AppError(400, "User Email not verified.");
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new AppError(400, "This User Has Account With Google Login...");
	}

	const otpKey = `forgot-password-otp:${isUserExist.email}`;

	const storedOtp = await redisClient.get(otpKey);

	if (!storedOtp) {
		throw new AppError(400, "OTP has expired.");
	}

	if (storedOtp !== otp) {
		throw new AppError(400, "Invalid OTP.");
	}

	const hashedPassword = await bcrypt.hash(
		newPassword,
		Number(config.bcrypt_salt_rounds),
	);

	await prisma.user.update({
		where: {
			email: isUserExist.email,
		},
		data: {
			password: hashedPassword,
		},
	});

	await redisClient.del([otpKey]);

	await sendEmail({
		to: isUserExist.email,
		subject: "City complaint Password Reset Successful",
		template: "password-reset-success",
		data: {
			name: isUserExist.name,
			email: isUserExist.email,
		},
	});
};

const registerStaff = async (payload: ICreateStaffPayload, actorId: string) => {
	const email = payload.email.trim().toLowerCase();

	const existing = await prisma.user.findUnique({
		where: { email },
	});

	if (existing) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User with this email already exists",
		);
	}

	const hashedPassword = await bcrypt.hash(
		payload.password,
		Number(config.bcrypt_salt_rounds),
	);

	if (payload.departmentId) {
		const department = await prisma.department.findFirst({
			where: {
				id: payload.departmentId,
				deletedAt: null,
			},
		});

		if (!department) {
			throw new AppError(httpStatus.NOT_FOUND, "Department not found");
		}
	}

	const user = await prisma.user.create({
		data: {
			name: payload.name.trim(),
			email,
			password: hashedPassword,
			role: payload.role,
			status: UserStatus.ACTIVE,
			emailVerified: true,
			phone: payload.phone ?? null,
			departmentId: payload.departmentId ?? null,
			...(payload.role === Role.TECHNICIAN && {
				technician: {
					create: {
						specialization: payload.specialization ?? "General",
						experience: payload.experience ?? 0,
					},
				},
			}),
		},
		omit: {
			password: true,
		},
	});

	return user;
};

export const AuthServices = {
	registerUser,
	registerCitizenVerification,
	loginUser,
	getMe,
	googleLogin,
	refreshToken,
	forgotPassword,
	resetPassword,
	registerStaff,
};
