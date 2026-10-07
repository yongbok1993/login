# 로그人 (LOGIN : 人)

용인종합사회복지관 북한이탈주민 지원사업 웹사이트. 개발 인계서(2026-10-07)를 기능 기준으로, 디자인 시안 v1.3을 시각 기준으로 구현했다.

## 구성

| 항목 | 선택 | 근거 |
|---|---|---|
| 서버 | Node.js(20+) + Express 5 | 호스팅이 정해지지 않아 어디서나 단일 프로세스로 실행 가능 |
| 화면 | 서버 렌더링 HTML, 클라이언트 JS 없음 | 권한 검사를 모두 서버에서 처리, CSP `script-src 'none'` |
| 데이터 | SQLite(better-sqlite3) | 파일 하나로 백업 가능. 표준 SQL이라 Postgres·Cloudflare D1 이전이 쉬움 |
| 인증 | 전화번호 인증번호 + DB 세션(httpOnly 쿠키) | 마지막 사용 후 14일 유지(최대 60일), 프로그램마다 재인증 없음 |

```
src/
  app.js, server.js, config.js, site.js   앱 구성·설정·기관 정보
  db/            스키마, 프로그램 기본 목록(개정 사업계획서 기준)
  lib/           세션·CSRF, 전화번호 정규화, 자동 이스케이프 템플릿
  services/      등록·선정, 프로그램·회차, Link 자동 배정, Grow 신청, 출석, 인증번호, 감사기록
  como/          꼬모 연동 어댑터 인터페이스, 전화번호 매핑
  sms/           문자 발송 어댑터
  routes/, views/  공개 · 참여자(/me) · 관리자(/admin) 영역
public/styles.css
scripts/         관리자 계정 생성, 개발용 데이터, 반응형 검수
test/            자동 테스트
```

## 실행

```bash
npm install
npm run seed:dev                 # 개발용 테스트 데이터(운영에서 실행 불가)
COMO_ADAPTER=mock npm run dev    # http://localhost:3000
```

개발 환경에서는 문자가 실제로 발송되지 않고 인증번호가 화면(노란 '개발용' 표시)과 서버 로그에 나온다.
개발용 데이터: 관리자 `01000000000`, 참여자 `01000000001`~`4`(4번은 미선정).

### 운영

```bash
NODE_ENV=production SESSION_SECRET=<32자 이상> DATABASE_PATH=/var/lib/login/login.db \
  CONSENT_FILE=/etc/login/consent.json TRUST_PROXY=1 npm start
npm run admin:create -- --phone 010XXXXXXXX --name 이름 --role manager   # 또는 staff
```

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SESSION_SECRET` | (운영 필수) | 세션·인증번호 해시 키 |
| `DATABASE_PATH` | `data/login.db` | SQLite 파일 |
| `SMS_PROVIDER` | 운영 `none` / 개발 `console` | 운영에서 `console` 사용 불가 |
| `COMO_ADAPTER` | `none` | `mock`은 개발 전용, 운영에서 사용 불가 |
| `COMO_APPLY_URL` | `https://cco-mho.pages.dev/` | 상담신청하기 이동 주소 |
| `CONSENT_FILE` | `content/consent.json` | 기관 확정 동의문. 형식: `content/consent.example.json` |
| `TRUST_PROXY` | - | 리버스 프록시 뒤에서 `1` |

운영에서 동의문 파일이 없으면 참여 등록 화면은 "등록 준비 중입니다."만 표시한다.

## 권한

| 영역 | 대상 | 내용 |
|---|---|---|
| 공개 `/` | 누구나 | 사업명, L/O/G·IN 프로그램 목록, 참여 등록. 꼬모 링크·상담 버튼 없음 |
| `/me` | 등록자 | 내 정보·번호 변경. 미선정이면 참여자 전용 기능 없음 |
| `/me/programs` 등 | 선정 참여자 | 나의 현황 4개 영역, Link 일정, Grow 신청, O 마음 → 전문 심리상담 → 상담신청하기 |
| `/admin` | staff | 프로그램·회차·출석·Grow 신청 관리, Link 배정. 전화번호는 가림 |
| `/admin` | manager | 위 + 접수·선정, 참여자 정보, 꼬모 매핑, 변경 기록 |

## 꼬모 연동 상태

- **확정·구현됨**: 상담 신청 경로(선정 확인 후 `COMO_APPLY_URL`로 이동, 전화번호 미전달), 전화번호 기준 매핑 정책과 충돌 처리.
- **미연결**: 상담 회차 자동 연동. 꼬모의 API·DB·관리자 권한이 제공되지 않아 실제 어댑터가 없다. 기본 상태(`COMO_ADAPTER=none`)에서 참여자 화면은 `연동 확인 필요`만 표시하고 회차 수치를 만들지 않는다.

연동 방식이 확인되면 `src/como/adapters.js`의 인터페이스(`findAccountsByPhone`, `getCounselingSummary`)를 구현한 어댑터를 추가하고 `config.js`의 `COMO_ADAPTER` 허용값에 등록한다. 필요한 반환값: 꼬모 계정 식별자, 완료 회차, 개인 총회차, (가능하면) 다음 상담 일정, 갱신 시각. 상담 내용·메모·진단은 받지 않는다.

매핑 규칙(`src/como/mapping.js`): 인증된 번호만 사용 / 같은 번호에 꼬모 계정 여러 개, 이름 불일치, 이미 다른 사용자와 연결된 계정은 자동 연결하지 않고 관리자 확인 / 번호 변경 시 연결 해제·현황 삭제 후 재확인 / 연결 당시 번호와 현재 번호가 다르면 현황 미표시.

## 미확정 사항 (기관 확인 필요)

- 문자 발송 서비스·비용 → `src/sms/`에 어댑터 추가 전까지 운영에서 인증번호를 보낼 수 없다.
- 동의문·보관기간·개인정보보호책임자 → `CONSENT_FILE`.
- 꼬모 연동 인터페이스·통합 로그인 지원 여부.
- 오픈채팅 URL(미제공, 링크 없음), 공지 기능(범위 외).
- 프로그램별 실제 날짜·시간·장소·정원(관리자 화면에서 입력, 비어 있으면 '일정 미정').
- Grow 정원·마감·취소 정책(회차별 정원·마감, 프로그램별 본인 취소 허용 설정으로 제공).
- 기관 주소·전화(`src/site.js`, 시안 푸터 기준) 배포 전 재확인.
- 호스팅·도메인.

## 테스트

```bash
npm test             # 기능·권한·꼬모 매핑 테스트
npm run test:layout  # 320·360·390·430·768·1024·1280px 가로 넘침·터치 영역 검사(Chromium 필요)
```
