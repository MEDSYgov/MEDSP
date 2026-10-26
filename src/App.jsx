import { useEffect, useState } from 'react';
import { getData, clearData } from './data/api';
import Masthead from './components/Masthead';
import MainNav from './components/MainNav';
import ReportShell from './components/ReportShell';
import Home from './components/Home';
import Footer from './components/Footer';
import { categories } from './data/categories';
import { REPORT_VIEWS } from './data/reportViews';
import useTheme from './hooks/useTheme';
import ProjectsTab from './projects/ProjectsTab';
import ProjectReport from './projects/ProjectReport';
import { listPublishedProjects } from './projects/store';
import { isEntityRegistry } from './projects/RubbleRegistry';
import useRoute, { href } from './hooks/useRoute';
import AdminApp from './admin/AdminApp';
import FillPage from './projects/FillPage';
import AuthGate from './admin/AuthGate';
import MapsPage from './components/MapsPage';
import OpsMapView from './components/OpsMapView';
import MonthlyReport from './components/MonthlyReport';
import RubbleHub from './projects/RubbleHub';


/* الأقسام: ops (النظرة العامة والعمليات والخرائط) · monthly · rubble · projects */
const SECTION_OF = { overview: 'ops', ops: 'ops', maps: 'ops', monthly: 'monthly', rubble: 'rubble', projects: 'projects', project: 'projects', 'test-project': 'projects' };
const FIRST = [['ops', '#/'], ['rubble', '#/rubble'], ['monthly', '#/monthly'], ['projects', '#/projects']];
const WORKSPACE = { super_admin: 'مساحة العمل', admin: 'مساحة العمل', reviewer: 'مراجعة الاستبيانات', collector: 'استبياناتي' };

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const route = useRoute();

  /* رابط تعبئة: #/s/<id> — صفحة مستقلة (تحميها كلمة مرور الاستبيان إن وُجدت) */
  if (route.page === 'fill') {
    return (
      <div className="layout">
        <Masthead theme={theme} onToggleTheme={toggleTheme} />
        <main><FillPage surveyId={route.id} /></main>
        <Footer />
      </div>
    );
  }

  /* كل ما عدا التعبئة خلف تسجيل الدخول */
  const frame = (node) => (
    <div className="layout">
      <Masthead theme={theme} onToggleTheme={toggleTheme} />
      <main>{node}</main>
      <Footer />
    </div>
  );
  return (
    <AuthGate wrap={frame}>
      {({ me, signOut }) => <Platform me={me} signOut={() => { clearData(); signOut(); }} theme={theme} toggleTheme={toggleTheme} route={route} />}
    </AuthGate>
  );
}

