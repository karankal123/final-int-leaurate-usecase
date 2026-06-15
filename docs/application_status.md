# Status Update & Display — Complete Implementation Guide
 
## Overview
 
This guide explains **how and where** `case_status` and `application_status` get displayed and updated across the entire application — both on the **Inbox (Home Page)** and inside the **Case Detail Page** (after screening).
 
---
 
## Part 1: Inbox / Home Page — Status Columns
 
### What the User Sees
 
The Inbox table has two status columns:
- **Case Status** — "Open" or "Closed"
- **Application Status** — "Under Review", "Selected", "Deny", "Waitlisted", "Incomplete Application"
 
These reflect the **latest persisted state** from the backend.
 
### Frontend: How Inbox Gets Its Data
 
```jsx
// InboxPage.jsx
import { getInbox } from '../api/client';
 
const [cases, setCases] = useState([]);
 
const fetchInbox = useCallback(async () => {
  setLoading(true);
  try {
    const data = await getInbox();  // GET /inbox
    setCases(data);
  } finally {
    setLoading(false);
  }
}, []);
 
useEffect(() => { fetchInbox(); }, [fetchInbox]);
```
 
### API Client
 
```javascript
// api/client.js
export const getInbox = () => api.get('/inbox').then(r => r.data);
```
 
### Backend: GET /inbox — How Status is Resolved
 
```javascript
// uiCompatController.js
export const getInboxController = async (_req, res) => {
  ensureSeedDataFromExcel(); // Seeds from Excel if no jobs exist
  const jobs = getAllJobs();
 
  // Deduplicate: latest job per student only
  const seenStudentIds = new Set();
  const uniqueByStudent = [];
  for (let i = jobs.length - 1; i >= 0; i--) {
    const studentId = String(jobs[i].studentId || "").trim();
    if (!studentId || seenStudentIds.has(studentId)) continue;
    seenStudentIds.add(studentId);
    uniqueByStudent.push(jobs[i]);
  }
 
  res.status(200).json(uniqueByStudent.map(toInboxCase));
};
```
 
### The `toInboxCase()` Transform — Where Status Values Come From
 
```javascript
const toInboxCase = (job) => ({
  student_id: String(job.studentId || ""),
  applicant_name: resolveApplicantName(job),
  request_type: job.request_type || "New",
  case_status: resolveCaseStatus(job),            // ← CASE STATUS
  screening_status: resolveScreeningStatus(job),
  application_status:                              // ← APPLICATION STATUS
    job.status === "COMPLETED" || job.status === "IN PROGRESS"
      ? resolveDecision(job)
      : "Under Review",
  attachments: resolveAttachmentLabel(job),
  attachment_url: resolveAttachmentUrl(job),
});
```
 
**Key logic:**
- If job has NOT been screened (`status = "NOT_STARTED"`): application_status = `"Under Review"`
- If job is in progress or completed: application_status = `resolveDecision(job)` (reads from workflow outputs)
- case_status is ALWAYS derived from the decision
 
### resolveDecision() — Reads Workflow Output Fields
 
```javascript
const resolveDecision = (job = {}) => {
  return (
    job.merged_final_decision ||       // From mergeWorkflowOutputs()
    job.final_decision ||              // Direct field
    job.decision ||                    // Set by human decision
    job.application_status ||          // Legacy fallback
    job.workflow_output_d8mdr6bal ||   // Opus output node variables
    job.workflow_output_ojfjahh0s ||
    job.workflow_output_fg5kqpiq4 ||
    job.workflow_output_s5292luro ||
    job.workflow_output_gxbiv80u5 ||
    job.workflow_output_gay6rslpz ||
    job.workflow_output_p1e47k0wq ||
    job.workflow_output_i7abcyo03 ||
    "Pending Review"
  );
};
```
 
### resolveCaseStatus() — Derived From Decision
 
```javascript
const resolveCaseStatus = (job = {}) => {
  const decision = resolveDecision(job);
  const normalized = (decision || "").trim().toLowerCase();
  if (normalized === "selected" || normalized === "rejected" || normalized === "deny") {
    return "Closed";
  }
  return "Open";
};
```
 
### resolveScreeningStatus() — Job Status → Display Label
 
```javascript
const resolveScreeningStatus = (job = {}) => {
  if (job.status === "COMPLETED") return "Completed";
  if (job.status === "IN PROGRESS") return "In Progress";
  return "Not Started";
};
```
 
### How the Inbox Table Renders Status
 
