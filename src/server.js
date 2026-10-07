import { createApp } from './app.js';
import { createComoAdapter } from './como/adapters.js';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { purgeExpiredSessions } from './lib/session.js';
import { purgeOldOtps } from './services/otp.js';
import { createSmsSender } from './sms/index.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const sms = createSmsSender(cfg);
const como = createComoAdapter(cfg);
const app = createApp({ db, cfg, sms, como });

const cleanup = () => {
  purgeExpiredSessions(db);
  purgeOldOtps(db);
};
cleanup();
setInterval(cleanup, 3600 * 1000).unref();

app.listen(cfg.port, () => {
  console.log(`로그人 서버 http://localhost:${cfg.port} (${cfg.env}, 문자: ${sms.kind}, 꼬모 회차 연동: ${como.kind})`);
});
