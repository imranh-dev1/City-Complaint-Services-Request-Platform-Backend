import type { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { cloudinary } from "../../lib/cloudinary";
import type { JwtPayload } from "jsonwebtoken";
import type { IUserProfileUpdate } from "./user.interface";
import httpStatus from "http-status";
import bcrypt from "bcryptjs";
import config from "../../config";

const profileImageUpload = async (buffer: Buffer, userId: string) => {
	const currentUser = await prisma.user.findUnique({
		where: {
			id: userId,
		},
		select: {
			imagePublicId: true,
			imageUrl: true,
		},
	});

	const cloudinaryResult = await new Promise<UploadApiResponse>(
		(resolve, reject) => {
			cloudinary.uploader
				.upload_stream({ resource_type: "auto" }, async (error, result) => {
					if (error) {
						return reject(error);
					}

					if (!result) {
						return reject(new AppError(502, "No Result form Cloudanry"));
					}

					resolve(result);
				})
				.end(buffer);
		},
	);

	const updateUserProfileImage = await prisma.user.update({
		where: {
			id: userId,
		},
		data: {
			imagePublicId: cloudinaryResult?.public_id,
			imageUrl: cloudinaryResult?.secure_url,
		},
		omit: {
			password: true,
		},
	});

	if (currentUser?.imagePublicId && currentUser.imageUrl) {
		await cloudinary.uploader.destroy(currentUser.imagePublicId);
	}

	return updateUserProfileImage;
};

const updateMyProfile = async (
	user: JwtPayload,
	payload: IUserProfileUpdate,
) => {
	const result = await prisma.user.update({
		where: {
			id: user.userId,
		},
		data: {
			...(payload.name !== undefined && {
				name: payload.name,
			}),

			...(payload.phone !== undefined && {
				phone: payload.phone,
			}),

			...(payload.citizen && {
				citizen: {
					upsert: {
						create: payload.citizen,
						update: payload.citizen,
					},
				},
			}),
		},
		include: {
			citizen: true,
		},
		omit: {
			password: true,
		},
	});

	return result;
};

const changePassword = async (
	userId: string,
	payload: { oldPassword: string; newPassword: string },
) => {
	const user = await prisma.user.findUnique({
		where: {
			id: userId,
		},
		select: {
			id: true,
			password: true,
		},
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (!user.password) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Password is not available for this account",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		payload.oldPassword,
		user.password,
	);

	if (!isPasswordMatched) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Old password is incorrect");
	}

	const hashedPassword = await bcrypt.hash(
		payload.newPassword,
		Number(config.bcrypt_salt_rounds),
	);

	await prisma.user.update({
		where: {
			id: userId,
		},
		data: {
			password: hashedPassword,
		},
	});

	return null;
};

export const UserServices = {
	profileImageUpload,
	updateMyProfile,
	changePassword,
};
