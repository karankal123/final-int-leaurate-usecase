export const cleanupSyntheticOffPlatformJobsController = async (_req, res) => {
  try {
    const removed = removeSyntheticOffPlatformJobs();
    return res.status(200).json({ message: `Removed ${removed} synthetic off-platform jobs.` });
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Cleanup failed" });
  }
};
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import XLSX from "xlsx";
import { fileURLToPath } from "node:url";
import {
  createJob,
  getAllJobs,
  getJobEvents,
  removeSyntheticOffPlatformJobs,
  resetJobs,
  updateJobResult,
} from "../services/jobStore.js";
import {
  executeJob,
  getJobAudit,
  getPresignedUrl,
  getJobResult,
  getJobStatus,
  getWorkflowSchema,
  initiateJob,
} from "../services/opusApiService.js";
import {
  getV2WorkflowObject,
  resolveNodeOutputsByDisplayName,
} from "../services/opusWorkflowService.js";
import {
  buildAndValidateHitlOutput,
  buildHitlTaskFromWebhook,
  isCanonicalHitlPayload,
  sendHitlCallback,
  validateHitlWebhookPayload,
} from "../services/hitlService.js";
import { logWarn } from "../utils/logger.js";
import { renameStudentDocuments } from "../services/renameService.js";

const WORKFLOW_ID_PRIMARY = process.env.WORKFLOW_ID_PRIMARY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const excelFilePath = path.join(__dirname, "../data/Applicant_Case_Tracker.xlsx");
const documentsPath = path.join(__dirname, "../../documents");

const toDocumentUrl = (fileName) => `/documents/${encodeURIComponent(fileName)}`;

const getLocalDocumentNames = () => {
  if (!fs.existsSync(documentsPath)) return [];
  return fs
    .readdirSync(documentsPath)
    .filter((name) => {
      const fullPath = path.join(documentsPath, name);
      return fs.statSync(fullPath).isFile() && String(name).toLowerCase() !== "readme.md";
    });
};

const splitAttachmentNames = (attachments) =>
  String(attachments || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Find documents in the documents folder that match the applicant name
 * @param {string} applicantName - The applicant's name
 * @returns {string} - Comma-separated list of matching document filenames
 */
function findDocumentsForApplicant(applicantName) {
  try {
    const files = getLocalDocumentNames();
    if (files.length === 0) return "";
    const nameParts = applicantName.toLowerCase().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts[nameParts.length - 1] || "";
    
    const matchingFiles = files.filter(file => {
      if (file === "README.md") return false;
      const lower = file.toLowerCase();
      // Match if file contains first name, last name, or full name
      return lower.includes(firstName) || 
             lower.includes(lastName) ||
             lower.includes(applicantName.toLowerCase().replace(/\s+/g, " "));
    });
    
    return matchingFiles.join(", ");
  } catch (err) {
    console.error("Error finding documents:", err.message);
    return "";
  }
}

const resolveAttachmentUrl = (job = {}) => {
  const directUrl = String(job.attachment_url || "").trim();
  if (directUrl) return directUrl;

  const uploadedUrl = String(job.fileUrl || "").trim();
  if (uploadedUrl) return uploadedUrl;

  const firstNamedAttachment = splitAttachmentNames(job.attachments)[0] || "";
  if (firstNamedAttachment) {
    return toDocumentUrl(firstNamedAttachment);
  }

  const fileName = String(job.fileName || "").trim();
  if (fileName && fileName.toLowerCase() !== "application file") {
    return toDocumentUrl(fileName);
  }

  return "";
};

const resolveAllDocumentsForApplicant = (applicantName = "") => {
  const files = getLocalDocumentNames();
  if (files.length === 0) return [];

  const normalizedName = String(applicantName || "").trim().toLowerCase();
  if (!normalizedName) return [];

  const token = normalizedName.replace(/\.pdf$/i, "");
  const matches = files.filter((file) => file.toLowerCase().includes(token));
  return matches.map((name) => ({ name, url: toDocumentUrl(name) }));
};
const activeScreeningByStudent = new Map();
const activeJobWatchers = new Map();

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

const WEBHOOK_SECRET = process.env.OPUS_OFF_PLATFORM_WEBHOOK_SECRET || "";
const WEBHOOK_SECRET_HEADERS = [
  "x-opus-webhook-secret",
  "x-webhook-secret",
  "x-opus-secret",
];

const ACTION_MAPPINGS = {
  approve: "approve",
  approved: "approve",
  accept: "approve",
  accepted: "approve",
  reject: "reject",
  rejected: "reject",
  deny: "reject",
  denied: "reject",
  waitlist: "waitlist",
  waitlisted: "waitlist",
  raise_insufficiency: "raise_insufficiency",
  raiseinsufficiency: "raise_insufficiency",
  insufficiency: "raise_insufficiency",
  incomplete_application: "raise_insufficiency",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getNormalized = (value) =>
  String(value || "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();

const getRowValue = (row, aliases = []) => {
  const normalizedMap = new Map();
  for (const [key, value] of Object.entries(row || {})) {
    normalizedMap.set(getNormalized(key), value);
  }

  for (const alias of aliases) {
    const normalizedAlias = getNormalized(alias);
    if (normalizedMap.has(normalizedAlias)) {
      return normalizedMap.get(normalizedAlias);
    }
  }

  return "";
};

const isBlank = (v) =>
  v === null ||
  v === undefined ||
  String(v).trim() === "" ||
  v === "null" ||
  v === "undefined";

const firstNonBlank = (obj, ...keys) => {
  for (const key of keys) {
    if (!isBlank(obj[key])) return obj[key];
  }
  return null;
};

const UPDATE_CASE_DISPLAY_NAMES = [
  "decision_up",
  "case_status_up",
  "application_status_up",
  "flagged_verified_up",
  "final_reason_up",
  "final_deficiency_list_up",
  "flagged_verified_agent_up",
  "case_status_agent_up",
  "id_proof_check_up",
  "signature_check_up",
  "grade_sheets_check_up",
  "lor_check_up",
  "work_experience_check_up",
  "candidate_full_name_up",
  "work_experience_flag_up",
  "gpa_flag_up",
  "lor_date_flag_up",
  "lor_university_flag_up",
  "gpa_result_up",
  "work_experience_result_up",
  "lor_date_result_up",
  "lor_university_result_up",
];

const UPDATE_CASE_DISPLAY_NAME_MAP = new Map(
  UPDATE_CASE_DISPLAY_NAMES.map((name) => [name.toLowerCase(), name])
);

const mergeWorkflowOutputs = (raw) => {
  if (!raw || typeof raw !== "object") return {};

  console.log("mergeWorkflowOutputs raw keys:", Object.keys(raw || {}));

  const fieldMappings = [
    ["final_decision", ["decision", "final_decision"], "decision_up"],
    ["case_status", ["Case Status", "case_status"], "case_status_up"],
    ["application_status", ["application_status"], "application_status_up"],
    ["flagged_or_verified", ["flagged/verified", "flagged_or_verified"], "flagged_verified_up"],
    ["final_reason", ["decision of agent", "final_reason", "screening_decision"], "final_reason_up"],
    ["final_deficiency_list", ["final deficiency list", "final_deficiency_list"], "final_deficiency_list_up"],
    ["flagged_or_verified_agent", ["flagged/verified(agent's output)", "flagged_or_verified_agent"], "flagged_verified_agent_up"],
    ["case_status_agent", ["case_status(agent)", "case_status_agent"], "case_status_agent_up"],
    ["id_proof_check", ["id proof and personal details check", "id_proof_check"], "id_proof_check_up"],
    ["signature_check", ["signature check", "signature_check"], "signature_check_up"],
    ["grade_sheets_check", ["grade sheets check", "grade_sheets_check"], "grade_sheets_check_up"],
    ["lor_check", ["lor check", "lor_check"], "lor_check_up"],
    ["work_experience_check", ["work experience check", "work_experience_check"], "work_experience_check_up"],
    ["candidate_full_name", ["Candidate Full Name", "candidate_full_name"], "candidate_full_name_up"],
    ["work_experience_flag", ["work experience flag", "work_experience_flag"], "work_experience_flag_up"],
    ["gpa_flag", ["gpa flag", "gpa_flag"], "gpa_flag_up"],
    ["lor_date_flag", ["lor date flag", "lor_date_flag"], "lor_date_flag_up"],
    ["lor_university_flag", ["lor university flag", "lor_university_flag"], "lor_university_flag_up"],
    ["gpa_result", ["gpa result", "gpa_result"], "gpa_result_up"],
    ["work_experience_result", ["work experience result", "work_experience_result"], "work_experience_result_up"],
    ["lor_date_result", ["lor date result", "lor_date_result"], "lor_date_result_up"],
    ["lor_university_result", ["lor university result", "lor_university_result"], "lor_university_result_up"],
  ];

  const merged = {};
  for (const [outputKey, newKeys, updateKey] of fieldMappings) {
    const value = firstNonBlank(
      raw,
      ...newKeys,
      updateKey,
      `workflow_output_for_${updateKey}`
    );
    if (value !== null) {
      merged[`merged_${outputKey}`] = value;
    }
  }

  return merged;
};

const readApplicantRowsFromExcel = () => {
  if (!fs.existsSync(excelFilePath)) {
    return [];
  }

  const workbook = XLSX.readFile(excelFilePath);
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
};

const ensureSeedDataFromExcel = () => {
  const rows = readApplicantRowsFromExcel();
  if (rows.length === 0) {
    return;
  }

  const jobs = getAllJobs();
  const existingStudentIds = new Set(jobs.map((job) => String(job.studentId || "")));

  rows.forEach((row, index) => {
    const studentId = String(
      getRowValue(row, ["Student_ID", "Student ID", "studentId", "student_id"])
    ).trim();

    if (!studentId || existingStudentIds.has(studentId)) {
      return;
    }

    const applicantName = String(
      getRowValue(row, ["Applicant_Name", "Applicant Name", "Name"])
    ).trim();
    const requestType = String(
      getRowValue(row, ["Request_Type", "Request Type"])
    ).trim();
    const applicationStatus = String(
      getRowValue(row, ["Application_Status", "Application Status"])
    ).trim();
    const attachments = String(getRowValue(row, ["Attachments"]) || "").trim();
    // Try to find documents from folder if Excel attachment is missing or generic
    const dynamicAttachments = findDocumentsForApplicant(applicantName);
    const finalAttachments = dynamicAttachments || attachments || "Application file";
    const decision = String(getRowValue(row, ["Decision"]) || "").trim();
    const reason = String(getRowValue(row, ["Reason"]) || "").trim();
    const caseStatus = String(getRowValue(row, ["Case_Status", "Case Status"]) || "").trim();
    const email = String(getRowValue(row, ["Email"]) || "").trim();

    createJob({
      // Negative IDs keep seeded records below real Opus execution IDs in sort order.
      jobId: String(-(Date.now() + index)),
      studentId,
      applicant_name: applicantName,
      request_type: requestType || "new",
      application_status: applicationStatus || "Under Review",
      attachments: finalAttachments,
      decision,
      reason,
      case_status: caseStatus || "Open",
      email,
      fileName: path.basename(excelFilePath),
      localFilePath: excelFilePath,
      status: "NOT_STARTED",
      isSecondaryWorkflowExecuted: false,
      submittedAt: new Date().toLocaleString("en-GB"),
    });

    existingStudentIds.add(studentId);
  });
};

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

const getAliasedInputValue = (inputData = {}, aliases = []) => {
  for (const alias of aliases) {
    const value = inputData[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
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

const toKeyedResult = (payload = {}) => {
  const schema = payload?.jobResultsPayloadSchema;
  if (!schema || typeof schema !== "object") {
    return {};
  }

  const result = {};
  for (const [key, obj] of Object.entries(schema)) {
    // Store by the workflow_output_* key
    result[key] = obj?.value;
    const value = obj?.value;
    
    // Also store by display_name so mergeWorkflowOutputs can find it
    if (obj?.display_name) {
      const displayName = String(obj.display_name).trim();
      result[displayName] = value;

      const canonicalDisplayName = UPDATE_CASE_DISPLAY_NAME_MAP.get(
        displayName.toLowerCase()
      );
      if (canonicalDisplayName) {
        result[canonicalDisplayName] = value;
        if (String(key).startsWith("workflow_output_")) {
          result[`workflow_output_for_${canonicalDisplayName}`] = value;
        }
      }
    }
    
    // Also store by variable_name if different from key
    if (obj?.variable_name && obj.variable_name !== key) {
      const variableName = String(obj.variable_name).trim();
      result[variableName] = value;

      const canonicalVariableName = UPDATE_CASE_DISPLAY_NAME_MAP.get(
        variableName.toLowerCase()
      );
      if (canonicalVariableName) {
        result[canonicalVariableName] = value;
        if (String(key).startsWith("workflow_output_")) {
          result[`workflow_output_for_${canonicalVariableName}`] = value;
        }
      }
    }
  }
  
  // Apply workflow output merging for normalized field names
  const mergedOutputs = mergeWorkflowOutputs(result);
  return { ...result, ...mergedOutputs };
};

const isSyntheticOffPlatformStudentId = (value) =>
  String(value || "")
    .toLowerCase()
    .startsWith("off-platform-");

const parseList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];

    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        return [raw];
      }
    }

    return raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [String(value)];
};

const normalizeAction = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return ACTION_MAPPINGS[normalized] || normalized;
};

const normalizeActions = (value) => {
  const list = parseList(value)
    .flatMap((item) => String(item).split(","))
    .map((item) => normalizeAction(item))
    .filter(Boolean);

  return [...new Set(list)];
};

const parseObject = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return {};
  }

  return {};
};

const unwrapScalarValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((item) => item !== undefined && item !== null);
    return unwrapScalarValue(first);
  }

  if (typeof value === "object") {
    if (Object.hasOwn(value, "value")) {
      return unwrapScalarValue(value.value);
    }

    if (Object.hasOwn(value, "text")) {
      return unwrapScalarValue(value.text);
    }

    if (Object.hasOwn(value, "label")) {
      return unwrapScalarValue(value.label);
    }
  }

  return null;
};

const toCleanText = (value, fallback = "") => {
  const scalar = unwrapScalarValue(value);
  if (scalar === null || scalar === undefined) {
    return fallback;
  }

  const text = String(scalar).trim();
  return text || fallback;
};

const getCaseInsensitive = (source = {}, key = "") => {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const target = String(key || "").toLowerCase();
  for (const [k, v] of Object.entries(source)) {
    if (String(k).toLowerCase() === target) {
      return v;
    }
  }

  return undefined;
};

const deepFindValue = (source, aliases = []) => {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  for (const alias of aliases) {
    const direct = getCaseInsensitive(source, alias);
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return direct;
    }
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const nested = deepFindValue(value, aliases);
    if (nested !== undefined && nested !== null && String(nested).trim() !== "") {
      return nested;
    }
  }

  return undefined;
};

const deriveReviewFlags = (payload = {}) => {
  const completeness =
    parseObject(deepFindValue(payload, ["completeness_flags", "completenessFlags"])) || {};
  const screening =
    parseObject(deepFindValue(payload, ["screening_flags", "screeningFlags"])) || {};

  return {
    completeness_flags: completeness,
    screening_flags: screening,
  };
};

// ─── Audit-driven flag extraction ────────────────────────────────────────────

/**
 * Maps Agent 6 output_schema display_name values to the UI card labels shown
 * in the Document Completeness Check panel.
 */
const AGENT6_LABEL_MAP = {
  id_proof_and_personal_details_check: "ID and Personal Details",
  signature_check: "Signature",
  signature_check_result: "Signature",
  grade_sheets_check: "Grade Sheets and Certificates",
  grade_sheets_check_result: "Grade Sheets and Certificates",
  lor_check: "LOR Documents",
  lor_check_result: "LOR Documents",
  work_experience_check: "Work Experience",
  work_experience_check_result: "Work Experience",
};

/**
 * Maps Document Screening output_schema display_name values to UI card labels
 * shown in the Screening Rules Evaluation panel.
 */
const DOC_SCREENING_LABEL_MAP = {
  gpa_result: "GPA Rule",
  work_experience_result: "Work Experience Rule",
  lor_university_result: "LOR Institution Rule",
  lor_date_result: "LOR Recency Rule",
};

const DOC_SCREENING_FLAG_MAP = {
  gpa_flag: "GPA Rule",
  work_experience_flag: "Work Experience Rule",
  lor_university_flag: "LOR Institution Rule",
  lor_date_flag: "LOR Recency Rule",
};

/**
 * Agent 6 display_name values that are summary/metadata fields, not
 * completeness flag rows.  We persist them separately on the job record.
 */
const AGENT6_SUMMARY_DISPLAY_NAMES = new Set([
  "decision",
  "reason",
  "case_status",
  "application_status",
  "deficiency_list",
]);

/** Agent-name substrings used to identify nodes when scanning audit entries. */
const AGENT6_NAME_TOKENS = [
  "agent 6",
  "agent6",
  "update case document complteness check",
  "update case document completeness check",
];
const DOC_SCREENING_NAME_TOKENS = [
  "document screening",
  "doc screening",
  "document screening for update case",
];
const AGENT8_NAME_TOKENS = [
  "agent 8 update",
  "agent8 update",
  "agent 8",
];
const MERGE_NODE_TOKENS = [
  "merge",
  "router",
  "final output",
  "combine",
];

/**
 * Detect explicit fail language in a free-text audit value.
 * Returns true when the text contains unambiguous failure terms.
 * Defaults to PASS when none are found, per the design spec.
 */
const isFailSignal = (value = "") => {
  const v = String(value).toLowerCase();
  return (
    v.includes("missing") ||
    v.includes("below") ||
    v.includes("insufficient") ||
    v.includes("incomplete") ||
    v.includes("fail") ||
    v.includes("not found") ||
    v.includes("no usable") ||
    v.includes("unable to") ||
    v.includes("not available") ||
    v.includes("not present") ||
    v.includes("absent") ||
    v.includes("under ") ||
    v.includes("does not meet") ||
    v.includes("not meet") ||
    v.includes("not satisfied") ||
    v.includes("unverified")
  );
};

const isSkipSignal = (value = "") => {
  const v = String(value).toLowerCase().trim();
  return (
    v === "green" ||
    v === "skipped" ||
    v.startsWith("skipped") ||
    v.includes("skipped") ||
    v.includes("insufficient lors") ||
    v.includes("previously verified") ||
    v.includes("already passed")
  );
};

// For completeness checks — value is "Present" / "Missing" etc.
const toUiFlagValue = (value) => {
  const text = String(value || "Not available").trim();
  if (isSkipSignal(text)) return `${text} —`;
  return `${text} ${isFailSignal(text) ? "✗" : "✓"}`;
};

// For screening rules — value is literally "Green", "Red", or "Skipped"
const toScreeningFlagValue = (flagValue) => {
  const v = String(flagValue || "").toLowerCase().trim();
  if (v === "green") return "✓";
  if (v === "red") return "✗";
  if (v === "skipped") return "—";
  return "—"; // unknown = yellow
};

/**
 * Uses Azure OpenAI to classify each screening rule result text as "green", "red", or "yellow".
 * green  = passes the rule / meets requirements
 * red    = fails the rule / does not meet requirements
 * yellow = skipped / not applicable / cannot be screened
 */
