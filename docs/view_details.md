# View Details Button — Implementation Guide
 
## Overview
 
The "View Details →" button appears on the Inbox table when a student's screening is already completed. Instead of re-triggering the workflow, it navigates to the Case Detail page in **view mode**, which restores cached results from `sessionStorage` without making any API calls to trigger screening.
 
---
 
## When "View Details" vs "Start Screening" Shows
 
In the Inbox table, the Actions column conditionally renders one of two buttons:
 
```jsx
{(() => {
  const as = c.application_status?.toLowerCase() || '';
  const ss = c.screening_status?.toLowerCase() || '';
  const isDone = ss === 'completed' ||
    ['process', 'selected', 'rejected', 'waitlisted', 'incomplete application'].includes(as);
 
  return isDone ? (
    // ✅ Show "View Details" — screening is done
    <button
      onClick={() => navigate(`/case/${c.student_id}`, {
        state: { mode: 'view', attachment_url: c.attachment_url }
      })}
      className="px-3 py-1.5 rounded-lg border border-[#1D4ED8] text-[#1D4ED8] bg-[#E8F0F7] hover:bg-[#d0e2f3] text-xs font-semibold transition-all hover:scale-105 active:scale-95"
    >
      View Details →
    </button>
  ) : (
    // 🔄 Show "Start Screening" — not yet screened
    <button
      onClick={() => navigate(`/case/${c.student_id}`, {
        state: { mode: 'screen', attachment_url: c.attachment_url }
      })}
      className="px-3 py-1.5 rounded-lg bg-[#002855] hover:bg-[#003a7a] text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
    >
      Start Screening →
    </button>
  );
})()}
```
 
**Condition for showing "View Details":**
- `screening_status === 'completed'` OR
- `application_status` is one of: `process`, `selected`, `rejected`, `waitlisted`, `incomplete application`
 
---
 
## Frontend — CaseDetailPage in View Mode
 
### Navigation State
 
```jsx
const location = useLocation();
const mode = location.state?.mode; // 'screen' | 'view'
```
 
### View Mode Logic (useEffect on mount)
 
When `mode === 'view'`, the page **does not** trigger any screening. It only:
1. Loads case info from `GET /case-status/:studentId`
2. Restores screening results from `sessionStorage`
 
```jsx
useEffect(() => {
  let stale = false;
 
  async function init() {
    // Always load case info
    setLoadingCase(true);
    try {
      const data = await getCaseStatus(studentId);
      if (stale) return;
      setCaseInfo(data);
    } catch (err) {
      if (stale) return;
      setCaseError(err?.response?.data?.detail || err.message);
      setLoadingCase(false);
      return;
    }
    setLoadingCase(false);
 
    // VIEW MODE: restore cached results — never trigger screening
    if (mode === 'view') {
      const cached = sessionStorage.getItem(`screening_${studentId}`);
      if (cached) {
        try {
          const { screeningResult: sr, finalResult: fr, elapsedTime: et } = JSON.parse(cached);
          if (stale) return;
          if (sr) {
            setScreeningResult(sr);
            await loadJobAudit(sr.thread_id); // Load audit trail for the job
          }
          if (fr) setFinalResult(fr);
          if (et) setElapsedTime(et);
        } catch (err) {
          console.error('Failed to parse cached screening result', err);
        }
      }
      return; // ← EXIT: do NOT proceed to trigger screening
    }
 
    // SCREEN MODE: would trigger screening here (not in view mode)
    // ...
  }
 
  init();
  return () => { stale = true; };
}, [studentId, mode]);
```
 
### SessionStorage Cache Format
 
The key is `screening_${studentId}` and stores:
 
```json
{
  "screeningResult": {
    "thread_id": "opus-job-id",
    "student_id": "45090489",
    "execution_time": "2m 15s",
    "decision": "Selected",
    "flagged_or_verified": "Verified",
    "case_status": "Closed",
    "completeness_flags": { ... },
    "screening_flags": { ... },
    "deficiency_list": [],
    "reason": "No deficiencies.",
    "available_actions": ["approve", "reject", "waitlist", "raise_insufficiency"]
  },
  "finalResult": {
    "decision": "Selected",
    "application_status": "Selected",
    "case_status": "Closed",
    "thread_id": "opus-job-id",
    "student_id": "45090489"
  },
  "elapsedTime": "2m 15s"
}
```
 
---
 
## Backend — GET /case-status/:studentId
 
This endpoint provides the case metadata for the detail page header:
 
```javascript
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
```
 
### Response Shape (`toCaseInfo`)
 
