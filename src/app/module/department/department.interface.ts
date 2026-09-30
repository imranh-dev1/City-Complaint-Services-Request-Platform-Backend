export interface ICreateDepartment {
    name: string;
    code: string;
    description?: string;
}

export interface IUpdateDepartment {
    name?: string;
    code?: string;
    description?: string;
    isActive?: boolean;
}