import { html } from '../lib/html.js';
import { SITE } from '../site.js';
import { layout, stamp, themeDot } from './layout.js';

function programItems(list) {
  return list.map((p) => html`<li>${p.name} <small>${p.detail ? html`${p.detail}<br>` : ''}${p.schedule_label}</small></li>`);
}

// 공개 프로그램 카드. 꼬모 링크·상담 신청 버튼을 두지 않는다.
export function programCards(groups) {
  return html`
    <div class="log-grid">
      <article class="log-card l">
        ${stamp('L', '관계')}
        <h3>관계</h3><span class="en">LINK</span>
        <ul>${programItems(groups.L)}</ul>
        <span class="mode">선정 시 전체 자동 참여</span>
      </article>
      <article class="log-card o">
        ${stamp('O', '마음')}
        <h3>마음</h3><span class="en">OPEN</span>
        <ul>${programItems(groups.O)}</ul>
      </article>
      <article class="log-card g">
        ${stamp('G', '성장')}
        <h3>성장</h3><span class="en">GROW</span>
        <ul>${programItems(groups.G)}</ul>
        <span class="mode">희망 활동 직접 선택</span>
      </article>
    </div>
    ${groups.IN.length ? html`<div class="network">
      <h3>IN · 지역사회 네트워크</h3>
      <ul>${groups.IN.map((p) => html`<li>${p.name} — ${p.schedule_label}${p.detail ? html` <small>${p.detail}</small>` : ''}</li>`)}</ul>
    </div>` : ''}`;
}

export function homePage(ctx, groups) {
  const body = html`
  <section class="hero">
    <div class="wrap">
      <div>
        <p class="eyebrow">${SITE.orgName} · ${SITE.projectName}</p>
        <h1 class="wordmark">로그<em>人</em></h1>
        <p class="themes-line">
          <b>${themeDot('L')}L 관계 — Link</b>
          <b>${themeDot('O')}O 마음 — Open</b>
          <b>${themeDot('G')}G 성장 — Grow</b>
        </p>
        <div class="btns">
          ${ctx.user ? html`<a class="btn" href="/me">나의 현황</a>` : html`<a class="btn" href="/register">참여 등록</a>`}
        </div>
      </div>
      <div class="stamps" aria-hidden="true">
        ${stamp('L', '관계 · Link')}${stamp('O', '마음 · Open')}${stamp('G', '성장 · Grow')}
      </div>
    </div>
  </section>
  <section id="programs" class="sec">
    <div class="wrap">
      <div class="sec-head"><h2>프로그램</h2></div>
      ${programCards(groups)}
    </div>
  </section>`;
  return layout(ctx, { title: '', body });
}

export function errorPage(ctx, status, message) {
  const titles = { 403: '접근 권한이 없습니다', 404: '페이지를 찾을 수 없습니다', 500: '오류가 발생했습니다' };
  const title = titles[status] || '요청을 처리할 수 없습니다';
  const body = html`<section class="sec narrow"><div class="wrap">
    <h1 class="page-title">${title}</h1>
    ${message ? html`<p>${message}</p>` : ''}
    <p class="actions"><a class="btn ghost" href="/">처음으로</a></p>
  </div></section>`;
  return layout(ctx, { title, body, area: ctx.area || 'public' });
}
