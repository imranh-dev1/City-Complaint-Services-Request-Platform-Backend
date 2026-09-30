import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { upload } from "../../lib/multer";
import { ComplaintController } from "./complaint.controller";
import { Role } from "../../../generated/prisma/enums";
import {
	addNoteValidation,
	assignTechnicianValidation,
	changeComplaintStatusValidation,
	updateComplaintValidation,
} from "./complaint.validation";

const router = Router();

router.use(auth(Role.ADMIN, Role.SUPER_ADMIN, Role.CITIZEN, Role.TECHNICIAN));

router.post(
	"/",
	auth(Role.CITIZEN, Role.ADMIN, Role.SUPER_ADMIN),
	upload.array("images", 5),
	ComplaintController.createComplaint,
);

router.get(
	"/my-complaints",
	auth(Role.CITIZEN),
	ComplaintController.getMyComplaints,
);

router.get(
	"/my-assigned",
	auth(Role.TECHNICIAN),
	ComplaintController.getMyAssignedComplaints,
);

router.get("/search", ComplaintController.searchComplaints);

router.get("/", ComplaintController.getAllComplaints);

router.get("/:id/updates", ComplaintController.getComplaintUpdates);

router.get("/:id", ComplaintController.getComplaintById);

router.patch(
	"/:id",
	validateRequest(updateComplaintValidation),
	ComplaintController.updateComplaint,
);

router.delete("/:id", ComplaintController.deleteComplaint);

router.patch(
	"/:id/status",
	validateRequest(changeComplaintStatusValidation),
	ComplaintController.changeComplaintStatus,
);

router.post(
	"/:id/assign",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(assignTechnicianValidation),
	ComplaintController.assignTechnician,
);

router.post(
	"/:id/accept",
	auth(Role.TECHNICIAN),
	ComplaintController.acceptAssignment,
);

router.post("/:id/cancel", ComplaintController.cancelComplaint);

router.post(
	"/:id/notes",
	validateRequest(addNoteValidation),
	ComplaintController.addNote,
);

router.post(
	"/:id/attachments",
	upload.array("images", 5),
	ComplaintController.addAttachments,
);

export const ComplaintRoutes = router;
