import { useEffect, useState } from 'react';

/*
  التوجيه بالمسار المجزّأ (#). الرابط هو مصدر الحقيقة:
  كل صفحة لها رابط يُنسخ ويُرسل فيفتح المكان نفسه، وزر الرجوع
  في المتصفح يعمل تلقائياً.

    #/                 النظرة العامة
    #/ops/<id>         تقرير عملية
    #/projects         كل المشاريع المنشورة
    #/projects/<uuid>  تقرير مشروع
    #/s/<uuid>         تعبئة استبيان (صفحة مستقلة)
    #/maps             عارض الخرائط
    #/admin            مساحة العمل
    #/reports          مكتبة التقارير (PDF)
    #/reports/<uuid>   تقرير مفتوح في المستعرض
    #/screen           شاشات العرض في مبنى الوزارة (عامة، بلا تسجيل دخول)
*/

export function parseRoute(hash) {
  const path = (hash || '').replace(/^#/, '') || '/';
  let m;
  if ((m = path.match(/^\/s\/([\w-]+)/))) return { page: 'fill', id: m[1] };
  if (path.startsWith('/screen')) return { page: 'screen' };
  if ((m = path.match(/^\/reports\/([\w-]+)/))) return { page: 'reports', id: m[1] };
  if (path.startsWith('/reports')) return { page: 'reports' };
  if (path.startsWith('/admin')) return { page: 'admin' };
  if (path.startsWith('/maps/risk')) return { page: 'maps', tab: 'risk' };
  if (path.startsWith('/maps')) return { page: 'maps', tab: 'ops' };
  if (path.startsWith('/monthly')) return { page: 'monthly' };
  if (path.startsWith('/rubble-map')) return { page: 'rubble', tab: 'atlas' };
  if (path.startsWith('/rubble/map')) return { page: 'rubble', tab: 'map' };
  /* الرابط القديم لمشروع ترحيل الأنقاض صار مرحلة «التنفيذ» في إدارة الأنقاض */
  if (path.startsWith('/rubble') || path.startsWith('/projects/rubble-transfer')) return { page: 'rubble' };
  if ((m = path.match(/^\/ops\/([\w-]+)/))) return { page: 'ops', id: m[1] };
  /* مشروع تجريبي ثابت — لاختبار خط النشر الآلي */
  if (path.startsWith('/projects/test')) return { page: 'test-project' };
  if ((m = path.match(/^\/projects\/([\w-]+)/))) return { page: 'project', id: m[1] };
  if (path.startsWith('/projects')) return { page: 'projects' };
  return { page: 'overview' };
}

export const href = {
  overview: () => '#/',
  ops: (id) => `#/ops/${id}`,
  projects: () => '#/projects',
  maps: () => '#/maps',
  mapsRisk: () => '#/maps/risk',
  monthly: () => '#/monthly',
  rubble: () => '#/rubble',
  atlas: () => '#/rubble-map',
  rubbleMap: () => '#/rubble/map',
  project: (id) => `#/projects/${id}`,
  testProject: () => '#/projects/test',
  screen: () => '#/screen',
  reports: () => '#/reports',
};

export function navigate(to) {
  if (window.location.hash !== to) window.location.hash = to;
}

export default function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));

  useEffect(() => {
    let prev = parseRoute(window.location.hash);
    const on = () => {
      const next = parseRoute(window.location.hash);
      setRoute(next);
      /* صفحة جديدة تبدأ من أعلى — كما يتوقع المستخدم من رابط.
         فتح تقرير وإغلاقه في المستعرض لا يغيّر موضعك في المكتبة. */
      if (!(prev.page === 'reports' && next.page === 'reports')) window.scrollTo({ top: 0 });
      prev = next;
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return route;
}
