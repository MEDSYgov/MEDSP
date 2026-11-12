-- ===== دورة الاعتماد بطبقتين (المرحلة الثانية من ملاحظات الميدان) =====
-- المستبين يرسل ← الأخصائي (دور collector المُسند إليه الاستبيان):
--     «اعتماد أولي» ← confirmed، أو «إعادة للتعديل» ← returned (مع السبب)، ويعدّل الإجابة بنفسه
-- المعتمد النهائي (دور reviewer المُسند إليه الاستبيان):
--     «اعتماد نهائي» ← approved فتدخل المنصة، أو «رفض» ← تعود للأخصائي pending (مع السبب)
--     «تراجع عن الاعتماد» ← confirmed (تخرج من المنصة فوراً)
-- المدير العام ومدير المنصة: كل ما سبق + حذف ناعم واسترجاع.
-- كل انتقال يمر عبر الدالة review_action ويُسجَّل في history باسم من قام به وسببه.

alter table public.responses drop constraint if exists responses_status_check;
alter table public.responses add constraint responses_status_check
  check (status in ('pending', 'returned', 'confirmed', 'approved', 'rejected'));
alter table public.responses add column if not exists deleted_at timestamptz;
alter table public.responses add column if not exists deleted_by text;

/* «مرفوض» القديم = أُعيد للتعديل */
update public.responses set status = 'returned' where status = 'rejected';

/* المراجعة: الأخصائي (collector) والمعتمد النهائي (reviewer) يريان الاستبيانات المسندة إليهما */
create or replace function public.can_review(p_survey uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid())
    and (role in ('super_admin','admin')
      or (role in ('reviewer','collector') and p_survey = any(coalesce(surveys, '{}')))));
$$;

/* دور الحساب في مراجعة هذا الاستبيان: admin | final | specialist | null */
create or replace function public.review_stage(p_survey uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when a.role in ('super_admin','admin') then 'admin'
    when a.role = 'reviewer' and p_survey = any(coalesce(a.surveys, '{}')) then 'final'
    when a.role = 'collector' and p_survey = any(coalesce(a.surveys, '{}')) then 'specialist'
  end
  from public.admins a where a.user_id = (select auth.uid());
$$;
revoke all on function public.review_stage(uuid) from public, anon;
grant execute on function public.review_stage(uuid) to authenticated;

/* القراءة: المحذوف للمدراء فقط */
drop policy if exists responses_reviewer_read on public.responses;
create policy responses_reviewer_read on public.responses for select to authenticated
  using ((select public.can_review_response(survey_id, answers)) and (deleted_at is null or (select public.is_admin())));
/* لا تعديل مباشر لغير المدراء: كل شيء عبر الدوال أدناه */
drop policy if exists responses_reviewer_update on public.responses;

create or replace function public.guard_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_admin() or current_setting('medsp.review_rpc', true) = '1' then return new; end if;
  raise exception 'التعديل يتم من شاشة المراجعة فقط' using errcode = '42501';
end; $$;

create or replace function public.review_action(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.responses; stage text; who text; nxt text; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.responses where id = p_id for update;
  if not found then raise exception 'الاستمارة غير موجودة'; end if;
  stage := public.review_stage(r.survey_id);
  if stage is null then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  if stage = 'specialist' and r.answers ? 'rt_contractor' and exists (
       select 1 from public.admins a where a.user_id = (select auth.uid()) and a.entity is not null
         and r.answers->>'rt_contractor' <> a.entity::text) then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  select coalesce(nullif(display_name, ''), username) into who from public.admins where user_id = (select auth.uid());

  if r.deleted_at is not null and p_action <> 'restore' then raise exception 'الاستمارة محذوفة'; end if;

  if p_action = 'confirm' then          /* اعتماد أولي */
    if stage not in ('specialist','admin') or r.status not in ('pending','returned') then raise exception 'لا يمكن الاعتماد الأولي لهذه الاستمارة الآن'; end if;
    nxt := 'confirmed';
  elsif p_action = 'return' then        /* إعادة للتعديل */
    if stage not in ('specialist','admin') or r.status not in ('pending','confirmed') then raise exception 'لا يمكن إعادة هذه الاستمارة الآن'; end if;
    if note is null then raise exception 'اكتب سبب الإعادة'; end if;
    nxt := 'returned';
  elsif p_action = 'approve' then       /* اعتماد نهائي */
    if stage not in ('final','admin') or r.status <> 'confirmed' then raise exception 'الاعتماد النهائي للاستمارات المعتمدة أولياً فقط'; end if;
    nxt := 'approved';
  elsif p_action = 'reject' then        /* رفض نهائي ← تعود للأخصائي */
    if stage not in ('final','admin') or r.status <> 'confirmed' then raise exception 'لا يمكن رفض هذه الاستمارة الآن'; end if;
    if note is null then raise exception 'اكتب سبب الرفض'; end if;
    nxt := 'pending';
  elsif p_action = 'unapprove' then     /* تراجع عن الاعتماد */
    if stage not in ('final','admin') or r.status <> 'approved' then raise exception 'الاستمارة غير معتمدة'; end if;
    if note is null then raise exception 'اكتب سبب التراجع'; end if;
    nxt := 'confirmed';
  elsif p_action = 'delete' then
    if stage <> 'admin' then raise exception 'الحذف للمدير فقط' using errcode = '42501'; end if;
    if note is null then raise exception 'اكتب سبب الحذف'; end if;
    perform set_config('medsp.review_rpc', '1', true);
    update public.responses set deleted_at = now(), deleted_by = who,
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'deleted', 'by', who, 'note', note))
    where id = p_id;
    return jsonb_build_object('id', p_id, 'deleted', true);
  elsif p_action = 'restore' then
    if stage <> 'admin' then raise exception 'الاسترجاع للمدير فقط' using errcode = '42501'; end if;
    perform set_config('medsp.review_rpc', '1', true);
    update public.responses set deleted_at = null, deleted_by = null,
      history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'restored', 'by', who))
    where id = p_id;
    return jsonb_build_object('id', p_id, 'deleted', false);
  else
    raise exception 'إجراء غير معروف';
  end if;

  perform set_config('medsp.review_rpc', '1', true);
  update public.responses set status = nxt, reviewed_by = who, reviewed_at = now(), review_note = note,
    history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'action', p_action, 'status', nxt, 'by', who, 'note', note))
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', nxt);
end; $$;
revoke all on function public.review_action(uuid, text, text) from public, anon;
grant execute on function public.review_action(uuid, text, text) to authenticated;

