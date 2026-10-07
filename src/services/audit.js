import { nowIso } from '../lib/time.js';

export function audit(db, actorId, action, targetType, targetId, detail) {
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(actorId ?? null, action, targetType, targetId ?? null,
    detail === undefined ? null : JSON.stringify(detail), nowIso());
}

export function listAudit(db, limit = 200) {
  return db.prepare(`SELECT a.*, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?`).all(limit);
}
