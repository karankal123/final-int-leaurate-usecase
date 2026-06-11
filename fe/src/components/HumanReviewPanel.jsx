import { useCallback, useMemo, useState } from 'react';
import SchemaDrivenReviewForm from './SchemaDrivenReviewForm';

/* ── Button config per action type ── */
const BUTTON_CONFIG = {
  approve: {
    label: 'Approve',
    loadingLabel: 'Approving…',
    className: 'bg-[#16a34a] hover:bg-green-700 text-white',
    spinClass: 'border-white/30 border-t-white',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
      </svg>
    ),
  },
  reject: {
    label: 'Reject',
    loadingLabel: 'Rejecting…',
    className: 'bg-[#CC0000] hover:bg-[#aa0000] text-white',
    spinClass: 'border-white/30 border-t-white',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    ),
  },
  waitlist: {
    label: 'Waitlist',
    loadingLabel: 'Processing…',
    className: 'bg-[#1D4ED8] hover:bg-[#1e40af] text-white',
    spinClass: 'border-white/30 border-t-white',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
  },
  raise: {
    label: 'Raise Insufficiency',
    loadingLabel: 'Processing…',
    className: 'border-2 border-[#D97706] text-[#92400e] bg-amber-50 hover:bg-amber-100',
    spinClass: 'border-amber-300 border-t-amber-600',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    ),
  },
};

/* ── Map API action names to internal button keys ── */
function mapAction(apiAction) {
  return apiAction === 'raise_insufficiency' ? 'raise' : apiAction;
}

/* ── Fallback: infer buttons from agentDecision string ── */
function inferButtons(agentDecision) {
  const d = agentDecision?.toLowerCase() || '';
  if (d === 'selected')               return ['approve', 'reject'];
  if (d === 'waitlisted')             return ['approve', 'reject', 'waitlist'];
  if (d === 'rejected')               return ['waitlist', 'reject'];
  return ['approve', 'raise'];
}

export default function HumanReviewPanel({
  agentDecision,
  availableActions,
  onDecision,
  loading,
  expectedOutputSchema,
}) {
  // Schema-driven mode: render a typed form per output variable.
  // Fallback mode: free-form JSON textarea (kept for off-platform tasks that
  // arrive without a schema, e.g. legacy synthetic jobs).
  const hasSchema =
    expectedOutputSchema &&
    typeof expectedOutputSchema === 'object' &&
    Object.keys(expectedOutputSchema).length > 0;

  const [formState, setFormState] = useState({ values: {}, errors: {}, isValid: true });
  const [fallbackJson, setFallbackJson] = useState('');
  const [submitError, setSubmitError] = useState('');

  const buttons = availableActions?.length
    ? availableActions.map(mapAction)
    : inferButtons(agentDecision);

  const handleSchemaChange = useCallback((next) => {
    setFormState(next);
  }, []);

  const fallbackParsed = useMemo(() => {
    if (hasSchema) return null;
    const trimmed = fallbackJson.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { __invalid: 'Reviewer output must be a JSON object.' };
      }
      return parsed;
    } catch {
      return { __invalid: 'Reviewer output is not valid JSON.' };
    }
  }, [fallbackJson, hasSchema]);

  const handleDecisionClick = (type) => {
    setSubmitError('');

    if (hasSchema) {
      if (!formState.isValid) {
        const errCount = Object.keys(formState.errors).length;
        setSubmitError(
          `Fix ${errCount} field${errCount === 1 ? '' : 's'} before submitting.`
        );
        return;
      }
      onDecision(type, formState.values);
      return;
    }

    if (fallbackParsed?.__invalid) {
      setSubmitError(fallbackParsed.__invalid);
      return;
    }
    onDecision(type, fallbackParsed);
  };

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-[#002855] px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Human Review Required</h2>
          <p className="text-xs text-[#93c5fd] mt-0.5">
            {hasSchema
              ? `Fill ${Object.keys(expectedOutputSchema).length} output field${
                  Object.keys(expectedOutputSchema).length === 1 ? '' : 's'
                } and pick a decision`
              : 'Review the agent analysis above and submit your decision'}
          </p>
        </div>
      </div>

      {/* Form area */}
      <div className="px-6 pt-6 pb-2">
        {hasSchema ? (
          <SchemaDrivenReviewForm schema={expectedOutputSchema} onChange={handleSchemaChange} />
        ) : (
          <>
            <label
              htmlFor="reviewer-output-json"
              className="block text-xs font-semibold text-[#475569] uppercase tracking-wider mb-2"
            >
              Reviewer Output (Optional JSON)
            </label>
            <textarea
              id="reviewer-output-json"
              value={fallbackJson}
              onChange={(event) => {
                setFallbackJson(event.target.value);
                if (submitError) setSubmitError('');
              }}
              placeholder='{"workflow_output_final_decision":"approve","workflow_output_approved_amount":250000}'
              className="w-full min-h-[96px] rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs font-mono text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/30 focus:border-[#1D4ED8]"
            />
            <p className="text-[11px] text-[#64748B] mt-1.5">
              Send corrections mapped by expected output variable_name or schema id.
            </p>
          </>
        )}

        {submitError && (
          <p className="text-xs text-[#CC0000] mt-2 font-medium">{submitError}</p>
        )}
      </div>

      {/* Actions */}
      <div className="p-6 flex flex-col sm:flex-row gap-4">
        {buttons.map((type) => {
          const cfg = BUTTON_CONFIG[type];
          if (!cfg) return null;
          const isActive = loading === type;
          return (
            <button
              key={type}
              onClick={() => handleDecisionClick(type)}
              disabled={!!loading}
              className={`
                flex-1 flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-lg
                font-semibold text-sm shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                ${cfg.className}
              `}
            >
              {isActive ? (
                <>
                  <span
                    className={`w-4 h-4 rounded-full border-2 inline-block flex-shrink-0 ${cfg.spinClass}`}
                    style={{ animation: 'spin 0.8s linear infinite' }}
                  />
                  {cfg.loadingLabel}
                </>
              ) : (
                <>
                  {cfg.icon}
                  {cfg.label}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
