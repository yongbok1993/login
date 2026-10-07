// 반응형 검수: 개발용 데이터로 서버를 띄우고 각 화면을 여러 폭에서 열어 가로 넘침을 확인한다.
// 사용법: npm run test:layout  (환경 변수 CHROMIUM_PATH로 브라우저 경로 지정 가능, SCREENSHOTS=1 이면 캡처 저장)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280];
const PORT = 3300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'login-layout-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_PATH: path.join(tmp, 'db.sqlite'),
  COMO_ADAPTER: 'mock', COMO_MOCK_FILE: path.join(tmp, 'como.json'), SMS_PROVIDER: 'console' };

execFileSync(process.execPath, ['scripts/seed-dev.js'], { env, stdio: 'ignore' });
const server = spawn(process.execPath, ['src/server.js'], { env, stdio: 'ignore' });
const shotDir = process.env.SCREENSHOTS ? 'screenshots' : null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function login(page, phone) {
  await page.goto(`${BASE}/login`);
  await page.fill('#phone', phone);
  await page.click('button[type=submit].btn');
  const code = await page.textContent('.dev-note b');
  await page.fill('#code', code.trim());
  await page.click('button[type=submit].btn');
}

async function check(page, url, label) {
  const problems = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + url);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out = { scroll: document.documentElement.scrollWidth, vw, offenders: [], small: [] };
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.table-wrap')) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right > vw + 1 || rect.left < -1) {
          if (getComputedStyle(el).position === 'absolute' && el.classList.contains('skip')) continue;
          out.offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${Math.round(rect.left)}~${Math.round(rect.right)}`);
        }
      }
      // 터치 영역: 버튼·링크 버튼 높이 40px 미만
      for (const el of document.querySelectorAll('.btn, button, .top nav a, input[type=checkbox]')) {
        const rect = el.getBoundingClientRect();
        if (rect.width && rect.height && rect.height < (el.type === 'checkbox' ? 20 : 40)) {
          out.small.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 12)}" ${Math.round(rect.height)}px`);
        }
      }
      return out;
    });
    if (r.scroll > r.vw) problems.push(`${w}px: 가로 넘침 scrollWidth=${r.scroll}`);
    if (r.offenders.length) problems.push(`${w}px: 화면 밖 요소 ${r.offenders.slice(0, 3).join(', ')}`);
    if (w <= 430 && r.small.length) problems.push(`${w}px: 작은 터치 영역 ${r.small.slice(0, 3).join(', ')}`);
    if (shotDir && (w === 320 || w === 1280)) {
      await page.screenshot({ path: path.join(shotDir, `${label.replace(/[^\w-]/g, '_')}-${w}.png`), fullPage: true });
    }
  }
  console.log(`${problems.length ? '✗' : '✓'} ${label} (${url})`);
  for (const p of problems) console.log(`    ${p}`);
  return problems.length;
}

let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
try {
  await waitForServer();
  const anon = await browser.newPage();
  for (const [u, l] of [['/', 'home'], ['/login', 'login'], ['/register', 'register']]) failures += await check(anon, u, l);
  // 미등록 번호로 등록 정보 입력 화면까지
  await anon.goto(`${BASE}/register`);
  await anon.fill('#phone', '01000000099');
  await anon.click('button[type=submit].btn');
  failures += await check(anon, '/verify', 'verify');
  const code = await anon.textContent('.dev-note b');
  await anon.fill('#code', code.trim());
  await anon.click('button[type=submit].btn');
  failures += await check(anon, '/register/details', 'register-details');

  const p = await browser.newPage();
  await login(p, '01000000001');
  const growId = execFileSync(process.execPath, ['-e', `
    const D=require('better-sqlite3');const d=new D(process.argv[1]);
    console.log(d.prepare("SELECT s.id FROM program_sessions s JOIN programs p ON p.id=s.program_id WHERE p.code='grow-career' ORDER BY s.id LIMIT 1").get().id)`,
  env.DATABASE_PATH]).toString().trim();
  for (const [u, l] of [['/me', 'me'], ['/me/programs', 'me-programs'], ['/me/open/counseling', 'me-counseling'],
    [`/me/grow/${growId}`, 'grow-confirm'], ['/me/profile', 'me-profile'], ['/me/phone', 'me-phone']]) {
    failures += await check(p, u, l);
  }
  const unselected = await browser.newPage();
  await login(unselected, '01000000004');
  failures += await check(unselected, '/me', 'me-unselected');

  const m = await browser.newPage();
  await login(m, '01000000000');
  for (const [u, l] of [['/admin', 'admin'], ['/admin/participants', 'admin-participants'], ['/admin/participants/2', 'admin-participant'],
    ['/admin/programs', 'admin-programs'], ['/admin/programs/1', 'admin-program'], ['/admin/sessions/1', 'admin-session'],
    ['/admin/programs/new', 'admin-program-new'], ['/admin/link', 'admin-link'], ['/admin/como', 'admin-como'], ['/admin/audit', 'admin-audit']]) {
    failures += await check(m, u, l);
  }
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n문제 ${failures}건` : '\n모든 화면 통과');
process.exit(failures ? 1 : 0);
