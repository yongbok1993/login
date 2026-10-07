import assert from 'node:assert/strict';
import test from 'node:test';
import { autoAssignLink } from '../src/services/enrollments.js';
import { addManager, addParticipant, addSession, startApp, TEST_PIN } from './helpers.js';

const BANNED = [
  '온라인에서 이야기가 시작되고', '사람과 사람의 관계에 로그인합니다', '등록은 한 번이면 충분합니다', '그다음은 로그인만',
  '관계에서 시작해, 마음을 돌보고', '정기적인 만남과 교류로 관계망을 형성하는', '마음의 짐을 혼자 지지 않도록',
  '원하는 활동을 직접 골라 체험하고', '상태가 아니라 내 일정이 보입니다',
];

test('공개 홈: L/O/G 목록, 꼬모·상담 버튼·참여 절차·시안 설명·삭제 문구 없음', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const r = await app.client().get('/');
  assert.equal(r.status, 200);
  for (const name of ['요리교실', '절기행사', '나들이', '김장나눔활동', '개별 사례관리', '정서지원 키트', '전문 심리상담',
    '만남 및 교류활동', '직업·적성 체험', '공예 체험', '의사소통 교육']) {
    assert.ok(r.text.includes(name), name);
  }
  assert.ok(r.text.includes('참여 등록'));
  for (const bad of ['cco-mho', '상담신청하기', '참여 절차', '선정 시 전체 자동 참여', '지역사회 네트워크', '통합사례회의',
    '인식개선 캠페인', '디자인 기준', '로그인 화면 예시', '절기문화활동', '원예', '나의 강점 찾기',
    '<img', 'cloudflareinsights', ...BANNED]) {
    assert.ok(!r.text.includes(bad), `공개 홈에 "${bad}" 노출`);
  }
  assert.match(r.headers.get('content-security-policy'), /script-src 'none'/);
});

const REG = { name: '홍길동', phone: '010-1111-2222', address: '경기도 용인시 처인구 테스트로 1', birth_date: '1970.3.5',
  pin: '258147', pin_confirm: '258147', consent: 'privacy' };

test('최초 등록: 한 화면에서 연락처·이름·주소·생년월일·PIN → 계정 연결, 같은 번호 재등록 불가', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const c = app.client();
  let r = await c.get('/register');
  for (const id of ['name', 'phone', 'address', 'birth_date', 'pin', 'pin_confirm']) assert.match(r.text, new RegExp(`id="${id}"`), id);
  assert.ok(!/인증번호/.test(r.text));

  r = await c.post('/register', { name: '', phone: '02-123', address: '', birth_date: '19991399', pin: '123456', pin_confirm: '1' });
  assert.equal(r.status, 422);
  for (const msg of ['이름을 입력해 주세요', '휴대전화 번호를 확인해 주세요', '주소를 입력해 주세요', '생년월일을 확인해 주세요',
    '연속된 숫자는 사용할 수 없습니다', '필수 항목에 동의해 주세요']) assert.match(r.text, new RegExp(msg), msg);
  assert.ok(!r.text.includes('value="123456"'), 'PIN 값을 다시 출력하지 않음');
  r = await c.post('/register', { ...REG, pin_confirm: '258148' });
  assert.match(r.text, /PIN이 서로 다릅니다/);
  r = await c.post('/register', { ...REG, pin: '700305', pin_confirm: '700305' });
  assert.match(r.text, /생년월일은 사용할 수 없습니다/);

  r = await c.post('/register', REG);
  assert.equal(r.location, '/me');
  const users = (await app.sql.all('SELECT * FROM users'));
  assert.equal(users.length, 1);
  assert.equal(users[0].phone, '01011112222');
  assert.equal(users[0].address, '경기도 용인시 처인구 테스트로 1');
  assert.equal(users[0].birth_date, '1970-03-05');
  assert.match(users[0].pin_hash, /^h1\$/);
  assert.ok(!users[0].pin_hash.includes('258147'));
  assert.equal(users[0].phone_confirmed_at, null, '등록만으로는 번호 확인 안 됨');
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM registrations')).n, 1);

  r = await c.get('/me');
  assert.match(r.text, /선정 후 이용할 수 있습니다/);
  for (const bad of ['접수', '검토', '초기상담', '사례회의', '상담신청하기']) assert.ok(!r.text.includes(bad), bad);

  const c2 = app.client();
  await c2.get('/register');
  r = await c2.post('/register', { ...REG, name: '다른사람' });
  assert.equal(r.status, 409);
  assert.match(r.text, /이미 등록된 번호입니다/);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM users')).n, 1);

  // 등록한 번호와 PIN으로 로그인
  const c3 = app.client();
  r = await c3.login('01011112222', '258147');
  assert.equal(r.location, '/me');
});

