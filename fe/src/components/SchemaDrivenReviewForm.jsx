import { useEffect, useMemo, useState } from 'react';

/* ── Type helpers ─────────────────────────────────────────────────────────────
 *
 * OPUS variables declare an `allowed_types` array. Each entry is
 *   { type: <wire>, type_definition: ... }
 * where <wire> may be a Python-style alias ("str", "int", "bool") or the
 * canonical wire name ("string", "integer", "boolean"). We treat the two as
 * interchangeable for rendering.
 *
 * When a variable allows multiple types (e.g. [str, object]), we prefer the
 * most structured one — a reviewer can always type "abc" into a JSON textarea
 * but can't type a JSON object into a plain text input.
 */

const TYPE_PREFERENCE = [
  'object', 'array', 'node', 'json_string',
  'binary', 'file', 'date',
  'int', 'integer',
  'float',
  'bool', 'boolean',
  'str', 'string',
];

function primaryType(allowedTypes) {
  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) return 'string';
  const present = allowedTypes.map((t) => t?.type).filter(Boolean);
  for (const pref of TYPE_PREFERENCE) {
    if (present.includes(pref)) return pref;
  }
  return present[0] || 'string';
}

const STRUCTURED_TYPES = new Set(['object', 'array', 'node', 'json_string']);
const STRING_TYPES = new Set(['str', 'string', 'text']);
const INT_TYPES = new Set(['int', 'integer']);
const BOOL_TYPES = new Set(['bool', 'boolean']);

/* Default value per type — used to seed form state for required fields. */
function defaultValueFor(t) {
  if (BOOL_TYPES.has(t)) return false;
  if (INT_TYPES.has(t)) return '';
  if (t === 'float') return '';
  if (t === 'date') return '';
  if (t === 'file') return '';
  if (t === 'array') return '[]';
  if (t === 'object' || t === 'node') return '{}';
  if (t === 'json_string') return '';
  return '';
}

/* Coerce a raw form value into the JSON shape the backend expects to forward. */
function coerce(raw, t) {
  if (raw === null || raw === undefined) return null;
  if (STRING_TYPES.has(t)) return String(raw);
  if (INT_TYPES.has(t)) {
    if (raw === '' || raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && Number.isInteger(n) ? n : raw;
  }
  if (t === 'float') {
    if (raw === '' || raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (BOOL_TYPES.has(t)) return Boolean(raw);
  if (t === 'date') return String(raw);
  if (t === 'file') return String(raw);
  if (STRUCTURED_TYPES.has(t)) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return t === 'array' ? [] : {};
      try {
        return JSON.parse(trimmed);
      } catch {
        // Caller validates and surfaces the error; pass through so we can report.
        return raw;
      }
    }
    return raw;
  }
  return raw;
}

/* Per-field renderers. Each returns the input element. */
function FieldInput({ varKey, varDef, value, onChange, error }) {
  const allowed = Array.isArray(varDef?.allowed_types) ? varDef.allowed_types : [];
  const t = primaryType(allowed);
  const inputId = `field-${varKey}`;
  const required = varDef?.is_nullable !== true;

  const baseInputClass =
    'w-full rounded-md border px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/30 focus:border-[#1D4ED8] ' +
    (error ? 'border-[#DC2626] bg-red-50' : 'border-[#CBD5E1] bg-white');

  if (BOOL_TYPES.has(t)) {
    return (
      <label htmlFor={inputId} className="inline-flex items-center gap-2 cursor-pointer">
        <input
          id={inputId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 rounded border-[#CBD5E1] text-[#1D4ED8] focus:ring-[#1D4ED8]"
        />
        <span className="text-sm text-[#475569]">{value ? 'true' : 'false'}</span>
      </label>
    );
  }

  if (INT_TYPES.has(t)) {
    return (
      <input
        id={inputId}
        type="number"
        step="1"
        required={required}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass}
      />
    );
  }

  if (t === 'float') {
    return (
      <input
        id={inputId}
        type="number"
        step="any"
        required={required}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass}
      />
    );
  }

  if (t === 'date') {
    return (
      <input
        id={inputId}
        type="date"
        required={required}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass}
      />
    );
  }

  if (t === 'file') {
    return (
      <input
        id={inputId}
        type="url"
        required={required}
        placeholder="https://files.opus.com/..."
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass + ' font-mono text-xs'}
      />
    );
  }

  if (STRUCTURED_TYPES.has(t)) {
    return (
      <textarea
        id={inputId}
        required={required}
        rows={5}
        placeholder={t === 'array' ? '[]' : '{}'}
        value={typeof value === 'string' ? value : JSON.stringify(value ?? (t === 'array' ? [] : {}), null, 2)}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass + ' font-mono text-xs resize-vertical'}
      />
    );
  }

  // Default: string-like
  return (
    <input
      id={inputId}
      type="text"
      required={required}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={baseInputClass}
    />
  );
}

