// 테스트용 D1 호환 객체: better-sqlite3 위에 D1 API(prepare/bind/first/all/run/batch)를 흉내 낸다.
// 운영 스키마와 같은 migrations/*.sql을 적용한다.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

export function applyMigrations(sqlite) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) sqlite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR.pathname, f), 'utf8'));
}

/** 마이그레이션 SQL을 문장 단위로 나눈다(전체 줄 주석 제거 후 ';' 기준). */
export function migrationStatements() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  return files.flatMap((f) => fs.readFileSync(path.join(MIGRATIONS_DIR.pathname, f), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean));
}

export function createD1(file = ':memory:') {
  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);

  function exec(sql, rawParams) {
    const s = sqlite.prepare(sql);
    // D1은 ?1, ?2 같은 번호 매개변수를 위치 순서로 받는다. better-sqlite3는 {1: v} 객체로 받는다.
    const params = /\?\d/.test(sql) ? [Object.fromEntries(rawParams.map((v, i) => [i + 1, v]))] : rawParams;
    if (s.reader) return { results: s.all(...params), meta: { changes: 0, last_row_id: 0 } };
    const info = s.run(...params);
    return { results: [], meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }

  function bound(sql, params) {
    return {
      _exec: () => exec(sql, params),
      async first(col) {
        const r = exec(sql, params).results[0];
        if (r === undefined) return null;
        return col ? r[col] : r;
      },
      async all() { return { success: true, ...exec(sql, params) }; },
      async run() { return { success: true, ...exec(sql, params) }; },
    };
  }

  return {
    sqlite,
    prepare(sql) {
      return { bind: (...params) => bound(sql, params), ...bound(sql, []) };
    },
    async batch(statements) {
      return sqlite.transaction(() => statements.map((s) => ({ success: true, ...s._exec() })))();
    },
  };
}
