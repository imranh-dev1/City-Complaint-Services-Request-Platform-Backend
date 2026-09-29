import type {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../../generated/prisma/enums";

export interface ICitizenProfile {
	nid?: string;
	address?: string;
	wardNo?: string;
	area?: string;
}

export interface IUserRegisterPayload {
	name: string;
	email: string;
	password?: string;
	googleId?: string;
	authProvider?: AuthProvider;
	emailVerified?: boolean;
	role?: Role;
	status?: UserStatus;
	needPasswordChange?: boolean;
	imageUrl?: string;
	imagePublicId?: string;
	phone?: string | null;
	isDeleted?: boolean;
	deletedAt?: Date | null;

	citizen?: ICitizenProfile;
}

export interface ILoginUserPayload {
	email: string;
	password: string;
}

export interface IRequestUser {
	userId: string;
	email: string;
	name: string;
	role: Role;
}

export interface IGoogleLoginPayload {
	idToken: string;
}

export interface IEmailVerifyPayload {
	email: string;
	otp: string;
}

export interface IForgotPasswordPayload {
	email: string;
}

export interface IResetPassword {
	email: string;
	otp: string;
	newPassword: string;
}

export interface ICreateStaffPayload {
	name: string;
	email: string;
	password: string;
	role: "ADMIN" | "TECHNICIAN";
	phone?: string | null;
	departmentId?: string;
	specialization?: string;
	experience?: number;
}
