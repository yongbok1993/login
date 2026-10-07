-- 개정 사업계획서 9~11쪽 기준 프로그램 목록 (개발 인계서 5장). 표기는 디자인 시안 v1.3 기준.
-- 이미 있는 코드는 건드리지 않는다(관리자 수정 보존).
INSERT INTO programs (code, theme, name, detail, schedule_label, assign_mode, is_public, sort_order, created_at, updated_at) VALUES
  ('link-cooking', 'L', '요리교실', '', '2~11월 · 10회', 'auto', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('link-seasonal', 'L', '절기행사', '', '7월·9월 · 2회', 'auto', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('link-outing', 'L', '나들이', '', '4월·10월 · 2회', 'auto', 1, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('link-kimjang', 'L', '김장나눔활동', '', '6월·11월 · 2회', 'auto', 1, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('open-casework', 'O', '개별 사례관리', '', '2~12월 · 상시', 'manual', 1, 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('open-kit', 'O', '정서지원 키트', '', '3월·9월 · 2회', 'manual', 1, 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('open-counseling', 'O', '전문 심리상담', '', '2~11월 · 사업 운영 20회', 'external', 1, 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('open-meetup', 'O', '만남 및 교류활동', '', '2~12월 · 월 1회', 'manual', 1, 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('grow-career', 'G', '직업·적성 체험', '베이킹·쿠킹·바리스타 등', '2~6월 · 10회', 'select', 1, 8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('grow-craft', 'G', '공예 체험', '', '7~10월 · 8회', 'select', 1, 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('grow-communication', 'G', '의사소통 교육', '', '3~4월 · 4회', 'select', 1, 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('in-case-conference', 'IN', '통합사례회의', '기관 내부 운영', '2월·9월 · 2회', 'internal', 1, 11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('in-campaign', 'IN', '지역사회 인식개선 캠페인', '', '10월 · 1회', 'manual', 1, 12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(code) DO NOTHING;