/* Type badge — small label next to each field. */
function TypeBadge({ t }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[#1D4ED8] text-white">
      {t}
    </span>
  );
}

/* ── Main form ────────────────────────────────────────────────────────────────
 *
 * Props:
 *   schema        — expected_output_schema.schema (dict keyed by variable_name)
 *   onChange      — callback({ values, errors, isValid }) on every edit
 *   externalError — server-side parse errors keyed by variable_name (optional)
 */
export default function SchemaDrivenReviewForm({ schema, onChange, externalError = null }) {
  const fields = useMemo(() => {
    if (!schema || typeof schema !== 'object') return [];
    return Object.entries(schema).map(([key, def]) => ({
      key,
      varName: String(def?.variable_name || key),
      displayName: String(def?.display_name || def?.variable_name || key),
      description: String(def?.description || '').trim(),
      isNullable: def?.is_nullable === true,
      type: primaryType(def?.allowed_types),
      allowed: Array.isArray(def?.allowed_types) ? def.allowed_types : [],
      def,
    }));
  }, [schema]);

  const [values, setValues] = useState(() => {
    const initial = {};
    for (const f of fields) initial[f.varName] = defaultValueFor(f.type);
    return initial;
  });

  // Reset state when schema changes (e.g. switching between cases).
  useEffect(() => {
    const fresh = {};
    for (const f of fields) fresh[f.varName] = defaultValueFor(f.type);
    setValues(fresh);
  }, [fields]);

  // Compute coerced values + per-field validation errors, push to parent.
  useEffect(() => {
    const coerced = {};
    const errors = {};
    for (const f of fields) {
      const raw = values[f.varName];
      const coercedVal = coerce(raw, f.type);

      if (STRUCTURED_TYPES.has(f.type) && typeof raw === 'string' && raw.trim() && coercedVal === raw) {
        // coerce() returned the raw string unchanged → JSON.parse failed
        errors[f.varName] = 'Invalid JSON';
      } else if (!f.isNullable && (coercedVal === null || coercedVal === '' || coercedVal === undefined)) {
        errors[f.varName] = 'Required';
      } else if (INT_TYPES.has(f.type) && typeof coercedVal === 'string') {
        errors[f.varName] = 'Must be an integer';
      } else if (f.type === 'float' && typeof coercedVal === 'string') {
        errors[f.varName] = 'Must be a number';
      }

      coerced[f.varName] = coercedVal;
    }
    const isValid = Object.keys(errors).length === 0;
    onChange?.({ values: coerced, errors, isValid });
  }, [values, fields, onChange]);

  if (fields.length === 0) {
    return (
      <p className="text-xs text-[#6B7280] italic">
        No expected output schema declared — the off-platform node has no outputs to capture.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const fieldError = externalError?.[f.varName];
        return (
          <div key={f.key} className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <label
                htmlFor={`field-${f.key}`}
                className="text-xs font-semibold text-[#475569] uppercase tracking-wider"
              >
                {f.displayName}
              </label>
              <TypeBadge t={f.type} />
              {!f.isNullable && (
                <span className="text-[10px] font-semibold text-[#DC2626]">REQUIRED</span>
              )}
              {f.isNullable && (
                <span className="text-[10px] text-[#94A3B8]">optional</span>
              )}
              <span className="ml-auto text-[10px] font-mono text-[#94A3B8]">{f.varName}</span>
            </div>

            {f.description && (
              <p className="text-[11px] text-[#64748B]">{f.description}</p>
            )}

            <FieldInput
              varKey={f.key}
              varDef={f.def}
              value={values[f.varName]}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.varName]: v }))}
              error={fieldError}
            />

            {fieldError && (
              <p className="text-[11px] text-[#DC2626]">{fieldError}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
