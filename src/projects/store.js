/*
  طبقة الوصول للبيانات — Supabase.

  الواجهة (أسماء الدوال وأشكال الكائنات) مطابقة للنسخة المحلية السابقة،
  فبقية النظام لم يتغير. الحقول تُحوَّل هنا من snake_case في القاعدة
  إلى camelCase في الواجهة.

  عند الانتقال إلى الخادم الداخلي: إن كان PostgreSQL مع PostgREST
  يبقى هذا الملف كما هو ويتغير عنوان الاتصال فقط.
*/

import { supabase } from './supabase';

/* ---------- أدوات ---------- */

function fail(error, fallback = 'حدث خطأ في الاتصال بقاعدة البيانات') {
  if (!error) return;
  /* رسائل الخادم العربية (من raise exception) تُمرَّر كما هي */
  const msg = error.message && /[\u0600-\u06FF]/.test(error.message) ? error.message : fallback;
  const err = new Error(msg);
  err.cause = error;
  throw err;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isValidId = (id) => UUID.test(String(id || ''));

const mapProject = (r) => r && ({
  id: r.id,
  name: r.name,
  description: r.description,
  owner: r.owner,
  status: r.status,
  kind: r.kind || 'survey',
  published: r.published,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapSurvey = (r) => r && ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  description: r.description,
  pages: r.pages?.length ? r.pages : [{ name: 'main', title: 'القسم الأول', children: [] }],
  report: r.report || {},
  open: r.is_open,
  hasPassword: Boolean(r.has_password),
  closesAt: r.closes_at || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapResponse = (r) => r && ({
  id: r.id,
  surveyId: r.survey_id,
  answers: r.answers,
  status: r.status,
  source: r.source,
  submittedAt: r.submitted_at,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  reviewNote: r.review_note,
  edited: r.edited,
  history: r.history || [],
  meta: r.meta || {},
});

/* بصمة كلمة المرور لا تُقرأ أبداً للواجهة — فقط هل هي موجودة */
const SURVEY_COLS = 'id, project_id, title, description, pages, report, is_open, closes_at, created_at, updated_at, has_password';

const withFlag = (row) => row;

/* ---------- الجلسة والصلاحية ---------- */

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/*
  الدخول باسم مستخدم. البريد داخلي بنطاق .invalid المحجوز
  (لا يستقبل رسائل أبداً) — لا تحقق عبر البريد ولا تسجيل ذاتي.
*/
const DOMAIN = '@medsp.invalid';
const toEmail = (username) => `${String(username).trim().toLowerCase()}${DOMAIN}`;

export async function signIn(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: toEmail(username), password,
  });
  if (error) {
    throw new Error(
      error.message?.includes('Invalid login')
        ? 'اسم المستخدم أو كلمة المرور غير صحيحة'
        : 'تعذّر تسجيل الدخول — تحقق من الاتصال',
    );
  }
  return data.session;
}

export async function changeOwnPassword(password) {
  if (!password || password.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    throw new Error(error.message?.includes('different')
      ? 'كلمة المرور الجديدة يجب أن تختلف عن الحالية'
      : 'تعذّر تغيير كلمة المرور');
  }
}

export async function signOut() {
  await supabase.auth.signOut();
}

/* الدور: { role: 'super_admin' | 'admin', username, displayName } أو null */
export async function getMyRole() {
  const { data, error } = await supabase.rpc('my_role');
  if (error) return null;
  return data || null;
}

/* ---------- الحسابات (للسوبر أدمن) ---------- */

export async function listAccounts() {
  const { data, error } = await supabase.rpc('list_accounts_v3');
  fail(error);
  return (data || []).map((r) => ({
    id: r.user_id, username: r.username, displayName: r.display_name, role: r.role,
    sections: r.sections || [], govs: r.govs || [], surveys: r.surveys || [], entity: r.entity || '', entityName: r.entity_name || '',
    createdAt: r.created_at, lastSignIn: r.last_sign_in_at,
  }));
}

export async function createAccount({ username, password, displayName, role = 'viewer', sections = [], govs = [], surveys = [], entity = '' }) {
  const { data, error } = await supabase.rpc('create_account', {
    p_username: username, p_password: password, p_display: displayName,
    p_role: role, p_sections: sections.length ? sections : null, p_govs: govs.length ? govs : null, p_surveys: surveys.length ? surveys : null,
    p_entity: entity || null,
  });
  fail(error);
  return data;
}

export async function updateAccountAccess(id, { role, sections = [], govs = [], surveys = [], entity = '' }) {
  const { error } = await supabase.rpc('update_account_access', {
    p_user: id, p_role: role, p_sections: sections.length ? sections : null, p_govs: govs.length ? govs : null, p_surveys: surveys.length ? surveys : null,
    p_entity: entity || null,
  });
  fail(error);
}

export async function listSurveyTitles() {
  const { data, error } = await supabase.rpc('list_survey_titles');
  fail(error);
  return data || [];
}

export async function mySurveys() {
  const { data, error } = await supabase.rpc('my_surveys');
  fail(error);
  return data || [];
}

export async function resetAccountPassword(id, password) {
  const { error } = await supabase.rpc('reset_account_password', { p_user: id, p_password: password });
  fail(error, 'تعذّر تغيير كلمة المرور');
}

export async function deleteAccount(id) {
  const { error } = await supabase.rpc('delete_account', { p_user: id });
  fail(error, 'تعذّر حذف الحساب');
}

export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/* ---------- المشاريع ---------- */

export const PROJECT_STATUS = {
  draft: 'مسودة',
  collecting: 'قيد جمع البيانات',
  published: 'منشور',
  closed: 'مغلق',
};

export async function listProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
  fail(error);
  return data.map(mapProject);
}

