import assert from 'node:assert/strict';
import test from 'node:test';
import { autoAssignLink } from '../src/services/enrollments.js';
import { addLegacyPinUser, addManager, addParticipant, addSession, openTestDb, startApp, TEST_PASSWORD, TEST_PIN } from './helpers.js';

const BANNED = [
  '온라인에서 이야기가 시작되고', '사람과 사람의 관계에 로그인합니다', '등록은 한 번이면 충분합니다', '그다음은 로그인만',
  '관계에서 시작해, 마음을 돌보고', '정기적인 만남과 교류로 관계망을 형성하는', '마음의 짐을 혼자 지지 않도록',
  '원하는 활동을 직접 골라 체험하고', '상태가 아니라 내 일정이 보입니다',
];

const IN_MARK = '<span class="mark-in"><span class="mark-i">i</span><span class="mark-n">N</span></span>';

test('첫 화면: 비로그인은 LOGIN : 人 브랜드·사업 소개·네 영역 설명·참여 안내·신청서·연락처만, 상세 프로그램은 승인 참여자·담당자에게만', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const r = await app.client().get('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /<h1 class="wordmark">LOGIN<span class="colon"> : <\/span><em>人<\/em><\/h1>/);
  assert.match(r.text, /<title>2026년 기획 ‘북한이탈주민 지원사업’ \| LOGIN : 人<\/title>/);
  assert.match(r.text, /<p class="program-label">2026년 기획 <span class="nowrap">‘북한이탈주민 지원사업’<\/span><\/p>/, '첫 화면 사업명');
  assert.match(r.text, /<meta name="description" content="[^"]*2026년 기획 ‘북한이탈주민 지원사업’/);
  assert.match(r.text, /<p class="footer-program">2026년 기획 ‘북한이탈주민 지원사업’<\/p>/, '하단');
  assert.match(r.text, /property="og:site_name" content="LOGIN : 人"/);
  assert.match(r.text, /<a class="brand" href="\/" aria-label="LOGIN : 人 처음으로">/);
  assert.match(r.text, /<div class="brand" role="img" aria-label="LOGIN : 人">/, '하단 로고');
  assert.match(r.text, />로그인<\/a>/, '기능 버튼 로그인은 그대로');
  assert.match(r.text, /북한이탈주민의 정서적 안정 및 사회통합을 위한 지역사회 관계망 강화사업입니다/);
  const areas = [
    ['L : Light', '정서 지원', '마음을 돌보고 필요한 도움과 연결하며 안정적인 일상을 지원합니다.'],
    ['O : Organization', '관계망 형성', '함께 만나고 활동하며 서로를 지지하는 관계를 만들어 갑니다.'],
    ['G : Grow', '나의 성장', '관심과 욕구에 맞는 경험과 배움을 통해 새로운 가능성을 탐색합니다.'],
    [`${IN_MARK} : Network`, '지역사회 네트워크', '복지관과 지역사회 기관·자원을 연결하여 필요한 도움과 지속적인 관계를 이어갑니다.'],
  ];
  const sec = r.text.slice(r.text.indexOf('id="areas"'), r.text.indexOf('id="guide"'));
  let last = -1;
  for (const [name, ko, desc] of areas) {
    const i = sec.indexOf(`<span class="area-name">${name}</span><span class="area-ko">${ko}</span>`);
    assert.ok(i > last, `${name} 순서·제목 구조`);
    assert.ok(sec.includes(desc), desc);
    last = i;
  }
  assert.ok(r.text.includes(`${IN_MARK} : Network — 지역사회 네트워크`), '상단 영역 소개에 iN');
  assert.ok(r.text.includes(`<b>${IN_MARK}</b><span>지역사회<br>네트워크</span>`), '장식 도장에 iN');
  for (const x of ['참여 대상', '신청·선정 절차', '우선순위에 따라 검토하고, 같은 순위에서는 먼저 신청한 순서를 따릅니다', '자동으로 확정되지 않습니다',
    'href="/forms"', '031-334-9966', 'href="/register"']) assert.ok(r.text.includes(x), x);
  for (const bad of ['요리교실', '통합사례회의', '전문 심리상담', '개별 사례관리', '회차', 'href="/board', 'LOG人', '로그人', 'LOGIN : IN',
    'iNetwork', '>IN<', 'Organization</span><span class="area-ko">관계</span>', 'cco-mho', '<img', ...BANNED]) {
    assert.ok(!r.text.includes(bad), `비로그인 첫 화면에 "${bad}" 노출`);
  }
  assert.ok(!/<script/.test(r.text), '첫 화면은 스크립트를 불러오지 않음');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self';/);

  // 승인 대기 신청자에게도 상세 카드 없음
  await addParticipant(app.db, { phone: '01012340001' });
  const pending = app.client();
  await pending.login('01012340001');
  const ph = (await pending.get('/')).text;
  assert.ok(!ph.includes('요리교실') && !ph.includes('id="programs"'));
  assert.equal((await pending.get('/me/programs')).status, 403);

  // 승인된 참여자: 네 영역 상세 카드(최신 2차 수정본)
  await addParticipant(app.db, { phone: '01012340002', selected: true });
  const p = app.client();
  await p.login('01012340002');
  const home = (await p.get('/')).text;
  const cards = home.slice(home.indexOf('<section id="programs"'), home.indexOf('id="guide"'));
  const order = ['log-card l', 'log-card o', 'log-card g', 'log-card in'].map((k) => cards.indexOf(k));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'L·O·G·iN 순서');
  const part = (k, next) => cards.slice(cards.indexOf(`log-card ${k}`), next ? cards.indexOf(`log-card ${next}`) : undefined);
  const L = part('l', 'o'); const O = part('o', 'g'); const G = part('g', 'in'); const N = part('in');
  for (const x of ['개별 사례관리 <small>2~12월 · 상시</small>', '상담·모니터링을 통해 욕구를 확인하고 필요한 서비스와 자원을 연계합니다. 필요한 물품으로 구성한 키트 지원을 포함합니다.',
    '전문 심리상담 <small>4~7월 · 총 8회·월 2회</small>', '전문기관과 연계하여 일대일 상담을 진행합니다.']) assert.ok(L.includes(x), `L: ${x}`);
  for (const x of ['요리교실 <small>2~11월 · 총 10회', '절기행사 <small>7월·9월 · 총 2회', '나들이 <small>4월·10월 · 총 2회',
    '김장나눔활동 <small>11월 · 1회', '참여자 주도형 자조모임 <small>4·6·8·10월 · 총 4회']) assert.ok(O.includes(x), `O: ${x}`);
  for (const x of ['직업·적성 체험 <small>2~6월 · 총 10회', '맞춤형 체험 활동 <small>7~10월 · 총 8회',
    '참여자 의견을 수렴하여 활동을 선정합니다.', '의사소통교육 <small>3~4월 · 총 4회']) assert.ok(G.includes(x), `G: ${x}`);
  for (const x of ['통합사례회의 <small>2월·9월 · 총 2회', '필요한 서비스와 지역자원을 연결합니다.', '평가회 <small>12월 · 1회',
    '사업 운영 결과와 참여 경험을 함께 돌아봅니다.']) assert.ok(N.includes(x), `iN: ${x}`);
  for (const bad of ['집단 심리상담', '정서지원 키트', '만남 및 교류활동', '지역사회 인식개선 캠페인', '공예 체험', '도자기', '목공', '베이킹',
    '월 1회', '6월·11월', '4·6·8·11월', '2~11월 중 제공', '사업 운영 10회', 'Light</span><span class="area-ko">관계', 'Open', 'LINK']) {
    assert.ok(!home.includes(bad), `"${bad}" 남아 있음`);
  }
  for (const path of ['/me', '/me/programs']) {
    const x = (await p.get(path)).text;
    for (const bad of ['만남 및 교류활동', '집단 심리상담', '공예 체험', '인식개선', 'LOG人']) assert.ok(!x.includes(bad), `${path}: ${bad}`);
  }
  assert.ok((await p.get('/me/programs')).text.includes(`<span class="area-name">${IN_MARK} : Network</span><span class="area-ko">지역사회 네트워크</span>`));
});

