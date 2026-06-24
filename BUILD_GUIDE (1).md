# 多教师协作学生评语系统 — 完整构建指南

> **目标读者**：AI 编程助手（如 Claude Code、Cursor、Copilot 等）
> **用途**：将这份指南交给 AI，让它从零复制一个相同架构的评语系统

---

## 1. 项目概览

这是一个**安全的、多教师协作的学生评语录入系统**，每位科目老师只能看到自己负责的学生，评语存入云端数据库，最后班主任为每个学生生成一个唯一链接发给家长查看。

**参考成品**：
- 教师登录：https://chewyenhan.github.io/reports/teacher-login.html
- 班主任仪表盘：https://chewyenhan.github.io/reports/form-teacher.html
- 家长报告：https://chewyenhan.github.io/reports/parent.html?code=XXXXXXXX
- 后端 API：https://hualianhistory-reports.chewyenhan.workers.dev

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────┐
│                    用户端                        │
│  teacher-login.html  →  教师登录                 │
│  teacher-report.html →  评语录入（Tab 切换科目）  │
│  form-teacher.html   →  班主任仪表盘 + 生成链接   │
│  parent.html         →  家长查看（手机适配）       │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS
                   ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare Worker (worker.js)                  │
│  - 路由分发（if/else 匹配 URL path）              │
│  - CORS 白名单                                   │
│  - Session Token 认证中间件                       │
│  - 分组过滤（教师只能看自己学生）                  │
│  - 限流（家长链接每 IP 每分钟 5 次）              │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare D1 (SQLite 兼容)                     │
│  - 7 张表：students, subjects, teachers,         │
│    reports, sessions, audit_log 等               │
└─────────────────────────────────────────────────┘

部署目标：
  前端 → GitHub Pages (chewyenhan.github.io/reports/)
  后端 → Cloudflare Workers (wrangler deploy)
```

---

## 3. Cloudflare 基础设施搭建

### 3.1 创建 Worker 和 D1 数据库

```bash
# 安装 wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create report-system-db

# 记录输出的 database_id，填入 wrangler.json
```

### 3.2 wrangler.json 配置模板

```json
{
  "name": "your-reports-worker",
  "main": "worker.js",
  "compatibility_date": "2025-05-02",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "report-system-db",
      "database_id": "你的D1数据库ID",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "CORS_ORIGIN": "https://你的用户名.github.io",
    "PARENT_BASE_URL": "https://你的用户名.github.io/reports/parent.html",
    "SESSION_DURATION_DAYS": "7"
  }
}
```

### 3.3 部署

```bash
# 执行数据库迁移
wrangler d1 execute report-system-db --file=migrations/0001_schema.sql

# 填充种子数据
node scripts/seed.js
wrangler d1 execute report-system-db --file=scripts/0002_seed.sql

# 部署 Worker
wrangler deploy
```

---

## 4. 数据库设计（D1 / SQLite）

### 4.1 完整建表 SQL

```sql
-- 分组表（AB 班）
CREATE TABLE IF NOT EXISTS student_groups (
  id TEXT PRIMARY KEY,          -- 'A' 或 'B'
  name TEXT NOT NULL            -- 'S3FA 文商班'
);

-- 学生表
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,           -- '张三 (Ali)'
  group_id TEXT NOT NULL REFERENCES student_groups(id),
  photo_url TEXT,               -- 'photo01.jpg' 放在 photos/ 文件夹
  parent_code TEXT NOT NULL UNIQUE  -- 8位随机码，排除 I/1/O/0/L
);

-- 科目表
CREATE TABLE IF NOT EXISTS subjects (
  code TEXT PRIMARY KEY,        -- 'chinese', 'math', 'art_design' ...
  display_name TEXT NOT NULL    -- '华语 / Bahasa Cina'
);

-- 科目→分组映射（控制哪些学生出现在该科目下）
CREATE TABLE IF NOT EXISTS subject_groups (
  subject_code TEXT NOT NULL REFERENCES subjects(code),
  group_id TEXT NOT NULL REFERENCES student_groups(id),
  PRIMARY KEY (subject_code, group_id)
);

