import axios from "axios";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { opusHitlWebhookSchema } from "../schemas/opusHitlWebhookSchema.js";
import { buildWorkflowReviewMeta, getV2WorkflowObject } from "./opusWorkflowService.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validateIncomingWebhook = ajv.compile(opusHitlWebhookSchema);

// OPUS dispatches use a mix of Python-style aliases ("str", "int", "bool") and the
// canonical wire names from the integration guide ("string", "integer", "boolean").
// We normalize for validation only — the type echoed back in the callback is the
// dispatch's own allowed_types entry verbatim, so OPUS sees its own names.
const TYPE_ALIASES = {
  str: "string",
  string: "string",
  text: "string",
  float: "number",
  double: "number",
  decimal: "number",
  int: "integer",
  integer: "integer",
  bool: "boolean",
  boolean: "boolean",
  null: "null",
};

const SCALAR_DEFAULTS = {
  string: "",
  number: 0,
  integer: 0,
  boolean: false,
  null: null,
};

const normalizeType = (value) => TYPE_ALIASES[String(value || "").toLowerCase()] || null;

const readTyped = (source, key) => {
  const safeSource = source && typeof source === "object" ? source : {};
  const item = safeSource[key];
  if (item && typeof item === "object" && Object.hasOwn(item, "value")) {
    return item.value;
  }
  return item;
};

// Pick the first non-empty value from multiple candidate keys. Lets us read
// the review_node.value blob whether OPUS uses `inputs/outputs` (per the
// integration guide) or `input/output` (observed in older dispatches).
const firstObject = (...candidates) => {
  for (const c of candidates) {
    if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length > 0) {
      return c;
    }
  }
  // Fall back to first non-null even if empty, so callers still get an object.
  for (const c of candidates) {
    if (c && typeof c === "object" && !Array.isArray(c)) {
      return c;
    }
  }
  return {};
};

const firstString = (...candidates) => {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return "";
};

// Off-platform-review nodes can declare extra inputs (beyond the canonical
// `review_node`) that are wired from sibling upstream nodes. The dispatched
// payload contains these under random `workflow_input_*` keys; the workflow's
// input_schema gives each one a friendly `display_name`. This map flips that
// around so we can look values up by their friendly name.
// Index the dispatched non-`review_node` inputs by THREE keys so downstream
// matching is robust no matter how the workflow author labelled things on
// the review node:
//
//   1. Canonical source variable_name from workflow_meta.sibling_inputs
//      (e.g. Agent 6's "id_proof_and_personal_details_check") — strongest
//      key, survives display_name renames and typos.
//   2. The review-node input's display_name (workflow_meta.review_node.input_schema)
//      — works when the author wired and labelled them consistently.
//   3. The raw dispatch key (e.g. "workflow_input_pcmb1pswv") — last resort.
//
// All three point at the same raw value; the caller can ask by whichever key
// it prefers via `lookup(byCanonical, byDisplay, byKey)` semantics.
const buildReviewInputIndex = (workflowMeta, payloadInputs) => {
  const reviewInputSchema = workflowMeta?.review_node?.input_schema || {};
  const siblings = workflowMeta?.sibling_inputs || {};
  const byCanonical = {}; // upstream-variable_name -> value
  const byDisplay = {};   // review-node display_name -> value
  const byKey = {};       // raw dispatch key -> value

  for (const [key, typedValue] of Object.entries(payloadInputs || {})) {
    if (key === "review_node") continue;
    const raw = typedValue && typeof typedValue === "object" && "value" in typedValue
      ? typedValue.value
      : typedValue;

    byKey[key] = raw;

    const display = reviewInputSchema[key]?.display_name;
    if (display) byDisplay[display] = raw;

    const canonical = siblings[key]?.source_variable_name;
    if (canonical) byCanonical[canonical] = raw;
  }

  return { byCanonical, byDisplay, byKey };
};