const classifyScreeningFlagsWithLLM = async (flagTexts) => {
  const key = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/+$/, "");
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";

  if (!key || !endpoint) return null;

  const entries = Object.entries(flagTexts).filter(([, v]) => v && v !== "Not available");
  if (entries.length === 0) return null;

  const list = entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");

  try {
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const res = await axios.post(
      url,
      {
        messages: [
          {
            role: "system",
            content:
              "You are a classifier for law school application screening results. " +
              "For each screening rule result text, output ONLY one of: green, red, or yellow. " +
              "green = candidate meets/passes the rule. " +
              "red = candidate does not meet/fails the rule (e.g. below required years, below GPA threshold, missing documents). " +
              "yellow = rule was skipped, not applicable, or cannot be screened. " +
              "Return ONLY a valid JSON object mapping each rule name to its color. No markdown, no explanation.",
          },
          {
            role: "user",
            content: `Classify each of these screening rule results:\n${list}`,
          },
        ],
        temperature: 0,
        max_tokens: 200,
      },
      {
        headers: { "api-key": key, "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    const content = res.data?.choices?.[0]?.message?.content || "";
    const cleaned = content.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Validate — only accept green/red/yellow values
    const result = {};
    for (const [k] of entries) {
      const c = String(parsed[k] || "").toLowerCase().trim();
      result[k] = ["green", "red", "yellow"].includes(c) ? c : "yellow";
    }
    return result;
  } catch (err) {
    console.error("LLM flag classification failed:", err.message);
    return null;
  }
};

/**
 * Normalise an OPUS audit response into a flat array of node execution entries.
 *
 * The real audit shape (verified against GET /job/:id/audit) is:
 *   {
 *     "executed_nodes": ["Input", "Agent 6", …],        // plain strings
 *     "audit": {
 *       "nodes_execution_data": {
 *         "Agent 6":            { execution_status, execution_output: [...] },
 *         "Document Screening": { execution_status, execution_output: [...] }
 *       }
 *     }
 *   }
 *
 * `nodes_execution_data` is an object keyed by node name — we convert it to
 * an array of { node_name, ...data } entries so downstream helpers can iterate.
 * Fallbacks are kept for other possible API variants.
 */
const normalizeAuditData = (auditData) => {
  if (!auditData) return [];
  if (Array.isArray(auditData)) return auditData;

  // Primary path: audit.nodes_execution_data is an object keyed by node name.
  const nodesExecData =
    auditData.audit?.nodes_execution_data ||
    auditData.nodes_execution_data;
  if (nodesExecData && typeof nodesExecData === "object" && !Array.isArray(nodesExecData)) {
    return Object.entries(nodesExecData).map(([name, data]) => ({
      node_name: name,
      ...(data && typeof data === "object" ? data : {}),
    }));
  }

  // Fallbacks for other API variants (array-based responses).
  if (Array.isArray(auditData.result)) return auditData.result;
  if (Array.isArray(auditData.audit)) return auditData.audit;
  if (Array.isArray(auditData.steps)) return auditData.steps;
  return [];
};

/** Extract the node name from an audit entry, normalised to lower-case. */
const getAuditEntryNodeName = (entry) =>
  String(
    entry?.node_name ||
    entry?.agent_name ||
    entry?.name ||
    entry?.step_name ||
    entry?.nodeName ||
    ""
  )
    .toLowerCase()
    .trim();

/**
 * Extract the execution_output from an audit entry.
 *
 * After normalizeAuditData, each entry is { node_name, execution_output, … }.
 * The real execution_output is an **array** of objects:
 *   [ { variable_name, display_name, value, type }, … ]
 *
 * We return whatever is in execution_output (array or object) so
 * buildFlagsFromOutput can handle it.
 */
const extractExecutionOutput = (entry) => {
  if (!entry || typeof entry !== "object") return null;

  const output = entry.execution_output;
  if (Array.isArray(output) && output.length > 0) return output;
  if (output && typeof output === "object" && Object.keys(output).length > 0) return output;

  const nested = entry.response ?? entry.output ?? entry.result;
  if (nested && typeof nested === "object") {
    const nestedOutput = nested.execution_output;
    if (Array.isArray(nestedOutput) && nestedOutput.length > 0) return nestedOutput;
    if (nestedOutput && typeof nestedOutput === "object" && Object.keys(nestedOutput).length > 0) return nestedOutput;
    if (Object.keys(nested).length > 0) return nested;
  }

  return null;
};

const extractResultsFromAudit = (auditData) => {
  const result = {};
  const entries = normalizeAuditData(auditData);

  for (const entry of entries) {
    console.log("=== extractResultsFromAudit node ===", getAuditEntryNodeName(entry));
    const outputs = extractExecutionOutput(entry);
    if (!outputs) continue;

    if (Array.isArray(outputs)) {
      for (const output of outputs) {
        if (output?.variable_name && output?.value !== undefined) {
          result[output.variable_name] = output.value;
          // Also index by display_name so mergeWorkflowOutputs can find it
          if (output.display_name) {
            result[output.display_name] = output.value;
          }
        }
      }
    } else if (typeof outputs === "object") {
      for (const [key, value] of Object.entries(outputs)) {
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
  }

  return result;
};

/**
 * Build a { "UI Label": "value ✓/✗" } flags map from a node's execution_output.
 *
 * The real execution_output is an **array** of objects:
 *   [ { variable_name: "workflow_output_xxx", display_name: "...", value: "Present", type: "str" }, … ]
 *
 * We resolve each item's variable_name through the outputMap (autoId → displayName)
 * and then through the labelMap (displayName → UI label).
 *
 * Falls back to dict iteration for legacy/alternative API shapes.
 *
 * @param {Array|object} executionOutput - Raw execution_output from the audit entry.
 * @param {object} outputMap             - { autoId -> displayName } from the workflow def.
 * @param {object} labelMap              - { displayName -> "UI Label" } mapping.
 */
const buildFlagsFromOutput = (executionOutput, outputMap, labelMap) => {
  if (!executionOutput) return null;

  const flags = {};

  if (Array.isArray(executionOutput)) {
    // Primary path: execution_output is an array of { variable_name, value, … }
    for (const item of executionOutput) {
      if (!item || typeof item !== "object") continue;
      const varName = item.variable_name || item.display_name || "";
      const displayName = outputMap[varName] || item.display_name || varName;
      const uiLabel = labelMap[displayName];
      if (!uiLabel) continue;

      const textValue = toCleanText(item.value, "Not available");
      flags[uiLabel] = toUiFlagValue(textValue);
    }
  } else if (typeof executionOutput === "object") {
    // Fallback: dict-shaped execution_output (legacy API variant)
    for (const [key, rawValue] of Object.entries(executionOutput)) {
      const displayName = outputMap[key] || key;
      const uiLabel = labelMap[displayName];
      if (!uiLabel) continue;

      const textValue = toCleanText(rawValue, "Not available");
      flags[uiLabel] = toUiFlagValue(textValue);
    }
  }

  return Object.keys(flags).length > 0 ? flags : null;
};

/**
 * Extract Agent 6 summary fields (decision, reason, case_status,
 * application_status, deficiency_list) from an execution_output and merge
 * them into the provided accumulator object.
 */
const extractAgent6SummaryFields = (executionOutput, outputMap, acc) => {
  if (!executionOutput) return;

  if (Array.isArray(executionOutput)) {
    for (const item of executionOutput) {
      if (!item || typeof item !== "object") continue;
      const varName = item.variable_name || item.display_name || "";
      const displayName = outputMap[varName] || item.display_name || varName;
      if (AGENT6_SUMMARY_DISPLAY_NAMES.has(displayName)) {
        acc[displayName] = toCleanText(item.value, "");
      }
    }
  } else if (typeof executionOutput === "object") {
    for (const [key, rawValue] of Object.entries(executionOutput)) {
      const displayName = outputMap[key] || key;
      if (AGENT6_SUMMARY_DISPLAY_NAMES.has(displayName)) {
        acc[displayName] = toCleanText(rawValue, "");
      }
    }
  }
};

/**
 * Extract the `flagged_or_verified` summary field from a Document Screening
 * execution_output and merge it into the accumulator.
 */
const extractDocScreeningSummaryFields = (executionOutput, outputMap, acc) => {
  if (!executionOutput) return;

  if (Array.isArray(executionOutput)) {
    for (const item of executionOutput) {
      if (!item || typeof item !== "object") continue;
      const varName = item.variable_name || item.display_name || "";
      const displayName = outputMap[varName] || item.display_name || varName;
      if (displayName === "flagged_or_verified") {
        acc.flagged_or_verified = toCleanText(item.value, "");
      }
    }
  } else if (typeof executionOutput === "object") {
    for (const [key, rawValue] of Object.entries(executionOutput)) {
      const displayName = outputMap[key] || key;
      if (displayName === "flagged_or_verified") {
        acc.flagged_or_verified = toCleanText(rawValue, "");
      }
    }
  }
};

/**
 * Poll the OPUS job audit (and status) until one of:
 *  1. Agent 6 AND Document Screening outputs are available in the audit →
 *     persist flags, return { status: "REVIEW_READY", result: { flags… } }
 *  2. Job status becomes COMPLETED → fetch result and return normally
 *  3. Job status becomes FAILED/CANCELLED with no partial data → throw
 *  4. Timeout (120 × 5 s = 10 min) with partial data → REVIEW_READY
 *  5. Timeout with no data at all → throw
 *
 * This replaces the old waitForJobCompletion which only looked for COMPLETED
 * and timed out to FAILED when the workflow was paused at Off-Platform Review.
 */
const pollAuditUntilDone = async (jobExecutionId) => {
  const maxAttempts = 120;
  const intervalMs = 5000;

  // Fetch the V2 workflow object once for display-name resolution.
  // The service caches it for 1 h so this is cheap on repeat calls.
  const workflowObj = await getV2WorkflowObject(WORKFLOW_ID_PRIMARY).catch(() => null);
  const agent6OutputMap = resolveNodeOutputsByDisplayName(workflowObj, "Agent 6");
  const docScreeningOutputMap = resolveNodeOutputsByDisplayName(workflowObj, "Document Screening");
  const updateCompletenessOutputMap = resolveNodeOutputsByDisplayName(workflowObj, "update case document complteness check");
  const updateScreeningOutputMap = resolveNodeOutputsByDisplayName(workflowObj, "document screening for update case");
  const agent8OutputMap = resolveNodeOutputsByDisplayName(workflowObj, "agent 8 update");

  console.log("=== OUTPUT MAPS ===", {
    agent6Keys: Object.keys(agent6OutputMap || {}),
    docScreeningKeys: Object.keys(docScreeningOutputMap || {}),
    updateCompletenessKeys: Object.keys(updateCompletenessOutputMap || {}),
    updateScreeningKeys: Object.keys(updateScreeningOutputMap || {}),
    agent8Keys: Object.keys(agent8OutputMap || {}),
  });

  let agent6Flags = null;
  let docScreeningFlags = null;
  let agent8Flags = null;
  const summaryFields = {};
  let partialResult = {};

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // ── 1. Check terminal status ──────────────────────────────────────────
    let currentStatus = null;
    try {
      const statusPayload = await getJobStatus(jobExecutionId);
      currentStatus = statusPayload?.status;
    } catch {
      // Status check failed; keep going with the audit.
    }

    if (currentStatus === "COMPLETED") {
      const resultPayload = await getJobResult(jobExecutionId);
      const combined = toKeyedResult(resultPayload);
      return { status: "COMPLETED", result: { ...combined, ...mergeWorkflowOutputs(combined) } };
    }

    if (
      ["FAILED", "CANCELLED"].includes(currentStatus) &&
      !agent6Flags &&
      !docScreeningFlags
    ) {
      throw new Error(`Job did not complete successfully. Last status: ${currentStatus}`);
    }

    // ── 2. Poll the audit for node execution outputs ──────────────────────
    try {
      const auditData = await getJobAudit(jobExecutionId);
      const entries = normalizeAuditData(auditData);
      partialResult = { ...partialResult, ...extractResultsFromAudit(auditData) };

      for (const entry of entries) {
        const nodeName = getAuditEntryNodeName(entry);
        console.log("=== AUDIT NODE FOUND ===", nodeName);
        const output = extractExecutionOutput(entry);
        if (!output) continue;

        if (!agent6Flags && AGENT6_NAME_TOKENS.some((t) => nodeName.includes(t))) {
          console.log("=== MATCHED AGENT6 NODE ===", nodeName);
          const isUpdateNode = nodeName.includes("update case");
          const outputMapToUse = isUpdateNode ? updateCompletenessOutputMap : agent6OutputMap;
          console.log("=== USING OUTPUT MAP ===", isUpdateNode ? "update" : "new", "keys:", Object.keys(outputMapToUse || {}));
          if (!outputMapToUse || Object.keys(outputMapToUse).length === 0) {
            console.log("=== OUTPUT MAP EMPTY, BUILDING FROM RAW OUTPUT ===");
            const flags = {};
            if (Array.isArray(output)) {
              for (const item of output) {
                if (!item || typeof item !== "object") continue;
                const displayName = item.display_name || item.variable_name || "";
                const uiLabel = AGENT6_LABEL_MAP[displayName];
                if (!uiLabel) continue;
                const textValue = toCleanText(item.value, "Not available");
                flags[uiLabel] = toUiFlagValue(textValue);
              }
            }
            if (Object.keys(flags).length > 0) {
              agent6Flags = flags;
              console.log("=== AGENT6 FLAGS FROM RAW ===", agent6Flags);
            }
          } else {
            agent6Flags = buildFlagsFromOutput(output, outputMapToUse, AGENT6_LABEL_MAP);
            console.log("=== AGENT6 FLAGS ===", agent6Flags);
          }
          extractAgent6SummaryFields(output, outputMapToUse, summaryFields);
        }

        if (
          !docScreeningFlags &&
          DOC_SCREENING_NAME_TOKENS.some((t) => nodeName.includes(t))
        ) {
          console.log("=== MATCHED DOC SCREENING NODE ===", nodeName);
          const isUpdateNode = nodeName.includes("update case");
          const outputMapToUse = isUpdateNode ? updateScreeningOutputMap : docScreeningOutputMap;
          console.log("=== USING SCREENING MAP ===", isUpdateNode ? "update" : "new", "keys:", Object.keys(outputMapToUse || {}));
          if (!outputMapToUse || Object.keys(outputMapToUse).length === 0) {
            console.log("=== SCREENING MAP EMPTY, BUILDING FROM RAW OUTPUT ===");
            const flags = {};
            const flagColors = {};

            if (Array.isArray(output)) {
              // First pass: collect _result text values
              for (const item of output) {
                if (!item || typeof item !== "object") continue;
                const displayName = item.display_name || item.variable_name || "";
                if (!displayName.endsWith("_result")) continue;
                const uiLabel = DOC_SCREENING_LABEL_MAP[displayName];
                if (!uiLabel) continue;
                flags[uiLabel] = toCleanText(item.value, "Not available");
              }

              // Second pass: collect _flag color values
              for (const item of output) {
                if (!item || typeof item !== "object") continue;
                const displayName = item.display_name || item.variable_name || "";
                if (!displayName.endsWith("_flag")) continue;
                const uiLabel = DOC_SCREENING_FLAG_MAP[displayName];
                if (!uiLabel) continue;
                flagColors[uiLabel] = String(item.value || "").toLowerCase().trim();
              }
            }

            // Apply icons based on flag colors
            for (const [label, text] of Object.entries(flags)) {
              const color = flagColors[label] || "";
              let icon = "—";
              if (color === "green") icon = "✓";
              else if (color === "red") icon = "✗";
              else if (color === "skipped") icon = "—";
              else if (isSkipSignal(text)) icon = "—";
              else if (isFailSignal(text)) icon = "✗";
              else if (text !== "Not available") icon = "✓";
              flags[label] = `${text} ${icon}`;
            }

            if (Object.keys(flags).length > 0) {
              docScreeningFlags = flags;
              console.log("=== DOC SCREENING FLAGS FROM RAW ===", docScreeningFlags);
            }
          } else {
            docScreeningFlags = buildFlagsFromOutput(output, outputMapToUse, DOC_SCREENING_LABEL_MAP);
            console.log("=== DOC SCREENING FLAGS ===", docScreeningFlags);
          }
          extractDocScreeningSummaryFields(output, outputMapToUse, summaryFields);
        }

        if (
          !agent8Flags &&
          AGENT8_NAME_TOKENS.some((t) => nodeName.includes(t))
        ) {
          const agent8Output = extractExecutionOutput(entry);
          if (agent8Output && Array.isArray(agent8Output)) {
            for (const item of agent8Output) {
              if (item?.variable_name && item?.value !== undefined) {
                partialResult[item.variable_name] = item.value;
                if (item.display_name) {
                  partialResult[item.display_name] = item.value;
                }
              }
            }
            agent8Flags = true;
          }
        }

        if (MERGE_NODE_TOKENS.some((t) => nodeName.includes(t))) {
          const mergeOutput = extractExecutionOutput(entry);
          if (mergeOutput && Array.isArray(mergeOutput)) {
            for (const item of mergeOutput) {
              if (item?.variable_name && item?.value !== undefined) {
                partialResult[item.variable_name] = item.value;
                if (item.display_name) {
                  partialResult[item.display_name] = item.value;
                }
              }
            }
          }
        }
      }
    } catch {
      // Audit fetch failed; keep polling.
    }

    // ── 3. Once both evaluation nodes have output, the job is parked ──────
    if (
      (agent6Flags && docScreeningFlags) ||
      (agent6Flags && agent8Flags)
    ) {
      return {
        status: "REVIEW_READY",
        result: {
          completeness_flags: agent6Flags,
          screening_flags: docScreeningFlags,
          ...summaryFields,
        },
      };
    }

    // ── 4. FAILED/CANCELLED but we have some partial data – stop gracefully
    if (["FAILED", "CANCELLED"].includes(currentStatus)) {
      return { status: "COMPLETED", result: { ...partialResult, ...mergeWorkflowOutputs(partialResult) } };
    }

    await sleep(intervalMs);
  }

  // ── 5. Timeout handling ────────────────────────────────────────────────
  if (agent6Flags || docScreeningFlags) {
    return {
      status: "REVIEW_READY",
      result: {
        ...(agent6Flags ? { completeness_flags: agent6Flags } : {}),
        ...(docScreeningFlags ? { screening_flags: docScreeningFlags } : {}),
        ...summaryFields,
      },
    };
  }

  throw new Error("Timed out waiting for Opus workflow completion");
};

const isFinalizedDecision = (value) => {
  const normalized = String(value || "").toLowerCase();
  return ["selected", "rejected", "deny", "waitlisted", "incomplete application"].includes(normalized);
};

const resolveCaseStatus = (job = {}) => {
  return (
    // Prefer merged output field (from mergeWorkflowOutputs)
    job.merged_case_status ||
    job.case_status ||
    // Check raw display_name from new case path
    job["Case Status"] ||
    // Fallback to workflow output keys
    job.workflow_output_010zbd01n ||
    // Fallback for update case path
    job.case_status_up ||
    (job.status === "COMPLETED" ? "Closed" : "Open")
  );
};

// BEFORE
const resolveDecision = (job = {}) => {
  return (
    job.human_final_decision ||
    job.merged_final_decision ||
    job.final_decision ||
    job.decision ||
    job.workflow_output_p1e47k0wq ||
    job.workflow_output_i7abcyo03 ||
    job.merged_application_status ||
    job.application_status ||
    job.decision_up ||
    job.application_status_up ||
    job.offPlatformDecision ||
    "Pending Review"
  );
};

const resolveWorkflowApplicationStatusValue = (job = {}) => {
  return (
    job.merged_application_status ||
    job.workflow_output_p1e47k0wq ||
    job.workflow_output_i7abcyo03 ||
    job.application_status_up ||
    ""
  );
};

const resolveApplicationStatusValue = (job = {}) => {
  return (
    job.human_final_application_status ||
    job.application_status ||
    resolveWorkflowApplicationStatusValue(job) ||
    ""
  );
};

const resolveAgentDecision = (job = {}) => {
  const workflowApplicationStatus = String(
    resolveWorkflowApplicationStatusValue(job) || ""
  ).trim();
  if (workflowApplicationStatus) {
    return workflowApplicationStatus;
  }

  const status = String(job.status || "").toUpperCase();
  if (["NOT_STARTED", "IN PROGRESS", "IN_PROGRESS", "PENDING"].includes(status)) {
    return "Under Review";
  }

  return (
    job.merged_final_decision ||
    job.final_decision ||
    job.decision_up ||
    job.offPlatformDecision ||
    "Under Review"
  );
};

const resolveRegularWorkflowApplicationStatus = (job = {}) => {
  const explicitFinalApplicationStatus = String(
    job.human_final_application_status || ""
  ).trim();
  if (explicitFinalApplicationStatus) {
    return explicitFinalApplicationStatus;
  }

  const status = String(job.status || "").toUpperCase();
  if (status === "NOT_STARTED") {
    return "Under Review";
  }

  const explicitApplicationStatus = String(resolveApplicationStatusValue(job) || "").trim();
  if (explicitApplicationStatus && explicitApplicationStatus.toLowerCase() !== "under review") {
    return explicitApplicationStatus;
  }

  if (["COMPLETED", "REVIEW_READY", "HITL_PENDING", "IN PROGRESS", "IN_PROGRESS"].includes(status)) {
    return resolveAgentDecision(job);
  }

  return "Under Review";
};

const deriveCaseStatusFromApplicationStatus = (applicationStatus) => {
  const normalized = String(applicationStatus || "").trim().toLowerCase();
  if (["selected", "rejected", "deny"].includes(normalized)) {
    return "Closed";
  }
  return "Open";
};

const resolveRegularWorkflowCaseStatus = (job = {}) => {
  const explicitFinalCaseStatus = String(job.human_final_case_status || "").trim();
  if (explicitFinalCaseStatus) {
    return explicitFinalCaseStatus;
  }

  const explicitCaseStatus = String(job.case_status || "").trim();
  if (explicitCaseStatus && isFinalizedDecision(resolveDecision(job))) {
    return explicitCaseStatus;
  }

  return deriveCaseStatusFromApplicationStatus(
    resolveRegularWorkflowApplicationStatus(job)
  );
};

const resolveApplicantName = (job = {}) => {
  return (
    job.merged_candidate_full_name ||
    job.candidate_full_name ||
    job["Candidate Full Name"] ||
    job.candidate_full_name_up ||
    job.workflow_output_dtnvounmw || 
    job.applicant_name || 
    "Unknown Applicant"
  );
};

// AFTER
const toInboxCase = (job) => ({
  student_id: String(job.studentId || ""),
  applicant_name: resolveApplicantName(job),
  request_type: job.request_type || "New",
  case_status: Boolean(job.isOffPlatformReview)
    ? resolveCaseStatus(job)
    : resolveRegularWorkflowCaseStatus(job),
  application_status: Boolean(job.isOffPlatformReview)
    ? resolveDecision(job)
    : resolveRegularWorkflowApplicationStatus(job),
  attachments: job.attachments || job.fileName || "Application file",
  attachment_url: resolveAttachmentUrl(job),
  attachment_urls: resolveAllDocumentsForApplicant(resolveApplicantName(job)),
  is_human_review_ready: false,
  thread_id: null,
  is_off_platform_review: false,
  hitl_workflow_name: null,
  hitl_node_name: null,
  submitted_at: job.submittedAt || null,
});

const resolveScreeningStatus = (job = {}) => {
  if (job.status === "COMPLETED") return "Completed";
  if (job.status === "IN PROGRESS" || job.status === "IN_PROGRESS") return "In Progress";
  if (
    job.status === "HITL_PENDING" ||
    job.status === "REVIEW_READY" ||
    (Boolean(job.isOffPlatformReview) && normalizeActions(job.available_actions).length > 0)
  )
    return "Pending Human Review";
  return "Not Started";
};

// AFTER
const toCaseInfo = (job) => {
  const applicantName = resolveApplicantName(job);
  const dynamicAttachments = findDocumentsForApplicant(applicantName);
  const allAttachmentUrls = resolveAllDocumentsForApplicant(applicantName);
  const attachmentUrl = resolveAttachmentUrl(job);
  const applicationStatus = Boolean(job.isOffPlatformReview)
    ? resolveDecision(job)
    : resolveRegularWorkflowApplicationStatus(job);
  
  return {
    student_id: String(job.studentId || ""),
    applicant_name: applicantName,
    request_type: job.request_type || "New",
    screening_status: resolveScreeningStatus(job),
    application_status: applicationStatus,
    case_status: Boolean(job.isOffPlatformReview)
      ? resolveCaseStatus(job)
      : deriveCaseStatusFromApplicationStatus(applicationStatus),
    attachments: dynamicAttachments || job.attachments || job.fileName || "Application file",
    attachment_url: attachmentUrl,
    attachment_urls:
      allAttachmentUrls.length > 0
        ? allAttachmentUrls
        : attachmentUrl
          ? [{ name: decodeURIComponent(String(attachmentUrl).split("/").pop() || "document"), url: attachmentUrl }]
          : [],
  };
};

const toScreeningResult = async (job) => {
  const merged = mergeWorkflowOutputs(job);
  const mergedJob = { ...job, ...merged };
  const applicationStatus = Boolean(mergedJob.isOffPlatformReview)
    ? resolveApplicationStatusValue(mergedJob) || resolveDecision(mergedJob)
    : resolveRegularWorkflowApplicationStatus(mergedJob);
  const caseStatus = Boolean(mergedJob.isOffPlatformReview)
    ? resolveCaseStatus(mergedJob)
    : deriveCaseStatusFromApplicationStatus(applicationStatus);
  const finalDecision = mergedJob.human_final_decision || resolveDecision(mergedJob);
  const agentDecision = Boolean(mergedJob.isOffPlatformReview)
    ? resolveDecision(mergedJob)
    : resolveAgentDecision(mergedJob);


  console.log("toScreeningResult merged keys:", Object.keys(mergedJob).filter(k => k.startsWith("merged_")));

  const deficiencyList = parseList(
    merged.merged_final_deficiency_list ||
    mergedJob.final_deficiency_list || 
    mergedJob.deficiency_list || 
    mergedJob["final deficiency list"] ||
    mergedJob.final_deficiency_list_up ||
    mergedJob.workflow_output_4mxgvc0db
  );
  const isCompleted = mergedJob.status === "COMPLETED";
  const availableActions = normalizeActions(mergedJob.available_actions);
  const decisionLower = String(agentDecision || "").toLowerCase();
  const pendingHumanReviewSignals = new Set([
    "pending review",
    "under review",
    "process",
    "pending_human_review",
    "pending human review",
  ]);
  const shouldOfferDefaultHumanActions =
    Boolean(mergedJob.isOffPlatformReview) &&
    availableActions.length === 0 &&
    (String(mergedJob.hitlStatus || "").toUpperCase() === "PENDING" ||
      String(mergedJob.status || "").toUpperCase() === "HITL_PENDING" ||
      pendingHumanReviewSignals.has(decisionLower));
  const finalized = isFinalizedDecision(applicationStatus) && availableActions.length === 0;
  const isProcessing =
    ["IN PROGRESS", "PENDING", "IN_PROGRESS"].includes(mergedJob.status) &&
    availableActions.length === 0;
  let resolvedAvailableActions = [];

  if (finalized) {
    resolvedAvailableActions = [];
  } else if (availableActions.length > 0) {
    resolvedAvailableActions = availableActions;
  } else if (shouldOfferDefaultHumanActions) {
    resolvedAvailableActions = ["approve", "reject", "waitlist", "raise_insufficiency"];
  } else if (isCompleted) {
    resolvedAvailableActions = ["approve", "reject", "waitlist", "raise_insufficiency"];
  }

  // Build completeness flags
  const toCompletenessFlag = (value) => {
    const v = String(value || "").toLowerCase().trim();
    if (v.includes("present") || v.includes("green") || v.includes("yes")) return `${value} ✓`;
    if (v.includes("missing") || v.includes("red") || v.includes("no") || v.includes("not found") || v.includes("absent")) return `${value} ✗`;
    return `${value} —`;
  };

  const completenessFlags =
    mergedJob.completeness_flags && typeof mergedJob.completeness_flags === "object"
      ? mergedJob.completeness_flags
      : {
          "ID and Personal Details": toCompletenessFlag(mergedJob.merged_id_proof_check || mergedJob.id_proof_check || mergedJob["id proof and personal details check"] || mergedJob.id_proof_check_up || mergedJob["id_proof_check_up"] || mergedJob.workflow_output_4f6zv6ezv || "Not available"),
          "Signature": toCompletenessFlag(mergedJob.merged_signature_check || mergedJob.signature_check || mergedJob["signature check"] || mergedJob.signature_check_up || mergedJob["signature_check_up"] || "Not available"),
          "Grade Sheets and Certificates": toCompletenessFlag(mergedJob.merged_grade_sheets_check || mergedJob.grade_sheets_check || mergedJob["grade sheets check"] || mergedJob.grade_sheets_check_up || mergedJob["grade_sheets_check_up"] || mergedJob.workflow_output_ga0k4n971 || "Not available"),
          "LOR Documents": toCompletenessFlag(mergedJob.merged_lor_check || mergedJob.lor_check || mergedJob["lor check"] || mergedJob.lor_check_up || mergedJob["lor_check_up"] || mergedJob.workflow_output_9eyscad0a || "Not available"),
          "Work Experience": toCompletenessFlag(mergedJob.merged_work_experience_check || mergedJob.work_experience_check || mergedJob["work experience check"] || mergedJob.work_experience_check_up || mergedJob["work_experience_check_up"] || mergedJob.workflow_output_pook82hn8 || "Not available"),
        };

  // Gather result texts for LLM classification
  const screeningResultTexts = {
    "GPA Rule": mergedJob.merged_gpa_result || mergedJob.gpa_result || mergedJob["gpa result"] || mergedJob.gpa_result_up || mergedJob["gpa_result_up"] || mergedJob.gpa_flag || mergedJob["gpa flag"] || mergedJob.gpa_flag_up || mergedJob["gpa_flag_up"] || mergedJob.workflow_output_023wrk0az || "Not available",
    "Work Experience Rule": mergedJob.merged_work_experience_result || mergedJob.work_experience_result || mergedJob["work experience result"] || mergedJob.work_experience_result_up || mergedJob["work_experience_result_up"] || mergedJob.work_experience_flag || mergedJob["work experience flag"] || mergedJob.work_experience_flag_up || mergedJob["work_experience_flag_up"] || mergedJob.workflow_output_z9kai3q6o || "Not available",
    "LOR Institution Rule": mergedJob.merged_lor_university_result || mergedJob.lor_university_result || mergedJob["lor_university_result"] || mergedJob.lor_university_result_up || mergedJob["lor_university_result_up"] || mergedJob.lor_university_flag || mergedJob["lor university flag"] || mergedJob.lor_university_flag_up || mergedJob["lor_university_flag_up"] || mergedJob.workflow_output_cvrqcxwzu || "Not available",
    "LOR Recency Rule": mergedJob.merged_lor_date_result || mergedJob.lor_date_result || mergedJob["lor_date_result"] || mergedJob.lor_date_result_up || mergedJob["lor_date_result_up"] || mergedJob.lor_date_flag || mergedJob["lor date flag"] || mergedJob.lor_date_flag_up || mergedJob["lor_date_flag_up"] || mergedJob.workflow_output_pexqqlsbt || "Not available",
  };

  // Use LLM to classify colors; fall back to flag fields if LLM unavailable
  const llmColors = await classifyScreeningFlagsWithLLM(screeningResultTexts);

  const getFlagColor = (ruleName, flagFieldValue, resultText = "") => {
    if (llmColors && llmColors[ruleName]) return llmColors[ruleName];
    const v = String(flagFieldValue || "").toLowerCase().trim();
    if (v === "green") return "green";
    if (v === "red") return "red";
    const text = String(resultText || "").toLowerCase();
    if (!text || text === "not available") return "yellow";
    if (isSkipSignal(text)) return "yellow";
    if (isFailSignal(text)) return "red";
    return "green";
  };

  const toFlagIcon = (color) => {
    if (color === "green") return "✓";
    if (color === "red") return "✗";
    return "—";
  };

  const normalizeExistingScreeningFlags = (existingFlags = {}) => {
    const out = {};
    for (const [ruleName, rawValue] of Object.entries(existingFlags)) {
      const text = String(rawValue || "Not available").trim();
      if (/[✓✗—]$/.test(text)) {
        out[ruleName] = text;
        continue;
      }
      const icon = toFlagIcon(getFlagColor(ruleName, "", text));
      out[ruleName] = `${text} ${icon}`;
    }
    return out;
  };

  const screeningFlags =
    mergedJob.screening_flags && typeof mergedJob.screening_flags === "object"
      ? normalizeExistingScreeningFlags(mergedJob.screening_flags)
      : {
          "GPA Rule": `${screeningResultTexts["GPA Rule"]} ${toFlagIcon(getFlagColor("GPA Rule", mergedJob.gpa_flag || mergedJob["gpa flag"] || mergedJob.gpa_flag_up, screeningResultTexts["GPA Rule"]))}`,
          "Work Experience Rule": `${screeningResultTexts["Work Experience Rule"]} ${toFlagIcon(getFlagColor("Work Experience Rule", mergedJob.work_experience_flag || mergedJob["work experience flag"] || mergedJob.work_experience_flag_up, screeningResultTexts["Work Experience Rule"]))}`,
          "LOR Institution Rule": `${screeningResultTexts["LOR Institution Rule"]} ${toFlagIcon(getFlagColor("LOR Institution Rule", mergedJob.lor_university_flag || mergedJob["lor university flag"] || mergedJob.lor_university_flag_up, screeningResultTexts["LOR Institution Rule"]))}`,
          "LOR Recency Rule": `${screeningResultTexts["LOR Recency Rule"]} ${toFlagIcon(getFlagColor("LOR Recency Rule", mergedJob.lor_date_flag || mergedJob["lor date flag"] || mergedJob.lor_date_flag_up, screeningResultTexts["LOR Recency Rule"]))}`,
        };

  return {
    thread_id: String(mergedJob.jobId),
    student_id: String(mergedJob.studentId || ""),
    job_status: mergedJob.status || "NOT_STARTED",
    is_processing: isProcessing,
    decision: agentDecision,
    agent_decision: isProcessing ? "Under Review" : agentDecision,
    final_decision: finalDecision,
    application_status: applicationStatus,
    // Prefer the explicit mergedJob.flagged_or_verified set by buildHitlTaskFromWebhook
    // (populated from DS's output during HITL dispatch) before falling back to
    // post-workflow output keys, update case fields, or a status-based default.
    flagged_or_verified:
      merged.merged_flagged_or_verified ||
      mergedJob.flagged_or_verified ||
      mergedJob["flagged/verified"] ||
      mergedJob.workflow_output_izvdziwj0 ||
      mergedJob.workflow_output_akfo7j55t ||
      // Fallback for update case path
      mergedJob.flagged_verified_up ||
      (isCompleted ? "Flagged" : "In Progress"),
    case_status: caseStatus,
    completeness_flags: completenessFlags,
    screening_flags: screeningFlags,
    deficiency_list: deficiencyList,
    reason:
      merged.merged_final_reason ||
      mergedJob.reason ||
      mergedJob.final_reason ||
      mergedJob["decision of agent"] ||
      mergedJob.final_reason_up ||
      deficiencyList.join("; ") ||
      "No deficiencies.",
    available_actions: resolvedAvailableActions,
    expected_output_schema: mergedJob.hitlExpectedOutputSchema?.schema || null,
    hitl_status: mergedJob.hitlStatus || null,
    last_updated: new Date().toISOString(),
  };
};

const hasScreeningData = (job = {}) => {
  const status = String(job.status || "").toUpperCase();
  if (
    ["IN PROGRESS", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "REVIEW_READY"].includes(
      status
    )
  ) {
    return true;
  }

  if (normalizeActions(job.available_actions).length > 0) {
    return true;
  }

  return Object.keys(job).some((key) => key.startsWith("workflow_output_"));
};

const buildRealtimeCasePayload = async (job) => ({
  case_info: toCaseInfo(job),
  screening_result: hasScreeningData(job) ? await toScreeningResult(job) : null,
});

const toHumanDecisionResult = (decisionAction, existingJob = {}) => {
  const mapping = {
    approve: {
      decision: "Selected",
      application_status: "Selected",
      case_status: "Closed",
    },
    reject: {
      decision: "Deny",
      application_status: "Deny",
      case_status: "Closed",
    },
    waitlist: {
      decision: "Waitlisted",
      application_status: "Waitlisted",
      case_status: "Open",
    },
    raise_insufficiency: {
      decision: "Incomplete Application",
      application_status: "Incomplete Application",
      case_status: "Open",
    },
  };

  return mapping[decisionAction] || {
    decision: resolveDecision(existingJob),
    application_status: resolveDecision(existingJob),
    case_status: resolveCaseStatus(existingJob),
  };
};

const findLatestJobByStudentId = (studentId) => {
  const jobs = getAllJobs();

  const getSortWeight = (job = {}) => {
    const offPlatformLinkedAt = Date.parse(job?.offPlatformLinkedAt || "");
    if (Number.isFinite(offPlatformLinkedAt)) {
      return offPlatformLinkedAt;
    }

    const submittedTime = Date.parse(job?.submittedAt || "");
    if (Number.isFinite(submittedTime)) {
      return submittedTime;
    }

    const numericJobId = Number(job?.jobId);
    if (Number.isFinite(numericJobId)) {
      return numericJobId;
    }

    return 0;
  };

  const getPriorityScore = (job = {}) => {
    const actions = normalizeActions(job.available_actions);
    const hitlPending =
      String(job.status || "").toUpperCase() === "HITL_PENDING" ||
      String(job.hitlStatus || "").toUpperCase() === "PENDING";
    if (actions.length > 0 || hitlPending) {
      return 2;
    }

    const inProgress = ["IN PROGRESS", "IN_PROGRESS", "PENDING"].includes(
      String(job.status || "").toUpperCase()
    );
    if (inProgress) {
      return 1;
    }

    return 0;
  };

  const matches = jobs
    .filter((job) => String(job.studentId) === String(studentId))
    .sort((a, b) => {
      const byPriority = getPriorityScore(b) - getPriorityScore(a);
      if (byPriority !== 0) {
        return byPriority;
      }
      return getSortWeight(b) - getSortWeight(a);
    });

  return matches[0] || null;
};

const isWebhookRequestAuthorized = (req) => {
  if (!WEBHOOK_SECRET) {
    return true;
  }

  for (const headerName of WEBHOOK_SECRET_HEADERS) {
    const incoming = req.headers?.[headerName];
    if (incoming && String(incoming) === WEBHOOK_SECRET) {
      return true;
    }
  }

  const authHeader = String(req.headers?.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token === WEBHOOK_SECRET) {
      return true;
    }
  }

  return false;
};

const buildOffPlatformReviewJob = (payload = {}) => {
  const offPlatformThreadId =
    deepFindValue(payload, [
      "thread_id",
      "threadId",
      "jobExecutionId",
      "job_execution_id",
      "execution_id",
      "id",
    ]) ||
    `${Date.now()}`;

  const studentId =
    deepFindValue(payload, [
      "student_id",
      "studentId",
      "candidate_id",
      "applicant_id",
    ]) || `off-platform-${offPlatformThreadId}`;

  const applicantName =
    deepFindValue(payload, ["applicant_name", "applicantName", "candidate_name", "name"]) ||
    `Applicant ${studentId}`;

  const requestType =
    deepFindValue(payload, ["request_type", "requestType", "type"]) || "Off Platform Review";

  const decision =
    deepFindValue(payload, ["decision", "application_status", "current_decision"]) ||
    "Pending Review";

  const caseStatus =
    deepFindValue(payload, ["case_status", "caseStatus"]) || "Open";

  const reason =
    deepFindValue(payload, ["reason", "review_reason", "notes", "comment"]) || "Pending human review";

  const availableActions = normalizeActions(
    deepFindValue(payload, ["available_actions", "availableActions", "actions", "allowed_actions"])
  );

  const callbackUrl =
    deepFindValue(payload, ["callback_url", "callbackUrl", "resume_url", "resumeUrl"]) || "";
  const callbackMethod =
    deepFindValue(payload, ["callback_method", "callbackMethod", "method"]) || "POST";
  const callbackHeaders =
    parseObject(deepFindValue(payload, ["callback_headers", "callbackHeaders"])) || {};

  const flags = deriveReviewFlags(payload);

  const normalizedThreadId =
    toCleanText(offPlatformThreadId, "") || `off-platform-${Date.now()}`;
  const normalizedStudentId =
    toCleanText(studentId, "") || `off-platform-${normalizedThreadId}`;
  const normalizedApplicantName =
    toCleanText(applicantName, "") || `Applicant ${normalizedStudentId}`;
  const normalizedRequestType =
    toCleanText(requestType, "Off Platform Review") || "Off Platform Review";
  const normalizedDecision = toCleanText(decision, "Pending Review") || "Pending Review";
  const normalizedCaseStatus = toCleanText(caseStatus, "Open") || "Open";
  const normalizedReason = toCleanText(reason, "Pending human review") || "Pending human review";
  const normalizedCallbackUrl = toCleanText(callbackUrl, "");
  const normalizedCallbackMethod = toCleanText(callbackMethod, "POST") || "POST";
  const pendingHumanReviewSignals = new Set([
    "pending review",
    "under review",
    "process",
    "pending_human_review",
    "pending human review",
  ]);

  let resolvedAvailableActions = [];
  if (availableActions.length > 0) {
    resolvedAvailableActions = availableActions;
  } else if (pendingHumanReviewSignals.has(String(normalizedDecision || "").toLowerCase())) {
    resolvedAvailableActions = ["approve", "reject", "waitlist", "raise_insufficiency"];
  }

  const resolvedStatus = resolvedAvailableActions.length > 0 ? "HITL_PENDING" : "COMPLETED";

  return {
    offPlatformThreadId: normalizedThreadId,
    studentId: normalizedStudentId,
    applicant_name: normalizedApplicantName,
    request_type: normalizedRequestType,
    application_status: normalizedDecision,
    case_status: normalizedCaseStatus,
    decision: normalizedDecision,
    reason: normalizedReason,
    status: resolvedStatus,
    available_actions: resolvedAvailableActions,
    deficiency_list: parseList(
      deepFindValue(payload, ["deficiency_list", "deficiencyList", "deficiencies"])
    ),
    attachments:
      toCleanText(deepFindValue(payload, ["attachments", "documents", "file_name", "fileName"]), "") ||
      "Off-platform submission",
    isOffPlatformReview: true,
    offPlatformCallbackUrl: normalizedCallbackUrl,
    offPlatformCallbackMethod: normalizedCallbackMethod.toUpperCase(),
    offPlatformCallbackHeaders: callbackHeaders,
    offPlatformPayload: payload,
    submittedAt: new Date().toLocaleString("en-GB"),
    ...flags,
  };
};

/**
 * Extract a purely numeric Opus jobExecutionId from the webhook payload.
 * Opus numeric IDs are 4+ digit integers (e.g. 65204).  UUIDs contain hyphens
 * and are therefore excluded.  Returns null when nothing numeric is found.
 */
const extractNumericJobId = (payload = {}) => {
  const keys = [
    "jobExecutionId",
    "job_execution_id",
    "executionId",
    "execution_id",
    "thread_id",
    "threadId",
  ];
  for (const key of keys) {
    const val = deepFindValue(payload, [key]);
    const text = toCleanText(val, "");
    if (/^\d{4,}$/.test(text)) return text;
  }
  return null;
};

const findBestCandidateForOffPlatformReview = (jobs = []) => {
  const candidates = jobs
    .filter((job) => {
      if (job.isOffPlatformReview) return false;
      if (isSyntheticOffPlatformStudentId(job.studentId)) return false;

      const status = String(job.status || "").toUpperCase();
      const decision = String(resolveDecision(job) || "").toLowerCase();
      const hasActions = normalizeActions(job.available_actions).length > 0;

      // A completed screening waiting for human-review webhook usually lands here.
      return (
        status === "COMPLETED" &&
        !hasActions &&
        ["pending review", "process", "under review", ""].includes(decision)
      );
    })
    .sort((a, b) => Number(b.jobId || 0) - Number(a.jobId || 0));

  return candidates[0] || null;
};

const buildOffPlatformMergePayload = (normalized, payload, linkage = {}) => ({
  isOffPlatformReview: true,
  available_actions: normalized.available_actions,
  offPlatformThreadId: normalized.offPlatformThreadId,
  offPlatformCallbackUrl: normalized.offPlatformCallbackUrl,
  offPlatformCallbackMethod: normalized.offPlatformCallbackMethod,
  offPlatformCallbackHeaders: normalized.offPlatformCallbackHeaders,
  offPlatformPayload: payload,
  offPlatformLinkageMethod: linkage.method || "unknown",
  offPlatformLinkageMatchedBy: linkage.matchedBy || "unknown",
  offPlatformLinkedAt: new Date().toISOString(),
  decision: normalized.decision,
  application_status: normalized.application_status,
  case_status: normalized.case_status,
  reason: normalized.reason,
  ...(normalized.deficiency_list?.length ? { deficiency_list: normalized.deficiency_list } : {}),
});

const tryMergeIntoJob = (job, normalized, payload, linkage) => {
  if (!job) return null;
  const updated = updateJobResult(
    String(job.jobId),
    buildOffPlatformMergePayload(normalized, payload, linkage)
  );
  return {
    job: updated,
    linkage_method: linkage?.method || "unknown",
    linkage_matched_by: linkage?.matchedBy || "unknown",
    linked_job_id: String(updated.jobId || ""),
  };
};

const upsertOffPlatformJob = (payload = {}) => {
  const normalized = buildOffPlatformReviewJob(payload);
  const jobs = getAllJobs();

  // 1. Try to match by numeric Opus jobExecutionId so we update the REAL student
  //    job record (which already has all screening / workflow_output_* data) instead
  //    of creating a phantom off-platform entry.
  const opusJobId = extractNumericJobId(payload);
  if (opusJobId) {
    const existingByJobId = jobs.find((j) => String(j.jobId) === opusJobId);
    const mergedByJobId = tryMergeIntoJob(existingByJobId, normalized, payload, {
      method: "job_id",
      matchedBy: opusJobId,
    });
    if (mergedByJobId) return mergedByJobId;
  }

  // 2. Idempotency: re-processing the same webhook UUID should update, not duplicate.
  const existingByThread = jobs.find(
    (job) => String(job.offPlatformThreadId || "") === String(normalized.offPlatformThreadId)
  );

  if (existingByThread) {
    return tryMergeIntoJob(existingByThread, normalized, payload, {
      method: "thread_id",
      matchedBy: String(normalized.offPlatformThreadId || ""),
    });
  }

  // 3. If webhook carries a real student id, merge into that student's latest real job.
  if (!isSyntheticOffPlatformStudentId(normalized.studentId)) {
    const existingByStudent = jobs
      .filter((j) => String(j.studentId || "") === String(normalized.studentId))
      .sort((a, b) => Number(b.jobId || 0) - Number(a.jobId || 0))[0];

    const mergedByStudent = tryMergeIntoJob(existingByStudent, normalized, payload, {
      method: "student_id",
      matchedBy: String(normalized.studentId || ""),
    });
    if (mergedByStudent) return mergedByStudent;
  }

  // 4. Heuristic fallback for Opus payloads that omit student id and numeric job id.
  const candidate = findBestCandidateForOffPlatformReview(jobs);
  const mergedByCandidate = tryMergeIntoJob(candidate, normalized, payload, {
    method: "heuristic_latest_pending_review",
    matchedBy: String(candidate?.jobId || ""),
  });
  if (mergedByCandidate) return mergedByCandidate;

  // 5. Last fallback: Opus sent nothing correlatable – create a synthetic entry.
  const newJobId = String(Date.now());
  const created = createJob({
    ...normalized,
    offPlatformLinkageMethod: "synthetic_fallback",
    offPlatformLinkageMatchedBy: String(normalized.offPlatformThreadId || ""),
    offPlatformLinkedAt: new Date().toISOString(),
    jobId: newJobId,
    groupId: null,
    isSecondaryWorkflowExecuted: false,
  });

  return {
    job: created,
    linkage_method: "synthetic_fallback",
    linkage_matched_by: String(normalized.offPlatformThreadId || ""),
    linked_job_id: String(created.jobId || ""),
  };
};

const notifyOffPlatformDecision = async (job, action, mappedDecision) => {
  const callbackUrl = String(job.offPlatformCallbackUrl || "").trim();
  if (!callbackUrl) {
    return;
  }

  const callbackHeaders = {
    "Content-Type": "application/json",
    ...parseObject(job.offPlatformCallbackHeaders),
  };

  const body = {
    thread_id: String(job.offPlatformThreadId || job.jobId),
    human_decision: action,
    decision: mappedDecision.decision,
    application_status: mappedDecision.application_status,
    case_status: mappedDecision.case_status,
    student_id: String(job.studentId || ""),
  };

  await axios({
    method: String(job.offPlatformCallbackMethod || "POST").toLowerCase(),
    url: callbackUrl,
    headers: callbackHeaders,
    data: body,
    timeout: 20000,
  });
};

const watchJobCompletion = (jobExecutionId) => {
  if (activeJobWatchers.has(jobExecutionId)) {
    return;
  }

  const watchPromise = (async () => {
    try {
      const { status, result } = await pollAuditUntilDone(jobExecutionId);

      if (status === "REVIEW_READY") {
        // The workflow is parked at the Off-Platform Review node.
        // Persist the extracted evaluation flags (completeness_flags,
        // screening_flags, and any summary fields) without overwriting the
        // job's current status so the candidate profile page shows the real
        // data instead of "Not available".  The job remains "IN PROGRESS"
        // until a human decision arrives via the HITL webhook.
        updateJobResult(String(jobExecutionId), {
          ...result,
          ...mergeWorkflowOutputs(result),
        });
      } else {
        const mergedOutputs = mergeWorkflowOutputs(result);
        updateJobResult(String(jobExecutionId), {
          status: "COMPLETED",
          ...result,
          ...mergedOutputs,
        });
      }
    } catch (error) {
      updateJobResult(String(jobExecutionId), {
        status: "FAILED",
        failure_reason: error.message || "Job monitoring failed",
      });
    } finally {
      activeJobWatchers.delete(jobExecutionId);
    }
  })();

  activeJobWatchers.set(jobExecutionId, watchPromise);
};

const uploadLocalExcelToOpus = async (localPath) => {
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error("Local Excel file was not found in backend data folder");
  }

  const extension = path.extname(localPath).replace(".", "").toLowerCase() || "xlsx";
  const { presignedUrl, fileUrl } = await getPresignedUrl(extension);

  const fileBuffer = fs.readFileSync(localPath);
  await axios.put(presignedUrl, fileBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": fileBuffer.length,
    },
  });

  return fileUrl;
};

