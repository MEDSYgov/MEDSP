-- ===== مستويات الوصول =====
-- super_admin المدير العام · admin مدير المنصة · viewer مشاهد (كامل أو محدود بأقسام)
-- reviewer مراجع استبيانات محددة · collector جامع بيانات
-- sections: أقسام المشاهدة (null = الكل) — ops, monthly, rubble, projects
-- govs: رموز المحافظات المسموحة (null = الكل) · surveys: الاستبيانات المسندة (للمراجع وجامع البيانات)

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check
  check (role in ('super_admin','admin','viewer','reviewer','collector'));
alter table public.admins add column if not exists sections text[];
alter table public.admins add column if not exists govs text[];
alter table public.admins add column if not exists surveys uuid[];

-- «مدير» = المدير العام ومدير المنصة فقط؛ بقية الأدوار لا تمر عبر سياسات الإدارة
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()) and role in ('super_admin','admin'));
$$;

create or replace function public.my_role()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('role', role, 'username', username, 'displayName', display_name,
    'sections', sections, 'govs', govs, 'surveys', surveys)
  from public.admins where user_id = (select auth.uid());
$$;

-- يرى/يراجع هذا الاستبيان؟ (المراجع: الاستبيانات المسندة إليه)
create or replace function public.can_review(p_survey uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid())
    and (role in ('super_admin','admin') or (role = 'reviewer' and p_survey = any(surveys))));
$$;

-- المحافظة ضمن نطاق الحساب؟ (null = كل المحافظات)
create or replace function public.gov_allowed(p_gov text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select govs is null or cardinality(govs) = 0 or p_gov = any(govs)
    from public.admins where user_id = (select auth.uid())), false);
$$;

drop policy if exists surveys_reviewer_read on public.surveys;
create policy surveys_reviewer_read on public.surveys for select to authenticated
  using ((select public.can_review(id)));
drop policy if exists projects_reviewer_read on public.projects;
create policy projects_reviewer_read on public.projects for select to authenticated
  using (exists (select 1 from public.surveys s where s.project_id = projects.id and (select public.can_review(s.id))));
drop policy if exists responses_reviewer_read on public.responses;
create policy responses_reviewer_read on public.responses for select to authenticated
  using ((select public.can_review(survey_id)));
drop policy if exists responses_reviewer_update on public.responses;
create policy responses_reviewer_update on public.responses for update to authenticated
  using ((select public.can_review(survey_id))) with check ((select public.can_review(survey_id)));

-- القراءة العامة أُغلقت: المنصة خلف تسجيل الدخول
alter policy rubble_entities_read on public.rubble_entities to authenticated using (true);

-- تغذيات الأنقاض: للحسابات المسجلة فقط، ومقيدة بمحافظات الحساب
create or replace function public.rubble_transfer_feed()
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'submittedAt', r.submitted_at,
    'answers', r.answers - 'rt_photo_before' - 'rt_photo_during' - 'rt_photo_after',
    'photos', (r.answers ? 'rt_photo_before') or (r.answers ? 'rt_photo_during') or (r.answers ? 'rt_photo_after')
  ) order by r.submitted_at), '[]'::jsonb)
  from public.responses r join public.surveys s on s.id = r.survey_id
  where (s.report->>'feed' = 'rubble-transfer' or s.pages::text like '%"rt_volume"%')
    and r.status = 'approved'
    and (select auth.uid()) is not null
    and public.gov_allowed(r.answers->'rt_gov'->>'governorate');
$$;
revoke execute on function public.rubble_transfer_feed() from anon, public;
grant execute on function public.rubble_transfer_feed() to authenticated;
revoke execute on function public.rubble_photos(uuid) from anon, public;
grant execute on function public.rubble_photos(uuid) to authenticated;
revoke execute on function public.list_published() from anon, public;
grant execute on function public.list_published() to authenticated;

-- الحسابات: إنشاء بدور ونطاق، وتعديل النطاق لاحقاً
create or replace function public.create_account(p_username text, p_password text, p_display text,
  p_role text, p_sections text[], p_govs text[], p_surveys uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_super_admin() then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  if p_role not in ('admin','viewer','reviewer','collector') then raise exception 'دور غير صالح'; end if;
  new_id := public.create_account(p_username, p_password, p_display);
  update public.admins set role = p_role, sections = p_sections, govs = p_govs, surveys = p_surveys where user_id = new_id;
  return new_id;
end; $$;

create or replace function public.update_account_access(p_user uuid, p_role text, p_sections text[], p_govs text[], p_surveys uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  if p_role not in ('admin','viewer','reviewer','collector') then raise exception 'دور غير صالح'; end if;
  if exists (select 1 from public.admins where user_id = p_user and role = 'super_admin') then
    raise exception 'لا يمكن تعديل صلاحيات المدير العام';
  end if;
  update public.admins set role = p_role, sections = p_sections, govs = p_govs, surveys = p_surveys where user_id = p_user;
end; $$;

create or replace function public.list_accounts_v2()
returns table (user_id uuid, username text, display_name text, role text, sections text[], govs text[], surveys uuid[],
               created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  return query
    select a.user_id, a.username, a.display_name, a.role, a.sections, a.govs, a.surveys, a.created_at, u.last_sign_in_at
    from public.admins a join auth.users u on u.id = a.user_id
    order by (a.role = 'super_admin') desc, a.created_at;
end; $$;

-- قائمة الاستبيانات لاختيارها عند إسناد مراجع أو جامع بيانات
create or replace function public.list_survey_titles()
returns table (id uuid, title text, project text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  return query select s.id, s.title, p.name from public.surveys s join public.projects p on p.id = s.project_id order by p.name, s.title;
end; $$;

-- الاستبيانات المسندة لجامع البيانات (للتعبئة)
create or replace function public.my_surveys()
returns table (id uuid, title text, project text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, p.name from public.surveys s join public.projects p on p.id = s.project_id
  where s.id = any(coalesce((select surveys from public.admins where user_id = (select auth.uid())), '{}'));
$$;

revoke all on function public.can_review(uuid), public.gov_allowed(text),
  public.create_account(text,text,text,text,text[],text[],uuid[]), public.update_account_access(uuid,text,text[],text[],uuid[]),
  public.list_accounts_v2(), public.list_survey_titles(), public.my_surveys() from public, anon;
grant execute on function public.can_review(uuid), public.gov_allowed(text),
  public.create_account(text,text,text,text,text[],text[],uuid[]), public.update_account_access(uuid,text,text[],text[],uuid[]),
  public.list_accounts_v2(), public.list_survey_titles(), public.my_surveys() to authenticated;