const REG = { name: '홍길동', phone: '010-1111 2222', password: 'hello2026', password_confirm: 'hello2026', consent: 'privacy' };

test('참여 신청: 신청 시각 안내 → 이름 → 번호 → 비밀번호 → 확인 → 동의 → 신청하기, 주소·생년월일·주소 검색 없음', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const c = app.client();
  let r = await c.get('/register');
  const ids = ['applied-at-label', 'id="name"', 'id="phone"', 'id="password"', 'id="password_confirm"', 'name="consent"', '>신청하기</button>'];
  const pos = ids.map((x) => r.text.indexOf(x));
  assert.ok(pos.every((v, i) => v > 0 && (i === 0 || v > pos[i - 1])), `순서 ${pos}`);
  assert.match(r.text, /신청 시각은 접수 완료 시 자동으로 기록됩니다\./);
  assert.ok(!/name="(applied_at|registered_at)"/.test(r.text), '신청 시각 입력칸 없음');
  for (const bad of ['address', 'postcode', 'birth_date', '생년월일', '주소 검색', 'daumcdn', 'PIN']) assert.ok(!r.text.includes(bad), bad);
  assert.match(r.text, /<input id="password" name="password" type="password"/);
  assert.match(r.text, /class="pw-toggle"[^>]*hidden>보기</);
  assert.match(r.text, /<script src="\/static\/password.js" defer><\/script>/);

  r = await c.post('/register', { name: '', phone: '02-123', password: 'abc', password_confirm: 'x' });
  assert.equal(r.status, 422);
  for (const msg of ['이름을 입력해 주세요', '휴대전화 번호를 확인해 주세요', '8자 이상', '필수 항목에 동의해 주세요']) assert.match(r.text, new RegExp(msg), msg);
  r = await c.post('/register', { ...REG, password_confirm: 'hello2027' });
  assert.match(r.text, /비밀번호가 서로 다릅니다/);
  r = await c.post('/register', { ...REG, password: 'a11112222', password_confirm: 'a11112222' });
  assert.match(r.text, /휴대전화 번호는 포함할 수 없습니다/);
  assert.ok(!r.text.includes('a11112222'), '비밀번호를 다시 출력하지 않음');
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM users')).n, 0, '검증 실패 시 저장·시각 기록 없음');

  // 사용자가 보낸 시간값은 무시하고 서버 시각을 기록
  const before = new Date().toISOString();
  r = await c.post('/register', { ...REG, registered_at: '2000-01-01T00:00:00.000Z', applied_at: '2000-01-01 00:00:00' });
  const after = new Date().toISOString();
  assert.equal(r.location, '/register/done');
  const u = await app.sql.get('SELECT * FROM users');
  const reg = await app.sql.get('SELECT * FROM registrations');
  assert.equal(u.phone, '01011112222', '하이픈·공백 제거 후 저장');
  assert.match(u.password_hash, /^p1\$100000\$/);
  assert.ok(!u.password_hash.includes('hello2026'));
  assert.equal(u.pin_hash, null);
  assert.equal(u.address, '');
  assert.equal(u.birth_date, null);
  assert.match(reg.registered_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, '밀리초까지 저장');
  assert.ok(reg.registered_at >= before.slice(0, 19) && reg.registered_at <= after, `${before} <= ${reg.registered_at} <= ${after}`);
  assert.equal(u.is_selected, 0);

  // 신청 완료: 신청 시각(초까지·한국시간) → 이름 → 전화번호 → 상태
  r = await c.get('/register/done');
  const kst = new Date(Date.parse(reg.registered_at) + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const order = [`<dd class="mono">${kst}</dd>`, '<dd>홍길동</dd>', '<dd>010-1111-2222</dd>', '승인 대기'].map((x) => r.text.indexOf(x));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), `완료 화면 순서 ${order}`);
  assert.match(r.text, /신청이 접수되었습니다\. 참여 확정 후 내부 서비스를 이용할 수 있습니다\./);

  // 재전송(같은 브라우저)·중복 신청(다른 브라우저)으로 계정·접수가 늘지 않고 시각도 그대로
  r = await c.post('/register', REG);
  assert.equal(r.status, 303);
  const c2 = app.client();
  await c2.get('/register');
  r = await c2.post('/register', { ...REG, name: '다른사람', phone: '01011112222' });
  assert.equal(r.status, 409);
  assert.match(r.text, /이미 신청된 번호입니다/);
  const [dup] = await Promise.all([1, 2, 3].map(async () => {
    const x = app.client();
    await x.get('/register');
    return x.post('/register', { ...REG, phone: '010-1111-2222' });
  }));
  assert.equal(dup.status, 409);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM users')).n, 1);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM registrations')).n, 1);

  // 로그인·로그아웃·새로고침해도 최초 신청 시각 유지
  await c.post('/logout');
  const c3 = app.client();
  r = await c3.login('010 1111-2222', 'hello2026');
  assert.equal(r.location, '/me');
  r = await c3.get('/me');
  assert.match(r.text, /내 신청정보/);
  assert.ok(r.text.includes(kst));
  assert.equal((await app.sql.get('SELECT registered_at FROM registrations')).registered_at, reg.registered_at);
});