```jsx
{/* Case Status column */}
<td className="px-4 py-3 whitespace-nowrap">
  <StatusBadge value={c.case_status} kind="application" />
</td>
 
{/* Application Status column */}
<td className="px-4 py-3 whitespace-nowrap">
  <StatusBadge value={c.application_status} kind="application" />
</td>
```
 
### When Does the Inbox Refresh?
 
The inbox **does NOT auto-poll**. It refreshes when:
1. **Page load** — `useEffect` calls `fetchInbox()` on mount
2. **After Reset** — `handleReset()` calls `fetchInbox()` again
3. **Navigation back** — React remounts InboxPage when user navigates back from Case Detail
 
So the inbox shows **stale data** until the user navigates back. The backend's background `statusSync` (every 30s) keeps `jobs.json` updated, so the next time the user visits the inbox, they see fresh status.
 
---
 
## Part 2: Case Detail Page — Status at the TOP
 
### What the User Sees
 
At the top of the Case Detail page there's a panel showing:
- Before screening: `request_type`, `screening_status`, `application_status` badges
- During screening: "Under Review" badge
- After screening: The decision from `screeningResult` (e.g., "Selected", "Deny")
 
### How It Works
 
```jsx
{/* Card body — Status badges at TOP of case detail */}
<div className="px-6 py-4">
  <div className="flex flex-wrap gap-2">
    {screeningLoading ? (
      // While screening is running → show "Under Review"
      <StatusBadge value="Under Review" kind="screening" />
    ) : screeningResult ? (
      // After screening completes → show the DECISION from screening result
      <StatusBadge
        value={screeningResult.decision || screeningResult.case_status || "Under Review"}
        kind="application"
      />
    ) : (
      // Before screening (or view mode with no cached result) → show case info from backend
      <>
        <StatusBadge value={caseInfo.request_type}       kind="request" />
        <StatusBadge value={caseInfo.screening_status}   kind="screening" />
        <StatusBadge value={caseInfo.application_status} kind="application" />
      </>
    )}
  </div>
</div>
```
 
### Data Source for Top Panel
 
| State | Source | Shows |
|-------|--------|-------|
| Before screening | `GET /case-status/:studentId` → `caseInfo` | request_type + screening_status + application_status |
| During screening | Hardcoded | "Under Review" |
| After screening | `POST /trigger-screening/:studentId` → `screeningResult` | `screeningResult.decision` |
| View mode (cached) | `sessionStorage` → `screeningResult` | `screeningResult.decision` |
 
---
 
## Part 3: Case Detail Page — Status at the BOTTOM (After Screening)
 
### What the User Sees After Screening
 
Two sections show status at the bottom:
 
#### A. Decision Summary Card (immediately after screening completes)
 
Shows three tiles: **Agent Decision**, **Deficiency Status**, **Case Status**
 
```jsx
{screeningResult && !screeningLoading && (
  <DecisionSummaryCard result={screeningResult} />
)}
```
 
```jsx
function DecisionSummaryCard({ result }) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-[#002855]">
        <h3 className="text-sm font-semibold text-white">Decision Summary</h3>
      </div>
      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-5">
        {/* Agent Decision */}
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Agent Decision</p>
          <StatusBadge value={result.decision} kind="decision" />
        </div>
        {/* Deficiency Status */}
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Deficiency Status</p>
          <StatusBadge value={result.flagged_or_verified} kind="flagged" />
        </div>
        {/* Case Status */}
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Case Status</p>
          <StatusBadge value={result.case_status} kind="application" />
        </div>
      </div>
    </div>
  );
}
```
 
**Data source:** `screeningResult` object returned by `POST /trigger-screening/:studentId`
 
#### B. Final Decision Banner (after human clicks Approve/Reject/etc.)
 
Shows **Case Status** and **Application Status** tiles with colored backgrounds.
 
```jsx
{finalResult && (
  <FinalDecisionBanner
    result={finalResult}
    onBack={() => navigate('/')}
    onRerun={handleTriggerScreening}
    loading={screeningLoading}
  />
)}
```
 