```javascript
const toCaseInfo = (job) => ({
  student_id: String(job.studentId || ""),
  applicant_name: resolveApplicantName(job),
  request_type: job.request_type || "New",
  screening_status: resolveScreeningStatus(job),    // "Completed" | "In Progress" | "Not Started"
  application_status:
    job.status === "COMPLETED" || job.status === "IN PROGRESS"
      ? resolveDecision(job)
      : "Under Review",
  attachments: resolveAttachmentLabel(job),
  attachment_url: resolveAttachmentUrl(job),         // URL to primary document
  attachment_urls: resolveAllDocumentsForStudent(job), // Array of all documents
});
```
 
### Document Attachment Resolution
 
```javascript
// Returns array of { name, url } for all documents matching the student
const resolveAllDocumentsForStudent = (job) => {
  const applicantName = resolveApplicantName(job);
  const normalizedName = String(applicantName || "").trim().toLowerCase();
  const documentsDir = path.join(__dirname, "../data/documents");
 
  // List files in documents/ directory and find those matching the student's name
  const files = fs.readdirSync(documentsDir).filter((name) => {
    const fullPath = path.join(documentsDir, name);
    return fs.statSync(fullPath).isFile() && name.toLowerCase() !== "readme.md";
  });
 
  const nameToken = normalizedName.replace(/\.pdf$/i, "");
  const matchingFiles = files.filter((file) =>
    file.toLowerCase().includes(nameToken)
  );
 
  if (matchingFiles.length > 0) {
    return matchingFiles.map((file) => ({
      name: file,
      url: `/documents/${encodeURIComponent(file)}`,
    }));
  }
 
  // Fallback to single attachment
  const singleUrl = resolveAttachmentUrl(job);
  if (singleUrl) {
    const fileName = decodeURIComponent(singleUrl.split("/").pop());
    return [{ name: fileName, url: singleUrl }];
  }
  return [];
};
```
 
---
 
## What the View Details Page Renders
 
### 1. Case Info Panel (always shown)
 
```jsx
{!loadingCase && caseInfo && (
  <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
    {/* Header with name, student ID, and Re-run button */}
    <div className="bg-[#002855] px-6 py-4 flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-white">{caseInfo.applicant_name}</h2>
        <p className="font-mono text-xs text-[#93c5fd]">{caseInfo.student_id}</p>
      </div>
      <button onClick={handleTriggerScreening} disabled={screeningLoading}>
        {screeningLoading ? 'Running…' : 'Re-run Screening'}
      </button>
    </div>
 
    {/* Status badges */}
    <div className="px-6 py-4">
      <div className="flex flex-wrap gap-2">
        {screeningResult ? (
          <StatusBadge value={screeningResult.decision || "Under Review"} kind="application" />
        ) : (
          <>
            <StatusBadge value={caseInfo.request_type} kind="request" />
            <StatusBadge value={caseInfo.screening_status} kind="screening" />
            <StatusBadge value={caseInfo.application_status} kind="application" />
          </>
        )}
      </div>
 
      {/* Attached document chips */}
      <AttachmentChips
        attachmentUrls={caseInfo.attachment_urls || []}
        onPreview={(doc) => {
          const url = doc.url.startsWith('http') ? doc.url : `${API_BASE_URL}${doc.url}`;
          setPreviewUrl(url);
          setPreviewTitle(doc.name);
        }}
      />
    </div>
  </div>
)}
```
 
### 2. Agent Results Panel (from cached screeningResult)
 
```jsx
{screeningResult && !screeningLoading && (
  <>
    <AgentResultPanel result={screeningResult} auditTrail={auditTrail} />
    <DecisionSummaryCard result={screeningResult} />
    <DeficiencyAlert deficiencies={screeningResult.deficiency_list} reason={screeningResult.reason} />
  </>
)}
```
 
#### AgentResultPanel Structure
 
Renders two flag sections:
1. **Document Completeness Check** — `completeness_flags` (ID docs, Gradesheets, LOR, Work Experience)
2. **Screening Rules Evaluation** — `screening_flags` (GPA, Work Experience, LOR University, LOR Date)
 
```jsx
export default function AgentResultPanel({ result, auditTrail }) {
  return (
    <div className="space-y-4">
      <FlagSection title="Document Completeness Check" flags={result.completeness_flags} />
      <FlagSection title="Screening Rules Evaluation" flags={result.screening_flags} />
    </div>
  );
}
```
 
Each flag is rendered as a row with color-coded icon (green ✓ / red ✗ / yellow —):
 
```jsx
function FlagItem({ label, value }) {
  const { type, text } = resolveFlagStyle(value);
  // type: 'pass' | 'fail' | 'skip' | 'unavailable'
  // Renders icon + label + description text
}
```
 
#### DecisionSummaryCard
 
