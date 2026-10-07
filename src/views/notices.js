import { html } from '../lib/html.js';
import { formatDateTime } from '../lib/time.js';
import { layout } from './layout.js';

function area(ctx) {
  if (!ctx.user) return 'public';
  return ctx.user.role === 'participant' ? 'me' : 'admin';
}

export function noticeItems(list) {
  return html`<ul class="notice-list">${list.map((n) => html`
    <li>
      <a href="/notices/${n.id}">${n.is_pinned ? html`<span class="chip">고정</span> ` : ''}${n.title}</a>
      <span class="small muted">${formatDateTime(n.created_at).replace(/ \d\d:\d\d$/, '')}${n.audience === 'participants' ? ' · 참여자 공지' : ''}</span>
    </li>`)}</ul>`;
}

export function noticeListPage(ctx, list) {
  return layout(ctx, {
    title: '공지',
    area: area(ctx),
    body: html`<section class="sec"><div class="wrap">
      <h1 class="page-title">공지</h1>
      ${list.length ? html`<div class="card">${noticeItems(list)}</div>` : html`<p class="card">등록된 공지가 없습니다.</p>`}
    </div></section>`,
  });
}

export function noticePage(ctx, n) {
  return layout(ctx, {
    title: n.title,
    area: area(ctx),
    body: html`<section class="sec"><div class="wrap">
      <p class="crumb"><a href="/notices">공지</a></p>
      <article class="card notice">
        <h1 class="page-title">${n.title}</h1>
        <p class="small muted">${formatDateTime(n.created_at)}${n.audience === 'participants' ? ' · 참여자 공지' : ''}</p>
        <div class="notice-body">${n.body}</div>
      </article>
    </div></section>`,
  });
}