test('로그인: 실패 문구는 등록 여부와 무관, 번호별 5회 실패 시 잠금', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { phone: '01022223333' });
  const c = app.client();
  await c.get('/login');
  const unknown = await c.post('/login', { phone: '01099998888', pin: '258147' });
  const wrong = await c.post('/login', { phone: '01022223333', pin: '000001' });
  assert.equal(unknown.status, 422);
  assert.match(unknown.text, /휴대전화 번호 또는 PIN이 맞지 않습니다/);
  assert.match(wrong.text, /휴대전화 번호 또는 PIN이 맞지 않습니다/);
  for (let i = 0; i < 4; i++) await c.post('/login', { phone: '01022223333', pin: '000001' });
  const locked = await c.post('/login', { phone: '01022223333', pin: TEST_PIN });
  assert.match(locked.text, /잠시 잠겼습니다/);
  assert.equal(locked.headers.get('location'), null);
  // 잠기지 않은 다른 계정은 로그인 가능
  await addParticipant(app.db, { phone: '01022224444' });
  assert.equal((await app.client().login('01022224444')).location, '/me');
});

test('CSRF 토큰 없는 POST 거부', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { phone: '01011112222' });
  const c = app.client();
  await c.get('/login');
  const r = await c.post('/login', { phone: '01011112222', pin: TEST_PIN }, { csrf: false });
  assert.equal(r.status, 403);
  assert.equal(r.location, null);
});

test('미선정 계정은 참여자 전용 기능(프로그램·Grow 신청·상담 링크)에 접근 불가', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { phone: '01030000001' });
  const sid = await addSession(app.db, 'grow-craft');
  const c = app.client();
  await c.login('01030000001');
  for (const path of ['/me/programs', '/me/open/counseling', '/me/counseling/apply', `/me/grow/${sid}`]) {
    const r = await c.get(path);
    assert.equal(r.status, 403, path);
    assert.ok(!(r.location || '').includes('cco-mho'), path);
  }
  const r = await c.post(`/me/grow/${sid}`);
  assert.equal(r.status, 403);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments')).n, 0);
  // 비로그인
  const anon = app.client();
  assert.equal((await anon.get('/me/counseling/apply')).location, '/login');
});

test('Link: 선정 시 전체 자동 배정, 신청 버튼 없음, 재실행·새 회차에 중복 없음, 출석 아님', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const s1 = await addSession(app.db, 'link-cooking', { round_no: 1 });
  await addSession(app.db, 'link-outing', { round_no: 1 });
  const uid = await addParticipant(app.db, { phone: '01040000001', selected: true });
  const count = async () => (await app.sql.get("SELECT COUNT(*) n FROM enrollments WHERE user_id = ? AND source = 'auto'", uid)).n;
  assert.equal(await count(), 2);
  await autoAssignLink(app.db);
  await autoAssignLink(app.db, { userId: uid });
  assert.equal(await count(), 2);
  await addSession(app.db, 'link-kimjang', { round_no: 1 });
  assert.equal(await count(), 3);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM attendance')).n, 0);

  const c = app.client();
  await c.login('01040000001');
  const r = await c.get('/me/programs');
  assert.equal(r.status, 200);
  const linkSection = r.text.slice(r.text.indexOf('id="t-l"'), r.text.indexOf('id="t-o"'));
  assert.ok(linkSection.includes('전체 자동 참여'));
  assert.ok(!/신청|type="checkbox"/.test(linkSection), 'Link 영역에 신청 요소가 없어야 함');
  // 자동 배정은 '참여한 프로그램'에 들어가지 않는다
  const me = await c.get('/me');
  const attended = me.text.slice(me.text.indexOf('참여한 프로그램'));
  assert.ok(!attended.includes('요리교실'));
  assert.ok((await app.sql.get('SELECT 1 FROM enrollments WHERE session_id = ? AND user_id = ?', s1, uid)));
});

