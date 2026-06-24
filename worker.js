// ============================================================
// 华联中学评语系统 — Cloudflare Worker 后端
// worker.js
// 
// API 端点:
//   POST   /api/auth/login
//   POST   /api/auth/logout
//   GET    /api/auth/me
//   POST   /api/auth/change-password
//   GET    /api/reports/my-subjects
//   PUT    /api/reports/:studentId/:subjectCode
//   POST   /api/reports/mark-complete/:subjectCode
//   GET    /api/form-teacher/summary
//   POST   /api/form-teacher/generate-links
//   POST   /api/form-teacher/reset-password
//   GET    /api/parent/report/:code
//   GET    /api/config/class
// ============================================================

const ITERATIONS    = 100000;
const KEY_LENGTH    = 256;
const SESSION_DAYS  = 7;
const PHOTO_BASE    = 'https://raw.githubusercontent.com/vincecham91-png/J3K/main/J3K%20photo/';

// In-memory rate limiter (resets on cold start — fine for school scale)
const rateLimitStore = new Map();

// ── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url      = new URL(request.url);
    const pathname = url.pathname;
    const cors     = corsHeaders(request, env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // ── Public routes (no auth required) ──────────────────────
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env, cors);
      }
      if (pathname.startsWith('/api/parent/report/')) {
        return handleParentReport(request, env, pathname, cors);
      }
      if (pathname === '/api/config/class' && request.method === 'GET') {
        return handleClassConfig(env, cors);
      }

      // ── Protected routes (require Bearer token) ────────────────
      const user = await authenticate(request, env);
      if (!user) {
        return json({ error: '未登录 / Not authenticated. Please login.' }, 401, cors);
      }

      if (pathname === '/api/auth/me'              && request.method === 'GET')  return handleMe(user, cors);
      if (pathname === '/api/auth/logout'          && request.method === 'POST') return handleLogout(request, env, user, cors);
      if (pathname === '/api/auth/change-password' && request.method === 'POST') return handleChangePassword(request, env, user, cors);
      if (pathname === '/api/reports/my-subjects'  && request.method === 'GET')  return handleMyReports(user, env, cors);

      // PUT /api/reports/:studentId/:subjectCode
      const saveMatch = pathname.match(/^\/api\/reports\/(\d+)\/([a-z_]+)$/);
      if (saveMatch && request.method === 'PUT') {
        return handleSaveReport(request, env, user, saveMatch[1], saveMatch[2], cors);
      }

      // POST /api/reports/mark-complete/:subjectCode
      const markMatch = pathname.match(/^\/api\/reports\/mark-complete\/([a-z_]+)$/);
      if (markMatch && request.method === 'POST') {
        return handleMarkComplete(env, user, markMatch[1], cors);
      }

      // ── Form teacher only routes ───────────────────────────────
      if (pathname === '/api/form-teacher/summary'         && request.method === 'GET')  return requireFormTeacher(user, cors, () => handleSummary(env, cors));
      if (pathname === '/api/form-teacher/generate-links'  && request.method === 'POST') return requireFormTeacher(user, cors, () => handleGenerateLinks(env, cors));
      if (pathname === '/api/form-teacher/reset-password'  && request.method === 'POST') return requireFormTeacher(user, cors, () => handleResetPassword(request, env, user, cors));

      return json({ error: 'Not found' }, 404, cors);

    } catch (e) {
      console.error('[Worker Error]', e?.stack || e?.message || e);
      return json({ error: String(e?.message || 'Internal server error') }, 500, cors);
    }
  }
};

// ── CORS ──────────────────────────────────────────────────────────────────────

function corsHeaders(request, env) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = [
    env.CORS_ORIGIN || 'https://vincecham91-png.github.io',
    'http://localhost:8000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'null', // file:// protocol for local testing
  ];
  const allowOrigin = allowed.includes(origin) ? origin : (env.CORS_ORIGIN || allowed[0]);
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────

