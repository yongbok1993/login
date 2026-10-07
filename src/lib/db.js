// D1 바인딩(env.DB) 사용 도우미. D1은 대화형 트랜잭션이 없으므로
// 여러 쓰기를 묶을 때는 batch()(원자적 실행)나 단일 조건부 SQL을 쓴다.

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);

export function stmt(db, sql, ...params) {
  return db.prepare(sql).bind(...params.map(norm));
}

export async function get(db, sql, ...params) {
  return (await stmt(db, sql, ...params).first()) ?? null;
}

export async function all(db, sql, ...params) {
  return (await stmt(db, sql, ...params).all()).results;
}

/** 실행 결과 meta: { changes, last_row_id } */
export async function run(db, sql, ...params) {
  return (await stmt(db, sql, ...params).run()).meta;
}

export async function batch(db, statements) {
  return db.batch(statements.filter(Boolean));
}

export function isUniqueError(err) {
  return /UNIQUE constraint failed/i.test(String(err && err.message ? err.message : err));
}
