import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchWorkflowSchema,
  prepareLanguageDetectionJob,
  runJob,
} from "../services/jobService.js";
import { logError, logInfo } from "../utils/logger.js";
import { executeJob, getJobAudit, getJobResult, getPresignedUrl, getWorkflowSchema, initiateJob } from "../services/opusApiService.js";
import dotenv from "dotenv";
import axios from "axios";
import {
  createJob,
  getAllJobs,
  getJobById,
  getJobsByGroupId,
  updateSecondaryJobByPrimaryJobId,
} from "../services/jobStore.js";
import { syncStatus } from "../jobs/statusSync.js";
import { mergeWorkflowOutputs } from "../utils/workflowOutputMerger.js";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFile = path.join(__dirname, "../../job_results.json");

const WORKFLOW_ID_PRIMARY = process.env.WORKFLOW_ID_PRIMARY;
const WORKFLOW_ID_SECONDARY = process.env.WORKFLOW_ID_SECONDARY;

const formatDate = (date) => {
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

export const getJobSchemaController = async (req, res) => {
  try {
    logInfo("Schema discovery request received");
    const schema = await fetchWorkflowSchema();
    res.status(200).json(schema);
  } catch (error) {
    logError("Schema discovery failed", error);
    res.status(500).json({
      message: "Failed to retrieve workflow schema",
      error: error.message,
    });
  }
};

const WORKFLOW_FILE_INPUT_ALIASES = [
  "crm_input_file",
  "fileUrl",
  "file_url",
  "input_file",
  "inputFile",
];

const WORKFLOW_STUDENT_ID_INPUT_ALIASES = [
  "studentId",
  "student_id",
  "student id",
  "studentID",
  "student_id_input",
];

const extractWorkflowInputSchema = (workflowData) => {
  if (
    workflowData?.jobPayloadSchema &&
    typeof workflowData.jobPayloadSchema === "object"
  ) {
    return workflowData.jobPayloadSchema;
  }

  const inputNodeId = workflowData?.workflow_input_node_id;
  const inputNode = inputNodeId ? workflowData?.nodes?.[inputNodeId] : null;
  const schemaFromNode =
    inputNode?.output_schema?.schema || inputNode?.input_schema?.schema;

  if (schemaFromNode && typeof schemaFromNode === "object") {
    return schemaFromNode;
  }

  return null;
};

const isFileLikeWorkflowField = (key, field = {}) => {
  const allowedTypes = Array.isArray(field.allowed_types)
    ? field.allowed_types
    : [];
  const tags = Array.isArray(field.tags) ? field.tags : [];
  const displayName = String(field.display_name || "").toLowerCase();
  const variableName = String(field.variable_name || key || "").toLowerCase();

  const hasFileType = allowedTypes.some((item) => item?.type === "file");
  const hasAllowedFileTag = tags.some(
    (tag) => tag?.variable_name === "allowed_file_types"
  );
  const nameLooksLikeFileField =
    displayName.includes("file") ||
    displayName.includes("data") ||
    variableName.includes("file") ||
    variableName.includes("data");

  return hasFileType || hasAllowedFileTag || nameLooksLikeFileField;
};

const getAliasedInputValue = (inputData = {}, aliases = []) => {
  for (const alias of aliases) {
    const value = inputData[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const isStudentIdWorkflowField = (key, field = {}) => {
  const displayName = String(field.display_name || "").toLowerCase();
  const variableName = String(field.variable_name || key || "").toLowerCase();

  return (
    displayName.includes("student id") ||
    displayName === "studentid" ||
    variableName.includes("student_id") ||
    variableName.includes("studentid")
  );
};

// Helper: build payload instance from schema
const buildPayloadInstance = (schema, inputData = {}) => {
  const instance = {};
  const aliasedFileValue = getAliasedInputValue(
    inputData,
    WORKFLOW_FILE_INPUT_ALIASES
  );
  const aliasedStudentIdValue = getAliasedInputValue(
    inputData,
    WORKFLOW_STUDENT_ID_INPUT_ALIASES
  );

  for (const [key, field] of Object.entries(schema)) {
    const normalizedField = field && typeof field === "object" ? field : {};

    let value = inputData[key];
    if (
      value === undefined &&
      aliasedFileValue &&
      isFileLikeWorkflowField(key, normalizedField)
    ) {
      value = aliasedFileValue;
    }
    if (
      value === undefined &&
      aliasedStudentIdValue &&
      isStudentIdWorkflowField(key, normalizedField)
    ) {
      value = aliasedStudentIdValue;
    }
    if (value === undefined) {
      value = normalizedField.value ?? normalizedField.default ?? null;
    }

    instance[key] = { ...normalizedField, value };
  }

  return instance;
};

export const executeWorkflowController = async (req, res) => {
  try {
    logInfo("Starting job execution", {});

    const studentId = getAliasedInputValue(
      req.body,
      WORKFLOW_STUDENT_ID_INPUT_ALIASES
    );

    if (!studentId) {
      return res.status(400).json({
        message: "Student ID is required.",
      });
    }

    // Step 1: Get schema
    const workflowData = await getWorkflowSchema(WORKFLOW_ID_PRIMARY);
    const schema = extractWorkflowInputSchema(workflowData);
    if (!schema) {
      throw new Error("Workflow input schema was not found in Opus response");
    }
    logInfo("Workflow schema response keys", { keys: Object.keys(workflowData) });

    const payloadInstance = buildPayloadInstance(schema, req.body);

    // Step 2: Initiate job
    const { jobExecutionId } = await initiateJob(
      WORKFLOW_ID_PRIMARY,
      `Auto Execution`,
      'Test Job'
    );
   
    const payload = {
      jobId: jobExecutionId,
      isSecondaryWorkflowExecuted: false,
      fileUrl: req.body['crm_input_file'] || null,
      fileName: req.body['fileName'] || null,
      studentId,
      groupId: req.body['groupId'] || null,
      status: 'IN PROGRESS',
      submittedAt: new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }),
    }
    await createJob(payload)
    // Step 3: Execute job
    const executeResult = await executeJob(jobExecutionId, payloadInstance);

    res.status(200).json({
      result: {
        ...executeResult,
        primaryJobId: jobExecutionId,
        primaryStatus: "IN PROGRESS",
        isExecuted: true,
      },
    })
  } catch (error) {
    logError("executeWorkflowController failed", error);
    res.status(500).json({ message: error.message || "Internal Server Error" });
  }
}


export const executeSecondaryWorkflowController = async (req, res) => {
  try {
    logInfo("Starting job execution 2", {});

    // Step 1: Get schema
    const workflowData = await getWorkflowSchema(WORKFLOW_ID_SECONDARY);
    const schema = extractWorkflowInputSchema(workflowData);
    if (!schema) {
      throw new Error("Workflow input schema was not found in Opus response");
    }
    const payloadInstance = buildPayloadInstance(schema, req.body);

    // Step 2: Initiate job
    const { jobExecutionId } = await initiateJob(
      WORKFLOW_ID_SECONDARY,
      `Auto Execution`,
      'Test Job'
    );

    const payload = {
      secondaryJobId: jobExecutionId,
      isSecondaryWorkflowExecuted: true,
      secondaryStatus: 'IN PROGRESS',
    }
   
    await updateSecondaryJobByPrimaryJobId(req.params.primaryJobId, payload)
    // Step 3: Execute job
    const executeResult = await executeJob(jobExecutionId, payloadInstance);

    res.status(200).json({ result: executeResult })
  } catch (error) {
    logError("executeSecondaryWorkflowController failed", error);
    res.status(500).json({ message: error.message || "Internal Server Error" });
  }
}

export const getPresignedUrlController = async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: "File is required" });
  }

  const fileExtension = file.originalname.split(".").pop().toLowerCase();
  const result = await getPresignedUrl(fileExtension);

  const { presignedUrl, fileUrl } = result;

  console.log({ type: file.mimetype, size: file.size })
  // 2️⃣ Upload file to S3 FROM BACKEND
  await axios.put(presignedUrl, file.buffer, {
    headers: {
      "Content-Type": file.mimetype,
      "Content-Length": file.size,
    },
  });


  // 3️⃣ Return final file URL
  return res.status(200).json({
    message: "File uploaded successfully",
    result: { fileUrl },
  });
}

