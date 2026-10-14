-- 2026-10 개편: 간소화 신청(이름·휴대전화 번호·비밀번호), 승인 참여자 10명 제한, 이용 중지, 비밀번호 재설정 코드,
-- 게시판(공지사항·자유게시판·질문과 답변), 신청서·동의서 양식 파일, 최신(2차 수정본) 사업계획 프로그램.
-- 영역: L 정서 지원 / O 관계망 형성 / G 나의 성장 / IN(화면 표기 iN) 지역사회 네트워크.
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

-- 신청서·동의서 양식 파일(기관 승인 양식을 담당자가 등록·교체). 파일이 없으면 화면에 '양식 준비 중'.
CREATE TABLE form_files (
  kind         TEXT    PRIMARY KEY CHECK (kind IN ('application', 'consent')),
  filename     TEXT    NOT NULL,
  content_type TEXT    NOT NULL,
  size         INTEGER NOT NULL,
  data         BLOB    NOT NULL,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TEXT    NOT NULL
);

-- 프로그램: 최신(2차 수정본) 사업계획. 계획에서 빠진 프로그램은 지우지 않고 보관(archived_at) 처리한다.
ALTER TABLE programs ADD COLUMN archived_at TEXT;

-- L 정서 지원
UPDATE programs SET theme = 'L', detail = '상담·모니터링을 통해 욕구를 확인하고 필요한 서비스와 자원을 연계합니다. 필요한 물품으로 구성한 키트 지원을 포함합니다.', schedule_label = '2~12월 · 상시', sort_order = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-casework';
UPDATE programs SET theme = 'L', name = '전문 심리상담', detail = '참여자의 상담 욕구와 정서 상태를 확인하고 전문기관과 연계하여 일대일 상담을 진행합니다.', schedule_label = '4~7월 · 총 8회·월 2회', sort_order = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'open-counseling';
-- O 관계망 형성
UPDATE programs SET theme = 'O', schedule_label = '2~11월 · 총 10회', sort_order = 10, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-cooking';
UPDATE programs SET theme = 'O', schedule_label = '7월·9월 · 총 2회', sort_order = 11, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-seasonal';
UPDATE programs SET theme = 'O', schedule_label = '4월·10월 · 총 2회', sort_order = 12, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-outing';
UPDATE programs SET theme = 'O', name = '김장나눔활동', schedule_label = '11월 · 1회', sort_order = 13, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'link-kimjang';
-- G 나의 성장
UPDATE programs SET detail = '', schedule_label = '2~6월 · 총 10회', sort_order = 20, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-career';
UPDATE programs SET name = '의사소통교육', schedule_label = '3~4월 · 총 4회', sort_order = 22, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'grow-communication';
-- iN 지역사회 네트워크
UPDATE programs SET detail = '유관기관과 전문가가 참여자의 복합적인 욕구를 함께 살피고 필요한 서비스와 지역자원을 연결합니다.', schedule_label = '2월·9월 · 총 2회', sort_order = 30, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'in-case-conference';
-- 최신 계획에서 빠진 프로그램: 만남 및 교류활동, 정서지원 키트(개별 사례관리에 포함), 공예 체험, 지역사회 인식개선 캠페인
UPDATE programs SET is_public = 0, archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE code IN ('open-meetup', 'open-kit', 'grow-craft', 'in-campaign');

INSERT INTO programs (code, theme, name, detail, schedule_label, assign_mode, is_public, sort_order, created_at, updated_at) VALUES
  ('link-selfhelp', 'O', '참여자 주도형 자조모임', '', '4·6·8·10월 · 총 4회', 'auto', 1, 14, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('grow-custom', 'G', '맞춤형 체험 활동', '초기상담과 프로그램 참여 과정에서 확인한 욕구·관심 분야를 바탕으로 참여자 의견을 수렴하여 활동을 선정합니다.', '7~10월 · 총 8회', 'select', 1, 21, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('in-evaluation', 'IN', '평가회', '참여자와 유관기관 관계자가 사업 운영 결과와 참여 경험을 함께 돌아봅니다.', '12월 · 1회', 'manual', 1, 31, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(code) DO NOTHING;
