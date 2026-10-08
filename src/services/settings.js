import { randomToken } from '../lib/crypto.js';
import { get, run } from '../lib/db.js';
import { nowIso } from '../lib/time.js';

// 앱 비밀키(세션·PIN 해시 키)는 DB(app_settings)에 보관한다. Cloudflare 대시보드에서 값을 넣을 필요가 없다.
// 처음 한 번: 환경 변수 SESSION_SECRET이 32자 이상이면 그 값을, 아니면 무작위 값을 저장한다. 이후에는 저장된 값이 기준이다.
// (환경 변수를 나중에 바꿔도 PIN이 무효가 되지 않는다.)
const cache = new WeakMap();

async function loadSecret(db, envSecret) {
  const row = await get(db, "SELECT value FROM app_settings WHERE key = 'app_secret'");
  if (row) return row.value;
  const candidate = envSecret && envSecret.length >= 32 ? envSecret : randomToken(48);
  // 동시에 여러 요청이 만들어도 먼저 저장된 하나만 남는다.
  await run(db, "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('app_secret', ?, ?)", candidate, nowIso());
  return (await get(db, "SELECT value FROM app_settings WHERE key = 'app_secret'")).value;
}

export function appSecret(db, envSecret) {
  let p = cache.get(db);
  if (!p) {
    p = loadSecret(db, envSecret).catch((err) => {
      cache.delete(db);
      throw err;
    });
    cache.set(db, p);
  }
  return p;
}
