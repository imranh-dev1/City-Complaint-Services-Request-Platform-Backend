import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { AppError } from "../../utils/AppError";
import { sendResponse } from "../../utils/sendResponse";
import { ComplaintServices } from "./complaint.service";
import { createComplaintValidation } from "./complaint.validation";
import type { IAuthActor } from "./complaint.service";
import type { Role } from "../../../generated/prisma/enums";

const getActor = (req: Request): IAuthActor => ({
	userId: req.user?.userId as string,
	role: req.user?.role as Role,
	name: req.user?.name,
	email: req.user?.email,
});

const parseCreatePayload = (req: Request) => {
	const raw = req.body?.complaintPayload ?? req.body;

	if (typeof raw === "string") {
		try {
			return JSON.parse(raw);
		} catch {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Invalid complaint payload JSON",
			);
		}
	}

	return raw;
};

const createComplaint = catchAsync(async (req: Request, res: Response) => {
	const rawPayload = parseCreatePayload(req);
	const parsed = createComplaintValidation.safeParse(rawPayload);

	if (!parsed.success) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			parsed.error.issues[0]?.message ?? "Complaint validation failed",
		);
	}

	const files = (req.files as Express.Multer.File[]) ?? [];

	const result = await ComplaintServices.createComplaint(
		parsed.data,
		req.user?.userId as string,
		files,
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.CREATED,
		message: "Complaint created successfully",
		data: result,
	});
});

const getAllComplaints = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.getAllComplaints(
		req.query as Record<string, unknown>,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Complaints retrieved successfully",
		data: result.data,
		meta: result.meta,
	});
});

const getMyComplaints = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.getMyComplaints(
		req.query as Record<string, unknown>,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "My complaints retrieved successfully",
		data: result.data,
		meta: result.meta,
	});
});

const getMyAssignedComplaints = catchAsync(
	async (req: Request, res: Response) => {
		const result = await ComplaintServices.getMyAssignedComplaints(
			req.query as Record<string, unknown>,
			getActor(req),
		);

		sendResponse(res, {
			success: true,
			statusCode: httpStatus.OK,
			message: "My assigned complaints retrieved successfully",
			data: result.data,
			meta: result.meta,
		});
	},
);

const searchComplaints = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.getAllComplaints(
		{ ...(req.query as Record<string, unknown>), search: req.query.q },
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Complaints search completed",
		data: result.data,
		meta: result.meta,
	});
});

const getComplaintById = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.getComplaintById(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Complaint retrieved successfully",
		data: result,
	});
});

const getComplaintUpdates = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.getComplaintUpdates(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Complaint updates retrieved successfully",
		data: result,
	});
});

const updateComplaint = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.updateComplaint(
		req.params.id as string,
		req.body,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Complaint updated successfully",
		data: result,
	});
});

const deleteComplaint = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.deleteComplaint(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Complaint deleted successfully",
		data: result,
	});
});

const changeComplaintStatus = catchAsync(
	async (req: Request, res: Response) => {
		const result = await ComplaintServices.changeStatus(
			req.params.id as string,
			getActor(req),
			req.body,
		);

		sendResponse(res, {
			success: true,
			statusCode: httpStatus.OK,
			message: "Complaint status changed successfully",
			data: result,
		});
	},
);

const assignTechnician = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.assignTechnician(
		req.params.id as string,
		getActor(req),
		req.body,
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Technician assigned successfully",
		data: result,
	});
});

const acceptAssignment = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.acceptAssignment(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Assignment accepted. Complaint is now IN_PROGRESS.",
		data: result,
	});
});

const cancelComplaint = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.cancelComplaint(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Complaint cancelled successfully",
		data: result,
	});
});

const addNote = catchAsync(async (req: Request, res: Response) => {
	const result = await ComplaintServices.addNote(
		req.params.id as string,
		getActor(req),
		req.body,
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Note added successfully",
		data: result,
	});
});

const addAttachments = catchAsync(async (req: Request, res: Response) => {
	const files = (req.files as Express.Multer.File[]) ?? [];

	const result = await ComplaintServices.addAttachments(
		req.params.id as string,
		getActor(req),
		files,
	);

	sendResponse(res, {
		success: true,
		statusCode: httpStatus.OK,
		message: "Attachments uploaded successfully",
		data: result,
	});
});

export const ComplaintController = {
	createComplaint,
	getAllComplaints,
	getMyComplaints,
	getMyAssignedComplaints,
	searchComplaints,
	getComplaintById,
	getComplaintUpdates,
	updateComplaint,
	deleteComplaint,
	changeComplaintStatus,
	assignTechnician,
	acceptAssignment,
	cancelComplaint,
	addNote,
	addAttachments,
};
