-- 앱 설정 값 보관: 비밀키(app_secret)를 앱이 처음 실행될 때 스스로 만들어 저장한다(Cloudflare 환경 변수 불필요).
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
