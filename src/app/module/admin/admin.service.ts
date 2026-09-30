import httpStatus from "http-status";

import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/auditLog";
import type {
	IAssignDepartmentPayload,
	IUpdateUserRolePayload,
	IUpdateUserStatusPayload,
} from "./admin.interface";
import {
	ComplaintStatus,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import {
	buildOrderBy,
	buildPaginationMeta,
	parsePagination,
} from "../../utils/pagination";

const assertSuperAdmin = (actor: { userId: string; role: Role }) => {
	if (actor.role !== Role.SUPER_ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only the SUPER_ADMIN can perform this action",
		);
	}
};

const findTargetUser = async (id: string) => {
	const user = await prisma.user.findUnique({
		where: { id },
		include: {
			citizen: true,
			technician: true,
			department: true,
		},
	});

	if (!user || user.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	return user;
};

const getAllUsers = async (query: Record<string, unknown>) => {
	const pagination = parsePagination(query as never);

	const { search, role, status } = query as {
		search?: string;
		role?: string;
		status?: string;
	};

	const where: Record<string, unknown> = {
		isDeleted: false,
	};

	if (search) {
		where.OR = [
			{
				name: {
					contains: search,
					mode: "insensitive",
				},
			},
			{
				email: {
					contains: search,
					mode: "insensitive",
				},
			},
			{
				phone: {
					contains: search,
				},
			},
		];
	}

	if (role) {
		where.role = role;
	}

	if (status) {
		where.status = status;
	}

	const [users, total] = await Promise.all([
		prisma.user.findMany({
			where: where as never,
			skip: pagination.skip,
			take: pagination.limit,
			orderBy: buildOrderBy(pagination, [
				"createdAt",
				"name",
				"role",
				"status",
			] as never[]),
			omit: {
				password: true,
			},
			include: {
				citizen: true,
				technician: true,
				department: true,
				_count: {
					select: {
						complaints: true,
						payments: true,
					},
				},
			},
		}),

		prisma.user.count({
			where: where as never,
		}),
	]);

	return {
		data: users,
		meta: buildPaginationMeta(total, pagination),
	};
};

const updateUserStatus = async (
	id: string,
	actor: { userId: string; role: Role },
	payload: IUpdateUserStatusPayload,
) => {
	const target = await findTargetUser(id);

	if (id === actor.userId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot change your own status",
		);
	}

	if (target.role === Role.SUPER_ADMIN) {
		assertSuperAdmin(actor);
	}

	const result = await prisma.user.update({
		where: { id },
		data: {
			status: payload.status,
		},
		omit: {
			password: true,
		},
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "USER_STATUS_CHANGED",
		entityType: "USER",
		entityId: id,
		metadata: {
			from: target.status,
			to: payload.status,
		},
	});

	return result;
};

const updateUserRole = async (
	id: string,
	actor: { userId: string; role: Role },
	payload: IUpdateUserRolePayload,
) => {
	assertSuperAdmin(actor);

	const target = await findTargetUser(id);

	if (id === actor.userId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot change your own role",
		);
	}

	const result = await prisma.$transaction(async (tx) => {
		const updated = await tx.user.update({
			where: { id },
			data: {
				role: payload.role,
			},
			omit: {
				password: true,
			},
		});

		if (payload.role === Role.TECHNICIAN && !target.technician) {
			await tx.technician.create({
				data: {
					userId: id,
					specialization: "General",
				},
			});
		}

		if (payload.role === Role.CITIZEN && !target.citizen) {
			await tx.citizen.create({
				data: {
					userId: id,
				},
			});
		}

		return updated;
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "USER_ROLE_CHANGED",
		entityType: "USER",
		entityId: id,
		metadata: {
			from: target.role,
			to: payload.role,
		},
	});

	return result;
};

const assignDepartment = async (
	id: string,
	actor: { userId: string; role: Role },
	payload: IAssignDepartmentPayload,
) => {
	const target = await findTargetUser(id);

	const staffRoles: Role[] = [Role.TECHNICIAN, Role.ADMIN, Role.SUPER_ADMIN];

	if (!staffRoles.includes(target.role)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Only staff/technician roles can be assigned to a department",
		);
	}

	const department = await prisma.department.findFirst({
		where: {
			id: payload.departmentId,
			deletedAt: null,
		},
	});

	if (!department) {
		throw new AppError(httpStatus.NOT_FOUND, "Department not found");
	}

	const result = await prisma.user.update({
		where: { id },
		data: {
			departmentId: payload.departmentId,
		},
		omit: {
			password: true,
		},
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "USER_DEPARTMENT_ASSIGNED",
		entityType: "USER",
		entityId: id,
		metadata: {
			departmentId: payload.departmentId,
			departmentName: department.name,
		},
	});

	return result;
};

