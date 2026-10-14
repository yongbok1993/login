import { html } from '../lib/html.js';
import { formatShort } from '../lib/time.js';
import {
  authorLabel, BOARDS, canComment, canDeleteComment, canDeletePost, canEditComment, canEditPost, canWrite, isStaffAuthor, VISIBILITY,
} from '../services/board.js';
import { isAdminRole } from '../services/users.js';
import { csrfField, errorSummary, field, layout, textInput } from './layout.js';

function area(ctx) {
  return isAdminRole(ctx.user) ? 'admin' : 'me';
}

function page(ctx, title, inner) {
  return layout(ctx, { title, area: area(ctx), body: html`<section class="sec"><div class="wrap">${inner}</div></section>` });
}

export function boardTabs(ctx, current) {
  return html`<nav class="board-tabs" aria-label="게시판">
    ${Object.entries(BOARDS).map(([key, b]) => html`<a href="/board/${key}"${key === current ? html` aria-current="page"` : ''}>${b.title}</a>`)}
  </nav>`;
}

function postBadges(p) {
  return html`${p.board === 'notice' && p.is_pinned ? html`<span class="chip">중요</span> ` : ''}${p.board === 'qna'
    ? html`<span class="chip ${p.visibility === 'private' ? 'muted-chip' : ''}">${VISIBILITY[p.visibility]}</span>
      ${p.staff_answers ? html`<span class="chip staff">담당자 답변</span>` : p.comment_count ? html`<span class="chip">답변 ${p.comment_count}</span>`
        : html`<span class="chip warn">답변 대기</span>`} ` : ''}`;
}

