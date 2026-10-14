import { checkUpload, contentDisposition, deleteForm, FORM_KINDS, getForm, isFormKind, listForms, magicMatches, saveForm } from '../services/forms.js';
import * as views from '../views/forms.js';
import { deny, redirect, render, requireStaff } from './helpers.js';

/** 신청서·동의서: 빈 양식 내려받기·인쇄(누구나), 등록·교체(담당자) */
export function formRoutes(r) {
  const formsMap = async (c) => Object.fromEntries((await listForms(c.db)).map((f) => [f.kind, f]));

  r.get('/forms', async (c) => render(c, views.formsPage, await formsMap(c), 200, { session: !!c.user }));

  async function serve(c, disposition) {
    const kind = c.params.kind;
    if (!isFormKind(kind)) return deny(c, 404);
    const form = await getForm(c.db, kind);
    if (!form) return deny(c, 404, `${FORM_KINDS[kind].title}는 양식 준비 중입니다.`);
    if (disposition === 'inline' && form.content_type !== 'application/pdf') {
      return deny(c, 404, '인쇄 화면은 PDF 양식만 제공합니다. 파일을 내려받아 인쇄해 주세요.');
    }
    const headers = new Headers(c.resHeaders);
    headers.set('content-type', form.content_type);
    headers.set('content-length', String(form.bytes.byteLength));
    headers.set('content-disposition', contentDisposition(disposition, kind, form.filename));
    headers.set('cache-control', 'no-cache');
    return new Response(c.method === 'HEAD' ? null : form.bytes, { status: 200, headers });
  }

  r.get('/forms/:kind/download', (c) => serve(c, 'attachment'));
  r.get('/forms/:kind/print', (c) => serve(c, 'inline'));

  // ── 담당자: 양식 등록·교체·삭제 ──
  r.get('/admin/forms', requireStaff, async (c) => render(c, views.formsAdminPage, { forms: await formsMap(c) }));

  r.post('/admin/forms/:kind', requireStaff, async (c) => {
    const kind = c.params.kind;
    if (!isFormKind(kind)) return deny(c, 404);
    const file = c.body._files && c.body._files.file;
    const checked = checkUpload(file);
    const fail = async (error) => render(c, views.formsAdminPage, { forms: await formsMap(c), errorKind: kind, error }, 422);
    if (checked.error) return fail(checked.error);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!magicMatches(bytes, checked.magic)) return fail('파일 내용이 확장자와 맞지 않습니다. 원본 양식 파일을 다시 선택해 주세요.');
    await saveForm(c.db, c.user.id, kind, { filename: checked.filename, contentType: checked.contentType, bytes });
    await c.session.flash('ok', `${FORM_KINDS[kind].title} 양식을 등록했습니다.`);
    return redirect(c, '/admin/forms');
  });

  r.post('/admin/forms/:kind/delete', requireStaff, async (c) => {
    const kind = c.params.kind;
    if (!isFormKind(kind)) return deny(c, 404);
    await deleteForm(c.db, c.user.id, kind);
    await c.session.flash('ok', `${FORM_KINDS[kind].title} 양식을 내렸습니다. 화면에는 '양식 준비 중'으로 표시됩니다.`);
    return redirect(c, '/admin/forms');
  });
}