```jsx
function DecisionSummaryCard({ result }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-[#002855]">
        <h3 className="text-sm font-semibold text-white">Decision Summary</h3>
      </div>
      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-5">
        <div>
          <p className="text-xs text-[#6B7280]">Agent Decision</p>
          <StatusBadge value={result.decision} kind="decision" />
        </div>
        <div>
          <p className="text-xs text-[#6B7280]">Deficiency Status</p>
          <StatusBadge value={result.flagged_or_verified} kind="flagged" />
        </div>
        <div>
          <p className="text-xs text-[#6B7280]">Case Status</p>
          <StatusBadge value={result.case_status} kind="application" />
        </div>
      </div>
    </div>
  );
}
```
 
#### DeficiencyAlert
 
```jsx
export default function DeficiencyAlert({ deficiencies, reason }) {
  if (!deficiencies || deficiencies.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-red-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-[#002855]">
        <h3 className="text-sm font-semibold text-white">Reason</h3>
      </div>
      <div className="p-5 bg-red-50">
        <ul className="space-y-2">
          {deficiencies.map((d, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="text-sm text-[#374151]">{d}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```
 
### 3. Final Decision Banner (if human already decided)
 
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
 
Shows:
- **Case Status** tile (Closed/Open with color)
- **Application Status** tile (Selected/Rejected/etc. with color)
- "← Home" button
- "Re-run Screening" button
 
### 4. PDF Preview Modal
 
Clicking a document chip opens an iframe-based PDF viewer:
 
```jsx
<PdfPreviewModal
  open={Boolean(previewUrl)}
  previewUrl={previewUrl}
  title={previewTitle}
  onClose={() => { setPreviewUrl(null); setPreviewTitle(''); }}
/>
 
function PdfPreviewModal({ open, previewUrl, title, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 bg-[#002855] text-white flex items-center justify-between">
          <p className="text-sm font-semibold">Application Document Preview</p>
          <button onClick={onClose}>Close</button>
        </div>
        <iframe src={previewUrl} title="PDF Preview" className="w-full h-[72vh]" />
      </div>
    </div>
  );
}
```
 
Documents are served as static files:
```javascript
// app.js
app.use("/documents", express.static(documentsDir));
```
 
---
 
## Row Click Navigation (Alternative to Button)
 
Clicking anywhere on the table row also navigates to the detail page:
 
```jsx
<tr
  onClick={() => {
    const as = c.application_status?.toLowerCase() || '';
    const isDone = ['process', 'selected', 'rejected', 'waitlisted', 'incomplete application'].includes(as);
    navigate(`/case/${c.student_id}`, {
      state: { mode: isDone ? 'view' : 'screen', attachment_url: c.attachment_url }
    });
  }}
  className="cursor-pointer hover:bg-[#E8F0F7]"
>
```
 
---
 
## API Endpoints Used by View Details
 
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/case-status/:studentId` | GET | Load case metadata (name, status, documents) |
| `/jobs/:jobId/audit` | GET | Load audit trail for the screening job |
| `/documents/:filename` | GET | Static file serving for PDF preview |
 
---
 
## Sequence Diagram
 
```
User clicks "View Details →"
        │
        ▼
InboxPage: navigate(`/case/${studentId}`, { state: { mode: 'view' } })
        │
        ▼
CaseDetailPage mounts
        │
        ├─ GET /case-status/:studentId → setCaseInfo()
        │
        ├─ Detect mode === 'view'
        │
        ├─ Read sessionStorage(`screening_${studentId}`)
        │   ├─ screeningResult → setScreeningResult()
        │   ├─ finalResult → setFinalResult()
        │   └─ elapsedTime → setElapsedTime()
        │
        ├─ GET /jobs/:threadId/audit → setAuditTrail()
        │
        ▼
Render:
  ┌─ Case Info Panel (name, ID, status badges, document chips)
  ├─ Agent Result Panel (completeness flags + screening flags)
  ├─ Decision Summary Card (decision, flagged/verified, case status)
  ├─ Deficiency Alert (if deficiencies exist)
  ├─ Final Decision Banner (if human already decided)
  └─ PDF Preview Modal (on document chip click)
```
 
---
 
## Key Differences: View Mode vs Screen Mode
 
| Aspect | View Mode | Screen Mode |
|--------|-----------|-------------|
| Triggers screening? | ❌ No | ✅ Yes |
| Loads from cache? | ✅ sessionStorage | ❌ Fresh API call |
| Shows loading spinner? | ❌ No | ✅ Yes (while screening runs) |
| Shows human review buttons? | Only if no `finalResult` | Yes, after screening completes |
| Re-run available? | ✅ Always (header button) | ✅ Always (header button) |
| Button style | Outlined (border, light bg) | Solid (dark bg, white text) |
 
 