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
import { DEV_PIN, MOCK_COMO, seed } from './seed-dev.js';

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
  await page.fill('#pin', DEV_PIN);
  await page.click('button[type=submit].btn');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
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

// 카카오 우편번호 스크립트 대체본(이 환경에서는 외부 CDN에 접속할 수 없음). 실제 URL로 응답해 페이지 CSP가 그대로 적용된다.
const POSTCODE_STUB = `window.daum = { Postcode: function (opts) {
  this.embed = function (el) {
    var b = document.createElement('button'); b.type = 'button'; b.id = 'stub-pick'; b.textContent = '선택';
    b.onclick = function () { opts.oncomplete({ zonecode: '17101', roadAddress: '경기 용인시 처인구 이동읍 이원로 69-8',
      address: '경기 용인시 처인구 이동읍 이원로 69-8', bname: '이동읍', buildingName: '', apartment: 'N' }); };
    el.appendChild(b);
  };
} };`;

async function checkAddressSearch(browser) {
  const problems = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cspErrors = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
  await page.route('https://t1.daumcdn.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: POSTCODE_STUB }));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/register`);
  await page.waitForSelector('#address-search:not([hidden])', { timeout: 5000 }).catch(() => problems.push('주소 검색 버튼이 나타나지 않음'));
  if (!problems.length) {
    await page.click('#address-search');
    if (await page.isHidden('#postcode-layer')) problems.push('검색 창이 열리지 않음');
    await page.click('#stub-pick');
    const v = await page.evaluate(() => ({ zip: postcode.value, addr: address.value, hidden: document.getElementById('postcode-layer').hidden,
      focus: document.activeElement && document.activeElement.id }));
    if (v.zip !== '17101') problems.push(`우편번호 ${v.zip}`);
    if (v.addr !== '경기 용인시 처인구 이동읍 이원로 69-8') problems.push(`주소 ${v.addr}`);
    if (!v.hidden) problems.push('선택 후 검색 창이 닫히지 않음');
    if (v.focus !== 'address_detail') problems.push(`선택 후 포커스 ${v.focus}`);
  }
  if (cspErrors.length) problems.push(`CSP 위반: ${cspErrors[0]}`);
  // 스크립트를 못 불러오면 버튼은 숨기고 직접 입력
  const page2 = await ctx.newPage();
  await page2.route('https://t1.daumcdn.net/**', (r) => r.abort());
  await page2.goto(`${BASE}/register`);
  await page2.waitForTimeout(300);
  if (!(await page2.isHidden('#address-search'))) problems.push('스크립트 실패 시 버튼이 보임');
  await page2.fill('#address', '직접 입력 주소');
  if ((await page2.inputValue('#address')) !== '직접 입력 주소') problems.push('직접 입력 불가');
  await ctx.close();
  console.log(`${problems.length ? '✗' : '✓'} 주소 검색(카카오 대체본)`);
  for (const p of problems) console.log(`    ${p}`);
  return problems.length;
}

let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
try {
  await waitForServer();
  failures += await checkAddressSearch(browser);
  // 외부 CDN 요청은 즉시 실패시켜 화면 검사 시간을 줄인다.
  const blockCdn = (pg) => pg.route('https://t1.daumcdn.net/**', (r) => r.abort());
  const anon = await browser.newPage();
  await blockCdn(anon);
  for (const [u, l] of [['/', 'home'], ['/login', 'login'], ['/register', 'register'], ['/notices', 'notices'], ['/notices/1', 'notice']]) {
    failures += await check(anon, u, l);
  }
  failures += await check(anon, '/account/pin', 'login-redirect');
  const p = await browser.newPage();
  await blockCdn(p);
  await login(p, '01000000001');
  for (const [u, l] of [['/me', 'me'], ['/me/programs', 'me-programs'], ['/me/open/counseling', 'me-counseling'],
    [`/me/grow/${growId}`, 'grow-confirm'], ['/me/profile', 'me-profile'], ['/me/phone', 'me-phone'], ['/account/pin', 'pin-change']]) {
    failures += await check(p, u, l);
  }
  const unselected = await browser.newPage();
  await login(unselected, '01000000004');
  failures += await check(unselected, '/me', 'me-unselected');

  const m = await browser.newPage();
  await login(m, '01000000000');
  for (const [u, l] of [['/admin', 'admin'], ['/admin/participants', 'admin-participants'], ['/admin/participants/2', 'admin-participant'],
    ['/admin/programs', 'admin-programs'], ['/admin/programs/1', 'admin-program'], ['/admin/sessions/1', 'admin-session'],
    ['/admin/programs/new', 'admin-program-new'], ['/admin/link', 'admin-link'], ['/admin/como', 'admin-como'], ['/admin/audit', 'admin-audit'],
    ['/admin/grow', 'admin-grow'], ['/admin/grow?status=all', 'admin-grow-all'], ['/admin/notices', 'admin-notices'],
    ['/admin/notices/new', 'admin-notice-new'], ['/admin/staff', 'admin-staff'], [`/admin/sessions/${growId}`, 'admin-session-grow']]) {
    failures += await check(m, u, l);
  }
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* 이미 종료 */ }
  fs.rmSync(persistTo, { recursive: true, force: true });
}
console.log(failures ? `\n문제 ${failures}건` : '\n모든 화면 통과');
process.exit(failures ? 1 : 0);