test('동시 신청: 여러 명이 동시에 신청해도 접수번호와 신청 시각 순서가 일치하고, 관리자 목록은 신청 시각 오름차순', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const phones = Array.from({ length: 8 }, (_, i) => `0105555000${i}`);
  await Promise.all(phones.map(async (phone, i) => {
    const x = app.client();
    await x.get('/register');
    return x.post('/register', { ...REG, name: `신청${i}`, phone });
  }));
  const rows = await app.sql.all('SELECT id, registered_at FROM registrations ORDER BY id');
  assert.equal(rows.length, 8);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].registered_at >= rows[i - 1].registered_at, '접수번호 순서 = 시각 순서');
  // 같은 초에 들어온 신청이 있어도 접수번호로 순서가 정해짐
  await app.sql.run("UPDATE registrations SET registered_at = '2026-10-13T01:02:03.000Z'");
  await addManager(app.db);
  const m = app.client();
  await m.adminLogin();
  const list = (await m.get('/admin/participants')).text;
  const names = [...list.matchAll(/>(신청\d)<\/a>/g)].map((x) => x[1]);
  const byId = await app.sql.all('SELECT u.name FROM registrations r JOIN users u ON u.id = r.user_id ORDER BY r.id');
  assert.deepEqual(names, byId.map((x) => x.name));
  assert.match(list, /<td>1<\/td>\s*<td class="mono">2026-10-13 10:02:03<\/td>/, '접수순서와 초 단위 한국시간');
  const head = list.slice(list.indexOf('<thead>'), list.indexOf('</thead>'));
  const cols = ['신청 시각', '이름', '전화번호', '신청 상태'].map((x) => head.indexOf(x));
  assert.ok(cols.every((v, i) => v > 0 && (i === 0 || v > cols[i - 1])), '신청 시각 → 이름 → 전화번호 → 상태');
});

test('로그인: 휴대전화 번호 + 비밀번호, 실패 문구는 등록 여부와 무관, 번호별 5회 실패 시 잠금', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { phone: '01022223333' });
  const c = app.client();
  const page = await c.get('/login');
  assert.match(page.text, /<label for="phone">휴대전화 번호<\/label>/);
  assert.match(page.text, /<label for="password">비밀번호<\/label>/);
  assert.match(page.text, /재설정 코드/);
  const unknown = await c.post('/login', { phone: '01099998888', password: 'testpass1234' });
  const wrong = await c.post('/login', { phone: '01022223333', password: 'wrongpass1' });
  assert.equal(unknown.status, 422);
  assert.match(unknown.text, /휴대전화 번호 또는 비밀번호가 맞지 않습니다/);
  assert.match(wrong.text, /휴대전화 번호 또는 비밀번호가 맞지 않습니다/);
  for (let i = 0; i < 4; i++) await c.post('/login', { phone: '010-2222-3333', password: 'wrongpass1' });
  const locked = await c.post('/login', { phone: '01022223333', password: TEST_PASSWORD });
  assert.match(locked.text, /잠시 잠겼습니다/);
  assert.equal(locked.headers.get('location'), null);
  await addParticipant(app.db, { phone: '01022224444' });
  assert.equal((await app.client().login('010-2222-4444')).location, '/me');
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
  const linkSection = r.text.slice(r.text.indexOf('id="t-o"'), r.text.indexOf('id="t-g"'));
  assert.ok(linkSection.includes('요리교실'));
  assert.ok(!/신청|type="checkbox"/.test(linkSection), 'Link 영역에 신청 요소가 없어야 함');
  // 자동 배정은 '참여한 프로그램'에 들어가지 않는다
  const me = await c.get('/me');
  const attended = me.text.slice(me.text.indexOf('참여한 프로그램'));
  assert.ok(!attended.includes('요리교실'));
  assert.ok((await app.sql.get('SELECT 1 FROM enrollments WHERE session_id = ? AND user_id = ?', s1, uid)));
});

