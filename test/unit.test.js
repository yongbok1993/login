import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { html, raw } from '../src/lib/html.js';
import { normalizePhone } from '../src/lib/phone.js';
import { formatDate, parseBirthDate } from '../src/lib/time.js';
import { hashPin, pinProblem, temporaryPin, verifyPin } from '../src/lib/pin.js';

test('전화번호 정규화: 표기 차이를 같은 값으로', () => {
  for (const v of ['010-1234-5678', '01012345678', '010 1234 5678', '+82 10-1234-5678', '+821012345678', '(010)1234-5678']) {
    assert.equal(normalizePhone(v), '01012345678', v);
  }
  assert.equal(normalizePhone('011-123-4567'), '0111234567');
  for (const v of ['02-123-4567', '1234', '010-1234-567a', '', null, '0101234567890']) {
    assert.equal(normalizePhone(v), null, String(v));
  }
});

test('html 템플릿은 보간값을 이스케이프한다', () => {
  assert.equal(String(html`<p>${'<script>"x"</script>'}</p>`), '<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p>');
  assert.equal(String(html`<p>${raw('<b>ok</b>')}</p>`), '<p><b>ok</b></p>');
  assert.equal(String(html`${[html`<i>${'&'}</i>`, null, false]}`), '<i>&amp;</i>');
});

test('날짜 표기', () => {
  assert.equal(formatDate('2027-03-05'), '2027년 3월 5일 (금)');
  assert.equal(formatDate(null), '');
});

test('운영 설정: 기본값은 운영, 꼬모 모의 어댑터와 약한 세션 키를 거부한다', () => {
  const secret = 'x'.repeat(40);
  // APP_ENV가 없으면 운영으로 동작한다(배포 환경에서 개발용 기능이 켜지지 않도록).
  assert.throws(() => loadConfig({}), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ SESSION_SECRET: secret, COMO_ADAPTER: 'mock' }), /COMO_ADAPTER/);
  assert.throws(() => loadConfig({ APP_ENV: 'staging' }), /APP_ENV/);
  const cfg = loadConfig({ SESSION_SECRET: secret });
  assert.equal(cfg.isProd, true);
  assert.equal(cfg.comoAdapter, 'none');
  assert.equal(cfg.comoApplyUrl, 'https://cco-mho.pages.dev/');
});

test('생년월일 정규화', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  for (const v of ['19700305', '1970-03-05', '1970.3.5', '1970. 3. 5.', '1970 03 05']) assert.equal(parseBirthDate(v, now), '1970-03-05', v);
  for (const v of ['19700230', '18991231', '20270101', '1970-13-01', 'abc', '', null]) assert.equal(parseBirthDate(v, now), null, String(v));
});

test('PIN: 추측 쉬운 값 거부', () => {
  for (const v of ['111111', '123456', '987654', '890123', '121212', '123123']) assert.ok(pinProblem(v), v);
  for (const v of ['12345', '1234567', 'abcdef', '', null]) assert.match(pinProblem(v), /숫자 6자리/, String(v));
  assert.match(pinProblem('700305', { birthDate: '1970-03-05' }), /생년월일/);
  assert.match(pinProblem('030570', { birthDate: '1970-03-05' }), /생년월일/);
  assert.match(pinProblem('345678', { phone: '01012345678' }), /./);
  assert.match(pinProblem('645678', { phone: '01012645678' }), /전화번호/);
  assert.equal(pinProblem('258147', { birthDate: '1970-03-05', phone: '01012345678' }), null);
  for (let i = 0; i < 50; i++) assert.equal(pinProblem(temporaryPin()), null);
});

test('PIN 해시: 비밀키·솔트 사용, 원문 미포함, 검증', async () => {
  const a = await hashPin('secret-1', '258147');
  const b = await hashPin('secret-1', '258147');
  assert.match(a, /^h1\$\d{16}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b, '솔트가 달라 같은 PIN도 해시가 다름');
  assert.ok(!a.includes('258147'));
  assert.equal(await verifyPin('secret-1', '258147', a), true);
  assert.equal(await verifyPin('secret-1', '258148', a), false);
  assert.equal(await verifyPin('secret-2', '258147', a), false, '비밀키가 다르면 검증 실패');
  assert.equal(await verifyPin('secret-1', '258147', null), false);
  assert.equal(await verifyPin('secret-1', '258147', 'garbage'), false);
});
