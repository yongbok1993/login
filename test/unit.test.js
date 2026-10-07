import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { html, raw } from '../src/lib/html.js';
import { normalizePhone } from '../src/lib/phone.js';
import { formatDate } from '../src/lib/time.js';

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