test('Grow: 희망 신청(개인정보 재입력 없음) → 관리자 선정 시에만 일정 반영, 정원은 선정 인원 기준, 중복·마감 차단', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const a = await addParticipant(app.db, { name: '참여자가', phone: '01050000001', selected: true });
  await addParticipant(app.db, { name: '참여자나', phone: '01050000002', selected: true });
  await addParticipant(app.db, { name: '참여자다', phone: '01050000003', selected: true });
  const sid = await addSession(app.db, 'grow-career', { round_no: 1, capacity: 1 });
  const closed = await addSession(app.db, 'grow-craft', { round_no: 1, is_closed: 1 });

  const c = app.client();
  await c.login('01050000001');
  let r = await c.get(`/me/grow/${sid}`);
  assert.match(r.text, /희망 신청/);
  assert.match(r.text, /참여자가/);
  assert.match(r.text, /일정 미정/);
  assert.ok(!/name="(name|phone|address|birth_date|pin|code)"/.test(r.text), '개인정보·인증 입력란이 없어야 함');
  r = await c.post(`/me/grow/${sid}`);
  assert.equal(r.location, `/me/grow/${sid}/done`);
  assert.match((await c.get(r.location)).text, /희망 신청 완료/);
  assert.equal((await c.post(`/me/grow/${sid}`)).status, 409, '중복 신청 차단');
  assert.match((await c.get('/me/programs')).text, /선정 대기/);
  let me = await c.get('/me');
  assert.ok(!me.text.slice(me.text.indexOf('참여할 프로그램'), me.text.indexOf('전문 심리상담')).includes('직업·적성 체험 1회차'), '선정 전에는 일정에 없음');
  assert.match(me.text, /희망 신청 1건 선정 대기/);

  // 정원 1이어도 희망 신청은 받는다(선정 인원 기준)
  const c2 = app.client();
  await c2.login('01050000002');
  assert.equal((await c2.post(`/me/grow/${sid}`)).status, 303);
  assert.match((await c2.post(`/me/grow/${closed}`)).text, /마감된 회차/);

  await addManager(app.db);
  const m = app.client();
  await m.adminLogin();
  r = await m.get('/admin/grow');
  assert.match(r.text, /참여자가/);
  assert.match(r.text, /참여자나/);
  const ea = (await app.sql.get('SELECT id FROM enrollments WHERE user_id = ? AND session_id = ?', a, sid)).id;
  const eb = (await app.sql.get("SELECT e.id FROM enrollments e JOIN users u ON u.id = e.user_id WHERE u.phone = '01050000002'")).id;
  // 선정 전에는 출석 기록 불가
  await m.post(`/admin/enrollments/${ea}/attendance`, { status: 'attended' });
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM attendance')).n, 0);
  await m.post(`/admin/enrollments/${ea}/selection`, { decision: 'selected' });
  r = await m.post(`/admin/enrollments/${eb}/selection`, { decision: 'selected' });
  assert.match((await m.get(r.location)).text, /정원이 찼습니다/);
  await m.post(`/admin/enrollments/${eb}/selection`, { decision: 'not_selected' });
  const sel = await app.sql.all('SELECT id, selection FROM enrollments WHERE session_id = ? ORDER BY id', sid);
  assert.deepEqual(sel.map((x) => x.selection), ['selected', 'not_selected']);

  me = await c.get('/me');
  assert.match(me.text.slice(me.text.indexOf('참여할 프로그램'), me.text.indexOf('전문 심리상담')), /직업·적성 체험 1회차/);
  assert.match((await c.get('/me/programs')).text, /<span class="chip">선정<\/span>/);
  assert.match((await c2.get('/me/programs')).text, /미선정/);
  // 정원이 찬 뒤 새 희망 신청은 정원 마감
  const c3 = app.client();
  await c3.login('01050000003');
  assert.match((await c3.post(`/me/grow/${sid}`)).text, /정원이 마감/);
  // Link 회차는 Grow 신청 경로로 신청할 수 없다
  const link = await addSession(app.db, 'link-cooking');
  assert.equal((await c3.post(`/me/grow/${link}`)).status, 404);
  assert.ok((await app.sql.all('SELECT action FROM audit_log')).some((x) => x.action === 'grow.selection'));
});

test('Grow: 선정 대기 중인 희망 신청은 본인이 취소 가능, 선정 후에는 프로그램 설정을 따름', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01051000001', selected: true });
  const sid = await addSession(app.db, 'grow-craft', { round_no: 1 });
  const c = app.client();
  await c.login('01051000001');
  await c.post(`/me/grow/${sid}`);
  const eid = (await app.sql.get('SELECT id FROM enrollments WHERE user_id = ?', uid)).id;
  await c.post(`/me/grow/enrollments/${eid}/cancel`);
  assert.equal((await app.sql.get('SELECT status FROM enrollments WHERE id = ?', eid)).status, 'cancelled');
  await c.post(`/me/grow/${sid}`);
  assert.equal((await app.sql.get('SELECT status, selection FROM enrollments WHERE id = ?', eid)).selection, 'pending', '다시 신청하면 선정 대기');
  await app.sql.run("UPDATE enrollments SET selection = 'selected' WHERE id = ?", eid);
  await c.post(`/me/grow/enrollments/${eid}/cancel`);
  assert.equal((await app.sql.get('SELECT status FROM enrollments WHERE id = ?', eid)).status, 'active', 'self_cancel 꺼짐: 선정 후 본인 취소 불가');
});

