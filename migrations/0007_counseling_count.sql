-- 마음(O) 전문 심리상담 운영 계획: 사업 운영 20회 → 10회
-- 관리자가 이미 다른 값으로 고쳤다면 덮어쓰지 않는다.
UPDATE programs SET schedule_label = '2~11월 · 사업 운영 10회', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE code = 'open-counseling' AND schedule_label = '2~11월 · 사업 운영 20회';
