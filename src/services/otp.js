import { hmac, numericCode, safeEqual } from '../lib/crypto.js';
import { addMs, nowIso } from '../lib/time.js';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const RESEND_INTERVAL_MS = 60 * 1000;
const PHONE_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;

function hashCode(secret, phone, purpose, code) {
  return hmac(secret, `${phone}:${purpose}:${code}`);
}

/** 인증번호 발급. 발송 제한을 넘으면 { ok:false, reason:'rate_limited' } */
export function issueOtp(db, secret, { phone, purpose, ip }, now = new Date()) {
  const t = now.getTime();
  const hourAgo = new Date(t - 3600 * 1000).toISOString();
  const last = db.prepare('SELECT created_at FROM otp_codes WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
  if (last && t - Date.parse(last.created_at) < RESEND_INTERVAL_MS) return { ok: false, reason: 'rate_limited' };
  const byPhone = db.prepare('SELECT COUNT(*) n FROM otp_codes WHERE phone = ? AND created_at > ?').get(phone, hourAgo).n;
  if (byPhone >= PHONE_HOURLY_LIMIT) return { ok: false, reason: 'rate_limited' };
  if (ip) {
    const byIp = db.prepare('SELECT COUNT(*) n FROM otp_codes WHERE ip = ? AND created_at > ?').get(ip, hourAgo).n;
    if (byIp >= IP_HOURLY_LIMIT) return { ok: false, reason: 'rate_limited' };
  }
  const code = numericCode(6);
  const created = nowIso(now);
  // 같은 번호·목적의 이전 코드는 무효화한다.
  db.prepare('UPDATE otp_codes SET consumed_at = ? WHERE phone = ? AND purpose = ? AND consumed_at IS NULL').run(created, phone, purpose);
  const info = db.prepare(`INSERT INTO otp_codes (phone, purpose, code_hash, ip, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(phone, purpose, hashCode(secret, phone, purpose, code), ip || null, created, addMs(created, OTP_TTL_MS));
  return { ok: true, code, id: info.lastInsertRowid };
}

/** 인증번호 확인. 결과: ok | expired | mismatch | too_many */
export function verifyOtp(db, secret, { phone, purpose, code }, now = new Date()) {
  const row = db.prepare(`SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY id DESC LIMIT 1`).get(phone, purpose);
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return 'expired';
  if (row.attempts >= OTP_MAX_ATTEMPTS) return 'too_many';
  const ok = typeof code === 'string' && /^\d{6}$/.test(code)
    && safeEqual(row.code_hash, hashCode(secret, phone, purpose, code));
  if (!ok) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return row.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'too_many' : 'mismatch';
  }
  db.prepare('UPDATE otp_codes SET consumed_at = ? WHERE id = ?').run(nowIso(now), row.id);
  return 'ok';
}

export function purgeOldOtps(db, now = new Date()) {
  db.prepare('DELETE FROM otp_codes WHERE created_at < ?').run(new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
}
