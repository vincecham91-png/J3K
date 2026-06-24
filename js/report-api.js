// ============================================================
// js/report-api.js — API 调用封装
// (不依赖 auth.js，parent.html 也可以独立使用)
// ============================================================

const API_BASE = 'https://hualian-reports-worker.vincecham91.workers.dev'; // ⚠️ 与 auth.js 保持一致

// ── Parent (no auth required) ─────────────────────────────────────────────────

async function getParentReport(code) {
  const res = await fetch(`${API_BASE}/api/parent/report/${code}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

async function getClassConfig() {
  const res = await fetch(`${API_BASE}/api/config/class`);
  return res.json().catch(() => ({}));
}

// ── Teacher (requires auth via fetchWithAuth from auth.js) ────────────────────

async function getMyReports()  { return fetchWithAuth('/api/reports/my-subjects'); }

async function saveReport(studentId, subjectCode, feedback, isComplete) {
  return fetchWithAuth(`/api/reports/${studentId}/${subjectCode}`, {
    method: 'PUT',
    body:   JSON.stringify({ feedback, is_complete: isComplete ? 1 : 0 }),
  });
}

async function markSubjectComplete(subjectCode) {
  return fetchWithAuth(`/api/reports/mark-complete/${subjectCode}`, { method: 'POST' });
}

// ── Form Teacher ──────────────────────────────────────────────────────────────

async function getSummary()       { return fetchWithAuth('/api/form-teacher/summary'); }
async function generateLinks()    { return fetchWithAuth('/api/form-teacher/generate-links', { method: 'POST' }); }

async function resetPassword(username, new_password) {
  return fetchWithAuth('/api/form-teacher/reset-password', {
    method: 'POST',
    body:   JSON.stringify({ username, new_password }),
  });
}

async function changePassword(old_password, new_password) {
  return fetchWithAuth('/api/auth/change-password', {
    method: 'POST',
    body:   JSON.stringify({ old_password, new_password }),
  });
}
