import assert from 'node:assert/strict';
import test from 'node:test';
import { addManager, addParticipant, startApp } from './helpers.js';

async function setup(t) {
  const app = await startApp();
  t.after(app.close);
  await addManager(app.db);
  const a = await addParticipant(app.db, { name: '가참여', phone: '01060000001', selected: true });
  const b = await addParticipant(app.db, { name: '나참여', phone: '01060000002', selected: true });
  const m = app.client();
  await m.adminLogin();
  const pa = app.client();
  await pa.login('01060000001');
  const pb = app.client();
  await pb.login('01060000002');
  return { app, m, pa, pb, a, b };
}

const lastId = async (app) => (await app.sql.get('SELECT MAX(id) id FROM posts')).id;

test('게시판 메뉴: 공지사항·자유게시판·질문과 답변, 신청자·담당자 메뉴에서 연결, 비로그인은 차단', async (t) => {
  const { app, pa, m } = await setup(t);
  for (const path of ['/board', '/board/notice', '/board/free', '/board/qna', '/board/free/1', '/board/qna/new']) {
    assert.equal((await app.client().get(path)).location, '/login', path);
  }
  await addParticipant(app.db, { phone: '01060000008' });
  const w = app.client();
  await w.login('01060000008');
  assert.match((await w.get('/me')).text, /href="\/board"/, '승인 대기자 메뉴에도 게시판');
  const r = await pa.get('/board/notice');
  for (const x of ['공지사항', '자유게시판', '질문과 답변']) assert.ok(r.text.includes(`>${x}</a>`), x);
  assert.match((await pa.get('/me')).text, /href="\/board"/);
  assert.match((await m.get('/admin')).text, /href="\/board"/);
});

test('공지사항: 담당자만 작성·수정·삭제, 신청자는 열람, 중요 공지 상단 고정', async (t) => {
  const { app, m, pa } = await setup(t);
  await addParticipant(app.db, { phone: '01060000007' });
  const w = app.client();
  await w.login('01060000007');
  assert.equal((await w.get('/board/notice/new')).status, 403);
  assert.equal((await w.post('/board/notice/new', { title: '대기자 공지', body: 'x' })).status, 403);
  assert.equal((await pa.get('/board/notice/new')).status, 403);
  assert.equal((await pa.post('/board/notice/new', { title: '참여자 공지', body: 'x' })).status, 403);
  assert.ok(!(await pa.get('/board/notice')).text.includes('공지 쓰기'));
  let r = await m.post('/board/notice/new', { title: '', body: '' });
  assert.equal(r.status, 422);
  await m.post('/board/notice/new', { title: '일반 공지', body: '일반' });
  const normal = await lastId(app);
  await m.post('/board/notice/new', { title: '중요 공지', body: '중요', is_pinned: '1' });
  const pinned = await lastId(app);
  await m.post('/board/notice/new', { title: '최신 공지', body: '최신' });
  r = await pa.get('/board/notice');
  assert.ok(r.text.indexOf('중요 공지') < r.text.indexOf('최신 공지') && r.text.indexOf('최신 공지') < r.text.indexOf('일반 공지'), '고정 → 최신순');
  assert.match(r.text, /<span class="chip">중요<\/span>/);
  r = await pa.get(`/board/notice/${pinned}`);
  assert.equal(r.status, 200);
  assert.equal((await w.get(`/board/notice/${pinned}`)).status, 200, '승인 대기자도 열람');
  assert.match(r.text, /<span class="chip staff">담당자<\/span>/);
  assert.match(r.text, /담당자 · \d{4}-\d\d-\d\d \d\d:\d\d/);
  assert.ok(!r.text.includes('/edit') && !r.text.includes('/delete'));
  assert.ok(!r.text.includes('댓글 쓰기'), '공지에는 댓글 없음');
  for (const [path, body] of [[`/board/notice/${normal}/edit`, { title: 'x', body: 'y' }], [`/board/notice/${normal}/delete`, {}]]) {
    assert.equal((await pa.get(path)).status, 403, path);
    assert.equal((await pa.post(path, body)).status, 403, path);
  }
  await m.post(`/board/notice/${normal}/edit`, { title: '고친 공지', body: '고침' });
  assert.equal((await app.sql.get('SELECT title FROM posts WHERE id = ?', normal)).title, '고친 공지');
  assert.match((await m.get(`/board/notice/${normal}/delete`)).text, /삭제할까요/);
  await m.post(`/board/notice/${normal}/delete`);
  assert.equal((await pa.get(`/board/notice/${normal}`)).status, 404);
});