test('첫 관리자 지정(/admin/setup)·권한 지정: 로그인 없이 설정 코드 확인, 기존 번호는 관리자로 전환·비밀번호 재설정, 마지막 관리자 보호', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { name: '기관담당', phone: '01053000001' });
  const other = await addParticipant(app.db, { name: '다른사람', phone: '01053000002' });
  const c = app.client();
  let r = await c.get('/admin/setup');
  assert.equal(r.status, 200, '로그인 없이 열림');
  assert.ok(!r.text.includes('사용할 수 있는 설정 코드가 없습니다'));
  const form = { name: '기관담당', phone: '010-5300-0001', password: 'setup2026a', password_confirm: 'setup2026a' };
  r = await c.post('/admin/setup', { ...form, secret: 'wrong' });
  assert.equal(r.status, 422);
  assert.match(r.text, /설정 코드가 맞지 않습니다/);
  r = await c.post('/admin/setup', { ...form, secret: app.cfg.sessionSecret, password: '12345678', password_confirm: '12345678' });
  assert.equal(r.status, 422, '약한 비밀번호 거부');
  assert.equal((await app.sql.get('SELECT role FROM users WHERE id = ?', uid)).role, 'participant');
  r = await c.post('/admin/setup', { ...form, secret: app.cfg.sessionSecret });
  assert.equal(r.location, '/admin');
  const u = await app.sql.get('SELECT role, pin_hash FROM users WHERE id = ?', uid);
  assert.equal(u.role, 'manager');
  assert.equal(u.pin_hash, null);
  // 관리자는 아이디·비밀번호를 만들 때까지 다른 화면 이용 불가
  assert.equal((await c.get('/admin')).location, '/admin/account');
  assert.equal((await c.get('/admin/setup')).location, '/admin/account');
  r = await c.get('/admin/account');
  assert.match(r.text, /현재 비밀번호/);
  const acct = { login_id: 'Gwanri01', current: 'setup2026a', password: 'safepass2026', password_confirm: 'safepass2026' };
  r = await c.post('/admin/account', { ...acct, current: '000000' });
  assert.match(r.text, /비밀번호가 맞지 않습니다/);
  r = await c.post('/admin/account', { ...acct, password: 'gwanri01abc', password_confirm: 'gwanri01abc' });
  assert.match(r.text, /아이디를 포함할 수 없습니다/);
  r = await c.post('/admin/account', { ...acct, password: 'onlyletters', password_confirm: 'onlyletters' });
  assert.match(r.text, /영문과 숫자를 함께/);
  r = await c.post('/admin/account', acct);
  assert.equal(r.location, '/admin');
  assert.equal((await app.sql.get('SELECT login_id FROM users WHERE id = ?', uid)).login_id, 'gwanri01', '아이디는 소문자로 저장');
  assert.equal((await c.get('/admin')).status, 200);
  assert.equal((await c.get('/admin/setup')).status, 404, '관리자가 생기면 닫힘');
  assert.ok(await app.sql.get("SELECT 1 FROM audit_log WHERE action = 'user.setup_manager' AND target_id = ?", uid));
  // 이후에는 아이디·비밀번호로만 로그인(PIN 로그인 불가)
  const again = app.client();
  await again.get('/login');
  assert.equal((await again.post('/login', { phone: '01053000001', password: 'setup2026a' })).status, 422, '이전 비밀번호 무효');
  await again.get('/admin/login');
  assert.equal((await again.post('/admin/login', { login_id: 'gwanri01', password: 'wrongpass99' })).status, 422);
  await again.adminLogin('GWANRI01', 'safepass2026');
  assert.equal((await again.get('/admin')).status, 200);
  assert.equal((await app.client().get('/admin')).location, '/admin/login', '로그인 안 했으면 관리자 로그인으로');

  // 다른 사람이 같은 경로로 관리자가 될 수 없음
  const o = app.client();
  await o.get('/login');
  assert.equal((await o.post('/admin/setup', { ...form, phone: '01053000002', secret: app.cfg.sessionSecret })).status, 404);
  assert.equal((await app.sql.get('SELECT role FROM users WHERE id = ?', other)).role, 'participant');

  // 전체 관리자가 다른 등록자를 운영 담당으로 지정 → 참여자 목록에서 빠짐
  await c.post(`/admin/users/${other}/role`, { role: 'staff' });
  assert.equal((await app.sql.get('SELECT role FROM users WHERE id = ?', other)).role, 'staff');
  assert.ok(!(await c.get('/admin/participants')).text.includes('다른사람'));
  assert.match((await c.get('/admin/staff')).text, /다른사람/);
  // 마지막 전체 관리자는 해제 불가
  r = await c.post(`/admin/users/${uid}/role`, { role: 'participant' });
  assert.equal((await app.sql.get('SELECT role FROM users WHERE id = ?', uid)).role, 'manager');
  // 새 운영 담당: 처음 한 번 번호·비밀번호로 로그인해 관리자 아이디를 만든다
  const s = app.client();
  await s.login('01053000002');
  assert.equal((await s.get('/admin/grow')).location, '/admin/account');
  await s.get('/admin/account');
  r = await s.post('/admin/account', { login_id: 'gwanri01', current: TEST_PASSWORD, password: 'staffpass77', password_confirm: 'staffpass77' });
  assert.match(r.text, /이미 사용 중인 아이디입니다/);
  r = await s.post('/admin/account', { login_id: 'staff02', current: TEST_PASSWORD, password: 'staffpass77', password_confirm: 'staffpass77' });
  assert.equal(r.location, '/admin');
  // 운영 담당은 권한 변경 불가
  assert.equal((await s.post(`/admin/users/${uid}/role`, { role: 'participant' })).status, 403);
  assert.equal((await s.get('/admin/grow')).status, 200);
  assert.equal((await s.get('/admin/notices')).location, '/board/notice');
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
  const me = await c.get('/me/application');
  assert.ok(me.text.includes('가참여자') && !me.text.includes('나참여자') && !me.text.includes('01090000002'));
  for (const path of ['/admin', `/admin/participants/${b}`, '/admin/como', `/admin/sessions/${sid}`]) {
    assert.equal((await c.get(path)).status, 403, path);
  }
  const bEnrollment = (await app.sql.get('SELECT id FROM enrollments WHERE user_id = ?', b)).id;
  assert.equal((await c.post(`/admin/enrollments/${bEnrollment}/attendance`, { status: 'attended' })).status, 403);
  assert.equal((await c.post(`/me/grow/enrollments/${bEnrollment}/cancel`)).status, 303);
  assert.equal((await app.sql.get('SELECT status FROM enrollments WHERE id = ?', bEnrollment)).status, 'active');

  await addManager(app.db, '01099990001', 'staff');
  const s = app.client();
  await s.adminLogin('admin0001');
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
  await m.adminLogin();
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
  await m.adminLogin();
  await m.post(`/admin/sessions/${sid}/assign`, { user_id: String(uid) });
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE session_id = ?', sid)).n, 0);
  // 캠페인은 실제 배정한 참여자의 일정에만
  await m.post(`/admin/sessions/${campaign}/assign`, { user_id: String(uid) });
  const p = app.client();
  await p.login('01012120001');
  assert.match((await p.get('/me')).text, /지역사회 인식개선 캠페인/);
});

