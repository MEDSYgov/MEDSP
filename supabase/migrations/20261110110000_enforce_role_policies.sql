-- ===== فرض صلاحيات الأدوار على الجداول الأساسية =====
-- ظهر لحساب مراجع (reviewer) مُسند إليه استبيان واحد كلُّ مشاريع مساحة العمل، ومنها مشروع
-- بيانات بلا استبيانات ومشروع غير منشور. سياسات المستودع لا تسمح بذلك، فالقاعدة المنقولة
-- تحمل على الأرجح نسخة قديمة من is_admin (كانت تعدّ أي حساب في admins مديراً) أو سياسات
-- زائدة من الإعداد السحابي الأول. هذا الملف يفرض الوضع الصحيح أياً كان ما في القاعدة.

/* 1) «مدير» = المدير العام ومدير المنصة فقط */
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()) and role in ('super_admin','admin'));
$$;

/* 1ب) can_review بتعريفها الصحيح (المراجع: الاستبيانات المسندة فقط) */
create or replace function public.can_review(p_survey uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid())
    and (role in ('super_admin','admin') or (role = 'reviewer' and p_survey = any(coalesce(surveys, '{}')))));
$$;

/* 2) إزالة أي سياسة غير معروفة على الجداول الأساسية، وتفعيل RLS عليها */
do $$
declare
  t text; p record;
  keep constant text[] := array[
    'projects_admin_all', 'projects_reviewer_read',
    'surveys_admin_all', 'surveys_reviewer_read',
    'responses_admin_all', 'responses_reviewer_read', 'responses_reviewer_update',
    'imports_admin_all'];
begin
  foreach t in array array['projects', 'surveys', 'responses', 'imports'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      if not (p.policyname = any(keep)) then
        raise notice 'حذف سياسة غير معروفة: %.%', t, p.policyname;
        execute format('drop policy %I on public.%I', p.policyname, t);
      end if;
    end loop;
  end loop;
end $$;

/* 3) إعادة السياسات المعروفة بتعريفها الصحيح */
drop policy if exists projects_admin_all on public.projects;
create policy projects_admin_all on public.projects for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists surveys_admin_all on public.surveys;
create policy surveys_admin_all on public.surveys for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists responses_admin_all on public.responses;
create policy responses_admin_all on public.responses for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists imports_admin_all on public.imports;
create policy imports_admin_all on public.imports for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

/* المراجع: الاستبيانات المسندة إليه فقط، ومشاريعها فقط */
drop policy if exists surveys_reviewer_read on public.surveys;
create policy surveys_reviewer_read on public.surveys for select to authenticated
  using ((select public.can_review(id)));
drop policy if exists projects_reviewer_read on public.projects;
create policy projects_reviewer_read on public.projects for select to authenticated
  using (exists (select 1 from public.surveys s where s.project_id = projects.id and public.can_review(s.id)));
drop policy if exists responses_reviewer_read on public.responses;
create policy responses_reviewer_read on public.responses for select to authenticated
  using ((select public.can_review_response(survey_id, answers)));
drop policy if exists responses_reviewer_update on public.responses;
create policy responses_reviewer_update on public.responses for update to authenticated
  using ((select public.can_review_response(survey_id, answers)))
  with check ((select public.can_review_response(survey_id, answers)));
