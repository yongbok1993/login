import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { csrfMiddleware, sessionMiddleware } from './lib/session.js';
import { groupByTheme, listPrograms } from './services/programs.js';
import { getUser } from './services/users.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { buildCtx, deny, render } from './routes/helpers.js';
import { meRoutes } from './routes/me.js';
import { errorPage, homePage } from './views/public.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CSP = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

export function createApp({ db, cfg, sms, como, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.locals.cfg = cfg;
  app.locals.devNotice = cfg.isProd ? null : '개발 환경';

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (cfg.isProd) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use('/static', express.static(PUBLIC_DIR, { maxAge: cfg.isProd ? '1d' : 0, index: false }));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(sessionMiddleware(db, cfg));
  app.use((req, res, next) => {
    req.user = req.session.userId ? getUser(db, req.session.userId) || null : null;
    // 개인 화면은 캐시하지 않는다.
    if (req.user || req.method !== 'GET') res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(csrfMiddleware);

  app.get('/', (req, res) => {
    render(req, res, homePage, groupByTheme(listPrograms(db, { publicOnly: true })));
  });

  app.use(authRoutes({ db, cfg, sms, logger }));
  app.use(meRoutes({ db, cfg, como, logger }));
  app.use(adminRoutes({ db, cfg, como }));

  app.use((req, res) => deny(req, res, 404));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status >= 500) logger.error(err);
    if (!req.session) return res.status(status).type('text').send('error');
    res.status(status).type('html').send(String(errorPage(buildCtx(req), status, err.expose)));
  });

  return app;
}
