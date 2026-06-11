import { useState } from 'react';

/* ── Event metadata ───────────────────────────────────────────────────────── */

const EVENT_META = {
  webhook_received: {
    label: 'Dispatch received from OPUS',
    color: 'bg-blue-50 border-blue-200 text-blue-800',
    dotColor: 'bg-blue-500',
  },
  review_submitted: {
    label: 'Reviewer submitted decision',
    color: 'bg-green-50 border-green-200 text-green-800',
    dotColor: 'bg-green-500',
  },
  hitl_event: {
    label: 'HITL event',
    color: 'bg-gray-50 border-gray-200 text-gray-700',
    dotColor: 'bg-gray-400',
  },
};

function getMeta(type) {
  return EVENT_META[type] || { ...EVENT_META.hitl_event, label: type || 'Event' };
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/* ── Per-event card ───────────────────────────────────────────────────────── */

function EventCard({ event, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getMeta(event.type);

  const summary = (() => {
    if (event.type === 'webhook_received') {
      return `execution ${String(event.execution_id || '').slice(0, 8)}…`;
    }
    if (event.type === 'review_submitted') {
      const decision = event.human_decision || 'unknown';
      const status = event.callback_ok === false ? 'callback failed' : `callback ${event.callback_status || '?'}`;
      return `decision: ${decision} · ${status}`;
    }
    return '';
  })();

  return (
    <div className="relative flex gap-3">
      {/* Timeline rail */}
      <div className="flex flex-col items-center flex-shrink-0 pt-1">
        <div className={`w-3 h-3 rounded-full ${meta.dotColor} ring-4 ring-white shadow-sm`} />
        {!isLast && <div className="w-px flex-1 bg-[#E2E8F0] mt-1" style={{ minHeight: '24px' }} />}
      </div>

      {/* Card */}
      <div className={`flex-1 rounded-lg border ${meta.color} p-3 mb-3`}>
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-sm">{meta.label}</span>
              {event.callback_ok === false && (
                <span className="text-[10px] uppercase font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Failed</span>
              )}
              {event.callback_ok === true && (
                <span className="text-[10px] uppercase font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">OK</span>
              )}
            </div>
            {summary && (
              <p className="text-xs text-[#475569] mt-0.5 font-mono">{summary}</p>
            )}
            <p className="text-[10px] text-[#94A3B8] mt-1">{formatTime(event.at)}</p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((s) => !s)}
            className="text-[10px] uppercase font-semibold text-current opacity-60 hover:opacity-100 flex-shrink-0"
          >
            {expanded ? 'Hide raw' : 'Raw'}
          </button>
        </div>
        {expanded && (
          <pre className="mt-2 text-[10px] bg-white/60 border border-[#E2E8F0] rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-[#0F172A]">
            {JSON.stringify(event, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

export default function HitlAuditTrail({ events = [] }) {
  if (!Array.isArray(events) || events.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
        <div className="bg-[#002855] px-6 py-4">
          <h2 className="text-sm font-bold text-white tracking-wide">Audit Trail</h2>
        </div>
        <div className="p-6 text-xs text-[#64748B] italic">No events recorded yet.</div>
      </div>
    );
  }

  // Show most recent first.
  const sorted = [...events].sort((a, b) => {
    const ta = Date.parse(a.at || 0) || 0;
    const tb = Date.parse(b.at || 0) || 0;
    return tb - ta;
  });

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <div className="bg-[#002855] px-6 py-4 flex items-center gap-2">
        <h2 className="text-sm font-bold text-white tracking-wide">Audit Trail</h2>
        <span className="ml-auto text-xs text-[#93c5fd]">{sorted.length} event{sorted.length === 1 ? '' : 's'}</span>
      </div>
      <div className="p-6">
        {sorted.map((event, i) => (
          <EventCard key={`${event.type}-${event.at}-${i}`} event={event} isLast={i === sorted.length - 1} />
        ))}
      </div>
    </div>
  );
}
