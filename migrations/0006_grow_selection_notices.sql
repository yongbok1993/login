-- Grow: 참여자 희망 신청 → 관리자 선정. 선택 신청(source='select') 건만 사용한다.
-- pending(선정 대기) | selected(선정) | not_selected(미선정). 그 외 배정은 NULL(해당 없음).
ALTER TABLE enrollments ADD COLUMN selection TEXT;
ALTER TABLE enrollments ADD COLUMN decided_at TEXT;
-- 기존 선택 신청은 즉시 확정 방식이었으므로 선정으로 간주한다.
UPDATE enrollments SET selection = 'selected' WHERE source = 'select';

-- 공지: 전체 공개(public) 또는 선정 참여자만(participants)
CREATE TABLE notices (
  id         INTEGER PRIMARY KEY,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  audience   TEXT    NOT NULL CHECK (audience IN ('public', 'participants')),
  is_pinned  INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX notices_audience ON notices(audience, created_at);
