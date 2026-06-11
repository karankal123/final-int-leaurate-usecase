import FilePreview, { looksLikeUrl, looksLikeFileUrl } from './FilePreview';

/* ── Type helpers ─────────────────────────────────────────────────────────── */

function pickPrimaryType(allowedTypes) {
  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) return '';
  return allowedTypes[0]?.type || '';
}

/* ── Sub-renderers ────────────────────────────────────────────────────────── */

function PrimitiveValue({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[#94A3B8] italic">(empty)</span>;
  }
  if (looksLikeFileUrl(value)) return <FilePreview url={value} />;
  if (looksLikeUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-[#1D4ED8] hover:underline break-all">
        {value}
      </a>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {value ? 'true' : 'false'}
      </span>
    );
  }
  if (typeof value === 'number') {
    return <span className="font-mono text-sm text-[#0F172A]">{value}</span>;
  }
  return <span className="text-sm text-[#0F172A] break-words whitespace-pre-wrap">{String(value)}</span>;
}

function StructuredValue({ value }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[#94A3B8] italic">(empty array)</span>;
    return (
      <ul className="list-disc ml-5 space-y-1">
        {value.map((item, i) => (
          <li key={i} className="text-sm text-[#0F172A]">
            {typeof item === 'object' && item !== null
              ? <pre className="text-[11px] bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(item, null, 2)}</pre>
              : <PrimitiveValue value={item} />}
          </li>
        ))}
      </ul>
    );
  }
  if (value && typeof value === 'object') {
    return (
      <pre className="text-[11px] bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <PrimitiveValue value={value} />;
}

/* ── Per-variable card ────────────────────────────────────────────────────── */

function VariableCard({ varKey, typedValue, schemaDef }) {
  // typedValue may be { value, type } (canonical), or a raw scalar (degenerate).
  const value = typedValue && typeof typedValue === 'object' && 'value' in typedValue
    ? typedValue.value
    : typedValue;
  const dispatchType = typedValue && typeof typedValue === 'object' && typedValue.type?.type
    ? typedValue.type.type
    : null;

  const displayName = schemaDef?.display_name || schemaDef?.variable_name || varKey;
  const description = schemaDef?.description || '';
  const typeLabel = dispatchType || pickPrimaryType(schemaDef?.allowed_types) || 'value';

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-[#0F172A]">{displayName}</span>
        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[#E8F0F7] text-[#002855]">
          {typeLabel}
        </span>
        <span className="ml-auto text-[10px] font-mono text-[#94A3B8]">{varKey}</span>
      </div>
      {description && (
        <p className="text-[11px] text-[#64748B]">{description}</p>
      )}
      <div className="text-sm">
        <StructuredValue value={value} />
      </div>
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────────────────────── */

function EmptySection({ label }) {
  return (
    <div className="bg-[#F8FAFC] border border-dashed border-[#CBD5E1] rounded-lg p-4 text-center">
      <p className="text-xs text-[#64748B] italic">{label}</p>
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────────────────────── */

/**
 * Renders the upstream node's inputs and outputs that the reviewer needs to
 * judge. Uses workflow_meta (fetched from OPUS) for display names when
 * available; falls back to schema keys.
 *
 * Props:
 *   inputs        — object keyed by variable_name, values may be {value,type} or raw
 *   outputs       — object keyed by variable_name, same shape as inputs
 *   inputSchema   — dispatch-side input schema (variable definitions)
 *   outputSchema  — dispatch-side output schema (variable definitions)
 *   workflowMeta  — { workflow_name, upstream_node: { name, input_schema, output_schema } }
 */
export default function ReviewContextPanel({
  inputs = {},
  outputs = {},
  inputSchema = {},
  outputSchema = {},
  workflowMeta = null,
}) {
  // Schema lookup order: workflowMeta (from OPUS API, richest) → dispatch schema → empty.
  const mergedInputSchema = {
    ...inputSchema,
    ...(workflowMeta?.upstream_node?.input_schema || {}),
  };
  const mergedOutputSchema = {
    ...outputSchema,
    ...(workflowMeta?.upstream_node?.output_schema || {}),
  };

  const inputEntries = Object.entries(inputs || {});
  const outputEntries = Object.entries(outputs || {});

  const upstreamNodeName = workflowMeta?.upstream_node?.name;
  const upstreamNodeType = workflowMeta?.upstream_node?.handler_class;
  const upstreamNodeDescription = workflowMeta?.upstream_node?.description;

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-[#002855] px-6 py-4">
        <div className="flex items-center gap-3 mb-1">
          <svg className="w-5 h-5 text-[#93c5fd] flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2h1a3 3 0 006 0h1a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
          </svg>
          <h2 className="text-sm font-bold text-white tracking-wide">Review Context</h2>
        </div>
        {upstreamNodeName ? (
          <div className="text-xs text-[#93c5fd]">
            From upstream node: <span className="font-semibold text-white">{upstreamNodeName}</span>
            {upstreamNodeType && <span className="ml-2 px-1.5 py-0.5 bg-white/10 rounded text-[10px] font-mono">{upstreamNodeType}</span>}
          </div>
        ) : (
          <p className="text-xs text-[#93c5fd]">Context dispatched by the OPUS workflow for review</p>
        )}
      </div>

      {upstreamNodeDescription && (
        <div className="px-6 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0]">
          <p className="text-xs text-[#475569]">{upstreamNodeDescription}</p>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Upstream Inputs */}
        <section>
          <h3 className="text-xs font-bold text-[#002855] uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>Upstream Inputs</span>
            <span className="text-[#94A3B8] font-normal">({inputEntries.length})</span>
          </h3>
          {inputEntries.length === 0 ? (
            <EmptySection label="No inputs surfaced for this review" />
          ) : (
            <div className="space-y-2">
              {inputEntries.map(([key, typedValue]) => (
                <VariableCard
                  key={key}
                  varKey={key}
                  typedValue={typedValue}
                  schemaDef={mergedInputSchema[key]}
                />
              ))}
            </div>
          )}
        </section>

        {/* Upstream Outputs — the data the reviewer is actually judging */}
        <section>
          <h3 className="text-xs font-bold text-[#002855] uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>Upstream Outputs</span>
            <span className="text-[#94A3B8] font-normal">({outputEntries.length})</span>
            <span className="ml-auto text-[10px] text-[#475569] bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
              The data to review
            </span>
          </h3>
          {outputEntries.length === 0 ? (
            <EmptySection label="No upstream outputs in this dispatch" />
          ) : (
            <div className="space-y-2">
              {outputEntries.map(([key, typedValue]) => (
                <VariableCard
                  key={key}
                  varKey={key}
                  typedValue={typedValue}
                  schemaDef={mergedOutputSchema[key]}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
