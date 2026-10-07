import { html } from '../lib/html.js';
import { SITE, THEMES } from '../site.js';

function navLink(ctx, href, label) {
  const prefixes = {
    '/me/programs': ['/me/programs', '/me/open/', '/me/grow/', '/me/counseling/'],
    '/me/profile': ['/me/profile', '/me/phone'],
  }[href];
  const current = ctx.path === href
    || (prefixes ? prefixes.some((p) => ctx.path.startsWith(p))
      : !['/', '/me', '/admin'].includes(href) && ctx.path.startsWith(`${href}/`));
  return html`<a href="${href}"${current ? html` aria-current="page"` : ''}>${label}</a>`;
}

function logoutForm(ctx) {
  return html`<form method="post" action="/logout" class="inline-form">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="linklike">로그아웃</button>
  </form>`;
}

function headerNav(ctx, area) {
  const u = ctx.user;
  const isStaff = u && (u.role === 'staff' || u.role === 'manager');
  if (area === 'admin') {
    const manager = u.role === 'manager';
    return html`
      ${manager ? navLink(ctx, '/admin/participants', '참여자') : ''}
      ${navLink(ctx, '/admin/programs', '프로그램')}
      ${navLink(ctx, '/admin/link', 'Link 배정')}
      ${manager ? navLink(ctx, '/admin/como', '꼬모 연동') : ''}
      ${manager ? navLink(ctx, '/admin/audit', '변경 기록') : ''}
      ${logoutForm(ctx)}`;
  }
  if (!u) {
    return html`${navLink(ctx, '/#programs', '프로그램')}${navLink(ctx, '/me', '나의 현황')}${navLink(ctx, '/login', '로그인')}`;
  }
  if (isStaff) return html`${navLink(ctx, '/admin', '관리')}${logoutForm(ctx)}`;
  return html`
    ${navLink(ctx, '/me', '나의 현황')}
    ${u.is_selected ? navLink(ctx, '/me/programs', '프로그램') : navLink(ctx, '/#programs', '프로그램')}
    ${navLink(ctx, '/me/profile', '내 정보')}
    ${logoutForm(ctx)}`;
}

export function brand(href = '/') {
  return html`<a class="brand" href="${href}">로그<em>人</em><small>LOGIN : 人</small></a>`;
}

export function layout(ctx, { title, body, area = 'public' }) {
  const showCta = area === 'public' && !ctx.user;
  return html`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title ? `${title} | ` : ''}로그人</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Gowun+Dodum&family=Noto+Sans+KR:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="area-${area}">
<a class="skip" href="#main">본문 바로가기</a>
<header class="top">
  <div class="wrap">
    ${brand(area === 'admin' ? '/admin' : '/')}
    ${area === 'admin' ? html`<span class="area-tag">관리</span>` : ''}
    <nav aria-label="주 메뉴">${headerNav(ctx, area)}</nav>
    ${showCta ? html`<a class="cta" href="/register">참여 등록</a>` : ''}
  </div>
</header>
<main id="main">
  ${ctx.devNotice ? html`<div class="dev-banner" role="note">${ctx.devNotice}</div>` : ''}
  ${ctx.flash ? html`<div class="wrap"><p class="flash ${ctx.flash.type}" role="status">${ctx.flash.message}</p></div>` : ''}
  ${body}
</main>
<footer>
  <div class="wrap">
    <div class="brand">로그<em>人</em><small>LOGIN : 人</small></div>
    <p><b>${SITE.orgName}</b> · ${SITE.address} · TEL ${SITE.tel}</p>
  </div>
</footer>
</body>
</html>`;
}

export function stamp(theme, label) {
  const t = THEMES[theme];
  return html`<div class="stamp ${t.key}" aria-hidden="true"><b>${t.letter}</b><span>${label}</span></div>`;
}

export function themeDot(theme) {
  return html`<span class="d ${THEMES[theme].key}" aria-hidden="true"></span>`;
}

export function field({ id, label, error, hint, input }) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return html`<div class="field${error ? ' has-error' : ''}">
    <label for="${id}">${label}</label>
    ${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    ${input(describedBy)}
    ${error ? html`<p class="error" id="${id}-error">${error}</p>` : ''}
  </div>`;
}

export function textInput({ id, name = id, value = '', type = 'text', autocomplete, inputmode, required, maxlength, error, describedBy, placeholder }) {
  return html`<input id="${id}" name="${name}" type="${type}" value="${value ?? ''}"
    ${autocomplete ? html`autocomplete="${autocomplete}"` : ''} ${inputmode ? html`inputmode="${inputmode}"` : ''}
    ${maxlength ? html`maxlength="${maxlength}"` : ''} ${placeholder ? html`placeholder="${placeholder}"` : ''}
    ${required ? html`required` : ''} ${error ? html`aria-invalid="true"` : ''}
    ${describedBy ? html`aria-describedby="${describedBy}"` : ''}>`;
}

export function csrfField(ctx) {
  return html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
}

export function errorSummary(errors) {
  const list = Object.entries(errors || {});
  if (!list.length) return '';
  return html`<div class="error-summary" role="alert">
    <p>입력 내용을 확인해 주세요.</p>
    <ul>${list.map(([k, v]) => html`<li><a href="#${k}">${v}</a></li>`)}</ul>
  </div>`;
}
