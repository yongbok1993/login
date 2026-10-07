import { MIGRATIONS } from './migrations.generated.js';

// 배포 후 자동 마이그레이션: 요청 처리 전에 아직 적용되지 않은 D1 마이그레이션을 적용한다.
// wrangler와 같은 d1_migrations 테이블에 기록하므로 `wrangler d1 migrations apply`와 함께 써도 중복 적용되지 않는다.
// 각 마이그레이션은 기록(INSERT)과 함께 하나의 batch(트랜잭션)로 실행한다. 동시에 여러 요청이 시도해도
// d1_migrations.name이 UNIQUE라 한 번만 성공하고, 나머지는 전체가 되돌려진다.

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

const done = new WeakMap();

async function appliedNames(db) {
  try {
    return new Set((await db.prepare('SELECT name FROM d1_migrations').all()).results.map((r) => r.name));
  } catch {
    await db.prepare(CREATE_TABLE).run();
    return new Set();
  }
}

async function migrate(db, migrations) {
  const applied = await appliedNames(db);
  const result = [];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    try {
      await db.batch([...m.statements.map((s) => db.prepare(s)),
        db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(m.name)]);
      result.push(m.name);
    } catch (err) {
      const row = await db.prepare('SELECT 1 AS ok FROM d1_migrations WHERE name = ?').bind(m.name).first();
      if (!row) throw new Error(`마이그레이션 ${m.name} 실패: ${err.message}`);
    }
  }
  return result;
}

/** 같은 DB 바인딩에 대해서는 한 번만 확인한다(실패하면 다음 요청에서 다시 시도). */
export function ensureMigrated(db, migrations = MIGRATIONS) {
  let p = done.get(db);
  if (!p) {
    p = migrate(db, migrations).catch((err) => {
      done.delete(db);
      throw err;
    });
    done.set(db, p);
  }
  return p;
}