```jsx
function FinalDecisionBanner({ result, onBack, onRerun, loading }) {
  const appStyle = getAppStatusStyle(result.application_status || result.decision);
  const caseStyle = getCaseStatusStyle(result.case_status);
  const bodyBg = getBodyBg(result.decision || result.application_status, result.case_status);
 
  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Header with decision badge */}
      <div className="px-6 py-4 bg-[#002855] flex items-center gap-3">
        <h2 className="text-sm font-semibold text-white">Case Finalized</h2>
        <StatusBadge value={result.decision} kind="decision" />
      </div>
      {/* Status tiles */}
      <div className={`p-6 grid grid-cols-2 gap-4 ${bodyBg}`}>
        <div className={`${caseStyle.tile} rounded-lg p-3`}>
          <p className="text-xs text-[#6B7280] uppercase">Case Status</p>
          <p className={`font-bold text-sm ${caseStyle.text}`}>{result.case_status || '—'}</p>
        </div>
        <div className={`${appStyle.tile} rounded-lg p-3`}>
          <p className="text-xs text-[#6B7280] uppercase">Application Status</p>
          <p className={`font-bold text-sm ${appStyle.text}`}>{result.application_status || '—'}</p>
        </div>
      </div>
      {/* Action buttons */}
      <div className="px-6 pb-6 flex gap-3">
        <button onClick={onBack}>← Home</button>
        <button onClick={onRerun} disabled={loading}>Re-run Screening</button>
      </div>
    </div>
  );
}
```
 
**Data source:** `finalResult` object returned by `POST /human-decision/:threadId`
 
---
 
## Part 4: The Complete Data Flow — End to End
 
### Flow A: Screening Updates Status
 
```
1. User clicks "Start Screening →" in Inbox
       │
2. Navigate to /case/:studentId with mode='screen'
       │
3. CaseDetailPage mounts:
   ├─ GET /case-status/:studentId → caseInfo (status = "Under Review")
   │   → TOP shows: "Under Review" badge
   │
   ├─ POST /trigger-screening/:studentId (long-running, waits for Opus)
   │  
   │   Backend:
   │   ├─ Initiates Opus workflow
   │   ├─ Polls every 5s until COMPLETED
   │   ├─ Reads workflow outputs (decision, case_status, flags)
   │   ├─ Saves to jobs.json: { status: "COMPLETED", decision: "Selected", ... }
   │   └─ Returns screeningResult JSON
   │
4. Frontend receives screeningResult:
   ├─ TOP badge updates: screeningResult.decision → "Selected"
   ├─ BOTTOM shows DecisionSummaryCard:
   │   ├─ Agent Decision: screeningResult.decision ("Selected")
   │   ├─ Deficiency Status: screeningResult.flagged_or_verified ("Verified")
   │   └─ Case Status: screeningResult.case_status ("Closed")
   └─ Caches in sessionStorage
       
5. User navigates back to Inbox:
   ├─ GET /inbox → reads updated jobs.json
   ├─ Case Status column: "Closed" (derived from decision)
   └─ Application Status column: "Selected" (from resolveDecision)
```
 
### Flow B: Human Decision Updates Status
 
```
6. User clicks "Approve" button (HumanReviewPanel)
       │
7. Frontend:
   ├─ POST /human-decision/:threadId { human_decision: "approve" }
   │
   │   Backend:
   │   ├─ Maps "approve" → { decision: "Selected", application_status: "Selected", case_status: "Closed" }
   │   ├─ Saves to jobs.json
   │   └─ Returns finalResult JSON
   │
8. Frontend receives finalResult:
   ├─ HumanReviewPanel disappears (finalResult is truthy)
   ├─ FinalDecisionBanner appears:
   │   ├─ Case Status tile: "Closed" (green)
   │   └─ Application Status tile: "Selected" (green)
   └─ Updates sessionStorage cache
 
9. User navigates back to Inbox:
   ├─ GET /inbox → reads updated jobs.json
   ├─ Case Status: "Closed"
   ├─ Application Status: "Selected"
   └─ Button changes from "Start Screening" → "View Details"
```
 
---
 
## Part 5: Backend — What Gets Saved to jobs.json
 
### After Screening Completes (workflow outputs)
 
```json
{
  "jobId": "opus-execution-id-123",
  "studentId": "45090489",
  "applicant_name": "Ariana Arvanitis",
  "status": "COMPLETED",
  "workflow_output_d8mdr6bal": "Selected",
  "workflow_output_xrxx2p2el": "Verified",
  "merged_final_decision": "Selected",
  "merged_case_status": "Closed",
  "merged_flagged_or_verified": "Verified",
  "screeningStartedAt": 1718450000000,
  "screeningCompletedAt": 1718450135000
}
```
 
### After Human Decision
 
The same job record gets updated with explicit `decision` and `application_status` fields:
 