export const prepareLanguageDetectionController = async (req, res) => {
  const { title, description } = req.body || {};

  if (!title || !description) {
    return res.status(400).json({
      message: "Missing required fields: title, description",
    });
  }

  try {
    logInfo("Prepare API called", { title });

    const response = await prepareLanguageDetectionJob({
      title,
      description,
    });

    res.status(201).json(response);
  } catch (error) {
    logError("Prepare API failed", error);
    res.status(500).json({
      message: "Failed to prepare language detection job",
      error: error.message,
    });
  }
};


export const executeJobController = async (req, res) => {
  const { jobId, jobName, jobDescription, inputData } = req.body;

  const startTime = new Date();
  let logEntry = {
    jobId,
    jobName,
    startTime: startTime.toISOString(),
    startTimeFormatted: formatDate(startTime),
    status: "PENDING",
  };

  if (!jobId || !jobName || !jobDescription) {
    return res.status(400).json({
      message: "Missing required job parameters",
    });
  }

  try {
    const result = await runJob({
      jobId,
      jobName,
      jobDescription,
      inputData,
    });

    const endTime = new Date();
    logEntry = {
      ...logEntry,
      endTime: endTime.toISOString(),
      endTimeFormatted: formatDate(endTime),
      durationMs: endTime - startTime,
      status: "SUCCESS",
      statusCode: 200,
    };

    await appendToLogFile(logEntry);

    res.status(200).json({
      message: "Job executed successfully",
      result,
    });
  } catch (error) {
    const endTime = new Date();
    logEntry = {
      ...logEntry,
      endTime: endTime.toISOString(),
      endTimeFormatted: formatDate(endTime),
      durationMs: endTime - startTime,
      status: "FAILED",
      statusCode: error?.response?.status || 500,
      errorMessage: error?.message || "Unknown Error",
    };

    await appendToLogFile(logEntry);
    logError("Job execution error", error);

    res.status(500).json({
      message: error.message || "Internal Server Error",
    });
  }
};


