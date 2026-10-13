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
  },
  {
    "name": "0006_grow_selection_notices.sql",
    "statements": [
      "ALTER TABLE enrollments ADD COLUMN selection TEXT",
      "ALTER TABLE enrollments ADD COLUMN decided_at TEXT",
      "UPDATE enrollments SET selection = 'selected' WHERE source = 'select'",
      "CREATE TABLE notices (\n  id         INTEGER PRIMARY KEY,\n  title      TEXT    NOT NULL,\n  body       TEXT    NOT NULL DEFAULT '',\n  audience   TEXT    NOT NULL CHECK (audience IN ('public', 'participants')),\n  is_pinned  INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),\n  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  created_at TEXT    NOT NULL,\n  updated_at TEXT    NOT NULL\n)",
      "CREATE INDEX notices_audience ON notices(audience, created_at)"
    ]
  },
  {
    "name": "0007_counseling_count.sql",
    "statements": [
      "UPDATE programs SET schedule_label = '2~11월 · 사업 운영 10회', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')\nWHERE code = 'open-counseling' AND schedule_label = '2~11월 · 사업 운영 20회'"
    ]
  },
  {
    "name": "0008_app_settings.sql",
    "statements": [
      "CREATE TABLE app_settings (\n  key        TEXT PRIMARY KEY,\n  value      TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)"
    ]
  },
  {
    "name": "0009_setup_code.sql",
    "statements": [
      "INSERT OR IGNORE INTO app_settings (key, value, updated_at)\nSELECT 'setup_code_hash', 'b92978658c8d0a2a5fce9c6ff9ffb992866f9d20f8940da6472152c4ace48d93', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')\nWHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'manager')"
    ]
  },
  {
    "name": "0010_admin_password.sql",
    "statements": [
      "ALTER TABLE users ADD COLUMN login_id TEXT",
      "ALTER TABLE users ADD COLUMN password_hash TEXT",
      "ALTER TABLE users ADD COLUMN password_must_change INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN password_updated_at TEXT",
      "CREATE UNIQUE INDEX users_login_id ON users(login_id)"
    ]
  },
  {
    "name": "0011_applications_boards.sql",
    "statements": [
      "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended'))",
      "CREATE TRIGGER participants_cap_update BEFORE UPDATE ON users\nWHEN NEW.role = 'participant' AND NEW.is_selected = 1 AND NEW.account_status = 'active'\n  AND NOT (OLD.role = 'participant' AND OLD.is_selected = 1 AND OLD.account_status = 'active')\n  AND (SELECT COUNT(*) FROM users WHERE role = 'participant' AND is_selected = 1 AND account_status = 'active') >= 10\nBEGIN SELECT RAISE(ABORT, 'participant_cap'); END",
      "CREATE TRIGGER participants_cap_insert BEFORE INSERT ON users\nWHEN NEW.role = 'participant' AND NEW.is_selected = 1 AND NEW.account_status = 'active'\n  AND (SELECT COUNT(*) FROM users WHERE role = 'participant' AND is_selected = 1 AND account_status = 'active') >= 10\nBEGIN SELECT RAISE(ABORT, 'participant_cap'); END",
      "CREATE INDEX registrations_order ON registrations(registered_at, id)",
      "CREATE TABLE password_resets (\n  id         INTEGER PRIMARY KEY,\n  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  code_hash  TEXT    NOT NULL,\n  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  created_at TEXT    NOT NULL,\n  expires_at TEXT    NOT NULL,\n  used_at    TEXT\n)",
      "CREATE INDEX password_resets_user ON password_resets(user_id, created_at)",
      "CREATE TABLE posts (\n  id          INTEGER PRIMARY KEY,\n  board       TEXT    NOT NULL CHECK (board IN ('notice', 'free', 'qna')),\n  title       TEXT    NOT NULL,\n  body        TEXT    NOT NULL DEFAULT '',\n  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),\n  visibility  TEXT    NOT NULL DEFAULT 'members' CHECK (visibility IN ('members', 'private')),\n  answer_body TEXT,\n  answer_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  answered_at TEXT,\n  created_at  TEXT    NOT NULL,\n  updated_at  TEXT    NOT NULL\n)",
      "CREATE INDEX posts_board ON posts(board, is_pinned, created_at)",
      "CREATE INDEX posts_author ON posts(author_id)",
      "CREATE TABLE post_comments (\n  id         INTEGER PRIMARY KEY,\n  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,\n  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  body       TEXT    NOT NULL,\n  created_at TEXT    NOT NULL,\n  updated_at TEXT    NOT NULL\n)",
      "CREATE INDEX post_comments_post ON post_comments(post_id, created_at)",
      "INSERT INTO posts (board, title, body, author_id, is_pinned, visibility, created_at, updated_at)\nSELECT 'notice', title, body, created_by, is_pinned, 'members', created_at, updated_at FROM notices ORDER BY id",
      "ALTER TABLE programs ADD COLUMN archived_at TEXT",
      "UPDATE programs SET schedule_label = '2~11월 · 총 10회', sort_order = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-cooking'",
      "UPDATE programs SET schedule_label = '7월·9월 · 총 2회', sort_order = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-seasonal'",
      "UPDATE programs SET schedule_label = '4월·10월 · 총 2회', sort_order = 2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-outing'",
      "UPDATE programs SET name = '김장나눔활동', schedule_label = '11월 · 1회', sort_order = 3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-kimjang'",
      "UPDATE programs SET schedule_label = '2~12월 · 상시', sort_order = 10, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-casework'",
      "UPDATE programs SET schedule_label = '3월·9월 · 총 2회', sort_order = 11, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-kit'",
      "UPDATE programs SET name = '개별 심리상담', schedule_label = '2~11월 중 제공 · 예산상 1인 2회·총 20회', sort_order = 13, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-counseling'",
      "UPDATE programs SET is_public = 0, archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-meetup'",
      "UPDATE programs SET schedule_label = '2~6월 · 총 10회', sort_order = 20, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-career'",
      "UPDATE programs SET schedule_label = '7~10월 · 총 8회', sort_order = 21, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-craft'",
      "UPDATE programs SET name = '의사소통교육', schedule_label = '3~4월 · 총 4회', sort_order = 22, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-communication'",
      "UPDATE programs SET detail = '', schedule_label = '2월·9월 · 총 2회', sort_order = 30, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'in-case-conference'",
      "UPDATE programs SET schedule_label = '10월 · 1회', sort_order = 31, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'in-campaign'",
      "INSERT INTO programs (code, theme, name, detail, schedule_label, assign_mode, is_public, sort_order, created_at, updated_at) VALUES\n  ('link-selfhelp', 'L', '참여자 주도형 자조모임', '', '4·6·8·11월 · 총 4회', 'auto', 1, 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('open-group-counseling', 'O', '집단 심리상담', '', '2~11월 · 총 10회', 'manual', 1, 12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  ('in-evaluation', 'IN', '평가회', '', '12월 · 1회', 'internal', 1, 32, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\nON CONFLICT(code) DO NOTHING"
    ]
  }
];
