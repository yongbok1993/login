-- 도로명 주소 검색(카카오 우편번호 서비스) 도입: 우편번호·상세 주소 분리
ALTER TABLE users ADD COLUMN postcode TEXT;
ALTER TABLE users ADD COLUMN address_detail TEXT NOT NULL DEFAULT '';
