import { hmac, numericCode, safeEqual } from '../lib/crypto.js';
import { get, run } from '../lib/db.js';
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
export async function issueOtp(db, secret, { phone, purpose, ip, dailyLimit = Infinity }, now = new Date()) {
  const t = now.getTime();
  const hourAgo = new Date(t - 3600 * 1000).toISOString();
  const last = await get(db, 'SELECT created_at FROM otp_codes WHERE phone = ? ORDER BY id DESC LIMIT 1', phone);
  if (last && t - Date.parse(last.created_at) < RESEND_INTERVAL_MS) return { ok: false, reason: 'rate_limited' };
  const byPhone = (await get(db, 'SELECT COUNT(*) n FROM otp_codes WHERE phone = ? AND created_at > ?', phone, hourAgo)).n;
  if (byPhone >= PHONE_HOURLY_LIMIT) return { ok: false, reason: 'rate_limited' };
  if (ip) {
    const byIp = (await get(db, 'SELECT COUNT(*) n FROM otp_codes WHERE ip = ? AND created_at > ?', ip, hourAgo)).n;
    if (byIp >= IP_HOURLY_LIMIT) return { ok: false, reason: 'rate_limited' };
  }
  // 전체 일일 발송 상한(문자 비용·대량 발송 남용 방지)
  const dayAgo = new Date(t - 24 * 3600 * 1000).toISOString();
  if ((await get(db, 'SELECT COUNT(*) n FROM otp_codes WHERE created_at > ?', dayAgo)).n >= dailyLimit) {
    return { ok: false, reason: 'daily_limit' };
  }
  const code = numericCode(6);
  const created = nowIso(now);
  // 같은 번호·목적의 이전 코드는 무효화한다.
  await run(db, 'UPDATE otp_codes SET consumed_at = ? WHERE phone = ? AND purpose = ? AND consumed_at IS NULL', created, phone, purpose);
  const meta = await run(db, `INSERT INTO otp_codes (phone, purpose, code_hash, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    phone, purpose, await hashCode(secret, phone, purpose, code), ip || null, created, addMs(created, OTP_TTL_MS));
  return { ok: true, code, id: meta.last_row_id };
}

export async function invalidateOtp(db, id) {
  await run(db, 'UPDATE otp_codes SET consumed_at = created_at WHERE id = ?', id);
}

/** 인증번호 확인. 결과: ok | expired | mismatch | too_many */
export async function verifyOtp(db, secret, { phone, purpose, code }, now = new Date()) {
  const row = await get(db, `SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY id DESC LIMIT 1`, phone, purpose);
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return 'expired';
  if (row.attempts >= OTP_MAX_ATTEMPTS) return 'too_many';
  const ok = typeof code === 'string' && /^\d{6}$/.test(code)
    && safeEqual(row.code_hash, await hashCode(secret, phone, purpose, code));
  if (!ok) {
    await run(db, 'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    return row.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'too_many' : 'mismatch';
  }
  // 동시에 같은 코드로 두 번 확인되지 않도록 조건부로 소모한다.
  const meta = await run(db, 'UPDATE otp_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', nowIso(now), row.id);
  return meta.changes === 1 ? 'ok' : 'expired';
}
