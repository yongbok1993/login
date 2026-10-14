import { all, batch, get, run, stmt } from '../lib/db.js';
import { nowIso } from '../lib/time.js';
import { auditStmt } from './audit.js';
import { isAdminRole } from './users.js';

// 게시판: 공지사항(담당자 작성)·자유게시판(글·댓글)·질문과 답변(질문·답변).
// 이용 대상: 로그인한 신청자(승인 대기 포함, 이용 중지 제외)와 담당자(라우트에서 확인). 이 모듈은 게시판별 권한과 공개 범위를 판단한다.
// 질문과 답변의 '담당자에게 비공개' 글은 제목·내용·답변이 목록·검색·건수·상세 어디서도 작성자와 담당자 외에는 조회되지 않게
// SQL 조건으로 거른다. 답변은 post_comments에 저장하고 담당자 답변은 화면에서 구분 표시한다.

export const BOARDS = {
  notice: { title: '공지사항', write: '공지 쓰기' },
  free: { title: '자유게시판', write: '글쓰기' },
  qna: { title: '질문과 답변', write: '질문하기' },
};

export const VISIBILITY = { private: '담당자에게 비공개', members: '로그인 사용자에게 공개' };
export const PAGE_SIZE = 15;
const TITLE_MAX = 120;
const BODY_MAX = 10000;
const COMMENT_MAX = 2000;

export function isBoard(b) {
  return Object.prototype.hasOwnProperty.call(BOARDS, b);
}

/** 작성자 표시: 참여자는 이름, 관리자는 '담당자'. 전화번호·신청 시각은 쓰지 않는다. */
export function authorLabel(row) {
  if (!row.author_role) return '알 수 없음';
  return row.author_role === 'participant' ? row.author_name : '담당자';
}

export function canWrite(user, board) {
  if (board === 'notice') return isAdminRole(user);
  return true; // 자유게시판·질문과 답변: 신청자·담당자
}

export function canEditPost(user, post) {
  if (post.board === 'notice') return isAdminRole(user);
  return post.author_id === user.id;
}

export function canDeletePost(user, post) {
  return isAdminRole(user) || post.author_id === user.id;
}

/** 댓글(자유게시판)·답변(질문과 답변). 비공개 질문은 볼 수 있는 사람(작성자·담당자)만 여기까지 온다. */
export function canComment(user, post) {
  return post.board === 'free' || post.board === 'qna';
}

export function isStaffAuthor(row) {
  return row.author_role === 'staff' || row.author_role === 'manager';
}

export function canEditComment(user, comment) {
  return comment.author_id === user.id;
}

export function canDeleteComment(user, comment) {
  return isAdminRole(user) || comment.author_id === user.id;
}

function visibilityCond(user, params) {
  if (isAdminRole(user)) return '1 = 1';
  params.push(user.id);
  return "(p.board <> 'qna' OR p.visibility = 'members' OR p.author_id = ?)";
}