-- 教师表
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,  -- 'chinese_t', 'art_t1' ...
  display_name TEXT NOT NULL,     -- '华语老师'
  password TEXT NOT NULL,        -- PBKDF2 哈希
  role TEXT NOT NULL DEFAULT 'teacher'  -- 'form_teacher' 或 'teacher'
);

-- 教师→科目关联（一个教师可教多科）
CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  subject_code TEXT NOT NULL REFERENCES subjects(code),
  PRIMARY KEY (teacher_id, subject_code)
);

-- 评语表
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  subject_code TEXT NOT NULL REFERENCES subjects(code),
  feedback TEXT DEFAULT '',
  is_complete INTEGER DEFAULT 0,
  UNIQUE(student_id, subject_code)
);

-- Session 表
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.2 关键索引

```sql
CREATE INDEX IF NOT EXISTS idx_reports_student ON reports(student_id);
CREATE INDEX IF NOT EXISTS idx_reports_subject ON reports(subject_code);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
```

---

## 5. Worker 后端（worker.js）

### 5.1 主路由结构

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = corsHeaders(request);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // 公开路由（无需登录）
      if (path.startsWith('/api/auth/login') && request.method === 'POST') {
        return handleLogin(request, env, cors);
      }
      if (path.startsWith('/api/parent/report/')) {
        return handleParentReport(request, env, path, cors);
      }
      if (path === '/api/config/class') {
        return handleClassConfig(request, env, cors);
      }

      // 需要登录的路由
      const user = await authenticate(request, env);
      if (!user) {
        return json({ error: '未登录' }, 401, cors);
      }

      // 教师路由
      if (path === '/api/auth/me') return handleMe(user, env, cors);
      if (path === '/api/auth/logout') return handleLogout(request, env, user, cors);
      if (path === '/api/auth/change-password') return handleChangePassword(request, env, user, cors);
      if (path === '/api/reports/my-subjects') return handleMyReports(user, env, cors);
      // ... 更多路由

      // 班主任专属路由
      if (user.role !== 'form_teacher') {
        return json({ error: '仅班主任可访问' }, 403, cors);
      }
      if (path === '/api/form-teacher/summary') return handleSummary(env, cors);
      if (path === '/api/form-teacher/generate-links') return handleGenerateLinks(request, env, cors);
      if (path === '/api/form-teacher/reset-password') return handleResetPassword(request, env, cors);

      return json({ error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ error: e.message }, 500, cors);
    }
  }
};
```

### 5.2 CORS 中间件

```javascript
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = [
    'https://你的用户名.github.io',
    'http://localhost:8000',
  ];
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
```

### 5.3 认证中间件（Bearer Token）

```javascript
async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;

  const session = await env.DB.prepare(
    'SELECT s.*, t.username, t.display_name, t.role, t.id as teacher_id FROM sessions s JOIN teachers t ON s.teacher_id = t.id WHERE s.token = ? AND s.expires_at > datetime(\'now\')'
  ).bind(token).first();

  if (!session) return null;

  // 自动续期（7 天滑动过期）
  await env.DB.prepare(
    'UPDATE sessions SET expires_at = datetime(\'now\', \'+7 days\') WHERE token = ?'
  ).bind(token).run();

  return session;
}
```

### 5.4 密码安全 — PBKDF2

```javascript
// 验证密码
async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(':');
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  ));
  return btoa(String.fromCharCode(...derived)) === hashB64;
}