test('첫 관리자 지정: 등록되지 않은 번호면 관리자 계정 생성, 1회용 설정 코드, 코드·SESSION_SECRET 모두 없으면 지정 불가', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const c = app.client();
  await c.get('/admin/setup');
  const r = await c.post('/admin/setup', { secret: app.cfg.sessionSecret, name: '새관리자', phone: '01054000001', password: 'setup2026a', password_confirm: 'setup2026a' });
  assert.equal(r.location, '/admin');
  const u = await app.sql.get("SELECT * FROM users WHERE phone = '01054000001'");
  assert.equal(u.role, 'manager');
  assert.equal(u.name, '새관리자');

  assert.equal((await app.sql.get("SELECT COUNT(*) n FROM app_settings WHERE key = 'setup_code_hash'")).n, 0, '관리자가 생기면 설정 코드 폐기');

  // SESSION_SECRET이 없어도 1회용 설정 코드로 지정(대소문자·하이픈 무시), 한 번 쓰면 사라짐
  const { sha256 } = await import('../src/lib/crypto.js');
  const bare = await startApp({ cfg: { sessionSecret: '' } });
  t.after(bare.close);
  await bare.sql.run("UPDATE app_settings SET value = ? WHERE key = 'setup_code_hash'", await sha256('setup:v1:ABCD2345EFGH6789'));
  const b = bare.client();
  let p = await b.get('/admin/setup');
  assert.ok(!p.text.includes('사용할 수 있는 설정 코드가 없습니다'));
  const info = { name: '김관리', phone: '01054000002', password: 'setup2026a', password_confirm: 'setup2026a' };
  p = await b.post('/admin/setup', { ...info, secret: '' });
  assert.equal(p.status, 422, '빈 값 거부');
  p = await b.post('/admin/setup', { ...info, secret: 'ABCD-2345-EFGH-6780' });
  assert.equal(p.status, 422, '틀린 코드 거부');
  p = await b.post('/admin/setup', { ...info, secret: 'abcd-2345-efgh-6789' });
  assert.equal(p.location, '/admin');
  assert.equal((await bare.sql.get("SELECT role FROM users WHERE phone = '01054000002'")).role, 'manager');
  assert.equal((await bare.sql.get("SELECT COUNT(*) n FROM app_settings WHERE key = 'setup_code_hash'")).n, 0);

  // 설정 코드도 SESSION_SECRET도 없으면 안내하고 지정 불가
  const none = await startApp({ cfg: { sessionSecret: '' } });
  t.after(none.close);
  await none.sql.run("DELETE FROM app_settings WHERE key = 'setup_code_hash'");
  const n = none.client();
  p = await n.get('/admin/setup');
  assert.match(p.text, /사용할 수 있는 설정 코드가 없습니다/);
  p = await n.post('/admin/setup', { ...info, secret: 'abcd-2345-efgh-6789' });
  assert.equal(p.status, 422);
  assert.equal((await none.sql.get("SELECT COUNT(*) n FROM users WHERE role = 'manager'")).n, 0);
});

test('비밀번호 재설정: 담당자가 본인 확인 후 1회용 코드 발급(비밀번호는 보지도 정하지도 않음) → 본인이 새 비밀번호, 코드 재사용·만료·대입 차단', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const mid = await addManager(app.db);
  const uid = await addParticipant(app.db, { phone: '01055550001', selected: true });
  const sid = await addManager(app.db, '01099990002', 'staff');
  const m = app.client();
  await m.adminLogin();
  const p = app.client();
  await p.login('01055550001');
  assert.equal((await m.post(`/admin/users/${mid}/reset-code`)).status, 404, '본인 것은 발급 불가');
  let r = await m.post(`/admin/users/${uid}/reset-code`);
  const page = (await m.get(`/admin/participants/${uid}`)).text;
  const code = page.match(/재설정 코드: ([A-Z0-9]{4}-[A-Z0-9]{4})/)[1];
  const row = await app.sql.get('SELECT * FROM password_resets WHERE user_id = ?', uid);
  assert.ok(!row.code_hash.includes(code.replace('-', '')), '코드는 해시만 저장');
  assert.ok(!page.includes(TEST_PASSWORD));
  assert.equal((await app.sql.get('SELECT password_hash FROM users WHERE id = ?', uid)).password_hash.length > 0, true);

  const x = app.client();
  await x.get('/password/reset');
  r = await x.post('/password/reset', { phone: '01055550001', code: 'AAAA-AAAA', password: 'resetpw2026', password_confirm: 'resetpw2026' });
  assert.match(r.text, /맞지 않거나 만료/);
  r = await x.post('/password/reset', { phone: '01055550001', code: code.toLowerCase(), password: 'resetpw2026', password_confirm: 'resetpw2026' });
  assert.equal(r.location, '/login');
  assert.equal((await p.get('/me')).location, '/login', '재설정하면 기존 로그인 종료');
  assert.equal((await app.client().login('01055550001', 'resetpw2026')).location, '/me');
  await x.get('/password/reset');
  r = await x.post('/password/reset', { phone: '01055550001', code, password: 'again2026x', password_confirm: 'again2026x' });
  assert.match(r.text, /맞지 않거나 만료/, '코드 재사용 불가');

  // 만료된 코드
  await m.post(`/admin/users/${uid}/reset-code`);
  const code2 = (await m.get(`/admin/participants/${uid}`)).text.match(/재설정 코드: ([A-Z0-9]{4}-[A-Z0-9]{4})/)[1];
  await app.sql.run("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL");
  r = await x.post('/password/reset', { phone: '01055550001', code: code2, password: 'again2026x', password_confirm: 'again2026x' });
  assert.match(r.text, /맞지 않거나 만료/);

  // 관리자(운영 담당)도 같은 방식, 관리자 로그인으로 안내
  await m.post(`/admin/users/${sid}/reset-code`, { back: 'staff' });
  const code3 = (await m.get('/admin/staff')).text.match(/재설정 코드: ([A-Z0-9]{4}-[A-Z0-9]{4})/)[1];
  const y = app.client();
  await y.get('/password/reset');
  r = await y.post('/password/reset', { phone: '01099990002', code: code3, password: 'staffnew2026', password_confirm: 'staffnew2026' });
  assert.equal(r.location, '/admin/login');
  await y.adminLogin('admin0002', 'staffnew2026');
  assert.equal((await y.get('/admin/grow')).status, 200);

  // 번호별 반복 실패 잠금
  const z = app.client();
  await z.get('/password/reset');
  for (let i = 0; i < 5; i++) await z.post('/password/reset', { phone: '01055550001', code: 'ZZZZ-ZZZZ', password: 'x', password_confirm: 'x' });
  r = await z.post('/password/reset', { phone: '01055550001', code: 'ZZZZ-ZZZZ', password: 'x', password_confirm: 'x' });
  assert.match(r.text, /잠시 잠겼습니다/);

  // 같은 아이디로 5회 실패하면 관리자 로그인 잠금
  const w = app.client();
  await w.get('/admin/login');
  for (let i = 0; i < 5; i++) await w.post('/admin/login', { login_id: 'admin', password: 'wrongpass00' });
  r = await w.post('/admin/login', { login_id: 'admin', password: 'testpass1234' });
  assert.match(r.text, /잠시 잠겼습니다/);
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
  assert.ok(text.includes('LOGIN<span class="colon"> : </span><em>人</em>'));
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
  assert.equal(r.headers.get('location'), '/register/done');
  assert.equal((await db.prepare('SELECT doc_version FROM consents').first()).doc_version, '2026-10-14');
});

