import EntitiesPanel from './EntitiesPanel';
import ScreenPanel from './ScreenPanel';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as store from '../projects/store';
import SurveyBuilder from './SurveyBuilder';
import ResponsesTable from './ResponsesTable';
import SharePanel from './SharePanel';
import AccountsPanel from './AccountsPanel';
import MyAccount from './MyAccount';
import ReportDesigner from './ReportDesigner';
import ImportWizard from './importer/ImportWizard';
import DataView from './DataView';
import SurveyPage from '../survey/SurveyPage';

/*
  مساحة العمل الإدارية.

  تنبيه أمني: لا يوجد تسجيل دخول بعد — أي شخص يعرف المسار #/admin
  يصل إلى هنا. هذه مرحلة تجربة، والمصادقة والصلاحيات مرحلة لاحقة.
  لا تُدخَل بيانات حقيقية قبل بنائها.
*/

/*
  استبيان مرتبط بتقرير ثابت (مثل «مشروع ترحيل الأنقاض»): إجاباته المعتمدة تظهر
  في ذلك التقرير مباشرة، فلا معنى لنشره كمشروع مستقل.
*/
const linkedFeed = (surveys) => {
  const txt = (s) => JSON.stringify(s.pages || []);
  if (surveys.some((s) => s.report?.feed === 'rubble-transfer' || txt(s).includes('"rt_volume"'))) {
    return { name: 'إدارة الأنقاض — التنفيذ', href: '#/rubble' };
  }
  if (surveys.some((s) => s.report?.feed === 'rubble-entities' || txt(s).includes('"ent_roles"'))) {
    return { name: 'إدارة الأنقاض — الجهات العاملة', href: '#/rubble' };
  }
  return null;
};

/* استبيان ميداني */
const TABS = [
  { id: 'build', label: 'بناء الاستبيان' },
  { id: 'share', label: 'المشاركة' },
  { id: 'results', label: 'النتائج' },
  { id: 'report', label: 'تصميم التقرير' },
  { id: 'preview', label: 'معاينة التعبئة' },
];

/* مشروع بيانات: من ملف Excel فقط — بلا استبيان ولا اعتماد */
const DATA_TABS = [
  { id: 'data', label: 'البيانات' },
  { id: 'import', label: 'تحديث من ملف' },
  { id: 'report', label: 'التقرير' },
];

function useAreas(basemap) {
  return useMemo(() => {
    if (!basemap) return null;
    return {
      gov: new Map(basemap.governorates.map((g) => [g.code, g])),
      sub: new Map(basemap.subdistricts.map((s) => [s.code, s])),
    };
  }, [basemap]);
}

/* ---------------- قائمة المشاريع ---------------- */