// 生成哈希（种子脚本用）
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  ));
  return btoa(String.fromCharCode(...salt)) + ':' + btoa(String.fromCharCode(...derived));
}
```

### 5.5 分组过滤 — 核心逻辑

```javascript
// 教师登录后，获取其负责的科目+分组
async function handleMyReports(user, env, cors) {
  // 1. 查该教师负责的科目
  const subjects = await env.DB.prepare(
    'SELECT s.code, s.display_name FROM subjects s JOIN teacher_subjects ts ON s.code = ts.subject_code WHERE ts.teacher_id = ?'
  ).bind(user.teacher_id).all();

  // 2. 对每个科目，查出属于该分组的学生
  for (const subj of subjects.results) {
    const students = await env.DB.prepare(
      'SELECT st.id, st.name, st.photo_url, st.group_id, r.feedback, r.is_complete FROM students st JOIN subject_groups sg ON st.group_id = sg.group_id LEFT JOIN reports r ON r.student_id = st.id AND r.subject_code = ? WHERE sg.subject_code = ? ORDER BY st.group_id, st.id'
    ).bind(subj.code, subj.code).all();
    subj.students = students.results;
  }

  return json({ subjects: subjects.results }, 200, cors);
}
```

**关键点**：`subject_groups` 表控制科目↔分组映射。美术科目只关联 group B，商业科目只关联 group A。

---

## 6. 前端设计

### 6.1 文件结构

```
frontend/
├── teacher-login.html    # 登录页
├── teacher-report.html   # 评语录入页
├── form-teacher.html     # 班主任仪表盘
├── parent.html           # 家长报告页
├── css/
│   └── pico.min.css      # Pico.css v2 (CDN: https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css)
├── js/
│   ├── auth.js           # 登录/Session/Token 管理
│   ├── i18n.js           # 中英双语翻译
│   └── report-api.js     # API 调用封装
└── photos/               # 学生照片 (photo01.jpg ...)
```

### 6.2 UI 框架 — Pico.css v2

**为什么选 Pico.css**：
- Classless（无 class 的 CSS）：写语义化 HTML 自动美化
- 极小：~6KB gzipped
- 自带暗色模式、响应式、20+ CSS 变量可定制
- 官网：https://picocss.com

```html
<!-- 一行引入 -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
```

**品牌色定制**（覆盖 Pico 默认紫色，改为蓝色）：

```css
:root {
  --pico-primary: #1a56db;
  --pico-primary-background: #1a56db;
  --pico-primary-hover: #1e40af;
  --pico-primary-hover-background: #1e40af;
}
```

**Pico.css 自动美化的元素**：
| 写法 | 效果 |
|------|------|
| `<table class="striped">` | 斑马纹表格 |
| `<input>` `<textarea>` `<select>` | 自动圆角、聚焦光环 |
| `<button>` | 主色按钮（蓝色） |
| `<button class="secondary">` | 灰色次要按钮 |
| `<article>` | 卡片容器（阴影+圆角） |
| `<progress value="45" max="100">` | 进度条 |
| `<dialog>` | 弹出模态框 |

### 6.3 国际化（i18n）模式

```javascript
// i18n.js 核心结构
const I18N = {
  zh: {
    'login.heading': '🏫 XX中学评语系统',
    'login.button': '登录 / Login',
    // ... ~90 个 key
  },
  en: {
    'login.heading': '🏫 XX School Report System',
    'login.button': 'Login',
    // ...
  }
};

function getLang() { return localStorage.getItem('report_lang') || 'zh'; }
function setLang(lang) { localStorage.setItem('report_lang', lang); }
function t(key) { return I18N[getLang()][key] || I18N['zh'][key] || key; }

// 页面加载时自动扫描 [data-i18n] 属性并替换文字
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.title = t('site.title');
}
```

**用法**：在 HTML 中加 `data-i18n` 属性，JS 自动替换：
```html
<h2 data-i18n="login.heading">默认中文</h2>
<button data-i18n="login.button">登录</button>
```

### 6.4 认证模块（auth.js）

```javascript
const WORKER_URL = 'https://你的worker.workers.dev';

// Token 存 sessionStorage（关闭浏览器即失效）
function getToken() { return sessionStorage.getItem('report_token'); }
function setToken(token) { sessionStorage.setItem('report_token', token); }
function clearToken() { sessionStorage.removeItem('report_token'); }

