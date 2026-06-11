import express from "express";
import {
    executeSecondaryWorkflowController,
    executeWorkflowController,
    getAllJobsController,
  getJobAuditController,
    getJobResultController,
    getJobsByGroupIdController,
    getJobsForDashboardSectionController,
    getJobsForUploadSectionController,
    getPresignedUrlController,
    getPresignedUrlControllerOnlyUrl,
} from "../controllers/jobController.js";
import {upload} from "../middleware/upload.js";

const router = express.Router();

router.get("/jobs-by-group/:groupId", getJobsByGroupIdController);
router.get("/jobs-for-upload-section", getJobsForUploadSectionController);
router.get("/jobs-for-dashboard-section", getJobsForDashboardSectionController);
router.post("/execute-primary", executeWorkflowController);
router.post("/execute-secondary/:primaryJobId", executeSecondaryWorkflowController);
router.get("/list", getAllJobsController);
router.get("/:jobId/result", getJobResultController);
router.get("/:jobId/audit", getJobAuditController);

router.get("/presigned-url", getPresignedUrlControllerOnlyUrl)

router.post(
  "/upload-file",
  upload.single("file"), // field name = "file"
  getPresignedUrlController
);

export default router;
