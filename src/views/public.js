import { html } from '../lib/html.js';
import { canUseInternal, isAdminRole } from '../services/users.js';
import { SITE, THEME_ORDER, THEMES } from '../site.js';
import { REVIEW_NOTICE } from './application.js';
import { layout, stamp, themeDot, wordmark } from './layout.js';

function programItems(list) {
  return list.map((p) => html`<li>${p.name} <small>${p.detail ? html`${p.detail}<br>` : ''}${p.schedule_label}</small></li>`);
}

/** 프로그램 카드(L·O·G·IN 같은 구성). 승인된 참여자와 관리자에게만 보여 준다. */
export function programCards(groups) {
  return html`
    <div class="log-grid four">
      ${THEME_ORDER.map((k) => {
        const t = THEMES[k];
        return html`<article class="log-card ${t.key}">
          ${stamp(k, t.short)}
          <h3>${t.title}</h3><span class="en">${t.en.toUpperCase()}</span>
          <ul>${programItems(groups[k] || [])}</ul>
        </article>`;
      })}
    </div>`;
}

function heroButtons(ctx) {
  const u = ctx.user;
  if (!u) return html`<a class="btn" href="/register">신청하기</a><a class="btn ghost" href="/login">로그인</a>`;
  if (isAdminRole(u)) return html`<a class="btn" href="/admin">관리</a><a class="btn ghost" href="/board">게시판</a>`;
  if (canUseInternal(u)) return html`<a class="btn" href="/me">나의 현황</a><a class="btn ghost" href="/board">게시판</a>`;
  return html`<a class="btn" href="/me">내 신청정보</a>`;
}

export function homePage(ctx, groups) {
  const body = html`
  <section class="hero">
    <div class="wrap">
      <div>
        <p class="eyebrow">${SITE.orgName} · ${SITE.projectName}</p>
        <h1 class="wordmark">${wordmark()}</h1>
        <p class="themes-line">
          ${THEME_ORDER.map((k) => html`<b>${themeDot(k)}${THEMES[k].letter} ${THEMES[k].short} — ${THEMES[k].en}</b>`)}
        </p>
        <div class="btns">${heroButtons(ctx)}</div>
        ${ctx.user ? '' : html`<p class="hero-note">${REVIEW_NOTICE}</p>`}
      </div>
      <div class="stamps" aria-hidden="true">
        ${THEME_ORDER.map((k) => stamp(k, [THEMES[k].short, THEMES[k].en]))}
      </div>
    </div>
  </section>
  ${groups ? html`<section id="programs" class="sec">
    <div class="wrap">
      <div class="sec-head"><h2>프로그램</h2></div>
      ${programCards(groups)}
    </div>
  </section>` : ''}`;
  return layout(ctx, { title: '', body });
}

export function errorPage(ctx, status, message) {
  const titles = { 403: '접근 권한이 없습니다', 404: '페이지를 찾을 수 없습니다', 500: '오류가 발생했습니다',
    503: '잠시 이용할 수 없습니다' };
  const title = titles[status] || '요청을 처리할 수 없습니다';
  const body = html`<section class="sec narrow"><div class="wrap">
    <h1 class="page-title">${title}</h1>
    ${message ? html`<p>${message}</p>` : ''}
    <p class="actions"><a class="btn ghost" href="/">처음으로</a></p>
  </div></section>`;
  return layout(ctx, { title, body, area: ctx.area || 'public' });
}
