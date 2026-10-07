// 개발 인계서 5장(개정 사업계획서 9~11쪽) 기준. 표시 문구는 디자인 시안 v1.3 표기를 따른다.
export const PROGRAM_SEED = [
  // L: 관계 — Link (선정 시 전체 자동 배정)
  { code: 'link-cooking',  theme: 'L', name: '요리교실',     schedule_label: '2~11월 · 10회',  assign_mode: 'auto' },
  { code: 'link-seasonal', theme: 'L', name: '절기행사',     schedule_label: '7월·9월 · 2회',  assign_mode: 'auto' },
  { code: 'link-outing',   theme: 'L', name: '나들이',       schedule_label: '4월·10월 · 2회', assign_mode: 'auto' },
  { code: 'link-kimjang',  theme: 'L', name: '김장나눔활동', schedule_label: '6월·11월 · 2회', assign_mode: 'auto' },

  // O: 마음 — Open
  { code: 'open-casework',   theme: 'O', name: '개별 사례관리',   schedule_label: '2~12월 · 상시',          assign_mode: 'manual' },
  { code: 'open-kit',        theme: 'O', name: '정서지원 키트',   schedule_label: '3월·9월 · 2회',          assign_mode: 'manual' },
  { code: 'open-counseling', theme: 'O', name: '전문 심리상담',   schedule_label: '2~11월 · 사업 운영 20회', assign_mode: 'external' },
  { code: 'open-meetup',     theme: 'O', name: '만남 및 교류활동', schedule_label: '2~12월 · 월 1회',        assign_mode: 'manual' },

  // G: 성장 — Grow (희망 프로그램 선택 신청)
  { code: 'grow-career',        theme: 'G', name: '직업·적성 체험', detail: '베이킹·쿠킹·바리스타 등', schedule_label: '2~6월 · 10회', assign_mode: 'select' },
  { code: 'grow-craft',         theme: 'G', name: '공예 체험',      schedule_label: '7~10월 · 8회', assign_mode: 'select' },
  { code: 'grow-communication', theme: 'G', name: '의사소통 교육',  schedule_label: '3~4월 · 4회',  assign_mode: 'select' },

  // IN: 지역사회 네트워크 (개인 테마 아님)
  { code: 'in-case-conference', theme: 'IN', name: '통합사례회의',            detail: '기관 내부 운영', schedule_label: '2월·9월 · 2회', assign_mode: 'internal' },
  { code: 'in-campaign',        theme: 'IN', name: '지역사회 인식개선 캠페인', schedule_label: '10월 · 1회',  assign_mode: 'manual' },
];
