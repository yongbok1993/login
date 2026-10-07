import { all, batch, get, run, stmt } from '../lib/db.js';
import { nowIso } from '../lib/time.js';
import { audit } from '../services/audit.js';

/**
 * 전화번호 기준 꼬모 계정 매핑.
 * - 로그人 쪽 번호는 관리자가 확인한 번호만 쓴다(users.phone_confirmed_at). 문자 인증이 없으므로
 *   확인 전 번호로 조회하면 남의 번호를 입력한 사람이 그 번호의 상담 현황을 볼 수 있기 때문이다.
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
  return run(db, 'INSERT INTO como_sync_log (user_id, action, result, message, created_at) VALUES (?, ?, ?, ?, ?)',
    userId, action, result, message ?? null, nowIso());
}

async function saveLink(db, userId, fields) {
  const f = { external_id: null, phone_at_link: null, candidates: null, detail: null, linked_at: null, ...fields };
  // 연결 상태가 아니면 가져온 상담 현황을 함께 지운다(원자적).
  await batch(db, [
    stmt(db, `INSERT INTO como_links (user_id, status, external_id, phone_at_link, candidates, detail, checked_at, linked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, external_id = excluded.external_id,
        phone_at_link = excluded.phone_at_link, candidates = excluded.candidates, detail = excluded.detail,
        checked_at = excluded.checked_at, linked_at = excluded.linked_at`,
    userId, f.status, f.external_id, f.phone_at_link, f.candidates, f.detail, nowIso(), f.linked_at),
    f.status !== 'linked' ? stmt(db, 'DELETE FROM como_status WHERE user_id = ?', userId) : null,
  ]);
}

export function getLink(db, userId) {
  return get(db, 'SELECT * FROM como_links WHERE user_id = ?', userId);
}

function linkedToOther(db, externalId, userId) {
  return get(db, 'SELECT user_id FROM como_links WHERE external_id = ? AND user_id != ?', externalId, userId);
}

/** 한 사용자의 매핑 확인. 결과 상태 문자열 또는 'not_configured' */
export async function checkLink(db, adapter, user, actorId = null) {
  if (!adapter.configured) return 'not_configured';
  if (!user.phone_confirmed_at) return 'unconfirmed';
  const current = await getLink(db, user.id);
  // 연결된 상태에서 번호가 그대로면 다시 조회하지 않는다.
  if (current && current.status === 'linked' && current.phone_at_link === user.phone) return 'linked';

  let accounts;
  try {
    accounts = await adapter.findAccountsByPhone(user.phone);
  } catch (err) {
    await saveLink(db, user.id, { status: 'error', detail: 'lookup_failed' });
    await logSync(db, user.id, 'lookup', 'error', String(err.message || err).slice(0, 200));
    return 'error';
  }

  let result;
  if (accounts.length === 0) {
    await saveLink(db, user.id, { status: 'not_found' });
    result = 'not_found';
  } else if (accounts.length > 1) {
    await saveLink(db, user.id, { status: 'conflict', detail: 'multiple_accounts',
      candidates: JSON.stringify(accounts.map((a) => a.externalId)) });
    result = 'conflict';
  } else {
    const acct = accounts[0];
    if (await linkedToOther(db, acct.externalId, user.id)) {
      await saveLink(db, user.id, { status: 'conflict', detail: 'linked_to_other_user', candidates: JSON.stringify([acct.externalId]) });
      result = 'conflict';
    } else if (acct.name && normName(acct.name) !== normName(user.name)) {
      await saveLink(db, user.id, { status: 'conflict', detail: 'name_mismatch', candidates: JSON.stringify([acct.externalId]) });
      result = 'conflict';
    } else {
      try {
        await saveLink(db, user.id, { status: 'linked', external_id: acct.externalId, phone_at_link: user.phone, linked_at: nowIso() });
        result = 'linked';
      } catch {
        // UNIQUE(external_id): 동시에 다른 사용자와 연결된 경우
        await saveLink(db, user.id, { status: 'conflict', detail: 'linked_to_other_user', candidates: JSON.stringify([acct.externalId]) });
        result = 'conflict';
      }
    }
  }
  await logSync(db, user.id, 'lookup', result);
  if (actorId) await audit(db, actorId, 'como.check', 'user', user.id, { result });
  return result;
}

/**
 * 관리자 확정: 충돌 건을 관리자가 확인한 뒤 후보 중 하나로 연결한다.
 * 현재 번호로 다시 조회해 후보에 실제로 있는 계정인지, 다른 사용자와 연결돼 있지 않은지 확인한다.
 */
