-- 관리자(운영 담당·전체 관리자) 로그인: 아이디 + 비밀번호. 참여자는 계속 휴대전화 번호 + PIN.
ALTER TABLE users ADD COLUMN login_id TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_must_change INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_updated_at TEXT;
CREATE UNIQUE INDEX users_login_id ON users(login_id);
