// 기관 정보: 디자인 시안 v1.3 푸터 기준. 배포 전 기관에 재확인한다.
export const SITE = {
  serviceName: 'LOG人',
  // 보조 표기
  serviceSub: 'LOGIN : 人',
  orgName: '용인종합사회복지관',
  projectName: '북한이탈주민의 정서적 안정 및 사회통합을 위한 지역사회 관계망 강화사업',
  address: '경기도 용인시 처인구 이동읍 이원로 69-8',
  tel: '031-334-9966',
};

// 영역 순서: L : Light / O : Open / G : Grow / IN : Network
// short: 첫 화면 짧은 소개의 한글 이름, title: 카드 제목
export const THEMES = {
  L: { key: 'l', letter: 'L', ko: '관계', short: '관계', title: '관계', en: 'Light' },
  O: { key: 'o', letter: 'O', ko: '마음', short: '마음', title: '마음', en: 'Open' },
  G: { key: 'g', letter: 'G', ko: '성장', short: '성장', title: '성장', en: 'Grow' },
  IN: { key: 'in', letter: 'IN', ko: '지역사회 네트워크', short: '지역사회', title: '지역사회 네트워크', en: 'Network' },
};

export const THEME_ORDER = ['L', 'O', 'G', 'IN'];
