// ============================================================
// scripts/seed.js
// 生成种子数据 SQL（含 PBKDF2 密码哈希）
// 运行方式: node scripts/seed.js > scripts/0002_seed.sql
// 需要 Node.js 18+
// ============================================================

const { webcrypto } = require('crypto');
const crypto = webcrypto;

const ITERATIONS = 100000;
const KEY_LENGTH = 256;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, KEY_LENGTH
  ));
  return Buffer.from(salt).toString('base64') + ':' + Buffer.from(derived).toString('base64');
}

function generateParentCode() {
  // 8 chars, exclude I/1/O/0/L to avoid confusion
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function sqlEscape(str) {
  return str.replace(/'/g, "''");
}

// ── Data ─────────────────────────────────────────────────────────────────────

const students = [
  { name: "LI WEI SHEN (李玮绅)",                    photo: "24002 李玮绅.JPG" },
  { name: "TANG YU JIE (陈语捷)",                     photo: "24062_TANG YU JIE.jpg" },
  { name: "GOH ZI HAN (吴紫涵)",                      photo: "25159_GOH ZI HAN.jpg" },
  { name: "HING JIA EN (方佳恩)",                     photo: "24058_HING JIA EN.jpg" },
  { name: "HOW TIAN QIAN (侯甜芊)",                   photo: "24059_HOW TIAN QIAN.jpg" },
  { name: "KHOR YAN SAN (许燕珊)",                    photo: "24060_KHOR YAN SAN.jpg" },
  { name: "LOK CI EN (陆糍恩)",                       photo: "24061_LOK CI EN.jpg" },
  { name: "FUNG JUN SHEN (范俊昇)",                   photo: "24065_FUNG JUN SHEN.jpg" },
  { name: "KHOR JIA TEE (许家弟)",                    photo: "24066_KHOR JIA TEE.jpg" },
  { name: "LEE DING YI (李定毅)",                     photo: "24067_LEE DING YI.jpg" },
  { name: "LEE WEI HANN (李韡翰)",                    photo: "24068_LEE WEI HANN.jpg" },
  { name: "ONG BOON XIN (王文信)",                    photo: "24069_ONG BOON XIN.jpg" },
  { name: "WESLEY LEONG KIM HOU (梁錦壕)",             photo: "24072_WESLEY LEONG KIM HOU.jpg" },
  { name: "OOI YOU MIN (黄宥敏)",                     photo: "24096_OOI YOU MIN.jpg" },
  { name: "MISS PHICHAYA THANAKUNTHAWEE (李芊芊)",    photo: "24100 MISS PHICHAYA THANAKUNTHAWEE.jpg" },
  { name: "LYVIA LEE TZI QING (李紫晴)",              photo: "25009 李紫晴.JPG" },
  { name: "XU YONG YI (许雍义)",                      photo: "26010_XU YONG YI.jpg" },
];

const subjects = [
  { code: 'math',      display: 'Math / 数学 / Matematik',                    sort: 1  },
  { code: 'english',   display: 'English / 英语 / Bahasa Inggeris',           sort: 2  },
  { code: 'malay',     display: 'Malay / 马来语 / Bahasa Melayu',             sort: 3  },
  { code: 'chinese',   display: 'Chinese / 华语 / Bahasa Cina',               sort: 4  },
  { code: 'history',   display: 'History / 历史 / Sejarah',                   sort: 5  },
  { code: 'geography', display: 'Geography / 地理 / Geografi',                sort: 6  },
  { code: 'physic',    display: 'Physic / 物理 / Fizik',                      sort: 7  },
  { code: 'chemistry', display: 'Chemistry / 化学 / Kimia',                   sort: 8  },
  { code: 'biology',   display: 'Biology / 生物 / Biologi',                   sort: 9  },
  { code: 'art',       display: 'Art / 美术 / Pendidikan Seni Visual',        sort: 10 },
  { code: 'computer',  display: 'Computer / 电脑 / Komputer',                 sort: 11 },
  { code: 'robotics',  display: 'Robotics / 机器人 / Robotik',                sort: 12 },
];

const teachers = [
  { username: 'form_teacher', display: '班主任',              role: 'form_teacher', password: 'f123', subjects: [] },
  { username: 'math_t',       display: 'Math 数学老师',       role: 'teacher',      password: 'm123', subjects: ['math'] },
  { username: 'english_t',    display: 'English 英语老师',    role: 'teacher',      password: 'e123', subjects: ['english'] },
  { username: 'malay_t',      display: 'Malay 马来语老师',    role: 'teacher',      password: 'm123', subjects: ['malay'] },
  { username: 'chinese_t',    display: 'Chinese 华语老师',    role: 'teacher',      password: 'c123', subjects: ['chinese'] },
  { username: 'history_t',    display: 'History 历史老师',    role: 'teacher',      password: 'h123', subjects: ['history'] },
  { username: 'geography_t',  display: 'Geography 地理老师',  role: 'teacher',      password: 'g123', subjects: ['geography'] },
  { username: 'physic_t',     display: 'Physic 物理老师',     role: 'teacher',      password: 'p123', subjects: ['physic'] },
  { username: 'chemistry_t',  display: 'Chemistry 化学老师',  role: 'teacher',      password: 'c123', subjects: ['chemistry'] },
  { username: 'biology_t',    display: 'Biology 生物老师',    role: 'teacher',      password: 'b123', subjects: ['biology'] },
  { username: 'art_t',        display: 'Art 美术老师',        role: 'teacher',      password: 'a123', subjects: ['art'] },
  { username: 'computer_t',   display: 'Computer 电脑老师',   role: 'teacher',      password: 'c123', subjects: ['computer'] },
  { username: 'robotics_t',   display: 'Robotics 机器人老师', role: 'teacher',      password: 'r123', subjects: ['robotics'] },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const lines = [];
  lines.push('-- ============================================================');
  lines.push('-- Auto-generated seed data for 华联中学评语系统');
  lines.push('-- Generated: ' + new Date().toISOString());
  lines.push('-- ============================================================');
  lines.push('');

  // Class group
  lines.push('-- Class group');
  lines.push("INSERT OR IGNORE INTO student_groups (id, name) VALUES ('J3K', 'J3K 初三仁');");
  lines.push('');

  // Subjects
  lines.push('-- Subjects');
  for (const s of subjects) {
    lines.push(`INSERT OR IGNORE INTO subjects (code, display_name, sort_order) VALUES ('${s.code}', '${sqlEscape(s.display)}', ${s.sort});`);
  }
  lines.push('');

  // Subject-Group mappings (all subjects → J3K)
  lines.push('-- Subject-Group mappings (all subjects → J3K)');
  for (const s of subjects) {
    lines.push(`INSERT OR IGNORE INTO subject_groups (subject_code, group_id) VALUES ('${s.code}', 'J3K');`);
  }
  lines.push('');

  // Students with parent codes
  lines.push('-- Students');
  const usedCodes = new Set();
  for (const st of students) {
    let code;
    do { code = generateParentCode(); } while (usedCodes.has(code));
    usedCodes.add(code);

    // Strip _2 suffix from photo filename (matches existing 2.html logic)
    const cleanPhoto = st.photo.replace(/_2(?=\.[^.]+$)/, '');
    const photoUrl   = 'https://raw.githubusercontent.com/vincecham91-png/J3K/main/J3K%20photo/' +
                       encodeURIComponent(cleanPhoto);

    lines.push(`INSERT OR IGNORE INTO students (name, group_id, photo_url, parent_code) VALUES ('${sqlEscape(st.name)}', 'J3K', '${photoUrl}', '${code}');`);
  }
  lines.push('');

  // Teachers with PBKDF2 hashed passwords
  lines.push('-- Teachers (passwords are PBKDF2:SHA-256 hashed)');
  const hashedTeachers = [];
  for (const t of teachers) {
    const hash = await hashPassword(t.password);
    hashedTeachers.push({ ...t, hash });
    lines.push(`INSERT OR IGNORE INTO teachers (username, display_name, password, role) VALUES ('${t.username}', '${sqlEscape(t.display)}', '${hash}', '${t.role}');`);
  }
  lines.push('');

  // Teacher-Subject mappings
  lines.push('-- Teacher-Subject mappings');
  for (const t of hashedTeachers) {
    for (const subj of t.subjects) {
      lines.push(`INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_code) SELECT id, '${subj}' FROM teachers WHERE username = '${t.username}';`);
    }
  }
  lines.push('');

  lines.push('-- ============================================================');
  lines.push('-- Seed complete!');
  lines.push('-- Parent codes are in students.parent_code');
  lines.push('-- Run: wrangler d1 execute report-system-db --file=scripts/0002_seed.sql');
  lines.push('-- ============================================================');

  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(__dirname, '0002_seed.sql'), lines.join('\n'), 'utf8');
  console.log('Seed SQL file successfully written to scripts/0002_seed.sql');

  // Also print teacher account summary to stderr for reference
  process.stderr.write('\n=== 教师账号一览 ===\n');
  for (const t of teachers) {
    process.stderr.write(`  ${t.username.padEnd(14)} | ${t.display.padEnd(18)} | ${t.password}\n`);
  }
  process.stderr.write('===================\n\n');
}

main().catch(err => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
