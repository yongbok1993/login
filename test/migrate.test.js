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
  assert.match(await r.text(), /요리교실/);
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
