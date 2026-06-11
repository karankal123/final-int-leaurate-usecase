# File Preview Functionality - Integration Guide

## Overview

This document provides the complete code and instructions to integrate **File Preview** functionality into another codebase. The system supports previewing PDFs, images, and various document types with expandable inline previews and modal viewers.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend Components                            │
├─────────────────────────────────────────────────────────────────────────┤
│  FilePreview         │ Inline expandable preview for PDFs/images        │
│  PdfPreviewModal     │ Full-screen modal viewer for documents           │
│  AttachmentChips     │ Clickable document chips with preview trigger    │
│  PrimitiveValue      │ Smart value renderer with URL/file detection     │
│  ReviewContextPanel  │ Context panel with integrated file preview       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            Backend Support                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Static file serving  │ Serve documents from /documents/ endpoint       │
│  URL resolution       │ Convert relative paths to absolute URLs         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Dependencies (Frontend)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.x"
  }
}
```

---

## Core Components

### 1. FilePreview Component - Inline Expandable Preview

```jsx
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
const FILE_EXT_RE = /\.(pdf|png|jpe?g|gif|webp|svg|docx?|xlsx?|csv|txt|json)(\?.*)?$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
const PDF_EXT_RE = /\.pdf(\?.*)?$/i;

// URL detection helpers
function looksLikeUrl(value) {
  if (typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value.trim());
}

