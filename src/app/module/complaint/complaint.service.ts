import httpStatus from "http-status";
import { v2 as cloudinary } from "cloudinary";
import type { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/auditLog";
import { createNotification } from "../../utils/notify";
import {
	buildOrderBy,
	buildPaginationMeta,
	parsePagination,
} from "../../utils/pagination";
import { computeSlaStatus } from "../../utils/sla";
import type {
	IAddNotePayload,
	IAssignTechnicianPayload,
	ICreateComplaint,
	IUpdateComplaint,
} from "./complaint.interface";
import {
	ComplaintStatus,
	NotificationType,
	Priority,
	Role,
	TechAvailability,
} from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";

export interface IAuthActor {
	userId: string;
	role: Role;
	email?: string;
	name?: string;
}

const CANCELLABLE_STATUSES: ComplaintStatus[] = [
	ComplaintStatus.SUBMITTED,
	ComplaintStatus.UNDER_REVIEW,
	ComplaintStatus.ASSIGNED,
	ComplaintStatus.IN_PROGRESS,
];

const ACCEPTED_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
	[ComplaintStatus.SUBMITTED]: [
		ComplaintStatus.UNDER_REVIEW,
		ComplaintStatus.REJECTED,
	],
	[ComplaintStatus.UNDER_REVIEW]: [ComplaintStatus.REJECTED],
	[ComplaintStatus.ASSIGNED]: [],
	[ComplaintStatus.IN_PROGRESS]: [],
	[ComplaintStatus.RESOLVED]: [ComplaintStatus.CLOSED],
	[ComplaintStatus.CLOSED]: [],
	[ComplaintStatus.REJECTED]: [],
	[ComplaintStatus.CANCELLED]: [],
};

const TECHNICIAN_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
	[ComplaintStatus.ASSIGNED]: [ComplaintStatus.IN_PROGRESS],
	[ComplaintStatus.IN_PROGRESS]: [ComplaintStatus.RESOLVED],
	[ComplaintStatus.SUBMITTED]: [],
	[ComplaintStatus.UNDER_REVIEW]: [],
	[ComplaintStatus.RESOLVED]: [],
	[ComplaintStatus.CLOSED]: [],
	[ComplaintStatus.REJECTED]: [],
	[ComplaintStatus.CANCELLED]: [],
};

const complaintListInclude = {
	category: {
		include: {
			department: true,
		},
	},
	citizen: {
		omit: {
			password: true,
		} as const,
	},
	department: true,
	assignedTechnician: {
		omit: {
			password: true,
		} as const,
	},
	attachments: true,
	assignments: {
		include: {
			technician: {
				omit: {
					password: true,
				} as const,
			},
		},
	},
	_count: {
		select: {
			payments: true,
			updates: true,
		},
	},
} satisfies Prisma.ComplaintInclude;

type ComplaintListItem = Prisma.ComplaintGetPayload<{
	include: typeof complaintListInclude;
}>;

const complaintDetailInclude = {
	...complaintListInclude,
	feedback: true,
	payments: true,
	updates: {
		include: {
			updatedBy: {
				omit: {
					password: true,
				} as const,
			},
		},
	},
} satisfies Prisma.ComplaintInclude;

type ComplaintDetailItem = Prisma.ComplaintGetPayload<{
	include: typeof complaintDetailInclude;
}>;

const attachSla = (complaint: ComplaintListItem | ComplaintDetailItem) => ({
	...complaint,
	sla: computeSlaStatus(complaint, complaint.category.slaHours),
});

const uploadFilesToCloudinary = async (files: Express.Multer.File[]) => {
	const results = await Promise.all(
		files.map(
			(file) =>
				new Promise<UploadApiResponse>((resolve, reject) => {
					const uploadStream = cloudinary.uploader.upload_stream(
						{ resource_type: "auto" },
						(error, result) => {
							if (error) {
								return reject(error);
							}
							if (!result) {
								return reject(new AppError(502, "No result from Cloudinary"));
							}
							resolve(result);
						},
					);
					uploadStream.end(file.buffer);
				}),
		),
	);

	return results.map((result) => ({
		url: result.secure_url,
		publicId: result.public_id,
	}));
};

