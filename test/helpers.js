import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createUnconfiguredAdapter } from '../src/como/adapters.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { nowIso } from '../src/lib/time.js';
import { createSession, getProgramByCode } from '../src/services/programs.js';
import { registerUser, setSelected } from '../src/services/users.js';

const quiet = { info() {}, warn() {}, error(e) { console.error(e); } };

export const CONSENT = { version: 'test-v1', isDraft: false, items: [{ key: 'privacy', title: '개인정보 수집·이용 동의', required: true, body: '' }] };

export async function startApp({ como, cfg: overrides = {} } = {}) {
  const cfg = loadConfig({ NODE_ENV: 'test' }, { dbPath: ':memory:', consent: CONSENT, ...overrides });
  const db = openDb(':memory:');
  const sent = [];
  const sms = {
    kind: 'test', configured: true, devVisible: false,
    async send(phone, message) { sent.push({ phone, message }); return { ok: true }; },
  };
  const adapter = como || createUnconfiguredAdapter();
  const app = createApp({ db, cfg, sms, como: adapter, logger: quiet });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, cfg, sent, base, como: adapter,
    client: () => new Client(base, sent),
    close: () => new Promise((r) => server.close(r)),
  };
}

export class Client {
  constructor(base, sent) {
    this.base = base;
    this.sent = sent;
    this.cookies = new Map();
    this.csrf = null;
  }

  async request(method, path, form) {
    const headers = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) [].concat(v).forEach((x) => params.append(k, String(x)));
      body = params.toString();
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/Max-Age=0/.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
  }

  get(path) {
    return this.request('GET', path);
  }

  async post(path, form = {}, { csrf = true } = {}) {
    if (csrf && !this.csrf) await this.get('/login');
    return this.request('POST', path, csrf ? { _csrf: this.csrf, ...form } : form);
  }

  /** GET 후 리다이렉트를 따라간다 */
  async follow(res) {
    let r = res;
    for (let i = 0; i < 5 && r.location; i++) r = await this.get(r.location);
    return r;
  }

  lastCode(phone) {
    const m = [...this.sent].reverse().find((s) => s.phone === phone);
    return m && m.message.match(/(\d{6})/)[1];
  }

  /** 전화번호 인증 로그인 */
  async login(phone) {
    await this.get('/login');
    const r1 = await this.post('/login', { phone });
    if (r1.status !== 303) throw new Error(`login send failed: ${r1.status}`);
    await this.get('/verify');
    const r = await this.post('/verify', { code: this.lastCode(phone) });
    // 로그인 시 세션이 새로 발급되므로 CSRF 토큰을 다시 읽는다.
    if (r.location) await this.get(r.location);
    return r;
  }
}

export function addParticipant(db, { name = '참여자', phone, selected = false }) {
  const id = registerUser(db, { name, phone, region: '지역', consent: CONSENT, agreedKeys: ['privacy'] });
  if (selected) setSelected(db, null, id, true);
  return id;
}

export function addManager(db, phone = '01099990000', role = 'manager') {
  const now = nowIso();
  return Number(db.prepare(`INSERT INTO users (name, phone, phone_verified_at, role, created_at, updated_at)
    VALUES ('관리자', ?, ?, ?, ?, ?)`).run(phone, now, role, now, now).lastInsertRowid);
}

export function addSession(db, code, s = {}) {
  const p = getProgramByCode(db, code);
  return createSession(db, null, p.id, {
    round_no: null, date: null, start_time: null, end_time: null, place: null, capacity: null, is_closed: 0, is_cancelled: 0, ...s,
  });
}