function looksLikeFileUrl(value) {
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

// Export helpers for use in other components
export { looksLikeUrl, looksLikeFileUrl, FILE_EXT_RE, IMAGE_EXT_RE, PDF_EXT_RE };
```

---

### 2. PdfPreviewModal Component - Full-Screen Modal Viewer

```jsx
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
```

---

### 3. AttachmentChips Component - Clickable Document Chips

```jsx
/**
 * AttachmentChips - Display clickable document chips
 * 
 * Features:
 * - Renders list of documents as chips
 * - File icon indicator
 * - Hover effects
 * - Click to trigger preview
 */

export default function AttachmentChips({ attachmentUrls, onPreview }) {
  if (!attachmentUrls || attachmentUrls.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachmentUrls.map((doc) => (
        <button
          key={doc.name}
          onClick={() => onPreview(doc)}
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
```

---

### 4. PrimitiveValue Component - Smart Value Renderer

```jsx
/**
 * PrimitiveValue - Smart renderer for primitive values
 * 
 * Features:
 * - Auto-detects file URLs and renders FilePreview
 * - Renders regular URLs as links
 * - Handles booleans, numbers, empty values
 * - Preserves whitespace for text
 */

import FilePreview, { looksLikeUrl, looksLikeFileUrl } from './FilePreview';

export default function PrimitiveValue({ value }) {
  // Empty value
  if (value === null || value === undefined || value === '') {
    return <span className="text-[#94A3B8] italic">(empty)</span>;
  }

  // File URL - render with preview
  if (looksLikeFileUrl(value)) {
    return <FilePreview url={value} />;
  }

  // Regular URL - render as link
  if (looksLikeUrl(value)) {
    return (
      <a 
        href={value} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="text-[#1D4ED8] hover:underline break-all"
      >
        {value}
      </a>
    );
  }

  // Boolean
  if (typeof value === 'boolean') {
    return (
      <span 
        className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${
          value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}
      >
        {value ? 'true' : 'false'}
      </span>
    );
  }

  // Number
  if (typeof value === 'number') {
    return <span className="font-mono text-sm text-[#0F172A]">{value}</span>;
  }

  // String/default
  return (
    <span className="text-sm text-[#0F172A] break-words whitespace-pre-wrap">
      {String(value)}
    </span>
  );
}
```

---

### 5. StructuredValue Component - Complex Value Renderer

```jsx
/**
 * StructuredValue - Renderer for arrays and objects
 * 
 * Features:
 * - Handles arrays with list rendering
 * - JSON pretty-print for objects
 * - Falls back to PrimitiveValue
 */

import PrimitiveValue from './PrimitiveValue';

export default function StructuredValue({ value }) {
  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[#94A3B8] italic">(empty array)</span>;
    }
    return (
      <ul className="list-disc ml-5 space-y-1">
        {value.map((item, i) => (
          <li key={i} className="text-sm text-[#0F172A]">
            {typeof item === 'object' && item !== null ? (
              <pre className="text-[11px] bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(item, null, 2)}
              </pre>
            ) : (
              <PrimitiveValue value={item} />
            )}
          </li>
        ))}
      </ul>
    );
  }

  // Object
  if (value && typeof value === 'object') {
    return (
      <pre className="text-[11px] bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  // Primitive
  return <PrimitiveValue value={value} />;
}
```

---

### 6. URL Resolution Helper

```jsx
/**
 * resolveAttachmentPreviewUrl - Convert relative paths to absolute URLs
 * 
 * @param {Object} item - Object with attachment_url property
 * @returns {string|null} - Full URL or null
 */

// API_BASE_URL should be defined in your api/client.js
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export function resolveAttachmentPreviewUrl(item) {
  const relativeOrAbsolute = item?.attachment_url;
  
  if (!relativeOrAbsolute) return null;
  
  // Already absolute URL
  if (/^https?:\/\//i.test(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  
  // Convert relative to absolute
  return `${API_BASE_URL}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`;
}
```

---

## Complete Integration Example

### CaseDetailPage with Preview Modal

```jsx
/**
 * CaseDetailPage - Full page example with document preview integration
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PdfPreviewModal from '../components/PdfPreviewModal';
import AttachmentChips from '../components/AttachmentChips';
import { resolveAttachmentPreviewUrl } from '../utils/urlHelpers';

export default function CaseDetailPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();

  // Preview modal state
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewTitle, setPreviewTitle] = useState('');
  
  // Case data state
  const [caseInfo, setCaseInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  // Handle document preview
  const handlePreview = (doc) => {
    const url = resolveAttachmentPreviewUrl(doc);
    if (url) {
      setPreviewUrl(url);
      setPreviewTitle(doc.name || 'Document');
    }
  };

  // Close preview modal
  const closePreview = () => {
    setPreviewUrl(null);
    setPreviewTitle('');
  };

  // Load case data
  useEffect(() => {
    async function loadCase() {
      setLoading(true);
      try {
        const response = await fetch(`/api/cases/${studentId}`);
        const data = await response.json();
        setCaseInfo(data);
      } catch (err) {
        console.error('Failed to load case', err);
      } finally {
        setLoading(false);
      }
    }
    loadCase();
  }, [studentId]);

  if (loading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      {/* Header */}
      <header className="bg-[#002855] text-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-[#9CA3AF] hover:text-white text-sm"
          >
            ← Back
          </button>
          <span className="font-semibold">{caseInfo?.applicant_name}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Case Info Card */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm p-6">
          <h2 className="text-lg font-bold text-[#002855] mb-4">Case Details</h2>
          
          {/* Applicant Info */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-xs text-[#6B7280] mb-1">Student ID</p>
              <p className="font-mono text-sm">{caseInfo?.student_id}</p>
            </div>
            <div>
              <p className="text-xs text-[#6B7280] mb-1">Name</p>
              <p className="text-sm font-medium">{caseInfo?.applicant_name}</p>
            </div>
          </div>

          {/* Document Attachments */}
          {caseInfo?.attachments && (
            <div>
              <p className="text-xs text-[#6B7280] mb-2">Documents</p>
              <AttachmentChips 
                attachmentUrls={caseInfo.attachments} 
                onPreview={handlePreview} 
              />
            </div>
          )}
        </div>
      </main>

      {/* Preview Modal */}
      <PdfPreviewModal
        open={!!previewUrl}
        previewUrl={previewUrl}
        title={previewTitle}
        onClose={closePreview}
      />
    </div>
  );
}
```

---

### ReviewContextPanel with Integrated Preview

```jsx
/**
 * ReviewContextPanel - Full context panel with file preview integration
 */

import { useState } from 'react';
import FilePreview, { looksLikeFileUrl, looksLikeUrl } from './FilePreview';

// Variable Card Component
function VariableCard({ varKey, typedValue, schemaDef }) {
  const value = typedValue && typeof typedValue === 'object' && 'value' in typedValue 
    ? typedValue.value 
    : typedValue;
  
  const displayName = schemaDef?.display_name || schemaDef?.variable_name || varKey;
  const description = schemaDef?.description || '';

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-[#0F172A]">{displayName}</span>
        <span className="ml-auto text-[10px] font-mono text-[#94A3B8]">{varKey}</span>
      </div>
      
      {description && (
        <p className="text-[11px] text-[#64748B]">{description}</p>
      )}
      
      <div className="text-sm">
        <SmartValue value={value} />
      </div>
    </div>
  );
}

// Smart Value Renderer
function SmartValue({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[#94A3B8] italic">(empty)</span>;
  }

  if (looksLikeFileUrl(value)) {
    return <FilePreview url={value} />;
  }

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

  if (Array.isArray(value)) {
    return (
      <ul className="list-disc ml-5 space-y-1">
        {value.map((item, i) => (
          <li key={i}><SmartValue value={item} /></li>
        ))}
      </ul>
    );
  }

  if (typeof value === 'object') {
    return (
      <pre className="text-[11px] bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return <span className="text-sm text-[#0F172A] break-words whitespace-pre-wrap">{String(value)}</span>;
}

// Main ReviewContextPanel
export default function ReviewContextPanel({ inputs, outputs, inputSchema, outputSchema }) {
  const [activeTab, setActiveTab] = useState('inputs');

  const renderSection = (data, schema) => {
    if (!data || Object.keys(data).length === 0) {
      return (
        <div className="bg-[#F8FAFC] border border-dashed border-[#CBD5E1] rounded-lg p-4 text-center">
          <p className="text-xs text-[#64748B] italic">No data available</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {Object.entries(data).map(([key, value]) => (
          <VariableCard
            key={key}
            varKey={key}
            typedValue={value}
            schemaDef={schema?.[key]}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[#E2E8F0]">
        <button
          onClick={() => setActiveTab('inputs')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'inputs'
              ? 'bg-[#002855] text-white'
              : 'bg-[#F8FAFC] text-[#475569] hover:bg-[#E8F0F7]'
          }`}
        >
          Inputs
        </button>
        <button
          onClick={() => setActiveTab('outputs')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'outputs'
              ? 'bg-[#002855] text-white'
              : 'bg-[#F8FAFC] text-[#475569] hover:bg-[#E8F0F7]'
          }`}
        >
          Outputs
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'inputs' && renderSection(inputs, inputSchema)}
        {activeTab === 'outputs' && renderSection(outputs, outputSchema)}
      </div>
    </div>
  );
}
```

---

## Backend Support

### Static File Serving (Express.js)

```javascript
/**
 * Express.js static file serving for document preview
 */

import express from 'express';
import path from 'path';

const app = express();

// Serve documents from /documents directory
app.use('/documents', express.static(path.join(__dirname, 'data/documents'), {
  // Set appropriate headers for PDF viewing
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
    }
  }
}));

// CORS for frontend access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
```

### API Endpoint for Document URLs

```javascript
/**
 * API endpoint that returns document URLs for preview
 */

app.get('/api/cases/:studentId', async (req, res) => {
  const { studentId } = req.params;
  
  // Fetch case data
  const caseData = await getCaseData(studentId);
  
  // Include attachment URLs
  const response = {
    student_id: caseData.student_id,
    applicant_name: caseData.applicant_name,
    attachments: caseData.documents.map(doc => ({
      name: doc.filename,
      attachment_url: `/documents/${doc.path}`,
      type: doc.mime_type
    }))
  };
  
  res.json(response);
});
```

---

## Styling (Tailwind CSS)

The components use Tailwind CSS. Ensure you have it configured:

```javascript
// tailwind.config.js
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand colors used in components
        primary: {
          DEFAULT: '#002855',
          light: '#E8F0F7',
        },
        accent: '#1D4ED8',
      }
    },
  },
  plugins: [],
}
```

---

## Usage Summary

### Basic FilePreview Usage

```jsx
import FilePreview from './components/FilePreview';

// In your component
<FilePreview url="https://example.com/document.pdf" />
```

### Modal Preview Usage

```jsx
import { useState } from 'react';
import PdfPreviewModal from './components/PdfPreviewModal';

function MyComponent() {
  const [previewUrl, setPreviewUrl] = useState(null);

  return (
    <>
      <button onClick={() => setPreviewUrl('/documents/file.pdf')}>
        Preview Document
      </button>

      <PdfPreviewModal
        open={!!previewUrl}
        previewUrl={previewUrl}
        title="My Document"
        onClose={() => setPreviewUrl(null)}
      />
    </>
  );
}
```

### With Attachment Chips

```jsx
import AttachmentChips from './components/AttachmentChips';
import PdfPreviewModal from './components/PdfPreviewModal';

function MyComponent({ documents }) {
  const [preview, setPreview] = useState({ url: null, title: '' });

  return (
    <>
      <AttachmentChips
        attachmentUrls={documents}
        onPreview={(doc) => setPreview({ 
          url: doc.attachment_url, 
          title: doc.name 
        })}
      />

      <PdfPreviewModal
        open={!!preview.url}
        previewUrl={preview.url}
        title={preview.title}
        onClose={() => setPreview({ url: null, title: '' })}
      />
    </>
  );
}
```

---

## Browser Compatibility

- **PDF Preview**: Works in Chrome, Firefox, Edge, Safari (built-in PDF viewer)
- **Image Preview**: All modern browsers
- **iframe embed**: May be blocked by X-Frame-Options headers on external URLs

For external URLs that don't allow embedding, consider using:
1. Google Docs Viewer: `https://docs.google.com/viewer?url=ENCODED_URL&embedded=true`
2. Download link fallback
3. Server-side proxy
