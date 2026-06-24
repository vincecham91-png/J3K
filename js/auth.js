// ============================================================
// js/auth.js — 登录/Token/Session 管理模块
// ============================================================

// ⚠️ 部署后请将此 URL 改为你的 Cloudflare Worker URL
const WORKER_URL = 'https://hualian-reports-worker.vincecham91.workers.dev';

// ── Token Storage (sessionStorage — clears on browser close) ─────────────────

function getToken()        { return sessionStorage.getItem('report_token'); }
function setToken(t)       { sessionStorage.setItem('report_token', t); }
function clearToken()      { sessionStorage.removeItem('report_token'); }

function getUser()         { try { return JSON.parse(sessionStorage.getItem('report_user') || 'null'); } catch { return null; } }
function setUser(u)        { sessionStorage.setItem('report_user', JSON.stringify(u)); }
function clearUser()       { sessionStorage.removeItem('report_user'); }

// ── HTTP Helper ───────────────────────────────────────────────────────────────

async function fetchWithAuth(path, options = {}) {
  const token   = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res  = await fetch(WORKER_URL + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearToken();
    clearUser();
    window.location.href = 'teacher-login.html';
    return;
  }
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

// ── Auth Actions ──────────────────────────────────────────────────────────────

async function login(username, password) {
  const res = await fetch(WORKER_URL + '/api/auth/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(data.error || '登录失败 / Login failed');
  setToken(data.token);
  setUser(data.teacher);
  return data;
}

async function logout() {
  try { await fetchWithAuth('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  clearToken();
  clearUser();
  window.location.href = 'teacher-login.html';
}

function requireAuth(requiredRole = null) {
  const token = getToken();
  const user  = getUser();
  if (!token || !user) {
    window.location.href = 'teacher-login.html';
    return null;
  }
  if (requiredRole && user.role !== requiredRole) {
    alert('权限不足 / Insufficient permissions');
    window.location.href = 'teacher-login.html';
    return null;
  }
  return user;
}