export async function confirmLink(db, adapter, user, externalId, actorId) {
  if (!adapter.configured) return 'not_configured';
  if (!user.phone_confirmed_at) return 'unconfirmed';
  let accounts;
  try {
    accounts = await adapter.findAccountsByPhone(user.phone);
  } catch {
    return 'error';
  }
  if (!accounts.some((a) => a.externalId === externalId)) return 'invalid';
  if (await linkedToOther(db, externalId, user.id)) return 'taken';
  await saveLink(db, user.id, { status: 'linked', external_id: externalId, phone_at_link: user.phone, linked_at: nowIso(),
    detail: 'admin_confirmed' });
  await logSync(db, user.id, 'confirm', 'linked');
  await audit(db, actorId, 'como.confirm', 'user', user.id, { externalId });
  return 'linked';
}

export async function unlink(db, userId, actorId) {
  await saveLink(db, userId, { status: 'needs_recheck', detail: 'admin_unlinked' });
  await logSync(db, userId, 'unlink', 'needs_recheck');
  await audit(db, actorId, 'como.unlink', 'user', userId);
}

/** 관리자 '다시 확인': 기존 연결을 무시하고 새로 조회한다. */
export async function recheck(db, adapter, user, actorId) {
  await run(db, "UPDATE como_links SET status = 'needs_recheck' WHERE user_id = ? AND status = 'linked'", user.id);
  return checkLink(db, adapter, user, actorId);
}

/** 상담 현황 동기화: 연결 상태이고 연결 당시 번호와 현재 번호가 같을 때만 */
export async function syncStatus(db, adapter, user) {
  if (!adapter.configured) return 'not_configured';
  if (!user.phone_confirmed_at) return 'not_linked';
  const link = await getLink(db, user.id);
  if (!link || link.status !== 'linked' || link.phone_at_link !== user.phone) return 'not_linked';
  let s;
  try {
    s = await adapter.getCounselingSummary(link.external_id);
  } catch (err) {
    await logSync(db, user.id, 'sync', 'error', String(err.message || err).slice(0, 200));
    return 'error';
  }
  const completed = Number.isInteger(s.completed) && s.completed >= 0 ? s.completed : null;
  const total = Number.isInteger(s.total) && s.total >= 0 ? s.total : null;
  if (completed === null) {
    await logSync(db, user.id, 'sync', 'error', 'invalid_summary');
    return 'error';
  }
  await run(db, `INSERT INTO como_status (user_id, external_id, total_sessions, completed_sessions, next_at, source,
      remote_updated_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET external_id = excluded.external_id, total_sessions = excluded.total_sessions,
      completed_sessions = excluded.completed_sessions, next_at = excluded.next_at, source = excluded.source,
      remote_updated_at = excluded.remote_updated_at, synced_at = excluded.synced_at`,
  user.id, link.external_id, total, completed, s.nextAt || null, adapter.source, s.updatedAt || null, nowIso());
  await logSync(db, user.id, 'sync', 'ok');
  return 'ok';
}

/**
 * 참여자 화면용 상담 현황.
 * 미연결·연동 실패·번호 불일치에서는 수치를 만들지 않고 { state: 'unavailable' }만 돌려준다.
 */
export async function counselingView(db, adapter, user) {
  if (!adapter.configured || !user.phone_confirmed_at) return { state: 'unavailable' };
  const link = await getLink(db, user.id);
  if (!link || link.status !== 'linked' || link.phone_at_link !== user.phone) return { state: 'unavailable' };
  const st = await get(db, 'SELECT * FROM como_status WHERE user_id = ? AND external_id = ?', user.id, link.external_id);
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
  if (!adapter.configured || !user.phone_confirmed_at) return;
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const link = await getLink(db, user.id);
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
  const st = await get(db, 'SELECT synced_at FROM como_status WHERE user_id = ?', user.id);
  if (st && !stale(st.synced_at)) return;
  await syncStatus(db, adapter, user);
}

export function comoOverview(db) {
  return Promise.all([
    all(db, `SELECT u.id, u.name, u.phone, l.status, l.detail, l.checked_at FROM users u
      LEFT JOIN como_links l ON l.user_id = u.id WHERE u.role = 'participant' AND u.is_selected = 1
      ORDER BY CASE l.status WHEN 'conflict' THEN 0 WHEN 'error' THEN 1 WHEN 'needs_recheck' THEN 2 ELSE 3 END, u.name`),
    all(db, `SELECT g.*, u.name FROM como_sync_log g LEFT JOIN users u ON u.id = g.user_id ORDER BY g.id DESC LIMIT 100`),
  ]);
}