function checkRateLimit(ip, maxPerMinute = 10) {
  const now   = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

// ── Auth Helpers ──────────────────────────────────────────────────────────────

async function authenticate(request, env) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const session = await env.DB.prepare(
    `SELECT s.token, s.teacher_id,
            t.username, t.display_name, t.role
     FROM sessions s
     JOIN teachers t ON s.teacher_id = t.id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();

  if (!session) return null;

  // Sliding expiry: extend on each authenticated request
  await env.DB.prepare(
    `UPDATE sessions SET expires_at = datetime('now', '+${SESSION_DAYS} days') WHERE token = ?`
  ).bind(token).run();

  return session;
}

async function verifyPassword(password, stored) {
  try {
    const [saltB64, hashB64] = stored.split(':');
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const key  = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, KEY_LENGTH
    ));
    return btoa(String.fromCharCode(...derived)) === hashB64;
  } catch {
    return false;
  }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, KEY_LENGTH
  ));
  return btoa(String.fromCharCode(...salt)) + ':' + btoa(String.fromCharCode(...derived));
}

function requireFormTeacher(user, cors, handler) {
  if (user.role !== 'form_teacher') {
    return json({ error: '仅班主任可访问 / Form teacher only' }, 403, cors);
  }
  return handler();
}

// ── Route Handlers ────────────────────────────────────────────────────────────

async function handleLogin(request, env, cors) {
  const body = await request.json().catch(() => ({}));
  const { username, password } = body;

  if (!username || !password) {
    return json({ error: '请填写用户名和密码 / Username and password required' }, 400, cors);
  }

  const teacher = await env.DB.prepare(
    'SELECT id, username, display_name, role, password FROM teachers WHERE username = ?'
  ).bind(username.toLowerCase().trim()).first();

  if (!teacher || !(await verifyPassword(password, teacher.password))) {
    return json({ error: '用户名或密码错误 / Invalid username or password' }, 401, cors);
  }

  const token = generateToken();
  await env.DB.prepare(
    `INSERT INTO sessions (token, teacher_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(token, teacher.id).run();

  await audit(env, teacher.username, 'LOGIN', null,
    `IP: ${request.headers.get('CF-Connecting-IP') || 'unknown'}`);

  return json({
    token,
    teacher: {
      id:           teacher.id,
      username:     teacher.username,
      display_name: teacher.display_name,
      role:         teacher.role,
    }
  }, 200, cors);
}

async function handleLogout(request, env, user, cors) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  await audit(env, user.username, 'LOGOUT');
  return json({ success: true }, 200, cors);
}

function handleMe(user, cors) {
  return json({
    id:           user.teacher_id,
    username:     user.username,
    display_name: user.display_name,
    role:         user.role,
  }, 200, cors);
}

async function handleChangePassword(request, env, user, cors) {
  const body = await request.json().catch(() => ({}));
  const { old_password, new_password } = body;

  if (!old_password || !new_password) {
    return json({ error: '请提供旧密码和新密码 / Old and new password required' }, 400, cors);
  }
  if (new_password.length < 4) {
    return json({ error: '新密码至少4位 / Minimum 4 characters' }, 400, cors);
  }

  const teacher = await env.DB.prepare('SELECT password FROM teachers WHERE id = ?')
    .bind(user.teacher_id).first();

  if (!teacher || !(await verifyPassword(old_password, teacher.password))) {
    return json({ error: '旧密码错误 / Old password incorrect' }, 401, cors);
  }

  await env.DB.prepare('UPDATE teachers SET password = ? WHERE id = ?')
    .bind(await hashPassword(new_password), user.teacher_id).run();

  await audit(env, user.username, 'CHANGE_PASSWORD', user.username);
  return json({ success: true }, 200, cors);
}

async function handleMyReports(user, env, cors) {
  let subjects;

  if (user.role === 'form_teacher') {
    // Form teacher sees all subjects
    const res = await env.DB.prepare(
      'SELECT code, display_name FROM subjects ORDER BY sort_order'
    ).all();
    subjects = res.results;
  } else {
    const res = await env.DB.prepare(
      `SELECT s.code, s.display_name
       FROM subjects s
       JOIN teacher_subjects ts ON s.code = ts.subject_code
       WHERE ts.teacher_id = ?
       ORDER BY s.sort_order`
    ).bind(user.teacher_id).all();
    subjects = res.results;
  }

  // For each subject, fetch students + existing reports
  for (const subj of subjects) {
    const res = await env.DB.prepare(
      `SELECT st.id, st.name, st.photo_url,
              COALESCE(r.feedback, '')   AS feedback,
              COALESCE(r.is_complete, 0) AS is_complete
       FROM students st
       LEFT JOIN reports r ON r.student_id = st.id AND r.subject_code = ?
       ORDER BY st.id`
    ).bind(subj.code).all();
    subj.students = res.results;
  }

  return json({
    subjects,
    teacher: { display_name: user.display_name, role: user.role }
  }, 200, cors);
}

async function handleSaveReport(request, env, user, studentId, subjectCode, cors) {
  // Verify subject access for regular teachers
  if (user.role !== 'form_teacher') {
    const access = await env.DB.prepare(
      'SELECT 1 FROM teacher_subjects WHERE teacher_id = ? AND subject_code = ?'
    ).bind(user.teacher_id, subjectCode).first();
    if (!access) return json({ error: '无权访问此科目 / No access to this subject' }, 403, cors);
  }

  const body = await request.json().catch(() => ({}));
  const feedback    = typeof body.feedback === 'string' ? body.feedback : '';
  const is_complete = body.is_complete ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO reports (student_id, subject_code, feedback, is_complete, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(student_id, subject_code) DO UPDATE SET
       feedback    = excluded.feedback,
       is_complete = excluded.is_complete,
       updated_at  = datetime('now')`
  ).bind(parseInt(studentId), subjectCode, feedback, is_complete).run();

  await audit(env, user.username, 'SAVE_REPORT',
    `student:${studentId}:${subjectCode}`, `complete:${is_complete}`);

  return json({ success: true }, 200, cors);
}

async function handleMarkComplete(env, user, subjectCode, cors) {
  if (user.role !== 'form_teacher') {
    const access = await env.DB.prepare(
      'SELECT 1 FROM teacher_subjects WHERE teacher_id = ? AND subject_code = ?'
    ).bind(user.teacher_id, subjectCode).first();
    if (!access) return json({ error: '无权访问此科目 / No access' }, 403, cors);
  }

  const students = await env.DB.prepare('SELECT id FROM students').all();
  const stmts = students.results.map(st =>
    env.DB.prepare(
      `INSERT INTO reports (student_id, subject_code, feedback, is_complete, updated_at)
       VALUES (?, ?, COALESCE((SELECT feedback FROM reports WHERE student_id=? AND subject_code=?),''), 1, datetime('now'))
       ON CONFLICT(student_id, subject_code) DO UPDATE SET is_complete=1, updated_at=datetime('now')`
    ).bind(st.id, subjectCode, st.id, subjectCode)
  );

  await env.DB.batch(stmts);
  await audit(env, user.username, 'MARK_COMPLETE', subjectCode);
  return json({ success: true }, 200, cors);
}

async function handleSummary(env, cors) {
  const [studentsRes, subjectsRes, reportsRes] = await Promise.all([
    env.DB.prepare('SELECT id, name, parent_code FROM students ORDER BY id').all(),
    env.DB.prepare('SELECT code, display_name FROM subjects ORDER BY sort_order').all(),
    env.DB.prepare('SELECT student_id, subject_code, feedback, is_complete FROM reports').all(),
  ]);

  const reportMap = {};
  for (const r of reportsRes.results) {
    if (!reportMap[r.student_id]) reportMap[r.student_id] = {};
    reportMap[r.student_id][r.subject_code] = {
      feedback:    r.feedback,
      is_complete: r.is_complete,
    };
  }

  const students = studentsRes.results.map(st => ({
    ...st,
    reports: Object.fromEntries(
      subjectsRes.results.map(s => [
        s.code,
        reportMap[st.id]?.[s.code] || { feedback: '', is_complete: 0 }
      ])
    )
  }));

  return json({ students, subjects: subjectsRes.results }, 200, cors);
}

async function handleGenerateLinks(env, cors) {
  const students = await env.DB.prepare(
    'SELECT id, name, parent_code FROM students ORDER BY id'
  ).all();

  const parentBase = env.PARENT_BASE_URL || 'https://vincecham91-png.github.io/J3K/parent.html';
  const links = students.results.map(st => ({
    student_id:  st.id,
    name:        st.name,
    parent_code: st.parent_code,
    url:         `${parentBase}?code=${st.parent_code}`,
  }));

  return json({ links }, 200, cors);
}

async function handleResetPassword(request, env, user, cors) {
  const body = await request.json().catch(() => ({}));
  const { username, new_password } = body;

  if (!username || !new_password) {
    return json({ error: '请提供用户名和新密码 / Username and new password required' }, 400, cors);
  }

  const teacher = await env.DB.prepare(
    'SELECT id FROM teachers WHERE username = ?'
  ).bind(username.toLowerCase().trim()).first();
  if (!teacher) return json({ error: '用户不存在 / User not found' }, 404, cors);

  await env.DB.prepare('UPDATE teachers SET password = ? WHERE id = ?')
    .bind(await hashPassword(new_password), teacher.id).run();

  // Invalidate all sessions for this teacher
  await env.DB.prepare('DELETE FROM sessions WHERE teacher_id = ?').bind(teacher.id).run();

  await audit(env, user.username, 'RESET_PASSWORD', username);
  return json({ success: true }, 200, cors);
}

async function handleParentReport(request, env, pathname, cors) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip, 10)) {
    return json({ error: '请求过于频繁，请稍后再试 / Too many requests' }, 429, cors);
  }

  const code = pathname.split('/').pop()?.trim().toUpperCase();
  if (!code || code.length !== 8) {
    return json({ error: '无效的访问码 / Invalid access code' }, 400, cors);
  }

  const student = await env.DB.prepare(
    'SELECT id, name, photo_url FROM students WHERE parent_code = ?'
  ).bind(code).first();

  if (!student) return json({ error: '找不到学生信息 / Student not found' }, 404, cors);

  const reportsRes = await env.DB.prepare(
    `SELECT r.subject_code, s.display_name, r.feedback, r.is_complete
     FROM reports r
     JOIN subjects s ON r.subject_code = s.code
     WHERE r.student_id = ?
     ORDER BY s.sort_order`
  ).bind(student.id).all();

  return json({
    student: {
      name:      student.name,
      photo_url: student.photo_url,
    },
    reports: reportsRes.results,
  }, 200, cors);
}

async function handleClassConfig(env, cors) {
  const subjects = await env.DB.prepare(
    'SELECT code, display_name FROM subjects ORDER BY sort_order'
  ).all();
  return json({
    school:   '华联中学 · Hua Lian High School',
    class:    'J3K 初三仁',
    subjects: subjects.results,
  }, 200, cors);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function audit(env, actor, action, target = null, details = null) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (actor, action, target, details) VALUES (?, ?, ?, ?)`
    ).bind(actor, action, target, details).run();
  } catch (_) {
    // Audit failures should not crash the main request
  }
}