test('Grow: 확인 → 완료, 개인정보 재입력 없음, 중복·정원·마감 차단', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const a = await addParticipant(app.db, { name: '참여자가', phone: '01050000001', selected: true });
  await addParticipant(app.db, { name: '참여자나', phone: '01050000002', selected: true });
  const sid = await addSession(app.db, 'grow-career', { round_no: 1, capacity: 1 });
  const closed = await addSession(app.db, 'grow-craft', { round_no: 1, is_closed: 1 });

  const c = app.client();
  await c.login('01050000001');
  let r = await c.get(`/me/grow/${sid}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /신청 확인/);
  assert.match(r.text, /참여자가/);
  assert.match(r.text, /일정 미정/);
  assert.ok(!/name="(name|phone|address|birth_date|code)"/.test(r.text), '개인정보·인증 입력란이 없어야 함');
  r = await c.post(`/me/grow/${sid}`);
  assert.equal(r.location, `/me/grow/${sid}/done`);
  r = await c.get(r.location);
  assert.match(r.text, /신청 완료/);
  r = await c.post(`/me/grow/${sid}`);
  assert.equal(r.status, 409);
  assert.match(r.text, /이미 신청한 회차/);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE user_id = ?', a)).n, 1);

  const c2 = app.client();
  await c2.login('01050000002');
  r = await c2.post(`/me/grow/${sid}`);
  assert.equal(r.status, 409);
  assert.match(r.text, /정원이 마감/);
  r = await c2.post(`/me/grow/${closed}`);
  assert.equal(r.status, 409);
  assert.match(r.text, /마감된 회차/);
  r = await c2.get('/me/programs');
  assert.match(r.text, /정원 마감/);

  // Link 회차는 Grow 신청 경로로 신청할 수 없다
  const link = await addSession(app.db, 'link-cooking');
  assert.equal((await c2.post(`/me/grow/${link}`)).status, 404);
});

test('상담신청하기: 선정 참여자의 O 마음 → 전문 심리상담에만, 서버 확인 후 꼬모로 이동(번호 미전달)', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { phone: '01060000001', selected: true });
  const c = app.client();
  await c.login('01060000001');
  const status = await c.get('/me');
  assert.ok(!status.text.includes('상담신청하기'));
  const programs = await c.get('/me/programs');
  assert.ok(!programs.text.includes('상담신청하기'));
  assert.match(programs.text, /href="\/me\/open\/counseling"/);
  const page = await c.get('/me/open/counseling');
  assert.match(page.text, />상담신청하기</);
  const r = await c.get('/me/counseling/apply');
  assert.equal(r.status, 302);
  assert.equal(r.location, 'https://cco-mho.pages.dev/');
  assert.ok(!r.location.includes('010'));
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});

test('꼬모 미연결: 연동 확인 필요만 표시, 가짜 회차 없음', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { phone: '01070000001', selected: true });
  const c = app.client();
  await c.login('01070000001');
  for (const path of ['/me', '/me/open/counseling']) {
    const r = await c.get(path);
    assert.match(r.text, /연동 확인 필요/);
    assert.ok(!/\d+ \/ \d+회 완료|0회 완료|꼬모 연동<\/span>/.test(r.text), path);
  }
});

test('나의 현황: 네 영역, 미정 값은 채우지 않음, 출석 기록만 참여 완료로', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01080000001', selected: true });
  await addSession(app.db, 'link-cooking', { round_no: 2 });
  const dated = await addSession(app.db, 'link-seasonal', { round_no: 1, date: '2099-07-01', start_time: '10:00', place: '본관' });
  const past = await addSession(app.db, 'link-outing', { round_no: 1, date: '2000-04-01' });
  (await app.sql.run("INSERT INTO attendance (enrollment_id, status, recorded_at) SELECT id, 'attended', '2000-04-01T00:00:00Z' FROM enrollments WHERE session_id = ?", past));
  const internal = await addSession(app.db, 'in-case-conference', { date: '2099-02-01' });
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE session_id = ?', internal)).n, 0);

  const c = app.client();
  await c.login('01080000001');
  const r = await c.get('/me');
  for (const h of ['지금 해야 할 것', '참여할 프로그램', '참여한 프로그램', '전문 심리상담']) assert.ok(r.text.includes(h), h);
  const now = r.text.slice(r.text.indexOf('지금 해야 할 것'), r.text.indexOf('참여할 프로그램'));
  assert.match(now, /절기행사/);
  assert.match(now, /2099년 7월 1일/);
  assert.match(now, /본관/);
  assert.match(r.text, /요리교실 2회차 <span class="muted">· 일정 미정/);
  const done = r.text.slice(r.text.indexOf('참여한 프로그램'));
  assert.match(done, /나들이 <b>1회<\/b>/);
  assert.ok(!r.text.includes('통합사례회의'));
  for (const bad of ['접수', '초기상담', '선정', '사례회의']) assert.ok(!r.text.includes(bad), bad);
  assert.ok(dated && uid);
});

test('다른 사용자의 정보·관리자 화면 접근 불가, 운영 담당은 번호 가림', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const a = await addParticipant(app.db, { name: '가참여자', phone: '01090000001', selected: true });
  const b = await addParticipant(app.db, { name: '나참여자', phone: '01090000002', selected: true });
  const sid = await addSession(app.db, 'link-cooking');
  const c = app.client();
  await c.login('01090000001');
  const me = await c.get('/me/profile');
  assert.ok(me.text.includes('가참여자') && !me.text.includes('나참여자'));
  for (const path of ['/admin', `/admin/participants/${b}`, '/admin/como', `/admin/sessions/${sid}`]) {
    assert.equal((await c.get(path)).status, 403, path);
  }
  const bEnrollment = (await app.sql.get('SELECT id FROM enrollments WHERE user_id = ?', b)).id;
  assert.equal((await c.post(`/admin/enrollments/${bEnrollment}/attendance`, { status: 'attended' })).status, 403);
  assert.equal((await c.post(`/me/grow/enrollments/${bEnrollment}/cancel`)).status, 303);
  assert.equal((await app.sql.get('SELECT status FROM enrollments WHERE id = ?', bEnrollment)).status, 'active');

  await addManager(app.db, '01099990001', 'staff');
  const s = app.client();
  await s.login('01099990001');
  assert.equal((await s.get('/admin/participants')).status, 403);
  assert.equal((await s.get('/admin/como')).status, 403);
  const roster = await s.get(`/admin/sessions/${sid}`);
  assert.equal(roster.status, 200);
  assert.match(roster.text, /010-\*\*\*\*-0001/);
  assert.ok(!roster.text.includes('010-9000-0001'));
  assert.ok(a);
});

test('관리자: 선정 → Link 배정, 회차 추가, 출석 기록 → 참여한 프로그램 반영, 감사기록', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addSession(app.db, 'link-cooking', { round_no: 1 });
  const uid = await addParticipant(app.db, { name: '선정대상', phone: '01011110001' });
  await addManager(app.db);
  const m = app.client();
  await m.login('01099990000');
  let r = await m.get('/admin/participants?status=received');
  assert.match(r.text, /선정대상/);
  r = await m.post(`/admin/participants/${uid}/select`, { selected: '1' });
  assert.equal(r.status, 303);
  assert.equal((await app.sql.get('SELECT is_selected FROM users WHERE id = ?', uid)).is_selected, 1);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE user_id = ?', uid)).n, 1);

  const prog = (await app.sql.get("SELECT id FROM programs WHERE code = 'link-seasonal'")).id;
  r = await m.post(`/admin/programs/${prog}/sessions`, { round_no: '1', date: '2027-02-30', capacity: 'x' });
  assert.equal(r.status, 422);
  r = await m.post(`/admin/programs/${prog}/sessions`, { round_no: '1', date: '2027-07-15', start_time: '10:00', place: '' });
  assert.equal(r.status, 303);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE user_id = ?', uid)).n, 2);

  const e = (await app.sql.get('SELECT id FROM enrollments WHERE user_id = ? ORDER BY id LIMIT 1', uid)).id;
  r = await m.post(`/admin/enrollments/${e}/attendance`, { status: 'attended' });
  assert.equal(r.status, 303);
  const p = app.client();
  await p.login('01011110001');
  const me = await p.get('/me');
  assert.match(me.text.slice(me.text.indexOf('참여한 프로그램')), /요리교실 <b>1회<\/b>/);

  // 선정 해제 → 예정 배정 취소, 참여자 전용 기능 차단
  r = await m.post(`/admin/participants/${uid}/select`, { selected: '0' });
  assert.equal((await p.get('/me/programs')).status, 403);
  assert.equal((await app.sql.get("SELECT COUNT(*) n FROM enrollments WHERE user_id = ? AND status = 'active'", uid)).n, 1);
  // 재선정 → 복원, 중복 없음
  await m.post(`/admin/participants/${uid}/select`, { selected: '1' });
  assert.equal((await app.sql.get("SELECT COUNT(*) n FROM enrollments WHERE user_id = ? AND status = 'active'", uid)).n, 2);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE user_id = ?', uid)).n, 2);

  const actions = (await app.sql.all('SELECT action FROM audit_log')).map((x) => x.action);
  for (const a of ['participant.select', 'session.create', 'attendance.record', 'participant.release']) assert.ok(actions.includes(a), a);
});

test('관리자 배정: internal(통합사례회의) 회차에는 배정 불가', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01012120001', selected: true });
  const sid = await addSession(app.db, 'in-case-conference');
  const campaign = await addSession(app.db, 'in-campaign', { date: '2099-10-01' });
  await addManager(app.db);
  const m = app.client();
  await m.login('01099990000');
  await m.post(`/admin/sessions/${sid}/assign`, { user_id: String(uid) });
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE session_id = ?', sid)).n, 0);
  // 캠페인은 실제 배정한 참여자의 일정에만
  await m.post(`/admin/sessions/${campaign}/assign`, { user_id: String(uid) });
  const p = app.client();
  await p.login('01012120001');
  assert.match((await p.get('/me')).text, /지역사회 인식개선 캠페인/);
});

test('운영 모드: 개발 표시 없음, 등록 동작, Secure 쿠키', async (t) => {
  const { createApp } = await import('../src/app.js');
  const { createD1 } = await import('./d1-shim.js');
  const db = createD1();
  t.after(() => db.sqlite.close());
  const env = { SESSION_SECRET: 'x'.repeat(40), DB: db };
  const app = createApp();
  const fetchPage = (path, init) => app.fetch(new Request(`https://login-cpn.pages.dev${path}`, init), env, {});

  let r = await fetchPage('/');
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.ok(!text.includes('개발 환경'));
  assert.ok(text.includes('요리교실'));
  assert.equal(r.headers.get('set-cookie'), null, '공개 홈은 세션을 만들지 않음');

  r = await fetchPage('/register');
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /Secure/);
  const csrf = (await r.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  r = await fetchPage('/register', {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0], 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, ...REG }).toString(),
  });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/me');
  assert.equal((await db.prepare('SELECT doc_version FROM consents').first()).doc_version, '미확정');
});

