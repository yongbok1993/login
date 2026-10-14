import assert from 'node:assert/strict';
import test from 'node:test';
import { setSelected } from '../src/services/users.js';
import { addManager, addParticipant, addSession, startApp } from './helpers.js';

const INTERNAL_GET = ['/me/programs', '/me/open/counseling', '/me/counseling/apply', '/board', '/board/notice', '/board/free',
  '/board/qna', '/board/free/new', '/board/qna/new', '/board/notice/1', '/notices'];

test('비로그인 방문자: 첫 화면·신청·로그인만, 내부 화면·게시판·관리자·직접 요청은 로그인으로', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const anon = app.client();
  for (const path of ['/', '/register', '/login', '/password/reset', '/admin/login']) assert.equal((await anon.get(path)).status, 200, path);
  for (const path of [...INTERNAL_GET, '/me', '/me/application', '/register/done', '/account/password']) {
    assert.equal((await anon.get(path)).location, '/login', path);
  }
  for (const path of ['/admin', '/admin/participants', '/admin/participants/1']) assert.equal((await anon.get(path)).location, '/admin/login', path);
  await anon.get('/login');
  for (const path of ['/board/free/new', '/board/qna/new', '/me/application', '/admin/participants/1/select']) {
    const r = await anon.post(path, { title: 'x', body: 'y', name: 'x', selected: '1' });
    assert.ok([302, 303].includes(r.status) && /login/.test(r.location), path);
  }
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM posts')).n, 0);
});

test('승인 대기 신청자: 신청정보는 본인 것만, 상세 프로그램·참여자 기능·관리 화면은 서버에서 차단, 게시판은 정해진 권한으로 이용', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { name: '대기신청자', phone: '01040000001' });
  const other = await addParticipant(app.db, { name: '다른신청자', phone: '01040000002', selected: true });
  const sid = await addSession(app.db, 'grow-career');
  await app.sql.run(`INSERT INTO posts (board, title, body, author_id, visibility, created_at, updated_at)
    VALUES ('notice', '내부 공지', '본문', NULL, 'members', '2026-10-13T00:00:00Z', '2026-10-13T00:00:00Z')`);
  const c = app.client();
  await c.login('01040000001');
  const me = await c.get('/me');
  assert.match(me.text, /신청이 접수되었습니다\. 참여 확정 후 내부 서비스를 이용할 수 있습니다\./);
  assert.match(me.text, /승인 대기/);
  for (const bad of ['다른신청자', '01040000002', '010-4000-0002', '요리교실', '전문 심리상담']) assert.ok(!me.text.includes(bad), bad);
  for (const path of ['/me/programs', '/me/open/counseling', '/me/counseling/apply', `/me/grow/${sid}`]) {
    const r = await c.get(path);
    assert.equal(r.status, 403, path);
    assert.ok(!r.text.includes('요리교실') && !(r.location || '').includes('cco-mho'), path);
  }
  for (const path of ['/admin', `/admin/participants/${other}`, '/admin/forms']) assert.equal((await c.get(path)).status, 403, path);
  assert.equal((await c.post(`/me/grow/${sid}`)).status, 403);
  assert.equal((await c.post(`/admin/participants/${other}/select`, { selected: '0' })).status, 403);
  assert.equal((await app.sql.get('SELECT is_selected FROM users WHERE id = ?', other)).is_selected, 1);
  // 게시판: 공지 열람, 자유게시판·질문과 답변 작성, 공지 작성 불가
  assert.equal((await c.get('/board/notice')).status, 200);
  assert.match((await c.get('/board/notice/1')).text, /내부 공지/);
  assert.equal((await c.post('/board/notice/new', { title: '몰래 공지', body: 'x' })).status, 403);
  assert.equal((await c.post('/board/free/new', { title: '대기자 글', body: '본문' })).status, 303);
  assert.equal((await c.post('/board/qna/new', { title: '대기자 질문', body: '본문' })).status, 303);
  assert.equal((await app.sql.get("SELECT COUNT(*) n FROM posts WHERE board = 'notice'")).n, 1);
});

