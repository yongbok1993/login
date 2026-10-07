// 자동 생성 파일: 직접 수정하지 말고 migrations/*.sql을 고친 뒤 npm run build:migrations
export const MIGRATIONS = [
  {
    "name": "0001_init.sql",
    "statements": [
      "CREATE TABLE users (\n  id                INTEGER PRIMARY KEY,\n  name              TEXT    NOT NULL,\n  phone             TEXT    NOT NULL UNIQUE,\n  phone_verified_at TEXT    NOT NULL,\n  region            TEXT    NOT NULL DEFAULT '',\n  role              TEXT    NOT NULL DEFAULT 'participant'\n                    CHECK (role IN ('participant', 'staff', 'manager')),\n  is_selected       INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),\n  selected_at       TEXT,\n  created_at        TEXT    NOT NULL,\n  updated_at        TEXT    NOT NULL\n)",
      "CREATE TABLE registrations (\n  id              INTEGER PRIMARY KEY,\n  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,\n  registered_at   TEXT    NOT NULL,\n  internal_status TEXT    NOT NULL DEFAULT 'received'\n                  CHECK (internal_status IN ('received', 'reviewing', 'selected', 'not_selected', 'released')),\n  updated_at      TEXT    NOT NULL\n)",
      "CREATE TABLE consents (\n  id           INTEGER PRIMARY KEY,\n  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  purpose      TEXT    NOT NULL,\n  agreed       INTEGER NOT NULL CHECK (agreed IN (0, 1)),\n  doc_version  TEXT    NOT NULL,\n  agreed_at    TEXT    NOT NULL,\n  withdrawn_at TEXT\n)",
      "CREATE INDEX consents_user ON consents(user_id)",
      "CREATE TABLE programs (\n  id             INTEGER PRIMARY KEY,\n  code           TEXT    UNIQUE,\n  theme          TEXT    NOT NULL CHECK (theme IN ('L', 'O', 'G', 'IN')),\n  name           TEXT    NOT NULL,\n  detail         TEXT    NOT NULL DEFAULT '',\n  schedule_label TEXT    NOT NULL DEFAULT '',\n  assign_mode    TEXT    NOT NULL CHECK (assign_mode IN ('auto', 'select', 'manual', 'internal', 'external')),\n  is_public      INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),\n  self_cancel    INTEGER NOT NULL DEFAULT 0 CHECK (self_cancel IN (0, 1)),\n  sort_order     INTEGER NOT NULL DEFAULT 0,\n  created_at     TEXT    NOT NULL,\n  updated_at     TEXT    NOT NULL\n)",
      "CREATE TABLE program_sessions (\n  id           INTEGER PRIMARY KEY,\n  program_id   INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,\n  round_no     INTEGER,\n  date         TEXT,\n  start_time   TEXT,\n  end_time     TEXT,\n  place        TEXT,\n  capacity     INTEGER CHECK (capacity IS NULL OR capacity >= 0),\n  is_closed    INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),\n  is_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (is_cancelled IN (0, 1)),\n  created_at   TEXT    NOT NULL,\n  updated_at   TEXT    NOT NULL\n)",
      "CREATE INDEX program_sessions_program ON program_sessions(program_id)",
      "CREATE TABLE enrollments (\n  id            INTEGER PRIMARY KEY,\n  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  session_id    INTEGER NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,\n  source        TEXT    NOT NULL CHECK (source IN ('auto', 'select', 'manual')),\n  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),\n  cancel_reason TEXT    CHECK (cancel_reason IS NULL OR cancel_reason IN ('self', 'admin', 'deselected')),\n  created_at    TEXT    NOT NULL,\n  cancelled_at  TEXT,\n  UNIQUE (user_id, session_id)\n)",
      "CREATE INDEX enrollments_session ON enrollments(session_id)",
      "CREATE TABLE attendance (\n  enrollment_id INTEGER PRIMARY KEY REFERENCES enrollments(id) ON DELETE CASCADE,\n  status        TEXT    NOT NULL CHECK (status IN ('attended', 'absent')),\n  recorded_by   INTEGER REFERENCES users(id),\n  recorded_at   TEXT    NOT NULL\n)",
      "CREATE TABLE como_links (\n  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,\n  status        TEXT    NOT NULL\n                CHECK (status IN ('linked', 'not_found', 'conflict', 'needs_recheck', 'error')),\n  external_id   TEXT    UNIQUE,\n  phone_at_link TEXT,\n  candidates    TEXT,\n  detail        TEXT,\n  checked_at    TEXT    NOT NULL,\n  linked_at     TEXT\n)",
      "CREATE TABLE como_status (\n  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,\n  external_id        TEXT    NOT NULL,\n  total_sessions     INTEGER,\n  completed_sessions INTEGER NOT NULL,\n  next_at            TEXT,\n  source             TEXT    NOT NULL CHECK (source IN ('live', 'mock')),\n  remote_updated_at  TEXT,\n  synced_at          TEXT    NOT NULL\n)",
      "CREATE TABLE como_sync_log (\n  id         INTEGER PRIMARY KEY,\n  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  action     TEXT    NOT NULL,\n  result     TEXT    NOT NULL,\n  message    TEXT,\n  created_at TEXT    NOT NULL\n)",
      "CREATE TABLE audit_log (\n  id          INTEGER PRIMARY KEY,\n  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  action      TEXT    NOT NULL,\n  target_type TEXT    NOT NULL,\n  target_id   INTEGER,\n  detail      TEXT,\n  created_at  TEXT    NOT NULL\n)",
      "CREATE TABLE auth_sessions (\n  token_hash   TEXT PRIMARY KEY,\n  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,\n  csrf         TEXT NOT NULL,\n  data         TEXT NOT NULL DEFAULT '{}',\n  created_at   TEXT NOT NULL,\n  last_seen_at TEXT NOT NULL,\n  expires_at   TEXT NOT NULL\n)",
      "CREATE INDEX auth_sessions_user ON auth_sessions(user_id)",
      "CREATE TABLE otp_codes (\n  id          INTEGER PRIMARY KEY,\n  phone       TEXT    NOT NULL,\n  purpose     TEXT    NOT NULL,\n  code_hash   TEXT    NOT NULL,\n  attempts    INTEGER NOT NULL DEFAULT 0,\n  ip          TEXT,\n  created_at  TEXT    NOT NULL,\n  expires_at  TEXT    NOT NULL,\n  consumed_at TEXT\n)",
      "CREATE INDEX otp_codes_phone ON otp_codes(phone, created_at)",
      "CREATE INDEX otp_codes_ip ON otp_codes(ip, created_at)"
    ]
  },
  {
    "name": "0002_seed_programs.sql",
    "statements": [
      "INSERT INTO programs (code, theme, name, detail, schedule_label, assign_mode, is_public, sort_order, created_at, updated_at) VALUES\n  ('link-cooking', 'L', '요리교실', '', '2~11월 · 10회', 'auto', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('link-seasonal', 'L', '절기행사', '', '7월·9월 · 2회', 'auto', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('link-outing', 'L', '나들이', '', '4월·10월 · 2회', 'auto', 1, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('link-kimjang', 'L', '김장나눔활동', '', '6월·11월 · 2회', 'auto', 1, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('open-casework', 'O', '개별 사례관리', '', '2~12월 · 상시', 'manual', 1, 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('open-kit', 'O', '정서지원 키트', '', '3월·9월 · 2회', 'manual', 1, 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('open-counseling', 'O', '전문 심리상담', '', '2~11월 · 사업 운영 20회', 'external', 1, 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('open-meetup', 'O', '만남 및 교류활동', '', '2~12월 · 월 1회', 'manual', 1, 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('grow-career', 'G', '직업·적성 체험', '베이킹·쿠킹·바리스타 등', '2~6월 · 10회', 'select', 1, 8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('grow-craft', 'G', '공예 체험', '', '7~10월 · 8회', 'select', 1, 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('grow-communication', 'G', '의사소통 교육', '', '3~4월 · 4회', 'select', 1, 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('in-case-conference', 'IN', '통합사례회의', '기관 내부 운영', '2월·9월 · 2회', 'internal', 1, 11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('in-campaign', 'IN', '지역사회 인식개선 캠페인', '', '10월 · 1회', 'manual', 1, 12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\nON CONFLICT(code) DO NOTHING"
    ]
  },
  {
    "name": "0003_registration_fields.sql",
    "statements": [
      "ALTER TABLE users ADD COLUMN address TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN birth_date TEXT",
      "UPDATE users SET address = region",
      "ALTER TABLE users DROP COLUMN region"
    ]
  },
  {
    "name": "0004_pin_login.sql",
    "statements": [
      "ALTER TABLE users ADD COLUMN pin_hash TEXT",
      "ALTER TABLE users ADD COLUMN pin_must_change INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN pin_updated_at TEXT",
      "ALTER TABLE users ADD COLUMN phone_confirmed_at TEXT",
      "DROP TABLE otp_codes",
      "CREATE TABLE login_attempts (\n  id         INTEGER PRIMARY KEY,\n  kind       TEXT    NOT NULL CHECK (kind IN ('login', 'register', 'pin')),\n  phone      TEXT,\n  ip         TEXT,\n  success    INTEGER NOT NULL CHECK (success IN (0, 1)),\n  created_at TEXT    NOT NULL\n)",
      "CREATE INDEX login_attempts_phone ON login_attempts(phone, created_at)",
      "CREATE INDEX login_attempts_ip ON login_attempts(ip, created_at)"
    ]
  },
  {
    "name": "0005_address_detail.sql",
    "statements": [
      "ALTER TABLE users ADD COLUMN postcode TEXT",
      "ALTER TABLE users ADD COLUMN address_detail TEXT NOT NULL DEFAULT ''"
    ]
  }
];
