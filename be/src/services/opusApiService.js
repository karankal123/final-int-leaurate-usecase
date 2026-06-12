import axios from "axios";
import https from "node:https";
import { logInfo, logError } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

const baseURL = process.env.OPUS_BASE_URL;
const apiKey = process.env.OPUS_API_KEY;
const DEFAULT_WORKFLOW_ID = process.env.WORKFLOW_ID_PRIMARY;
const allowSelfSignedCerts =
  String(process.env.OPUS_ALLOW_SELF_SIGNED_CERTS || "").toLowerCase() === "true";

const opusClient = axios.create({
  baseURL,
  headers: {
    "x-service-key": apiKey,
    "Content-Type": "application/json",
  },
  ...(allowSelfSignedCerts
    ? {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    : {}),
});

export const getWorkflowSchema = async (
  workflowId = DEFAULT_WORKFLOW_ID
) => {
  try {
    logInfo("Fetching workflow schema from Opus", { workflowId });

    const res = await opusClient.get(`/workflow/${workflowId}`);
    return res.data;
  } catch (error) {
    logError("Failed to fetch workflow schema", {
      workflowId,
      error: error.response?.data || error.message,
    });
    throw new Error("Unable to retrieve workflow schema from Opus");
  }
};

export const initiateJob = async (
  workflowId = DEFAULT_WORKFLOW_ID,
  title,
  description
) => {
  try {
    logInfo("Initiating Opus job execution", { workflowId });

    const res = await opusClient.post(`/job/initiate`, {
      workflowId,
      title,
      description
    });

    return res.data;
  } catch (error) {
    logError("Failed to initiate job", {
      workflowId,
      error: error.response?.data || error.message,
    });
    throw new Error("Job initiation failed");
  }
};

export const executeJob = async (
  jobExecutionId,
  jobPayloadSchemaInstance
) => {
  try {
    logInfo("Executing Opus job", { jobExecutionId });

    const res = await opusClient.post(`/job/execute`, {
      jobExecutionId,
      jobPayloadSchemaInstance,
      // callbackUrl: "https://your-webhook-url.com/opus",
    });

    return res.data;
  } catch (error) {
    logError("Failed to execute job", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Job execution failed");
  }
};

export const getJobStatus = async (jobExecutionId) => {
  try {
    const res = await opusClient.get(
      `/job/${jobExecutionId}/status`
    );
    return res.data;
  } catch (error) {
    logError("Failed to get job status", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Status check failed");
  }
};

export const getJobResult = async (jobExecutionId) => {
  try {
    const res = await opusClient.get(
      `/job/${jobExecutionId}/results`
    );
    return res.data;
  } catch (error) {
    logError("Failed to get job results", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Result retrieval failed");
  }
};

export const getJobAudit = async (jobExecutionId) => {
  try {
    const res = await opusClient.get(
      `/job/${jobExecutionId}/audit`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );
    return res.data;
  } catch (error) {
    logError("Failed to get job audit", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Audit retrieval failed");
  }
};

export const getPresignedUrl = async (fileExtension = "pdf") => {
  try {
    const res = await opusClient.post(
      `/job/file/upload`,
      {
        fileExtension,
        accessScope: "all"
      }
    );
    return res.data;
  } catch (error) {
    const raw = error.response?.data || error.message;
    const rawText = typeof raw === "string" ? raw : JSON.stringify(raw);
    logError("Failed to get presigned url", {
      error: raw,
    });
    if (rawText.includes("Corporate Internet policy violation")) {
      throw new Error("OPUS request blocked by corporate internet policy. Ask network team to allow OPUS_BASE_URL.");
    }
    if (rawText.includes("self-signed certificate")) {
      throw new Error("TLS validation failed for OPUS endpoint. Set OPUS_ALLOW_SELF_SIGNED_CERTS=true for this environment.");
    }
    throw new Error("Presigned URL retrieval failed");
  }
};

