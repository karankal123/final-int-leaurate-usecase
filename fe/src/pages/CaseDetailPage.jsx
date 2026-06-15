import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  getCaseScreening,
  getCaseStatus,
  getJobAudit,
  openCaseUpdatesStream,
  triggerScreening,
  submitHumanDecision,
  renameStudentDocuments,
  resolveAttachmentPreviewUrl,
} from '../api/client';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import AgentResultPanel from '../components/AgentResultPanel';
import DeficiencyAlert from '../components/DeficiencyAlert';
import HumanReviewPanel from '../components/HumanReviewPanel';
import PdfPreviewModal from '../components/PdfPreviewModal';
import AttachmentChipsComponent, { parseAttachmentString } from '../components/AttachmentChips';

/* ── Decision banner border / bg logic ── */
function getBannerStyle(decision, caseStatus) {
  const d = decision?.toLowerCase() || '';
  const cs = caseStatus?.toLowerCase() || '';
  if (d === 'selected' || cs === 'closed') {
    return 'border-green-400 bg-green-50 text-green-800';
  }
  if (d === 'deny') {
    return 'border-red-400 bg-red-50 text-red-800';
  }
  if (d === 'incomplete application') {
    return 'border-orange-400 bg-orange-50 text-orange-800';
  }
  return 'border-yellow-400 bg-yellow-50 text-yellow-800';
}

function getBannerIcon(decision, caseStatus) {
  // Reserved for future inline-icon variant; emoji glyphs intentionally
  // removed in favour of text labels and CSS-driven status colours.
  const d = decision?.toLowerCase() || '';
  const cs = caseStatus?.toLowerCase() || '';
  if (d === 'selected' || cs === 'closed') return '';
  if (d === 'deny') return '';
  if (d === 'incomplete application') return '';
  return '';
}

/* ── Decision Summary Card ── */
function DecisionSummaryCard({ result }) {
  const agentDecision = result?.is_processing ? 'Under Review' : 'Incomplete Application';

  return (
    <div className="mt-4 bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-[#002855] flex items-center gap-2">
        <svg className="w-4 h-4 text-[#93c5fd]" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
        <h3 className="text-sm font-semibold text-white tracking-wide">Decision Summary</h3>
      </div>
      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-5">
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Agent Decision</p>
          <StatusBadge value={agentDecision} kind="decision" />
        </div>
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Deficiency Status</p>
          <StatusBadge value={result.flagged_or_verified} kind="flagged" />
        </div>
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Case Status</p>
          <StatusBadge value={result.case_status} kind="application" />
        </div>
      </div>
    </div>
  );
}