test('승인 → 상세 프로그램 이용, 승인 해제 → 다시 차단(게시판은 신청자로 유지), 이용 중지·로그아웃 → 게시판까지 차단, 역할·승인은 요청 값으로 못 바꿈', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01041000001' });
  await addManager(app.db);
  const m = app.client();
  await m.adminLogin();
  const c = app.client();
  await c.login('01041000001');
  assert.equal((await c.get('/me/programs')).status, 403);
  await c.post('/me/application', { name: 'x', is_selected: '1', role: 'manager', account_status: 'active' });
  assert.deepEqual(await app.sql.get('SELECT role, is_selected FROM users WHERE id = ?', uid), { role: 'participant', is_selected: 0 });

  await m.post(`/admin/participants/${uid}/select`, { selected: '1' });
  for (const path of ['/me/programs', '/board/notice', '/me']) assert.equal((await c.get(path)).status, 200, path);
  assert.match((await c.get('/')).text, /id="programs"/);
  await m.post(`/admin/participants/${uid}/select`, { selected: '0' });
  assert.equal((await c.get('/me/programs')).status, 403, '승인 해제 즉시 상세 프로그램 차단');
  assert.ok(!(await c.get('/')).text.includes('id="programs"'));
  assert.equal((await c.get('/board/free')).status, 200, '신청자로서 게시판은 이용');
  assert.match((await c.get('/me')).text, /승인 해제/);

  await m.post(`/admin/participants/${uid}/select`, { selected: '1' });
  await m.post(`/admin/participants/${uid}/account`, { account_status: 'suspended' });
  for (const path of ['/board/free', '/board/notice', '/me/programs']) {
    const r = await c.get(path);
    assert.equal(r.status, 403, `이용 중지: ${path}`);
  }
  assert.equal((await c.post('/board/free/new', { title: 'x', body: 'y' })).status, 403);
  assert.match((await c.get('/me')).text, /이용 중지/);
  await m.post(`/admin/participants/${uid}/account`, { account_status: 'active' });
  assert.equal((await c.get('/board/free')).status, 200);

  await c.post('/logout');
  assert.equal((await c.get('/board/free')).location, '/login', '로그아웃 후 차단');
  assert.equal((await c.get('/me')).location, '/login');
});

test('승인 정원 10명: 11번째 승인 거부, 동시에 승인해도 10명을 넘지 않음(DB 트리거), 관리자는 세지 않음, 자동 확정 없음', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addManager(app.db);
  await addManager(app.db, '01099990003', 'staff');
  const ids = [];
  for (let i = 0; i < 14; i++) ids.push(await addParticipant(app.db, { name: `신청${i}`, phone: `0104200${String(i).padStart(4, '0')}` }));
  assert.equal((await app.sql.get("SELECT COUNT(*) n FROM users WHERE is_selected = 1")).n, 0, '먼저 신청한 사람도 자동 확정되지 않음');

  const m = app.client();
  await m.adminLogin();
  // 14명 승인 요청을 동시에 보냄
  await Promise.all(ids.map(async (id) => {
    const x = app.client();
    await x.adminLogin();
    return x.post(`/admin/participants/${id}/select`, { selected: '1' });
  }));
  const approved = (await app.sql.get("SELECT COUNT(*) n FROM users WHERE role = 'participant' AND is_selected = 1")).n;
  assert.equal(approved, 10);
  const rejected = await app.sql.get('SELECT id FROM users WHERE role = ? AND is_selected = 0 LIMIT 1', 'participant');
  let r = await m.post(`/admin/participants/${rejected.id}/select`, { selected: '1' });
  r = await m.get(`/admin/participants/${rejected.id}`);
  assert.match(r.text, /이미 10명입니다/);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM enrollments WHERE user_id = ?', rejected.id)).n, 0, '거부되면 배정도 없음');
  // 서비스·SQL로 직접 바꾸려 해도 DB가 막음
  assert.deepEqual(await setSelected(app.db, null, rejected.id, true), { cap: true });
  await assert.rejects(app.sql.run('UPDATE users SET is_selected = 1 WHERE id = ?', rejected.id), /participant_cap/);
  // 이용 중지된 사람은 세지 않고, 재개할 때 다시 확인
  const some = (await app.sql.get("SELECT id FROM users WHERE role = 'participant' AND is_selected = 1 LIMIT 1")).id;
  await m.post(`/admin/participants/${some}/account`, { account_status: 'suspended' });
  await m.post(`/admin/participants/${rejected.id}/select`, { selected: '1' });
  assert.equal((await app.sql.get('SELECT is_selected FROM users WHERE id = ?', rejected.id)).is_selected, 1);
  await m.post(`/admin/participants/${some}/account`, { account_status: 'active' });
  assert.equal((await app.sql.get('SELECT account_status FROM users WHERE id = ?', some)).account_status, 'suspended', '정원 초과로 재개 불가');
  assert.match((await m.get('/admin/participants')).text, /승인된 참여자 <b>10 \/ 10명<\/b>/);
});