// Pull a value out of the index by trying canonical name first, then any
// display name aliases, then any raw-key aliases. Returns undefined if no
// match.
const lookupInput = (index, { canonical, displays = [], keys = [] }) => {
  if (canonical && index.byCanonical[canonical] !== undefined) {
    return index.byCanonical[canonical];
  }
  for (const d of displays) {
    if (index.byDisplay[d] !== undefined) return index.byDisplay[d];
  }
  for (const k of keys) {
    if (index.byKey[k] !== undefined) return index.byKey[k];
  }
  return undefined;
};

// Convert a value (often a string like "ID and personal details verified" or
// "GPA above 3.0") into a uniform "<text> ✓" / "<text> ✗" the existing
// AgentResultPanel renders into a pass/fail tile.
const toFlagText = (value) => {
  if (value === null || value === undefined || value === "") return "Not available ✗";
  const text = String(value).trim();
  if (!text) return "Not available ✗";
  const lower = text.toLowerCase();
  const passSignals = ["verified", "present", "selected", "above", "satisf", "eligible", "approve", "yes", "true", "pass", "ok"];
  const failSignals = ["missing", "absent", "rejected", "denied", "below", "insuff", "fail", "no", "false", "incomplete"];
  if (passSignals.some((s) => lower.includes(s))) return `${text} ✓`;
  if (failSignals.some((s) => lower.includes(s))) return `${text} ✗`;
  return `${text} ✓`;
};

const safeString = (v, fallback = "") => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") return v.trim() || fallback;
  return String(v);
};

const parseListLoose = (v) => {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (!v) return [];
  const text = String(v).trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return text.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);
};

// Read a Document Screening output value out of the dispatch's
// review_node.value.outputs. The dispatch wraps each value in {value, type},
// or sometimes places the raw value directly under the key.
const readDSOutput = (outputs, name) => {
  const entry = outputs?.[name];
  if (entry === null || entry === undefined) return null;
  if (typeof entry === "object" && "value" in entry) return entry.value;
  return entry;
};

// In real OPUS dispatches, review_node.value.outputs is keyed by the upstream
// node's auto-ids ("workflow_output_xyz123") — not by the friendly variable
// name the author typed in the builder ("gpa_result"). Translate via the
// upstream node's output_schema (in workflow_meta) so we can keep our match
// logic readable using friendly names.
//
// Returns: { friendly_name: value } where the friendly_name is the upstream
// node's output display_name (e.g. "gpa_result", "flagged_or_verified").
const buildDsOutputsByFriendlyName = (workflowMeta, dsOutputs) => {
  const out = {};
  if (!dsOutputs) return out;
  const upstreamSchema = workflowMeta?.upstream_node?.output_schema || {};

  for (const [key, entry] of Object.entries(dsOutputs)) {
    const value = entry && typeof entry === "object" && "value" in entry
      ? entry.value
      : entry;

    // Index by the raw dispatch key too (covers smoke tests that pre-map).
    out[key] = value;

    // And by the display_name (the upstream author-chosen friendly name).
    const def = upstreamSchema[key];
    if (def?.display_name) out[def.display_name] = value;
    if (def?.variable_name) out[def.variable_name] = value;
  }

  return out;
};