function ProjectList({ projects, counts, onOpen, onCreate, onDelete }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [adding, setAdding] = useState(false);

  const [kind, setKind] = useState('data');
  const submit = async () => {
    if (!name.trim()) return;
    await onCreate({ name, description: desc, kind });
    setName('');
    setDesc('');
    setAdding(false);
  };

  return (
    <div className="plist">
      <div className="plist__head">
        <h2>المشاريع الإحصائية</h2>
        {onCreate && <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={() => setAdding(!adding)}>
          {adding ? 'إلغاء' : '+ مشروع جديد'}
        </button>}
      </div>

      {adding && (
        <div className="plist__form">
          <label className="bf">
            <span className="bf__label">اسم المشروع</span>
            <input className="q-input bf__input" value={name} autoFocus
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="bf">
            <span className="bf__label">وصف مختصر</span>
            <input className="q-input bf__input" value={desc}
              onChange={(e) => setDesc(e.target.value)} />
          </label>
          <div className="kind">
            <button type="button" className={`kind__opt${kind === 'data' ? ' is-on' : ''}`} onClick={() => setKind('data')}>
              <strong>مشروع بيانات</strong>
              <span>عندي ملف Excel جاهز. أرفعه، وأحدّثه بملف جديد متى شئت.</span>
            </button>
            <button type="button" className={`kind__opt${kind === 'survey' ? ' is-on' : ''}`} onClick={() => setKind('survey')}>
              <strong>استبيان ميداني</strong>
              <span>أبني استبياناً وأرسله للباحثين ليعبّئوه.</span>
            </button>
          </div>
          <button type="button" className="survey__navbtn survey__navbtn--primary" onClick={submit}>
            {kind === 'data' ? 'إنشاء ثم رفع الملف' : 'إنشاء'}
          </button>
        </div>
      )}

      {projects.length === 0 && !adding && (
        <p className="results__empty">لا توجد مشاريع بعد. ابدأ بإنشاء مشروع.</p>
      )}

      <div className="plist__grid">
        {projects.map((p) => {
          const c = counts[p.id] || { surveys: 0, pending: 0, approved: 0 };
          return (
            <article className="pcard" key={p.id}>
              <div className="pcard__head">
                <h3>{p.name}</h3>
                {c.linked
                  ? <span className="tag tag--approved">يصب في «{c.linked.name}»</span>
                  : p.published
                  ? <span className="tag tag--approved">منشور</span>
                  : <span className="tag">غير منشور</span>}
              </div>
              {p.description && <p className="pcard__desc">{p.description}</p>}
              <div className="pcard__stats">
                <span className="pcard__kind">{p.kind === 'data' ? 'مشروع بيانات' : 'استبيان ميداني'}</span>
                {p.kind === 'data'
                  ? <span>{c.approved} سجلاً</span>
                  : <><span>{c.surveys} استبيان</span><span>{c.approved} معتمد</span></>}
                {c.pending > 0 && <span className="pcard__pending">{c.pending} بانتظار المراجعة</span>}
              </div>
              {c.linked && (
                <p className="pcard__why">
                  الإجابات المعتمدة تظهر مباشرة في تقرير «{c.linked.name}» العام — لا يحتاج نشراً.
                </p>
              )}
              {!p.published && !c.linked && (
                <p className="pcard__why">
                  {p.kind === 'data' && c.approved === 0
                    ? 'لا يظهر للعامة: ارفع ملف البيانات ثم انشر.'
                    : c.approved === 0
                    ? (c.pending > 0
                      ? `لا يظهر للعامة: اعتمد السجلات (${c.pending}) ثم انشر.`
                      : 'لا يظهر للعامة: لا توجد سجلات بعد.')
                    : 'لا يظهر للعامة: افتح المشروع واضغط «نشر على الصفحة الرئيسية».'}
                </p>
              )}
              <div className="pcard__actions">
                <button type="button" className="q-btn" onClick={() => onOpen(p.id)}>فتح</button>
                {onDelete && <button type="button" className="q-btn q-btn--danger q-btn--sm"
                  onClick={() => onDelete(p.id)}>حذف</button>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- محرر المشروع ---------------- */

function ProjectEditor({ projectId, basemap, onBack, onChanged, initialTab = 'build', reviewer = false, entityReviewer = false }) {
  const areas = useAreas(basemap);
  const [project, setProject] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [activeSurvey, setActiveSurvey] = useState(null);
  const [responses, setResponses] = useState([]);
  const [tab, setTab] = useState(reviewer ? 'results' : initialTab);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(true);
  const [notice, setNotice] = useState('');
  /* إرشاد يبقى حتى يُغلق — للخطوات التي تحتاج فعلاً من المستخدم */
  const [guide, setGuide] = useState(null);

  const load = useCallback(async () => {
    const p = await store.getProject(projectId);
    let s = await store.listSurveys(projectId);
    /* مشروع البيانات يحمل جدولاً واحداً داخلياً — يُنشأ إن لم يوجد */
    if (p?.kind === 'data' && s.length === 0) {
      await store.createSurvey(projectId, { title: p.name, pages: [{ name: 'p1', title: 'البيانات', children: [] }] });
      s = await store.listSurveys(projectId);
    }
    setProject(p);
    setSurveys(s);
    setActiveSurvey((prev) => prev && s.some((x) => x.id === prev) ? prev : s[0]?.id ?? null);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /* مشروع البيانات لا يملك تبويبات الاستبيان — يفتح على «البيانات» */
  useEffect(() => {
    if (project?.kind === 'data' && !DATA_TABS.some((t) => t.id === tab)) setTab('data');
  }, [project, tab]);

  useEffect(() => {
    if (!activeSurvey) { setDraft(null); setResponses([]); return; }
    const s = surveys.find((x) => x.id === activeSurvey);
    setDraft(s ? JSON.parse(JSON.stringify(s)) : null);
    setSaved(true);
    store.listResponses({ surveyId: activeSurvey }).then(setResponses);
  }, [activeSurvey, surveys]);

  const refreshResponses = useCallback(async () => {
    if (!activeSurvey) return;
    setResponses(await store.listResponses({ surveyId: activeSurvey }));
    onChanged?.();
  }, [activeSurvey, onChanged]);

  /*
    الإجابات تصل من أجهزة الباحثين في أي وقت، فنعيد جلبها عند كل فتح
    لتبويب النتائج أو التقرير — وإلا عرضت الشاشة صورة قديمة مضلّلة.
  */
  useEffect(() => {
    if (['results', 'report', 'import', 'data'].includes(tab)) refreshResponses();
  }, [tab, refreshResponses]);

  const addSurvey = async () => {
    const s = await store.createSurvey(projectId);
    await load();
    setActiveSurvey(s.id);
    setTab('build');
  };

  const saveSurvey = async () => {
    await store.updateSurvey(draft.id, {
      title: draft.title, description: draft.description, pages: draft.pages, report: draft.report || {},
    });
    setSaved(true);
    setNotice('حُفظ الاستبيان');
    setTimeout(() => setNotice(''), 2000);
    await load();
  };

  const removeSurvey = async (id) => {
    await store.deleteSurvey(id);
    await load();
  };

  const togglePublish = async () => {
    const next = !project.published;

    /*
      قبل النشر نفحص حالة المشروع كله ونشرح الخطوة التالية بدقة —
      القاعدة نفسها تفرضها قاعدة البيانات، هذا للإرشاد فقط.
    */
    if (next) {
      const all = await store.listResponses({ projectId });
      const approvedN = all.filter((r) => r.status === 'approved').length;
      const pendingN = all.filter((r) => r.status === 'pending').length;
      if (approvedN === 0 && project.kind === 'data') {
        setGuide({
          text: 'لا توجد بيانات بعد. ارفع ملف Excel أولاً، ثم انشر.',
          action: { label: 'رفع الملف', go: () => setTab('import') },
        });
        return;
      }
      if (approvedN === 0) {
        setGuide(pendingN > 0
          ? {
            text: `لديك ${pendingN} ${pendingN === 1 ? 'استمارة' : 'استمارات'} بانتظار المراجعة. اعتمد واحدة على الأقل ثم انشر — التقرير المنشور يعرض المعتمد فقط.`,
            action: { label: 'اذهب للمراجعة', go: () => setTab('results') },
          }
          : {
            text: 'لم تصل أي استمارة بعد، فلا يوجد ما يُعرض في التقرير. اجمع إجابات وأرسل رابط الاستبيان للباحثين، أو جرّب بنفسك من «معاينة التعبئة»، ثم اعتمدها من «النتائج».',
            action: { label: 'افتح المشاركة', go: () => setTab('share') },
          });
        return;
      }
    }

    try {
      await store.publishProject(projectId, next);
      await load();
      onChanged?.();
      setNotice(next ? 'نُشر المشروع على الصفحة الرئيسية' : 'أُلغي النشر');
      setTimeout(() => setNotice(''), 2600);
    } catch (err) {
      setNotice(err.message);
      setTimeout(() => setNotice(''), 3500);
    }
  };

  if (!project) return <p className="results__empty">جارٍ التحميل…</p>;

  const isData = project.kind === 'data';
  const linked = linkedFeed(surveys);
  const pending = isData ? 0 : responses.filter((r) => r.status === 'pending' || r.status === 'confirmed').length;

  return (
    <div className="pedit">
      <header className="pedit__head">
        <button type="button" className="pedit__back" onClick={onBack}>→ المشاريع</button>
        <div className="pedit__top">
          <div className="pedit__title">
            <h2>{project.name}</h2>
            <div className="pedit__meta">
              <span className="tag">{isData ? 'مشروع بيانات' : 'استبيان ميداني'}</span>
              {pending > 0 && <span className="tag tag--pending">{pending} بانتظار المراجعة</span>}
              {project.published && <span className="tag tag--approved">منشور</span>}
              {linked && <span className="tag tag--approved">مرتبط بتقرير «{linked.name}»</span>}
            </div>
          </div>
          {reviewer ? null : linked ? (
            <a className="pedit__publish is-live" href={linked.href} target="_blank" rel="noreferrer">
              فتح التقرير المرتبط ↗
            </a>
          ) : <button
            type="button"
            className={`pedit__publish${project.published ? ' is-live' : ''}`}
            onClick={togglePublish}
          >
            {project.published ? 'إلغاء النشر' : 'نشر على الصفحة الرئيسية'}
          </button>}
        </div>
      </header>

      {notice && <p className="pedit__notice">{notice}</p>}

      {guide && (
        <div className="pguide" role="status">
          <strong>لا يمكن النشر بعد</strong>
          <p>{guide.text}</p>
          <div className="pguide__actions">
            {guide.action && (
              <button type="button" className="survey__navbtn survey__navbtn--primary"
                onClick={() => { guide.action.go(); setGuide(null); }}>
                {guide.action.label}
              </button>
            )}
            <button type="button" className="q-btn" onClick={() => setGuide(null)}>حسناً</button>
          </div>
        </div>
      )}

      {!isData && <div className="pedit__surveys">
        {surveys.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`pedit__stab${s.id === activeSurvey ? ' is-on' : ''}`}
            onClick={() => setActiveSurvey(s.id)}
          >
            {s.title}
          </button>
        ))}
        {!reviewer && <button type="button" className="pedit__addsurvey" onClick={addSurvey}>
          + استبيان جديد
        </button>}
      </div>}

      {!activeSurvey ? (
        <p className="results__empty">أضف استبياناً للبدء.</p>
      ) : (
        <>
          <div className="pedit__tabs">
            <div className="pedit__seg" role="tablist">
            {(reviewer ? TABS.filter((t) => t.id === 'results') : isData ? DATA_TABS : TABS).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`pedit__tab${tab === t.id ? ' is-on' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'results' && responses.length > 0 && (
                  <span className="pedit__count">{responses.length}</span>
                )}
              </button>
            ))}
            </div>
            {(tab === 'results' || tab === 'report') && (
              <button type="button" className="q-btn q-btn--sm pedit__refresh" onClick={refreshResponses}>
                تحديث
              </button>
            )}
          </div>

          {tab === 'build' && draft && (
            <>
              <SurveyBuilder
                survey={draft}
                onChange={(next) => { setDraft(next); setSaved(false); }}
                actions={(
                  <>
                    <button type="button" className="bx-save" onClick={saveSurvey} disabled={saved}>
                      {saved ? 'محفوظ' : 'حفظ التغييرات'}
                    </button>
                    <button type="button" className="bx-mini bx-mini--del bx-delsurvey" title="حذف الاستبيان"
                      aria-label="حذف الاستبيان"
                      onClick={() => { if (window.confirm('حذف الاستبيان مع كل إجاباته نهائياً؟')) removeSurvey(activeSurvey); }}>
                      ✕
                    </button>
                  </>
                )}
              />
            </>
          )}

          {tab === 'data' && draft && (
            <DataView survey={surveys.find((x) => x.id === activeSurvey) || draft}
              rows={responses} basemap={basemap} onUpload={() => setTab('import')} />
          )}

          {tab === 'import' && draft && (
            <ImportWizard
              dataProject={isData}
              key={activeSurvey}
              survey={surveys.find((x) => x.id === activeSurvey) || draft}
              existing={responses}
              basemap={basemap}
              published={project.published}
              onApplied={async () => { await load(); await refreshResponses(); }}
            />
          )}

          {tab === 'share' && (
            <SharePanel
              survey={surveys.find((s) => s.id === activeSurvey)}
              onUpdate={async (cfg) => {
                await store.openSurveyLink(activeSurvey, cfg);
                await load();
                setNotice('حُدّثت إعدادات المشاركة');
                setTimeout(() => setNotice(''), 2000);
              }}
            />
          )}

          {tab === 'results' && draft && (
            <ResponsesTable
              responses={responses}
              survey={draft}
              areas={areas}
              onReview={async (id, status) => { await store.reviewResponse(id, status); refreshResponses(); }}
              onEdit={async (id, field, value) => { await store.editResponseAnswer(id, field, value); refreshResponses(); }}
              onDelete={async (id) => { await store.deleteResponse(id); refreshResponses(); }}
              onBulk={async (ids, status) => { await store.bulkReview(ids, status); refreshResponses(); }}
              entityReviewer={entityReviewer}
            />
          )}

          {tab === 'report' && draft && (
            <>
              <div className="rd-savebar">
                <span>{saved ? 'إعدادات التقرير محفوظة' : 'لديك تغييرات غير محفوظة في التقرير'}</span>
                <button type="button" className="bx-save" onClick={saveSurvey} disabled={saved}>
                  {saved ? 'محفوظ' : 'حفظ التغييرات'}
                </button>
              </div>
              <ReportDesigner
                project={project}
                survey={draft}
                responses={responses}
                basemap={basemap}
                onChange={(next) => { setDraft(next); setSaved(false); }}
              />
            </>
          )}

          {tab === 'preview' && draft && (
            <div className="pedit__preview">
              <p className="pedit__hint">
                هذه معاينة كما سيراها من يعبّي الاستبيان. الإرسال هنا يضيف إجابة فعلية للنتائج.
              </p>
              <SurveyPage
                key={JSON.stringify(draft.pages).length}
                definition={draft}
                onSubmit={async (answers, meta) => {
                  await store.createResponse(draft.id, answers, { source: 'preview', meta });
                  refreshResponses();
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* جامع البيانات: الاستبيانات المسندة إليه للتعبئة فقط */
function MySurveys() {
  const [list, setList] = useState(null);
  useEffect(() => { store.mySurveys().then(setList).catch(() => setList([])); }, []);
  if (!list) return <p className="results__empty">جارٍ التحميل…</p>;
  if (!list.length) return <div className="pending"><p>لا توجد استبيانات مسندة إلى حسابك بعد. تواصل مع مدير المنصة.</p></div>;
  return (
    <div className="plist">
      <div className="plist__head"><h2>الاستبيانات المسندة إليّ</h2></div>
      <div className="plist__grid">
        {list.map((s) => (
          <article key={s.id} className="pcard">
            <h3>{s.title}</h3>
            <p className="pcard__desc">{s.project}</p>
            <div className="pcard__actions"><a className="survey__navbtn survey__navbtn--primary" href={`#/s/${s.id}`}>تعبئة استمارة جديدة</a></div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------------- الجذر ---------------- */

export default function AdminApp({ basemap, me }) {
  const [section, setSection] = useState('projects');
  const [projects, setProjects] = useState([]);
  const [counts, setCounts] = useState({});
  const [open, setOpen] = useState(null);
  const [startTab, setStartTab] = useState('build');

  const refresh = useCallback(async () => {
    const list = await store.listProjects();
    setProjects(list);
    const map = {};
    const all = await store.listResponses();
    const surveys = await store.listSurveys();
    for (const p of list) {
      const ids = new Set(surveys.filter((s) => s.projectId === p.id).map((s) => s.id));
      const rows = all.filter((r) => ids.has(r.surveyId));
      map[p.id] = {
        surveys: ids.size,
        linked: linkedFeed(surveys.filter((s) => s.projectId === p.id)),
        pending: rows.filter((r) => r.status === 'pending' || r.status === 'confirmed').length,
        approved: rows.filter((r) => r.status === 'approved').length,
      };
    }
    setCounts(map);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const reviewer = me.role === 'reviewer';
  const collector = me.role === 'collector';
  const sections = collector ? [{ id: 'mine', label: 'استبياناتي' }, { id: 'me', label: 'حسابي' }] : [
    { id: 'projects', label: reviewer ? 'الاستبيانات المسندة إليّ' : 'المشاريع' },
    ...(reviewer ? [] : [{ id: 'entities', label: 'الجهات العاملة' }]),
    ...(me.role === 'super_admin' || me.role === 'admin' ? [{ id: 'screens', label: 'شاشات العرض' }] : []),
    ...(me.role === 'super_admin' ? [{ id: 'accounts', label: 'الحسابات' }] : []),
    { id: 'me', label: 'حسابي' },
  ];
  useEffect(() => { if (collector) setSection('mine'); }, [collector]);

  return (
    <section className="shell admin">
      <nav className="asec" aria-label="أقسام مساحة العمل">
        {sections.map((s) => (
          <button key={s.id} type="button"
            className={`asec__item${section === s.id ? ' is-on' : ''}`}
            onClick={() => { setSection(s.id); setOpen(null); }}>
            {s.label}
          </button>
        ))}
      </nav>

      {section === 'accounts' && me.role === 'super_admin' && <AccountsPanel me={me} />}
      {section === 'me' && <MyAccount me={me} />}
      {section === 'mine' && <MySurveys />}
      {section === 'entities' && <EntitiesPanel />}
      {section === 'screens' && (me.role === 'super_admin' || me.role === 'admin') && <ScreenPanel />}
      {section === 'projects' && (open ? (
        <ProjectEditor
          projectId={open}
          basemap={basemap}
          initialTab={startTab}
          reviewer={reviewer}
          entityReviewer={reviewer && Boolean(me.entity)}
          onBack={() => { setOpen(null); setStartTab('build'); refresh(); }}
          onChanged={refresh}
        />
      ) : (
        <ProjectList
          projects={projects}
          counts={counts}
          onOpen={setOpen}
          onCreate={reviewer ? null : async (input) => {
            const p = await store.createProject(input);
            if (input.kind === 'data') {
              await store.createSurvey(p.id, { title: input.name, pages: [{ name: 'p1', title: 'البيانات', children: [] }] });
              setStartTab('import');
              setOpen(p.id);
            }
            refresh();
          }}
          onDelete={reviewer ? null : async (id) => {
            if (!window.confirm('حذف المشروع مع كل استبياناته وإجاباته نهائياً؟')) return;
            await store.deleteProject(id); refresh();
          }}
        />
      ))}
    </section>
  );
}
