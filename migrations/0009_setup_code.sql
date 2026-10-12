-- 첫 관리자 지정용 1회용 설정 코드(해시만 저장, 원문은 저장소에 없음). 관리자가 지정되면 삭제된다.
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'setup_code_hash', 'b92978658c8d0a2a5fce9c6ff9ffb992866f9d20f8940da6472152c4ace48d93', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'manager');