function likeEscape(q) {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const POST_COLUMNS = `p.*, u.name AS author_name, u.role AS author_role,
  (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id) AS comment_count,
  (SELECT COUNT(*) FROM post_comments pc JOIN users cu ON cu.id = pc.author_id
    WHERE pc.post_id = p.id AND cu.role IN ('staff', 'manager')) AS staff_answers`;

export async function listPosts(db, board, user, { page = 1, q = '' } = {}) {
  const params = [board];
  const conds = ['p.board = ?', visibilityCond(user, params)];
  const query = q.trim().slice(0, 50);
  if (query) {
    conds.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')");
    params.push(likeEscape(query), likeEscape(query));
  }
  const where = conds.join(' AND ');
  const total = (await get(db, `SELECT COUNT(*) AS n FROM posts p WHERE ${where}`, ...params)).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = await all(db, `SELECT ${POST_COLUMNS} FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE ${where}
    ORDER BY CASE WHEN p.board = 'notice' THEN p.is_pinned ELSE 0 END DESC, p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
  ...params, PAGE_SIZE, (current - 1) * PAGE_SIZE);
  return { rows, total, page: current, pages, q: query };
}

/** 볼 수 있는 글만 돌려준다(없거나 볼 수 없으면 null — 존재 여부도 드러내지 않음). */
export async function getPost(db, board, id, user) {
  const params = [board, id];
  return get(db, `SELECT ${POST_COLUMNS} FROM posts p LEFT JOIN users u ON u.id = p.author_id
    WHERE p.board = ? AND p.id = ? AND ${visibilityCond(user, params)}`, ...params);
}

export function recentNotices(db, limit = 3) {
  return all(db, `SELECT id, title, is_pinned, created_at FROM posts WHERE board = 'notice'
    ORDER BY is_pinned DESC, created_at DESC, id DESC LIMIT ?`, limit);
}

function str(body, k) {
  return String(Array.isArray(body[k]) ? body[k][0] ?? '' : body[k] ?? '');
}

/** 글 입력 검증. 공개 범위는 질문과 답변에만, 상단 고정은 공지사항에만 쓴다. */
export function parsePostForm(body, board) {
  const value = {
    title: str(body, 'title').trim().replace(/\s+/g, ' '),
    body: str(body, 'body').replace(/\r\n/g, '\n').trim(),
    visibility: board === 'qna' ? (str(body, 'visibility') === 'members' ? 'members' : 'private') : 'members',
    is_pinned: board === 'notice' && str(body, 'is_pinned') === '1' ? 1 : 0,
  };
  const errors = {};
  if (!value.title) errors.title = '제목을 입력해 주세요.';
  else if (value.title.length > TITLE_MAX) errors.title = `제목은 ${TITLE_MAX}자 이하로 입력해 주세요.`;
  if (!value.body) errors.body = '내용을 입력해 주세요.';
  else if (value.body.length > BODY_MAX) errors.body = `내용은 ${BODY_MAX}자 이하로 입력해 주세요.`;
  return { value, errors };
}

export function parseTextForm(body, key = 'body', max = COMMENT_MAX) {
  const value = str(body, key).replace(/\r\n/g, '\n').trim();
  if (!value) return { value, error: '내용을 입력해 주세요.' };
  if (value.length > max) return { value, error: `${max}자 이하로 입력해 주세요.` };
  return { value, error: null };
}

export async function createPost(db, user, board, v) {
  const now = nowIso();
  const meta = await run(db, `INSERT INTO posts (board, title, body, author_id, is_pinned, visibility, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, board, v.title, v.body, user.id, v.is_pinned, v.visibility, now, now);
  return meta.last_row_id;
}

export async function updatePost(db, user, post, v) {
  await run(db, 'UPDATE posts SET title = ?, body = ?, is_pinned = ?, visibility = ?, updated_at = ? WHERE id = ?',
    v.title, v.body, v.is_pinned, v.visibility, nowIso(), post.id);
}

/** 삭제(댓글 함께). 관리자가 다른 사람 글을 지우면 변경 기록에 남긴다. */
export async function deletePost(db, user, post) {
  const stmts = [stmt(db, 'DELETE FROM post_comments WHERE post_id = ?', post.id), stmt(db, 'DELETE FROM posts WHERE id = ?', post.id)];
  if (post.author_id !== user.id) stmts.push(auditStmt(db, user.id, 'post.delete', 'post', post.id, { board: post.board }));
  await batch(db, stmts);
}

export function listComments(db, postId) {
  return all(db, `SELECT c.*, u.name AS author_name, u.role AS author_role FROM post_comments c LEFT JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? ORDER BY c.created_at, c.id`, postId);
}

export function getComment(db, postId, commentId) {
  return get(db, `SELECT c.*, u.name AS author_name, u.role AS author_role FROM post_comments c LEFT JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? AND c.id = ?`, postId, commentId);
}

export async function addComment(db, user, postId, text) {
  const now = nowIso();
  return (await run(db, 'INSERT INTO post_comments (post_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    postId, user.id, text, now, now)).last_row_id;
}

export async function updateComment(db, comment, text) {
  await run(db, 'UPDATE post_comments SET body = ?, updated_at = ? WHERE id = ?', text, nowIso(), comment.id);
}

export async function deleteComment(db, user, comment) {
  const stmts = [stmt(db, 'DELETE FROM post_comments WHERE id = ?', comment.id)];
  if (comment.author_id !== user.id) stmts.push(auditStmt(db, user.id, 'comment.delete', 'comment', comment.id));
  await batch(db, stmts);
}
