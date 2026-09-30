import type { Priority } from "../../../generated/prisma/enums";

export interface ICreateComplaint {
	title: string;
	description: string;
	address: string;
	latitude?: number;
	longitude?: number;
	priority?: Priority;
	categoryId: string;
}

export interface IUpdateComplaint {
	title?: string;
	description?: string;
	address?: string;
	latitude?: number;
	longitude?: number;
	priority?: Priority;
}

export interface IAssignTechnicianPayload {
	technicianId: string;
}

export interface IAddNotePayload {
	message: string;
	status?: string;
}
