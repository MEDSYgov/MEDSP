-- ===== شاشات العرض في مبنى الوزارة =====
-- إعدادات ما يظهر على الشاشات العامة (#/screen): أي الشرائح، بأي ترتيب، ومدة كل منها،
-- والتصنيفات والمحافظات المخفية، ونص الرسالة.
-- تعديل إضافي فقط: جدول جديد ودالتان جديدتان، ولا يمس أي جدول أو دالة قائمة.

create table if not exists public.screen_settings (
  id smallint primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.screen_settings enable row level security;
-- لا سياسات: الجدول مغلق، والوصول عبر الدالتين أدناه فقط
revoke all on table public.screen_settings from anon, authenticated;

-- صف واحد يبدأ فارغاً؛ الخادم يكمله بالإعدادات الافتراضية
insert into public.screen_settings (id) values (1) on conflict (id) do nothing;

-- قراءة الإعدادات: عامة، لأن خادم الشاشات يقرؤها دون تسجيل دخول.
-- تُرجع الإعدادات فقط (لا من عدّلها ولا متى).
create or replace function public.screen_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select config from public.screen_settings where id = 1), '{}'::jsonb);
$$;
revoke all on function public.screen_config() from public;
grant execute on function public.screen_config() to anon, authenticated;

-- الحفظ: للمدير العام ومدير المنصة فقط
create or replace function public.save_screen_config(p_config jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'إدارة الشاشات لمدير المنصة فقط.' using errcode = '42501';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'إعدادات غير صالحة.' using errcode = '22023';
  end if;
  insert into public.screen_settings (id, config, updated_at, updated_by)
  values (1, p_config, now(), (select auth.uid()))
  on conflict (id) do update set config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return p_config;
end; $$;
revoke all on function public.save_screen_config(jsonb) from public, anon;
grant execute on function public.save_screen_config(jsonb) to authenticated;