/* تعديل إجابة: الأخصائي على المنتظرة أو المعادة، والمدير على أي استمارة غير محذوفة */
create or replace function public.edit_response(p_id uuid, p_field text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.responses; stage text; who text;
begin
  select * into r from public.responses where id = p_id for update;
  if not found or r.deleted_at is not null then raise exception 'الاستمارة غير موجودة'; end if;
  stage := public.review_stage(r.survey_id);
  if not (stage = 'admin' or (stage = 'specialist' and r.status in ('pending','returned'))) then
    raise exception 'لا يمكنك تعديل هذه الاستمارة الآن' using errcode = '42501';
  end if;
  select coalesce(nullif(display_name, ''), username) into who from public.admins where user_id = (select auth.uid());
  perform set_config('medsp.review_rpc', '1', true);
  update public.responses set answers = jsonb_set(coalesce(answers, '{}'::jsonb), array[p_field], coalesce(p_value, 'null'::jsonb), true),
    edited = true,
    history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'edited', 'by', who,
      'field', p_field, 'before', r.answers->p_field, 'after', p_value))
  where id = p_id;
end; $$;
revoke all on function public.edit_response(uuid, text, jsonb) from public, anon;
grant execute on function public.edit_response(uuid, text, jsonb) to authenticated;

/* حالة ما أرسله جهاز المستبين (بالمعرّفات الفريدة التي يحفظها الجهاز وحده) */
create or replace function public.response_statuses(p_client_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('clientId', client_id,
    'status', case when deleted_at is not null then 'deleted' else status end,
    'note', case when status in ('returned') then review_note end)), '[]'::jsonb)
  from public.responses where client_id = any(coalesce(p_client_ids, '{}')) and cardinality(p_client_ids) <= 500;
$$;
grant execute on function public.response_statuses(uuid[]) to anon, authenticated;

/* المحذوف لا يصل إلى المنصة */
create or replace function public.rubble_transfer_feed()
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'submittedAt', r.submitted_at,
    'answers', public.strip_media(r.answers),
    'entityName', coalesce(e.name, nullif(r.answers->>'rt_contractor_other', ''), r.answers->>'rt_contractor'),
    'photos', (r.answers ? 'rt_photo_before') or (r.answers ? 'rt_photo_during') or (r.answers ? 'rt_photo_after')
  ) order by r.submitted_at), '[]'::jsonb)
  from public.responses r join public.surveys s on s.id = r.survey_id
  left join public.rubble_entities e on e.id::text = r.answers->>'rt_contractor'
  where (s.report->>'feed' = 'rubble-transfer' or s.pages::text like '%"rt_volume"%')
    and r.status = 'approved' and r.deleted_at is null
    and public.can_view_platform()
    and public.gov_allowed(r.answers->'rt_gov'->>'governorate');
$$;

create or replace function public.rubble_photos(rid uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_array(r.answers->'rt_photo_before', r.answers->'rt_photo_during', r.answers->'rt_photo_after')
  from public.responses r join public.surveys s on s.id = r.survey_id
  where r.id = rid and r.status = 'approved' and r.deleted_at is null
    and public.can_view_platform()
    and (s.report->>'feed' = 'rubble-transfer' or s.pages::text like '%"rt_volume"%');
$$;

create or replace function public.list_published()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description,
    'surveys', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'pages', s.pages, 'report', s.report) order by s.created_at)
      from public.surveys s where s.project_id = p.id), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'surveyId', r.survey_id, 'answers', r.answers,
        'submittedAt', r.submitted_at))
      from public.responses r join public.surveys s2 on s2.id = r.survey_id
      where s2.project_id = p.id and r.status = 'approved' and r.deleted_at is null), '[]'::jsonb)
  ) order by p.created_at desc), '[]'::jsonb)
  from public.projects p where p.published and public.can_view_platform();
$$;