// Build the evaluation bundle the FE renders on a HITL_PENDING case:
//   - completeness_flags  (Agent 6's 5 document-check outputs)
//   - screening_flags     (Document Screening's 4 rule-evaluation outputs)
//   - agentDecision / agentReason / agentDeficiencyList / agentCaseStatus /
//     agentApplicationStatus  (Agent 6's overall recommendation, surfaced to
//     the human reviewer)
//   - flaggedOrVerified   (DS's flagged_or_verified — used in DecisionSummary)
//
// All five fields are populated from the dispatch payload; no extra OPUS API
// call is required. If a value isn't present (older workflow version, fields
// not wired yet), the field is filled with "Not available" so the UI still
// renders cleanly.
const extractEvaluation = ({ payload, workflowMeta, dsOutputs }) => {
  const idx = buildReviewInputIndex(workflowMeta, payload?.inputs);

  // Look up an Agent-6-produced value by:
  //   - canonical:   Agent 6's variable_name (single source of truth)
  //   - displays:    common display_name variants different authors might pick
  // The canonical key resolves via workflow_meta.sibling_inputs which traces
  // each dispatched input back to its upstream node's output_schema variable_name.
  const get = (canonical, ...displays) =>
    lookupInput(idx, { canonical, displays });

  // Agent 6 completeness checks. Canonical names are Agent 6's actual
  // output variable_names from its output_schema; the display variants cover
  // common rewordings authors use when wiring the review-node inputs.
  const completenessFlags = {
    "ID and Personal Details": toFlagText(
      get("id_proof_and_personal_details_check", "id_personal_details_check", "id_check"),
    ),
    "Signature": toFlagText(get("signature_check")),
    "Grade Sheets and Certificates": toFlagText(
      get("grade_sheets_check", "grade_sheet_check", "gradesheets_check"),
    ),
    "LOR Documents": toFlagText(get("lor_check", "lor_documents_check")),
    "Work Experience": toFlagText(get("work_experience_check", "workex_check")),
  };

  // Document Screening rule evaluations — DS produces both <rule>_result
  // (descriptive text) and <rule>_flag (short status). Prefer the result text
  // when present, fall back to the flag.
  //
  // Real OPUS dispatches key these by auto-id (workflow_output_xyz); we
  // translate to friendly names via the upstream-node output_schema so the
  // lookup names stay readable here.
  const dsByName = buildDsOutputsByFriendlyName(workflowMeta, dsOutputs);
  const dsRead = (...names) => {
    for (const n of names) {
      if (dsByName[n] !== undefined && dsByName[n] !== null && dsByName[n] !== "") {
        return dsByName[n];
      }
    }
    return null;
  };
  const screeningFlags = {
    "GPA Rule": toFlagText(dsRead("gpa_result", "gpa_flag")),
    "Work Experience Rule": toFlagText(dsRead("work_experience_result", "work_experience_flag")),
    "LOR Institution Rule": toFlagText(dsRead("lor_university_result", "lor_university_flag")),
    "LOR Recency Rule": toFlagText(dsRead("lor_date_result", "lor_date_flag")),
  };

  const agentDecision = safeString(get("decision"), "");
  const agentReason = safeString(get("reason"), "");
  const agentDeficiencyList = parseListLoose(get("deficiency_list"));
  const agentCaseStatus = safeString(get("case_status"), "");
  const agentApplicationStatus = safeString(get("application_status"), "");
  // Same friendly-name lookup as the rule cards — DS sends flagged_or_verified
  // either by raw key or by display_name depending on dispatch shape.
  const flaggedOrVerified = safeString(dsRead("flagged_or_verified"), "");

  return {
    completenessFlags,
    screeningFlags,
    agentDecision,
    agentReason,
    agentDeficiencyList,
    agentCaseStatus,
    agentApplicationStatus,
    flaggedOrVerified,
  };
};
const toDecisionToken = (decision) => {
  const v = String(decision || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");

  if (v === "raise" || v === "raise_insufficiency") return "raise_insufficiency";
  return v;
};

const toDecisionText = (decision) => {
  const token = toDecisionToken(decision);
  if (token === "approve") return "approve";
  if (token === "reject") return "reject";
  if (token === "waitlist") return "waitlist";
  if (token === "raise_insufficiency") return "raise_insufficiency";
  return token || "approve";
};

export const isCanonicalHitlPayload = (payload = {}) => {
  return Boolean(
    payload?.execution_id &&
      payload?.workflow_id &&
      payload?.inputs?.review_node?.value &&
      payload?.callback?.url &&
      payload?.callback?.token &&
      payload?.callback?.token_header &&
      payload?.expected_output_schema?.schema
  );
};

export const validateHitlWebhookPayload = (payload = {}) => {
  const ok = validateIncomingWebhook(payload);
  if (ok) {
    return { ok: true, errors: [] };
  }

  const errors = (validateIncomingWebhook.errors || []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message || "Invalid value",
  }));

  return { ok: false, errors };
};

