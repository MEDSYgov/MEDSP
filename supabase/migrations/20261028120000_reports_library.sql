-- ===== مكتبة التقارير (تبويب «التقارير») =====
-- تقارير PDF ترفعها الإدارة: شهرية، سنوية، طارئة، مرحلية، دراسات، وأخرى.
-- كل تقرير إما «عام» (يراه الزائر بلا تسجيل دخول) أو «داخلي» (للحسابات المسجّلة فقط).
-- الملفات في حاوية تخزين خاصة اسمها reports، ولا تُفتح إلا بروابط مؤقتة
-- يمنحها التخزين لمن يحق له قراءة التقرير.
-- تعديل إضافي فقط: جدول ودوال وسياسات جديدة، ولا يمس أي شيء قائم.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  category text not null check (category in ('monthly','annual','emergency','progress','study','other')),
  period_year smallint check (period_year between 2000 and 2100),
  period_month smallint check (period_month between 1 and 12),
  issued_on date not null default current_date,
  summary text check (length(summary) <= 2000),
  event text check (length(event) <= 200),
  govs text[] not null default '{}',
  file_path text not null unique,
  thumb_path text,
  file_size bigint,
  pages integer,
  visibility text not null default 'internal' check (visibility in ('public','internal')),
  published boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists reports_listing on public.reports (published, issued_on desc);
alter table public.reports enable row level security;

-- من يحق له قراءة تقرير منشور؟ العام للجميع، والداخلي لأي حساب له دور (عدا جامع البيانات)
create or replace function public.report_readable(p_visibility text, p_published boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or (p_published and (
            p_visibility = 'public'
            or exists (select 1 from public.admins where user_id = (select auth.uid()) and role <> 'collector')));
$$;
revoke all on function public.report_readable(text, boolean) from public;
grant execute on function public.report_readable(text, boolean) to anon, authenticated;

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to anon, authenticated
  using ((select public.report_readable(visibility, published)));
drop policy if exists reports_admin_write on public.reports;
create policy reports_admin_write on public.reports for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.reports to anon, authenticated;
grant insert, update, delete on public.reports to authenticated;

create or replace function public.reports_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists reports_touch on public.reports;
create trigger reports_touch before update on public.reports for each row execute function public.reports_touch();

-- ===== التخزين =====
-- يُنفَّذ فقط إن كانت خدمة التخزين موجودة في هذه القاعدة، حتى لا يفشل النشر بسببها.
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Storage schema not found: reports bucket was not created.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('reports', 'reports', false, 52428800, array['application/pdf','image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  -- القراءة: الملف أو صورة غلافه تُقرأ إن كان تقريرها مقروءاً لهذا المستخدم
  execute $p$drop policy if exists reports_files_read on storage.objects$p$;
  execute $p$create policy reports_files_read on storage.objects for select to anon, authenticated
    using (bucket_id = 'reports' and ((select public.is_admin()) or exists (
      select 1 from public.reports r
      where (r.file_path = name or r.thumb_path = name)
        and public.report_readable(r.visibility, r.published))))$p$;

  -- الرفع والتعديل والحذف: المدير العام ومدير المنصة فقط
  execute $p$drop policy if exists reports_files_insert on storage.objects$p$;
  execute $p$create policy reports_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'reports' and (select public.is_admin()))$p$;
  execute $p$drop policy if exists reports_files_update on storage.objects$p$;
  execute $p$create policy reports_files_update on storage.objects for update to authenticated
    using (bucket_id = 'reports' and (select public.is_admin()))
    with check (bucket_id = 'reports' and (select public.is_admin()))$p$;
  execute $p$drop policy if exists reports_files_delete on storage.objects$p$;
  execute $p$create policy reports_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'reports' and (select public.is_admin()))$p$;
end
$storage$;
