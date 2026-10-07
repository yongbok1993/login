import { nowIso } from '../lib/time.js';
import { audit } from './audit.js';
import { autoAssignLink, cancelUpcomingOnDeselect } from './enrollments.js';

export function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function findUserByPhone(db, phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
}

/**
 * 최초 등록: 사용자·접수·동의 이력을 한 번에 만든다.
 * 같은 번호로 이미 계정이 있으면 새로 만들지 않고 null을 돌려준다.
 */
export function registerUser(db, { name, phone, region, consent, agreedKeys }) {
  const now = nowIso();
  return db.transaction(() => {
    if (findUserByPhone(db, phone)) return null;
    const userId = Number(db.prepare(`INSERT INTO users (name, phone, phone_verified_at, region, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(name, phone, now, region, now, now).lastInsertRowid);
    db.prepare(`INSERT INTO registrations (user_id, registered_at, updated_at) VALUES (?, ?, ?)`).run(userId, now, now);
    const ins = db.prepare(`INSERT INTO consents (user_id, purpose, agreed, doc_version, agreed_at) VALUES (?, ?, ?, ?, ?)`);
    for (const item of consent.items) ins.run(userId, item.key, agreedKeys.includes(item.key) ? 1 : 0, consent.version, now);
    return userId;
  })();
}

export function updateProfile(db, userId, { name, region }) {
  db.prepare('UPDATE users SET name = ?, region = ?, updated_at = ? WHERE id = ?').run(name, region, nowIso(), userId);
}

/**
 * 전화번호 변경(새 번호 인증 후 호출).
 * 꼬모 연결은 해제하고 재확인 대상으로 돌리며, 가져온 상담 현황도 지운다.
 * 현재 세션을 제외한 다른 로그인 세션은 모두 종료한다.
 */
export function changePhone(db, userId, newPhone, keepTokenHash) {
  const now = nowIso();
  return db.transaction(() => {
    const taken = findUserByPhone(db, newPhone);
    if (taken && taken.id !== userId) return false;
    db.prepare('UPDATE users SET phone = ?, phone_verified_at = ?, updated_at = ? WHERE id = ?').run(newPhone, now, now, userId);
    db.prepare(`UPDATE como_links SET status = 'needs_recheck', external_id = NULL, phone_at_link = NULL, candidates = NULL,
      detail = 'phone_changed', checked_at = ?, linked_at = NULL WHERE user_id = ?`).run(now, userId);
    db.prepare('DELETE FROM como_status WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?').run(userId, keepTokenHash);
    audit(db, userId, 'user.phone_change', 'user', userId);
    return true;
  })();
}

export function listConsents(db, userId) {
  return db.prepare('SELECT * FROM consents WHERE user_id = ? ORDER BY id').all(userId);
}

// ── 관리자 ─────────────────────────────────────────────

export const INTERNAL_STATUS = {
  received: '접수',
  reviewing: '검토',
  selected: '선정',
  not_selected: '미선정',
  released: '선정 해제',
};

export function listRegistrants(db, { status = '' } = {}) {
  const where = ["u.role = 'participant'"];
  const params = [];
  if (status && INTERNAL_STATUS[status]) { where.push('r.internal_status = ?'); params.push(status); }
  return db.prepare(`SELECT u.*, r.registered_at, r.internal_status, l.status AS como_status
    FROM users u JOIN registrations r ON r.user_id = u.id LEFT JOIN como_links l ON l.user_id = u.id
    WHERE ${where.join(' AND ')} ORDER BY r.registered_at DESC`).all(...params);
}

export function listSelectedParticipants(db) {
  return db.prepare("SELECT * FROM users WHERE role = 'participant' AND is_selected = 1 ORDER BY name").all();
}

export function getRegistration(db, userId) {
  return db.prepare('SELECT * FROM registrations WHERE user_id = ?').get(userId);
}

export function setInternalStatus(db, actorId, userId, status) {
  if (!INTERNAL_STATUS[status] || status === 'selected' || status === 'released') return false;
  const user = getUser(db, userId);
  if (!user || user.role !== 'participant' || user.is_selected) return false;
  db.prepare('UPDATE registrations SET internal_status = ?, updated_at = ? WHERE user_id = ?').run(status, nowIso(), userId);
  audit(db, actorId, 'registration.status', 'user', userId, { status });
  return true;
}

/** 선정·해제. 선정 시 Link 전체 자동 배정, 해제 시 예정 배정 취소. */
export function setSelected(db, actorId, userId, selected) {
  const user = getUser(db, userId);
  if (!user || user.role !== 'participant') return null;
  const now = nowIso();
  return db.transaction(() => {
    if (selected) {
      db.prepare('UPDATE users SET is_selected = 1, selected_at = ?, updated_at = ? WHERE id = ?').run(now, now, userId);
      db.prepare("UPDATE registrations SET internal_status = 'selected', updated_at = ? WHERE user_id = ?").run(now, userId);
      const r = autoAssignLink(db, { userId });
      audit(db, actorId, 'participant.select', 'user', userId, r);
      return r;
    }
    db.prepare('UPDATE users SET is_selected = 0, updated_at = ? WHERE id = ?').run(now, userId);
    db.prepare("UPDATE registrations SET internal_status = 'released', updated_at = ? WHERE user_id = ?").run(now, userId);
    const cancelled = cancelUpcomingOnDeselect(db, userId);
    audit(db, actorId, 'participant.release', 'user', userId, { cancelled });
    return { cancelled };
  })();
}