export const buildHitlTaskFromWebhook = async (payload = {}) => {
  const reviewValue = payload.inputs?.review_node?.value || {};

  // Tolerate both OPUS payload shapes:
  //  - Integration guide: { inputs, outputs, schema: {inputs, outputs}, node_id, process }
  //  - Older / observed:  { input, output, input_schema, output_schema, node_execution_id }
  // Also tolerate the degenerate case where `value` IS the upstream output dict.
  const inputValues = firstObject(reviewValue.input, reviewValue.inputs);
  const outputValues = firstObject(
    reviewValue.output,
    reviewValue.outputs,
    // Degenerate case: a Code node's output dict lives directly under `value`.
    Object.keys(inputValues).length === 0 ? reviewValue : null,
  );
  const inputSchema = firstObject(reviewValue.input_schema, reviewValue.schema?.inputs);
  const outputSchema = firstObject(reviewValue.output_schema, reviewValue.schema?.outputs);
  const nodeExecutionId = firstString(reviewValue.node_execution_id, reviewValue.node_id);
  const expectedSchema = payload.expected_output_schema || { schema: {} };

  const studentId =
    readTyped(inputValues, "student_id") ||
    readTyped(inputValues, "studentId") ||
    readTyped(inputValues, "student_id_input") ||
    `hitl-${payload.execution_id}`;

  const applicantName =
    readTyped(inputValues, "applicant_name") ||
    readTyped(inputValues, "applicantName") ||
    readTyped(inputValues, "name") ||
    `Applicant ${studentId}`;

  // Best-effort: enrich the job with workflow + upstream-node metadata fetched
  // from the OPUS Reference Workflow API. Gives the FE display names for the
  // dispatch's bare `variable_name` keys, the upstream node's name, etc.
  // Falls back to null on any failure — the rest of the flow proceeds.
  let workflowMeta = null;
  try {
    const workflowObj = await getV2WorkflowObject(payload.workflow_id);
    workflowMeta = buildWorkflowReviewMeta(workflowObj);
  } catch (e) {
    // Logged inside getV2WorkflowObject; swallow here so dispatch always lands.
  }

  // Prefer the workflow's name from the API (richer) when the dispatch didn't
  // carry workflow_name or carried the placeholder "Untitled Workflow".
  const resolvedWorkflowName =
    payload.workflow_name && payload.workflow_name !== "Untitled Workflow"
      ? payload.workflow_name
      : workflowMeta?.workflow_name || payload.workflow_name || "";

  // Extract the upstream evaluation results so the FE can show them in the
  // same Completeness / Screening / Decision-Summary cards it uses for
  // post-workflow results — populated NOW (before the human submits) so the
  // reviewer has full context.
  const evaluation = extractEvaluation({
    payload,
    workflowMeta,
    dsOutputs: outputValues,
  });
  return {
    jobId: String(payload.execution_id),
    studentId: String(studentId),
    applicant_name: String(applicantName),
    request_type: "Off Platform Review",
    // Surface Agent 6's case_status / application_status if provided, so the
    // header banner reflects the workflow's current view. Falls back to
    // sensible "in review" defaults when Agent 6 hasn't expressed an opinion.
    case_status: evaluation.agentCaseStatus || "Open",
    application_status: evaluation.agentApplicationStatus || "Pending Review",
    // result.decision is rendered as "Agent Decision" in the existing summary
    // card — use Agent 6's recommendation when present so the reviewer sees
    // what the agent suggested before they make their own call.
    decision: evaluation.agentDecision || "Pending Review",
    reason: evaluation.agentReason || "",
    deficiency_list: evaluation.agentDeficiencyList,
    completeness_flags: evaluation.completenessFlags,
    screening_flags: evaluation.screeningFlags,
    flagged_or_verified: evaluation.flaggedOrVerified || (evaluation.agentDecision ? "Verified" : "In Progress"),
    status: "HITL_PENDING",
    isOffPlatformReview: true,
    available_actions: ["approve", "reject", "waitlist", "raise_insufficiency"],
    submittedAt: new Date().toLocaleString("en-GB"),
    offPlatformThreadId: String(payload.execution_id),
    offPlatformLinkageMethod: "opus_hitl_execution_id",
    offPlatformLinkageMatchedBy: String(payload.execution_id),
    offPlatformLinkedAt: new Date().toISOString(),

    hitlExecutionId: String(payload.execution_id),
    hitlWorkflowId: String(payload.workflow_id),
    hitlWorkflowName: String(resolvedWorkflowName),
    hitlNodeExecutionId: String(nodeExecutionId),

    hitlInputs: inputValues,
    hitlNodeOutput: outputValues,
    hitlInputSchema: inputSchema,
    hitlNodeOutputSchema: outputSchema,
    hitlProcess: reviewValue.process || {},

    hitlWorkflowMeta: workflowMeta,
    hitlEvaluation: evaluation,

    hitlCallback: {
      url: String(payload.callback?.url || ""),
      token: String(payload.callback?.token || ""),
      token_header: String(payload.callback?.token_header || ""),
    },
    hitlExpectedOutputSchema: expectedSchema,
    hitlStatus: "PENDING",
    hitlAuditLog: [
      {
        type: "webhook_received",
        at: new Date().toISOString(),
        execution_id: String(payload.execution_id),
        workflow_id: String(payload.workflow_id),
      },
    ],
    offPlatformPayload: payload,
  };
};

