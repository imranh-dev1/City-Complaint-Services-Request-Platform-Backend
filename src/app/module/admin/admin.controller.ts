import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AdminService } from "./admin.service";

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
	const result = await AdminService.getAllUsers(
		req.query as Record<string, unknown>,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users retrieved successfully",
		data: result.data,
		meta: result.meta,
	});
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
	const result = await AdminService.updateUserStatus(
		req.params.id as string,
		{
			userId: req.user?.userId as string,
			role: req.user?.role as "ADMIN" | "SUPER_ADMIN",
		},
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User status updated successfully",
		data: result,
	});
});

const updateUserRole = catchAsync(async (req: Request, res: Response) => {
	const result = await AdminService.updateUserRole(
		req.params.id as string,
		{
			userId: req.user?.userId as string,
			role: req.user?.role as "SUPER_ADMIN",
		},
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User role updated successfully",
		data: result,
	});
});

const assignDepartment = catchAsync(async (req: Request, res: Response) => {
	const result = await AdminService.assignDepartment(
		req.params.id as string,
		{
			userId: req.user?.userId as string,
			role: req.user?.role as "ADMIN" | "SUPER_ADMIN",
		},
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User assigned to department successfully",
		data: result,
	});
});

const getDashboardStats = catchAsync(async (req: Request, res: Response) => {
	const result = await AdminService.getDashboardStats();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Dashboard statistics retrieved successfully",
		data: result,
	});
});

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
	const result = await AdminService.getAuditLogs(
		req.query as Record<string, unknown>,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Audit logs retrieved successfully",
		data: result.data,
		meta: result.meta,
	});
});

export const AdminController = {
	getAllUsers,
	updateUserStatus,
	updateUserRole,
	assignDepartment,
	getDashboardStats,
	getAuditLogs,
};
