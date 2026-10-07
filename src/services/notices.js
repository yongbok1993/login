import { all, batch, get, run, stmt } from '../lib/db.js';
import { nowIso } from '../lib/time.js';
import { audit, auditStmt } from './audit.js';

export const AUDIENCE = { public: '전체 공개', participants: '선정 참여자만' };

/** 사용자가 볼 수 있는 공개 범위: 비로그인·미선정 → 전체 공개만, 선정 참여자·관리자 → 전부 */
export function audiencesFor(user) {
  if (user && (user.role !== 'participant' || user.is_selected)) return ['public', 'participants'];
  return ['public'];
}

export function listNotices(db, { audiences = ['public', 'participants'], limit = 100 } = {}) {
  return all(db, `SELECT n.*, u.name AS author FROM notices n LEFT JOIN users u ON u.id = n.created_by
    WHERE n.audience IN (SELECT value FROM json_each(?)) ORDER BY n.is_pinned DESC, n.created_at DESC LIMIT ?`,
  JSON.stringify(audiences), limit);
}

export async function getNotice(db, id, { audiences = ['public', 'participants'] } = {}) {
  const n = await get(db, 'SELECT * FROM notices WHERE id = ?', id);
  return n && audiences.includes(n.audience) ? n : null;
}

export function parseNoticeForm(body) {
  const str = (k) => String(Array.isArray(body[k]) ? body[k][0] ?? '' : body[k] ?? '');
  const value = {
    title: str('title').trim().slice(0, 120),
    body: str('body').replace(/\r\n/g, '\n').trim().slice(0, 10000),
    audience: str('audience'),
    is_pinned: str('is_pinned') === '1' ? 1 : 0,
  };
  const errors = {};
  if (!value.title) errors.title = '제목을 입력해 주세요.';
  if (!AUDIENCE[value.audience]) errors.audience = '공개 범위를 선택해 주세요.';
  return { value, errors };
}

export async function createNotice(db, actorId, n) {
  const now = nowIso();
  const meta = await run(db, `INSERT INTO notices (title, body, audience, is_pinned, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, n.title, n.body, n.audience, n.is_pinned, actorId, now, now);
  await audit(db, actorId, 'notice.create', 'notice', meta.last_row_id, { title: n.title, audience: n.audience });
  return meta.last_row_id;
}

export async function updateNotice(db, actorId, id, n) {
  await batch(db, [
    stmt(db, 'UPDATE notices SET title = ?, body = ?, audience = ?, is_pinned = ?, updated_at = ? WHERE id = ?',
      n.title, n.body, n.audience, n.is_pinned, nowIso(), id),
    auditStmt(db, actorId, 'notice.update', 'notice', id, { title: n.title, audience: n.audience }),
  ]);
}

export async function deleteNotice(db, actorId, id) {
  await batch(db, [
    stmt(db, 'DELETE FROM notices WHERE id = ?', id),
    auditStmt(db, actorId, 'notice.delete', 'notice', id),
  ]);
}