const candidateValueForVar = (varDef = {}, context = {}) => {
  const varName = String(varDef.variable_name || "");
  const varId = String(varDef.id || "");
  const lowered = varName.toLowerCase();
  const decisionText = toDecisionText(context.humanDecision);

  const fromUser =
    context.reviewerOutput?.[varName] ??
    context.reviewerOutput?.[varId] ??
    context.reviewerOutput?.[lowered];
  if (fromUser !== undefined) return fromUser;

  const fromNodeOutput =
    readTyped(context.hitlNodeOutput, varName) ?? readTyped(context.hitlNodeOutput, varId);
  if (fromNodeOutput !== undefined) return fromNodeOutput;

  const fromInput = readTyped(context.hitlInputs, varName) ?? readTyped(context.hitlInputs, varId);
  if (fromInput !== undefined) return fromInput;

  if (
    lowered.includes("decision") ||
    lowered.includes("status") ||
    lowered.includes("recommend") ||
    lowered.includes("action")
  ) {
    return decisionText;
  }

  if (lowered.includes("amount") || lowered.includes("score") || lowered.includes("count")) {
    const reqAmount =
      readTyped(context.hitlInputs, "requested_amount") ||
      readTyped(context.hitlInputs, "amount") ||
      readTyped(context.hitlInputs, "requestedAmount");
    if (reqAmount !== undefined) {
      return decisionText === "approve" ? reqAmount : 0;
    }
  }

  return undefined;
};

const valueMatchesType = (value, normalizedType) => {
  if (normalizedType === "null") {
    return value === null;
  }

  if (normalizedType === "string") {
    return typeof value === "string";
  }

  if (normalizedType === "boolean") {
    return typeof value === "boolean";
  }

  if (normalizedType === "integer") {
    return Number.isInteger(value);
  }

  if (normalizedType === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }

  return false;
};

const castToAllowedType = (value, allowed) => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  for (const allowedType of allowed) {
    if (valueMatchesType(value, allowedType)) return value;

    if (allowedType === "string") {
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      continue;
    }

    if (allowedType === "number") {
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      continue;
    }

    if (allowedType === "integer") {
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isInteger(parsed)) return parsed;
      }
      if (typeof value === "number" && Number.isInteger(value)) {
        return value;
      }
      continue;
    }

    if (allowedType === "boolean") {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes"].includes(normalized)) return true;
        if (["false", "0", "no"].includes(normalized)) return false;
      }
    }
  }

  return value;
};

