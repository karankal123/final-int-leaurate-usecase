/**
 * StatusBadge — reusable colored pill badge
 * Pass `type` to pick a color scheme, or pass `status` to auto-resolve.
 */

const SCREENING_COLORS = {
  'not started': 'bg-gray-100 text-[#6B7280]',
  'in progress': 'bg-blue-50 text-[#1D4ED8]',
  'flagged':     'bg-amber-50 text-amber-700',
  'verified':    'bg-green-50 text-[#16a34a]',
  'completed':   'bg-green-50 text-[#16a34a]',
};

const APPLICATION_COLORS = {
  'pending':   'bg-amber-50 text-amber-700',
  'open':      'bg-blue-50 text-[#1D4ED8]',
  'approved':  'bg-green-50 text-[#16a34a]',
  'rejected':  'bg-red-50 text-[#DC2626]',
  'closed':    'bg-gray-100 text-[#6B7280]',
};

const REQUEST_COLORS = {
  'new':     'bg-blue-50 text-[#1D4ED8]',
  'updated': 'bg-[#E8F0F7] text-[#002855]',
};

const DECISION_COLORS = {
  'selected':                 'bg-green-50 text-[#16a34a]',
  'deny':                     'bg-red-50 text-[#DC2626]',
  'pending review':           'bg-amber-50 text-amber-700',
  'incomplete application':   'bg-amber-50 text-amber-700',
};

const FLAGGED_COLORS = {
  'flagged':  'bg-amber-50 text-amber-700',
  'verified': 'bg-green-50 text-[#16a34a]',
};

export default function StatusBadge({ value, kind = 'screening' }) {
  if (!value) return null;
  const key = value.toLowerCase();
  let colorClass = 'bg-gray-100 text-gray-500';

  if (kind === 'screening')    colorClass = SCREENING_COLORS[key]    || colorClass;
  if (kind === 'application')  colorClass = APPLICATION_COLORS[key]  || colorClass;
  if (kind === 'request')      colorClass = REQUEST_COLORS[key]       || colorClass;
  if (kind === 'decision')     colorClass = DECISION_COLORS[key]      || colorClass;
  if (kind === 'flagged')      colorClass = FLAGGED_COLORS[key]       || colorClass;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
      title={value}
    >
      {value}
    </span>
  );
}
