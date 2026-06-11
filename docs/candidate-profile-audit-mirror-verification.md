# Candidate profile evaluation cards — verification and fix

Status: verified against the live OPUS audit for job `66628` on 2026-06-05.
No code changes are proposed inline; this documents the exact defect and the
corrected parse. The off-platform / HITL review flow is left untouched.

## Symptom

On the candidate profile page, the Document Completeness Check and Screening
Rules Evaluation cards show "Not available", and the audit snapshot shows
`job_snapshot FAILED` with `decision: "Pending Review"`.

## What the code currently does

`be/src/controllers/uiCompatController.js` already contains an audit-driven
watcher (`pollAuditUntilDone`) that is supposed to read Agent 6 and Document
Screening outputs from the OPUS job audit and populate the cards while the
workflow is parked at the Off-Platform Review node. The intent is correct. The
parsing does not match the real audit response shape, so it extracts nothing.

## Verified root cause (two shape mismatches)

### Bug 1 — `normalizeAuditData` reads the wrong field

```js
const normalizeAuditData = (auditData) => {
  if (Array.isArray(auditData.executed_nodes)) return auditData.executed_nodes; // <-- here
  ...
};
```

The real audit shape (verified, `GET /job/66628/audit`):

```
{
  "executed_nodes": ["Input", "Intake Agent", "Agent 4", ..., "Agent 6", "Document Screening"],
  "audit": {
    "nodes_execution_data": {
      "Agent 6":            { "execution_status": "COMPLETED", "execution_output": [ ... ] },
      "Document Screening": { "execution_status": "COMPLETED", "execution_output": [ ... ] }
    }
  }
}
```

`executed_nodes` is an array of node-name **strings**, not entry objects. So
`normalizeAuditData` returns `["Input", "Intake Agent", ...]`. The watcher then
calls `getAuditEntryNodeName(entry)` and `extractExecutionOutput(entry)` on
plain strings — both return empty/null, so no node ever matches and no output is
ever extracted.

Proven by running the current parser against the real audit:

```
normalizeAuditData -> entries.length = 7
typeof entries[0] = string | value = "Input"
entries whose nodeName matched Agent6/DocScreening: 0
entries with extractable execution_output: 0
=> flags stay null -> 120 x 5s timeout -> watcher throws -> job marked FAILED
```

The node execution outputs actually live under
`audit.nodes_execution_data`, which is an **object keyed by node name**, not in
`executed_nodes`.

### Bug 2 — `buildFlagsFromOutput` expects a dict, but `execution_output` is an array

```js
for (const [key, rawValue] of Object.entries(executionOutput)) {
  const displayName = outputMap[key] || key;   // expects { autoId: value }
  ...
}
```

The real `execution_output` is an **array** of objects:

```json
[
  { "variable_name": "workflow_output_s3t4r9a5d", "display_name": "workflow_output_s3t4r9a5d", "value": "Present", "type": "str" },
  { "variable_name": "workflow_output_f458s5r3q", "display_name": "workflow_output_f458s5r3q", "value": "Missing", "type": "str" }
]
```

So even if Bug 1 were fixed and an entry object were found, `Object.entries`
would iterate array indices (`"0"`, `"1"`, …) and the value would be the whole
`{variable_name, value, …}` object, not the scalar. The function must iterate
the array and read `item.variable_name` and `item.value`.

Note: in the audit, each entry's own `display_name` equals the auto-id
(`workflow_output_s3t4r9a5d`), not the friendly name. The friendly name lives in
the workflow definition's `output_schema`. `resolveNodeOutputsByDisplayName`
(in `opusWorkflowService.js`) already returns `{ autoId -> friendly }` correctly;
the fix is to key off `item.variable_name` through that map.

## Verified correct parse

Reading `audit.nodes_execution_data[node].execution_output` as an array,
resolving `variable_name` → friendly name → card label, produces the right
cards for job `66628`:

```
Completeness (Agent 6):
  ID and Personal Details         Present ✓
  Signature                       Present ✓
  Grade Sheets and Certificates   Missing ✗
  LOR Documents                   Missing ✗
  Work Experience                 Present ✓
Screening (Document Screening):
  GPA Rule                        GPA screening skipped ... ✗
  Work Experience Rule            Total professional experience is under 2 years ...
  LOR Institution Rule            LOR institution screening skipped ... ✗
  LOR Recency Rule                LOR date screening skipped ... ✗
```

## How to fix (no code written here)

1. `normalizeAuditData` — return node execution entries from
   `auditData.audit.nodes_execution_data`, not from `executed_nodes`. Produce a
   list of `{ node_name, execution_output }` by iterating the object's
   `[name, data]` pairs. Keep the existing array/`result`/`steps` fallbacks for
   other possible API variants.

2. `extractExecutionOutput` — return the entry's `execution_output` array
   as-is (it is already an array on the real shape).

3. `buildFlagsFromOutput`, `extractAgent6SummaryFields`,
   `extractDocScreeningSummaryFields` — iterate the array. For each `item`,
   resolve `friendly = outputMap[item.variable_name] || item.display_name`, then
   map `friendly` through the label map / summary-field set, using `item.value`
   as the value.

4. No change needed to `resolveNodeOutputsByDisplayName`, the label maps, the
   `REVIEW_READY` handling in `watchJobCompletion`, or the front end — those are
   already correct once real data flows through.

## Secondary issues observed

- Pass/fail classifier: `isFailSignal` does not catch phrases like "under 2
  years", so a failing Work Experience rule can render with a pass mark. Add the
  relevant fail phrases, or invert specific rules, if accuracy matters for the
  demo.
- Timeout window: `pollAuditUntilDone` caps at 120 x 5s = 10 minutes. The OCR +
  agent chain can take longer; if it does, the watcher returns before the
  evaluation nodes finish. Consider a longer cap or a lighter on-read refresh.

## The remaining gap — human-review result on the candidate page

This is the headline complaint ("the human-review result shows on the HITL page
but not on the case itself"). Confirmed by code inspection:

- `watchJobCompletion` calls `pollAuditUntilDone` once. As soon as both
  evaluation nodes are read it returns `REVIEW_READY`, persists the flags, and
  the watcher is removed (`activeJobWatchers.delete`). It does not keep watching.
- The reviewer acts on the HITL record (a separate job keyed by the dispatch
  execution id). When they submit, the workflow resumes and the numeric
  candidate job eventually reaches `COMPLETED` with the Agent 7 / Output
  decision — but by then nothing is watching that job, so the candidate page is
  never updated with the decision.

Two ways to close it (audit-driven, no change to the HITL flow):

- On-read refresh: when `/case-screening/:studentId` is requested for a job in
  `REVIEW_READY` / `IN PROGRESS`, do a quick `getJobStatus`; if `COMPLETED`,
  fetch the result and finalize the candidate job, then return it. The page
  always reflects current OPUS state with no long-running watcher.
- Or keep a lightweight watcher alive past `REVIEW_READY` until the job reaches
  a terminal state, polling at a slower cadence.

Either uses only the numeric job id the candidate job already owns, via the same
audit / status endpoints. No dispatch linkage and no webhook dependency.

## Out of scope

- No change to the off-platform / HITL webhook handler or decision submission.
- No merging of HITL dispatch jobs into candidate jobs.