test('SESSION_SECRET 없음·짧음: 비밀키를 DB에 자동 생성해 등록·로그인 동작, 이후 요청도 같은 키 사용', async (t) => {
  const { createApp } = await import('../src/app.js');
  const { createD1 } = await import('./d1-shim.js');
  for (const secret of [undefined, 'too-short']) {
    const app = createApp();
    const db = createD1();
    t.after(() => db.sqlite.close());
    const env = { DB: db, ...(secret ? { SESSION_SECRET: secret } : {}) };
    const fetchPage = (path, init) => app.fetch(new Request(`https://login-cpn.pages.dev${path}`, init), env, {});
    const post = async (path, form) => {
      let r = await fetchPage(path);
      const cookie = r.headers.get('set-cookie').split(';')[0];
      const csrf = (await r.text()).match(/name="_csrf" value="([^"]+)"/)[1];
      r = await fetchPage(path, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, ...form }).toString() });
      return r;
    };
    assert.equal((await fetchPage('/healthz')).status, 200);
    let r = await post('/register', REG);
    assert.equal(r.status, 303, '등록 동작');
    assert.equal(r.headers.get('location'), '/register/done');
    const stored = (await db.prepare("SELECT value FROM app_settings WHERE key = 'app_secret'").first()).value;
    assert.ok(stored.length >= 32 && stored !== secret);
    // 새 인스턴스(재배포·다른 서버)에서도 같은 DB 키로 로그인된다.
    const app2 = createApp();
    const r2 = await app2.fetch(new Request('https://login-cpn.pages.dev/login'), env, {});
    const cookie = r2.headers.get('set-cookie').split(';')[0];
    const csrf = (await r2.text()).match(/name="_csrf" value="([^"]+)"/)[1];
    r = await app2.fetch(new Request('https://login-cpn.pages.dev/login', { method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, phone: REG.phone, password: REG.password }).toString() }), env, {});
    assert.equal(r.headers.get('location'), '/me', '로그인 동작');
  }
});

test('SESSION_SECRET이 32자 이상이면 그 값을 비밀키로 저장, 나중에 바뀌어도 저장된 키 유지', async (t) => {
  const { appSecret } = await import('../src/services/settings.js');
  const { db, dispose } = await openTestDb();
  t.after(dispose);
  const { ensureMigrated } = await import('../src/db/migrate.js');
  await ensureMigrated(db);
  assert.equal(await appSecret(db, 'a'.repeat(40)), 'a'.repeat(40));
  assert.equal((await db.prepare("SELECT value FROM app_settings WHERE key = 'app_secret'").first()).value, 'a'.repeat(40));
});

test('운영 모드 설정 오류: DB 바인딩 누락을 알려 준다', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const r = await app.fetch(new Request('https://login-cpn.pages.dev/'), { SESSION_SECRET: 'x'.repeat(40) }, {});
  assert.equal(r.status, 500);
  assert.match(await r.text(), /D1 데이터베이스 바인딩\(DB\)/);
});

test('기본 개인정보 수집·이용 동의문 표시, 동의 버전 기록, CONSENT_JSON이 있으면 그 문안 사용', async (t) => {
  const { loadConsent } = await import('../src/config.js');
  const app = await startApp({ cfg: { consent: undefined } });
  t.after(app.close);
  assert.equal(loadConsent(app.cfg).version, '2026-10-14');
  const c = app.client();
  let r = await c.get('/register');
  for (const part of ['수집·이용 목적', '신청정보(필수): 이름, 휴대전화 번호', '계정정보(필수): 비밀번호', '담당자도 볼 수 없습니다',
    '접수정보(자동 생성): 신청 시각', '이용정보', '게시판', '접속기록', '보유·이용 기간', '동의를 거부할 권리', 'LOGIN : 人(북한이탈주민',
    '우선순위에 따라 검토하고 같은 순위에서는 먼저 신청한 순서를 따르며']) assert.ok(r.text.includes(part), part);
  for (const bad of ['주소', '생년월일', 'PIN', '로그人', 'LOG人']) assert.ok(!r.text.includes(bad), bad);
  r = await c.post('/register', { ...REG, consent: [] });
  assert.equal(r.status, 422);
  r = await c.post('/register', REG);
  assert.equal(r.location, '/register/done');
  assert.equal((await app.sql.get('SELECT doc_version, agreed FROM consents')).doc_version, '2026-10-14');

  const custom = await startApp({ cfg: { consent: undefined, consentJson: JSON.stringify({ version: 'v9', items: [{ key: 'privacy', title: '기관 문안', required: true, body: '본문' }] }) } });
  t.after(custom.close);
  assert.equal(loadConsent(custom.cfg).version, 'v9');
});

test('내 신청정보: 승인된 참여자는 이름 수정, 신청 시각·접수번호 유지, 승인 대기자는 조회만', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { name: '처음이름', phone: '01077770001', selected: true });
  await addParticipant(app.db, { name: '대기자', phone: '01077770002' });
  const before = await app.sql.get('SELECT id, registered_at FROM registrations WHERE user_id = ?', uid);
  const c = app.client();
  await c.login('01077770001');
  let r = await c.post('/me/application', { name: '' });
  assert.equal(r.status, 422);
  r = await c.post('/me/application', { name: '바뀐이름', phone: '01000000000', registered_at: '2000-01-01' });
  assert.equal(r.location, '/me/application');
  const u = await app.sql.get('SELECT u.name, u.phone, r.id, r.registered_at FROM users u JOIN registrations r ON r.user_id = u.id WHERE u.id = ?', uid);
  assert.deepEqual(u, { name: '바뀐이름', phone: '01077770001', id: before.id, registered_at: before.registered_at });
  assert.equal((await c.get('/me/profile')).location, '/me/application');

  const p = app.client();
  await p.login('01077770002');
  r = await p.get('/me');
  assert.match(r.text, /대기자/);
  assert.ok(!/action="\/me\/application"/.test(r.text), '승인 대기자는 이름 수정 폼 없음');
  assert.equal((await p.post('/me/application', { name: '바꿈' })).status, 403);
});

