// 로컬 개발 서버: 로컬 D1에 마이그레이션을 적용한 뒤 wrangler pages dev(workerd)로 실행한다.
// 환경 변수는 .dev.vars(형식: .dev.vars.example)에서 읽는다.
import { spawn } from 'node:child_process';
import { applyLocalMigrations, pagesDevArgs, ROOT } from './local-d1.js';

applyLocalMigrations();
const port = Number(process.env.PORT || 8788);
const child = spawn(process.execPath, pagesDevArgs({ port }), { cwd: ROOT, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