export const buildAndValidateHitlOutput = ({
  expectedOutputSchema,
  reviewerOutput,
  humanDecision,
  hitlInputs,
  hitlNodeOutput,
}) => {
  const schema = expectedOutputSchema?.schema || {};
  const variableAdditionAllowed = Boolean(expectedOutputSchema?.variable_addition_allowed);
  const outputByVarName = {};
  const errors = [];

  const context = {
    reviewerOutput: reviewerOutput || {},
    humanDecision,
    hitlInputs: hitlInputs || {},
    hitlNodeOutput: hitlNodeOutput || {},
  };

  for (const varDef of Object.values(schema)) {
    const variableName = String(varDef?.variable_name || "");
    const allowed = (Array.isArray(varDef?.allowed_types) ? varDef.allowed_types : [])
      .map((item) => normalizeType(item?.type))
      .filter(Boolean);

    const fallbackType = allowed[0] || "string";
    let value = candidateValueForVar(varDef, context);

    if (value === undefined) {
      if (varDef?.is_nullable === true || allowed.includes("null")) {
        value = null;
      } else {
        value = SCALAR_DEFAULTS[fallbackType];
      }
    }

    value = castToAllowedType(value, allowed);

    const isNullable = varDef?.is_nullable === true || allowed.includes("null");
    if (value === null && !isNullable) {
      errors.push(`'${variableName}' cannot be null.`);
      continue;
    }

    if (value !== null && allowed.length > 0) {
      const validForAny = allowed.some((t) => valueMatchesType(value, t));
      if (!validForAny) {
        errors.push(
          `'${variableName}' has invalid type. Allowed: ${allowed.join(", ")}; received: ${typeof value}.`
        );
        continue;
      }
    }

    outputByVarName[variableName] = value;
  }

  if (!variableAdditionAllowed && reviewerOutput && typeof reviewerOutput === "object") {
    const knownKeys = new Set();
    for (const varDef of Object.values(schema)) {
      knownKeys.add(String(varDef?.variable_name || ""));
      knownKeys.add(String(varDef?.id || ""));
      knownKeys.add(String(varDef?.variable_name || "").toLowerCase());
    }

    for (const key of Object.keys(reviewerOutput)) {
      if (!knownKeys.has(key)) {
        errors.push(`Unexpected output key '${key}' is not allowed by expected_output_schema.`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, outputByVarName: null, callbackOutput: null };
  }

  // Build the callback's output_data — keyed by the schema's outer key (the
  // variable_name / auto-id like "workflow_output_xyz"), with each value wrapped
  // as {value, type} per integration guide §5.2. The `type` is passed through
  // from the dispatch's own allowed_types[0] so OPUS sees its own type names
  // back (e.g. "bool" not "boolean", matching what it sent).
  const callbackOutput = {};
  for (const [schemaKey, varDef] of Object.entries(schema)) {
    const variableName = String(varDef?.variable_name || schemaKey);
    const value = outputByVarName[variableName];
    const allowedTypes = Array.isArray(varDef?.allowed_types) ? varDef.allowed_types : [];
    const dispatchedType = allowedTypes[0] || { type: "string", type_definition: null };

    callbackOutput[schemaKey] = {
      value,
      type: dispatchedType,
    };
  }

  return {
    ok: true,
    errors: [],
    outputByVarName,
    callbackOutput,
  };
};

export const sendHitlCallback = async ({ callback, callbackOutput, status = "success", error = null }) => {
  const headerName = String(callback?.token_header || "").trim();
  const tokenValue = String(callback?.token || "").trim();
  const url = String(callback?.url || "").trim();

  if (!url || !headerName || !tokenValue) {
    throw new Error("Missing callback url/token/token_header in HITL task.");
  }

  const headers = {
    "Content-Type": "application/json",
    [headerName]: tokenValue,
  };

  // Per integration guide §5.2:
  //   { output_data: { <key>: { value, type } }, status: "success"|"failed", error? }
  const body = {
    output_data: callbackOutput || {},
    status,
  };
  if (status === "failed" && error) {
    body.error = String(error);
  }

  // Don't throw on non-2xx — let the caller surface the real status code to
  // the reviewer (e.g. 401 = expired, 400 = validation, 404 = unknown execution).
  const response = await axios.post(url, body, {
    headers,
    timeout: 20000,
    validateStatus: () => true,
  });

  return {
    status: response.status,
    data: response.data,
    ok: response.status >= 200 && response.status < 300,
    sentBody: body,
  };
};
