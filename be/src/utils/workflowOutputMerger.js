/**
 * Workflow Output Merger
 * 
 * Merges workflow outputs from two execution paths (new case and update case)
 * into a single clean normalized object. Only one path runs per student based
 * on request_type, so only one set of outputs will have values.
 * 
 * This ensures the UI always receives a consistent set of field names regardless
 * of which workflow path was executed.
 */

/**
 * Check if a value is considered "blank" (should be skipped in favor of the alternative).
 * A value is blank if it is:
 * - null
 * - undefined
 * - empty string ""
 * - the string "null"
 * - the string "undefined"
 * 
 * @param {*} value - The value to check
 * @returns {boolean} - True if the value is blank
 */
const isBlank = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "" || trimmed === "null" || trimmed === "undefined";
  }
  return false;
};

/**
 * Pick the first non-blank value from the provided arguments.
 * 
 * @param {...*} values - Values to check in order of preference
 * @returns {*} - The first non-blank value, or null if all are blank
 */
const pickNonBlank = (...values) => {
  for (const val of values) {
    if (!isBlank(val)) return val;
  }
  return null;
};

/**
 * Field mapping configuration.
 * Maps the normalized output field name to:
 * - newCaseField: field name from new case path (as it comes from Opus output node)
 * - updateCaseField: field name from update case path (with _up suffix)
 */
const FIELD_MAPPINGS = [
  {
    outputField: "final_decision",
    newCaseField: "decision",
    updateCaseField: "decision_up",
  },
  {
    outputField: "case_status",
    newCaseField: "Case Status",
    updateCaseField: "case_status_up",
  },
  {
    outputField: "application_status",
    newCaseField: "application_status",
    updateCaseField: "application_status_up",
  },
  {
    outputField: "flagged_or_verified",
    newCaseField: "flagged/verified",
    updateCaseField: "flagged_verified_up",
  },
  {
    outputField: "final_reason",
    newCaseField: "decision of agent",
    updateCaseField: "final_reason_up",
  },
  {
    outputField: "final_deficiency_list",
    newCaseField: "final deficiency list",
    updateCaseField: "final_deficiency_list_up",
  },
  {
    outputField: "flagged_or_verified_agent",
    newCaseField: "flagged/verified(agent's output)",
    updateCaseField: "flagged_verified_agent_up",
  },
  {
    outputField: "case_status_agent",
    newCaseField: "case_status(agent)",
    updateCaseField: "case_status_agent_up",
  },
  {
    outputField: "id_proof_check",
    newCaseField: "id proof and personal details check",
    updateCaseField: "id_proof_check_up",
  },
  {
    outputField: "signature_check",
    newCaseField: "signature check",
    updateCaseField: "signature_check_up",
  },
  {
    outputField: "grade_sheets_check",
    newCaseField: "grade sheets check",
    updateCaseField: "grade_sheets_check_up",
  },
  {
    outputField: "lor_check",
    newCaseField: "lor check",
    updateCaseField: "lor_check_up",
  },
  {
    outputField: "work_experience_check",
    newCaseField: "work experience check",
    updateCaseField: "work_experience_check_up",
  },
  {
    outputField: "candidate_full_name",
    newCaseField: "Candidate Full Name",
    updateCaseField: "candidate_full_name_up",
  },
  {
    outputField: "work_experience_flag",
    newCaseField: "work experience flag",
    updateCaseField: "work_experience_flag_up",
  },
  {
    outputField: "gpa_flag",
    newCaseField: "gpa flag",
    updateCaseField: "gpa_flag_up",
  },
  {
    outputField: "lor_date_flag",
    newCaseField: "lor date flag",
    updateCaseField: "lor_date_flag_up",
  },
  {
    outputField: "lor_university_flag",
    newCaseField: "lor university flag",
    updateCaseField: "lor_university_flag_up",
  },
  {
    outputField: "gpa_result",
    newCaseField: "gpa result",
    updateCaseField: "gpa_result_up",
  },
  {
    outputField: "lor_date_result",
    newCaseField: "lor_date_result",
    updateCaseField: "lor_date_result_up",
  },
  {
    outputField: "lor_university_result",
    newCaseField: "lor_university_result",
    updateCaseField: "lor_university_result_up",
  },
];

/**
 * Merge workflow outputs from new case and update case paths into a single
 * normalized object.
 * 
 * Takes the full Opus job output object as input and for each field picks
 * the non-blank non-null value between the new case field and the update
 * case field.
 * 
 * @param {Object} opusJobOutput - The full Opus job output object containing
 *                                 fields from both new case and update case paths
 * @returns {Object} - A clean normalized object with consistent field names
 * 
 * @example
 * const opusOutput = {
 *   "decision": "Approved",
 *   "Case Status": "Closed",
 *   "decision_up": "",
 *   "case_status_up": null,
 *   // ... other fields
 * };
 * 
 * const merged = mergeWorkflowOutputs(opusOutput);
 * // Returns:
 * // {
 * //   final_decision: "Approved",
 * //   case_status: "Closed",
 * //   // ... other normalized fields
 * // }
 */
export const mergeWorkflowOutputs = (opusJobOutput) => {
  if (!opusJobOutput || typeof opusJobOutput !== "object") {
    return createEmptyMergedOutput();
  }

  const merged = {};

  for (const mapping of FIELD_MAPPINGS) {
    const newCaseValue = opusJobOutput[mapping.newCaseField];
    const updateCaseValue = opusJobOutput[mapping.updateCaseField];

    // Pick the non-blank value, preferring new case path
    merged[mapping.outputField] = pickNonBlank(newCaseValue, updateCaseValue);
  }

  return merged;
};

/**
 * Create an empty merged output object with all fields set to null.
 * Useful for error cases or when no output is available.
 * 
 * @returns {Object} - Object with all normalized field names set to null
 */
export const createEmptyMergedOutput = () => {
  const empty = {};
  for (const mapping of FIELD_MAPPINGS) {
    empty[mapping.outputField] = null;
  }
  return empty;
};

/**
 * Apply merged workflow outputs to a job object.
 * This spreads the merged outputs into the job object so the UI can access
 * them via the normalized field names.
 * 
 * @param {Object} job - The job object to enrich
 * @param {Object} opusJobOutput - The raw Opus job output
 * @returns {Object} - The job object with merged outputs added
 */
export const applyMergedOutputsToJob = (job, opusJobOutput) => {
  if (!job || typeof job !== "object") return job;

  const merged = mergeWorkflowOutputs(opusJobOutput);

  return {
    ...job,
    mergedOutputs: merged,
    // Also spread the merged fields at the top level for backward compatibility
    ...merged,
  };
};

/**
 * Extract merged workflow outputs from a stored job that already has
 * both raw workflow output fields. This is useful when retrieving jobs
 * from storage where the raw output keys were saved directly on the job.
 * 
 * @param {Object} job - The job object containing raw workflow output fields
 * @returns {Object} - A clean normalized object with consistent field names
 */
export const extractMergedOutputsFromJob = (job) => {
  if (!job || typeof job !== "object") {
    return createEmptyMergedOutput();
  }

  // The job object may have workflow outputs stored with various key formats.
  // We need to look for both the new case fields and update case fields.
  return mergeWorkflowOutputs(job);
};

export default {
  mergeWorkflowOutputs,
  createEmptyMergedOutput,
  applyMergedOutputsToJob,
  extractMergedOutputsFromJob,
  isBlank,
};