const getRoleScopedWhere = (
	actor: IAuthActor,
	where: Prisma.ComplaintWhereInput,
): Prisma.ComplaintWhereInput => {
	if (actor.role === Role.CITIZEN) {
		return {
			...where,
			citizenId: actor.userId,
		};
	}

	if (actor.role === Role.TECHNICIAN) {
		const { AND: existingAnd, ...rest } = where;

		return {
			...rest,
			AND: [
				...(Array.isArray(existingAnd)
					? existingAnd
					: existingAnd
						? [existingAnd]
						: []),
				{
					OR: [
						{ assignedTechnicianId: actor.userId },
						{ departmentId: { not: null } },
					],
				},
			],
		};
	}

	return where;
};

const findComplaintOrThrow = async (
	id: string,
	actor: IAuthActor,
	options?: { forUpdate?: boolean },
) => {
	const complaint = await prisma.complaint.findFirst({
		where: {
			id,
			deletedAt: null,
		},
		include: complaintDetailInclude,
	});

	if (!complaint) {
		throw new AppError(httpStatus.NOT_FOUND, "Complaint not found");
	}

	if (actor.role === Role.CITIZEN && complaint.citizenId !== actor.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only access your own complaints",
		);
	}

	if (
		actor.role === Role.TECHNICIAN &&
		complaint.assignedTechnicianId !== actor.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not assigned to this complaint",
		);
	}

	void options;
	return complaint;
};

const createComplaint = async (
	payload: ICreateComplaint,
	userId: string,
	files: Express.Multer.File[] = [],
) => {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true },
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	const category = await prisma.category.findFirst({
		where: {
			id: payload.categoryId,
			deletedAt: null,
		},
		include: {
			department: true,
		},
	});

	if (!category) {
		throw new AppError(httpStatus.NOT_FOUND, "Category not found");
	}

	if (!category.isActive) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This category is not available",
		);
	}

	if (!category.department || category.department.deletedAt) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Category is not linked to an active department",
		);
	}

	const attachments =
		files.length > 0 ? await uploadFilesToCloudinary(files) : [];

	const slaDeadline = new Date(Date.now() + category.slaHours * 60 * 60 * 1000);

	const result = await prisma.complaint.create({
		data: {
			title: payload.title,
			description: payload.description,
			address: payload.address,
			latitude: payload.latitude,
			longitude: payload.longitude,
			priority: payload.priority ?? Priority.MEDIUM,
			categoryId: category.id,
			departmentId: category.departmentId,
			citizenId: userId,
			slaDeadline,
			attachments: {
				create: attachments,
			},
		},
		include: complaintDetailInclude,
	});

	await createNotification({
		userId,
		title: "Complaint submitted",
		message: `Your complaint "${result.title}" was submitted successfully. Reference: #${result.id}`,
		type: NotificationType.COMPLAINT_CREATED,
		complaintId: result.id,
	});

	await writeAuditLog({
		userId,
		action: "COMPLAINT_CREATED",
		entityType: "COMPLAINT",
		entityId: result.id,
		metadata: {
			priority: result.priority,
			departmentId: result.departmentId,
		},
	});

	return attachSla(result);
};

