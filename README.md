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
migrations/              D1 스키마(0001)·프로그램 기본 목록(0002)·주소/생년월일(0003)·PIN 로그인(0004)·우편번호/상세 주소(0005)
.github/workflows/ci.yml  PR·main 테스트
src/
  app.js                 요청 처리(라우팅·세션·CSRF·보안 헤더)
  config.js, site.js     환경 변수 설정·기관 정보
  db/                    배포 후 자동 마이그레이션(migrate.js, migrations.generated.js)
  lib/                   D1 도우미, 세션, PIN 해시, Web Crypto, 전화번호 정규화, 자동 이스케이프 템플릿, 라우터
  services/              등록·선정, 로그인 시도 제한, 프로그램·회차, Link 자동 배정, Grow 신청, 출석, 감사기록
  como/                  꼬모 연동 어댑터 인터페이스, 전화번호 매핑
  routes/, views/        공개 · 참여자(/me) · 관리자(/admin) 영역
scripts/                 로컬 개발, 개발용 데이터, 관리자 생성, 원격 마이그레이션, 반응형 검수
test/                    자동 테스트
```

- 런타임 의존성은 없다(라우터·템플릿 자체 구현, Web Crypto 사용). 빌드 단계도 없다.
- 화면은 모두 서버(Functions)에서 렌더링한다. 클라이언트 JS는 주소 검색(등록·내 정보 화면)뿐이다.
- D1은 대화형 트랜잭션이 없으므로 여러 쓰기는 `batch`(원자적)로, 정원 확인 신청은 단일 조건부 SQL로 처리한다.

## Cloudflare Pages 설정

저장소에 `wrangler.toml`을 두지 않는다. 바인딩·변수는 대시보드에서 설정한다
(Pages 프로젝트에 `wrangler.toml`이 있으면 그 파일이 우선해 대시보드 바인딩을 쓸 수 없다).

1. **D1 생성**: Workers & Pages → D1 → Create → 이름 `login-db`. 생성 후 database ID를 확인한다.
2. **스키마**: 따로 적용할 필요 없음. 배포된 앱이 첫 요청에서 `migrations/`를 자동 적용한다(아래 '배포 흐름').
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
   | `CONSENT_JSON` | Text | 선택. 기본 동의문(`src/content/consent.js`) 대신 쓸 문안 JSON (`content/consent.example.json` 형식) |
   | `COMO_APPLY_URL` | Text | 선택. 기본 `https://cco-mho.pages.dev/` |
6. **재배포**(Deployments → Retry deployment). 바인딩·변수는 재배포 후 적용된다.
7. **관리자 계정**: 아래 '관리자 지정' 참고

### 로그인 방식: 휴대전화 번호 + PIN 6자리

- 참여 등록 때 연락처·이름·주소·생년월일·PIN을 한 번에 입력한다. 문자 인증은 쓰지 않는다.
- PIN은 `SESSION_SECRET`으로 HMAC한 값(솔트 포함)만 저장한다. **`SESSION_SECRET`을 바꾸면 모든 PIN을 재설정해야 한다.**
- 같은 숫자 반복·연속 숫자·생년월일·전화번호 뒷자리는 PIN으로 쓸 수 없다.
- 번호별 30분 내 5회 실패 시 잠금, IP별 1시간 내 30회 실패 시 차단. 실패 문구는 등록 여부와 무관하게 같다.
- **PIN 분실**: 관리자 → 참여자 상세 → `PIN 초기화` → 화면에 한 번 표시되는 임시 PIN을 본인 확인 후 전달 → 첫 로그인 때 새 PIN 설정(그 전에는 다른 화면 이용 불가).
- **연락처 확인**: 문자 인증이 없으므로 등록한 번호는 '미확인'이다. 선정 시(대면 초기상담 후) 자동으로 확인 처리되며, 번호를 바꾸면 다시 미확인이 된다(참여자 상세 → `연락처 확인`). 꼬모 매핑은 확인된 번호만 사용한다.

### 주소 입력

등록·내 정보 화면에서 카카오(다음) 우편번호 서비스로 도로명 주소를 검색한다(무료, 키 불필요). 우편번호·도로명 주소·상세 주소를 따로 저장한다.
검색 스크립트를 불러오지 못하면 검색 버튼은 숨겨지고 주소를 직접 입력한다. CSP는 `t1.daumcdn.net`·`t1.kakaocdn.net` 스크립트와 `postcode.map.daum.net`·`postcode.map.kakao.com` 검색 창만 허용한다.

### 관리자 지정

1. 사이트에서 관리자 본인 번호로 `참여 등록`(PIN 설정).
2. 대시보드 D1 콘솔(`login-db` → Console)에서 실행 (`npm run admin:create -- --phone 010XXXXXXXX`가 같은 SQL을 출력):
   ```sql
   UPDATE users SET role = 'manager', is_selected = 0 WHERE phone = '010XXXXXXXX';
   DELETE FROM registrations WHERE user_id = (SELECT id FROM users WHERE phone = '010XXXXXXXX');
   ```
   운영 담당은 `role = 'staff'`. 관리자 PIN 분실 시 다른 관리자가 없으면 같은 방식으로 다시 등록·지정한다.

`APP_ENV`를 지정하지 않으면 운영 모드다. 운영 모드에서 `SESSION_SECRET`이 없거나 `DB` 바인딩이 없으면 화면에 설정 오류 문구가 표시된다.