test('전화번호 직접 변경: 본인만·현재 비밀번호 확인·정규화·중복 차단, 새 번호로 로그인, 계정·승인·신청 시각·접수번호·게시글 유지', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { name: '변경자', phone: '01078780001', selected: true });
  const pid = await addParticipant(app.db, { name: '대기자', phone: '01078780002' });
  await addParticipant(app.db, { name: '다른사람', phone: '01078780003' });
  const before = await app.sql.get('SELECT * FROM registrations WHERE user_id = ?', uid);
  const pwBefore = (await app.sql.get('SELECT password_hash FROM users WHERE id = ?', uid)).password_hash;
  const c = app.client();
  await c.login('01078780001');
  await c.post('/board/free/new', { title: '내 글', body: '본문' });
  const other = app.client();
  await other.login('01078780001');
  let r = await c.get('/me/application');
  assert.match(r.text, /id="phone-change"/);
  assert.match(r.text, /다음부터 새 번호로 로그인/);
  r = await c.post('/me/phone', { phone: '010-7878-0009', current_password: 'wrongpass1' });
  assert.match(r.text, /현재 비밀번호가 맞지 않습니다/);
  r = await c.post('/me/phone', { phone: '02-123-4567', current_password: TEST_PASSWORD });
  assert.match(r.text, /새 휴대전화 번호를 확인해 주세요/);
  r = await c.post('/me/phone', { phone: '010 7878 0003', current_password: TEST_PASSWORD });
  assert.equal(r.status, 409);
  assert.match(r.text, /이미 다른 계정에서 쓰는 번호입니다/);
  r = await c.post('/me/phone', { phone: '010-7878-0001', current_password: TEST_PASSWORD });
  assert.match(r.text, /지금 쓰는 번호와 같습니다/);
  assert.equal((await app.sql.get('SELECT phone FROM users WHERE id = ?', uid)).phone, '01078780001');

  r = await c.post('/me/phone', { phone: '010 7878-0009', current_password: TEST_PASSWORD, user_id: String(pid) });
  assert.equal(r.location, '/me/application');
  const u = await app.sql.get('SELECT * FROM users WHERE id = ?', uid);
  assert.equal(u.phone, '01078780009', '하이픈·공백 정규화');
  assert.equal(u.password_hash, pwBefore);
  assert.equal(u.is_selected, 1);
  assert.equal((await app.sql.get('SELECT phone FROM users WHERE id = ?', pid)).phone, '01078780002', '다른 계정은 그대로');
  assert.deepEqual(await app.sql.get('SELECT * FROM registrations WHERE user_id = ?', uid), before, '신청 기록·시각·접수번호 그대로');
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM registrations')).n, 3, '새 신청 없음');
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM posts WHERE author_id = ?', uid)).n, 1, '게시글 유지');
  const log = await app.sql.get("SELECT * FROM audit_log WHERE action = 'user.phone_change' AND target_id = ?", uid);
  assert.deepEqual(JSON.parse(log.detail), { from: '01078780001', to: '01078780009', by: 'self' });
  r = await c.get('/me/application');
  assert.match(r.text, /010-7878-0009\(으\)로 바뀌었습니다/);
  assert.equal((await other.get('/me')).location, '/login', '다른 기기 로그인 종료');

  const old = app.client();
  await old.get('/login');
  assert.equal((await old.post('/login', { phone: '01078780001', password: TEST_PASSWORD })).status, 422, '이전 번호로 로그인 불가');
  assert.equal((await app.client().login('010-7878-0009')).location, '/me');

  // 승인 대기 신청자도 직접 변경
  const p = app.client();
  await p.login('01078780002');
  r = await p.post('/me/phone', { phone: '01078780012', current_password: TEST_PASSWORD });
  assert.equal(r.location, '/me/application');
  assert.equal((await app.sql.get('SELECT phone FROM users WHERE id = ?', pid)).phone, '01078780012');
  // 비로그인은 불가
  const anon = app.client();
  await anon.get('/login');
  assert.equal((await anon.post('/me/phone', { phone: '01078780099', current_password: TEST_PASSWORD })).location, '/login');
});

test('기존 PIN 계정 전환: PIN으로 한 번 로그인 → 새 비밀번호를 정할 때까지 다른 화면 차단 → 이후 PIN 사용 불가', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addLegacyPinUser(app.db, { phone: '01066660001', selected: true });
  const c = app.client();
  await c.get('/login');
  let r = await c.post('/login', { phone: '01066660001', password: '000000' });
  assert.equal(r.status, 422, '틀린 PIN 거부');
  r = await c.post('/login', { phone: '01066660001', password: TEST_PIN });
  assert.equal(r.location, '/account/password');
  for (const path of ['/me', '/me/programs', '/board/notice']) assert.equal((await c.get(path)).location, '/account/password', path);
  r = await c.get('/account/password');
  assert.match(r.text, /지금 쓰는 PIN 6자리/);
  r = await c.post('/account/password', { current: '000000', password: 'newpass2026', password_confirm: 'newpass2026' });
  assert.match(r.text, /PIN이 맞지 않습니다/);
  r = await c.post('/account/password', { current: TEST_PIN, password: 'short', password_confirm: 'short' });
  assert.equal(r.status, 422);
  r = await c.post('/account/password', { current: TEST_PIN, password: 'newpass2026', password_confirm: 'newpass2026' });
  assert.equal(r.location, '/me');
  const u = await app.sql.get('SELECT pin_hash, password_hash, address, birth_date FROM users WHERE id = ?', uid);
  assert.equal(u.pin_hash, null, 'PIN 해시는 비움');
  assert.match(u.password_hash, /^p1\$/);
  assert.equal(u.address, '기존 주소', '기존 주소·생년월일 데이터는 지우지 않음');
  assert.equal(u.birth_date, '1970-01-01');
  assert.equal((await c.get('/me')).status, 200);
  const old = app.client();
  await old.get('/login');
  assert.equal((await old.post('/login', { phone: '01066660001', password: TEST_PIN })).status, 422, 'PIN으로는 더 이상 로그인 불가');
  assert.equal((await app.client().login('01066660001', 'newpass2026')).location, '/me');
});