test('운영 모드 설정 오류: SESSION_SECRET·DB 바인딩 누락을 알려 준다', async () => {
  const { createApp } = await import('../src/app.js');
  const { createD1 } = await import('./d1-shim.js');
  const app = createApp();
  let r = await app.fetch(new Request('https://login-cpn.pages.dev/'), { DB: createD1() }, {});
  assert.equal(r.status, 500);
  assert.match(await r.text(), /SESSION_SECRET/);
  r = await app.fetch(new Request('https://login-cpn.pages.dev/'), { SESSION_SECRET: 'x'.repeat(40) }, {});
  assert.equal(r.status, 500);
  assert.match(await r.text(), /D1 데이터베이스 바인딩\(DB\)/);
});

test('동의문 미설정이면 필수 동의 1개를 받고 문안 버전을 미확정으로 기록', async (t) => {
  const { loadConsent } = await import('../src/config.js');
  const app = await startApp({ cfg: { consent: undefined } });
  t.after(app.close);
  assert.equal(loadConsent(app.cfg).version, '미확정');
  const c = app.client();
  let r = await c.get('/register');
  assert.match(r.text, /수집 항목: 이름, 주소, 생년월일, 휴대전화 번호/);
  r = await c.post('/register', { ...REG, consent: [] });
  assert.equal(r.status, 422);
  r = await c.post('/register', REG);
  assert.equal(r.location, '/me');
  assert.equal((await app.sql.get('SELECT doc_version FROM consents')).doc_version, '미확정');
});

