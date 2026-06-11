export default function LoadingSpinner({ message = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div
        className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-[#002855]"
        style={{ animation: 'spin 0.8s linear infinite' }}
      />
      {message && (
        <p className="text-sm text-gray-500 font-medium">{message}</p>
      )}
    </div>
  );
}