### 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `APP_ENV` | `production` | `development`는 로컬 전용(개발 표시) |
| `SESSION_SECRET` | (운영 필수) | 세션·PIN 해시 키. 바꾸면 모든 PIN 재설정 필요 |
| `COMO_ADAPTER` | `none` | `mock`은 개발 전용, 운영에서 사용 불가 |
| `COMO_MOCK_JSON` | - | 개발용 꼬모 모의 데이터 |
| `COMO_APPLY_URL` | `https://cco-mho.pages.dev/` | 상담신청하기 이동 주소 |
| `CONSENT_JSON` | - | 기본 동의문 대신 쓸 문안 |
| `SESSION_IDLE_DAYS` / `SESSION_MAX_DAYS` | 14 / 60 | 로그인 유지 기간 |

## 배포 흐름 (자동)

1. 변경은 브랜치 → PR로 올린다. GitHub Actions(`.github/workflows/ci.yml`)가 테스트(일반 + 로컬 D1)와 Functions 번들을 확인한다.
2. PR을 `main`에 머지하면 Cloudflare Pages Git 연동이 자동 배포한다.
3. 배포된 앱이 첫 요청에서 아직 적용되지 않은 D1 마이그레이션을 적용한다(`src/db/migrate.js`).
   - wrangler와 같은 `d1_migrations` 테이블을 쓰므로 CLI(`npm run db:migrate:remote`)와 섞어 써도 중복 적용되지 않는다.
   - 마이그레이션마다 기록과 함께 하나의 batch(트랜잭션)로 실행되고, 동시 요청이 있어도 한 번만 적용된다.
   - 실패하면 해당 마이그레이션 전체가 되돌려지고, 화면에 "데이터베이스 준비 중 오류"가 표시된다.
4. 마이그레이션을 추가할 때: `migrations/000N_설명.sql` 작성 → `npm run build:migrations` → 커밋.
   기존 버전 코드가 잠시 함께 돌 수 있으므로, 가능하면 컬럼 추가 위주로 작성하고 삭제는 다음 배포로 미룬다.

## 로컬 개발

```bash
npm install
npm run seed:dev   # 로컬 D1(.wrangler/state)에 마이그레이션 + 개발용 데이터, .dev.vars 생성
npm run dev        # wrangler pages dev (workerd + 로컬 D1) http://localhost:8788
```

개발용 데이터(PIN `135792`): 관리자 `01000000000`, 참여자 `01000000001`~`4`(4번은 미선정).

## 권한

| 영역 | 대상 | 내용 |
|---|---|---|
| 공개 `/` | 누구나 | 사업명, L/O/G·IN 프로그램 목록, 참여 등록. 꼬모 링크·상담 버튼 없음 |
| `/me` | 등록자 | 내 정보·번호·PIN 변경. 미선정이면 참여자 전용 기능 없음 |
| `/me/programs` 등 | 선정 참여자 | 나의 현황 4개 영역, Link 일정, Grow 신청, O 마음 → 전문 심리상담 → 상담신청하기 |
| `/admin` | staff | 프로그램·회차·출석·Grow 신청 관리, Link 배정. 전화번호는 가림 |
| `/admin` | manager | 위 + 접수·선정, 참여자 정보, 꼬모 매핑, 변경 기록 |

## 꼬모 연동 상태

- **확정·구현됨**: 상담 신청 경로(선정 확인 후 `COMO_APPLY_URL`로 이동, 전화번호 미전달), 전화번호 기준 매핑 정책과 충돌 처리.
- **미연결**: 상담 회차 자동 연동. 꼬모의 API·DB·관리자 권한이 제공되지 않아 실제 어댑터가 없다. 기본 상태(`COMO_ADAPTER=none`)에서 참여자 화면은 `연동 확인 필요`만 표시하고 회차 수치를 만들지 않는다.

연동 방식이 확인되면 `src/como/adapters.js`의 인터페이스(`findAccountsByPhone`, `getCounselingSummary`)를 구현한 어댑터를 추가하고 `config.js`의 `COMO_ADAPTER` 허용값에 등록한다. 필요한 반환값: 꼬모 계정 식별자, 완료 회차, 개인 총회차, (가능하면) 다음 상담 일정, 갱신 시각. 상담 내용·메모·진단은 받지 않는다.

매핑 규칙(`src/como/mapping.js`): 관리자가 확인한 번호만 사용 / 같은 번호에 꼬모 계정 여러 개, 이름 불일치, 이미 다른 사용자와 연결된 계정은 자동 연결하지 않고 관리자 확인 / 번호 변경 시 연결 해제·현황 삭제 후 재확인 / 연결 당시 번호와 현재 번호가 다르면 현황 미표시.

## 미확정 사항 (기관 확인 필요)

- 개인정보 수집·이용 동의문: 기본 문안(`src/content/consent.js`, 버전 `2026-10-07`) 사용 중. **보유 기간(사업 종료 후 5년)과 문의처는 기관 확인 필요.** 문안을 바꾸면 `version`도 바꾼다(동의 이력에 버전이 기록됨).
- 꼬모 회차 연동이 실제로 연결되면 꼬모 측에 전화번호를 보내 조회하게 되므로, 별도의 제3자 제공 동의가 필요한지 확인한다.
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
