import { randomToken, safeEqual, sha256 } from './crypto.js';
import { addMs, nowIso } from './time.js';

export const COOKIE = 'li_sid';
const DAY = 24 * 3600 * 1000;
const ANON_TTL = DAY;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!out[k]) {
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
    }
  }
  return out;
}

function setCookie(res, cfg, token, maxAgeMs) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (cfg.isProd) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * DB 기반 세션. 쿠키에는 무작위 토큰만, DB에는 해시만 저장한다.
 * 로그인 세션은 마지막 사용 후 sessionIdleDays 동안 유지(최대 sessionMaxDays)해 프로그램마다 재인증하지 않게 한다.
 */
export function sessionMiddleware(db, cfg) {
  const idleMs = cfg.sessionIdleDays * DAY;
  const maxMs = cfg.sessionMaxDays * DAY;
  const get = db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?');
  const touch = db.prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?');
  const del = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
  const insert = db.prepare(`INSERT INTO auth_sessions (token_hash, user_id, csrf, data, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const saveData = db.prepare('UPDATE auth_sessions SET data = ? WHERE token_hash = ?');

  function create(res, userId = null, data = {}) {
    const token = randomToken();
    const now = nowIso();
    const ttl = userId ? idleMs : ANON_TTL;
    const row = { token_hash: sha256(token), user_id: userId, csrf: randomToken(24), data: JSON.stringify(data),
      created_at: now, last_seen_at: now, expires_at: addMs(now, ttl) };
    insert.run(row.token_hash, row.user_id, row.csrf, row.data, row.created_at, row.last_seen_at, row.expires_at);
    setCookie(res, cfg, token, ttl);
    return row;
  }

  return function session(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    let row = token ? get.get(sha256(token)) : null;
    const now = Date.now();
    if (row && (Date.parse(row.expires_at) <= now || (row.user_id && now - Date.parse(row.created_at) > maxMs))) {
      del.run(row.token_hash);
      row = null;
    }
    if (row && row.user_id) {
      // 마지막 갱신 후 한 시간이 지난 경우에만 만료 시각을 연장(쓰기 횟수 절감)
      if (now - Date.parse(row.last_seen_at) > 3600 * 1000) {
        const t = nowIso();
        touch.run(t, addMs(t, idleMs), row.token_hash);
        setCookie(res, cfg, token, idleMs);
      }
    }
    if (!row) row = create(res);

    let data = {};
    try { data = JSON.parse(row.data); } catch { /* ignore */ }

    req.session = {
      tokenHash: row.token_hash,
      userId: row.user_id,
      csrf: row.csrf,
      data,
      save() { saveData.run(JSON.stringify(this.data), this.tokenHash); },
      /** 로그인·권한 변경 시 세션 ID를 새로 발급한다(세션 고정 방지). */
      regenerate(userId, keep = {}) {
        del.run(this.tokenHash);
        const fresh = create(res, userId, keep);
        Object.assign(this, { tokenHash: fresh.token_hash, userId, csrf: fresh.csrf, data: keep });
      },
      destroy() {
        del.run(this.tokenHash);
        res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cfg.isProd ? '; Secure' : ''}`);
      },
      flash(type, message) {
        this.data.flash = { type, message };
        this.save();
      },
      takeFlash() {
        const f = this.data.flash;
        if (f) { delete this.data.flash; this.save(); }
        return f || null;
      },
    };
    next();
  };
}

export function csrfMiddleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const token = req.body && req.body._csrf;
  if (!safeEqual(token, req.session.csrf)) {
    res.status(403);
    return next(Object.assign(new Error('csrf'), { status: 403, expose: '요청이 만료되었습니다. 페이지를 새로 열어 다시 시도해 주세요.' }));
  }
  next();
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowIso());
}
