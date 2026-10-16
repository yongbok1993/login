// 기관 정보: 디자인 시안 v1.3 푸터 기준. 배포 전 기관에 재확인한다.
export const SITE = {
  // 사이트 공식 브랜드: LOGIN(영문 대문자) + ' : ' + 人(한자). 기능 버튼의 '로그인'과는 다르다.
  serviceName: 'LOGIN : 人',
  // 스타일 파일을 바꾸면 올려서 브라우저가 새 CSS를 받게 한다
  assetVersion: '20261016-3',
  orgName: '용인종합사회복지관',
  // 이 누리집이 쓰이는 사업(사회복지공동모금회 2026년 기획). 첫 화면·제목·검색 정보·하단에 표시한다.
  // '네 가지 영역' 제목 옆 안내 문구(상담 웹사이트 개발 중)
  lightNote: '🚧MHCP(Mental-Health Counseling Program) 웹사이트 개발중🚧',
  programLabel: '사회복지공동모금회 2026년 기획 ‘북한이탈주민 지원사업’',
  projectName: '북한이탈주민의 정서적 안정 및 사회통합을 위한 지역사회 관계망 강화사업',
  address: '경기도 용인시 처인구 이동읍 이원로 69-8',
  tel: '031-334-9966',
};

// 영역 순서: L : Light / O : Organization / G : Grow / iN : Network
// DB의 theme 값은 L·O·G·IN(내부 키). 화면의 네 번째 기호는 소문자 i + 대문자 N인 'iN'(N 강조, layout.themeMark).
export const THEMES = {
  L: { key: 'l', letter: 'L', ko: '정서 지원', en: 'Light',
    desc: '마음을 돌보고 필요한 도움과 연결하며 안정적인 일상을 지원합니다.' },
  O: { key: 'o', letter: 'O', ko: '관계망 형성', en: 'Organization',
    desc: '함께 만나고 활동하며 서로를 지지하는 관계를 만들어 갑니다.' },
  G: { key: 'g', letter: 'G', ko: '나의 성장', en: 'Grow',
    desc: '관심과 욕구에 맞는 경험과 배움을 통해 새로운 가능성을 탐색합니다.' },
  IN: { key: 'in', letter: 'iN', ko: '지역사회 네트워크', en: 'Network',
    desc: '복지관과 지역사회 기관·자원을 연결하여 필요한 도움과 지속적인 관계를 이어갑니다.' },
};

export const THEME_ORDER = ['L', 'O', 'G', 'IN'];