export async function getProject(id) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  fail(error);
  return mapProject(data);
}

export async function createProject(input) {
  const { data, error } = await supabase.from('projects').insert({
    name: input.name?.trim() || 'مشروع بلا اسم',
    description: input.description?.trim() || '',
    owner: input.owner?.trim() || '',
    kind: input.kind === 'data' ? 'data' : 'survey',
  }).select().single();
  fail(error);
  return mapProject(data);
}

export async function updateProject(id, patch) {
  const row = {};
  if ('name' in patch) row.name = patch.name;
  if ('description' in patch) row.description = patch.description;
  if ('owner' in patch) row.owner = patch.owner;
  if ('status' in patch) row.status = patch.status;
  if ('published' in patch) row.published = patch.published;
  const { data, error } = await supabase.from('projects').update(row).eq('id', id).select().single();
  fail(error);
  return mapProject(data);
}

export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  fail(error);
  return true;
}

export async function publishProject(id, publish) {
  return updateProject(id, { published: Boolean(publish), status: publish ? 'published' : 'collecting' });
}

/* ---------- الاستبيانات ---------- */

export async function listSurveys(projectId) {
  let q = supabase.from('surveys').select(SURVEY_COLS).order('created_at');
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  fail(error);
  return data.map((r) => mapSurvey(withFlag(r)));
}

export async function getSurvey(id) {
  const { data, error } = await supabase.from('surveys').select(SURVEY_COLS).eq('id', id).maybeSingle();
  fail(error);
  return mapSurvey(withFlag(data));
}

export async function createSurvey(projectId, input = {}) {
  const { data, error } = await supabase.from('surveys').insert({
    project_id: projectId,
    title: input.title?.trim() || 'استبيان جديد',
    description: input.description?.trim() || '',
    pages: input.pages || [{ name: 'main', title: 'القسم الأول', children: [] }],
  }).select(SURVEY_COLS).single();
  fail(error);
  return mapSurvey(withFlag(data));
}

export async function updateSurvey(id, patch) {
  const row = {};
  if ('title' in patch) row.title = patch.title;
  if ('description' in patch) row.description = patch.description;
  if ('pages' in patch) row.pages = patch.pages;
  if ('report' in patch) row.report = patch.report || {};
  if ('open' in patch) row.is_open = patch.open;
  if ('closesAt' in patch) row.closes_at = patch.closesAt || null;
  const { data, error } = await supabase.from('surveys').update(row).eq('id', id).select(SURVEY_COLS).single();
  fail(error);
  return mapSurvey(withFlag(data));
}