const getDashboardStats = async () => {
	const now = new Date();

	const [
		totalUsers,
		usersByRole,
		totalComplaints,
		complaintsByStatus,
		totalPayments,
		paidPayments,
		paymentsSumAgg,
		totalDepartments,
		totalCategories,
		feedbackAgg,
		openBreached,
		openApproaching,
		recentComplaints,
		topCategories,
	] = await Promise.all([
		prisma.user.count({
			where: {
				isDeleted: false,
			},
		}),

		prisma.user.groupBy({
			by: ["role"],
			_count: true,
		}),

		prisma.complaint.count({
			where: {
				deletedAt: null,
			},
		}),

		prisma.complaint.groupBy({
			by: ["status"],
			_count: true,
			where: {
				deletedAt: null,
			},
		}),

		prisma.payment.count(),

		prisma.payment.count({
			where: {
				status: PaymentStatus.PAID,
			},
		}),

		prisma.payment.aggregate({
			_sum: {
				amount: true,
			},
			where: {
				status: PaymentStatus.PAID,
			},
		}),

		prisma.department.count({
			where: {
				deletedAt: null,
			},
		}),

		prisma.category.count({
			where: {
				deletedAt: null,
			},
		}),

		prisma.feedback.aggregate({
			_avg: {
				rating: true,
			},
			_count: true,
		}),

		prisma.complaint.count({
			where: {
				deletedAt: null,
				status: {
					notIn: [
						ComplaintStatus.RESOLVED,
						ComplaintStatus.CLOSED,
						ComplaintStatus.CANCELLED,
						ComplaintStatus.REJECTED,
					],
				},
				slaDeadline: {
					lt: now,
				},
			},
		}),

		prisma.complaint.count({
			where: {
				deletedAt: null,
				status: {
					notIn: [
						ComplaintStatus.RESOLVED,
						ComplaintStatus.CLOSED,
						ComplaintStatus.CANCELLED,
						ComplaintStatus.REJECTED,
					],
				},
				slaDeadline: {
					gte: now,
					lte: new Date(now.getTime() + 24 * 60 * 60 * 1000),
				},
			},
		}),

		prisma.complaint.findMany({
			where: {
				deletedAt: null,
			},
			orderBy: {
				createdAt: "desc",
			},
			take: 5,
			select: {
				id: true,
				title: true,
				status: true,
				priority: true,
				createdAt: true,
			},
		}),

		prisma.category.findMany({
			where: {
				deletedAt: null,
			},
			orderBy: {
				complaints: {
					_count: "desc",
				},
			},
			take: 5,
			select: {
				id: true,
				name: true,
				departmentId: true,
				_count: {
					select: {
						complaints: true,
					},
				},
			},
		}),
	]);

	return {
		users: {
			total: totalUsers,
			byRole: usersByRole,
		},

		complaints: {
			total: totalComplaints,
			byStatus: complaintsByStatus,
			recent: recentComplaints,
			sla: {
				breached: openBreached,
				approaching: openApproaching,
			},
		},

		payments: {
			total: totalPayments,
			paid: paidPayments,
			totalRevenue: paymentsSumAgg._sum.amount?.toString() ?? "0",
		},

		resources: {
			departments: totalDepartments,
			categories: totalCategories,
		},

		feedback: {
			averageRating: feedbackAgg._avg.rating ?? 0,
			total: feedbackAgg._count,
		},

		topCategories,
	};
};

const getAuditLogs = async (query: Record<string, unknown>) => {
	const pagination = parsePagination(query as never);

	const { entityType, action, userId } = query as {
		entityType?: string;
		action?: string;
		userId?: string;
	};

	const where: Record<string, unknown> = {};

	if (entityType) {
		where.entityType = entityType;
	}

	if (action) {
		where.action = action;
	}

	if (userId) {
		where.userId = userId;
	}

	const [logs, total] = await Promise.all([
		prisma.auditLog.findMany({
			where: where as never,
			skip: pagination.skip,
			take: pagination.limit,
			orderBy: {
				createdAt: "desc",
			},
			include: {
				user: {
					omit: {
						password: true,
					} as const,
				},
			},
		}),

		prisma.auditLog.count({
			where: where as never,
		}),
	]);

	return {
		data: logs,
		meta: buildPaginationMeta(total, pagination),
	};
};

export const AdminService = {
	getAllUsers,
	updateUserStatus,
	updateUserRole,
	assignDepartment,
	getDashboardStats,
	getAuditLogs,
};
