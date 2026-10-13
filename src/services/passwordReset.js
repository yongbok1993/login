import { sha256 } from '../lib/crypto.js';
import { batch, get, stmt } from '../lib/db.js';
import { addMs, nowIso } from '../lib/time.js';
import { auditStmt } from './audit.js';

// 비밀번호를 잊었을 때: 담당자가 본인 확인 후 1회용 재설정 코드를 발급하고, 본인이 코드로 새 비밀번호를 정한다.
// 담당자는 비밀번호를 보거나 정하지 않는다. 코드는 해시만 저장하고 24시간 뒤 만료된다.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_MS = 24 * 3600 * 1000;

function randomCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const s = [...a].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeResetCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const hashCode = (userId, code) => sha256(`reset:v1:${userId}:${normalizeResetCode(code)}`);

/** 새 코드 발급(이전에 발급한 미사용 코드는 무효). 코드 원문을 돌려준다(화면에 한 번만 표시). */
export async function issueResetCode(db, actorId, userId) {
  const code = randomCode();
  const now = nowIso();
  await batch(db, [
    stmt(db, 'UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', now, userId),
    stmt(db, 'INSERT INTO password_resets (user_id, code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      userId, await hashCode(userId, code), actorId, now, addMs(now, VALID_MS)),
    auditStmt(db, actorId, 'user.reset_code', 'user', userId),
  ]);
  return code;
}

/** 유효한 코드면 재설정 행, 아니면 null */
export async function findValidReset(db, userId, code) {
  if (normalizeResetCode(code).length !== 8) return null;
  return get(db, `SELECT * FROM password_resets WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ?
    ORDER BY id DESC LIMIT 1`, userId, await hashCode(userId, code), nowIso());
}

/** 코드 사용 처리와 새 비밀번호 저장을 한 번에. 기존 PIN·로그인 세션은 모두 무효로 한다. */
export async function completeReset(db, reset, passwordHash) {
  const now = nowIso();
  const res = await batch(db, [
    stmt(db, 'UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL', now, reset.id),
    stmt(db, `UPDATE users SET password_hash = ?, password_must_change = 0, password_updated_at = ?, pin_hash = NULL, pin_must_change = 0,
      updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM password_resets WHERE id = ? AND used_at = ?)`,
    passwordHash, now, now, reset.user_id, reset.id, now),
    stmt(db, 'DELETE FROM auth_sessions WHERE user_id = ?', reset.user_id),
    auditStmt(db, reset.user_id, 'user.password_reset', 'user', reset.user_id),
  ]);
  return res[0].meta.changes === 1;
}
