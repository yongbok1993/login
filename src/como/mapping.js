import { nowIso } from '../lib/time.js';
import { audit } from '../services/audit.js';

/**
 * 전화번호 기준 꼬모 계정 매핑.
 * - 로그人 쪽 번호는 인증된 번호만 쓴다(users.phone은 인증 후에만 저장된다).
 * - 꼬모 계정이 0개: not_found, 2개 이상: conflict(자동 연결 중단, 관리자 확인).
 * - 같은 꼬모 계정이 이미 다른 사용자와 연결돼 있거나 이름이 다르면 conflict.
 * - 확인된 연결은 내부 사용자 ID로 저장하고 연결 당시 번호를 함께 보관한다.
 * 번호 매핑은 통합 로그인이 아니다. 꼬모 쪽 인증을 대신하지 않는다.
 */

export const LINK_STATUS = {
  linked: '연결됨',
  not_found: '꼬모 계정 없음',
  conflict: '관리자 확인 필요',
  needs_recheck: '재확인 필요',
  error: '연동 오류',
};

function normName(s) {
  return String(s || '').replace(/\s+/g, '');
}

function logSync(db, userId, action, result, message) {
  db.prepare('INSERT INTO como_sync_log (user_id, action, result, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, action, result, message ?? null, nowIso());
}

function saveLink(db, userId, fields) {
  const now = nowIso();
  db.prepare(`INSERT INTO como_links (user_id, status, external_id, phone_at_link, candidates, detail, checked_at, linked_at)
    VALUES (@user_id, @status, @external_id, @phone_at_link, @candidates, @detail, @now, @linked_at)
    ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, external_id = excluded.external_id,
      phone_at_link = excluded.phone_at_link, candidates = excluded.candidates, detail = excluded.detail,
      checked_at = excluded.checked_at, linked_at = excluded.linked_at`).run({
    user_id: userId, external_id: null, phone_at_link: null, candidates: null, detail: null, linked_at: null, ...fields, now,
  });
  if (fields.status !== 'linked') db.prepare('DELETE FROM como_status WHERE user_id = ?').run(userId);
}

export function getLink(db, userId) {
  return db.prepare('SELECT * FROM como_links WHERE user_id = ?').get(userId);
}

/** 한 사용자의 매핑 확인. 결과 상태 문자열 또는 'not_configured' */
export async function checkLink(db, adapter, user, actorId = null) {
  if (!adapter.configured) return 'not_configured';
  const current = getLink(db, user.id);
  // 연결된 상태에서 번호가 그대로면 다시 조회하지 않는다.
  if (current && current.status === 'linked' && current.phone_at_link === user.phone) return 'linked';

  let accounts;
  try {
    accounts = await adapter.findAccountsByPhone(user.phone);
  } catch (err) {
    saveLink(db, user.id, { status: 'error', detail: 'lookup_failed' });
    logSync(db, user.id, 'lookup', 'error', String(err.message || err).slice(0, 200));
    return 'error';
  }

  let result;
  if (accounts.length === 0) {
    saveLink(db, user.id, { status: 'not_found' });
    result = 'not_found';
  } else if (accounts.length > 1) {
    saveLink(db, user.id, { status: 'conflict', detail: 'multiple_accounts',
      candidates: JSON.stringify(accounts.map((a) => a.externalId)) });
    result = 'conflict';
  } else {
    const acct = accounts[0];
    const other = db.prepare('SELECT user_id FROM como_links WHERE external_id = ? AND user_id != ?').get(acct.externalId, user.id);
    if (other) {
      saveLink(db, user.id, { status: 'conflict', detail: 'linked_to_other_user', candidates: JSON.stringify([acct.externalId]) });
      result = 'conflict';
    } else if (acct.name && normName(acct.name) !== normName(user.name)) {
      saveLink(db, user.id, { status: 'conflict', detail: 'name_mismatch', candidates: JSON.stringify([acct.externalId]) });
      result = 'conflict';
    } else {
      saveLink(db, user.id, { status: 'linked', external_id: acct.externalId, phone_at_link: user.phone, linked_at: nowIso() });
      result = 'linked';
    }
  }
  logSync(db, user.id, 'lookup', result);
  if (actorId) audit(db, actorId, 'como.check', 'user', user.id, { result });
  return result;
}

/**
 * 관리자 확정: 충돌 건을 관리자가 확인한 뒤 후보 중 하나로 연결한다.
 * 현재 번호로 다시 조회해 후보에 실제로 있는 계정인지, 다른 사용자와 연결돼 있지 않은지 확인한다.
 */
export async function confirmLink(db, adapter, user, externalId, actorId) {
  if (!adapter.configured) return 'not_configured';
  let accounts;
  try {
    accounts = await adapter.findAccountsByPhone(user.phone);
  } catch {
    return 'error';
  }
  if (!accounts.some((a) => a.externalId === externalId)) return 'invalid';
  const other = db.prepare('SELECT user_id FROM como_links WHERE external_id = ? AND user_id != ?').get(externalId, user.id);
  if (other) return 'taken';
  saveLink(db, user.id, { status: 'linked', external_id: externalId, phone_at_link: user.phone, linked_at: nowIso(),
    detail: 'admin_confirmed' });
  logSync(db, user.id, 'confirm', 'linked');
  audit(db, actorId, 'como.confirm', 'user', user.id, { externalId });
  return 'linked';
}

export function unlink(db, userId, actorId) {
  saveLink(db, userId, { status: 'needs_recheck', detail: 'admin_unlinked' });
  logSync(db, userId, 'unlink', 'needs_recheck');
  audit(db, actorId, 'como.unlink', 'user', userId);
}

/** 상담 현황 동기화: 연결 상태이고 연결 당시 번호와 현재 번호가 같을 때만 */
export async function syncStatus(db, adapter, user) {
  if (!adapter.configured) return 'not_configured';
  const link = getLink(db, user.id);
  if (!link || link.status !== 'linked' || link.phone_at_link !== user.phone) return 'not_linked';
  let s;
  try {
    s = await adapter.getCounselingSummary(link.external_id);
  } catch (err) {
    logSync(db, user.id, 'sync', 'error', String(err.message || err).slice(0, 200));
    return 'error';
  }
  const completed = Number.isInteger(s.completed) && s.completed >= 0 ? s.completed : null;
  const total = Number.isInteger(s.total) && s.total >= 0 ? s.total : null;
  if (completed === null) {
    logSync(db, user.id, 'sync', 'error', 'invalid_summary');
    return 'error';
  }
  db.prepare(`INSERT INTO como_status (user_id, external_id, total_sessions, completed_sessions, next_at, source,
      remote_updated_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET external_id = excluded.external_id, total_sessions = excluded.total_sessions,
      completed_sessions = excluded.completed_sessions, next_at = excluded.next_at, source = excluded.source,
      remote_updated_at = excluded.remote_updated_at, synced_at = excluded.synced_at`)
    .run(user.id, link.external_id, total, completed, s.nextAt || null, adapter.source, s.updatedAt || null, nowIso());
  logSync(db, user.id, 'sync', 'ok');
  return 'ok';
}

/**
 * 참여자 화면용 상담 현황.
 * 미연결·연동 실패·번호 불일치에서는 수치를 만들지 않고 { state: 'unavailable' }만 돌려준다.
 */
export function counselingView(db, adapter, user) {
  if (!adapter.configured) return { state: 'unavailable' };
  const link = getLink(db, user.id);
  if (!link || link.status !== 'linked' || link.phone_at_link !== user.phone) return { state: 'unavailable' };
  const st = db.prepare('SELECT * FROM como_status WHERE user_id = ? AND external_id = ?').get(user.id, link.external_id);
  if (!st || st.source !== adapter.source) return { state: 'unavailable' };
  const total = st.total_sessions;
  return {
    state: 'available',
    completed: st.completed_sessions,
    total,
    progress: total && total > 0 ? Math.min(1, st.completed_sessions / total) : null,
    nextAt: st.next_at,
    syncedAt: st.synced_at,
    isMock: st.source === 'mock',
  };
}

/**
 * 조회 시 오래된 현황이면 갱신을 시도한다. 실패해도 화면은 counselingView 결과를 따른다.
 * 충돌·오류 건과 관리자가 해제한 연결은 자동으로 다시 연결하지 않는다(관리자 확인).
 */
export async function refreshIfStale(db, adapter, user, maxAgeMinutes) {
  if (!adapter.configured) return;
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const link = getLink(db, user.id);
  const stale = (iso) => !iso || Date.now() - Date.parse(iso) >= maxAgeMs;
  const needsCheck = !link
    || (link.status === 'needs_recheck' && link.detail !== 'admin_unlinked')
    || (link.status === 'not_found' && stale(link.checked_at))
    || (link.status === 'linked' && link.phone_at_link !== user.phone);
  if (needsCheck) {
    if ((await checkLink(db, adapter, user)) !== 'linked') return;
  } else if (link.status !== 'linked') {
    return;
  }
  const st = db.prepare('SELECT synced_at FROM como_status WHERE user_id = ?').get(user.id);
  if (st && !stale(st.synced_at)) return;
  await syncStatus(db, adapter, user);
}
