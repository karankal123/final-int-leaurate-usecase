/**
 * AgentResultPanel — renders completeness_flags + screening_flags in two columns
 */

/* Strip trailing ✓, ✗, or — characters from the API value text */
function cleanText(value) {
  return value?.replace(/\s*[✓✗—]\s*$/, '').trim() || '';
}

function PassIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-[#16a34a]" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
    </svg>
  );
}

function FailIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-[#DC2626]" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-[#D97706]" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function FlagItem({ label, value }) {
  const pass = value?.includes('✓');
  const fail = value?.includes('✗');
  const skip = value?.includes('—') && !pass && !fail;
  const clean = cleanText(value);

  let rowHoverClass = 'hover:bg-gray-50/50';
  let iconBgClass = 'bg-gray-100';
  let textClass = 'text-[#6B7280]';
  let iconNode = <SkipIcon />;

  if (pass) {
    rowHoverClass = 'hover:bg-green-50/50';
    iconBgClass = 'bg-green-100';
    textClass = 'text-[#16a34a]';
    iconNode = <PassIcon />;
  } else if (fail) {
    rowHoverClass = 'hover:bg-red-50/50';
    iconBgClass = 'bg-red-100';
    textClass = 'text-[#DC2626]';
    iconNode = <FailIcon />;
  } else if (skip) {
    rowHoverClass = 'hover:bg-amber-50/50';
    iconBgClass = 'bg-amber-100';
    textClass = 'text-[#D97706]';
    iconNode = <SkipIcon />;
  }

  return (
    <li className={`flex items-start gap-3 px-5 py-3.5 ${rowHoverClass} transition-colors`}>
      {/* Icon circle */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${iconBgClass}`}>
        {iconNode}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1F2937]">{label}</p>
        <p className={`text-xs mt-0.5 ${textClass}`}>
          {clean}
        </p>
      </div>
    </li>
  );
}

function FlagSection({ title, flags }) {
  const entries = Object.entries(flags || {});

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="px-5 py-3.5 bg-[#E8F0F7] border-b border-[#D1DEF0]">
        <h3 className="text-xs font-bold text-[#002855] uppercase tracking-wider">
          {title}
        </h3>
      </div>
      {/* Items */}
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 italic p-5">No data available.</p>
      ) : (
        <ul className="divide-y divide-[#F1F5F9]">
          {entries.map(([k, v]) => (
            <FlagItem key={k} label={k} value={v} />
          ))}
        </ul>
      )}
    </div>
  );
}

function prettyValue(value) {
  if (value === null || value === undefined) {
    return 'No response payload';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.error('Failed to stringify audit value', err);
    return String(value);
  }
}

function getObjectField(source, keys = []) {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key];
    }
  }

  return undefined;
}

function normalizeAuditEntries(auditTrail) {
  let auditArray = [];

  if (Array.isArray(auditTrail)) {
    auditArray = auditTrail;
  } else if (Array.isArray(auditTrail?.result)) {
    auditArray = auditTrail.result;
  } else if (Array.isArray(auditTrail?.audit)) {
    auditArray = auditTrail.audit;
  } else if (Array.isArray(auditTrail?.entries)) {
    auditArray = auditTrail.entries;
  } else if (Array.isArray(auditTrail?.steps)) {
    auditArray = auditTrail.steps;
  } else if (Array.isArray(auditTrail?.data)) {
    auditArray = auditTrail.data;
  }

  return auditArray.map((entry, index) => {
    const raw = entry && typeof entry === 'object' ? entry : { response: entry };

    const agentName = getObjectField(raw, [
      'agent_name',
      'agentName',
      'agent',
      'node_name',
      'nodeName',
      'step_name',
      'stepName',
      'name',
    ]) || `Agent ${index + 1}`;

    const status = getObjectField(raw, ['status', 'state', 'outcome']);
    const timestamp = getObjectField(raw, ['timestamp', 'created_at', 'createdAt', 'time']);
    const response = getObjectField(raw, ['response', 'output', 'result', 'message', 'content', 'payload']) ?? raw;

    return {
      id: getObjectField(raw, ['id', 'event_id', 'eventId']) || `${agentName}-${index}`,
      agentName,
      status,
      timestamp,
      response,
    };
  });
}

function AuditTrailSection({ auditTrail, result }) {
  const entries = normalizeAuditEntries(auditTrail);
  const fallbackSummary = {
    job_status: result?.job_status,
    hitl_status: result?.hitl_status,
    decision: result?.decision,
    case_status: result?.case_status,
    reason: result?.reason,
    available_actions: result?.available_actions,
    deficiency_list: result?.deficiency_list,
  };

  return (
    <div className="mt-4 bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 bg-[#E8F0F7] border-b border-[#D1DEF0]">
        <h3 className="text-xs font-bold text-[#002855] uppercase tracking-wider">
          Agent Responses (Audit Trail)
        </h3>
      </div>

      {entries.length === 0 ? (
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500 italic">Audit trail is not available from upstream. Showing latest screening payload snapshot.</p>
          <pre className="text-xs text-[#0F172A] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
            {prettyValue(fallbackSummary)}
          </pre>
        </div>
      ) : (
        <ul className="divide-y divide-[#F1F5F9]">
          {entries.map((entry) => (
            <li key={entry.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-[#1F2937]">{entry.agentName}</span>
                {entry.status && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F5F6F8] text-[#4B5563] border border-[#E5E7EB]">
                    {String(entry.status)}
                  </span>
                )}
                {entry.timestamp && (
                  <span className="text-[11px] text-[#6B7280]">{String(entry.timestamp)}</span>
                )}
              </div>
              <pre className="text-xs text-[#0F172A] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
                {prettyValue(entry.response)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AgentResultPanel({ result, auditTrail }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FlagSection title="Document Completeness Check" flags={result.completeness_flags} />
      <FlagSection title="Screening Rules Evaluation"  flags={result.screening_flags} />
    </div>
  );
}