const getAllComplaints = async (
	query: Record<string, unknown>,
	actor: IAuthActor,
) => {
	const pagination = parsePagination(query as never);
	const { search, status, priority, categoryId, departmentId, sla } = query as {
		search?: string;
		status?: string;
		priority?: string;
		categoryId?: string;
		departmentId?: string;
		sla?: string;
	};

	const where: Prisma.ComplaintWhereInput = {
		deletedAt: null,
	};

	if (search) {
		where.OR = [
			{ title: { contains: search, mode: "insensitive" } },
			{ description: { contains: search, mode: "insensitive" } },
			{ address: { contains: search, mode: "insensitive" } },
			{ category: { name: { contains: search, mode: "insensitive" } } },
		];
	}

	if (status) {
		where.status = status as ComplaintStatus;
	}

	if (priority) {
		where.priority = priority as Priority;
	}

	if (categoryId) {
		where.categoryId = categoryId;
	}

	if (departmentId) {
		where.departmentId = departmentId;
	}

	const scopedWhere = getRoleScopedWhere(actor, where);

	const [complaints, total] = await Promise.all([
		prisma.complaint.findMany({
			where: scopedWhere,
			skip: pagination.skip,
			take: pagination.limit,
			orderBy: buildOrderBy(pagination, [
				"createdAt",
				"updatedAt",
				"priority",
				"status",
			] as never[]),
			include: complaintListInclude,
		}),
		prisma.complaint.count({ where: scopedWhere }),
	]);

	let data = complaints.map(attachSla);

	if (sla) {
		data = data.filter((item) => item.sla.slaStatus === sla.toUpperCase());
	}

	return {
		data,
		meta: buildPaginationMeta(total, pagination),
	};
};

const getMyComplaints = async (
	query: Record<string, unknown>,
	actor: IAuthActor,
) => {
	return getAllComplaints(query, {
		userId: actor.userId,
		role: Role.CITIZEN,
	});
};

const getMyAssignedComplaints = async (
	query: Record<string, unknown>,
	actor: IAuthActor,
) => {
	const pagination = parsePagination(query as never);
	const status = query.status as string | undefined;

	const where: Prisma.ComplaintWhereInput = {
		deletedAt: null,
		assignedTechnicianId: actor.userId,
	};

	if (status) {
		where.status = status as ComplaintStatus;
	}

	const [complaints, total] = await Promise.all([
		prisma.complaint.findMany({
			where,
			skip: pagination.skip,
			take: pagination.limit,
			orderBy: { createdAt: "desc" },
			include: complaintListInclude,
		}),
		prisma.complaint.count({ where }),
	]);

	return {
		data: complaints.map(attachSla),
		meta: buildPaginationMeta(total, pagination),
	};
};

const getComplaintById = async (id: string, actor: IAuthActor) => {
	const complaint = await findComplaintOrThrow(id, actor);
	return attachSla(complaint);
};

const getComplaintUpdates = async (id: string, actor: IAuthActor) => {
	await findComplaintOrThrow(id, actor);

	const updates = await prisma.complaintUpdate.findMany({
		where: {
			complaintId: id,
		},
		include: {
			updatedBy: {
				omit: {
					password: true,
				} as const,
			},
		},
		orderBy: {
			createdAt: "desc",
		},
	});

	return updates;
};