```json
{
  "jobId": "opus-execution-id-123",
  "studentId": "45090489",
  "status": "COMPLETED",
  "decision": "Selected",
  "application_status": "Selected",
  "case_status": "Closed",
  "workflow_output_p1e47k0wq": "Selected",
  "workflow_output_i7abcyo03": "Selected"
}
```
 
---
 
## Part 6: Screening Result Response Shape
 
The `/trigger-screening/:studentId` endpoint returns this object (used for both top and bottom display):
 
```json
{
  "thread_id": "opus-job-execution-id",
  "student_id": "45090489",
  "execution_time": "2m 15s",
  "decision": "Selected",
  "flagged_or_verified": "Verified",
  "case_status": "Closed",
  "completeness_flags": {
    "ID and Personal Details": { "text": "Identity verified", "color": "green", "status": "green" },
    "Gradesheets and Certificates": { "text": "Present", "color": "green", "status": "green" },
    "LOR Documents": { "text": "Present", "color": "green", "status": "green" },
    "Work Experience Documents": { "text": "Missing", "color": "red", "status": "red" }
  },
  "screening_flags": {
    "GPA Result": { "text": "GPA above threshold", "color": "green", "status": "green" },
    "Work Experience Result": { "text": "5 years experience", "color": "green", "status": "green" },
    "LOR University Result": { "text": "Accredited", "color": "green", "status": "green" },
    "LOR Date Result": { "text": "Within 2 years", "color": "green", "status": "green" }
  },
  "deficiency_list": [],
  "reason": "No deficiencies.",
  "available_actions": ["approve", "reject", "waitlist", "raise_insufficiency"]
}
```
 
## Part 7: Human Decision Response Shape
 
The `/human-decision/:threadId` endpoint returns:
 
```json
{
  "decision": "Selected",
  "application_status": "Selected",
  "case_status": "Closed",
  "thread_id": "opus-job-execution-id",
  "student_id": "45090489"
}
```
 
---
 
## Part 8: Stats Bar — Counts on Inbox
 
The StatsBar at the top of the Inbox shows Total, Open, and Closed counts derived **client-side** from the cases array:
 
```jsx
export default function StatsBar({ cases }) {
  const total  = cases.length;
  const closed = cases.filter(c =>
    ['closed', 'complete', 'completed'].includes(c.case_status?.toLowerCase())
  ).length;
  const open = cases.filter(c =>
    ['open', 'pending'].includes(c.case_status?.toLowerCase()) || (!c.case_status)
  ).length;
 
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <StatTile label="Total Applications" value={total} color="blue" />
      <StatTile label="Open Cases" value={open} color="blue" />
      <StatTile label="Closed Cases" value={closed} color="yellow" />
    </div>
  );
}
```
 
These counts automatically update when `cases` state changes (i.e., after `fetchInbox()` returns).
 
---
 
## Part 9: Color Styling for Status Values
 
### StatusBadge Component (used everywhere)
 
```jsx
const DECISION_COLORS = {
  'selected':                'bg-green-50 text-[#16a34a]',
  'deny':                    'bg-red-50 text-[#DC2626]',
  'pending review':          'bg-amber-50 text-amber-700',
  'incomplete application':  'bg-amber-50 text-amber-700',
};
 
const APPLICATION_COLORS = {
  'pending':   'bg-amber-50 text-amber-700',
  'open':      'bg-blue-50 text-[#1D4ED8]',
  'approved':  'bg-green-50 text-[#16a34a]',
  'rejected':  'bg-red-50 text-[#DC2626]',
  'closed':    'bg-gray-100 text-[#6B7280]',
};
 
export default function StatusBadge({ value, kind }) {
  const key = value.toLowerCase();
  let colorClass = 'bg-gray-100 text-gray-500';
  if (kind === 'application') colorClass = APPLICATION_COLORS[key] || colorClass;
  if (kind === 'decision')    colorClass = DECISION_COLORS[key] || colorClass;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {value}
    </span>
  );
}
```
 
### FinalDecisionBanner — Dynamic Background Colors
 
