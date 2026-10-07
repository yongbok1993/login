import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { html, raw } from '../src/lib/html.js';
import { normalizePhone } from '../src/lib/phone.js';
import { formatDate, parseBirthDate } from '../src/lib/time.js';
import { createSmsSender, solapiAuthHeader } from '../src/sms/index.js';
import { hmac } from '../src/lib/crypto.js';

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

test('운영 설정: 기본값은 운영, 개발용 문자·꼬모 모의 어댑터와 약한 세션 키를 거부한다', () => {
  const secret = 'x'.repeat(40);
  // APP_ENV가 없으면 운영으로 동작한다(배포 환경에서 개발용 기능이 켜지지 않도록).
  assert.throws(() => loadConfig({}), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ SESSION_SECRET: secret, SMS_PROVIDER: 'console' }), /SMS_PROVIDER/);
  assert.throws(() => loadConfig({ SESSION_SECRET: secret, COMO_ADAPTER: 'mock' }), /COMO_ADAPTER/);
  assert.throws(() => loadConfig({ APP_ENV: 'staging' }), /APP_ENV/);
  const cfg = loadConfig({ SESSION_SECRET: secret });
  assert.equal(cfg.isProd, true);
  assert.equal(cfg.smsProvider, 'none');
  assert.equal(cfg.comoAdapter, 'none');
  assert.equal(cfg.comoApplyUrl, 'https://cco-mho.pages.dev/');
});

test('생년월일 정규화', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  for (const v of ['19700305', '1970-03-05', '1970.3.5', '1970. 3. 5.', '1970 03 05']) assert.equal(parseBirthDate(v, now), '1970-03-05', v);
  for (const v of ['19700230', '18991231', '20270101', '1970-13-01', 'abc', '', null]) assert.equal(parseBirthDate(v, now), null, String(v));
});

test('Solapi: 인증 헤더 서명과 발송 요청 형식', async () => {
  const header = await solapiAuthHeader('KEY', 'SECRET', new Date('2026-10-07T07:00:00.000Z'));
  const m = /^HMAC-SHA256 apiKey=KEY, date=(\S+), salt=([A-Za-z0-9]{32}), signature=([0-9a-f]{64})$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[1], '2026-10-07T07:00:00.000Z');
  assert.equal(m[3], await hmac('SECRET', m[1] + m[2]));

  const calls = [];
  const quiet = { info() {}, warn() {} };
  const cfg = loadConfig({ SESSION_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'solapi', SOLAPI_API_KEY: 'KEY', SOLAPI_API_SECRET: 'SECRET', SMS_SENDER: '031-334-9966' });
  const ok = createSmsSender(cfg, { logger: quiet, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ groupInfo: { count: { total: 1 } }, failedMessageList: [] }), { status: 200 });
  } });
  assert.equal(ok.configured, true);
  assert.equal(ok.devVisible, false);
  assert.deepEqual(await ok.send('01012345678', '[로그人] 인증번호 123456'), { ok: true });
  assert.equal(calls[0].url, 'https://api.solapi.com/messages/v4/send-many/detail');
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.headers.Authorization, /^HMAC-SHA256 apiKey=KEY, /);
  assert.deepEqual(JSON.parse(calls[0].init.body), { messages: [{ to: '01012345678', from: '0313349966', text: '[로그人] 인증번호 123456' }] });

  const rejected = createSmsSender(cfg, { logger: quiet, fetchImpl: async () => new Response(JSON.stringify({
    failedMessageList: [{ statusCode: '1062', statusMessage: '발신번호 미등록' }] }), { status: 200 }) });
  assert.equal((await rejected.send('01012345678', 'x')).ok, false);
  const http = createSmsSender(cfg, { logger: quiet, fetchImpl: async () => new Response('{"errorCode":"InvalidAPIKey"}', { status: 403 }) });
  assert.equal((await http.send('01012345678', 'x')).ok, false);
  const down = createSmsSender(cfg, { logger: quiet, fetchImpl: async () => { throw new Error('timeout'); } });
  assert.equal((await down.send('01012345678', 'x')).ok, false);
});

test('Solapi 설정 누락은 오류', () => {
  const base = { SESSION_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'solapi' };
  assert.throws(() => loadConfig(base), /SOLAPI_API_KEY/);
  assert.throws(() => loadConfig({ ...base, SOLAPI_API_KEY: 'k', SOLAPI_API_SECRET: 's' }), /SMS_SENDER/);
});