const updateComplaint = async (
	id: string,
	payload: IUpdateComplaint,
	actor: IAuthActor,
) => {
	const complaint = await findComplaintOrThrow(id, actor);

	if (actor.role === Role.CITIZEN) {
		const editable: ComplaintStatus[] = [
			ComplaintStatus.SUBMITTED,
			ComplaintStatus.UNDER_REVIEW,
		];
		if (!editable.includes(complaint.status)) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Complaint can only be edited while in ${editable.join(" or ")} state`,
			);
		}
	}

	const result = await prisma.complaint.update({
		where: { id },
		data: {
			...(payload.title !== undefined && { title: payload.title }),
			...(payload.description !== undefined && {
				description: payload.description,
			}),
			...(payload.address !== undefined && { address: payload.address }),
			...(payload.latitude !== undefined && { latitude: payload.latitude }),
			...(payload.longitude !== undefined && { longitude: payload.longitude }),
			...(payload.priority !== undefined && { priority: payload.priority }),
		},
		include: complaintDetailInclude,
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_UPDATED",
		entityType: "COMPLAINT",
		entityId: id,
		metadata: { payload },
	});

	return attachSla(result);
};

const deleteComplaint = async (id: string, actor: IAuthActor) => {
	const complaint = await findComplaintOrThrow(id, actor);

	if (actor.role === Role.CITIZEN) {
		if (!CANCELLABLE_STATUSES.includes(complaint.status)) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Only active complaints can be deleted",
			);
		}

		const activePayment = await prisma.payment.findFirst({
			where: {
				complaintId: id,
				status: { in: ["PENDING", "PAID"] },
			},
		});

		if (activePayment) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Complaint has an active payment. Cancel or refund it before deleting.",
			);
		}
	}

	const result = await prisma.complaint.update({
		where: { id },
		data: {
			deletedAt: new Date(),
		},
		include: complaintDetailInclude,
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_DELETED",
		entityType: "COMPLAINT",
		entityId: id,
	});

	return attachSla(result);
};

const resolveStatusSideEffects = async (
	tx: Prisma.TransactionClient,
	complaintId: string,
	technicianId: string | null,
) => {
	if (technicianId) {
		await tx.complaintAssignment.updateMany({
			where: {
				complaintId,
				technicianId,
				status: { in: ["PENDING", "ACCEPTED"] },
			},
			data: {
				status: "COMPLETED",
				completedAt: new Date(),
			},
		});

		await tx.technician.updateMany({
			where: {
				userId: technicianId,
			},
			data: {
				availability: TechAvailability.AVAILABLE,
			},
		});
	}
};

const changeStatus = async (
	id: string,
	actor: IAuthActor,
	payload: { status: ComplaintStatus; note?: string },
) => {
	const complaint = await prisma.complaint.findFirst({
		where: { id, deletedAt: null },
		include: complaintDetailInclude,
	});

	if (!complaint) {
		throw new AppError(httpStatus.NOT_FOUND, "Complaint not found");
	}

	const currentStatus = complaint.status;

	let allowed: ComplaintStatus[];
	if (actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN) {
		allowed = ACCEPTED_TRANSITIONS[currentStatus];
	} else if (actor.role === Role.TECHNICIAN) {
		if (complaint.assignedTechnicianId !== actor.userId) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You are not assigned to this complaint",
			);
		}
		allowed = TECHNICIAN_TRANSITIONS[currentStatus];
	} else {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You cannot change complaint status",
		);
	}

	if (!allowed.includes(payload.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Invalid status transition from ${currentStatus} to ${payload.status}`,
		);
	}

	const result = await prisma.$transaction(async (tx) => {
		const resolvedAt =
			payload.status === ComplaintStatus.RESOLVED ? new Date() : undefined;

		const updated = await tx.complaint.update({
			where: { id },
			data: {
				status: payload.status,
				...(resolvedAt && { resolvedAt }),
			},
			include: complaintDetailInclude,
		});

		await tx.complaintUpdate.create({
			data: {
				complaintId: id,
				updatedById: actor.userId,
				message:
					payload.note ??
					`Status changed from ${currentStatus} to ${payload.status}`,
				status: payload.status,
			},
		});

		if (payload.status === ComplaintStatus.RESOLVED) {
			await resolveStatusSideEffects(tx, id, updated.assignedTechnicianId);
		}

		return updated;
	});

	if (payload.status === ComplaintStatus.RESOLVED) {
		await createNotification({
			userId: complaint.citizenId,
			title: "Complaint resolved",
			message: `Your complaint "${complaint.title}" has been resolved.`,
			type: NotificationType.COMPLAINT_RESOLVED,
			complaintId: id,
		});
	}

	if (payload.status === ComplaintStatus.REJECTED) {
		await createNotification({
			userId: complaint.citizenId,
			title: "Complaint rejected",
			message: `Your complaint "${complaint.title}" was rejected.`,
			type: NotificationType.COMPLAINT_REJECTED,
			complaintId: id,
		});
	}

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_STATUS_CHANGED",
		entityType: "COMPLAINT",
		entityId: id,
		metadata: {
			from: currentStatus,
			to: payload.status,
		},
	});

	return attachSla(result);
};

