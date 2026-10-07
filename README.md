# 로그人 (LOGIN : 人)

용인종합사회복지관 북한이탈주민 지원사업 웹사이트. 개발 인계서(2026-10-07)를 기능 기준으로, 디자인 시안 v1.3을 시각 기준으로 구현했다.
**Cloudflare Pages + Pages Functions + D1**에서 실행된다.

## 구조

```
public/                  Pages 정적 출력 디렉터리 (build output directory)
  static/styles.css      스타일
  _routes.json           /static/* 은 정적 파일, 나머지는 Functions
functions/
  [[path]].js            Pages Functions 진입점(모든 경로) → src/app.js
migrations/              D1 스키마(0001)·프로그램 기본 목록(0002)
src/
  app.js                 요청 처리(라우팅·세션·CSRF·보안 헤더)
  config.js, site.js     환경 변수 설정·기관 정보
  lib/                   D1 도우미, 세션, Web Crypto, 전화번호 정규화, 자동 이스케이프 템플릿, 라우터
  services/              등록·선정, 프로그램·회차, Link 자동 배정, Grow 신청, 출석, 인증번호, 감사기록
  como/                  꼬모 연동 어댑터 인터페이스, 전화번호 매핑
  sms/                   문자 발송 어댑터
  routes/, views/        공개 · 참여자(/me) · 관리자(/admin) 영역
scripts/                 로컬 개발, 개발용 데이터, 관리자 생성, 원격 마이그레이션, 반응형 검수
test/                    자동 테스트
```

- 런타임 의존성은 없다(라우터·템플릿 자체 구현, Web Crypto 사용). 빌드 단계도 없다.
- 화면은 모두 서버(Functions)에서 렌더링하고 클라이언트 JS는 없다(CSP `script-src 'none'`).
- D1은 대화형 트랜잭션이 없으므로 여러 쓰기는 `batch`(원자적)로, 정원 확인 신청은 단일 조건부 SQL로 처리한다.

## Cloudflare Pages 설정

저장소에 `wrangler.toml`을 두지 않는다. 바인딩·변수는 대시보드에서 설정한다
(Pages 프로젝트에 `wrangler.toml`이 있으면 그 파일이 우선해 대시보드 바인딩을 쓸 수 없다).

1. **D1 생성**: Workers & Pages → D1 → Create → 이름 `login-db`. 생성 후 database ID를 확인한다.
2. **스키마 적용**(로컬 PC에서, `npx wrangler login` 후):
   ```bash
   npm install
   npm run db:migrate:remote -- --id <database ID>
   ```
3. **Pages 프로젝트 → Settings → Build**
   | 항목 | 값 |
   |---|---|
   | Framework preset | None |
   | Build command | (비움) |
   | Build output directory | `public` |
   | Root directory | (비움, 저장소 루트) |
   | Build variable | `SKIP_DEPENDENCY_INSTALL` = `1` (런타임 의존성이 없어 설치 불필요. 개발용 패키지 설치로 빌드가 느려지거나 실패하는 것을 막는다) |
4. **Settings → Bindings → Add → D1 database**: Variable name **`DB`**, 데이터베이스 `login-db`.
5. **Settings → Variables and Secrets** (Production)
   | 이름 | 종류 | 값 |
   |---|---|---|
   | `SESSION_SECRET` | Secret | 32자 이상 무작위 문자열 (예: `openssl rand -base64 48`) |
   | `CONSENT_JSON` | Secret 또는 Text | 기관 확정 동의문 JSON (`content/consent.example.json` 형식). 없으면 등록 화면은 "등록 준비 중입니다." |
   | `COMO_APPLY_URL` | Text | 선택. 기본 `https://cco-mho.pages.dev/` |
6. **재배포**(Deployments → Retry deployment). 바인딩·변수는 재배포 후 적용된다.
7. **관리자 계정**: `npm run admin:create -- --phone 010XXXXXXXX --name 이름 --remote` (또는 출력되는 SQL을 대시보드 D1 콘솔에서 실행)

`APP_ENV`를 지정하지 않으면 운영 모드다. 운영 모드에서 `SESSION_SECRET`이 없거나 `DB` 바인딩이 없으면 화면에 설정 오류 문구가 표시된다.

### 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `APP_ENV` | `production` | `development`는 로컬 전용(개발 표시, 화면 인증번호) |
| `SESSION_SECRET` | (운영 필수) | 인증번호 해시 키 |
| `SMS_PROVIDER` | 운영 `none` / 개발 `console` | 운영에서 `console` 사용 불가 |
| `COMO_ADAPTER` | `none` | `mock`은 개발 전용, 운영에서 사용 불가 |
| `COMO_MOCK_JSON` | - | 개발용 꼬모 모의 데이터 |
| `COMO_APPLY_URL` | `https://cco-mho.pages.dev/` | 상담신청하기 이동 주소 |
| `CONSENT_JSON` | - | 기관 확정 동의문 |
| `SESSION_IDLE_DAYS` / `SESSION_MAX_DAYS` | 14 / 60 | 로그인 유지 기간 |

## 로컬 개발

```bash
npm install
npm run seed:dev   # 로컬 D1(.wrangler/state)에 마이그레이션 + 개발용 데이터, .dev.vars 생성
npm run dev        # wrangler pages dev (workerd + 로컬 D1) http://localhost:8788
```

개발 모드에서는 문자가 발송되지 않고 인증번호가 화면(노란 '개발용' 표시)과 로그에 나온다.
개발용 데이터: 관리자 `01000000000`, 참여자 `01000000001`~`4`(4번은 미선정).

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

- 문자 발송 서비스·비용 → `src/sms/`에 어댑터 추가 전까지 운영에서 인증번호를 보낼 수 없다(로그인·등록 불가).
- 동의문·보관기간·개인정보보호책임자 → `CONSENT_JSON`.
- 꼬모 연동 인터페이스·통합 로그인 지원 여부.
- 오픈채팅 URL(미제공, 링크 없음), 공지 기능(범위 외).
- 프로그램별 실제 날짜·시간·장소·정원(관리자 화면에서 입력, 비어 있으면 '일정 미정').
- Grow 정원·마감·취소 정책(회차별 정원·마감, 프로그램별 본인 취소 허용 설정으로 제공).
- 기관 주소·전화(`src/site.js`, 시안 푸터 기준) 배포 전 재확인.
- 도메인(현재 `login-cpn.pages.dev`).

## 테스트

```bash
npm test             # 기능·권한·꼬모 매핑 테스트 (D1 호환 SQLite, 빠름)
npm run test:d1      # 같은 테스트를 wrangler 로컬 D1(workerd)에서 실행
npm run test:layout  # wrangler pages dev 위에서 320~1280px 가로 넘침·터치 영역 검사(Chromium 필요)
```
