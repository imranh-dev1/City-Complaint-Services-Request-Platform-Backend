export interface ICategory {
	name: string;
	description?: string;
}

export interface ICreateCategory {
	name: string;
	description?: string;
	slaHours?: number;
	departmentId: string;
}

export interface IUpdateCategory {
	name?: string;
	description?: string;
	isActive?: boolean;
	slaHours?: number;
	departmentId?: string;
}
