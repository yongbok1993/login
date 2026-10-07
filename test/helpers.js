import { createApp } from '../src/app.js';
import { createUnconfiguredAdapter } from '../src/como/adapters.js';
import { loadConfig } from '../src/config.js';
import { nowIso } from '../src/lib/time.js';
import { createSession, getProgramByCode } from '../src/services/programs.js';
import { registerUser, setSelected } from '../src/services/users.js';
import { all, get, run } from '../src/lib/db.js';
import { createD1, migrationStatements } from './d1-shim.js';

const quiet = { info() {}, warn() {}, error(e) { console.error(e); } };

export const CONSENT = { version: 'test-v1', isDraft: false, items: [{ key: 'privacy', title: '개인정보 수집·이용 동의', required: true, body: '' }] };

export async function startApp({ como, cfg: overrides = {} } = {}) {
  const cfg = loadConfig({ APP_ENV: 'test' }, { consent: CONSENT, ...overrides });
  const { db, dispose } = await openTestDb();
  const sent = [];
  const sms = {
    kind: 'test', configured: true, devVisible: false,
    async send(phone, message) { sent.push({ phone, message }); return { ok: true }; },
  };
  const adapter = como || createUnconfiguredAdapter();
  const app = createApp({ resolveDeps: () => ({ cfg, db, sms, como: adapter, logger: quiet }) });
  return {
    db, cfg, sent, como: adapter, app,
    sql: { get: (q, ...p) => get(db, q, ...p), all: (q, ...p) => all(db, q, ...p), run: (q, ...p) => run(db, q, ...p) },
    client: () => new Client(app, sent),
    close: dispose,
  };
}

export class Client {
  constructor(app, sent) {
    this.app = app;
    this.sent = sent;
    this.cookies = new Map();
    this.csrf = null;
  }

  async request(method, path, form) {
    const headers = new Headers();
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    let body;
    if (form) {
      headers.set('content-type', 'application/x-www-form-urlencoded');
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) [].concat(v).forEach((x) => params.append(k, String(x)));
      body = params.toString();
    }
    const res = await this.app.fetch(new Request(`https://login.test${path}`, { method, headers, body }), {}, {});
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      if (/Max-Age=0/.test(c)) this.cookies.delete(k); else this.cookies.set(k, pair.slice(i + 1));
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
  return registerUser(db, { name, phone, address: '주소', birthDate: '1970-01-01', consent: CONSENT, agreedKeys: ['privacy'] })
    .then(async (id) => {
      if (selected) await setSelected(db, null, id, true);
      return id;
    });
}

export async function addManager(db, phone = '01099990000', role = 'manager') {
  const now = nowIso();
  return (await run(db, `INSERT INTO users (name, phone, phone_verified_at, role, created_at, updated_at)
    VALUES ('관리자', ?, ?, ?, ?, ?)`, phone, now, role, now, now)).last_row_id;
}

/**
 * 테스트 DB: 기본은 better-sqlite3 기반 D1 호환 객체(빠름).
 * TEST_D1=miniflare면 wrangler의 로컬 D1(workerd)을 써서 실제 D1 동작으로 검증한다.
 */
async function openTestDb() {
  if (process.env.TEST_D1 !== 'miniflare') {
    const db = createD1();
    return { db, dispose: async () => db.sqlite.close() };
  }
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { getPlatformProxy } = await import('wrangler');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-d1-'));
  const configPath = path.join(dir, 'wrangler.toml');
  fs.writeFileSync(configPath, `name = "login-test"\ncompatibility_date = "2025-09-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "login-test"\ndatabase_id = "login-test"\n`);
  const proxy = await getPlatformProxy({ configPath, persist: { path: path.join(dir, 'state') } });
  const db = proxy.env.DB;
  for (const sql of migrationStatements()) await db.prepare(sql).run();
  return { db, dispose: async () => { await proxy.dispose(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

export async function addSession(db, code, s = {}) {
  const p = await getProgramByCode(db, code);
  return createSession(db, null, p.id, {
    round_no: null, date: null, start_time: null, end_time: null, place: null, capacity: null, is_closed: 0, is_cancelled: 0, ...s,
  });
}