function pager(board, { page, pages, q }) {
  if (pages <= 1) return '';
  const href = (n) => `/board/${board}?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  return html`<nav class="pager" aria-label="페이지">
    ${page > 1 ? html`<a class="btn small ghost" href="${href(page - 1)}">이전</a>` : ''}
    <span>${page} / ${pages}</span>
    ${page < pages ? html`<a class="btn small ghost" href="${href(page + 1)}">다음</a>` : ''}
  </nav>`;
}

export function listPage(ctx, board, { rows, total, page: current, pages, q }) {
  const b = BOARDS[board];
  return page(ctx, b.title, html`
    <h1 class="page-title">게시판</h1>
    ${boardTabs(ctx, board)}
    <div class="board-head">
      <h2 class="card-title">${b.title} <span class="small muted">${total}건</span></h2>
      ${canWrite(ctx.user, board) ? html`<a class="btn" href="/board/${board}/new">${b.write}</a>` : ''}
    </div>
    ${board === 'qna' ? html`<p class="small muted">'담당자에게 비공개' 질문과 그 답변은 작성자와 담당자만 볼 수 있습니다.</p>` : ''}
    <form method="get" action="/board/${board}" class="search" role="search">
      <label for="q" class="visually-hidden">검색어</label>
      <input id="q" name="q" type="search" value="${q}" maxlength="50" placeholder="제목·내용 검색">
      <button type="submit" class="btn small ghost">검색</button>
    </form>
    ${rows.length ? html`<ul class="post-list card">${rows.map((p) => html`
      <li>
        <span class="post-line">${postBadges(p)}<a href="/board/${board}/${p.id}">${p.title}</a>${p.comment_count && p.board === 'free'
          ? html` <span class="small muted">[${p.comment_count}]</span>` : ''}</span>
        <span class="small muted">${authorLabel(p)} · ${formatShort(p.created_at)}</span>
      </li>`)}</ul>` : html`<p class="card">${q ? '검색 결과가 없습니다.' : '아직 글이 없습니다.'}</p>`}
    ${pager(board, { page: current, pages, q })}`);
}

function commentBlock(ctx, post, c) {
  const staff = isStaffAuthor(c);
  return html`<li class="comment${staff ? ' by-staff' : ''}">
    <p class="small muted">${staff ? html`<span class="chip staff">${post.board === 'qna' ? '담당자 답변' : '담당자'}</span> ` : ''}${authorLabel(c)}
      · ${formatShort(c.created_at)}${c.updated_at !== c.created_at ? ' (수정됨)' : ''}</p>
    <div class="post-body">${c.body}</div>
    <div class="row-actions">
      ${canEditComment(ctx.user, c) ? html`<a class="btn small ghost" href="/board/${post.board}/${post.id}/comments/${c.id}/edit">수정</a>` : ''}
      ${canDeleteComment(ctx.user, c) ? html`<a class="btn small ghost" href="/board/${post.board}/${post.id}/comments/${c.id}/delete">삭제</a>` : ''}
    </div>
  </li>`;
}

export function detailPage(ctx, post, { comments = [], commentError } = {}) {
  const qna = post.board === 'qna';
  const noun = qna ? '답변' : '댓글';
  return page(ctx, post.title, html`
    <p class="crumb"><a href="/board/${post.board}">${BOARDS[post.board].title}</a></p>
    <article class="card post">
      <p>${postBadges(post)}</p>
      <h1 class="page-title">${post.title}</h1>
      <p class="small muted">${isStaffAuthor(post) ? html`<span class="chip staff">담당자</span> ` : ''}${authorLabel(post)} · ${formatShort(post.created_at)}${post.updated_at !== post.created_at
        ? html` · 수정 ${formatShort(post.updated_at)}` : ''}</p>
      <div class="post-body">${post.body}</div>
      <div class="row-actions">
        ${canEditPost(ctx.user, post) ? html`<a class="btn small ghost" href="/board/${post.board}/${post.id}/edit">수정</a>` : ''}
        ${canDeletePost(ctx.user, post) ? html`<a class="btn small ghost" href="/board/${post.board}/${post.id}/delete">삭제</a>` : ''}
      </div>
    </article>

    ${canComment(ctx.user, post) ? html`<section class="card comments" aria-labelledby="comments-title">
      <h2 class="card-title" id="comments-title">${noun} ${comments.length}</h2>
      ${comments.length ? html`<ul class="comment-list">${comments.map((c) => commentBlock(ctx, post, c))}</ul>`
        : qna ? html`<p class="muted">아직 답변이 없습니다.</p>` : ''}
      <form method="post" action="/board/${post.board}/${post.id}/comments" class="form" novalidate>
        ${csrfField(ctx)}
        ${field({ id: 'comment', label: `${noun} 쓰기`, error: commentError,
          input: (d) => html`<textarea id="comment" name="body" rows="${qna ? 5 : 3}" maxlength="${qna ? 10000 : 2000}" required
            ${commentError ? html`aria-invalid="true"` : ''} ${d ? html`aria-describedby="${d}"` : ''}></textarea>` })}
        <div class="actions"><button type="submit" class="btn">${noun} 등록</button></div>
      </form>
    </section>` : ''}
    <p class="actions"><a class="btn ghost" href="/board/${post.board}">목록</a></p>`);
}

export function formPage(ctx, board, { post, values = {}, errors = {} }) {
  const editing = !!post;
  const v = { title: '', body: '', visibility: board === 'qna' ? 'private' : 'members', is_pinned: 0, ...(post || {}), ...values };
  const action = editing ? `/board/${board}/${post.id}/edit` : `/board/${board}/new`;
  return page(ctx, editing ? '글 수정' : BOARDS[board].write, html`
    <p class="crumb"><a href="/board/${board}">${BOARDS[board].title}</a></p>
    <h1 class="page-title">${editing ? '글 수정' : BOARDS[board].write}</h1>
    ${errorSummary(errors)}
    <form method="post" action="${action}" class="form card" novalidate>
      ${csrfField(ctx)}
      ${field({ id: 'title', label: '제목', error: errors.title,
        input: (d) => textInput({ id: 'title', value: v.title, maxlength: 120, required: true, error: errors.title, describedBy: d }) })}
      ${field({ id: 'body', label: '내용', error: errors.body,
        input: (d) => html`<textarea id="body" name="body" rows="10" maxlength="10000" required
          ${errors.body ? html`aria-invalid="true"` : ''} ${d ? html`aria-describedby="${d}"` : ''}>${v.body}</textarea>` })}
      ${board === 'qna' ? html`<fieldset class="choices">
        <legend>공개 범위</legend>
        ${Object.entries(VISIBILITY).map(([k, label]) => html`<label class="check">
          <input type="radio" name="visibility" value="${k}" ${v.visibility === k ? html`checked` : ''}><span>${label}</span></label>`)}
        <p class="hint">'담당자에게 비공개'는 나와 담당자만 보고 답변할 수 있습니다. '로그인 사용자에게 공개'는 로그인한 신청자와 담당자 모두 보고 답변할 수 있습니다.</p>
      </fieldset>` : ''}
      ${board === 'notice' ? html`<label class="check"><input type="checkbox" name="is_pinned" value="1" ${v.is_pinned ? html`checked` : ''}>
        <span>중요 공지(목록 맨 위에 고정)</span></label>` : ''}
      <div class="actions">
        <button type="submit" class="btn">${editing ? '저장' : '등록'}</button>
        <a class="btn ghost" href="${editing ? `/board/${board}/${post.id}` : `/board/${board}`}">취소</a>
      </div>
    </form>`);
}

export function deleteConfirmPage(ctx, { title, description, action, back }) {
  return page(ctx, '삭제 확인', html`
    <h1 class="page-title">삭제 확인</h1>
    <div class="card">
      <p><b>${title}</b></p>
      <p>${description}</p>
      <form method="post" action="${action}" class="actions">
        ${csrfField(ctx)}
        <button type="submit" class="btn danger">삭제</button>
        <a class="btn ghost" href="${back}">취소</a>
      </form>
    </div>`);
}

export function commentEditPage(ctx, post, comment, { value, error } = {}) {
  const noun = post.board === 'qna' ? '답변' : '댓글';
  return page(ctx, `${noun} 수정`, html`
    <p class="crumb"><a href="/board/${post.board}/${post.id}">${post.title}</a></p>
    <h1 class="page-title">${noun} 수정</h1>
    <form method="post" action="/board/${post.board}/${post.id}/comments/${comment.id}/edit" class="form card" novalidate>
      ${csrfField(ctx)}
      ${field({ id: 'comment', label: noun, error,
        input: (d) => html`<textarea id="comment" name="body" rows="4" maxlength="${post.board === 'qna' ? 10000 : 2000}" required
          ${error ? html`aria-invalid="true"` : ''} ${d ? html`aria-describedby="${d}"` : ''}>${value ?? comment.body}</textarea>` })}
      <div class="actions"><button type="submit" class="btn">저장</button>
        <a class="btn ghost" href="/board/${post.board}/${post.id}">취소</a></div>
    </form>`);
}
