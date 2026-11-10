-- ===== إغلاق المنصة أمام جامعي البيانات والمراجعين =====
-- جامع البيانات (collector) والمراجع (reviewer) يعملان في مساحة العمل فقط:
-- تعبئة الاستبيانات المسندة ومراجعتها. لا يحق لهما مشاهدة أرقام المنصة.
-- كانت هذه الدوال تكتفي بأن يكون الحساب مسجّلاً، فتعطيهما البيانات.

/* من يحق له مشاهدة المنصة: المدير العام، مدير المنصة، المشاهد */
create or replace function public.can_view_platform()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins
    where user_id = (select auth.uid()) and role in ('super_admin', 'admin', 'viewer'));
$$;
revoke all on function public.can_view_platform() from public, anon;
grant execute on function public.can_view_platform() to authenticated;

/* المشاريع المنشورة وإجاباتها المعتمدة (تبويب المشاريع وإدارة الأنقاض) */
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
      where s2.project_id = p.id and r.status = 'approved'), '[]'::jsonb)
  ) order by p.created_at desc), '[]'::jsonb)
  from public.projects p where p.published and public.can_view_platform();
$$;

/* تغذية التنفيذ في إدارة الأنقاض */
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
    and r.status = 'approved'
    and public.can_view_platform()
    and public.gov_allowed(r.answers->'rt_gov'->>'governorate');
$$;

/* صور الأرشيف المصور */
create or replace function public.rubble_photos(rid uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_array(r.answers->'rt_photo_before', r.answers->'rt_photo_during', r.answers->'rt_photo_after')
  from public.responses r join public.surveys s on s.id = r.survey_id
  where r.id = rid and r.status = 'approved'
    and public.can_view_platform()
    and (s.report->>'feed' = 'rubble-transfer' or s.pages::text like '%"rt_volume"%');
$$;

/* مكتبة التقارير: غير العامة منها للمشاهدين والمدراء فقط */
create or replace function public.report_readable(p_visibility text, p_published boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or (p_published and (p_visibility = 'public' or public.can_view_platform()));
$$;

revoke execute on function public.list_published(), public.rubble_transfer_feed(), public.rubble_photos(uuid) from public, anon;
grant execute on function public.list_published(), public.rubble_transfer_feed(), public.rubble_photos(uuid) to authenticated;
