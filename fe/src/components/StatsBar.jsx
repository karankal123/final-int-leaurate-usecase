export default function StatsBar({ cases }) {
  const total  = cases.length;
  const closed = cases.filter(c => ['closed', 'complete', 'completed'].includes(c.case_status?.toLowerCase())).length;
  const open   = cases.filter(c => ['open', 'pending'].includes(c.case_status?.toLowerCase()) || (!c.case_status)).length;

  const stats = [
    { label: 'Total Applications', value: total,  color: 'bg-[#E8F0F7] border-[#c3d5e8] text-[#002855]' },
    { label: 'Open Cases',         value: open,   color: 'bg-blue-50 border-blue-200 text-[#1D4ED8]' },
    { label: 'Closed Cases',       value: closed, color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      {stats.map(s => (
        <div
          key={s.label}
          className={`rounded-xl border p-5 flex flex-col gap-1.5 ${s.color}`}
        >
          <span className="text-3xl font-bold tracking-tight">{s.value}</span>
          <span className="text-xs font-semibold uppercase tracking-wide opacity-75">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
