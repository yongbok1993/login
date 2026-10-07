// migrations/*.sql → src/db/migrations.generated.js
// 앱이 배포 후 첫 요청에서 적용할 수 있도록 마이그레이션을 문장 단위로 묶어 둔다.
// .sql 파일이 원본이다. 수정·추가 후 `npm run build:migrations`를 실행한다(테스트가 불일치를 잡는다).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'migrations');
export const OUT = path.join(ROOT, 'src', 'db', 'migrations.generated.js');

export function splitStatements(sql) {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}

export function generate() {
  const files = fs.readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const list = files.map((name) => ({ name, statements: splitStatements(fs.readFileSync(path.join(DIR, name), 'utf8')) }));
  return `// 자동 생성 파일: 직접 수정하지 말고 migrations/*.sql을 고친 뒤 npm run build:migrations\n`
    + `export const MIGRATIONS = ${JSON.stringify(list, null, 2)};\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.writeFileSync(OUT, generate());
  console.log(`${path.relative(ROOT, OUT)} 생성`);
}
