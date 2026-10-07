import { randomToken, safeEqual, sha256 } from './crypto.js';
import { get, run } from './db.js';
import { addMs, nowIso } from './time.js';

export const COOKIE = 'li_sid';
const DAY = 24 * 3600 * 1000;
const ANON_TTL = DAY;
const TOUCH_INTERVAL = 3600 * 1000;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) {
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
    }
  }
  return out;
}

/**
 * D1 기반 세션. 쿠키에는 무작위 토큰만, DB에는 해시만 저장한다.
 * 로그인 세션은 마지막 사용 후 sessionIdleDays 동안 유지(최대 sessionMaxDays)해 프로그램마다 재인증하지 않게 한다.
 * 비로그인 세션은 폼을 표시하거나 데이터를 저장할 때만 만든다.
 */
export class Session {
  constructor(c) {
    this.c = c;
    this.row = null;
    this.data = {};
  }

  get userId() { return this.row ? this.row.user_id : null; }
  get csrf() { return this.row ? this.row.csrf : null; }
  get tokenHash() { return this.row ? this.row.token_hash : null; }

  setCookie(token, maxAgeMs) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (this.c.cfg.isProd) parts.push('Secure');
    this.c.resHeaders.append('Set-Cookie', parts.join('; '));
  }

  async load() {
    const { db, cfg } = this.c;
    const token = parseCookies(this.c.req.headers.get('cookie'))[COOKIE];
    if (!token) return;
    let row = await get(db, 'SELECT * FROM auth_sessions WHERE token_hash = ?', await sha256(token));
    const now = Date.now();
    if (row && (Date.parse(row.expires_at) <= now || (row.user_id && now - Date.parse(row.created_at) > cfg.sessionMaxDays * DAY))) {
      await run(db, 'DELETE FROM auth_sessions WHERE token_hash = ?', row.token_hash);
      row = null;
    }
    if (row && row.user_id && now - Date.parse(row.last_seen_at) > TOUCH_INTERVAL) {
      const t = nowIso();
      const idle = cfg.sessionIdleDays * DAY;
      await run(db, 'UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?', t, addMs(t, idle), row.token_hash);
      this.setCookie(token, idle);
    }
    this.row = row;
    try { this.data = row ? JSON.parse(row.data) : {}; } catch { this.data = {}; }
  }

  async create(userId = null, data = {}) {
    const token = randomToken();
    const now = nowIso();
    const ttl = userId ? this.c.cfg.sessionIdleDays * DAY : ANON_TTL;
    const row = { token_hash: await sha256(token), user_id: userId, csrf: randomToken(24), data: JSON.stringify(data),
      created_at: now, last_seen_at: now, expires_at: addMs(now, ttl) };
    await run(this.c.db, `INSERT INTO auth_sessions (token_hash, user_id, csrf, data, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, row.token_hash, row.user_id, row.csrf, row.data, row.created_at, row.last_seen_at, row.expires_at);
    this.setCookie(token, ttl);
    this.row = row;
    this.data = data;
  }

  async ensure() {
    if (!this.row) await this.create();
  }

  async save() {
    await this.ensure();
    await run(this.c.db, 'UPDATE auth_sessions SET data = ? WHERE token_hash = ?', JSON.stringify(this.data), this.row.token_hash);
  }

  /** 로그인·권한 변경 시 세션 ID를 새로 발급한다(세션 고정 방지). */
  async regenerate(userId, keep = {}) {
    if (this.row) await run(this.c.db, 'DELETE FROM auth_sessions WHERE token_hash = ?', this.row.token_hash);
    await this.create(userId, keep);
  }

  async destroy() {
    if (this.row) await run(this.c.db, 'DELETE FROM auth_sessions WHERE token_hash = ?', this.row.token_hash);
    this.row = null;
    this.data = {};
    this.c.resHeaders.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.c.cfg.isProd ? '; Secure' : ''}`);
  }

  async flash(type, message) {
    this.data.flash = { type, message };
    await this.save();
  }

  async takeFlash() {
    const f = this.data.flash;
    if (f) {
      delete this.data.flash;
      await this.save();
    }
    return f || null;
  }

  checkCsrf(token) {
    return !!this.row && safeEqual(token, this.row.csrf);
  }
}

export async function purgeExpired(db) {
  const now = nowIso();
  await run(db, 'DELETE FROM auth_sessions WHERE expires_at <= ?', now);
  await run(db, 'DELETE FROM login_attempts WHERE created_at < ?', new Date(Date.now() - DAY).toISOString());
}