/* ══════════════ MAIN PAGE ══════════════ */
export default function CaseDetailPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = location.state?.mode; // 'screen' | 'view' | undefined

  /* ── State ── */
  const [caseInfo,      setCaseInfo]      = useState(null);
  const [loadingCase,   setLoadingCase]   = useState(true);
  const [caseError,     setCaseError]     = useState(null);

  const [screeningLoading,  setScreeningLoading]  = useState(false);
  const [screeningResult,   setScreeningResult]   = useState(null);
  const [screeningError,    setScreeningError]    = useState(null);
  const [auditTrail,        setAuditTrail]        = useState([]);

  const [decisionLoading,   setDecisionLoading]   = useState(null); // 'approve' | 'raise' | null
  const [finalResult,       setFinalResult]       = useState(null);
  const [decisionError,     setDecisionError]     = useState(null);
  const [elapsedTime,       setElapsedTime]       = useState(null);

  /* ── Preview Modal State ── */
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewTitle, setPreviewTitle] = useState('');

  /* ── Rename State ── */
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameResult, setRenameResult] = useState(null);
  const [renameError, setRenameError] = useState(null);
  const humanDecisionSubmitted = useRef(false);

  const isFinalizedStatus = useCallback((value) => {
    const status = String(value || '').toLowerCase();
    return ['selected', 'rejected', 'waitlisted', 'incomplete application', 'deny'].includes(status);
  }, []);

  const loadJobAudit = useCallback(async (threadId) => {
    if (!threadId) {
      setAuditTrail([]);
      return;
    }
    try {
      const audit = await getJobAudit(threadId);
      setAuditTrail(audit || []);
    } catch (err) {
      console.error('Failed to fetch audit trail', err);
      setAuditTrail([]);
    }
  }, []);

  const hydrateFromPayload = useCallback(async (payload) => {
    if (!payload) {
      return;
    }

    const incomingCaseInfo = payload.case_info || null;
    const incomingScreening = payload.screening_result || null;

    if (incomingCaseInfo) {
      setCaseInfo(incomingCaseInfo);
    }

    if (incomingScreening) {
      setScreeningResult(incomingScreening);
      if (incomingScreening.execution_time) {
        setElapsedTime(incomingScreening.execution_time);
      }
      const processing = Boolean(incomingScreening.is_processing);
      const hasHumanActions = Array.isArray(incomingScreening.available_actions) && incomingScreening.available_actions.length > 0;
      setScreeningLoading(processing);

      if (!processing && incomingScreening.thread_id) {
        await loadJobAudit(incomingScreening.thread_id);
      }

      // getCaseScreening payload does not carry case_info, so incomingCaseInfo
      // is often null. Fall back through available fields to find a status value.
      const resolvedAppStatus =
        incomingCaseInfo?.application_status ||
        incomingScreening?.application_status ||
        incomingScreening?.decision;
      const resolvedCaseStatus =
        incomingCaseInfo?.case_status ||
        incomingScreening?.case_status;
      const resolvedFinalDecision =
        incomingScreening?.final_decision ||
        incomingScreening?.decision ||
        resolvedAppStatus;

      const alreadyFinalized = isFinalizedStatus(resolvedAppStatus);

      if (!hasHumanActions && alreadyFinalized) {
        // Case is done — show the final banner.
        setFinalResult({
          decision: resolvedFinalDecision,
          application_status: resolvedAppStatus,
          case_status: resolvedCaseStatus,
          thread_id: incomingScreening.thread_id,
          student_id: incomingScreening.student_id,
        });
      } else if (processing) {
        // Actively running — clear any stale final banner.
        setFinalResult(null);
      } else if (hasHumanActions && !humanDecisionSubmitted.current && !alreadyFinalized) {
        // Genuinely awaiting human input and not yet decided — clear banner so
        // HumanReviewPanel shows. Do NOT clear if alreadyFinalized — a stale
        // available_actions from the backend must not undo a completed decision
        // when viewing a finished case.
        setFinalResult(null);
      }
    }
  }, [isFinalizedStatus, loadJobAudit]);

  /* ── On mount: load case info, then decide based on mode ── */
  useEffect(() => {
    let stale = false;

    async function init() {
      setLoadingCase(true);
      setCaseError(null);
      setScreeningError(null);

      let caseData;
      try {
        caseData = await getCaseStatus(studentId);
        if (stale) return;
        setCaseInfo(caseData);
      } catch (err) {
        if (stale) return;
        setCaseError(err?.response?.data?.detail || err.message || 'Failed to load case.');
        setLoadingCase(false);
        return;
      }

      // View mode reads cached screening details only; it never auto-triggers
      // screening calls.
      if (mode === 'view') {
        const cached = sessionStorage.getItem(`screening_${studentId}`);
        if (cached) {
          try {
            const { screeningResult: sr, finalResult: fr, elapsedTime: et } = JSON.parse(cached);
            if (stale) return;

            if (sr) {
              setScreeningResult(sr);
              if (sr.thread_id) {
                await loadJobAudit(sr.thread_id);
              }
            }
            if (fr) setFinalResult(fr);
            if (et) setElapsedTime(et);
          } catch (err) {
            console.error('Failed to parse cached screening result', err);
          }
        }
        setLoadingCase(false);
        return;
      }

      // For screen mode (or direct open without explicit mode), hydrate from
      // latest backend snapshot.
      let screeningPayload = null;
      try {
        screeningPayload = await getCaseScreening(studentId);
      } catch {
        screeningPayload = null;
      }

      if (!stale && screeningPayload) {
        await hydrateFromPayload(screeningPayload);

        const sr = screeningPayload?.screening_result;
        const actionsEmpty = !Array.isArray(sr?.available_actions) || sr.available_actions.length === 0;
        const isCompleted = String(sr?.job_status || '').toUpperCase() === 'COMPLETED';
        const isFinalized = isFinalizedStatus(sr?.decision || caseData?.application_status);
        if (sr && actionsEmpty && (isCompleted || isFinalized) && !sr.is_processing) {
          setFinalResult({
            decision: sr.final_decision || sr.decision,
            application_status: caseData?.application_status || sr.application_status || sr.decision,
            case_status: caseData?.case_status || sr.case_status,
            thread_id: sr.thread_id,
            student_id: sr.student_id,
          });
        }
      }

      if (stale) return;
      setLoadingCase(false);

      // screen mode: guard against re-triggering an already active/done job.
      // Reuse screeningPayload already fetched above — no second network call.
      if (mode !== 'screen') {
        return;
      }

      const currentScreening = screeningPayload?.screening_result;
      const hasExistingThread = Boolean(currentScreening?.thread_id);
      const hasExistingActions = Array.isArray(currentScreening?.available_actions) && currentScreening.available_actions.length > 0;
      const isAlreadyRunning = Boolean(currentScreening?.is_processing);
      const isAlreadyCompleted = String(currentScreening?.job_status || '').toUpperCase() === 'COMPLETED';
      const isFinalizedDecisionState = isFinalizedStatus(currentScreening?.decision);
      if (hasExistingThread && (hasExistingActions || isAlreadyRunning || isAlreadyCompleted || isFinalizedDecisionState)) {
        return;
      }

      // Only skip auto-trigger if actively processing right now.
      if (isAlreadyRunning) {
        return;
      }

      // SCREEN mode: trigger fresh screening.
      setScreeningLoading(true);
      setScreeningError(null);
      setScreeningResult(null);
      setAuditTrail([]);
      setFinalResult(null);
      try {
        const result = await triggerScreening(studentId);
        if (stale) return;
        setScreeningResult(result);
        if (result?.execution_time) {
          setElapsedTime(result.execution_time);
        }
        if (!result?.is_processing) {
          await loadJobAudit(result.thread_id);
        }
      } catch (err) {
        if (stale) return;
        setScreeningError(err?.response?.data?.detail || err.message || 'Screening failed.');
      } finally {
        if (stale) return;
        setScreeningLoading(false);
      }
    }
    init();
    return () => {
      stale = true;
    };
  }, [studentId, mode, hydrateFromPayload, loadJobAudit]);

  useEffect(() => {
    if (mode === 'view') {
      return () => {};
    }

    const stream = openCaseUpdatesStream(studentId, {
      onSnapshot: (payload) => {
        hydrateFromPayload(payload).catch((err) => {
          console.error('Failed to apply snapshot payload', err);
        });
      },
      onJobUpdate: (payload) => {
        hydrateFromPayload(payload).catch((err) => {
          console.error('Failed to apply realtime payload', err);
        });
      },
      onError: () => {
        // EventSource auto-reconnects; keep UI state as-is.
      },
    });

    return () => {
      stream.close();
    };
  }, [studentId, mode, hydrateFromPayload]);

  useEffect(() => {
    if (!studentId) return;

    if (!screeningResult && !finalResult && !elapsedTime) {
      return;
    }

    const cachePayload = {
      screeningResult,
      finalResult,
      elapsedTime,
    };
    sessionStorage.setItem(`screening_${studentId}`, JSON.stringify(cachePayload));
  }, [studentId, screeningResult, finalResult, elapsedTime]);

  /* ── Re-run screening (clears cache and re-triggers) ── */
  async function handleTriggerScreening() {
    sessionStorage.removeItem(`screening_${studentId}`);
    setScreeningLoading(true);
    setScreeningError(null);
    setScreeningResult(null);
    setAuditTrail([]);
    setFinalResult(null);
    setElapsedTime(null);
    try {
      const result = await triggerScreening(studentId);
      setScreeningResult(result);
      if (result?.execution_time) {
        setElapsedTime(result.execution_time);
      }
      if (!result?.is_processing) {
        await loadJobAudit(result.thread_id);
      }
    } catch (err) {
      setScreeningError(err?.response?.data?.detail || err.message || 'Screening failed.');
    } finally {
      setScreeningLoading(false);
    }
  }

  /* ── Step 4: human decision ── */
  async function handleDecision(type, reviewerOutput = null) {
    if (!screeningResult?.thread_id) return;
    setDecisionLoading(type);
    setDecisionError(null);
    try {
      const apiAction = type === 'raise' ? 'raise_insufficiency' : type;
      const result = await submitHumanDecision(
        screeningResult.thread_id,
        apiAction,
        reviewerOutput
      );
      setCaseInfo((prev) =>
        prev
          ? {
              ...prev,
              application_status: result.application_status || prev.application_status,
              case_status: result.case_status || prev.case_status,
            }
          : prev
      );
      setScreeningResult((prev) =>
        prev
          ? {
              ...prev,
              final_decision: result.decision || prev.final_decision,
              application_status: result.application_status || prev.application_status,
              case_status: result.case_status || prev.case_status,
              available_actions: [],
            }
          : prev
      );
      setFinalResult(result);
      humanDecisionSubmitted.current = true;
    } catch (err) {
      // BE returns 502 with { opus_status, opus_body, sent_body } when OPUS
      // accepted the receipt but rejected the callback body. Surface that
      // explicitly so the reviewer knows what to do.
      const data = err?.response?.data;
      if (data?.opus_status) {
        const opusStatus = data.opus_status;
        const statusMessage =
          opusStatus === 401
            ? 'This review has expired or its callback token was already used. The workflow may have timed out.'
            : opusStatus === 400
              ? 'OPUS rejected the output values. Check that every required field is filled with the correct type.'
              : opusStatus === 404
                ? 'OPUS could not find this execution. The workflow may have been stopped or restarted.'
                : `OPUS rejected the callback (HTTP ${opusStatus}).`;
        const opusDetail =
          typeof data.opus_body === 'string'
            ? data.opus_body
            : JSON.stringify(data.opus_body || {}, null, 2);
        setDecisionError(
          `${statusMessage}\n\nOPUS response: ${opusDetail.slice(0, 500)}`
        );
      } else {
        setDecisionError(data?.detail || err.message || 'Decision submission failed.');
      }
    } finally {
      setDecisionLoading(null);
    }
  }

  /* ── Document Preview Handlers ── */
  const handlePreview = (doc) => {
    const url = resolveAttachmentPreviewUrl(doc);
    if (url) {
      const fileName = String(doc?.name || url).toLowerCase();
      const isPdf = fileName.endsWith('.pdf');

      if (!isPdf) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }

      setPreviewUrl(url);
      setPreviewTitle(doc.name || 'Document');
    }
  };

  const closePreview = () => {
    setPreviewUrl(null);
    setPreviewTitle('');
  };

  /* ── Document Rename Handler ── */
  async function handleRenameDocuments() {
    if (!caseInfo?.applicant_name || !caseInfo?.student_id) return;
    setRenameLoading(true);
    setRenameError(null);
    setRenameResult(null);
    try {
      const result = await renameStudentDocuments(caseInfo.applicant_name, caseInfo.student_id);
      setRenameResult(result);
    } catch (err) {
      setRenameError(err?.response?.data?.detail || err.message || 'Document rename failed.');
    } finally {
      setRenameLoading(false);
    }
  }

  const renderTopStatusBadges = () => {
    if (screeningLoading) {
      return <StatusBadge value="Under Review" kind="screening" />;
    }

    if (screeningResult) {
      const displayApplicationStatus =
        finalResult?.application_status ||
        caseInfo?.application_status ||
        screeningResult.application_status ||
        'Under Review';
      const displayCaseStatus =
        finalResult?.case_status ||
        caseInfo?.case_status ||
        screeningResult.case_status ||
        'Open';

      return (
        <>
          <StatusBadge value={displayCaseStatus} kind="application" />
          <StatusBadge value={displayApplicationStatus} kind="application" />
        </>
      );
    }

    return (
      <>
        <StatusBadge value={caseInfo.request_type} kind="request" />
        <StatusBadge value={caseInfo.screening_status} kind="screening" />
        <StatusBadge value={caseInfo.application_status} kind="application" />
      </>
    );
  };

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-[#F5F6F8]">

      {/* ── Header ── */}
      <header className="bg-[#002855] text-white px-6 py-4 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[#9CA3AF] hover:text-white text-sm transition-colors"
          >
            ← Home
          </button>
          <span className="text-[#6B7280]">|</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">Laureate Application Screening</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Loading case ── */}
        {loadingCase && <LoadingSpinner message="Loading case details…" />}

        {/* ── Case error ── */}
        {caseError && (
          <ErrorBanner
            title="Could not load case"
            message={caseError}
            onRetry={() => {
              setLoadingCase(true);
              getCaseStatus(studentId)
                .then(data => { setCaseInfo(data); setCaseError(null); })
                .catch(e => setCaseError(e?.response?.data?.detail || e.message))
                .finally(() => setLoadingCase(false));
            }}
          />
        )}

        {/* ── Step 1: Case Info Panel ── */}
        {!loadingCase && caseInfo && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            {/* Card header bar */}
            <div className="bg-[#002855] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">{caseInfo.applicant_name}</h2>
                <p className="font-mono text-xs text-[#93c5fd] mt-0.5">{caseInfo.student_id}</p>
              </div>
              {/* Re-run button — always visible after case loads */}
              {!loadingCase && (
                <button
                  onClick={handleTriggerScreening}
                  disabled={screeningLoading}
                  className="
                    flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg
                    bg-white/10 hover:bg-white/20 border border-white/20
                    text-sm text-white font-medium
                    transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                  "
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>
                  {screeningLoading ? 'Running…' : 'Re-run Screening'}
                </button>
              )}
            </div>

            {/* Card body */}
            <div className="px-6 py-4">
              <div className="flex flex-wrap gap-2">{renderTopStatusBadges()}</div>

              {/* Attachments */}
              {(caseInfo.attachment_urls?.length > 0 || caseInfo.attachments) && (
                <div className="mt-4 pt-4 border-t border-[#F1F5F9]">
                  <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-widest mb-2">
                    Attached Documents
                  </p>
                  <AttachmentChipsComponent
                    attachmentUrls={
                      caseInfo.attachment_urls?.length > 0
                        ? caseInfo.attachment_urls
                        : parseAttachmentString(caseInfo.attachments)
                    }
                    onPreview={handlePreview}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Screening in progress ── */}
        {(screeningLoading || screeningResult?.is_processing) && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            <div className="h-1 w-full bg-[#E8F0F7] relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 w-1/2 bg-[#002855] rounded-full"
                style={{ animation: 'progressSlide 1.5s ease-in-out infinite alternate' }} />
            </div>
            <div className="px-8 py-10 flex flex-col items-center gap-5">
              <div className="w-14 h-14 rounded-full bg-[#E8F0F7] flex items-center justify-center">
                <svg className="w-7 h-7 text-[#002855]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-[#002855]">
                  AI agents are reviewing documents
                  <span className="loading-dots ml-1"><span /><span /><span /></span>
                </p>
                <p className="text-sm text-[#6B7280] mt-1.5 max-w-sm">
                  Running OCR → Completeness Check → Screening Rules pipeline.
                </p>
              </div>
              <div className="flex items-center gap-6 text-xs text-[#6B7280]">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a] inline-block" /> OCR
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block" style={{ animation: 'pulse 1s infinite' }} /> Completeness Check
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] inline-block" /> Screening Rules
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Screening error ── */}
        {screeningError && (
          <ErrorBanner
            title="Screening failed"
            message={screeningError}
            onRetry={handleTriggerScreening}
          />
        )}

        {/* ── Step 3: Agent Results ── */}
        {screeningResult && !screeningResult?.is_processing && !screeningLoading && (
          <>
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-5 w-1 rounded-full bg-[#002855]" />
                <h2 className="text-lg font-bold text-[#002855]">Evaluation Results</h2>
                <span className={`ml-auto text-xs px-2.5 py-1 rounded-full border ${
                  screeningResult.flagged_or_verified === 'Flagged'
                    ? 'bg-amber-50 border-amber-300 text-amber-800 font-semibold'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold'
                }`}>
                  {screeningResult.flagged_or_verified === 'Flagged' ? 'Flagged for Review' : 'Verified'}
                </span>
              </div>
              <AgentResultPanel result={screeningResult} auditTrail={auditTrail} />
              <DecisionSummaryCard result={screeningResult} />
              <DeficiencyAlert deficiencies={screeningResult.deficiency_list} reason={screeningResult.reason} />
            </div>

            {/* ── Step 4: Human Review (only if no final result yet) ── */}
            {!finalResult && screeningResult?.available_actions?.length > 0 && (
              <>
                {decisionError && (
                  <ErrorBanner title="Decision submission failed" message={decisionError} />
                )}
                <HumanReviewPanel
                  agentDecision={screeningResult.agent_decision || screeningResult.decision}
                  availableActions={screeningResult.available_actions}
                  expectedOutputSchema={screeningResult.expected_output_schema}
                  loading={decisionLoading}
                  onDecision={handleDecision}
                />
              </>
            )}
          </>
        )}

        {/* ── Step 5: Final Decision Banner ── */}
        {finalResult && (
          <FinalDecisionBanner result={finalResult} onBack={() => navigate('/')} onRerun={handleTriggerScreening} loading={screeningLoading} />
        )}

      </main>

      {/* ── Document Preview Modal ── */}
      <PdfPreviewModal
        open={!!previewUrl}
        previewUrl={previewUrl}
        title={previewTitle}
        onClose={closePreview}
      />
    </div>
  );
}

