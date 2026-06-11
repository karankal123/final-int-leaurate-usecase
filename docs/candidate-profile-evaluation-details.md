# Showing evaluation details on the candidate profile

Design note. No code changes proposed here. The HITL / off-platform review
flow is intentionally left untouched.

## Problem

On the regular candidate profile page (`/case/:studentId`, e.g. Alexandra G,
student 44173071), the Document Completeness Check and Screening Rules
Evaluation cards render every row as "Not available".

## Why it happens

The primary screening workflow (`WORKFLOW_ID_PRIMARY`) is the Laureate HITL
workflow `9888bc12`. Its node order is:

```
Input -> Intake Agent -> Agent 4 -> Google Drive -> OCR -> Agent 6
  -> Document Screening -> Off-Platform Review (human gate) -> Agent 7 -> Output
```

When a candidate is screened from our app:

1. The backend initiates an OPUS job and stores it as the candidate's job,
   keyed by the numeric `jobExecutionId` (e.g. `66800`) with the real
   `studentId`. This is the record the candidate profile page reads.
2. The workflow runs through Agent 6 and Document Screening, then reaches the
   Off-Platform Review node and PAUSES, waiting for the human decision.
3. Because the workflow never reaches the Output node on its own, the job never
   becomes `COMPLETED`. The completion watcher polls for `COMPLETED`, times out
   after ~10 minutes, and marks the candidate's job `FAILED`.
4. The evaluation results (Agent 6 checks + Document Screening rules) are
   produced inside OPUS, but nothing ever writes them onto the candidate's job
   record. The cards therefore have no data to show.

The audit trail snapshot the client sees on the page (`job_snapshot FAILED`,
`decision: "Pending Review"`) is the timed-out watcher state, not a real
workflow failure.

## Key facts established during investigation

- `POST /job/initiate` returns only a numeric `jobExecutionId`. No UUID.
- The completed Agent 6 and Document Screening outputs are available from the
  OPUS job audit by that same numeric id:
  `GET /job/<jobExecutionId>/audit`.
- In the audit, each node's `execution_output` entries are keyed by the node's
  auto-generated ids (`workflow_output_xxxx`). The friendly name lives in that
  node's `output_schema.schema[<auto_id>].display_name` in the workflow
  definition (`reference-workflow/v2/workflow-object/<workflow_id>`).
- Auto-ids reshuffle whenever the workflow is rebuilt. Any mapping must resolve
  by the stable `display_name`, never by hard-coded auto-id.

### Audit field map (workflow v202, resolve by display_name not by id)

Agent 6 (`execution_output`):

| display_name                          | Completeness card             |
| ------------------------------------- | ----------------------------- |
| id_proof_and_personal_details_check   | ID and Personal Details       |
| signature_check                       | Signature                     |
| grade_sheets_check                    | Grade Sheets and Certificates |
| lor_check                             | LOR Documents                 |
| work_experience_check                 | Work Experience               |
| deficiency_list                       | (deficiency list)             |
| decision / reason / case_status / application_status | (summary fields) |

Document Screening (`execution_output`):

| display_name             | Screening card        |
| ------------------------ | --------------------- |
| gpa_result               | GPA Rule              |
| work_experience_result   | Work Experience Rule  |
| lor_university_result    | LOR Institution Rule  |
| lor_date_result          | LOR Recency Rule      |
| flagged_or_verified      | (deficiency status)   |

## Proposed approach (audit-driven, candidate profile only)

Drive the candidate profile's evaluation cards from the OPUS job audit, using
the numeric job id the candidate's job already owns. This works without any
dependency on the HITL webhook arriving, and leaves the off-platform review
flow exactly as it is.

1. Backend already exposes `getJobAudit(jobExecutionId)` in
   `be/src/services/opusApiService.js`.

2. Add a resolver (in `be/src/services/opusWorkflowService.js`) that, given the
   workflow object and a node name, returns `{ auto_id -> display_name }` for
   that node's `output_schema`. Reuse it for Agent 6 and Document Screening.

3. In the screening watcher (`watchJobCompletion` in
   `be/src/controllers/uiCompatController.js`), poll the audit instead of only
   the final status:
   - When `Agent 6` and `Document Screening` appear in `executed_nodes`, read
     their `execution_output`, resolve to `completeness_flags` and
     `screening_flags` by `display_name`, and persist them on the candidate's
     job.
   - When the job is parked at the Off-Platform Review node, set a review-ready
     status instead of letting the watcher time out to `FAILED`.
   - If the job ever reaches `COMPLETED`, finalize as today.

4. The frontend needs no change: `AgentResultPanel` already renders whatever
   `completeness_flags` / `screening_flags` the screening payload contains.

### Classification of pass/fail text

Agent 6 / Document Screening values are free-text sentences. The pass/fail tile
should look for explicit fail language ("missing", "below", "insufficient",
"incomplete", "skipped" where relevant) and default to pass otherwise, so a
descriptive-but-passing sentence does not render as a red cross. Keep this
consistent with how the off-platform review path already classifies its values.

## Explicitly out of scope

- No change to the off-platform / HITL webhook handler.
- No merging of HITL dispatch jobs into candidate jobs.
- No change to how human decisions are submitted back to OPUS.

## Open items

- The watcher currently assumes a single terminal `COMPLETED` state. Switching
  it to audit-driven progress needs care so any genuinely non-HITL workflow
  still finalizes correctly.
- Confirm node display names (`Agent 6`, `Document Screening`) are stable in the
  client's deployed workflow version before relying on them; match
  case-insensitively and tolerate minor renames.
