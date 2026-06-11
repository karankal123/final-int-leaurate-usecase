import express from "express";
import {
  getPendingOffPlatformReviewController,
  getOffPlatformReviewDetailController,
  getLatestScreeningResultController,
  getInboxController,
  getCaseStatusController,
  getOffPlatformReviewAuditController,
  streamCaseUpdatesController,
  streamInboxUpdatesController,
  offPlatformReviewWebhookController,
  triggerScreeningController,
  submitHumanDecisionController,
  resetJobsController,
  cleanupSyntheticOffPlatformJobsController,
  renameStudentDocumentsController,
} from "../controllers/uiCompatController.js";

const router = express.Router();

router.get("/inbox", getInboxController);
router.get("/inbox/stream", streamInboxUpdatesController);
router.get("/case-status/:studentId", getCaseStatusController);
router.get("/case-screening/:studentId", getLatestScreeningResultController);
router.get("/case-updates/:studentId/stream", streamCaseUpdatesController);
router.get("/opus/off-platform-review/audit", getOffPlatformReviewAuditController);
router.get("/opus/off-platform-review/pending", getPendingOffPlatformReviewController);
router.get("/opus/off-platform-review/:threadId", getOffPlatformReviewDetailController);
router.post("/opus/off-platform-review/webhook", offPlatformReviewWebhookController);
router.post("/opus/off-platform-review/:threadId/submit", submitHumanDecisionController);
router.post("/trigger-screening/:studentId", triggerScreeningController);
router.post("/human-decision/:threadId", submitHumanDecisionController);
router.post("/reset", resetJobsController);
router.post("/opus/off-platform-review/cleanup-synthetic", cleanupSyntheticOffPlatformJobsController);

/* ── Document Rename Routes ─────────────────────────────────────────────────── */
router.post("/rename/student", renameStudentDocumentsController);

export default router;
