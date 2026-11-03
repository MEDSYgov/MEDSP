-- ===== إشعارات المدراء =====
-- جرس داخل المنصة + إشعارات دفع (Web Push) لحسابات المدير العام ومدير المنصة فقط.
-- خادم المنصة لا يملك مفتاح service_role، لذلك يتواصل مع القاعدة عبر دالتين
-- محميتين برمز مشترك (PUSH_SECRET في .env). يُسجَّل الرمز عند أول تشغيل للخادم،
-- ولا يُقرأ الجدول الذي يحفظه من أي دور (RLS بلا سياسات).

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  kind text not null default 'data',
  title text not null,
  body text not null default '',
  link text not null default '',
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
drop policy if exists notifications_admin_read on public.notifications;
create policy notifications_admin_read on public.notifications for select to authenticated
  using ((select public.is_admin()));

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own_read on public.push_subscriptions;
create policy push_subs_own_read on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists push_subs_own_insert on public.push_subscriptions;
create policy push_subs_own_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_admin()));
drop policy if exists push_subs_own_delete on public.push_subscriptions;
create policy push_subs_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.data_versions (
  dataset text primary key,
  hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.data_versions enable row level security;

create table if not exists public.push_config (
  id boolean primary key default true check (id),
  secret text not null
);
alter table public.push_config enable row level security;

/* التحقق من رمز الخادم؛ أول استدعاء يسجّله */
create or replace function public.push_check(p_secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  if p_secret is null or length(p_secret) < 24 then return false; end if;
  select secret into s from public.push_config;
  if s is null then
    insert into public.push_config (id, secret) values (true, p_secret) on conflict do nothing;
    select secret into s from public.push_config;
  end if;
  return s = p_secret;
end; $$;

/*
  يستدعيها الخادم عند كل تشغيل (أي بعد كل نشر) بنسخ مجموعات البيانات:
  p_versions = [{dataset, hash, title, body, link}]
  - أول مرة تُسجَّل النسخ دون إشعار (حتى لا يُرسل إشعار عند تفعيل الميزة)
  - المجموعة التي تغيّرت بصمتها ← إشعار جديد
  تعيد الإشعارات الجديدة واشتراكات الدفع (للمدراء فقط) ليُرسلها الخادم.
*/
create or replace function public.push_announce(p_secret text, p_versions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb; old text; created jsonb := '[]'::jsonb; n public.notifications;
begin
  if not public.push_check(p_secret) then raise exception 'رمز الإشعارات غير مطابق' using errcode = '42501'; end if;
  for v in select * from jsonb_array_elements(coalesce(p_versions, '[]'::jsonb)) loop
    select hash into old from public.data_versions where dataset = v->>'dataset';
    if not found then
      insert into public.data_versions (dataset, hash) values (v->>'dataset', v->>'hash');
    elsif old is distinct from v->>'hash' then
      update public.data_versions set hash = v->>'hash', updated_at = now() where dataset = v->>'dataset';
      insert into public.notifications (kind, title, body, link)
        values ('data', v->>'title', coalesce(v->>'body', ''), coalesce(v->>'link', '')) returning * into n;
      created := created || jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'link', n.link);
    end if;
  end loop;
  if jsonb_array_length(created) = 0 then
    return jsonb_build_object('created', created, 'subs', '[]'::jsonb);
  end if;
  return jsonb_build_object('created', created, 'subs', coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
    from public.push_subscriptions p join public.admins a on a.user_id = p.user_id
    where a.role in ('super_admin', 'admin')), '[]'::jsonb));
end; $$;

/* إزالة اشتراكات انتهت (ردّ 404/410 من خدمة الدفع) */
create or replace function public.push_prune(p_secret text, p_endpoints text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_check(p_secret) then raise exception 'رمز الإشعارات غير مطابق' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
end; $$;

revoke all on function public.push_check(text) from public, anon, authenticated;
revoke all on function public.push_announce(text, jsonb), public.push_prune(text, text[]) from public;
grant execute on function public.push_announce(text, jsonb), public.push_prune(text, text[]) to anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
