/**
 * OPUS V2 workflow metadata service.
 *
 * Fetches the workflow object from the OPUS Reference Workflow API so the BE
 * can enrich incoming off-platform review dispatches with human-readable
 * context: workflow name, upstream node name, variable display names, etc.
 *
 * Uses the same API path as the official opus-aaico Python SDK
 * (GET /reference-workflow/v2/workflow-object/{id}) and authenticates with
 * the same x-service-key header the existing opusApiService.js uses.
 *
 * Results are cached in-process for 1 hour per workflow_id. Cache misses or
 * upstream failures degrade gracefully: callers receive `null` and the rest
 * of the HITL flow proceeds without enrichment.
 */

import axios from "axios";
import dotenv from "dotenv";
import { logError, logInfo } from "../utils/logger.js";

dotenv.config();

const BASE_URL = (process.env.OPUS_BASE_URL || "https://operator.opus.com").replace(/\/$/, "");
const API_KEY = process.env.OPUS_API_KEY;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map(); // workflowId -> { data, fetchedAt }

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    "x-service-key": API_KEY,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

/**
 * Fetch a V2 workflow object. Cached for CACHE_TTL_MS per workflow id.
 * Returns the raw workflow object on success, null on failure or missing id.
 */
export const getV2WorkflowObject = async (workflowId) => {
  if (!workflowId || !API_KEY) return null;

  const cached = cache.get(workflowId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await client.get(`/reference-workflow/v2/workflow-object/${workflowId}`);
    cache.set(workflowId, { data: res.data, fetchedAt: Date.now() });
    logInfo("Fetched V2 workflow", {
      workflowId,
      name: res.data?.name,
      nodes: Object.keys(res.data?.nodes || {}).length,
    });
    return res.data;
  } catch (err) {
    logError("Failed to fetch V2 workflow", {
      workflowId,
      status: err.response?.status,
      error: err.response?.data || err.message,
    });
    return null;
  }
};

/**
 * Locate the off-platform review node within a workflow.
 *
 * Identification: handler_class === "human_task" AND properties includes "review".
 *
 * Disambiguation when multiple review nodes exist:
 * Prefer the one whose outputs are consumed by at least one downstream node
 * — this is the node actually wired into the workflow's execution path. A
 * dangling testing-only HITL node (no downstream consumers) is skipped.
 *
 * If no review node has downstream consumers (rare — only happens when the
 * workflow is mid-construction) we fall back to the first match.
 */
const countDownstreamConsumers = (workflowObj, nodeId) => {
  let n = 0;
  for (const node of Object.values(workflowObj?.nodes || {})) {
    if (node.id === nodeId) continue;
    for (const mapping of Object.values(node.mappings || {})) {
      if (mapping?.origin_id === nodeId) {
        n += 1;
      }
    }
  }
  return n;
};

