/**
 * PdfPreviewModal - Full-screen modal for document viewing
 * 
 * Features:
 * - Backdrop blur overlay
 * - Header with title and close button
 * - Responsive iframe viewer
 * - Click outside to close
 */

export default function PdfPreviewModal({ open, previewUrl, title, onClose }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-xl border border-[#E2E8F0] shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#002855] text-white flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Application Document Preview</p>
            <p className="text-xs text-[#93c5fd] mt-0.5">{title || 'Document'}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 transition-colors"
          >
            Close
          </button>
        </div>

        {/* PDF Viewer */}
        <iframe
          src={previewUrl}
          title="Document Preview"
          className="w-full h-[72vh] bg-[#F8FAFC]"
        />
      </div>
    </div>
  );
}
