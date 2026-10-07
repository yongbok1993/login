import { get, run } from '../lib/db.js';
import { nowIso } from '../lib/time.js';

// 로그인·등록 시도 제한
export const PHONE_MAX_FAILS = 5; // 번호별 30분 내 실패 5회 → 잠금
export const PHONE_LOCK_MINUTES = 30;
const IP_MAX_FAILS_PER_HOUR = 30; // IP별 1시간 내 실패(여러 번호에 같은 PIN 대입 방지)
const IP_MAX_REGISTER_PER_HOUR = 10;

const ago = (ms) => new Date(Date.now() - ms).toISOString();

export function recordAttempt(db, { kind, phone = null, ip = null, success }) {
  return run(db, 'INSERT INTO login_attempts (kind, phone, ip, success, created_at) VALUES (?, ?, ?, ?, ?)',
    kind, phone, ip, success ? 1 : 0, nowIso());
}

/** 로그인 차단 사유: 'phone_locked' | 'ip_limited' | null. 계정 존재 여부와 무관하게 판단한다. */
export async function loginBlock(db, { phone, ip }) {
  if (phone) {
    const since = ago(PHONE_LOCK_MINUTES * 60 * 1000);
    // 마지막 성공 이후의 실패만 센다.
    const n = (await get(db, `SELECT COUNT(*) n FROM login_attempts WHERE kind IN ('login', 'pin') AND phone = ? AND success = 0
      AND created_at > ? AND created_at > COALESCE((SELECT MAX(created_at) FROM login_attempts
        WHERE kind IN ('login', 'pin') AND phone = ? AND success = 1), '')`, phone, since, phone)).n;
    if (n >= PHONE_MAX_FAILS) return 'phone_locked';
  }
  if (ip) {
    const n = (await get(db, "SELECT COUNT(*) n FROM login_attempts WHERE kind = 'login' AND ip = ? AND success = 0 AND created_at > ?",
      ip, ago(3600 * 1000))).n;
    if (n >= IP_MAX_FAILS_PER_HOUR) return 'ip_limited';
  }
  return null;
}

export async function registerBlocked(db, ip) {
  if (!ip) return false;
  return (await get(db, "SELECT COUNT(*) n FROM login_attempts WHERE kind = 'register' AND ip = ? AND created_at > ?",
    ip, ago(3600 * 1000))).n >= IP_MAX_REGISTER_PER_HOUR;
}

/** 관리자 PIN 초기화 시 잠금 해제 */
export function clearPhoneFailures(db, phone) {
  return run(db, "DELETE FROM login_attempts WHERE kind IN ('login', 'pin') AND phone = ? AND success = 0", phone);
}
