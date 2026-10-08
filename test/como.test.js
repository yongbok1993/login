import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockAdapter } from '../src/como/adapters.js';
import { checkLink, counselingView, syncStatus } from '../src/como/mapping.js';
import { getUser } from '../src/services/users.js';
import { addManager, addParticipant, startApp, TEST_PIN } from './helpers.js';

function mock(accounts) {
  return createMockAdapter({ accounts });
}

test('1:1 매칭이면 연결하고 개인 배정 회차로 표시(모의 데이터 표시 포함)', async (t) => {
  const como = mock([{ externalId: 'x1', phone: '010-7000-0001', completed: 3, total: 10, nextAt: '2099-03-02T05:00:00Z' }]);
  const app = await startApp({ como });
  t.after(app.close);
  await addParticipant(app.db, { phone: '01070000001', selected: true });
  const c = app.client();
  await c.login('01070000001');
  const r = await c.get('/me/open/counseling');
  assert.match(r.text, /3 \/ 10회 완료/);
  assert.match(r.text, /<progress class="bar" max="10" value="3">/);
  assert.match(r.text, /다음 상담 2099년 3월 2일/);
  assert.match(r.text, /개발용 모의 데이터/);
  const link = (await app.sql.get('SELECT * FROM como_links'));
  assert.equal(link.status, 'linked');
  assert.equal(link.phone_at_link, '01070000001');
});

test('총회차가 없거나 0이면 진행률 계산 안 함, 사업 운영 횟수로 대체하지 않음', async (t) => {
  const como = mock([
    { externalId: 'n1', phone: '01070000002', completed: 2, total: null },
    { externalId: 'z1', phone: '01070000003', completed: 0, total: 0 },
  ]);
  const app = await startApp({ como });
  t.after(app.close);
  for (const phone of ['01070000002', '01070000003']) await addParticipant(app.db, { phone, selected: true });
  const c = app.client();
  await c.login('01070000002');
  let r = await c.get('/me/open/counseling');
  assert.match(r.text, /2회 완료/);
  assert.ok(!r.text.includes('<progress'));
  assert.ok(!r.text.includes('/ 10회') && !r.text.includes('/ 20회'));
  const c2 = app.client();
  await c2.login('01070000003');
  r = await c2.get('/me/open/counseling');
  assert.match(r.text, /0 \/ 0회 완료/);
  assert.ok(!r.text.includes('<progress'));
});

test('같은 번호에 꼬모 계정이 여러 개면 자동 연결 중단, 상담 정보 미노출', async (t) => {
  const como = mock([
    { externalId: 'd1', phone: '01071000001', completed: 5, total: 10 },
    { externalId: 'd2', phone: '01071000001', completed: 1, total: 4 },
  ]);
  const app = await startApp({ como });
  t.after(app.close);
  await addParticipant(app.db, { phone: '01071000001', selected: true });
  const c = app.client();
  await c.login('01071000001');
  const r = await c.get('/me');
  assert.match(r.text, /연동 확인 필요/);
  assert.ok(!/회 완료/.test(r.text));
  const link = (await app.sql.get('SELECT * FROM como_links'));
  assert.equal(link.status, 'conflict');
  assert.equal(link.external_id, null);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM como_status')).n, 0);
});

test('이름 불일치·이미 다른 사용자와 연결된 꼬모 계정은 충돌 처리', async (t) => {
  const como = mock([{ externalId: 'e1', phone: '01072000001', name: '다른 사람', completed: 1, total: 2 }]);
  const app = await startApp({ como });
  t.after(app.close);
  const id = await addParticipant(app.db, { name: '본인', phone: '01072000001', selected: true });
  assert.equal(await checkLink(app.db, como, await getUser(app.db, id)), 'conflict');
  assert.equal((await app.sql.get('SELECT detail FROM como_links')).detail, 'name_mismatch');

  const como2 = mock([{ externalId: 'shared', phone: '01072000002', completed: 1, total: 2 },
    { externalId: 'shared', phone: '01072000003', completed: 1, total: 2 }]);
  const u1 = await addParticipant(app.db, { phone: '01072000002', selected: true });
  const u2 = await addParticipant(app.db, { phone: '01072000003', selected: true });
  assert.equal(await checkLink(app.db, como2, await getUser(app.db, u1)), 'linked');
  assert.equal(await checkLink(app.db, como2, await getUser(app.db, u2)), 'conflict');
  assert.equal((await counselingView(app.db, como2, await getUser(app.db, u2))).state, 'unavailable');
});

