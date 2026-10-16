import { html } from '../lib/html.js';
import { SITE, THEMES } from '../site.js';

function navLink(ctx, href, label) {
  const prefixes = {
    '/me/programs': ['/me/programs', '/me/open/', '/me/grow/', '/me/counseling/'],
    '/me/application': ['/me/application', '/account/password'],
    '/board': ['/board'],
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
  if (area === 'admin' && isStaff) {
    const manager = u.role === 'manager';
    return html`
      ${manager ? navLink(ctx, '/admin/participants', '신청자') : ''}
      ${navLink(ctx, '/admin/programs', '프로그램')}
      ${navLink(ctx, '/admin/grow', 'Grow 선정')}
      ${navLink(ctx, '/board', '게시판')}
      ${navLink(ctx, '/admin/link', '관계망 자동 배정')}
      ${manager ? navLink(ctx, '/admin/como', '꼬모 연동') : ''}
      ${manager ? navLink(ctx, '/admin/staff', '관리자') : ''}
      ${navLink(ctx, '/admin/forms', '신청서·동의서')}
      ${manager ? navLink(ctx, '/admin/audit', '변경 기록') : ''}
      ${navLink(ctx, '/admin/account', '내 계정')}
      ${logoutForm(ctx)}`;
  }
  if (!u) return html`${navLink(ctx, '/register', '참여 신청')}${navLink(ctx, '/forms', '신청서·동의서')}${navLink(ctx, '/login', '로그인')}`;
  if (isStaff) return html`${navLink(ctx, '/admin', '관리')}${navLink(ctx, '/board', '게시판')}${logoutForm(ctx)}`;
  // 이용 중지: 내 신청정보만
  if (u.account_status === 'suspended') return html`${navLink(ctx, '/me', '내 신청정보')}${logoutForm(ctx)}`;
  // 승인 대기·승인 해제: 내 신청정보와 게시판(상세 프로그램은 승인 후)
  if (!u.is_selected) return html`${navLink(ctx, '/me', '내 신청정보')}${navLink(ctx, '/board', '게시판')}${navLink(ctx, '/forms', '신청서·동의서')}${logoutForm(ctx)}`;
  return html`
    ${navLink(ctx, '/me', '나의 현황')}
    ${navLink(ctx, '/me/programs', '프로그램')}
    ${navLink(ctx, '/board', '게시판')}
    ${navLink(ctx, '/me/application', '내 신청정보')}
    ${logoutForm(ctx)}`;
}

export function brand(href = '/') {
  return html`<a class="brand" href="${href}" aria-label="${SITE.serviceName} 처음으로">${wordmark()}</a>`;
}

/** 사이트 브랜드 표기: LOGIN : 人 (LOGIN 영문 대문자, 콜론 앞뒤 한 칸, 人 한자) */
export function wordmark() {
  return html`LOGIN<span class="colon"> : </span><em>人</em>`;
}

/** 영역 기호. 네 번째 영역은 iN(작은 i + 강조한 N)을 한 묶음으로 표시한다. */
export function themeMark(theme) {
  if (theme === 'IN') return html`<span class="mark-in"><span class="mark-i">i</span><span class="mark-n">N</span></span>`;
  return THEMES[theme].letter;
}

/** 'L : Light' 형식 */
export function themeName(theme) {
  return html`${themeMark(theme)} : ${THEMES[theme].en}`;
}

export function layout(ctx, { title, body, area = 'public', scripts = [] }) {
  return html`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title ? `${title} | ` : ''}${SITE.serviceName}</title>
<meta name="description" content="${SITE.serviceName} · ${SITE.orgName} ${SITE.programLabel} — ${SITE.projectName}">
<meta property="og:site_name" content="${SITE.serviceName}">
<meta property="og:title" content="${title ? `${title} | ` : ''}${SITE.serviceName}">
<meta property="og:description" content="${SITE.orgName} ${SITE.programLabel} — ${SITE.projectName}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Gowun+Dodum&family=Noto+Sans+KR:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/static/styles.css">
${scripts.map((src) => html`<script src="${src}" defer></script>`)}
</head>
<body class="area-${area}">
<a class="skip" href="#main">본문 바로가기</a>
<header class="top">
  <div class="wrap">
    ${brand(area === 'admin' ? '/admin' : '/')}
    ${area === 'admin' ? html`<span class="area-tag">관리</span>` : ''}
    <nav aria-label="주 메뉴">${headerNav(ctx, area)}</nav>

  </div>
</header>
<main id="main">
  ${ctx.devNotice ? html`<div class="dev-banner" role="note">${ctx.devNotice}</div>` : ''}
  ${ctx.flash ? html`<div class="wrap"><p class="flash ${ctx.flash.type}" role="status">${ctx.flash.message}</p></div>` : ''}
  ${body}
</main>
<footer>
  <div class="wrap">
    <div class="brand" role="img" aria-label="${SITE.serviceName}">${wordmark()}</div>
    <p class="footer-program">${SITE.programLabel}</p>
    <p><b>${SITE.orgName}</b> · ${SITE.address} · TEL ${SITE.tel}</p>
  </div>
</footer>
</body>
</html>`;
}

/** 도장 배지: 영역 기호 + 짧은 이름(배열이면 줄을 나눔) */
export function stamp(theme, label) {
  const t = THEMES[theme];
  const lines = [].concat(label);
  return html`<div class="stamp ${t.key}" aria-hidden="true"><b>${themeMark(theme)}</b><span>${lines.map((x, i) => html`${i ? html`<br>` : ''}${x}`)}</span></div>`;
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
