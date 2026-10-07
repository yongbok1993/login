-- 문자 인증 폐지: 휴대전화 번호 + PIN 6자리 로그인으로 전환
-- phone_verified_at은 이제 '번호 입력 시각'이며, 관리자 확인 여부는 phone_confirmed_at으로 판단한다.
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN pin_must_change INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pin_updated_at TEXT;
-- 관리자가 본인·연락처를 확인한 시각(선정 시 또는 '연락처 확인'). 꼬모 매핑은 확인된 번호만 사용한다.
ALTER TABLE users ADD COLUMN phone_confirmed_at TEXT;
DROP TABLE otp_codes;
-- 로그인·등록 시도 기록(잠금·속도 제한용). 하루 지나면 정리한다.
CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY,
  kind       TEXT    NOT NULL CHECK (kind IN ('login', 'register', 'pin')),
  phone      TEXT,
  ip         TEXT,
  success    INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at TEXT    NOT NULL
);
CREATE INDEX login_attempts_phone ON login_attempts(phone, created_at);
CREATE INDEX login_attempts_ip ON login_attempts(ip, created_at);