const assignTechnician = async (
	id: string,
	actor: IAuthActor,
	payload: IAssignTechnicianPayload,
) => {
	const complaint = await prisma.complaint.findFirst({
		where: { id, deletedAt: null },
	});

	if (!complaint) {
		throw new AppError(httpStatus.NOT_FOUND, "Complaint not found");
	}

	const terminalStatuses: ComplaintStatus[] = [
		ComplaintStatus.CLOSED,
		ComplaintStatus.CANCELLED,
		ComplaintStatus.REJECTED,
		ComplaintStatus.RESOLVED,
	];

	if (terminalStatuses.includes(complaint.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Cannot assign a technician to a completed complaint",
		);
	}

	const technician = await prisma.user.findFirst({
		where: {
			id: payload.technicianId,
			role: Role.TECHNICIAN,
			isDeleted: false,
		},
		include: {
			technician: true,
		},
	});

	if (!technician) {
		throw new AppError(httpStatus.NOT_FOUND, "Technician not found");
	}

	if (
		complaint.departmentId &&
		technician.departmentId &&
		complaint.departmentId !== technician.departmentId
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Technician does not belong to the complaint's department",
		);
	}

	const result = await prisma.$transaction(async (tx) => {
		await tx.complaintAssignment.updateMany({
			where: {
				complaintId: id,
				status: "PENDING",
			},
			data: {
				status: "REJECTED",
			},
		});

		const assignment = await tx.complaintAssignment.create({
			data: {
				complaintId: id,
				technicianId: payload.technicianId,
			},
		});

		const updated = await tx.complaint.update({
			where: { id },
			data: {
				assignedTechnicianId: payload.technicianId,
				status: ComplaintStatus.ASSIGNED,
			},
			include: complaintDetailInclude,
		});

		await tx.technician.update({
			where: {
				userId: payload.technicianId,
			},
			data: {
				availability: TechAvailability.BUSY,
			},
		});

		return { assignment, updated };
	});

	await createNotification({
		userId: payload.technicianId,
		title: "New complaint assigned",
		message: `You have been assigned complaint "${complaint.title}".`,
		type: NotificationType.COMPLAINT_ASSIGNED,
		complaintId: id,
	});

	await createNotification({
		userId: complaint.citizenId,
		title: "Complaint assigned",
		message: `Complaint "${complaint.title}" was assigned to ${technician.name}.`,
		type: NotificationType.COMPLAINT_ASSIGNED,
		complaintId: id,
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_ASSIGNED",
		entityType: "COMPLAINT",
		entityId: id,
		metadata: {
			technicianId: payload.technicianId,
		},
	});

	return attachSla(result.updated);
};

const acceptAssignment = async (id: string, actor: IAuthActor) => {
	const complaint = await prisma.complaint.findFirst({
		where: { id, deletedAt: null },
	});

	if (!complaint) {
		throw new AppError(httpStatus.NOT_FOUND, "Complaint not found");
	}

	if (complaint.assignedTechnicianId !== actor.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"This complaint is not assigned to you",
		);
	}

	if (complaint.status !== ComplaintStatus.ASSIGNED) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Complaint is not in ASSIGNED state",
		);
	}

	const result = await prisma.$transaction(async (tx) => {
		const updated = await tx.complaint.update({
			where: { id },
			data: {
				status: ComplaintStatus.IN_PROGRESS,
			},
			include: complaintDetailInclude,
		});

		await tx.complaintUpdate.create({
			data: {
				complaintId: id,
				updatedById: actor.userId,
				message: `Assignment accepted by ${actor.name ?? actor.userId}`,
				status: ComplaintStatus.IN_PROGRESS,
			},
		});

		await tx.complaintAssignment.updateMany({
			where: {
				complaintId: id,
				technicianId: actor.userId,
				status: "PENDING",
			},
			data: {
				status: "ACCEPTED",
				acceptedAt: new Date(),
			},
		});

		return updated;
	});

	await createNotification({
		userId: complaint.citizenId,
		title: "Complaint in progress",
		message: `Technician has started work on "${complaint.title}".`,
		type: NotificationType.STATUS_CHANGED,
		complaintId: id,
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_ACCEPTED",
		entityType: "COMPLAINT",
		entityId: id,
	});

	return attachSla(result);
};

