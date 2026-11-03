import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { href } from '../hooks/useRoute';

/*
  شريط التنقل: ثلاثة مداخل.
    النظرة العامة  ← رابط مباشر
    العمليات       ← لوحة بتقارير العمليات: أيقونة واسم وعدد
    المشاريع       ← لوحة بالمشاريع المنشورة، مع بحث حين تكثر

  اللوحة تُفتح بالضغط (لا بالتمرير فوقها — لا يعمل على اللمس)،
  وتُغلق بالاختيار أو Esc أو الضغط خارجها.
  التبويب يعرض موقعك الحالي: «العمليات ← الإسعاف».
*/

const fmt = (n) => Number(n).toLocaleString('en-US');

function OpsMenu({ ops, activeId }) {
  return (
    <div className="navmenu__grid">
      {ops.map((o) => (
        <a key={o.id} href={href.ops(o.id)}
          className={`navcard${o.id === activeId ? ' is-on' : ''}`}
          aria-current={o.id === activeId ? 'page' : undefined}>
          <Icon name={o.icon} className="navcard__icon" />
          <span className="navcard__name">{o.name}</span>
          <span className="navcard__count" dir="ltr">
            {o.count == null ? '' : fmt(o.count)}
          </span>
        </a>
      ))}
    </div>
  );
}

function ProjectsMenu({ projects, status, activeId }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim();
    return t ? projects.filter((p) => p.name.includes(t) || p.description?.includes(t)) : projects;
  }, [projects, q]);

  /* المشروع التجريبي يظهر دائماً في أول القائمة */
  const testCard = (
    <a href={href.testProject()} className={`navcard navcard--project${activeId === 'test' ? ' is-on' : ''}`}>
      <span className="navcard__name">مشروع تجريبي</span>
      <span className="navcard__desc">صفحة تجريبية لاختبار النشر الآلي.</span>
    </a>
  );

  if (status === 'loading') return <p className="navmenu__empty">جارٍ التحميل…</p>;
  if (status === 'error') return <p className="navmenu__empty">تعذّر تحميل المشاريع. حدّث الصفحة وحاول مجدداً.</p>;
  if (projects.length === 0) {
    return (
      <div className="navmenu__empty">
        <div className="navmenu__grid navmenu__grid--projects">{testCard}</div>
        <strong>لا توجد مشاريع منشورة بعد</strong>
        <span>تظهر هنا المشاريع الإحصائية بعد اعتماد بياناتها ونشرها.</span>
      </div>
    );
  }

  return (
    <>
      {projects.length > 8 && (
        <input className="q-input navmenu__search" type="search" value={q} autoFocus
          placeholder="ابحث عن مشروع…" onChange={(e) => setQ(e.target.value)} />
      )}
      <div className="navmenu__grid navmenu__grid--projects">
        {testCard}
        {list.map((p) => (
          <a key={p.id} href={href.project(p.id)}
            className={`navcard navcard--project${p.id === activeId ? ' is-on' : ''}`}
            aria-current={p.id === activeId ? 'page' : undefined}>
            <span className="navcard__name">{p.name}</span>
            {p.description && <span className="navcard__desc">{p.description}</span>}
            <span className="navcard__meta">{fmt(p.responses.length)} استمارة معتمدة</span>
          </a>
        ))}
        {list.length === 0 && <p className="navmenu__empty">لا نتائج لـ «{q}».</p>}
      </div>
      <a className="navmenu__all" href={href.projects()}>عرض كل المشاريع</a>
    </>
  );
}

export default function MainNav({ route, ops, projects, projectsStatus, can = () => true }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);

  /* أغلق عند تغيّر الصفحة */
  useEffect(() => { setOpen(null); }, [route]);

  /* أغلق بـ Esc أو بالضغط خارج الشريط */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const currentOp = route.page === 'ops' ? ops.find((o) => o.id === route.id) : null;
  const currentProject = route.page === 'project' ? projects.find((p) => p.id === route.id) : null;

  const toggle = (key) => setOpen(open === key ? null : key);

  return (
    <nav className="categories mainnav" ref={ref} aria-label="التنقل الرئيسي">
      <div className="shell">
        <div className="mainnav__bar">
          {can('ops') && <a href={href.overview()}
            className={`categories__item${route.page === 'overview' ? ' is-active' : ''}`}
            aria-current={route.page === 'overview' ? 'page' : undefined}>
            النظرة العامة
          </a>}

          {can('ops') && <button type="button"
            className={`categories__item mainnav__drop${route.page === 'ops' ? ' is-active' : ''}${open === 'ops' ? ' is-open' : ''}`}
            aria-expanded={open === 'ops'} aria-haspopup="true" aria-controls="menu-ops"
            onClick={() => toggle('ops')}>
            العمليات
            {currentOp && <span className="mainnav__here">{currentOp.name}</span>}
            <span className="mainnav__caret" aria-hidden="true" />
          </button>}

          {can('projects') && <button type="button"
            className={`categories__item mainnav__drop${route.page === 'project' || route.page === 'projects' || route.page === 'test-project' ? ' is-active' : ''}${open === 'projects' ? ' is-open' : ''}`}
            aria-expanded={open === 'projects'} aria-haspopup="true" aria-controls="menu-projects"
            onClick={() => toggle('projects')}>
            المشاريع
            {currentProject && <span className="mainnav__here">{currentProject.name}</span>}
            <span className="mainnav__caret" aria-hidden="true" />
          </button>}

          {can('rubble') && <a href={href.rubble()}
            className={`categories__item${route.page === 'rubble' ? ' is-active' : ''}`}
            aria-current={route.page === 'rubble' ? 'page' : undefined}>
            إدارة الأنقاض
          </a>}

          {can('monthly') && <a href={href.monthly()}
            className={`categories__item${route.page === 'monthly' ? ' is-active' : ''}`}
            aria-current={route.page === 'monthly' ? 'page' : undefined}>
            التقرير الشهري
          </a>}

          {can('reports') && <a href={href.reports()}
            className={`categories__item${route.page === 'reports' ? ' is-active' : ''}`}
            aria-current={route.page === 'reports' ? 'page' : undefined}>
            التقارير
          </a>}

          {can('ops') && <a href={href.maps()}
            className={`categories__item${route.page === 'maps' ? ' is-active' : ''}`}
            aria-current={route.page === 'maps' ? 'page' : undefined}>
            الخرائط
          </a>}
        </div>
      </div>

      {open && (
        <div className="navmenu" id={open === 'ops' ? 'menu-ops' : 'menu-projects'}>
          <div className="shell navmenu__inner">
            <div className="navmenu__head">
              <strong>{open === 'ops' ? 'تقارير العمليات' : 'المشاريع الإحصائية'}</strong>
              <span>
                {open === 'ops'
                  ? 'من التصدير الشهري لسجلات الوزارة، مع عدد العمليات المسجّلة لكل نوع.'
                  : 'تقارير مبنية على استبيانات ميدانية، تعرض البيانات المعتمدة فقط.'}
              </span>
            </div>
            {open === 'ops'
              ? <OpsMenu ops={ops} activeId={route.page === 'ops' ? route.id : null} />
              : <ProjectsMenu projects={projects} status={projectsStatus}
                  activeId={route.page === 'project' ? route.id : route.page === 'test-project' ? 'test' : null} />}
          </div>
        </div>
      )}
    </nav>
  );
}
