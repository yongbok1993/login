// Cloudflare Pages Functions 진입점: 정적 파일(/static/*, public/_routes.json 참고)을 제외한 모든 요청을 처리한다.
import { createApp } from '../src/app.js';

const app = createApp();

export function onRequest(context) {
  return app.fetch(context.request, context.env, context);
}
