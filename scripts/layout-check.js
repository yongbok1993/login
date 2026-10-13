// 반응형 검수: 개발용 데이터로 wrangler pages dev(workerd + 로컬 D1)를 띄우고
// 각 화면을 여러 폭에서 열어 가로 넘침·작은 터치 영역을 확인한다.
// 사용법: npm run test:layout  (CHROMIUM_PATH로 브라우저 경로 지정 가능, SCREENSHOTS=1 이면 캡처 저장)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { get } from '../src/lib/db.js';
import { applyLocalMigrations, openLocalDb, pagesDevArgs, ROOT } from './local-d1.js';
import { DEV_ADMIN, DEV_PASSWORD, MOCK_COMO, seed } from './seed-dev.js';

const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280];
const PORT = 3300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'login-layout-'));

applyLocalMigrations(persistTo);
const local = await openLocalDb(persistTo);
await seed(local.db);
const growId = (await get(local.db, `SELECT s.id FROM program_sessions s JOIN programs p ON p.id = s.program_id
  WHERE p.code = 'grow-career' ORDER BY s.id LIMIT 1`)).id;
await local.dispose();

const server = spawn(process.execPath, pagesDevArgs({ port: PORT, persistTo,
  bindings: ['APP_ENV=development', 'COMO_ADAPTER=mock', `COMO_MOCK_JSON=${JSON.stringify(MOCK_COMO)}`] }),
{ cwd: ROOT, stdio: 'ignore', detached: true, env: { ...process.env, CI: '1' } });
const shotDir = process.env.SCREENSHOTS ? 'screenshots' : null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

async function waitForServer() {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

async function login(page, phone) {
  await page.goto(`${BASE}/login`);
  await page.fill('#phone', phone);
  await page.fill('#password', DEV_PASSWORD);
  await page.click('button[type=submit].btn');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function adminLogin(page) {
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#login_id', DEV_ADMIN.loginId);
  await page.fill('#password', DEV_ADMIN.password);
  await page.click('button[type=submit].btn');
  await page.waitForURL((u) => !u.pathname.startsWith('/admin/login'));
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

// 신청 화면: 비밀번호 보기/숨기기, 신청 후 신청 시각(초까지) 표시, 휴대전화 폭
async function checkRegister(browser) {
  const problems = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  const cspErrors = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
  await page.goto(`${BASE}/register`);
  if (await page.isHidden('.pw-toggle[data-target="password"]')) problems.push('보기 버튼이 나타나지 않음');
  await page.fill('#name', '화면검수');
  await page.fill('#phone', '010-1234 9999');
  await page.fill('#password', 'layout2026');
  await page.click('.pw-toggle[data-target="password"]');
  if ((await page.getAttribute('#password', 'type')) !== 'text') problems.push('보기를 눌러도 비밀번호가 보이지 않음');
  await page.click('.pw-toggle[data-target="password"]');
  if ((await page.getAttribute('#password', 'type')) !== 'password') problems.push('숨기기가 동작하지 않음');
  await page.fill('#password_confirm', 'layout2026');
  await page.check('input[name="consent"]');
  await page.click('button[type=submit].btn');
  await page.waitForURL((u) => u.pathname === '/register/done');
  const text = await page.textContent('dl.application');
  if (!/신청 시각\s*\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\s*이름\s*화면검수\s*전화번호\s*010-1234-9999\s*신청 상태\s*승인 대기/.test(text)) {
    problems.push(`신청 완료 표시 순서·형식: ${text.replace(/\s+/g, ' ')}`);
  }
  if (cspErrors.length) problems.push(`CSP 위반: ${cspErrors[0]}`);
  await ctx.close();
  console.log(`${problems.length ? '✗' : '✓'} 신청하기(비밀번호 보기·신청 시각)`);
  for (const p of problems) console.log(`    ${p}`);
  return problems.length;
}

let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
try {
  await waitForServer();
  failures += await checkRegister(browser);
  const anon = await browser.newPage();
  for (const [u, l] of [['/', 'home'], ['/login', 'login'], ['/admin/login', 'admin-login'], ['/register', 'register'],
    ['/password/reset', 'password-reset']]) {
    failures += await check(anon, u, l);
  }
  failures += await check(anon, '/board/notice', 'login-redirect');
  const p = await browser.newPage();
  await login(p, '01000000001');
  const freeId = await p.evaluate(async () => {
    const html = await (await fetch('/board/free')).text();
    return (html.match(/href="\/board\/free\/(\d+)"/) || [])[1];
  });
  for (const [u, l] of [['/', 'home-member'], ['/me', 'me'], ['/me/programs', 'me-programs'], ['/me/open/counseling', 'me-counseling'],
    [`/me/grow/${growId}`, 'grow-confirm'], ['/me/application', 'me-application'], ['/account/password', 'password-change'],
    ['/board/notice', 'board-notice'], ['/board/free', 'board-free'], [`/board/free/${freeId}`, 'board-free-post'], ['/board/free/new', 'board-new'],
    ['/board/qna', 'board-qna'], ['/board/qna/new', 'board-qna-new'], [`/board/free/${freeId}/delete`, 'board-delete']]) {
    failures += await check(p, u, l);
  }
  const unselected = await browser.newPage();
  await login(unselected, '01000000004');
  failures += await check(unselected, '/me', 'me-pending');
  failures += await check(unselected, '/board/notice', 'pending-blocked');

  const m = await browser.newPage();
  await adminLogin(m);
  const qnaId = await m.evaluate(async () => ((await (await fetch('/board/qna')).text()).match(/href="\/board\/qna\/(\d+)"/) || [])[1]);
  failures += await check(m, `/board/qna/${qnaId}`, 'admin-qna-answer');
  for (const [u, l] of [['/admin', 'admin'], ['/admin/participants', 'admin-participants'], ['/admin/participants/2', 'admin-participant'],
    ['/admin/programs', 'admin-programs'], ['/admin/programs/1', 'admin-program'], ['/admin/sessions/1', 'admin-session'],
    ['/admin/programs/new', 'admin-program-new'], ['/admin/link', 'admin-link'], ['/admin/como', 'admin-como'], ['/admin/audit', 'admin-audit'],
    ['/admin/grow', 'admin-grow'], ['/admin/grow?status=all', 'admin-grow-all'], ['/board/notice/new', 'admin-notice-new'], ['/admin/staff', 'admin-staff'], ['/admin/account', 'admin-account'], [`/admin/sessions/${growId}`, 'admin-session-grow']]) {
    failures += await check(m, u, l);
  }
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* 이미 종료 */ }
  fs.rmSync(persistTo, { recursive: true, force: true });
}
console.log(failures ? `\n문제 ${failures}건` : '\n모든 화면 통과');
process.exit(failures ? 1 : 0);