test('내 정보: 이름·주소·생년월일 수정', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01014140001' });
  const c = app.client();
  await c.login('01014140001');
  let r = await c.get('/me/profile');
  assert.match(r.text, /value="19700101"/);
  r = await c.post('/me/profile', { name: '새이름', address: '새 주소', birth_date: '2999-01-01' });
  assert.equal(r.status, 422);
  r = await c.post('/me/profile', { name: '새이름', address: '새 주소', birth_date: '1965-12-31' });
  assert.equal(r.status, 303);
  const u = await app.sql.get('SELECT name, address, birth_date FROM users WHERE id = ?', uid);
  assert.deepEqual({ ...u }, { name: '새이름', address: '새 주소', birth_date: '1965-12-31' });
});

test('PIN 변경·관리자 초기화: 임시 PIN으로 로그인하면 새 PIN을 정할 때까지 다른 화면 차단', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01016160001', selected: true });
  const p = app.client();
  await p.login('01016160001');
  let r = await p.post('/account/pin', { current_pin: '000001', pin: '258369', pin_confirm: '258369' });
  assert.match(r.text, /현재 PIN이 맞지 않습니다/);
  r = await p.post('/account/pin', { current_pin: TEST_PIN, pin: '111111', pin_confirm: '111111' });
  assert.match(r.text, /같은 숫자 반복/);
  r = await p.post('/account/pin', { current_pin: TEST_PIN, pin: '258369', pin_confirm: '258369' });
  assert.equal(r.location, '/me');
  await p.get('/me');
  assert.equal((await app.client().request('GET', '/me')).status, 303);
  assert.equal((await app.client().login('01016160001', '258369')).location, '/me');

  await addManager(app.db);
  const m = app.client();
  await m.login('01099990000');
  r = await m.post(`/admin/participants/${uid}/pin-reset`);
  const page = await m.get(r.location);
  const temp = page.text.match(/임시 PIN: (\d{6})/)[1];
  assert.equal((await p.get('/me')).location, '/login', '초기화하면 기존 로그인 종료');
  const q = app.client();
  r = await q.login('01016160001', temp);
  assert.equal(r.location, '/account/pin');
  assert.equal((await q.get('/me/programs')).location, '/account/pin');
  r = await q.post('/account/pin', { current_pin: temp, pin: '814725', pin_confirm: '814725' });
  assert.equal(r.location, '/me');
  assert.equal((await q.get('/me/programs')).status, 200);
  const actions = (await app.sql.all('SELECT action FROM audit_log')).map((x) => x.action);
  assert.ok(actions.includes('user.pin_reset') && actions.includes('user.pin_change'));
});
