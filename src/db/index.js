import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { nowIso } from '../lib/time.js';
import { PROGRAM_SEED } from './programs-seed.js';

const MIGRATIONS = [
  fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'),
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  seedPrograms(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

// 개정 사업계획서 기준 프로그램 목록. 이미 있는 코드는 건드리지 않는다(관리자 수정 보존).
function seedPrograms(db) {
  const insert = db.prepare(`
    INSERT INTO programs (code, theme, name, detail, schedule_label, assign_mode, is_public, sort_order, created_at, updated_at)
    VALUES (@code, @theme, @name, @detail, @schedule_label, @assign_mode, @is_public, @sort_order, @now, @now)
    ON CONFLICT(code) DO NOTHING`);
  const now = nowIso();
  db.transaction(() => {
    PROGRAM_SEED.forEach((p, i) => insert.run({ detail: '', is_public: 1, ...p, sort_order: i, now }));
  })();
}

/** BEGIN IMMEDIATE 트랜잭션: 정원 확인처럼 읽고 쓰는 작업을 직렬화한다. */
export function immediate(db, fn) {
  return db.transaction(fn).immediate();
}
