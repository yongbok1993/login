-- 로그人 데이터 구조 (인계서 10장 기준)
-- 시각 컬럼은 UTC ISO 문자열, 회차 날짜(date)는 한국 시간 기준 YYYY-MM-DD.

-- 사용자: 참여자와 관리자 공통. 전화번호는 인증된 번호만 저장하며 계정당 하나.
CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  name              TEXT    NOT NULL,
  phone             TEXT    NOT NULL UNIQUE,
  phone_verified_at TEXT    NOT NULL,
  region            TEXT    NOT NULL DEFAULT '',
  role              TEXT    NOT NULL DEFAULT 'participant'
                    CHECK (role IN ('participant', 'staff', 'manager')),
  is_selected       INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  selected_at       TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

-- 최초 등록 접수: 사용자당 1건. internal_status는 관리자 화면에서만 사용한다.
CREATE TABLE registrations (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  registered_at   TEXT    NOT NULL,
  internal_status TEXT    NOT NULL DEFAULT 'received'
                  CHECK (internal_status IN ('received', 'reviewing', 'selected', 'not_selected', 'released')),
  updated_at      TEXT    NOT NULL
);

-- 동의 이력
CREATE TABLE consents (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      TEXT    NOT NULL,
  agreed       INTEGER NOT NULL CHECK (agreed IN (0, 1)),
  doc_version  TEXT    NOT NULL,
  agreed_at    TEXT    NOT NULL,
  withdrawn_at TEXT
);
CREATE INDEX consents_user ON consents(user_id);

-- 프로그램
-- assign_mode: auto(Link 전체 자동 배정) / select(Grow 선택 신청) / manual(관리자 배정)
--              internal(기관 내부 운영, 개인 일정 미노출) / external(꼬모에서 접수)
CREATE TABLE programs (
  id             INTEGER PRIMARY KEY,
  code           TEXT    UNIQUE,
  theme          TEXT    NOT NULL CHECK (theme IN ('L', 'O', 'G', 'IN')),
  name           TEXT    NOT NULL,
  detail         TEXT    NOT NULL DEFAULT '',
  schedule_label TEXT    NOT NULL DEFAULT '',
  assign_mode    TEXT    NOT NULL CHECK (assign_mode IN ('auto', 'select', 'manual', 'internal', 'external')),
  is_public      INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  self_cancel    INTEGER NOT NULL DEFAULT 0 CHECK (self_cancel IN (0, 1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

-- 회차: 날짜·시간·장소·정원은 확정 전까지 비워 둔다(NULL).
CREATE TABLE program_sessions (
  id           INTEGER PRIMARY KEY,
  program_id   INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  round_no     INTEGER,
  date         TEXT,
  start_time   TEXT,
  end_time     TEXT,
  place        TEXT,
  capacity     INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  is_closed    INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
  is_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (is_cancelled IN (0, 1)),
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX program_sessions_program ON program_sessions(program_id);

-- 참여·신청: 사용자+회차 1건으로 제한(중복 배정·신청 방지).
-- 자동 배정과 신청은 참여 완료가 아니다. 참여 완료는 attendance에만 기록한다.
CREATE TABLE enrollments (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    INTEGER NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL CHECK (source IN ('auto', 'select', 'manual')),
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason TEXT    CHECK (cancel_reason IS NULL OR cancel_reason IN ('self', 'admin', 'deselected')),
  created_at    TEXT    NOT NULL,
  cancelled_at  TEXT,
  UNIQUE (user_id, session_id)
);
CREATE INDEX enrollments_session ON enrollments(session_id);

-- 출석
CREATE TABLE attendance (
  enrollment_id INTEGER PRIMARY KEY REFERENCES enrollments(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL CHECK (status IN ('attended', 'absent')),
  recorded_by   INTEGER REFERENCES users(id),
  recorded_at   TEXT    NOT NULL
);

-- 꼬모 계정 연결: 내부 사용자 식별자 기준. 전화번호는 연결 당시 값을 함께 보관해 변경을 감지한다.
CREATE TABLE como_links (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL
                CHECK (status IN ('linked', 'not_found', 'conflict', 'needs_recheck', 'error')),
  external_id   TEXT    UNIQUE,
  phone_at_link TEXT,
  candidates    TEXT,
  detail        TEXT,
  checked_at    TEXT    NOT NULL,
  linked_at     TEXT
);

-- 상담 현황: 회차 정보만 보관한다. 상담 내용·메모·진단은 저장하지 않는다.
CREATE TABLE como_status (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  external_id        TEXT    NOT NULL,
  total_sessions     INTEGER,
  completed_sessions INTEGER NOT NULL,
  next_at            TEXT,
  source             TEXT    NOT NULL CHECK (source IN ('live', 'mock')),
  remote_updated_at  TEXT,
  synced_at          TEXT    NOT NULL
);

CREATE TABLE como_sync_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT    NOT NULL,
  result     TEXT    NOT NULL,
  message    TEXT,
  created_at TEXT    NOT NULL
);

-- 관리자 감사기록
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL,
  target_id   INTEGER,
  detail      TEXT,
  created_at  TEXT    NOT NULL
);

-- 로그인 세션: 토큰 원문은 저장하지 않고 해시만 저장한다.
CREATE TABLE auth_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  csrf         TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

-- 전화번호 인증번호: 해시만 저장한다.
CREATE TABLE otp_codes (
  id          INTEGER PRIMARY KEY,
  phone       TEXT    NOT NULL,
  purpose     TEXT    NOT NULL,
  code_hash   TEXT    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  ip          TEXT,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  consumed_at TEXT
);
CREATE INDEX otp_codes_phone ON otp_codes(phone, created_at);
CREATE INDEX otp_codes_ip ON otp_codes(ip, created_at);