export const findOffPlatformReviewNode = (workflowObj) => {
  if (!workflowObj?.nodes) return null;
  const candidates = Object.values(workflowObj.nodes).filter((node) => {
    const isHumanTask = node?.handler_class === "human_task";
    const isReview = Array.isArray(node?.properties) && node.properties.includes("review");
    return isHumanTask && isReview;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple review nodes — pick the one actually in the execution path.
  const withConsumerCounts = candidates.map((n) => ({
    node: n,
    consumers: countDownstreamConsumers(workflowObj, n.id),
  }));
  withConsumerCounts.sort((a, b) => b.consumers - a.consumers);
  return withConsumerCounts[0].node;
};

/**
 * Given a review node, follow its `review_node` mapping to the upstream node
 * that produced the context being reviewed. Returns the upstream node object
 * or null.
 */
export const findUpstreamNodeOf = (workflowObj, reviewNode) => {
  if (!workflowObj?.nodes || !reviewNode) return null;
  const mapping = reviewNode?.mappings?.review_node;
  const originId = mapping?.origin_id;
  if (!originId) return null;
  return workflowObj.nodes[originId] || null;
};

/**
 * Strip a node definition down to fields the FE actually needs to render a
 * review context panel: identity, schema (with display names), no edges or
 * positions or handler internals.
 */
const slimNode = (node) => {
  if (!node) return null;
  return {
    id: node.id,
    name: node.name || "",
    description: node.description || "",
    handler_class: node.handler_class || "",
    type: node.type || node.handler_class || "",
    input_schema: node.input_schema?.schema || {},
    output_schema: node.output_schema?.schema || {},
    mappings: node.mappings || {},
  };
};

/**
 * For each non-`review_node` input on the off-platform review node, resolve
 * the canonical source variable name by following the input's mapping back
 * to its upstream node's output_schema.
 *
 * This makes the BE robust against the workflow author renaming or mistyping
 * the display_name on the review-node input — we identify what each value IS
 * by what upstream output it came from, not by whatever label the author
 * typed. Different workflow authors may name the same Agent-6 output input
 * "id_personal_details_check" or "id_proof_and_personal_details_check"; both
 * resolve to the same canonical source variable_name.
 *
 * Returns: { <off-platform-input-key>: { source_variable_name, source_node_id,
 *                                         source_node_name, source_variable_path } }
 */
const buildSiblingInputIndex = (workflowObj, reviewNode) => {
  if (!workflowObj || !reviewNode) return {};
  const index = {};
  for (const [inputKey, mapping] of Object.entries(reviewNode.mappings || {})) {
    if (inputKey === "review_node") continue;
    const originId = mapping?.origin_id;
    const variablePath = mapping?.variable_path;
    if (!originId || !variablePath) continue;
    const sourceNode = workflowObj.nodes?.[originId];
    if (!sourceNode) continue;
    const sourceVarDef = sourceNode.output_schema?.schema?.[variablePath];
    if (!sourceVarDef) continue;
    // In V2 workflows, `variable_name` is the auto-generated "workflow_output_xxxx"
    // id while `display_name` is the friendly label the workflow author typed
    // (e.g. "id_proof_and_personal_details_check"). The friendly name is the
    // semantic anchor — auto-ids change every time the workflow is rebuilt.
    index[inputKey] = {
      source_variable_name:
        sourceVarDef.display_name || sourceVarDef.variable_name || variablePath,
      source_variable_path: variablePath,
      source_node_id: originId,
      source_node_name: sourceNode.name || "",
    };
  }
  return index;
};

/**
 * Build the metadata bundle attached to a HITL job record on dispatch.
 * Returns null if no workflow context could be resolved.
 */
export const buildWorkflowReviewMeta = (workflowObj) => {
  if (!workflowObj) return null;
  const reviewNode = findOffPlatformReviewNode(workflowObj);
  const upstreamNode = findUpstreamNodeOf(workflowObj, reviewNode);
  const siblingInputs = buildSiblingInputIndex(workflowObj, reviewNode);

  return {
    workflow_id: workflowObj.workflow_id || workflowObj.id || "",
    workflow_name: workflowObj.name || "",
    workflow_version: workflowObj.version,
    workflow_description: workflowObj.description || "",
    review_node: slimNode(reviewNode),
    upstream_node: slimNode(upstreamNode),
    // Canonical source-of-truth map for each non-review_node input on the
    // off-platform review: resolved to the upstream node's variable_name
    // (e.g. Agent 6's "id_proof_and_personal_details_check"). The BE uses
    // this to match dispatched values regardless of what display_name the
    // workflow author typed on the review-node input.
    sibling_inputs: siblingInputs,
  };
};

/**
 * Given a workflow object and a node name (case-insensitive exact match),
 * returns a map of { autoId -> displayName } for every field in that node's
 * output_schema.schema.
 *
 * This lets the watcher resolve auto-generated ids (e.g. "workflow_output_xxxx")
 * from the OPUS job audit back to the stable display_name the workflow author
 * typed (e.g. "id_proof_and_personal_details_check") without hard-coding
 * auto-ids that change every time the workflow is rebuilt.
 *
 * Returns an empty object when the node is not found or has no output schema.
 */
export const resolveNodeOutputsByDisplayName = (workflowObj, nodeName) => {
  if (!workflowObj?.nodes || !nodeName) return {};

  const target = String(nodeName).toLowerCase().trim();
  const node = Object.values(workflowObj.nodes).find(
    (n) => String(n.name || "").toLowerCase().trim() === target
  );

  if (!node?.output_schema?.schema) return {};

  const map = {};
  for (const [autoId, field] of Object.entries(node.output_schema.schema)) {
    if (field && typeof field === "object") {
      map[autoId] = field.display_name || field.variable_name || autoId;
    }
  }
  return map;
};

/**
 * Test hook: clear the in-memory cache (used by tests / dev workflows).
 */
export const _clearWorkflowCache = () => cache.clear();