const resolveLocalExcelSourcePath = (job = {}) => {
  const candidatePaths = [
    job.localFilePath,
    job.fileName ? path.join(path.dirname(excelFilePath), String(job.fileName)) : null,
    excelFilePath,
  ];

  for (const candidate of candidatePaths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const runPrimaryWorkflowForStudent = async (studentId) => {
  ensureSeedDataFromExcel();
  let existing = findLatestJobByStudentId(studentId);
  if (!existing) {
    throw new Error("Student was not found in Excel metadata");
  }

  const hasPendingHumanReview =
    (Boolean(existing.isOffPlatformReview) || String(existing.status || "") === "HITL_PENDING") &&
    normalizeActions(existing.available_actions).length > 0;

  if (hasPendingHumanReview) {
    return existing;
  }

  // If job is already in progress or completed, return it (idempotency)
  if (["IN PROGRESS", "COMPLETED"].includes(existing.status)) {
    return existing;
  }

  if (!existing.fileUrl) {
    const localSourcePath = resolveLocalExcelSourcePath(existing);
    if (!localSourcePath) {
      throw new Error("Applicant source file is missing on server. Please contact support.");
    }
    const fileUrl = await uploadLocalExcelToOpus(localSourcePath);
    existing = updateJobResult(String(existing.jobId), {
      fileUrl,
      fileName: path.basename(localSourcePath),
      localFilePath: localSourcePath,
    });
  }

  const workflowData = await getWorkflowSchema(WORKFLOW_ID_PRIMARY);
  const schema = extractWorkflowInputSchema(workflowData);
  if (!schema) {
    throw new Error("Workflow input schema was not found in Opus response");
  }

  const payloadInstance = buildPayloadInstance(schema, {
    studentId: String(studentId),
    crm_input_file: existing.fileUrl,
  });

  const { jobExecutionId } = await initiateJob(
    WORKFLOW_ID_PRIMARY,
    "UI Triggered Screening",
    `Screening for student ${studentId}`
  );

  // Fresh screening run — do NOT carry over the seed Excel's decision /
  // reason / case_status. Those are pre-screening defaults (often
  // "Incomplete Application" / "Closed" from prior data) and showing them on
  // a freshly-triggered case incorrectly tells the reviewer the result before
  // the workflow has produced anything. Reset to in-progress defaults so the
  // UI shows "Under Review" until the workflow updates them.
  createJob({
    jobId: String(jobExecutionId),
    isSecondaryWorkflowExecuted: false,
    fileUrl: existing.fileUrl,
    fileName: existing.fileName,
    localFilePath: existing.localFilePath,
    applicant_name: existing.applicant_name,
    request_type: existing.request_type,
    attachments: existing.attachments,
    email: existing.email,
    decision: "Pending Review",
    reason: "",
    case_status: "Open",
    application_status: "Under Review",
    studentId: String(studentId),
    groupId: existing.groupId || null,
    status: "IN PROGRESS",
    submittedAt: new Date().toLocaleString("en-GB"),
  });

  await executeJob(jobExecutionId, payloadInstance);
  watchJobCompletion(String(jobExecutionId));

  return getAllJobs().find((item) => String(item.jobId) === String(jobExecutionId));
};

export const getInboxController = async (_req, res) => {
  try {
    res.status(200).json(getInboxCasesSnapshot());
  } catch (error) {
    res.status(500).json({ detail: error.message || "Failed to fetch inbox" });
  }
};

const getInboxCasesSnapshot = () => {
  ensureSeedDataFromExcel();
  const jobs = getAllJobs().sort((a, b) => Number(b.jobId) - Number(a.jobId));

  const realThreadIds = new Set(
    jobs
      .filter(
        (job) =>
          String(job.offPlatformThreadId || "").trim() &&
          !isSyntheticOffPlatformStudentId(job.studentId)
      )
      .map((job) => String(job.offPlatformThreadId))
  );

  const dedupedJobs = jobs.filter((job) => {
    const threadId = String(job.offPlatformThreadId || "").trim();
    if (!threadId) return true;
    if (!isSyntheticOffPlatformStudentId(job.studentId)) return true;
    return !realThreadIds.has(threadId);
  });

  const seenStudentIds = new Set();
  const uniqueByStudent = [];

  for (const job of dedupedJobs) {
    const studentId = String(job.studentId || "").trim();
    if (!studentId || seenStudentIds.has(studentId)) {
      continue;
    }
    seenStudentIds.add(studentId);
    uniqueByStudent.push(job);
  }

  return uniqueByStudent.map(toInboxCase);
};

export const streamInboxUpdatesController = async (_req, res) => {
  ensureSeedDataFromExcel();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const writeEvent = (eventName, payload) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendSnapshot = () => {
    writeEvent("snapshot", {
      cases: getInboxCasesSnapshot(),
    });
  };

  sendSnapshot();

  const events = getJobEvents();
  const onJobUpdate = (eventPayload) => {
    writeEvent("job-update", {
      type: eventPayload?.type || "updated",
      cases: getInboxCasesSnapshot(),
    });
  };

  events.on("job:update", onJobUpdate);

  const heartbeat = setInterval(() => {
    writeEvent("heartbeat", { ts: Date.now() });
  }, 15000);

  res.req.on("close", () => {
    clearInterval(heartbeat);
    events.off("job:update", onJobUpdate);
    res.end();
  });
};

export const getCaseStatusController = async (req, res) => {
  try {
    ensureSeedDataFromExcel();
    const job = findLatestJobByStudentId(req.params.studentId);
    if (!job) {
      return res.status(404).json({ detail: "Case not found" });
    }

    return res.status(200).json(toCaseInfo(job));
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Failed to fetch case" });
  }
};

export const getLatestScreeningResultController = async (req, res) => {
  try {
    ensureSeedDataFromExcel();
    const studentId = String(req.params.studentId || "").trim();
    let job = findLatestJobByStudentId(studentId);

    if (!job) {
      return res.status(404).json({ detail: "Case not found" });
    }

    // On-read refresh: if the job is parked at REVIEW_READY or still IN PROGRESS,
    // do a quick status check against OPUS. If the workflow has reached COMPLETED
    // (i.e. the human review was submitted and Agent 7 / Output ran), fetch the
    // final result and persist it so the candidate page reflects the decision.
    const refreshableStatuses = ["REVIEW_READY", "IN PROGRESS", "IN_PROGRESS"];
    if (refreshableStatuses.includes(job.status) && job.jobId && /^\d{4,}$/.test(String(job.jobId))) {
      try {
        const statusPayload = await getJobStatus(String(job.jobId));
        if (statusPayload?.status === "COMPLETED") {
          const resultPayload = await getJobResult(String(job.jobId));
          const keyedResult = toKeyedResult(resultPayload);
          job = updateJobResult(String(job.jobId), {
            status: "COMPLETED",
            ...keyedResult,
            ...mergeWorkflowOutputs(keyedResult),
          });
        }
      } catch {
        // Status check failed; serve stale data gracefully.
      }
    }

    return res.status(200).json(await buildRealtimeCasePayload(job));
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Failed to fetch screening result" });
  }
};

export const streamCaseUpdatesController = async (req, res) => {
  ensureSeedDataFromExcel();

  const studentId = String(req.params.studentId || "").trim();
  if (!studentId) {
    return res.status(400).json({ detail: "studentId is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const writeEvent = (eventName, payload) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendSnapshot = async () => {
    const latestJob = findLatestJobByStudentId(studentId);
    if (!latestJob) {
      writeEvent("snapshot", { student_id: studentId, case_info: null, screening_result: null });
      return;
    }

    writeEvent("snapshot", await buildRealtimeCasePayload(latestJob));
  };

  sendSnapshot();

  const events = getJobEvents();
  const onJobUpdate = async (eventPayload) => {
    const updatedJob = eventPayload?.job;
    if (!updatedJob) {
      return;
    }

    if (String(updatedJob.studentId || "") !== studentId) {
      return;
    }

    writeEvent("job-update", {
      type: eventPayload?.type || "updated",
      ...await buildRealtimeCasePayload(updatedJob),
    });
  };

  events.on("job:update", onJobUpdate);

  const heartbeat = setInterval(() => {
    writeEvent("heartbeat", { ts: Date.now() });
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    events.off("job:update", onJobUpdate);
    res.end();
  });
};

export const triggerScreeningController = async (req, res) => {
  const studentId = String(req.params.studentId || "").trim();
  try {
    ensureSeedDataFromExcel();

    if (activeScreeningByStudent.has(studentId)) {
      const inFlight = await activeScreeningByStudent.get(studentId);
      return res.status(200).json(await toScreeningResult(inFlight));
    }

    const runPromise = (async () => {
      return runPrimaryWorkflowForStudent(studentId);
    })();

    activeScreeningByStudent.set(studentId, runPromise);
    const result = await runPromise;
    activeScreeningByStudent.delete(studentId);

    return res.status(200).json(await toScreeningResult(result));
  } catch (error) {
    activeScreeningByStudent.delete(studentId);
    return res.status(500).json({ detail: error.message || "Screening failed" });
  }
};

/**
 * A canonical HITL dispatch carries only a UUID execution id — no student id —
 * so we can't match it to a candidate by id. When the workflow was triggered
 * from our app, the candidate's own screening job is sitting in-flight, parked
 * at the Off-Platform Review node. That job is the one to attach the dispatch
 * to, so the Approve action and agent decision land on the candidate's case
 * page instead of on a standalone "orphan" record.
 *
 * Returns the most-recent real (numeric-id, non-synthetic) screening job that
 * is still running / review-ready, or null when there is none (a genuine
 * off-platform-only review started directly in OPUS).
 */
const findCandidateForHitlDispatch = () => {
  const candidates = getAllJobs().filter((job) => {
    if (job.isOffPlatformReview) return false;
    if (isSyntheticOffPlatformStudentId(job.studentId)) return false;
    if (String(job.studentId || "").toLowerCase().startsWith("hitl-")) return false;
    if (!/^\d{4,}$/.test(String(job.jobId || ""))) return false; // real OPUS numeric id
    const status = String(job.status || "").toUpperCase();
    return ["IN PROGRESS", "IN_PROGRESS", "REVIEW_READY"].includes(status);
  });
  candidates.sort((a, b) => Number(b.jobId || 0) - Number(a.jobId || 0));
  return candidates[0] || null;
};

/**
 * Attach a canonical HITL dispatch to the candidate's in-flight screening job.
 * Preserves the candidate's identity and any audit-derived evaluation flags,
 * and layers on the review action, callback, and expected output schema so the
 * candidate case page renders the Approve / Reject controls and the agent
 * decision. The submit endpoint finds the job by its numeric id (== thread_id),
 * so submitting the decision from the case page fires the dispatch's callback.
 */
const mergeHitlTaskIntoCandidate = (candidate, task, payload) => {
  const hasFlags = (o) => o && typeof o === "object" && Object.keys(o).length > 0;
  const merge = {
    isOffPlatformReview: true,
    status: "HITL_PENDING",
    hitlStatus: task.hitlStatus || "PENDING",
    available_actions: task.available_actions,
    hitlCallback: task.hitlCallback,
    hitlExpectedOutputSchema: task.hitlExpectedOutputSchema,
    hitlExecutionId: task.hitlExecutionId,
    hitlWorkflowId: task.hitlWorkflowId,
    hitlWorkflowName: task.hitlWorkflowName,
    hitlNodeExecutionId: task.hitlNodeExecutionId,
    hitlInputs: task.hitlInputs,
    hitlNodeOutput: task.hitlNodeOutput,
    hitlInputSchema: task.hitlInputSchema,
    hitlNodeOutputSchema: task.hitlNodeOutputSchema,
    hitlWorkflowMeta: task.hitlWorkflowMeta,
    hitlEvaluation: task.hitlEvaluation,
    offPlatformThreadId: task.offPlatformThreadId,
    offPlatformPayload: payload,
    offPlatformLinkageMethod: "candidate_in_flight",
    offPlatformLinkageMatchedBy: String(task.jobId),
    offPlatformLinkedAt: new Date().toISOString(),
    // The dispatch UUID — lets a re-dispatch of the same execution find this
    // candidate again instead of creating a duplicate.
    hitlLinkedExecutionId: String(task.jobId),
    hitlAuditLog: [
      ...(Array.isArray(candidate.hitlAuditLog) ? candidate.hitlAuditLog : []),
      {
        type: "webhook_linked_to_candidate",
        at: new Date().toISOString(),
        execution_id: String(task.jobId),
        candidate_job_id: String(candidate.jobId),
      },
    ],
    // Agent recommendation: prefer the dispatch's view, fall back to candidate.
    decision: task.decision || candidate.decision,
    reason: task.reason || candidate.reason,
    case_status: task.case_status || candidate.case_status,
    application_status: task.application_status || candidate.application_status,
    deficiency_list:
      task.deficiency_list && task.deficiency_list.length
        ? task.deficiency_list
        : candidate.deficiency_list,
    flagged_or_verified: task.flagged_or_verified || candidate.flagged_or_verified,
  };
  // Keep the candidate's audit-derived evaluation cards; only borrow the
  // dispatch's when the candidate has none yet.
  if (!hasFlags(candidate.completeness_flags) && hasFlags(task.completeness_flags)) {
    merge.completeness_flags = task.completeness_flags;
  }
  if (!hasFlags(candidate.screening_flags) && hasFlags(task.screening_flags)) {
    merge.screening_flags = task.screening_flags;
  }
  return updateJobResult(String(candidate.jobId), merge);
};

export const offPlatformReviewWebhookController = async (req, res) => {
  try {
    if (!isWebhookRequestAuthorized(req)) {
      return res.status(401).json({ detail: "Unauthorized webhook request" });
    }

    const payload = req.body || {};

    if (isCanonicalHitlPayload(payload)) {
      const validation = validateHitlWebhookPayload(payload);
      if (!validation.ok) {
        // Log schema warnings but never reject with 400 — Opus marks the node
        // as DISPATCH_FAILED on any 4xx, which permanently breaks the workflow.
        // We accept and process the payload; warnings are for debugging only.
        logWarn("HITL webhook payload has schema warnings (processing anyway)", {
          execution_id: payload.execution_id,
          errors: validation.errors,
        });
      }

      // Async: enrichment fetches workflow definition from OPUS for display labels.
      const task = await buildHitlTaskFromWebhook(payload);

      // 1. Idempotency: a re-dispatch of the same execution — update whichever
      //    record already carries it (a previously-linked candidate, or a
      //    standalone record saved under the execution id).
      const alreadyLinked = getAllJobs().find(
        (item) =>
          String(item.hitlLinkedExecutionId || "") === String(task.jobId) ||
          String(item.jobId || "") === String(task.jobId)
      );

      // 2. Otherwise attach the dispatch to the candidate's in-flight screening
      //    job so the Approve action shows on the candidate's case page.
      const candidate = alreadyLinked ? null : findCandidateForHitlDispatch();

      let saved;
      let linkage;
      if (alreadyLinked) {
        saved = updateJobResult(String(alreadyLinked.jobId), {
          ...task,
          jobId: alreadyLinked.jobId,
          studentId: alreadyLinked.studentId,
          applicant_name: alreadyLinked.applicant_name,
          hitlLinkedExecutionId: String(task.jobId),
          hitlAuditLog: [
            ...(Array.isArray(alreadyLinked.hitlAuditLog) ? alreadyLinked.hitlAuditLog : []),
            {
              type: "webhook_received",
              at: new Date().toISOString(),
              execution_id: String(payload.execution_id),
              workflow_id: String(payload.workflow_id),
            },
          ],
        });
        linkage = "existing";
      } else if (candidate) {
        saved = mergeHitlTaskIntoCandidate(candidate, task, payload);
        linkage = "candidate_in_flight";
      } else {
        // No in-flight candidate — a genuine off-platform-only review. Keep the
        // existing behaviour and create a standalone record.
        saved = createJob(task);
        linkage = "standalone";
      }

      return res.status(202).json({
        message: "HITL task accepted",
        thread_id: String(saved.jobId),
        execution_id: String(saved.hitlExecutionId || saved.jobId),
        student_id: String(saved.studentId || ""),
        available_actions: normalizeActions(saved.available_actions),
        hitl_status: String(saved.hitlStatus || "PENDING"),
        linkage,
      });
    }

    const { job, linkage_method, linkage_matched_by, linked_job_id } = upsertOffPlatformJob(payload);

    return res.status(202).json({
      message: "Off Platform Review task accepted",
      thread_id: String(job.jobId),
      student_id: String(job.studentId || ""),
      available_actions: normalizeActions(job.available_actions),
      linkage_method,
      linkage_matched_by,
      linked_job_id,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ detail: error.message || "Failed to process Off Platform Review webhook" });
  }
};

export const getPendingOffPlatformReviewController = async (_req, res) => {
  try {
    ensureSeedDataFromExcel();

    const records = getAllJobs()
      .filter(
        (job) =>
          Boolean(job.isOffPlatformReview) &&
          normalizeActions(job.available_actions).length > 0
      )
      .sort((a, b) => {
        const aTs = Date.parse(a.offPlatformLinkedAt || a.submittedAt || "") || 0;
        const bTs = Date.parse(b.offPlatformLinkedAt || b.submittedAt || "") || 0;
        return bTs - aTs;
      })
      .map((job) => ({
        thread_id: String(job.jobId || ""),
        execution_id: String(job.hitlExecutionId || job.jobId || ""),
        student_id: String(job.studentId || ""),
        applicant_name: resolveApplicantName(job),
        case_status: resolveCaseStatus(job),
        decision: resolveDecision(job),
        available_actions: normalizeActions(job.available_actions),
        hitl_status: String(job.hitlStatus || "PENDING"),
        submitted_at: String(job.submittedAt || ""),
      }));

    return res.status(200).json({ count: records.length, records });
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Failed to fetch pending HITL tasks" });
  }
};

export const getOffPlatformReviewDetailController = async (req, res) => {
  try {
    ensureSeedDataFromExcel();

    const threadId = String(req.params.threadId || "").trim();
    const job = getAllJobs().find((item) => String(item.jobId || "") === threadId);

    if (!job) {
      return res.status(404).json({ detail: "HITL task not found" });
    }

    return res.status(200).json({
      thread_id: String(job.jobId || ""),
      execution_id: String(job.hitlExecutionId || job.jobId || ""),
      workflow_id: String(job.hitlWorkflowId || ""),
      workflow_name: String(job.hitlWorkflowName || ""),
      node_execution_id: String(job.hitlNodeExecutionId || ""),
      student_id: String(job.studentId || ""),
      applicant_name: resolveApplicantName(job),
      case_status: resolveCaseStatus(job),
      decision: resolveDecision(job),
      available_actions: normalizeActions(job.available_actions),
      submitted_at: job.submittedAt || null,

      // Raw upstream-node data from the dispatch (what the reviewer needs to judge).
      input_context: job.hitlInputs || {},
      node_output: job.hitlNodeOutput || {},
      input_schema: job.hitlInputSchema || {},
      node_output_schema: job.hitlNodeOutputSchema || {},
      process: job.hitlProcess || {},

      // Workflow + node metadata fetched from the OPUS Reference Workflow API.
      // Provides display names + descriptions so the FE can render labels
      // instead of bare variable_name keys. May be null if the fetch failed.
      workflow_meta: job.hitlWorkflowMeta || null,

      // Reviewer-facing schema for the form widgets to render.
      expected_output_schema: job.hitlExpectedOutputSchema || null,

      hitl_status: String(job.hitlStatus || "PENDING"),

      // Last callback attempt — present after the reviewer has submitted at
      // least once. Used to surface OPUS errors and show the request preview.
      last_callback_status: job.hitlLastCallbackStatus || null,
      last_callback_response: job.hitlLastCallbackResponseBody || null,
      last_callback_payload: job.hitlLastCallbackPayload || null,

      audit_log: Array.isArray(job.hitlAuditLog) ? job.hitlAuditLog : [],
    });
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Failed to fetch HITL task detail" });
  }
};

export const getOffPlatformReviewAuditController = async (req, res) => {
  try {
    ensureSeedDataFromExcel();
    const requestedLimit = Number(req.query?.limit || 20);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
      : 20;

    const records = getAllJobs()
      .filter(
        (job) =>
          Boolean(job.isOffPlatformReview) ||
          Boolean(String(job.offPlatformThreadId || "").trim()) ||
          Boolean(String(job.offPlatformLinkageMethod || "").trim())
      )
      .sort((a, b) => {
        const aTs = Date.parse(a.offPlatformLinkedAt || "") || Number(a.jobId || 0);
        const bTs = Date.parse(b.offPlatformLinkedAt || "") || Number(b.jobId || 0);
        return bTs - aTs;
      })
      .slice(0, limit)
      .map((job) => ({
        job_id: String(job.jobId || ""),
        student_id: String(job.studentId || ""),
        applicant_name: resolveApplicantName(job),
        is_synthetic_student: isSyntheticOffPlatformStudentId(job.studentId),
        off_platform_thread_id: String(job.offPlatformThreadId || ""),
        linkage_method: String(job.offPlatformLinkageMethod || ""),
        linkage_matched_by: String(job.offPlatformLinkageMatchedBy || ""),
        linked_at: String(job.offPlatformLinkedAt || ""),
        available_actions: normalizeActions(job.available_actions),
        decision: resolveDecision(job),
        case_status: resolveCaseStatus(job),
        status: String(job.status || ""),
      }));

    return res.status(200).json({ count: records.length, records });
  } catch (error) {
    return res
      .status(500)
      .json({ detail: error.message || "Failed to fetch Off Platform Review audit" });
  }
};

export const submitHumanDecisionController = async (req, res) => {
  try {
    ensureSeedDataFromExcel();
    const threadId = String(req.params.threadId);
    const action = req.body?.human_decision;

    const job = getAllJobs().find((item) => String(item.jobId) === threadId);
    if (!job) {
      return res.status(404).json({ detail: "Screening thread not found" });
    }

    const reviewerOutput =
      req.body?.reviewer_output && typeof req.body.reviewer_output === "object"
        ? req.body.reviewer_output
        : {};

    const mapped = toHumanDecisionResult(action, job);

    if (job.isOffPlatformReview && job.hitlCallback?.url) {
      const validation = buildAndValidateHitlOutput({
        expectedOutputSchema: job.hitlExpectedOutputSchema || {},
        reviewerOutput,
        humanDecision: action,
        hitlInputs: job.hitlInputs || {},
        hitlNodeOutput: job.hitlNodeOutput || {},
      });

      if (!validation.ok) {
        return res.status(400).json({
          detail: "Reviewer output does not match expected_output_schema",
          errors: validation.errors,
        });
      }

      // The reviewer's decision (approve/reject/etc.) is a business outcome encoded
      // in output_data. The callback's `status` reflects whether the review itself
      // succeeded as a technical handshake — always "success" here unless the action
      // explicitly signals an inability to complete.
      const callbackResult = await sendHitlCallback({
        callback: job.hitlCallback,
        callbackOutput: validation.callbackOutput,
        status: "success",
      });

      const updatedHitlAudit = [
        ...(Array.isArray(job.hitlAuditLog) ? job.hitlAuditLog : []),
        {
          type: "review_submitted",
          at: new Date().toISOString(),
          human_decision: action,
          reviewer_output: reviewerOutput,
          callback_output: validation.callbackOutput,
          callback_status: callbackResult.status,
          callback_ok: callbackResult.ok,
        },
      ];

      const hitlStatus = callbackResult.ok ? "SUBMITTED" : "CALLBACK_FAILED";

      const updated = updateJobResult(threadId, {
        // Only mark the decision as final if OPUS accepted the callback. If OPUS
        // rejected it, the workflow is still paused — surfacing the decision as
        // final in our UI would mislead the reviewer into thinking it stuck.
        ...(callbackResult.ok
          ? {
              decision: mapped.decision,
              application_status: mapped.application_status,
              case_status: mapped.case_status,
              human_final_decision: mapped.decision,
              human_final_application_status: mapped.application_status,
              human_final_case_status: mapped.case_status,
              workflow_output_p1e47k0wq: mapped.application_status,
              workflow_output_i7abcyo03: mapped.application_status,
              available_actions: [],
              status: "COMPLETED",
            }
          : {}),
        hitlStatus,
        hitlLastOutput: validation.outputByVarName,
        hitlLastCallbackPayload: callbackResult.sentBody,
        hitlLastCallbackStatus: callbackResult.status,
        hitlLastCallbackResponseBody: callbackResult.data,
        hitlAuditLog: updatedHitlAudit,
        offPlatformDecisionSubmittedAt: new Date().toISOString(),
      });

      if (!callbackResult.ok) {
        // Surface OPUS's status code and body so the FE can render a meaningful
        // message ("review expired" for 401, "validation failed" for 400, etc.)
        // instead of a generic 500.
        return res.status(502).json({
          detail: "OPUS rejected the callback",
          opus_status: callbackResult.status,
          opus_body: callbackResult.data,
          sent_body: callbackResult.sentBody,
          thread_id: threadId,
          hitl_status: hitlStatus,
        });
      }

      return res.status(200).json({
        decision: mapped.decision,
        application_status: mapped.application_status,
        case_status: mapped.case_status,
        thread_id: threadId,
        student_id: String(updated.studentId || ""),
        hitl_status: "SUBMITTED",
        callback_status: callbackResult.status,
      });
    }

    if (job.isOffPlatformReview) {
      await notifyOffPlatformDecision(job, action, mapped);
    }

    const updated = updateJobResult(threadId, {
      decision: mapped.decision,
      application_status: mapped.application_status,
      case_status: mapped.case_status,
      human_final_decision: mapped.decision,
      human_final_application_status: mapped.application_status,
      human_final_case_status: mapped.case_status,
      workflow_output_p1e47k0wq: mapped.application_status,
      workflow_output_i7abcyo03: mapped.application_status,
      available_actions: [],
      status: "COMPLETED",
      offPlatformDecisionSubmittedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      decision: mapped.decision,
      application_status: mapped.application_status,
      case_status: mapped.case_status,
      thread_id: threadId,
      student_id: String(updated.studentId || ""),
    });
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Decision submission failed" });
  }
};

export const resetJobsController = async (_req, res) => {
  try {
    resetJobs();
    return res.status(200).json({ message: "Jobs reset successful" });
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Reset failed" });
  }
};

/* ── Document Rename Controller ────────────────────────────────────────────── */

/**
 * Rename student documents via FastAPI service
 * POST /rename/student
 * Body: { student_name, student_id }
 */
export const renameStudentDocumentsController = async (req, res) => {
  try {
    const { student_name, student_id } = req.body;

    if (!student_name || !student_id) {
      return res.status(400).json({
        detail: "student_name and student_id are required.",
      });
    }

    const result = await renameStudentDocuments(student_name, student_id);
    return res.status(200).json(result);
  } catch (error) {
    const status = error?.response?.status || 500;
    const detail =
      error?.response?.data?.detail ||
      error.message ||
      "Document rename failed";
    return res.status(status).json({ detail });
  }
};
