-- ============================================================
-- 华联中学评语系统 — 完整数据库架构
-- migrations/0001_schema.sql
-- ============================================================

-- 分组表（班级）
CREATE TABLE IF NOT EXISTS student_groups (
  id   TEXT PRIMARY KEY,   -- 'J3K'
  name TEXT NOT NULL       -- 'J3K 初三仁'
);

-- 学生表
CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  group_id    TEXT    NOT NULL REFERENCES student_groups(id),
  photo_url   TEXT,
  parent_code TEXT    NOT NULL UNIQUE  -- 8位随机码（排除 I/1/O/0/L）
);

-- 科目表
CREATE TABLE IF NOT EXISTS subjects (
  code         TEXT    PRIMARY KEY,   -- 'math', 'chinese' ...
  display_name TEXT    NOT NULL,      -- 'Math / 数学 / Matematik'
  sort_order   INTEGER DEFAULT 0
);

-- 科目→分组映射
CREATE TABLE IF NOT EXISTS subject_groups (
  subject_code TEXT NOT NULL REFERENCES subjects(code),
  group_id     TEXT NOT NULL REFERENCES student_groups(id),
  PRIMARY KEY (subject_code, group_id)
);

-- 教师表
CREATE TABLE IF NOT EXISTS teachers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL UNIQUE,
  display_name TEXT    NOT NULL,
  password     TEXT    NOT NULL,  -- PBKDF2:SHA-256 格式: saltB64:hashB64
  role         TEXT    NOT NULL DEFAULT 'teacher'  -- 'form_teacher' 或 'teacher'
);

-- 教师→科目关联
CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id   INTEGER NOT NULL REFERENCES teachers(id),
  subject_code TEXT    NOT NULL REFERENCES subjects(code),
  PRIMARY KEY (teacher_id, subject_code)
);

-- 评语表
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id),
  subject_code TEXT    NOT NULL REFERENCES subjects(code),
  feedback     TEXT    DEFAULT '',
  is_complete  INTEGER DEFAULT 0,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, subject_code)
);

-- Session 表
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  target     TEXT,
  details    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── 索引 ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reports_student  ON reports(student_id);
CREATE INDEX IF NOT EXISTS idx_reports_subject  ON reports(subject_code);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_students_code    ON students(parent_code);
