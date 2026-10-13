-- 2026-10 개편: 간소화 신청(이름·휴대전화 번호·비밀번호), 승인 참여자 10명 제한, 이용 중지, 비밀번호 재설정 코드,
-- 게시판(공지사항·자유게시판·질문과 답변), 최종 사업계획 프로그램 표기.
-- 기존 데이터(주소·생년월일·PIN·공지 등)는 지우지 않는다.

-- 이용 상태: active(이용 가능) | suspended(이용 중지). 승인 여부는 기존 users.is_selected를 쓴다.
ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended'));

-- 승인된 참여자(이용 중) 최대 10명. 관리자 계정은 세지 않는다. 동시에 승인해도 DB에서 막는다.
CREATE TRIGGER participants_cap_update BEFORE UPDATE ON users
WHEN NEW.role = 'participant' AND NEW.is_selected = 1 AND NEW.account_status = 'active'
  AND NOT (OLD.role = 'participant' AND OLD.is_selected = 1 AND OLD.account_status = 'active')
  AND (SELECT COUNT(*) FROM users WHERE role = 'participant' AND is_selected = 1 AND account_status = 'active') >= 10
BEGIN SELECT RAISE(ABORT, 'participant_cap'); END;

CREATE TRIGGER participants_cap_insert BEFORE INSERT ON users
WHEN NEW.role = 'participant' AND NEW.is_selected = 1 AND NEW.account_status = 'active'
  AND (SELECT COUNT(*) FROM users WHERE role = 'participant' AND is_selected = 1 AND account_status = 'active') >= 10
BEGIN SELECT RAISE(ABORT, 'participant_cap'); END;

-- 접수 순서: 최초 신청 시각(서버 기록) → 접수번호(registrations.id)
CREATE INDEX registrations_order ON registrations(registered_at, id);

-- 비밀번호 재설정 코드: 담당자가 본인 확인 후 발급, 해시만 저장, 1회용·유효기간
CREATE TABLE password_resets (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT    NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  used_at    TEXT
);
CREATE INDEX password_resets_user ON password_resets(user_id, created_at);

-- 게시판
CREATE TABLE posts (
  id          INTEGER PRIMARY KEY,
  board       TEXT    NOT NULL CHECK (board IN ('notice', 'free', 'qna')),
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  visibility  TEXT    NOT NULL DEFAULT 'members' CHECK (visibility IN ('members', 'private')),
  answer_body TEXT,
  answer_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  answered_at TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX posts_board ON posts(board, is_pinned, created_at);
CREATE INDEX posts_author ON posts(author_id);

CREATE TABLE post_comments (
  id         INTEGER PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX post_comments_post ON post_comments(post_id, created_at);

-- 기존 공지를 공지사항 게시판으로 복사(원본 notices 테이블은 그대로 둔다)
INSERT INTO posts (board, title, body, author_id, is_pinned, visibility, created_at, updated_at)
SELECT 'notice', title, body, created_by, is_pinned, 'members', created_at, updated_at FROM notices ORDER BY id;

-- 프로그램: 최종 사업계획 표기. 지난 계획의 프로그램은 지우지 않고 보관(archived_at) 처리한다.
ALTER TABLE programs ADD COLUMN archived_at TEXT;

UPDATE programs SET schedule_label = '2~11월 · 총 10회', sort_order = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-cooking';
UPDATE programs SET schedule_label = '7월·9월 · 총 2회', sort_order = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-seasonal';
UPDATE programs SET schedule_label = '4월·10월 · 총 2회', sort_order = 2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-outing';
UPDATE programs SET name = '김장나눔활동', schedule_label = '11월 · 1회', sort_order = 3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-kimjang';
UPDATE programs SET schedule_label = '2~12월 · 상시', sort_order = 10, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-casework';
UPDATE programs SET schedule_label = '3월·9월 · 총 2회', sort_order = 11, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-kit';
UPDATE programs SET name = '개별 심리상담', schedule_label = '2~11월 중 제공 · 예산상 1인 2회·총 20회', sort_order = 13, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-counseling';
UPDATE programs SET is_public = 0, archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-meetup';
UPDATE programs SET schedule_label = '2~6월 · 총 10회', sort_order = 20, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-career';
UPDATE programs SET schedule_label = '7~10월 · 총 8회', sort_order = 21, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-craft';
UPDATE programs SET name = '의사소통교육', schedule_label = '3~4월 · 총 4회', sort_order = 22, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-communication';
UPDATE programs SET detail = '', schedule_label = '2월·9월 · 총 2회', sort_order = 30, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'in-case-conference';
UPDATE programs SET schedule_label = '10월 · 1회', sort_order = 31, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'in-campaign';

INSERT INTO programs (code, theme, name, detail, schedule_label, assign_mode, is_public, sort_order, created_at, updated_at) VALUES
  ('link-selfhelp', 'L', '참여자 주도형 자조모임', '', '4·6·8·11월 · 총 4회', 'auto', 1, 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('open-group-counseling', 'O', '집단 심리상담', '', '2~11월 · 총 10회', 'manual', 1, 12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('in-evaluation', 'IN', '평가회', '', '12월 · 1회', 'internal', 1, 32, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(code) DO NOTHING;