/* ── Sub-components local to this page ── */

function ErrorBanner({ title, message, onRetry }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-red-700">{title}</p>
        <p className="text-xs text-red-600 mt-0.5 whitespace-pre-line break-words font-mono">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs font-medium text-[#1D4ED8] hover:underline flex-shrink-0"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function getAppStatusStyle(val) {
  const v = (val || '').toLowerCase();
  if (v.includes('select') || v.includes('approv') || v.includes('accept'))
    return { tile: 'bg-green-50 border border-green-200', text: 'text-green-700' };
  if (v.includes('reject') || v.includes('deny'))
    return { tile: 'bg-red-50 border border-red-200', text: 'text-red-700' };
  if (v.includes('waitlist'))
    return { tile: 'bg-blue-50 border border-blue-200', text: 'text-blue-700' };
  if (v.includes('insufficien') || v.includes('incomplete') || v.includes('process'))
    return { tile: 'bg-amber-50 border border-amber-200', text: 'text-amber-700' };
  return { tile: 'bg-[#F5F6F8]', text: 'text-[#002855]' };
}

function getCaseStatusStyle(val) {
  const v = (val || '').toLowerCase();
  if (v === 'closed' || v.includes('complet'))
    return { tile: 'bg-green-50 border border-green-200', text: 'text-green-700' };
  if (v === 'open' || v.includes('pending') || v.includes('review'))
    return { tile: 'bg-blue-50 border border-blue-200', text: 'text-blue-700' };
  if (v.includes('reject') || v.includes('denied'))
    return { tile: 'bg-red-50 border border-red-200', text: 'text-red-700' };
  if (v.includes('hold') || v.includes('wait') || v.includes('escalat'))
    return { tile: 'bg-amber-50 border border-amber-200', text: 'text-amber-700' };
  return { tile: 'bg-[#F5F6F8]', text: 'text-[#002855]' };
}

function getBodyBg(val, caseStatus) {
  const v = (val || '').toLowerCase();
  const cs = (caseStatus || '').toLowerCase();
  if (v.includes('select') || v.includes('approv') || v.includes('accept') || cs === 'closed')
    return 'bg-green-50';
  if (v.includes('reject') || v.includes('deny'))
    return 'bg-red-50';
  if (v.includes('waitlist'))
    return 'bg-blue-50';
  if (v.includes('insufficien') || v.includes('incomplete') || v.includes('process'))
    return 'bg-amber-50';
  return 'bg-yellow-50';
}

function FinalDecisionBanner({ result, onBack, onRerun, loading }) {
  const appStyle  = getAppStatusStyle(result.application_status || result.decision);
  const caseStyle = getCaseStatusStyle(result.case_status);
  const bodyBg    = getBodyBg(result.decision || result.application_status, result.case_status);

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-[#002855] flex items-center gap-3">
        <svg className="w-4 h-4 text-[#93c5fd]" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <h2 className="text-sm font-semibold text-white tracking-wide">Case Finalized</h2>
        <div className="ml-2">
          <StatusBadge value={result.decision} kind="decision" />
        </div>
      </div>
      {/* Body */}
      <div className={`p-6 grid grid-cols-2 gap-4 mb-2 ${bodyBg}`}>
        <div className={`${caseStyle.tile} rounded-lg p-3`}>
          <p className="text-xs text-[#6B7280] mb-1 font-medium uppercase tracking-wide">Case Status</p>
          <p className={`font-bold text-sm ${caseStyle.text}`}>{result.case_status || '—'}</p>
        </div>
        <div className={`${appStyle.tile} rounded-lg p-3`}>
          <p className="text-xs text-[#6B7280] mb-1 font-medium uppercase tracking-wide">Application Status</p>
          <p className={`font-bold text-sm ${appStyle.text}`}>{result.application_status || '—'}</p>
        </div>
      </div>
      <div className="px-6 pb-6 flex flex-wrap gap-3">
        <button
          onClick={onBack}
          className="
            inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
            bg-[#002855] text-white text-sm font-semibold
            hover:bg-[#003a7a] transition-all hover:scale-105 active:scale-95
          "
        >
          ← Home
        </button>
        <button
          onClick={onRerun}
          disabled={loading}
          className="
            inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
            bg-white hover:bg-[#F5F6F8] text-[#002855] border border-[#E2E8F0]
            text-sm font-semibold transition-all hover:scale-105 active:scale-95
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>
          {loading ? 'Running…' : 'Re-run Screening'}
        </button>
      </div>
    </div>
  );
}