test('자유게시판: 신청자(승인 대기 포함)·담당자 글·댓글, 본인 것만 수정·삭제, 담당자는 전체 관리, 입력은 이스케이프, 작성자에 전화번호·신청 시각 없음', async (t) => {
  const { app, m, pa, pb } = await setup(t);
  await addParticipant(app.db, { name: '대기자', phone: '01060000006' });
  const w = app.client();
  await w.login('01060000006');
  await w.post('/board/free/new', { title: '대기자 글', body: '안녕하세요' });
  const wid = await lastId(app);
  assert.equal((await pa.post(`/board/free/${wid}/comments`, { body: '반가워요' })).status, 303);
  assert.equal((await w.post(`/board/free/${wid}/edit`, { title: '대기자 글 수정', body: 'x' })).status, 303);
  assert.equal((await m.post(`/board/free/new`, { title: '담당자 글', body: 'x' })).status, 303);
  await pa.post('/board/free/new', { title: '<b>안녕</b>', body: '<script>alert(1)</script>\n둘째 줄' });
  const id = await lastId(app);
  let r = await pb.get(`/board/free/${id}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!r.text.includes('<script>alert'));
  assert.match(r.text, /가참여 · /);
  for (const bad of ['01060000001', '010-6000-0001', '신청 시각']) assert.ok(!r.text.includes(bad), bad);
  assert.ok(!r.text.includes(`/board/free/${id}/edit`), '남의 글 수정 버튼 없음');
  assert.equal((await pb.get(`/board/free/${id}/edit`)).status, 403);
  assert.equal((await pb.post(`/board/free/${id}/edit`, { title: '해킹', body: 'x' })).status, 403);
  assert.equal((await pb.post(`/board/free/${id}/delete`)).status, 403);

  await pb.post(`/board/free/${id}/comments`, { body: '나의 댓글 <i>x</i>' });
  const cid = (await app.sql.get("SELECT id FROM post_comments WHERE body LIKE '나의 댓글%'")).id;
  r = await pa.get(`/board/free/${id}`);
  assert.match(r.text, /나의 댓글 &lt;i&gt;x&lt;\/i&gt;/);
  assert.equal((await pa.post(`/board/free/${id}/comments/${cid}/edit`, { body: '바꿈' })).status, 403);
  assert.equal((await pa.post(`/board/free/${id}/comments/${cid}/delete`)).status, 403);
  await pb.post(`/board/free/${id}/comments/${cid}/edit`, { body: '고친 댓글' });
  assert.equal((await app.sql.get('SELECT body FROM post_comments WHERE id = ?', cid)).body, '고친 댓글');
  assert.equal((await pa.post(`/board/free/${id}/comments`, { body: '' })).status, 422);

  await pa.post(`/board/free/${id}/edit`, { title: '고친 제목', body: '고친 본문' });
  assert.equal((await app.sql.get('SELECT title FROM posts WHERE id = ?', id)).title, '고친 제목');
  // 관리자는 다른 사람 댓글·글 삭제(변경 기록)
  assert.match((await m.get(`/board/free/${id}/comments/${cid}/delete`)).text, /삭제할까요/);
  await m.post(`/board/free/${id}/comments/${cid}/delete`);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM post_comments WHERE id = ?', cid)).n, 0);
  await pb.post('/board/free/new', { title: '나의 글', body: '본문' });
  const mine = await lastId(app);
  await pb.post(`/board/free/${mine}/delete`);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM posts WHERE id = ?', mine)).n, 0, '본인 글 삭제');
  await m.post(`/board/free/${id}/delete`);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM posts WHERE id = ?', id)).n, 0);
  assert.ok(await app.sql.get("SELECT 1 FROM audit_log WHERE action = 'post.delete'"));
});

test('질문과 답변: 신청자·담당자 모두 질문·답변, 기본 담당자에게 비공개, 비공개는 작성자·담당자만(목록·검색·건수·상세·답변), 담당자 답변 표시', async (t) => {
  const { app, m, pa, pb } = await setup(t);
  await addParticipant(app.db, { name: '대기자', phone: '01060000009' });
  const w = app.client();
  await w.login('01060000009');
  let r = await w.get('/board/qna/new');
  assert.match(r.text, /value="private" checked/);
  assert.match(r.text, /담당자에게 비공개/);
  assert.match(r.text, /로그인 사용자에게 공개/);
  await w.post('/board/qna/new', { title: '비밀질문제목', body: '비밀내용키워드' });
  const secret = await lastId(app);
  assert.equal((await app.sql.get('SELECT visibility FROM posts WHERE id = ?', secret)).visibility, 'private');
  await pa.post('/board/qna/new', { title: '공개질문제목', body: '공개내용', visibility: 'members' });
  const open = await lastId(app);

  for (const x of [pa, pb]) {
    r = await x.get('/board/qna');
    assert.ok(!r.text.includes('비밀질문제목') && r.text.includes('공개질문제목'));
    assert.match(r.text, /질문과 답변 <span class="small muted">1건<\/span>/, '건수에도 포함 안 함');
    r = await x.get('/board/qna?q=' + encodeURIComponent('비밀내용키워드'));
    assert.ok(!r.text.includes('비밀질문제목'));
    for (const path of [`/board/qna/${secret}`, `/board/qna/${secret}/edit`, `/board/qna/${secret}/delete`, `/board/free/${secret}`]) {
      const y = await x.get(path);
      assert.equal(y.status, 404, path);
      assert.ok(!y.text.includes('비밀'), path);
    }
    assert.equal((await x.post(`/board/qna/${secret}/comments`, { body: '끼어들기' })).status, 404, '비공개 질문에 답변 불가');
    assert.equal((await x.post(`/board/qna/${secret}/delete`)).status, 404);
  }
  assert.match((await w.get(`/board/qna/${secret}`)).text, /비밀내용키워드/, '작성자 열람');
  assert.match((await m.get('/board/qna')).text, /비밀질문제목/, '담당자 열람');

  // 비공개 질문: 작성자·담당자 답변, 담당자 답변 구분 표시, 다른 사람에게 답변도 노출 안 됨
  await m.post(`/board/qna/${secret}/comments`, { body: '담당자의비밀답변' });
  await w.post(`/board/qna/${secret}/comments`, { body: '작성자추가질문' });
  r = await w.get(`/board/qna/${secret}`);
  assert.match(r.text, /<span class="chip staff">담당자 답변<\/span> 담당자/);
  assert.match(r.text, /담당자의비밀답변/);
  assert.match(r.text, /작성자추가질문/);
  r = await pb.get('/board/qna?q=' + encodeURIComponent('비밀질문'));
  assert.ok(!r.text.includes('비밀질문제목') && !r.text.includes('비밀내용키워드') && !r.text.includes('담당자의비밀답변'));
  assert.match((await w.get('/board/qna')).text, /<span class="chip staff">담당자 답변<\/span>/);

  // 공개 질문: 신청자(승인 대기 포함)·담당자 모두 답변
  assert.equal((await pb.post(`/board/qna/${open}/comments`, { body: '참여자답변' })).status, 303);
  assert.equal((await w.post(`/board/qna/${open}/comments`, { body: '대기자답변' })).status, 303);
  assert.equal((await m.post(`/board/qna/${open}/comments`, { body: '담당자답변' })).status, 303);
  r = await pa.get(`/board/qna/${open}`);
  for (const x of ['참여자답변', '대기자답변', '담당자답변']) assert.ok(r.text.includes(x), x);
  assert.equal((await m.post('/board/qna/new', { title: '담당자 질문', body: 'x', visibility: 'members' })).status, 303, '담당자도 질문 작성');
  // 남의 답변 수정 불가, 담당자는 삭제 가능
  const cid = (await app.sql.get("SELECT id FROM post_comments WHERE body = '참여자답변'")).id;
  assert.equal((await w.post(`/board/qna/${open}/comments/${cid}/edit`, { body: '바꿈' })).status, 403);
  await m.post(`/board/qna/${open}/comments/${cid}/delete`);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM post_comments WHERE id = ?', cid)).n, 0);
  for (const bad of ['01060000001', '010-6000-0001']) assert.ok(!r.text.includes(bad), bad);
});

test('게시판 목록: 페이지 이동, 검색, 잘못된 게시판·번호는 404', async (t) => {
  const { app, pa } = await setup(t);
  for (let i = 1; i <= 17; i++) await pa.post('/board/free/new', { title: `글${String(i).padStart(2, '0')}`, body: i === 3 ? '찾을단어' : '본문' });
  let r = await pa.get('/board/free');
  assert.match(r.text, /글17/);
  assert.ok(!r.text.includes('글02<'));
  assert.match(r.text, /1 \/ 2/);
  r = await pa.get('/board/free?page=2');
  assert.match(r.text, /글02/);
  assert.match(r.text, /2 \/ 2/);
  r = await pa.get('/board/free?q=' + encodeURIComponent('찾을단어'));
  assert.ok(r.text.includes('글03') && !r.text.includes('글04'));
  r = await pa.get('/board/free?q=' + encodeURIComponent('%'));
  assert.match(r.text, /검색 결과가 없습니다/, '% 는 와일드카드로 쓰지 않음');
  for (const path of ['/board/etc', '/board/free/99999', '/board/free/abc']) assert.equal((await pa.get(path)).status, 404, path);
  assert.equal((await app.sql.get('SELECT COUNT(*) n FROM posts')).n, 17);
});
