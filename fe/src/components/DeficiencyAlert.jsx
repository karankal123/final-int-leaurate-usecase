export default function DeficiencyAlert({ deficiencies, reason }) {
  if (!deficiencies || deficiencies.length === 0) return null;

  return (
    <div className="mt-4 bg-white rounded-xl border border-red-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 bg-[#002855] flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white tracking-wide">Reason</h3>
      </div>
      {/* Body */}
      <div className="p-5 bg-red-50">
        <ul className="space-y-2">
          {deficiencies.map((d, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-[#DC2626]" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="text-sm text-[#374151]">{d.replace(/\s*[✓✗]\s*$/, '').trim()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