const appendToLogFile = async (entry) => {
  try {
    const existing = (await fs.pathExists(logFile))
      ? JSON.parse(await fs.readFile(logFile, "utf-8"))
      : [];

    existing.push(entry);
    await fs.writeFile(logFile, JSON.stringify(existing, null, 2));
  } catch (err) {
    logError("Error writing log file", err);
  }
};

export const getAllJobsController = async (req, res) => {
  await syncStatus()
  const jobs = getAllJobs()
  res.status(200).json({ result: jobs });
}


export const getJobResultController = async (req, res) => {
  const result = await getJobResult(req.params.jobId)
  
  // Extract key-value pairs from the Opus result
  const extracted = {};
  if (result?.jobResultsPayloadSchema) {
    for (const [key, obj] of Object.entries(result.jobResultsPayloadSchema)) {
      // Store by the workflow_output_* key
      extracted[key] = obj.value;
      
      // Also store by display_name so mergeWorkflowOutputs can find it
      if (obj?.display_name) {
        extracted[obj.display_name] = obj.value;
      }
      
      // Also store by variable_name if different from key
      if (obj?.variable_name && obj.variable_name !== key) {
        extracted[obj.variable_name] = obj.value;
      }
    }
  }
  
  // Apply workflow output merging for normalized field names
  const mergedOutputs = mergeWorkflowOutputs(extracted);
  
  res.status(200).json({ 
    result: result,
    mergedOutputs: mergedOutputs
  });
}

