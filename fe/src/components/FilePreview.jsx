/**
 * FilePreview - Inline expandable preview for PDFs and images
 * 
 * Features:
 * - Detects file type from URL extension
 * - Expandable/collapsible preview
 * - Supports PDF, PNG, JPG, GIF, WebP, SVG
 * - Opens in new tab link
 */

import { useState } from 'react';

// File extension patterns
export const FILE_EXT_RE = /\.(pdf|png|jpe?g|gif|webp|svg|docx?|xlsx?|csv|txt|json)(\?.*)?$/i;
export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
export const PDF_EXT_RE = /\.pdf(\?.*)?$/i;

// URL detection helpers
export function looksLikeUrl(value) {
  if (typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value.trim());
}

export function looksLikeFileUrl(value) {
  if (!looksLikeUrl(value)) return false;
  return FILE_EXT_RE.test(value);
}

export default function FilePreview({ url }) {
  const [expanded, setExpanded] = useState(false);
  const isImage = IMAGE_EXT_RE.test(url);
  const isPdf = PDF_EXT_RE.test(url);

  return (
    <div className="mt-2 space-y-2">
      {/* URL Link + Preview Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1D4ED8] hover:underline break-all"
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
          <span className="break-all">{url}</span>
        </a>
        
        {(isImage || isPdf) && (
          <button
            type="button"
            onClick={() => setExpanded((s) => !s)}
            className="text-[10px] uppercase tracking-wide font-semibold text-[#1D4ED8] border border-[#1D4ED8] rounded px-2 py-0.5 hover:bg-[#E8F0F7] transition-colors"
          >
            {expanded ? 'Hide preview' : 'Preview'}
          </button>
        )}
      </div>

      {/* Image Preview */}
      {expanded && isImage && (
        <img 
          src={url} 
          alt="Preview" 
          className="max-w-full max-h-96 rounded border border-[#E2E8F0]" 
        />
      )}

      {/* PDF Preview */}
      {expanded && isPdf && (
        <iframe 
          src={url} 
          title="PDF preview" 
          className="w-full h-96 rounded border border-[#E2E8F0]" 
        />
      )}
    </div>
  );
}
