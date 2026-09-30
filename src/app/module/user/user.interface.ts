export interface ICitizenProfileUpdate {
    nid?: string;
    address?: string;
    wardNo?: string;
    area?: string;
}

export interface IUserProfileUpdate {
    name?: string;
    phone?: string | null;
    citizen?: ICitizenProfileUpdate;
}