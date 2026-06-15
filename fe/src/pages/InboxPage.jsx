import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getInbox, openInboxUpdatesStream, resetExcel, renameStudentDocuments } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import StatsBar from '../components/StatsBar';
import LoadingSpinner from '../components/LoadingSpinner';

/* ── Pending HITL Reviews table ───────────────────────────────────────────── */

function HitlReviewsTable({ cases, onOpen }) {
  if (cases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-[#CBD5E1] p-6 text-center">
        <p className="text-sm text-[#64748B]">No pending off-platform reviews.</p>
        <p className="text-xs text-[#94A3B8] mt-1">Triggered workflows that reach an off-platform review node will appear here.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-amber-50 text-amber-900 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-semibold">Workflow</th>
              <th className="text-left px-4 py-3 font-semibold">Applicant</th>
              <th className="text-left px-4 py-3 font-semibold">Review Node</th>
              <th className="text-left px-4 py-3 font-semibold">Execution ID</th>
              <th className="text-left px-4 py-3 font-semibold">Received</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="text-left px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c, i) => (
              <tr
                key={c.thread_id || c.student_id}
                onClick={() => onOpen(c)}
                className={`cursor-pointer transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'} hover:bg-amber-50`}
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-[#002855] text-sm">
                    {c.hitl_workflow_name || '(unnamed workflow)'}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-[#0F172A]">{c.applicant_name || '—'}</div>
                  {c.student_id && (
                    <div className="text-[11px] font-mono text-[#94A3B8]">{c.student_id}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[#475569]">
                  {c.hitl_node_name || '—'}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-[#475569]">
                  {(c.thread_id || '').slice(0, 12)}…
                </td>
                <td className="px-4 py-3 text-xs text-[#64748B] whitespace-nowrap">
                  {c.submitted_at || '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                    Pending Review
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onOpen(c)}
                    className="px-3 py-1.5 rounded-lg bg-[#D97706] hover:bg-[#b45309] text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                  >
                    Review →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Regular workflow applicants table ────────────────────────────────────── */

function ApplicantsTable({ cases, onOpenScreen, onOpenView, onRename, renameLoadingId, renamedIds }) {
  if (cases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-[#CBD5E1] p-6 text-center">
        <p className="text-sm text-[#64748B]">No applicants in the queue.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#E8F0F7] text-[#002855] text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Student ID</th>
              <th className="text-left px-4 py-3 font-medium">Applicant Name</th>
              <th className="text-left px-4 py-3 font-medium">Request Type</th>
              <th className="text-left px-4 py-3 font-medium">Case Status</th>
              <th className="text-left px-4 py-3 font-medium">Application Status</th>
              <th className="text-left px-4 py-3 font-medium">Rename</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c, i) => {
              const as = c.application_status?.toLowerCase() || '';
              
              const ss = c.screening_status?.toLowerCase() || '';
              const isDone =
              ss === 'completed' ||
              ['process', 'selected', 'rejected', 'waitlisted', 'incomplete application', 'deny'].includes(as);
              const isRenaming = renameLoadingId === c.student_id;
              const isRenamed = renamedIds?.has(c.student_id);
              return (
                <tr
                  key={c.student_id}
                  onClick={() => isDone ? onOpenView(c) : onOpenScreen(c)}
                  className={`cursor-pointer transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F6F8]'} hover:bg-[#E8F0F7]`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-[#374151] whitespace-nowrap">{c.student_id}</td>
                  <td className="px-4 py-3 font-semibold text-[#002855] whitespace-nowrap">{c.applicant_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge value={c.request_type} kind="request" />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge value={c.case_status} kind="application" />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge value={c.application_status} kind="application" />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {isRenamed ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-100 text-green-700 text-xs font-medium border border-green-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Done
                      </span>
                    ) : (
                      <button
                        onClick={() => onRename(c)}
                        disabled={isRenaming}
                        className="px-3 py-1.5 rounded-lg border border-[#c3d5e8] bg-white hover:bg-[#E8F0F7] text-[#002855] text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Rename & organize documents in Google Drive"
                      >
                        {isRenaming ? 'Renaming…' : 'Rename'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {isDone ? (
                      <button
                        onClick={() => onOpenView(c)}
                        className="px-3 py-1.5 rounded-lg border border-[#1D4ED8] text-[#1D4ED8] bg-[#E8F0F7] hover:bg-[#d0e2f3] text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                      >
                        View Details →
                      </button>
                    ) : (
                      <button
                        onClick={() => onOpenScreen(c)}
                        className="px-3 py-1.5 rounded-lg bg-[#002855] hover:bg-[#003a7a] text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                      >
                        Start Screening →
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 bg-[#F5F6F8] border-t border-[#E2E8F0] text-xs text-[#9CA3AF]">
        {cases.length} applicant{cases.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */

export default function InboxPage() {
  const [cases, setCases]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [resetting, setResetting] = useState(false);
  const [renameLoadingId, setRenameLoadingId] = useState(null);
  const [renamedIds, setRenamedIds] = useState(new Set());
  const navigate = useNavigate();

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getInbox();
      setCases(data);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to fetch inbox.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('screening_'))
      .forEach(k => sessionStorage.removeItem(k));
    setResetting(true);
    setError(null);
    try {
      await resetExcel();
      await fetchInbox();
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Reset failed. Please try again.');
    } finally {
      setResetting(false);
    }
  }, [fetchInbox]);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  useEffect(() => {
    const stream = openInboxUpdatesStream({
      onSnapshot: (payload) => setCases(Array.isArray(payload?.cases) ? payload.cases : []),
      onJobUpdate: (payload) => setCases(Array.isArray(payload?.cases) ? payload.cases : []),
      onError: () => { /* EventSource auto-reconnects */ },
    });
    return () => stream.close();
  }, []);

  // Partition: HITL reviews (off-platform) vs regular workflow applicants.
  
  const applicantCases = useMemo(() => cases, [cases]);

  // HITL cases use the same case detail page as regular workflow cases —
  // the evaluation results and the human-review action box render on one
  // page (matches Karan's UX requirement: results first, action at bottom).
  // const openHitl = (c) => navigate(`/case/${c.student_id}`, { state: { mode: 'view' } });
  const openScreen = (c) => navigate(`/case/${c.student_id}`, { state: { mode: 'screen', attachment_url: c.attachment_url } });
  const openView = (c) => navigate(`/case/${c.student_id}`, { state: { mode: 'view', attachment_url: c.attachment_url } });

  const handleRename = async (c) => {
    if (!c.applicant_name || !c.student_id) return;
    setRenameLoadingId(c.student_id);
    try {
      await renameStudentDocuments(c.applicant_name, c.student_id);
      // Mark as successfully renamed
      setRenamedIds(prev => new Set(prev).add(c.student_id));
    } catch (err) {
      console.error('Rename failed:', err);
      // Optionally show a toast or inline error
    } finally {
      setRenameLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      <header className="bg-[#002855] text-white px-6 py-5 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Laureate Application Screening</h1>
              <p className="text-xs text-[#9CA3AF] mt-0.5">Admissions Review Dashboard</p>
            </div>
          </div>
          <button
            onClick={handleReset}
            disabled={resetting || loading}
            className="
              flex items-center gap-2 px-4 py-2 rounded-lg bg-[#CC0000]
              hover:bg-[#aa0000] text-sm font-medium text-white
              transition-all hover:scale-105 active:scale-95
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {resetting ? (
              <>
                <span
                  className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white inline-block"
                  style={{ animation: 'spin 0.8s linear infinite' }}
                />
                {' '}
                Resetting…
              </>
            ) : (
              <>⟳ Reset</>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700">Error loading inbox</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
            <button onClick={fetchInbox} className="text-xs font-medium text-[#1D4ED8] hover:underline flex-shrink-0">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && <StatsBar cases={applicantCases} />}

        {loading && <LoadingSpinner message="Fetching applications…" />}

        {!loading && !error && (
          <>
            {/* Section 1: Pending Human Reviews — distinct amber theme, always visible */}
            

            {/* Section 2: Regular workflow applicants */}
            <section>
              <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-bold text-[#002855]">
                    Applicants
                  </h2>
                  <span className="text-xs font-semibold bg-[#E8F0F7] text-[#002855] px-2 py-0.5 rounded-full border border-[#cbd5e1]">
                    {applicantCases.length}
                  </span>
                </div>
                <p className="text-xs text-[#64748B]">
                  Regular workflow cases — trigger screening or view results
                </p>
              </div>
              <ApplicantsTable cases={applicantCases} onOpenScreen={openScreen} onOpenView={openView} onRename={handleRename} renameLoadingId={renameLoadingId} renamedIds={renamedIds} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