export async function deleteSurvey(id) {
  const { error } = await supabase.from('surveys').delete().eq('id', id);
  fail(error);
  return true;
}

/*
  إعدادات الرابط العام. كلمة المرور تُرسل للخادم الذي يخزّن بصمتها
  (bcrypt) — لا تُحفظ نصاً ولا تُقرأ مرة أخرى.
  password: undefined = لا تغيير، '' = إزالة، نص = تعيين
*/
export async function openSurveyLink(id, { open, closesAt, password }) {
  await updateSurvey(id, { open, closesAt });
  if (password !== undefined) {
    const { error } = await supabase.rpc('set_survey_password', { p_survey: id, p_password: password });
    fail(error);
  }
  return getSurvey(id);
}

/* ---------- الوصول العام ---------- */

/*
  نسخة محلية من الاستبيان للعمل بلا إنترنت: بعد أول فتح ناجح يُحفظ
  التعريف على الجهاز، فيُفتح لاحقاً بلا شبكة.
  للمحمي تُحفظ كلمة المرور أيضاً لأنها مطلوبة عند الإرسال — على جهاز
  الباحث وحده، وهو من أدخلها.
*/
const CACHE = (id) => `medsp-survey:${id}`;

export function cacheSurvey(id, payload) {
  try { localStorage.setItem(CACHE(id), JSON.stringify({ ...payload, cachedAt: new Date().toISOString() })); } catch { /* ممتلئ */ }
}

export function cachedSurvey(id) {
  try { return JSON.parse(localStorage.getItem(CACHE(id)) || 'null'); } catch { return null; }
}

const looksOffline = (error) => (typeof navigator !== 'undefined' && navigator.onLine === false)
  || /fetch|network|Load failed/i.test(error?.message || '');

export async function getPublicSurvey(id) {
  if (!isValidId(id)) return { status: 'missing' };
  let data; let error;
  try {
    ({ data, error } = await supabase.rpc('get_public_survey', { p_survey: id }));
  } catch (e) { error = e; }
  if (error) {
    if (looksOffline(error)) {
      const cached = cachedSurvey(id);
      return cached ? { ...cached.state, fromCache: true, cached } : { status: 'offline' };
    }
    return { status: 'missing' };
  }
  if (data?.status === 'ok' && !data.needsPassword) cacheSurvey(id, { state: data, definition: data.survey });
  if (data?.status !== 'ok') { try { localStorage.removeItem(CACHE(id)); } catch { /* */ } }
  return data;
}

/* يُرجع تعريف الاستبيان إن صحّت كلمة المرور، وإلا null */
export async function unlockSurvey(id, password) {
  const { data, error } = await supabase.rpc('unlock_survey', { p_survey: id, p_password: password });
  if (error) return null;
  return data;
}

/* ---------- الإجابات ---------- */

