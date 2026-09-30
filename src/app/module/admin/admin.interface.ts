export interface IUpdateUserStatusPayload {
	status: "ACTIVE" | "BLOCKED" | "DELETED";
}

export interface IUpdateUserRolePayload {
	role: "CITIZEN" | "TECHNICIAN" | "ADMIN" | "SUPER_ADMIN";
}

export interface IAssignDepartmentPayload {
	departmentId: string;
}
