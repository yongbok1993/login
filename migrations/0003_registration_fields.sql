-- 참여 등록 항목 변경: 거주 지역 → 주소, 생년월일 추가
ALTER TABLE users ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN birth_date TEXT;
UPDATE users SET address = region;
ALTER TABLE users DROP COLUMN region;