export const RESPONSE_STATUS = {
  pending: 'بانتظار المراجعة',
  confirmed: 'مؤكد من الجهة',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

export async function listResponses({ surveyId, projectId, status } = {}) {
  let q = supabase.from('responses').select('*, surveys!inner(project_id)')
    .order('submitted_at', { ascending: false });
  if (surveyId) q = q.eq('survey_id', surveyId);
  if (projectId) q = q.eq('surveys.project_id', projectId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  fail(error);
  return data.map(mapResponse);
}

export async function createResponse(surveyId, answers, opts = {}) {
  const { data, error } = await supabase.rpc('submit_response', {
    p_survey: surveyId,
    p_answers: answers,
    p_password: opts.password ?? null,
    p_source: opts.source || 'link',
    p_meta: opts.meta || {},
    p_client_id: opts.clientId ?? null,
  });
  if (error && looksOffline(error)) {
    const err = new Error('لا يوجد اتصال بالإنترنت');
    err.cause = error;
    throw err;
  }
  fail(error, 'تعذّر إرسال الإجابة');
  return { id: data };
}

async function currentUserLabel() {
  const { data } = await supabase.auth.getUser();
  return data.user?.email?.replace(DOMAIN, '') || 'مشرف';
}

export async function reviewResponse(id, status, { note = '' } = {}) {
  const by = await currentUserLabel();
  const { data: cur, error: e1 } = await supabase.from('responses').select('history').eq('id', id).single();
  fail(e1);
  const history = [...(cur.history || []), { at: new Date().toISOString(), action: status, by, note }];
  const { data, error } = await supabase.from('responses').update({
    status, reviewed_by: by, reviewed_at: new Date().toISOString(), review_note: note, history,
  }).eq('id', id).select().single();
  fail(error);
  return mapResponse(data);
}

export async function editResponseAnswer(id, field, value) {
  const by = await currentUserLabel();
  const { data: cur, error: e1 } = await supabase.from('responses').select('answers, history').eq('id', id).single();
  fail(e1);
  const before = cur.answers?.[field];
  const { data, error } = await supabase.from('responses').update({
    answers: { ...cur.answers, [field]: value },
    edited: true,
    history: [...(cur.history || []), {
      at: new Date().toISOString(), action: 'edited', by, field, before, after: value,
    }],
  }).eq('id', id).select().single();
  fail(error);
  return mapResponse(data);
}

export async function deleteResponse(id) {
  const { error } = await supabase.from('responses').delete().eq('id', id);
  fail(error);
  return true;
}

export async function bulkReview(ids, status) {
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await reviewResponse(id, status);
  }
  return true;
}

/* ---------- الاستيراد من ملف ---------- */

/* تطبيق دفعة واحدة على الخادم: إما كله أو لا شيء */
export async function applyImport(surveyId, { file, updates, inserts, deletes, status, summary }) {
  const { data, error } = await supabase.rpc('apply_import', {
    p_survey: surveyId,
    p_file: file,
    p_updates: updates.map((u) => ({ id: u.id, answers: u.answers, changes: u.changes.map(({ field, before, after }) => ({ field, before, after })) })),
    p_inserts: inserts.map((i) => i.answers),
    p_deletes: deletes,
    p_status: status,
    p_summary: summary,
  });
  fail(error, 'تعذّر تطبيق الاستيراد');
  return data;
}

export async function listImports(surveyId) {
  const { data, error } = await supabase.from('imports').select('*')
    .eq('survey_id', surveyId).order('imported_at', { ascending: false });
  fail(error);
  return data;
}

/* ---------- العرض العام ---------- */

export async function listPublishedProjects() {
  const { data, error } = await supabase.rpc('list_published');
  fail(error);
  return data || [];
}

/* إجابات استبيان ترحيل الأنقاض المعتمدة — تُدمج في تقرير «مشروع ترحيل الأنقاض» */
export async function rubbleTransferFeed() {
  const { data, error } = await supabase.rpc('rubble_transfer_feed');
  fail(error);
  return data || [];
}

/* صور إجابة واحدة من الاستمارة الرسمية [قبل، أثناء، بعد] — تُجلب عند الطلب لأنها ثقيلة */
export async function rubblePhotos(rid) {
  const { data, error } = await supabase.rpc('rubble_photos', { rid });
  fail(error);
  return data || [];
}

/* ---------- سجل الجهات العاملة في قطاع الأنقاض (جدول rubble_entities) ---------- */

const mapEntity = (r) => ({
  id: r.id, name: r.name, aliases: r.aliases || [], type: r.type || '', roles: r.roles || [],
  govs: r.governorates || [], contact: r.contact || '', notes: r.notes || '', updatedAt: r.updated_at,
});

export async function listEntities() {
  const { data, error } = await supabase.from('rubble_entities').select('*').order('name');
  fail(error);
  return (data || []).map(mapEntity);
}

export async function saveEntity(e) {
  const row = {
    name: e.name.trim(), aliases: e.aliases, type: e.type, roles: e.roles,
    governorates: e.govs, contact: e.contact.trim(), notes: e.notes.trim(), updated_at: new Date().toISOString(),
  };
  const q = e.id
    ? supabase.from('rubble_entities').update(row).eq('id', e.id)
    : supabase.from('rubble_entities').insert(row);
  const { data, error } = await q.select().single();
  fail(error);
  return mapEntity(data);
}

export async function deleteEntity(id) {
  const { error } = await supabase.from('rubble_entities').delete().eq('id', id);
  fail(error);
}
