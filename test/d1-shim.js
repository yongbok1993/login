// 테스트용 D1 호환 객체: better-sqlite3 위에 D1 API(prepare/bind/first/all/run/batch)를 흉내 낸다.
// 스키마는 앱과 같은 경로(src/db/migrate.js)로 적용한다.
import Database from 'better-sqlite3';

export function createD1(file = ':memory:') {
  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');

  // D1처럼: ArrayBuffer 매개변수는 BLOB으로 저장하고, BLOB 결과는 숫자 배열로 돌려준다.
  const toSqlite = (v) => (v instanceof ArrayBuffer ? Buffer.from(v) : ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v);
  const fromSqlite = (row) => {
    for (const k of Object.keys(row)) if (Buffer.isBuffer(row[k])) row[k] = Array.from(row[k]);
    return row;
  };

  function exec(sql, inputParams) {
    const rawParams = inputParams.map(toSqlite);
    const s = sqlite.prepare(sql);
    // D1은 ?1, ?2 같은 번호 매개변수를 위치 순서로 받는다. better-sqlite3는 {1: v} 객체로 받는다.
    const params = /\?\d/.test(sql) ? [Object.fromEntries(rawParams.map((v, i) => [i + 1, v]))] : rawParams;
    if (s.reader) return { results: s.all(...params).map(fromSqlite), meta: { changes: 0, last_row_id: 0 } };
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
