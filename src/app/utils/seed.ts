import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { prisma } from "../lib/prisma";
import { AppError } from "./AppError";

import config from "../config";
import { Role, TechAvailability } from "../../generated/prisma/enums";

export const seedSuperAdmin = async () => {
	try {
		const isSuperAdminExist = await prisma.user.findFirst({
			where: {
				role: Role.SUPER_ADMIN,
			},
		});

		if (isSuperAdminExist) {
			console.log("Super Admin Already Exists!");
			return;
		}

		const name = config.super_admin_name;
		const email = config.super_admin_email;
		const password = config.super_admin_password;

		if (!name || !email || !password) {
			throw new AppError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"Super Admin Name , Email, Password Missing In Env File!!!",
			);
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const superAdmin = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.SUPER_ADMIN,
				needPasswordChange: false,
				emailVerified: true,
			},
		});

		console.log("Super Admin Created : ", superAdmin);
	} catch (error) {
		console.log("Error Seeding Super Admin : ", error);
	}
};
export const seedTesterAdmin = async () => {
	try {
		const isTesterAdminExist = await prisma.user.findFirst({
			where: {
				email: config.tester_admin_email,
			},
		});

		if (isTesterAdminExist) {
			console.log("Tester Admin Already Exists!");
			return;
		}

		const name = config.tester_admin_name;
		const email = config.tester_admin_email;
		const password = config.tester_admin_password;

		if (!name || !email || !password) {
			throw new AppError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"Tester Admin Name , Email, Password Missing In Env File!!!",
			);
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const testerAdmin = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.ADMIN,
				needPasswordChange: false,
				emailVerified: true,
			},
		});

		console.log("Tester Admin Created : ", testerAdmin);
	} catch (error) {
		console.log("Error Seeding Tester Admin : ", error);
	}
};

export const seedTesterCitizen = async () => {
	try {
		const isTesterCitizenExist = await prisma.user.findFirst({
			where: {
				email: config.tester_citizen_email,
			},
		});

		if (isTesterCitizenExist) {
			console.log("Tester Citizen Already Exists!");
			return;
		}

		const name = config.tester_citizen_name;
		const email = config.tester_citizen_email;
		const password = config.tester_citizen_password;

		if (!name || !email || !password) {
			throw new AppError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"Tester Citizen Name , Email, Password Missing In Env File!!!",
			);
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const testerCitizen = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.CITIZEN,
				needPasswordChange: false,
				emailVerified: true,
			},
		});

		console.log("Tester Citizen Created : ", testerCitizen);
	} catch (error) {
		console.log("Error Seeding Tester Citizen : ", error);
	}
};
export const seedTesterTechnician = async () => {
	try {
		const isTesterTechnicianExist = await prisma.user.findFirst({
			where: {
				email: config.tester_technician_email,
			},
		});

		if (isTesterTechnicianExist) {
			console.log("Tester Technician Already Exists!");
			return;
		}

		const name = config.tester_technician_name;
		const email = config.tester_technician_email;
		const password = config.tester_technician_password;

		if (!name || !email || !password) {
			throw new AppError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"Tester Technician Name , Email, Password Missing In Env File!!!",
			);
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds),
		);

		const testerTechnician = await prisma.user.create({
			data: {
				name,
				email,
				password: hashedPassword,
				role: Role.TECHNICIAN,
				needPasswordChange: false,
				emailVerified: true,
				technician: {
					create: {
						specialization: "Electrical",
						experience: 5,
						bio: "Expert urban service electrician specialized in city infrastructures.",
						rating: 4.5,
						totalJobs: 12,
						availability: TechAvailability.AVAILABLE,
						isVerified: true,
						serviceRadius: 15,
						hourlyRate: 25.0,
					},
				},
			},
		});

		console.log("Tester Technician Created : ", testerTechnician);
	} catch (error) {
		console.log("Error Seeding Tester Technician : ", error);
	}
};

// export const seedDepartmentsAndCategories = async () => {
// 	const departments = [
// 		{
// 			name: "Road & Transport",
// 			code: "ROAD",
// 			description:
// 				"Handles road damage, footpath issues and public transport problems.",
// 			categories: [
// 				{
// 					name: "Road Damage",
// 					description: "Potholes, cracks and damaged road surfaces.",
// 					slaHours: 72,
// 				},
// 				{
// 					name: "Footpath Repair",
// 					description: "Broken or obstructed footpaths.",
// 					slaHours: 120,
// 				},
// 			],
// 		},
// 		{
// 			name: "Waste Management",
// 			code: "WASTE",
// 			description: "Garbage collection, dumping and cleanliness issues.",
// 			categories: [
// 				{
// 					name: "Garbage Collection",
// 					description: "Missed or irregular waste collection.",
// 					slaHours: 48,
// 				},
// 				{
// 					name: "Drainage Cleaning",
// 					description: "Blocked or overflowing drains.",
// 					slaHours: 48,
// 				},
// 			],
// 		},
// 		{
// 			name: "Water & Sewerage",
// 			code: "WATER",
// 			description: "Water supply, leakage and sewerage problems.",
// 			categories: [
// 				{
// 					name: "Water Supply",
// 					description: "No water or low pressure supply.",
// 					slaHours: 48,
// 				},
// 				{
// 					name: "Sewerage",
// 					description: "Blocked sewer lines and overflow.",
// 					slaHours: 72,
// 				},
// 			],
// 		},
// 		{
// 			name: "Electricity",
// 			code: "ELEC",
// 			description: "Street lighting and electrical infrastructure complaints.",
// 			categories: [
// 				{
// 					name: "Street Light",
// 					description: "Faulty or damaged street lights.",
// 					slaHours: 48,
// 				},
// 				{
// 					name: "Power Outage",
// 					description: "Localized power failures.",
// 					slaHours: 24,
// 				},
// 			],
// 		},
// 		{
// 			name: "Public Health",
// 			code: "HEALTH",
// 			description: "Public health and sanitation issues.",
// 			categories: [
// 				{
// 					name: "Public Health",
// 					description: "Health hazards and sanitation problems.",
// 					slaHours: 96,
// 				},
// 			],
// 		},
// 	];

// 	for (const dept of departments) {
// 		const existingDept = await prisma.department.findUnique({
// 			where: { code: dept.code },
// 		});

// 		const department =
// 			existingDept ??
// 			(await prisma.department.create({
// 				data: {
// 					name: dept.name,
// 					code: dept.code,
// 					description: dept.description,
// 				},
// 			}));

// 		if (existingDept) {
// 			console.log(`Department Already Exists: ${dept.code}`);
// 		} else {
// 			console.log("Department Created : ", department.code);
// 		}

// 		for (const category of dept.categories) {
// 			const existingCategory = await prisma.category.findUnique({
// 				where: { name: category.name },
// 			});

// 			if (existingCategory) {
// 				console.log(`Category Already Exists: ${category.name}`);
// 				continue;
// 			}

// 			const created = await prisma.category.create({
// 				data: {
// 					name: category.name,
// 					description: category.description,
// 					slaHours: category.slaHours,
// 					departmentId: department.id,
// 				},
// 			});

// 			console.log("Category Created : ", created.name);
// 		}
// 	}
// };
