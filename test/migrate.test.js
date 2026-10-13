import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { ensureMigrated } from '../src/db/migrate.js';
import { MIGRATIONS } from '../src/db/migrations.generated.js';
import { generate, OUT } from '../scripts/build-migrations.js';
import { openTestDb } from './helpers.js';

test('migrations.generated.js가 migrations/*.sql과 일치 (npm run build:migrations)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), generate());
});

test('자동 마이그레이션: 빈 DB에 첫 요청 시 전체 적용, 다시 실행해도 그대로', async (t) => {
  const { db, dispose } = await openTestDb();
  t.after(dispose);
  const app = createApp({ resolveDeps: () => ({ cfg: { isProd: false, comoApplyUrl: '', sessionIdleDays: 14, sessionMaxDays: 60 },
    db, como: { configured: false }, logger: console }) });
  const r = await app.fetch(new Request('https://x.test/'), {}, {});
  assert.equal(r.status, 200);
  assert.match(await r.text(), /LOG<em>人<\/em>/);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM programs WHERE archived_at IS NULL").first()).n, 15);
  const names = (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map((x) => x.name);
  assert.deepEqual(names, MIGRATIONS.map((m) => m.name));
  assert.equal(ensureMigrated(db), ensureMigrated(db), '같은 바인딩은 한 번만 확인(같은 작업 재사용)');
  // 다른 바인딩 객체로 다시 확인해도 새로 적용할 것이 없음
  assert.deepEqual(await ensureMigrated({ prepare: (q) => db.prepare(q), batch: (q) => db.batch(q) }), []);
});

test('자동 마이그레이션: 운영처럼 0003까지 적용된 DB에는 나머지만 적용, 동시 실행해도 한 번만', async (t) => {
  const { db, dispose } = await openTestDb();
  t.after(dispose);
  const upTo3 = MIGRATIONS.filter((m) => m.name < '0004');
  assert.equal((await ensureMigrated(db, upTo3)).length, 3);
  // 다른 요청(다른 바인딩 객체)들이 동시에 시도하는 상황
  const views = [1, 2, 3].map(() => ({ prepare: (s) => db.prepare(s), batch: (s) => db.batch(s) }));
  const results = await Promise.all(views.map((v) => ensureMigrated(v)));
  assert.deepEqual(results.flat(), MIGRATIONS.filter((m) => m.name >= '0004').map((m) => m.name));
  const names = (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map((x) => x.name);
  assert.deepEqual(names, MIGRATIONS.map((m) => m.name));
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('users')").all()).results.map((x) => x.name);
  assert.ok(cols.includes('pin_hash') && cols.includes('address') && cols.includes('address_detail') && !cols.includes('region'));
});

test('0007: 기본값일 때만 전문 심리상담 운영 횟수를 10회로 바꾸고, 관리자가 고친 값은 유지', async (t) => {
  const { db, dispose } = await openTestDb();
  t.after(dispose);
  const upTo6 = MIGRATIONS.filter((m) => m.name < '0007');
  await ensureMigrated(db, upTo6);
  const label = async () => (await db.prepare("SELECT schedule_label FROM programs WHERE code = 'open-counseling'").first()).schedule_label;
  assert.equal(await label(), '2~11월 · 사업 운영 20회');
  const upTo7 = MIGRATIONS.filter((m) => m.name < '0008');
  await ensureMigrated({ prepare: (q) => db.prepare(q), batch: (q) => db.batch(q) }, upTo7);
  assert.equal(await label(), '2~11월 · 사업 운영 10회');

  const other = await openTestDb();
  t.after(other.dispose);
  await ensureMigrated(other.db, upTo6);
  await other.db.prepare("UPDATE programs SET schedule_label = '관리자 수정' WHERE code = 'open-counseling'").run();
  await ensureMigrated({ prepare: (q) => other.db.prepare(q), batch: (q) => other.db.batch(q) }, upTo6.concat(MIGRATIONS.filter((m) => m.name.startsWith('0007'))));
  assert.equal((await other.db.prepare("SELECT schedule_label FROM programs WHERE code = 'open-counseling'").first()).schedule_label, '관리자 수정');
});

test('0011: 운영과 같은 기존 데이터(PIN 계정·주소·생년월일·공지·승인 2명)에 적용해도 지우지 않고 전환', async (t) => {
  const { db, dispose } = await openTestDb();
  t.after(dispose);
  const upTo10 = MIGRATIONS.filter((m) => m.name < '0011');
  await ensureMigrated(db, upTo10);
  const now = '2026-10-12T00:00:00.000Z';
  const insertUser = (name, phone, role, selected) => db.prepare(`INSERT INTO users (name, phone, phone_verified_at, role, is_selected,
    address, birth_date, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '주소', '1970-01-01', 'h1$x$y', ?, ?)`)
    .bind(name, phone, now, role, selected, now, now).run();
  await insertUser('관리', '01000000010', 'manager', 0);
  await insertUser('참여1', '01000000011', 'participant', 1);
  await insertUser('참여2', '01000000012', 'participant', 1);
  await insertUser('대기', '01000000013', 'participant', 0);
  await db.prepare("INSERT INTO registrations (user_id, registered_at, updated_at) SELECT id, ?, ? FROM users").bind(now, now).run();
  await db.prepare(`INSERT INTO notices (title, body, audience, is_pinned, created_at, updated_at)
    VALUES ('기존 공지', '본문', 'public', 1, ?, ?)`).bind(now, now).run();

  await ensureMigrated({ prepare: (q) => db.prepare(q), batch: (q) => db.batch(q) });
  const users = (await db.prepare('SELECT name, address, birth_date, pin_hash, account_status, is_selected FROM users ORDER BY id').all()).results;
  assert.equal(users.length, 4);
  assert.ok(users.every((u) => u.address === '주소' && u.birth_date === '1970-01-01' && u.pin_hash === 'h1$x$y' && u.account_status === 'active'));
  assert.equal(users.filter((u) => u.is_selected).length, 2);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM registrations').first()).n, 4);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM notices').first()).n, 1, '원본 공지 유지');
  const post = await db.prepare("SELECT * FROM posts WHERE board = 'notice'").first();
  assert.equal(post.title, '기존 공지');
  assert.equal(post.is_pinned, 1);
  const meetup = await db.prepare("SELECT archived_at, is_public FROM programs WHERE code = 'open-meetup'").first();
  assert.ok(meetup.archived_at, '지난 계획 프로그램은 보관(삭제 아님)');
  assert.equal(meetup.is_public, 0);
  const label = async (code) => (await db.prepare('SELECT name, schedule_label FROM programs WHERE code = ?').bind(code).first());
  assert.deepEqual(await label('link-kimjang'), { name: '김장나눔활동', schedule_label: '11월 · 1회' });
  assert.deepEqual(await label('open-counseling'), { name: '개별 심리상담', schedule_label: '2~11월 중 제공 · 예산상 1인 2회·총 20회' });
  assert.deepEqual(await label('in-evaluation'), { name: '평가회', schedule_label: '12월 · 1회' });
});
