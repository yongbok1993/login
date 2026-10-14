import assert from 'node:assert/strict';
import test from 'node:test';
import { addManager, addParticipant, startApp } from './helpers.js';

const enc = new TextEncoder();
// 실제 PDF 머리말(%PDF-)로 시작하는 작은 시험용 파일(테스트 전용, 운영에 등록하지 않음)
const pdfBytes = (marker) => enc.encode(`%PDF-1.4\n% 시험용 ${marker}\n%%EOF\n`);
const hwpBytes = () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]);

async function raw(app, path, client) {
  const headers = new Headers();
  if (client && client.cookies.size) headers.set('cookie', [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  const res = await app.app.fetch(new Request(`https://login.test${path}`, { headers }), {}, {});
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}

test('신청서·동의서: 양식이 없으면 "양식 준비 중"(가짜 파일·깨진 링크 없음), 비로그인도 안내 화면 이용', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const r = await app.client().get('/forms');
  assert.equal(r.status, 200);
  assert.equal((r.text.match(/양식 준비 중/g) || []).length, 2);
  assert.ok(r.text.includes('프로그램 신청서') && r.text.includes('개인정보 활용 동의서'));
  assert.ok(!r.text.includes('/download') && !r.text.includes('/print'), '없는 파일 링크를 만들지 않음');
  assert.match(r.text, /내려받거나 인쇄하는 것만으로는 신청이나 개인정보 동의가 완료되지 않습니다/);
  for (const kind of ['application', 'consent']) {
    assert.equal((await raw(app, `/forms/${kind}/download`)).status, 404);
    assert.equal((await raw(app, `/forms/${kind}/print`)).status, 404);
  }
  assert.equal((await raw(app, '/forms/other/download')).status, 404);
  assert.match((await app.client().get('/')).text, /href="\/forms"/);
});

test('담당자 양식 등록·교체·내리기 → 누구나 내려받기(한글 파일명, 원본 그대로)·PDF는 인쇄 화면, 형식·용량 검사, 담당자만 등록', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addManager(app.db);
  await addParticipant(app.db, { phone: '01091000001', selected: true });
  const m = app.client();
  await m.adminLogin();
  await m.get('/admin/forms');

  // 등록 권한: 비로그인·참여자는 불가
  const p = app.client();
  await p.login('01091000001');
  await p.get('/me');
  let r = await p.upload('/admin/forms/application', {}, { file: { name: '신청서.pdf', type: 'application/pdf', bytes: pdfBytes('x') } });
  assert.equal(r.status, 403);
  const anon = app.client();
  await anon.get('/login');
  r = await anon.upload('/admin/forms/application', {}, { file: { name: '신청서.pdf', type: 'application/pdf', bytes: pdfBytes('x') } });
  assert.equal(r.location, '/admin/login');
  r = await m.upload('/admin/forms/application', { _csrf: 'bad' }, { file: { name: 'a.pdf', bytes: pdfBytes('x') } });
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM form_files')).n, 0);

  // 형식·내용·용량 검사
  r = await m.upload('/admin/forms/application', {}, { file: { name: '신청서.exe', bytes: pdfBytes('x') } });
  assert.match(r.text, /PDF, HWP, HWPX, DOCX 파일만/);
  r = await m.upload('/admin/forms/application', {}, { file: { name: '가짜.pdf', bytes: enc.encode('그냥 글자') } });
  assert.match(r.text, /파일 내용이 확장자와 맞지 않습니다/);
  const big = new Uint8Array(1900 * 1024 + 1); big.set(pdfBytes('big'));
  r = await m.upload('/admin/forms/application', {}, { file: { name: '큰파일.pdf', bytes: big } });
  assert.match(r.text, /파일이 너무 큽니다/);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM form_files')).n, 0);

  // 등록: PDF(신청서)·HWP(동의서)
  const pdf = pdfBytes('신청서 v1');
  r = await m.upload('/admin/forms/application', {}, { file: { name: '2026 프로그램 신청서.pdf', type: 'application/pdf', bytes: pdf } });
  assert.equal(r.location, '/admin/forms');
  r = await m.upload('/admin/forms/consent', {}, { file: { name: '개인정보 활용 동의서.hwp', bytes: hwpBytes() } });
  assert.equal(r.location, '/admin/forms');
  assert.ok(await app.sql.get("SELECT 1 FROM audit_log WHERE action = 'form.upload'"));

  r = await app.client().get('/forms');
  assert.ok(!r.text.includes('양식 준비 중'));
  assert.match(r.text, /href="\/forms\/application\/download">프로그램 신청서 다운로드/);
  assert.match(r.text, /href="\/forms\/application\/print"[^>]*>프로그램 신청서 인쇄/);
  assert.match(r.text, /href="\/forms\/consent\/download">개인정보 활용 동의서 다운로드/);
  assert.ok(!r.text.includes('/forms/consent/print'), 'HWP는 인쇄 화면 대신 내려받기 안내');

  let d = await raw(app, '/forms/application/download');
  assert.equal(d.status, 200);
  assert.equal(d.headers.get('content-type'), 'application/pdf');
  assert.equal(d.headers.get('content-disposition'),
    `attachment; filename="application.pdf"; filename*=UTF-8''${encodeURIComponent('2026 프로그램 신청서.pdf')}`);
  assert.deepEqual(d.bytes, pdf, '원본 그대로(한글 깨짐 없음)');
  assert.equal(new TextDecoder().decode(d.bytes), new TextDecoder().decode(pdf));
  d = await raw(app, '/forms/application/print');
  assert.match(d.headers.get('content-disposition'), /^inline;/);
  assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
  d = await raw(app, '/forms/consent/download');
  assert.equal(d.headers.get('content-type'), 'application/x-hwp');
  assert.deepEqual(d.bytes, hwpBytes());
  assert.equal((await raw(app, '/forms/consent/print')).status, 404);

  // 교체·내리기
  const pdf2 = pdfBytes('신청서 v2');
  await m.get('/admin/forms');
  await m.upload('/admin/forms/application', {}, { file: { name: '신청서 수정본.pdf', bytes: pdf2 } });
  assert.deepEqual((await raw(app, '/forms/application/download')).bytes, pdf2);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM form_files')).n, 2);
  await m.get('/admin/forms');
  await m.post('/admin/forms/consent/delete');
  assert.equal((await raw(app, '/forms/consent/download')).status, 404);
  assert.match((await app.client().get('/forms')).text, /양식 준비 중/);
  assert.equal((await p.post('/admin/forms/application/delete')).status, 403);
});

test('내 신청정보 인쇄: 본인 화면에만 있고 A4 인쇄 스타일로 메뉴·버튼 제외', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await addParticipant(app.db, { name: '인쇄자', phone: '01092000001' });
  const c = app.client();
  await c.login('01092000001');
  const r = await c.get('/me/application');
  assert.match(r.text, /data-print hidden>내 신청정보 인쇄/);
  assert.match(r.text, /<script src="\/static\/print.js" defer>/);
  assert.equal((await app.client().get('/me/application')).location, '/login');
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../public/static/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media print\{[\s\S]*@page\{size:A4/);
  assert.match(css, /header\.top,footer,[^{]*\.btn,[^{]*nav[^{]*\{display:none !important\}/);
});
