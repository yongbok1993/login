import { all, stmt } from '../lib/db.js';
import { nowIso } from '../lib/time.js';

/** batch()에 넣을 수 있는 감사기록 문장 */
export function auditStmt(db, actorId, action, targetType, targetId, detail) {
  return stmt(db, `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`, actorId ?? null, action, targetType, targetId ?? null,
  detail === undefined ? null : JSON.stringify(detail), nowIso());
}

export async function audit(db, ...args) {
  await auditStmt(db, ...args).run();
}

export function listAudit(db, limit = 200) {
  return all(db, `SELECT a.*, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?`, limit);
}