test('전화번호 변경 시 연결 해제·현황 삭제, 새 번호는 관리자 확인 전까지 조회 안 함, 다른 세션 종료', async (t) => {
  // 새 번호(01073000009)에도 꼬모 계정이 있지만, 확인 전에는 조회·연결하지 않아야 한다.
  const como = mock([
    { externalId: 'p1', phone: '01073000001', completed: 4, total: 6 },
    { externalId: 'p9', phone: '01073000009', completed: 9, total: 9 },
  ]);
  const app = await startApp({ como });
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01073000001', selected: true });
  const other = app.client();
  await other.login('01073000001');
  const c = app.client();
  await c.login('01073000001');
  assert.match((await c.get('/me')).text, /4 \/ 6회 완료/);

  await c.get('/me/phone');
  let r = await c.post('/me/phone', { phone: '010-7300-0009', pin: '000001' });
  assert.match(r.text, /PIN이 맞지 않습니다/);
  r = await c.post('/me/phone', { phone: '010-7300-0009', pin: TEST_PIN });
  assert.equal(r.location, '/me/profile');
  const u = await getUser(app.db, uid);
  assert.equal(u.phone, '01073000009');
  assert.equal(u.phone_confirmed_at, null);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM como_status')).n, 0);
  r = await c.get('/me');
  assert.match(r.text, /연동 확인 필요/);
  assert.ok(!/회 완료/.test(r.text), '확인 전 번호로 남의 상담 현황을 보여 주지 않음');
  assert.equal((await app.sql.get('SELECT status FROM como_links')).status, 'needs_recheck');
  assert.equal((await other.get('/me')).location, '/login');

  // 관리자가 연락처를 확인하면 그때 매핑한다.
  await addManager(app.db);
  const m = app.client();
  await m.login('01099990000');
  await m.post(`/admin/participants/${uid}/confirm-phone`);
  assert.equal((await app.sql.get('SELECT status FROM como_links')).status, 'linked');
  assert.match((await c.get('/me')).text, /9 \/ 9회 완료/);
});

test('등록만 하고 확인되지 않은 번호는 꼬모 계정이 있어도 연결하지 않는다', async (t) => {
  const como = mock([{ externalId: 'u1', phone: '01077000001', completed: 5, total: 10 }]);
  const app = await startApp({ como });
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01077000001' });
  await app.sql.run('UPDATE users SET is_selected = 1 WHERE id = ?', uid);
  assert.equal(await checkLink(app.db, como, await getUser(app.db, uid)), 'unconfirmed');
  const c = app.client();
  await c.login('01077000001');
  const r = await c.get('/me/open/counseling');
  assert.match(r.text, /연동 확인 필요/);
  assert.ok(!/회 완료/.test(r.text));
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM como_links')).n, 0);
});

test('연동 실패 시 수치 없이 연동 확인 필요, 오류 기록', async (t) => {
  const como = {
    kind: 'broken', configured: true, source: 'live',
    async findAccountsByPhone() { return [{ externalId: 'b1' }]; },
    async getCounselingSummary() { throw new Error('timeout'); },
  };
  const app = await startApp({ como });
  t.after(app.close);
  await addParticipant(app.db, { phone: '01074000001', selected: true });
  const c = app.client();
  await c.login('01074000001');
  const r = await c.get('/me');
  assert.match(r.text, /연동 확인 필요/);
  assert.ok(!/회 완료/.test(r.text));
  assert.ok((await app.sql.get("SELECT 1 FROM como_sync_log WHERE result = 'error'")));
});

test('연결 당시 번호와 현재 번호가 다르면 저장된 현황을 보여 주지 않는다', async (t) => {
  const como = mock([{ externalId: 'q1', phone: '01075000001', completed: 2, total: 5 }]);
  const app = await startApp({ como });
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01075000001', selected: true });
  await checkLink(app.db, como, await getUser(app.db, uid));
  await syncStatus(app.db, como, await getUser(app.db, uid));
  assert.equal((await counselingView(app.db, como, await getUser(app.db, uid))).state, 'available');
  (await app.sql.run("UPDATE users SET phone = '01075000002' WHERE id = ?", uid));
  assert.equal((await counselingView(app.db, como, await getUser(app.db, uid))).state, 'unavailable');
});

test('관리자: 충돌 건을 후보 중 하나로 확정 연결, 미설정 시 연동 작업 차단', async (t) => {
  const como = mock([
    { externalId: 'k1', phone: '01076000001', completed: 1, total: 3 },
    { externalId: 'k2', phone: '01076000001', completed: 2, total: 3 },
  ]);
  const app = await startApp({ como });
  t.after(app.close);
  const uid = await addParticipant(app.db, { phone: '01076000001', selected: true });
  await addManager(app.db);
  const m = app.client();
  await m.login('01099990000');
  await m.post('/admin/como/check-all');
  assert.equal((await app.sql.get('SELECT status FROM como_links')).status, 'conflict');
  let r = await m.post(`/admin/como/${uid}/confirm`, { external_id: 'not-a-candidate' });
  assert.equal((await app.sql.get('SELECT status FROM como_links')).status, 'conflict');
  r = await m.post(`/admin/como/${uid}/confirm`, { external_id: 'k2' });
  assert.equal(r.status, 303);
  const link = (await app.sql.get('SELECT * FROM como_links'));
  assert.equal(link.status, 'linked');
  assert.equal(link.external_id, 'k2');

  const plain = await startApp();
  t.after(plain.close);
  await addManager(plain.db);
  const m2 = plain.client();
  await m2.login('01099990000');
  r = await m2.get('/admin/como');
  assert.match(r.text, /미연결 \(연동 인터페이스 미확인\)/);
  assert.equal((await m2.post('/admin/como/check-all')).status, 409);
});