export const getJobAuditController = async (req, res) => {
  const buildLocalAuditFallback = (job) => {
    if (!job || typeof job !== "object") {
      return [];
    }

    const entries = [];

    if (Array.isArray(job.hitlAuditLog) && job.hitlAuditLog.length > 0) {
      for (const item of job.hitlAuditLog) {
        entries.push({
          agent_name: item?.type || "hitl_event",
          status: item?.callback_status || job.hitlStatus || job.status,
          timestamp: item?.at || null,
          response: item,
        });
      }
    }

    if (job.hitlNodeOutput && typeof job.hitlNodeOutput === "object") {
      entries.push({
        agent_name: "hitl_node_output",
        status: job.hitlStatus || job.status,
        timestamp: job.offPlatformLinkedAt || null,
        response: job.hitlNodeOutput,
      });
    }

    const workflowOutputs = Object.fromEntries(
      Object.entries(job).filter(
        ([key, value]) =>
          key.startsWith("workflow_output_") &&
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
      )
    );

    if (Object.keys(workflowOutputs).length > 0) {
      entries.push({
        agent_name: "workflow_outputs",
        status: job.status,
        timestamp: job.submittedAt || null,
        response: workflowOutputs,
      });
    }

    if (entries.length === 0) {
      entries.push({
        agent_name: "job_snapshot",
        status: job.status,
        timestamp: job.submittedAt || null,
        response: {
          decision: job.decision,
          case_status: job.case_status,
          application_status: job.application_status,
          hitl_status: job.hitlStatus,
        },
      });
    }

    return entries;
  };

  try {
    const result = await getJobAudit(req.params.jobId);
    if (Array.isArray(result) && result.length > 0) {
      return res.status(200).json({ result: result });
    }

    const localJob = getJobById(String(req.params.jobId));
    return res.status(200).json({ result: buildLocalAuditFallback(localJob) });
  } catch (error) {
    logError("Audit retrieval failed", { jobId: req.params.jobId, error: error.message });
    const localJob = getJobById(String(req.params.jobId));
    return res.status(200).json({ result: buildLocalAuditFallback(localJob) });
  }
}

export const getPresignedUrlControllerOnlyUrl = async (req, res) => {

  const result = await getPresignedUrl("pdf");



  // 3️⃣ Return final file URL
  return res.status(200).json({
    message: "File uploaded successfully",
    result,
  });
}

export const getJobsByGroupIdController = async (req, res) => {
  // await syncStatus()
  const result = await getJobsByGroupId(req.params.groupId).sort((a, b) => Number(b.jobId) - Number(a.jobId))
  res.status(200).json({ result: result });
}

export const getJobsForUploadSectionController = async (req, res) => {
  // await syncStatus()
  const allJobs = getAllJobs()
  const filteredJobs = allJobs.filter(j => {
    // Always include CRM scenario jobs
    if (j.scenario_commission_calculation_output && j.scenario_commission_calculation_output.length > 0) return true;
    // Include jobs that have any workflow_output_* key with data
    const hasWorkflowOutput = Object.keys(j).some(k => k.startsWith('workflow_output_'));
    if (hasWorkflowOutput) return true;
    // Exclude non-CRM completed jobs
    if (j.status === 'COMPLETED' || j.secondaryStatus === 'COMPLETED') return false;
    return true;
  }).sort((a, b) => Number(b.jobId) - Number(a.jobId))
  res.status(200).json({ result: filteredJobs });
}

export const getJobsForDashboardSectionController = async (req, res) => {
  const allJobs = getAllJobs();

  const filteredJobs = allJobs.filter(
    j =>
      j.secondaryStatus === "COMPLETED" ||
      j.status === "COMPLETED" ||
      (j.workflow_output_npfmlabni && j.workflow_output_npfmlabni !== "BSN")
  ).sort((a, b) => Number(b.jobId) - Number(a.jobId));

  res.status(200).json({ result: filteredJobs });
};