// 通用请求封装（自动带 Bearer Token）
async function fetchWithAuth(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(WORKER_URL + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { clearToken(); window.location.href = 'teacher-login.html'; }
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

// 登录时务必调用 .json()！
async function login(username, password) {
  const res = await fetch(WORKER_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({})); // ← 不要漏掉 .json()
  if (!data.token) throw new Error(data.error || '登录失败');
  setToken(data.token);
  setUser(data.teacher);
  return data;
}
```

### 6.5 API 封装（report-api.js）

```javascript
// 独立的 API_BASE，不要依赖 auth.js 的 WORKER_URL
// 因为 parent.html 不加载 auth.js
const API_BASE = 'https://你的worker.workers.dev';

// 家长查报告（无需登录，直接 fetch）
async function getParentReport(code) {
  const res = await fetch(API_BASE + '/api/parent/report/' + code);
  return res.json();
}

// 其他需要登录的调用走 fetchWithAuth（定义在 auth.js）
async function getMyReports() { return fetchWithAuth('/api/reports/my-subjects'); }
async function saveReport(studentId, subjectCode, feedback, isComplete) {
  return fetchWithAuth(`/api/reports/${studentId}/${subjectCode}`, {
    method: 'PUT', body: JSON.stringify({ feedback, is_complete: isComplete ? 1 : 0 }),
  });
}
async function getSummary() { return fetchWithAuth('/api/form-teacher/summary'); }
async function generateLinks() { return fetchWithAuth('/api/form-teacher/generate-links', { method: 'POST' }); }
async function resetPassword(username, newPassword) {
  return fetchWithAuth('/api/form-teacher/reset-password', {
    method: 'POST', body: JSON.stringify({ username, new_password: newPassword }),
  });
}
async function changePassword(oldPwd, newPwd) {
  return fetchWithAuth('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
  });
}
```

### 6.6 家长报告页面（手机适配）

```css
/* 核心：手机端缩小间距和字号 */
@media (max-width: 576px) {
  main.container { padding: 0.75rem !important; }
  .report-header h1 { font-size: 1.3rem; }
  table { font-size: 0.85rem; }
  th, td { padding: 0.5rem 0.4rem !important; }
}
/* 打印时隐藏按钮 */
@media print {
  .print-btn { display: none !important; }
  body { background: white; }
}
```

家长通过班主任生成的 8 位码访问：
```
https://你的域名.github.io/reports/parent.html?code=XXXXXXXX
```

---

## 7. 班级配置文件模式

用 JSON 配置文件驱动整个系统，换班级只需改配置：

```json
{
  "className": "S3F 高三孝",
  "studentGroups": [
    { "id": "A", "name": "S3FA 文商班" },
    { "id": "B", "name": "S3FB 美班" }
  ],
  "subjects": [
    { "code": "chinese",  "display": "华语",          "groups": ["A","B"] },
    { "code": "commerce", "display": "商业",          "groups": ["A"] },
    { "code": "art_design","display": "平面设计",      "groups": ["B"] }
  ],
  "teachers": [
    { "username": "form_teacher", "display": "班主任", "role": "form_teacher", "subjects": ["*"] },
    { "username": "chinese_t",    "display": "华语老师", "role": "teacher", "subjects": ["chinese"] },
    { "username": "art_t1",       "display": "美术老师A", "role": "teacher", "subjects": ["art_design","art_sketch"] }
  ],
  "students": [
    { "name": "张三 (Ali)", "group": "A", "photo": "photo01.jpg" }
  ]
}
```

写一个 `scripts/seed.js` 脚本来读取 JSON → 生成 SQL INSERT 语句。

---

## 8. 常见坑和避坑指南

### ❌ 坑 1：`fetch()` 后忘了 `.json()`
```javascript
// 错误
const data = await fetch(...);
// 正确
const data = await (await fetch(...)).json();
```

### ❌ 坑 2：SQL JOIN 时 `id` 字段歧义
```sql
-- 错误：多个表都有 id
SELECT id, name FROM students JOIN reports ON ...
-- 正确：用别名限定
SELECT st.id, st.name FROM students st JOIN reports r ON r.student_id = st.id
```

### ❌ 坑 3：Git 推送到了错误的 GitHub 仓库
```bash
# 每次推送前确认 remote
git remote -v

# 前端文件要推送到独立的 GitHub Pages 仓库，不是后端仓库
# 正确做法：clone 目标仓库 → 复制文件 → 在那个 clone 里 push
```

### ❌ 坑 4：`const` 全局变量跨 script 标签冲突
```html
<!-- auth.js 定义了 const WORKER_URL -->
<script src="js/auth.js"></script>
<!-- report-api.js 不能再用 const WORKER_URL，会报错 -->
<script src="js/report-api.js"></script>
```
**解决**：在 `report-api.js` 中用独立的变量名 `API_BASE`，或在只用 `report-api.js` 的页面（如 parent.html）中确保变量已定义。

### ❌ 坑 5：i18n 翻译 key 遗漏
中文和英文的 key 数量必须一致。如果某个 key 在 `en` 里有但 `zh` 里没有，会 fallback 到 key 名本身。教师名字这种动态内容尤其容易遗漏。

### ❌ 坑 6：D1 的日期函数
```sql
-- D1 用 datetime('now')，不是 NOW()
-- 正确
datetime('now', '+7 days')
-- 错误
NOW() + INTERVAL 7 DAY
```

---

## 9. 完整 API 端点清单

| 方法 | 路径 | 认证 | 用途 |
|------|------|------|------|
| POST | `/api/auth/login` | 无 | 教师登录 |
| POST | `/api/auth/logout` | Bearer | 注销 |
| GET | `/api/auth/me` | Bearer | 获取当前用户信息 |
| POST | `/api/auth/change-password` | Bearer | 自己改密码 |
| GET | `/api/reports/my-subjects` | Bearer | 获取教师负责科目+学生列表 |
| PUT | `/api/reports/:studentId/:subjectCode` | Bearer | 保存单条评语 |
| POST | `/api/reports/mark-complete/:subjectCode` | Bearer | 标记某科全部完成 |
| GET | `/api/form-teacher/summary` | Bearer+班主任 | 全科矩阵（31人×17科） |
| POST | `/api/form-teacher/generate-links` | Bearer+班主任 | 批量生成家长链接 |
| POST | `/api/form-teacher/reset-password` | Bearer+班主任 | 管理员重置教师密码 |
| GET | `/api/parent/report/:code` | 无（限流）| 家长查看报告 |
| GET | `/api/config/class` | 无 | 获取班级配置 |
| OPTIONS | `/api/*` | 无 | CORS 预检 |

---

## 10. 安全措施清单

- [x] 密码用 PBKDF2 + SHA-256（100000 次迭代），不存明文
- [x] Session Token 用 UUIDv4，7 天滑动过期
- [x] 家长链接 8 位随机码（排除 I/1/O/0/L），30⁸ ≈ 6560 亿种组合
- [x] 家长 API 每 IP 每分钟限流 5 次
- [x] CORS 白名单，只允许自己的 GitHub Pages 域名
- [x] 教师只能看到自己负责科目+分组的学生（后台强制过滤）
- [x] 班主任是唯一能看全科数据、重置密码、生成家长链接的角色
- [x] 审计日志记录所有写操作

---

## 11. 品牌/署名规范

- 页脚统一：`© 2026 XX中学 · School Name · CREATOR_NAME 制作`
- 所有页面 `<html lang="zh" data-theme="light">`
- 登录页背景渐变：`linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 50%, #f8fafc 100%)`
- 主色调：`#1a56db`（蓝色）

---

## 12. 参考源代码

完整可运行的源码在：
- Worker 后端：查看 `worker.js`
- 数据库迁移：查看 `migrations/0001_schema.sql`
- 前端页面：查看 `frontend/` 目录下的 4 个 HTML 文件
- JS 模块：查看 `frontend/js/` 目录下的 `auth.js`、`i18n.js`、`report-api.js`
- 种子脚本：查看 `scripts/seed.js`

**部署完成后的验证清单**：
1. 美术老师登录 → 确认只看到 B 班学生
2. 通用科目老师（华语）→ 确认看到全部学生
3. 家长用 code 打开 → 确认只看到自己孩子
4. 手机打开家长页 → 确认布局正常
5. 快速刷新家长页 6 次 → 确认限流生效
6. 自己改密码 → 确认可用新密码登录
7. 班主任重置某教师密码 → 确认可用新密码登录