const cancelComplaint = async (id: string, actor: IAuthActor) => {
	const complaint = await findComplaintOrThrow(id, actor);

	if (actor.role === Role.CITIZEN && complaint.citizenId !== actor.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only cancel your own complaints",
		);
	}

	if (!CANCELLABLE_STATUSES.includes(complaint.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Complaint can no longer be cancelled in its current state",
		);
	}

	const result = await prisma.$transaction(async (tx) => {
		const updated = await tx.complaint.update({
			where: { id },
			data: {
				status: ComplaintStatus.CANCELLED,
			},
			include: complaintDetailInclude,
		});

		if (updated.assignedTechnicianId) {
			await tx.complaintAssignment.updateMany({
				where: {
					complaintId: id,
					status: { in: ["PENDING", "ACCEPTED"] },
				},
				data: {
					status: "REJECTED",
				},
			});

			await tx.technician.updateMany({
				where: {
					userId: updated.assignedTechnicianId,
				},
				data: {
					availability: TechAvailability.AVAILABLE,
				},
			});
		}

		return updated;
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_CANCELLED",
		entityType: "COMPLAINT",
		entityId: id,
		metadata: { byRole: actor.role },
	});

	return attachSla(result);
};

const addNote = async (
	id: string,
	actor: IAuthActor,
	payload: IAddNotePayload,
) => {
	const complaint = await findComplaintOrThrow(id, actor);

	if (
		actor.role === Role.TECHNICIAN &&
		complaint.assignedTechnicianId !== actor.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not assigned to this complaint",
		);
	}

	const result = await prisma.complaintUpdate.create({
		data: {
			complaintId: id,
			updatedById: actor.userId,
			message: payload.message,
			status: payload.status as ComplaintStatus | undefined,
		},
		include: {
			updatedBy: {
				omit: {
					password: true,
				} as const,
			},
		},
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_NOTE_ADDED",
		entityType: "COMPLAINT",
		entityId: id,
	});

	return result;
};

const addAttachments = async (
	id: string,
	actor: IAuthActor,
	files: Express.Multer.File[],
) => {
	const complaint = await findComplaintOrThrow(id, actor);

	if (files.length === 0) {
		throw new AppError(httpStatus.BAD_REQUEST, "No files provided");
	}

	if (
		actor.role === Role.TECHNICIAN &&
		complaint.assignedTechnicianId !== actor.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not assigned to this complaint",
		);
	}

	const uploaded = await uploadFilesToCloudinary(files);

	const attachments = await prisma.complaintAttachment.createMany({
		data: uploaded.map((file) => ({
			...file,
			complaintId: id,
		})),
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "COMPLAINT_ATTACHMENT_ADDED",
		entityType: "COMPLAINT",
		entityId: id,
		metadata: { count: uploaded.length },
	});

	return {
		count: attachments.count,
		attachments: uploaded,
	};
};

export const ComplaintServices = {
	createComplaint,
	getAllComplaints,
	getMyComplaints,
	getMyAssignedComplaints,
	getComplaintById,
	getComplaintUpdates,
	updateComplaint,
	deleteComplaint,
	changeStatus,
	assignTechnician,
	acceptAssignment,
	cancelComplaint,
	addNote,
	addAttachments,
};
