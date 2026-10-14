import { batch, get, all, stmt } from '../lib/db.js';
import { nowIso } from '../lib/time.js';
import { auditStmt } from './audit.js';

// 신청서·동의서 양식 파일. 기관이 승인한 실제 양식을 담당자가 등록·교체한다(가짜 파일·임의 문구를 만들지 않음).
// 파일은 D1(form_files)에 BLOB으로 보관한다(D1 한 값 최대 2MB → 1.9MB 제한).
// 빈 양식이므로 비로그인 방문자도 내려받을 수 있다. 내려받기·인쇄는 개인정보 동의 처리와 무관하다.

export const FORM_KINDS = {
  application: { title: '프로그램 신청서' },
  consent: { title: '개인정보 활용 동의서' },
};

export const MAX_FORM_BYTES = 1900 * 1024;

// 확장자별 허용 형식과 파일 첫 바이트(내용이 실제 그 형식인지 확인)
const TYPES = {
  pdf: { type: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  hwp: { type: 'application/x-hwp', magic: [0xd0, 0xcf, 0x11, 0xe0] }, // OLE
  hwpx: { type: 'application/vnd.hancom.hwpx', magic: [0x50, 0x4b, 0x03, 0x04] }, // ZIP
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [0x50, 0x4b, 0x03, 0x04] },
};

export const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');

export function isFormKind(k) {
  return Object.prototype.hasOwnProperty.call(FORM_KINDS, k);
}

/** 업로드 파일 검사. 문제가 있으면 오류 문구, 없으면 { filename, contentType, bytes } */
export function checkUpload(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) return { error: '파일을 선택해 주세요.' };
  const filename = String(file.name || '').replace(/[\\/\r\n"]/g, '').trim().slice(-120);
  const ext = (filename.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  const t = ext && TYPES[ext];
  if (!t) return { error: 'PDF, HWP, HWPX, DOCX 파일만 등록할 수 있습니다.' };
  if (file.size > MAX_FORM_BYTES) return { error: '파일이 너무 큽니다(최대 1.9MB). PDF로 저장하거나 용량을 줄여 주세요.' };
  return { filename, ext, contentType: t.type, magic: t.magic };
}

export function magicMatches(bytes, magic) {
  return magic.every((b, i) => bytes[i] === b);
}

export function listForms(db) {
  return all(db, 'SELECT kind, filename, content_type, size, uploaded_at FROM form_files');
}

export async function getForm(db, kind) {
  const row = await get(db, 'SELECT * FROM form_files WHERE kind = ?', kind);
  if (!row) return null;
  return { ...row, bytes: new Uint8Array(row.data) };
}

export async function saveForm(db, actorId, kind, { filename, contentType, bytes }) {
  const now = nowIso();
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await batch(db, [
    stmt(db, `INSERT INTO form_files (kind, filename, content_type, size, data, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind) DO UPDATE SET filename = excluded.filename, content_type = excluded.content_type, size = excluded.size,
        data = excluded.data, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at`,
    kind, filename, contentType, bytes.byteLength, data, actorId, now),
    auditStmt(db, actorId, 'form.upload', 'form', null, { kind, filename, size: bytes.byteLength }),
  ]);
}

export async function deleteForm(db, actorId, kind) {
  await batch(db, [
    stmt(db, 'DELETE FROM form_files WHERE kind = ?', kind),
    auditStmt(db, actorId, 'form.delete', 'form', null, { kind }),
  ]);
}

/** Content-Disposition: 한글 파일명은 RFC 5987(filename*)로, 대체 이름은 ASCII */
export function contentDisposition(type, kind, filename) {
  const ext = (filename.match(/\.([a-z0-9]+)$/i) || [])[1] || 'bin';
  return `${type}; filename="${kind}.${ext.toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