function Platform({ me, signOut, theme, toggleTheme, route }) {
  const full = me.role === 'super_admin' || me.role === 'admin';
  const can = (sec) => full || (me.role !== 'collector' && (!me.sections?.length || me.sections.includes(sec)));
  const allowedHere = route.page === 'admin' || can(SECTION_OF[route.page] || 'ops');
  /* صفحة غير مسموحة (مثل النظرة العامة لحساب الأنقاض فقط) ← أول قسم مسموح */
  useEffect(() => {
    if (allowedHere) return;
    const first = FIRST.find(([sec]) => can(sec));
    window.location.hash = first ? first[1] : '#/admin';
  });
  const user = { name: me.displayName || me.username, workspace: WORKSPACE[me.role], onSignOut: signOut };
  /* التقرير الظاهر يُشتق من الرابط */
  const activeId = route.page === 'ops' ? route.id : 'overview';
  const [projects, setProjects] = useState({ status: 'loading', list: [] });
  const [base, setBase] = useState({ status: 'loading' });
  /* تُحمّل بيانات كل تقرير عند فتحه أول مرة فقط، ثم تُحفظ */
  const [reports, setReports] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      can('ops') || can('monthly') ? getData('summary') : Promise.resolve({ byOperation: [] }),
      getData('basemap'),
    ])
      .then(([overview, basemap]) => setBase({ status: 'ready', overview, basemap }))
      .catch(() => setBase({ status: 'error' }));
  }, []);

  /* المشاريع المنشورة — لقائمة التنقل ولصفحات المشاريع */
  useEffect(() => {
    if (!can('projects') && !can('rubble')) { setProjects({ status: 'ready', list: [] }); return; }
    listPublishedProjects()
      /* سجل الجهات مشروع منشور تقنياً (لتُقرأ سجلاته)، لكنه يُعرض داخل «إدارة الأنقاض» لا كمشروع */
      .then((list) => setProjects({ status: 'ready', list: list.filter((p) => !isEntityRegistry(p)) }))
      .catch(() => setProjects({ status: 'error', list: [] }));
  }, []);

  useEffect(() => {
    if ((route.page !== 'overview' && route.page !== 'ops') || !can('ops')) return;
    if (route.page === 'ops' && !categories.some((c) => c.id === activeId)) return;
    if (reports[activeId]) return;
    let cancelled = false;

    getData(activeId)
      .then((data) => {
        if (!cancelled) setReports((prev) => ({ ...prev, [activeId]: data }));
      })
      .catch(() => {
        if (!cancelled) setError(activeId);
      });

    return () => {
      cancelled = true;
    };
  }, [activeId, reports, route.page]);

  const isHome = route.page === 'overview';
  const unknownOp = route.page === 'ops' && !categories.some((c) => c.id === route.id);
  const active = isHome
    ? {
        id: 'overview',
        name: 'النظرة العامة',
        summary: 'ملخّص كل عمليات الوزارة المسجّلة في الفترة المختارة.',
      }
    : categories.find((c) => c.id === activeId) ?? categories[0];
  const report = reports[activeId];
  const view = REPORT_VIEWS[activeId];

  const count =
    base.status === 'ready' && !isHome
      ? base.overview.byOperation.find((o) => o.label === active.op)?.value ?? 0
      : null;

  const loading = base.status === 'loading' || (!report && error !== activeId);
  const failed = base.status === 'error' || error === activeId;

  /* بنود قائمة العمليات: أيقونة كل تقرير وعدد عملياته */
  const ops = categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: REPORT_VIEWS[c.id]?.icon || 't_textarea',
    count: base.status === 'ready'
      ? base.overview.byOperation.find((o) => o.label === c.op)?.value ?? 0
      : null,
  }));

  const currentProject = route.page === 'project'
    ? projects.list.find((p) => p.id === route.id)
    : null;

  /* عنوان تبويب المتصفح — يظهر عند مشاركة الرابط */
  useEffect(() => {
    const site = 'منصة مديرية التخطيط والإحصاء';
    let page = '';
    if (route.page === 'ops' && !unknownOp) page = `تقرير ${active.name}`;
    else if (route.page === 'projects') page = 'المشاريع الإحصائية';
    else if (route.page === 'project' && currentProject) page = currentProject.name;
    else if (route.page === 'test-project') page = 'مشروع تجريبي';
    else if (route.page === 'admin') page = 'مساحة العمل';
    else if (route.page === 'monthly') page = 'التقرير الشهري';
    else if (route.page === 'rubble') page = 'إدارة الأنقاض';
    else if (route.page === 'maps') page = route.tab === 'risk' ? 'خريطة الأخطار المتعددة' : 'خريطة العمليات';
    document.title = page ? `${page} — ${site}` : `${site} — وزارة الطوارئ وإدارة الكوارث`;
  }, [route, active.name, currentProject, unknownOp]);

  /* مساحة العمل الإدارية — خلف تسجيل الدخول */
  if (route.page === 'admin') {
    return (
      <div className="layout">
        <Masthead theme={theme} onToggleTheme={toggleTheme} />
        <main>
          {(
              <>
                <div className="adminbar">
                  <div className="shell adminbar__inner">
                    <span className="adminbar__label">مساحة العمل</span>
                    <span className="adminbar__user">
                      <span>{me.displayName}</span>
                      <button type="button" className="adminbar__exit" onClick={signOut}>خروج</button>
                      {me.role !== 'collector' && <a className="adminbar__exit" href="#/">المنصة</a>}
                    </span>
                  </div>
                </div>
                <AdminApp basemap={base.basemap} me={me} />
              </>
            )}
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="layout">
      <Masthead theme={theme} onToggleTheme={toggleTheme} user={user} />
      <MainNav route={route} ops={ops} projects={projects.list} projectsStatus={projects.status} can={can} />

      <main>
        {!allowedHere && <section className="shell"><div className="pending"><p>جارٍ التحويل…</p></div></section>}
        {allowedHere && route.page === 'rubble' && (
          <section className="shell">
            <div className="report__head"><h1>إدارة الأنقاض</h1></div>
            <p className="report__summary">متابعة الأنقاض عبر مراحلها: من التقدير، إلى التخطيط والدراسة، فالتنفيذ والترحيل، ثم التدوير والاستثمار.</p>
            <RubbleHub basemap={base.basemap} initial={route.tab} />
          </section>
        )}

        {allowedHere && route.page === 'monthly' && (
          <section className="shell">
            <div className="report__head"><h1>التقرير الشهري</h1></div>
            <p className="report__summary">الأشكال الإحصائية للتقرير الشهري، جاهزة للتحميل كصور.</p>
            <MonthlyReport />
          </section>
        )}

        {allowedHere && route.page === 'maps' && (
          <section className="shell">
            <nav className="maps-switch" aria-label="الخرائط">
              <a href="#/maps" className={route.tab !== 'risk' ? 'is-on' : ''}>خريطة العمليات</a>
              <a href="#/maps/risk" className={route.tab === 'risk' ? 'is-on' : ''}>خريطة الأخطار المتعددة</a>
            </nav>
            {route.tab === 'risk' ? (
              <>
                <div className="report__head"><h1>خريطة الأخطار المتعددة</h1></div>
                <p className="report__summary">مؤشرات الخطر الزلزالي وقابلية الفيضان والخطر المركّب على مستوى النواحي، بتحليل هرمي (AHP).</p>
                <MapsPage />
              </>
            ) : (
              <>
                <div className="report__head"><h1>خريطة العمليات</h1></div>
                <p className="report__summary">عمليات الدفاع المدني في كل تجمع سكاني: الإسعاف والإطفاء وحوادث السير والإنقاذ البارد والغرق وغيرها، مع فرز حسب النوع والزمن والمكان.</p>
                <OpsMapView />
              </>
            )}
          </section>
        )}

        {allowedHere && route.page === 'projects' && (
          <section className="shell">
            <div className="report__head"><h1>المشاريع الإحصائية</h1></div>
            <p className="report__summary">تقارير تفاعلية مبنية على بيانات ميدانية معتمدة.</p>
            <ProjectsTab projects={projects.list} status={projects.status} />
          </section>
        )}

        {allowedHere && route.page === 'test-project' && (
          <section className="shell">
            <div className="report__head"><h1>مشروع تجريبي</h1></div>
            <p className="report__summary">صفحة تجريبية لاختبار النشر الآلي من GitHub إلى السيرفر.</p>
            <div className="pending">
              <h3>النشر الآلي يعمل</h3>
              <p>إن كنت ترى هذه الصفحة، فقد وصل التعديل من GitHub إلى السيرفر تلقائياً.</p>
              <a className="q-btn" href={href.projects()}>كل المشاريع</a>
            </div>
          </section>
        )}

        {allowedHere && route.page === 'project' && (
          <section className="shell">
            {projects.status === 'loading' && <div className="pending"><p>جارٍ التحميل…</p></div>}
            {projects.status !== 'loading' && !currentProject && (
              <div className="pending">
                <h3>المشروع غير متاح</h3>
                <p>ربما أُلغي نشره أو أن الرابط غير صحيح.</p>
                <a className="q-btn" href={href.projects()}>كل المشاريع</a>
              </div>
            )}
            {currentProject && (
              <>
                <div className="report__head"><h1>{currentProject.name}</h1></div>
                {currentProject.description && (
                  <p className="report__summary">{currentProject.description}</p>
                )}
                <ProjectReport project={currentProject} basemap={base.basemap} />
              </>
            )}
          </section>
        )}

        {allowedHere && unknownOp && (
          <section className="shell">
            <div className="pending">
              <h3>التقرير غير موجود</h3>
              <p>تحقق من الرابط، أو اختر تقريراً من قائمة العمليات.</p>
              <a className="q-btn" href={href.overview()}>النظرة العامة</a>
            </div>
          </section>
        )}

        {allowedHere && (route.page === 'overview' || (route.page === 'ops' && !unknownOp)) && (
        <article className="shell">
          <div className="report__head">
            <h1>{isHome ? 'النظرة العامة' : `تقرير ${active.name}`}</h1>
          </div>
          <p className="report__summary">{active.summary}</p>

          {loading && (
            <div className="pending">
              <p>جارٍ تحميل البيانات…</p>
            </div>
          )}

          {failed && (
            <div className="pending">
              <h3>تعذّر تحميل البيانات</h3>
              <p>تأكد من وجود ملف التصدير في مجلد data داخل المستودع.</p>
            </div>
          )}

          {!loading && !failed && report && isHome && (
            <Home report={report} basemap={base.basemap} onOpen={(id) => { window.location.hash = href.ops(id); }} />
          )}

          {!loading && !failed && report && !isHome && count === 0 && (
            <div className="pending">
              <h3>لا توجد عمليات مسجّلة</h3>
              <p>لم تُسجَّل أي عملية من هذا النوع ضمن الفترة المتاحة.</p>
            </div>
          )}

          {!loading && !failed && report && !isHome && count > 0 && (
            <ReportShell
              key={activeId}
              report={report}
              basemap={base.basemap}
              view={view}
            />
          )}
        </article>
        )}
      </main>

      <Footer />
    </div>
  );
}
