import { audiencesFor, getNotice, listNotices } from '../services/notices.js';
import * as views from '../views/notices.js';
import { deny, intParam, render } from './helpers.js';

// 공지 보기: 비로그인·미선정은 전체 공개 공지만, 선정 참여자·관리자는 참여자 공지까지.
export function noticeRoutes(r) {
  r.get('/notices', async (c) => render(c, views.noticeListPage,
    await listNotices(c.db, { audiences: audiencesFor(c.user) }), 200, { session: !!c.user }));

  r.get('/notices/:id', async (c) => {
    const id = intParam(c.params.id);
    const n = id && (await getNotice(c.db, id, { audiences: audiencesFor(c.user) }));
    if (!n) return deny(c, 404);
    return render(c, views.noticePage, n, 200, { session: !!c.user });
  });
}