```javascript
function getAppStatusStyle(val) {
  const v = (val || '').toLowerCase();
  if (v.includes('select') || v.includes('approv'))
    return { tile: 'bg-green-50 border border-green-200', text: 'text-green-700' };
  if (v.includes('reject') || v.includes('deny'))
    return { tile: 'bg-red-50 border border-red-200', text: 'text-red-700' };
  if (v.includes('waitlist'))
    return { tile: 'bg-blue-50 border border-blue-200', text: 'text-blue-700' };
  if (v.includes('insufficien') || v.includes('incomplete'))
    return { tile: 'bg-amber-50 border border-amber-200', text: 'text-amber-700' };
  return { tile: 'bg-[#F5F6F8]', text: 'text-[#002855]' };
}
 
function getCaseStatusStyle(val) {
  const v = (val || '').toLowerCase();
  if (v === 'closed') return { tile: 'bg-green-50 border border-green-200', text: 'text-green-700' };
  if (v === 'open')   return { tile: 'bg-blue-50 border border-blue-200', text: 'text-blue-700' };
  return { tile: 'bg-[#F5F6F8]', text: 'text-[#002855]' };
}
 
function getBodyBg(val, caseStatus) {
  const v = (val || '').toLowerCase();
  const cs = (caseStatus || '').toLowerCase();
  if (v.includes('select') || cs === 'closed') return 'bg-green-50';
  if (v.includes('reject') || v.includes('deny')) return 'bg-red-50';
  if (v.includes('waitlist')) return 'bg-blue-50';
  if (v.includes('incomplete')) return 'bg-amber-50';
  return 'bg-yellow-50';
}
```
 
---
 
## Part 10: Summary — Where Each Status Value Comes From
 
### Inbox Page Columns
 
| Column | Data Field | Before Screening | After Screening | After Human Decision |
|--------|-----------|------------------|-----------------|---------------------|
| Case Status | `c.case_status` | "Open" | "Closed" (if Selected/Rejected) or "Open" | "Closed" or "Open" based on decision |
| Application Status | `c.application_status` | "Under Review" | Opus workflow output (e.g., "Selected") | Human action mapped value |
 
### Case Detail Page — TOP
 
| State | What Shows | Data Source |
|-------|-----------|-------------|
| Before screening triggered | Request Type + Screening Status + App Status badges | `caseInfo` from `GET /case-status/:studentId` |
| While screening runs | "Under Review" | Hardcoded |
| After screening completes | Decision badge (e.g., "Selected") | `screeningResult.decision` |
 
### Case Detail Page — BOTTOM
 
| Component | When Shown | Fields Displayed | Data Source |
|-----------|-----------|------------------|-------------|
| DecisionSummaryCard | After screening, before human decision | Agent Decision, Deficiency Status, Case Status | `screeningResult` |
| HumanReviewPanel | After screening, before human decision | Action buttons (Approve, Reject, etc.) | `screeningResult.available_actions` |
| FinalDecisionBanner | After human clicks a decision button | Case Status tile, Application Status tile | `finalResult` from `POST /human-decision` |
 
---
 
## Part 11: Complete API Endpoints Summary
 
| Endpoint | Method | Returns | Updates Status? |
|----------|--------|---------|----------------|
| `/inbox` | GET | Array of cases with resolved status | No (read-only) |
| `/case-status/:studentId` | GET | Case info with current status | No (read-only) |
| `/trigger-screening/:studentId` | POST | Screening result with decision | ✅ Yes — saves workflow output to jobs.json |
| `/human-decision/:threadId` | POST | Final decision result | ✅ Yes — overwrites decision in jobs.json |
| `/reset` | POST | Wipes all data | ✅ Yes — clears jobs.json |
 
---
 
## Part 12: Key Implementation Notes for Your Other Project
 
1. **Status is resolved at read-time, not stored separately** — The backend doesn't store a separate `application_status` field initially. It stores raw workflow outputs and resolves the display value using `resolveDecision()` when the inbox/case-status is requested.
 
2. **Human decision explicitly stores fields** — Unlike workflow completion which stores raw outputs, human decision writes explicit `decision`, `application_status`, and `case_status` fields directly.
 
3. **Case status is always derived** — Never stored independently. Always computed from the decision value (`Selected`/`Rejected` → Closed, everything else → Open).
 
4. **Frontend uses three state variables** for the Case Detail page:
   - `caseInfo` — from GET /case-status (initial load)
   - `screeningResult` — from POST /trigger-screening (after AI runs)
   - `finalResult` — from POST /human-decision (after reviewer acts)
   
   The UI conditionally renders different panels based on which of these is populated.
 
5. **SessionStorage caching** — Results are cached so "View Details" mode can restore them without re-triggering the workflow. The cache key is `screening_${studentId}`.
 
6. **No real-time updates on Inbox** — The inbox doesn't poll or use WebSockets. Status updates are visible on the next page visit (since the backend's 30-second sync keeps jobs.json current).
 
 