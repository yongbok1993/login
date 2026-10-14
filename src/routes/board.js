import {
  addComment, BOARDS, canComment, canDeleteComment, canDeletePost, canEditComment, canEditPost, canWrite, createPost,
  deleteComment, deletePost, getComment, getPost, isBoard, listComments, listPosts, parsePostForm, parseTextForm, updateComment,
  updatePost,
} from '../services/board.js';
import * as views from '../views/board.js';
import { deny, intParam, redirect, render, requireBoardUser } from './helpers.js';

/**
 * 게시판(공지사항·자유게시판·질문과 답변). 모든 경로에서 서버가 로그인·이용 상태(requireBoardUser: 로그인한 신청자·담당자,
 * 이용 중지 제외)를 확인하고, 글·댓글 단위 권한(작성자/담당자, 담당자에게 비공개)을 다시 확인한다.
 * 볼 수 없는 글은 404로 응답해 존재도 드러내지 않는다.
 */
export function boardRoutes(r) {
  const member = requireBoardUser;

  // 이전 공지 주소 → 공지사항 게시판
  r.get('/notices', member, (c) => redirect(c, '/board/notice', 301));
  r.get('/notices/:id', member, (c) => redirect(c, '/board/notice', 301));
  r.get('/board', member, (c) => redirect(c, '/board/notice', 302));

  function board(c) {
    return isBoard(c.params.board) ? c.params.board : null;
  }

  async function loadPost(c) {
    const b = board(c);
    const id = intParam(c.params.id);
    return b && id ? getPost(c.db, b, id, c.user) : null;
  }

  async function showPost(c, post, extra = {}, status = 200) {
    const comments = canComment(c.user, post) ? await listComments(c.db, post.id) : [];
    return render(c, (ctx) => views.detailPage(ctx, post, { comments, ...extra }), undefined, status);
  }

  r.get('/board/:board', member, async (c) => {
    const b = board(c);
    if (!b) return deny(c, 404);
    const page = intParam(c.query.get('page') || '1') || 1;
    const list = await listPosts(c.db, b, c.user, { page, q: c.query.get('q') || '' });
    return render(c, (ctx) => views.listPage(ctx, b, list), undefined);
  });

  r.get('/board/:board/new', member, (c) => {
    const b = board(c);
    if (!b) return deny(c, 404);
    if (!canWrite(c.user, b)) return deny(c, 403, `${BOARDS[b].title}에 글을 쓸 수 없습니다.`);
    return render(c, (ctx) => views.formPage(ctx, b, {}), undefined);
  });

  r.post('/board/:board/new', member, async (c) => {
    const b = board(c);
    if (!b) return deny(c, 404);
    if (!canWrite(c.user, b)) return deny(c, 403, `${BOARDS[b].title}에 글을 쓸 수 없습니다.`);
    const { value, errors } = parsePostForm(c.body, b);
    if (Object.keys(errors).length) return render(c, (ctx) => views.formPage(ctx, b, { values: value, errors }), undefined, 422);
    const id = await createPost(c.db, c.user, b, value);
    return redirect(c, `/board/${b}/${id}`);
  });

  r.get('/board/:board/:id', member, async (c) => {
    const post = await loadPost(c);
    if (!post) return deny(c, 404);
    return showPost(c, post);
  });

  r.get('/board/:board/:id/edit', member, async (c) => {
    const post = await loadPost(c);
    if (!post) return deny(c, 404);
    if (!canEditPost(c.user, post)) return deny(c, 403);
    return render(c, (ctx) => views.formPage(ctx, post.board, { post }), undefined);
  });

  r.post('/board/:board/:id/edit', member, async (c) => {
    const post = await loadPost(c);
    if (!post) return deny(c, 404);
    if (!canEditPost(c.user, post)) return deny(c, 403);
    const { value, errors } = parsePostForm(c.body, post.board);
    if (Object.keys(errors).length) return render(c, (ctx) => views.formPage(ctx, post.board, { post, values: value, errors }), undefined, 422);
    await updatePost(c.db, c.user, post, value);
    await c.session.flash('ok', '저장되었습니다.');
    return redirect(c, `/board/${post.board}/${post.id}`);
  });

  r.get('/board/:board/:id/delete', member, async (c) => {
    const post = await loadPost(c);
    if (!post) return deny(c, 404);
    if (!canDeletePost(c.user, post)) return deny(c, 403);
    return render(c, (ctx) => views.deleteConfirmPage(ctx, {
      title: post.title, description: '이 글을 삭제할까요? 댓글도 함께 삭제되며 되돌릴 수 없습니다.',
      action: `/board/${post.board}/${post.id}/delete`, back: `/board/${post.board}/${post.id}`,
    }), undefined);
  });

  r.post('/board/:board/:id/delete', member, async (c) => {
    const post = await loadPost(c);
    if (!post) return deny(c, 404);
    if (!canDeletePost(c.user, post)) return deny(c, 403);
    await deletePost(c.db, c.user, post);
    await c.session.flash('ok', '삭제되었습니다.');
    return redirect(c, `/board/${post.board}`);
  });

  // ── 댓글(자유게시판) ──
  r.post('/board/:board/:id/comments', member, async (c) => {
    const post = await loadPost(c);
    if (!post) return deny(c, 404);
    if (!canComment(c.user, post)) return deny(c, 403);
    const { value, error } = parseTextForm(c.body, 'body', post.board === 'qna' ? 10000 : undefined);
    if (error) return showPost(c, post, { commentError: error }, 422);
    await addComment(c.db, c.user, post.id, value);
    return redirect(c, `/board/${post.board}/${post.id}#comments-title`);
  });

  async function loadComment(c) {
    const post = await loadPost(c);
    const cid = intParam(c.params.cid);
    const comment = post && cid ? await getComment(c.db, post.id, cid) : null;
    return post && comment && canComment(c.user, post) ? { post, comment } : null;
  }

  r.get('/board/:board/:id/comments/:cid/edit', member, async (c) => {
    const found = await loadComment(c);
    if (!found) return deny(c, 404);
    if (!canEditComment(c.user, found.comment)) return deny(c, 403);
    return render(c, (ctx) => views.commentEditPage(ctx, found.post, found.comment), undefined);
  });

  r.post('/board/:board/:id/comments/:cid/edit', member, async (c) => {
    const found = await loadComment(c);
    if (!found) return deny(c, 404);
    if (!canEditComment(c.user, found.comment)) return deny(c, 403);
    const { value, error } = parseTextForm(c.body, 'body', found.post.board === 'qna' ? 10000 : undefined);
    if (error) return render(c, (ctx) => views.commentEditPage(ctx, found.post, found.comment, { value, error }), undefined, 422);
    await updateComment(c.db, found.comment, value);
    return redirect(c, `/board/${found.post.board}/${found.post.id}#comments-title`);
  });

  r.get('/board/:board/:id/comments/:cid/delete', member, async (c) => {
    const found = await loadComment(c);
    if (!found) return deny(c, 404);
    if (!canDeleteComment(c.user, found.comment)) return deny(c, 403);
    const { post, comment } = found;
    return render(c, (ctx) => views.deleteConfirmPage(ctx, {
      title: post.board === 'qna' ? '답변' : '댓글', description: `삭제할까요? 되돌릴 수 없습니다. “${comment.body.slice(0, 60)}”`,
      action: `/board/${post.board}/${post.id}/comments/${comment.id}/delete`, back: `/board/${post.board}/${post.id}`,
    }), undefined);
  });

  r.post('/board/:board/:id/comments/:cid/delete', member, async (c) => {
    const found = await loadComment(c);
    if (!found) return deny(c, 404);
    if (!canDeleteComment(c.user, found.comment)) return deny(c, 403);
    await deleteComment(c.db, c.user, found.comment);
    await c.session.flash('ok', '삭제했습니다.');
    return redirect(c, `/board/${found.post.board}/${found.post.id}#comments-title`);
  });
}
