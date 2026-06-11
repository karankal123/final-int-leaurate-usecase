import {
  getWorkflowSchema,
  initiateJob,
  executeJob,
  getJobStatus,
  getJobResult,
} from "./opusApiService.js";
import { logInfo, logError } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

const buildPayloadInstance = (schema, inputData) => {
  const instance = {};

  for (const [key, field] of Object.entries(schema)) {
    instance[key] = {
      ...field,
      value: inputData[key] !== undefined ? inputData[key] : field.value,
    };
  }

  return instance;
};


export const fetchWorkflowSchema = async () => {
  try {
    const workflowData = await getWorkflowSchema();

    return {
      workflowId: workflowData.workflowId,
      name: workflowData.name,
      description: workflowData.description,
      industry: workflowData.industry,
      active: workflowData.active,
      jobPayloadSchema: workflowData.jobPayloadSchema,
      jobResultsPayloadSchema: workflowData.jobResultsPayloadSchema,
      executionEstimation: workflowData.executionEstimation,
    };
  } catch (error) {
    logError("Failed to fetch workflow schema", error);
    throw error;
  }
};


export const prepareLanguageDetectionJob = async ({
  title,
  description,
}) => {
  try {
    logInfo("Preparing language detection job", { title });

    const workflowData = await getWorkflowSchema();

    const initiationResponse = await initiateJob(
      undefined,
      title,
      description
    );

    return {
      jobExecutionId: initiationResponse.jobExecutionId,
      workflowId: workflowData.workflowId,
      workflowName: workflowData.name,
      jobPayloadSchema: workflowData.jobPayloadSchema,
      jobResultsPayloadSchema: workflowData.jobResultsPayloadSchema,
    };
  } catch (error) {
    logError("Prepare language detection job failed", error);
    throw error;
  }
};


export const runJob = async ({
  jobId,
  jobName,
  jobDescription,
  inputData,
}) => {
  let jobExecutionId;

  try {
    logInfo("Starting job execution", { jobId, jobName });

    const workflowData = await getWorkflowSchema();
    const payloadInstance = buildPayloadInstance(
      workflowData.jobPayloadSchema,
      inputData
    );

    const initiationResponse = await initiateJob(
      undefined,
      `${jobName} - Auto Execution`,
      jobDescription
    );

    jobExecutionId = initiationResponse.jobExecutionId;


    const executeResult = await executeJob(
      jobExecutionId,
      payloadInstance
    );

    const status = await monitorJob(jobExecutionId);


    const result = await getJobResult(jobExecutionId);

    return {
      jobExecutionId,
      executeResult,
      status,
      result,
    };
  } catch (error) {
    logError("Error executing job", {
      jobId,
      jobExecutionId,
      error: error.message,
    });
    throw error;
  }
};


const monitorJob = async (jobExecutionId) => {
  let attempts = 0;
  const maxAttempts = 50;
  let status = "PENDING";

  while (
    ["PENDING", "IN_PROGRESS"].includes(status) &&
    attempts < maxAttempts
  ) {
    await new Promise((r) => setTimeout(r, 10000));

    const result = await getJobStatus(jobExecutionId);
    status = result.status;
    attempts++;

    logInfo(`Status check ${attempts}`, {
      jobExecutionId,
      status,
    });
  }

  if (status !== "COMPLETED") {
    throw new Error(
      `Job failed or timed out. Last status: ${status}, executionId: ${jobExecutionId}`
    );
  }

  return status;
};
