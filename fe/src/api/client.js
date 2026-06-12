import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const api = axios.create({ baseURL });

export const getInbox = () => api.get('/inbox').then(r => r.data);

export const openInboxUpdatesStream = (handlers = {}) => {
  const streamBase = baseURL.replace(/\/$/, '');
  const source = new EventSource(`${streamBase}/inbox/stream`);

  if (handlers.onSnapshot) {
    source.addEventListener('snapshot', (event) => {
      handlers.onSnapshot(JSON.parse(event.data));
    });
  }

  if (handlers.onJobUpdate) {
    source.addEventListener('job-update', (event) => {
      handlers.onJobUpdate(JSON.parse(event.data));
    });
  }

  if (handlers.onError) {
    source.onerror = handlers.onError;
  }

  return source;
};

export const triggerScreening = (studentId) =>
  api.post(`/trigger-screening/${studentId}`).then(r => r.data);

export const submitHumanDecision = (threadId, decision, reviewerOutput = null) =>
  api
    .post(`/human-decision/${threadId}`, {
      human_decision: decision,
      reviewer_output: reviewerOutput || undefined,
    })
    .then(r => r.data);

export const getCaseStatus = (studentId) =>
  api.get(`/case-status/${studentId}`).then(r => r.data);

export const getCaseScreening = (studentId) =>
  api.get(`/case-screening/${studentId}`).then(r => r.data);

export const openCaseUpdatesStream = (studentId, handlers = {}) => {
  const streamBase = baseURL.replace(/\/$/, '');
  const source = new EventSource(`${streamBase}/case-updates/${encodeURIComponent(studentId)}/stream`);

  if (handlers.onSnapshot) {
    source.addEventListener('snapshot', (event) => {
      handlers.onSnapshot(JSON.parse(event.data));
    });
  }

  if (handlers.onJobUpdate) {
    source.addEventListener('job-update', (event) => {
      handlers.onJobUpdate(JSON.parse(event.data));
    });
  }

  if (handlers.onError) {
    source.onerror = handlers.onError;
  }

  return source;
};

export const getJobAudit = (jobId) =>
  api.get(`/jobs/${jobId}/audit`).then(r => r.data?.result ?? r.data);

export const resetExcel = () => api.post('/reset').then(r => r.data);

/* ── HITL (off-platform review) ────────────────────────────────────────────── */

export const getHitlReviewDetail = (threadId) =>
  api.get(`/opus/off-platform-review/${threadId}`).then(r => r.data);

export const submitHitlReviewDecision = (threadId, decision, reviewerOutput) =>
  api
    .post(`/human-decision/${threadId}`, {
      human_decision: decision,
      reviewer_output: reviewerOutput || undefined,
    })
    .then(r => r.data);

export const getHitlPending = () =>
  api.get('/opus/off-platform-review/pending').then(r => r.data);

/* ── Document Rename ───────────────────────────────────────────────────────── */

/**
 * Rename student documents via the FastAPI rename service
 * 
 * @param {string} studentName - Student's full name
 * @param {string} studentId - Student's ID
 * @returns {Promise<Object>} - Rename response
 */
export const renameStudentDocuments = (studentName, studentId) =>
  api
    .post('/rename/student', {
      student_name: studentName,
      student_id: studentId,
    })
    .then(r => r.data);

/* ── URL Resolution Helper ─────────────────────────────────────────────────── */

/**
 * Convert relative attachment paths to absolute URLs
 * 
 * @param {Object} item - Object with attachment_url property
 * @returns {string|null} - Full URL or null
 */
export function resolveAttachmentPreviewUrl(item) {
  const relativeOrAbsolute = item?.attachment_url || item?.url;
  
  if (!relativeOrAbsolute) return null;
  
  // Already absolute URL
  if (/^https?:\/\//i.test(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  
  // Convert relative to absolute
  return `${baseURL}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`;
}
