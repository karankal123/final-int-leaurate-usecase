import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getHitlReviewDetail, submitHitlReviewDecision } from '../api/client';
import HumanReviewPanel from '../components/HumanReviewPanel';
import ReviewContextPanel from '../components/ReviewContextPanel';
import HitlAuditTrail from '../components/HitlAuditTrail';
import LoadingSpinner from '../components/LoadingSpinner';

/* ── Status pill ─────────────────────────────────────────────────────────── */

function StatusPill({ status }) {
  const s = String(status || '').toUpperCase();
  const config = {
    PENDING: { label: 'Pending Review', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    SUBMITTED: { label: 'Submitted', cls: 'bg-green-100 text-green-800 border-green-300' },
    CALLBACK_FAILED: { label: 'Callback Failed', cls: 'bg-red-100 text-red-800 border-red-300' },
  };
  const c = config[s] || { label: s, cls: 'bg-gray-100 text-gray-700 border-gray-300' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${c.cls}`}>
      {c.label}
    </span>
  );
}

/* ── Error helpers ────────────────────────────────────────────────────────── */

function opusErrorMessage(opusStatus) {
  if (opusStatus === 401) return 'This review has expired or its callback token was already used. The workflow may have timed out.';
  if (opusStatus === 400) return 'OPUS rejected the output values. Check that every required field is filled with the correct type.';
  if (opusStatus === 404) return 'OPUS could not find this execution. The workflow may have been stopped or restarted.';
  return `OPUS rejected the callback (HTTP ${opusStatus}).`;
}

/* ── Main page ────────────────────────────────────────────────────────────── */

export default function HitlReviewPage() {
  const { threadId } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [decisionLoading, setDecisionLoading] = useState(null);
  const [decisionError, setDecisionError] = useState(null);
  const [submittedResult, setSubmittedResult] = useState(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getHitlReviewDetail(threadId);
      setDetail(data);
    } catch (err) {
      setLoadError(err?.response?.data?.detail || err.message || 'Failed to fetch review detail.');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleDecision = async (type, reviewerOutput = null) => {
    setDecisionLoading(type);
    setDecisionError(null);
    try {
      const apiAction = type === 'raise' ? 'raise_insufficiency' : type;
      const result = await submitHitlReviewDecision(threadId, apiAction, reviewerOutput);
      setSubmittedResult(result);
      // Refresh detail so the audit trail + status update.
      await fetchDetail();
    } catch (err) {
      const data = err?.response?.data;
      if (data?.opus_status) {
        const opusDetail = typeof data.opus_body === 'string'
          ? data.opus_body
          : JSON.stringify(data.opus_body || {}, null, 2);
        setDecisionError(`${opusErrorMessage(data.opus_status)}\n\nOPUS response: ${opusDetail.slice(0, 500)}`);
        // Refresh to surface the failed audit entry.
        await fetchDetail();
      } else {
        setDecisionError(data?.detail || err.message || 'Decision submission failed.');
      }
    } finally {
      setDecisionLoading(null);
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      {/* Header bar */}
      <header className="bg-[#002855] text-white px-6 py-4 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center gap-4 flex-wrap">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[#9CA3AF] hover:text-white text-sm transition-colors"
          >
            ← Inbox
          </button>
          <span className="text-[#475569]">|</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">Off-Platform Human Review</span>
          </div>
          {detail?.hitl_status && (
            <div className="ml-auto"><StatusPill status={detail.hitl_status} /></div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {loading && <LoadingSpinner message="Loading review detail…" />}

        {loadError && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-700">Could not load review</p>
            <p className="text-xs text-red-600 mt-1 font-mono break-words">{loadError}</p>
            <button
              onClick={fetchDetail}
              className="mt-2 text-xs font-medium text-[#1D4ED8] hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !loadError && detail && (
          <>
            {/* Workflow metadata header card */}
            <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg font-bold text-[#002855] truncate">
                    {detail.workflow_name || detail.workflow_meta?.workflow_name || '(unnamed workflow)'}
                  </h1>
                  <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-[#475569]">
                    {detail.applicant_name && detail.applicant_name !== 'Unknown Applicant' && (
                      <span><strong className="text-[#0F172A]">{detail.applicant_name}</strong></span>
                    )}
                    {detail.student_id && (
                      <span className="font-mono text-[#94A3B8]">student: {detail.student_id}</span>
                    )}
                    <span className="font-mono text-[#94A3B8]">execution: {detail.execution_id?.slice(0, 12)}…</span>
                    {detail.submitted_at && (
                      <span>received: {detail.submitted_at}</span>
                    )}
                  </div>
                  {detail.workflow_meta?.workflow_description && (
                    <p className="mt-3 text-xs text-[#475569]">{detail.workflow_meta.workflow_description}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Decision error banner */}
            {decisionError && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-700">Submission failed</p>
                <p className="text-xs text-red-600 mt-1 font-mono break-words whitespace-pre-line">{decisionError}</p>
              </div>
            )}

            {/* Submitted-ok banner */}
            {detail.hitl_status === 'SUBMITTED' && submittedResult && (
              <div className="rounded-xl border border-green-300 bg-green-50 p-4">
                <p className="text-sm font-semibold text-green-800">
                  Decision submitted and accepted by OPUS
                </p>
                <p className="text-xs text-green-700 mt-1">
                  Workflow has resumed downstream of the review node. Decision: <strong>{submittedResult.decision}</strong>
                </p>
              </div>
            )}

            {/* Two-column layout: context (left) + review form (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3">
                <ReviewContextPanel
                  inputs={detail.input_context}
                  outputs={detail.node_output}
                  inputSchema={detail.input_schema}
                  outputSchema={detail.node_output_schema}
                  workflowMeta={detail.workflow_meta}
                />
              </div>

              <div className="lg:col-span-2">
                {(detail.hitl_status === 'PENDING' || detail.hitl_status === 'CALLBACK_FAILED') ? (
                  <HumanReviewPanel
                    agentDecision={detail.decision}
                    availableActions={detail.available_actions}
                    expectedOutputSchema={detail.expected_output_schema?.schema}
                    loading={decisionLoading}
                    onDecision={handleDecision}
                  />
                ) : (
                  <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm p-6">
                    <h2 className="text-sm font-bold text-[#002855] uppercase tracking-wider mb-2">Decision</h2>
                    <p className="text-base font-semibold text-[#0F172A]">{detail.decision || '—'}</p>
                    <p className="text-xs text-[#64748B] mt-1">Case status: {detail.case_status || '—'}</p>
                    {detail.last_callback_status && (
                      <p className="text-[11px] text-[#94A3B8] mt-2 font-mono">
                        Last callback HTTP {detail.last_callback_status}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Audit trail full width */}
            <HitlAuditTrail events={detail.audit_log || []} />

            {/* Debug: last callback payload (collapsible) */}
            {detail.last_callback_payload && (
              <details className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm">
                <summary className="px-6 py-3 text-xs font-semibold text-[#475569] uppercase tracking-wider cursor-pointer hover:bg-[#F8FAFC]">
                  Last callback payload sent to OPUS
                </summary>
                <pre className="px-6 pb-4 text-[10px] font-mono whitespace-pre-wrap break-words text-[#0F172A] overflow-x-auto">
                  {JSON.stringify(detail.last_callback_payload, null, 2)}
                </pre>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}
