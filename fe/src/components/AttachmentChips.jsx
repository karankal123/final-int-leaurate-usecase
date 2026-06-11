/**
 * AttachmentChips - Display clickable document chips
 * 
 * Features:
 * - Renders list of documents as chips
 * - File icon indicator
 * - Hover effects
 * - Click to trigger preview
 * 
 * Props:
 *   attachmentUrls - Array of { name, attachment_url, type? } objects
 *   onPreview      - Callback when a chip is clicked, receives doc object
 */

export default function AttachmentChips({ attachmentUrls, onPreview }) {
  if (!attachmentUrls || attachmentUrls.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachmentUrls.map((doc, index) => (
        <button
          key={doc.name || index}
          onClick={() => onPreview?.(doc)}
          className="flex items-center gap-1 px-3 py-1 bg-[#E8F0F7] text-[#002855] text-xs font-medium rounded-md border border-[#c3d5e8] hover:bg-[#DBEAFE] hover:border-[#93c5fd] transition-colors cursor-pointer"
          title={`Preview ${doc.name}`}
        >
          {/* File Icon */}
          <svg 
            className="w-3 h-3 text-[#1D4ED8]" 
            viewBox="0 0 20 20" 
            fill="currentColor"
          >
            <path 
              fillRule="evenodd" 
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" 
              clipRule="evenodd" 
            />
          </svg>
          {doc.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Utility: Parse comma-separated attachment string into array
 * 
 * @param {string} attachments - Comma-separated attachment names
 * @returns {Array} - Array of { name, attachment_url } objects
 */
export function parseAttachmentString(attachments) {
  if (!attachments) return [];
  return attachments
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(name => ({ 
      name,
      attachment_url: `/documents/${encodeURIComponent(name)}`
    }));
}
