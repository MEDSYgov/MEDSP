-- ===== استمارات تتطلب تسجيل الدخول =====
-- خيار لكل استبيان: requires_login. إن فُعِّل لا يُفتح الاستبيان ولا تُقبل إجابته
-- إلا من حساب مسجَّل أُسند إليه الاستبيان (جامع بيانات أو مراجع)، أو من مدير.
-- كل إجابة تُسجَّل باسم الحساب الذي أرسلها (submitted_by).
-- الاستبيانات الأخرى تبقى كما هي (رابط عام، مع كلمة مرور اختيارية).

alter table public.surveys add column if not exists requires_login boolean not null default false;
alter table public.responses add column if not exists submitted_by uuid references auth.users (id) on delete set null;

/* الاستمارة الرسمية لإدارة الأنقاض: تتطلب الدخول */
update public.surveys set requires_login = true where id = '537648f2-9f2a-45fb-910b-d7d0ac1657cc';

/* هل يحق للحساب الحالي تعبئة هذا الاستبيان؟ */
create or replace function public.can_fill(p_survey uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid())
    and (a.role in ('super_admin', 'admin')
      or (a.role in ('collector', 'reviewer') and p_survey = any(coalesce(a.surveys, '{}')))));
$$;
revoke all on function public.can_fill(uuid) from public, anon;
grant execute on function public.can_fill(uuid) to authenticated;

create or replace function public.get_public_survey(p_survey uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare s public.surveys; pname text;
begin
  select * into s from public.surveys where id = p_survey;
  if not found then return jsonb_build_object('status','missing'); end if;
  if not s.is_open then return jsonb_build_object('status','closed'); end if;
  if s.closes_at is not null and s.closes_at < current_date then
    return jsonb_build_object('status','expired');
  end if;
  select name into pname from public.projects where id = s.project_id;

  if s.requires_login and not public.can_fill(p_survey) then
    return jsonb_build_object(
      'status', case when (select auth.uid()) is null then 'login' else 'forbidden' end,
      'projectName', coalesce(pname,''),
      'survey', jsonb_build_object('id', s.id, 'title', s.title));
  end if;

  if s.password_hash is not null and not s.requires_login then
    return jsonb_build_object(
      'status','ok', 'needsPassword', true, 'projectName', coalesce(pname,''),
      'survey', jsonb_build_object('id', s.id, 'title', s.title));
  end if;

  return jsonb_build_object(
    'status','ok', 'needsPassword', false, 'requiresLogin', s.requires_login, 'projectName', coalesce(pname,''),
    'survey', jsonb_build_object('id', s.id, 'title', s.title,
                                 'description', s.description, 'pages', s.pages));
end;
$$;

create or replace function public.unlock_survey(p_survey uuid, p_password text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare s public.surveys;
begin
  select * into s from public.surveys where id = p_survey and is_open;
  if not found then return null; end if;
  if s.closes_at is not null and s.closes_at < current_date then return null; end if;
  if s.requires_login and not public.can_fill(p_survey) then return null; end if;
  if s.password_hash is not null and not s.requires_login
     and s.password_hash <> extensions.crypt(coalesce(p_password,''), s.password_hash) then
    return null;
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title,
                            'description', s.description, 'pages', s.pages);
end;
$$;

create or replace function public.submit_response(
  p_survey uuid, p_answers jsonb, p_password text default null,
  p_source text default 'link', p_meta jsonb default '{}'::jsonb, p_client_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare s public.surveys; new_id uuid; existing uuid; clean_meta jsonb; who text;
begin
  if p_client_id is not null then
    select id into existing from public.responses where client_id = p_client_id;
    if found then return existing; end if;
  end if;

  select * into s from public.surveys where id = p_survey;
  if not found then raise exception 'الاستبيان غير موجود'; end if;

  if s.requires_login and not public.can_fill(p_survey) then
    if (select auth.uid()) is null then
      raise exception 'يلزم تسجيل الدخول' using errcode = '28000';
    end if;
    raise exception 'هذا الحساب غير مخوّل بتعبئة هذا الاستبيان' using errcode = '42501';
  end if;

  if not public.is_admin() then
    if not s.is_open then raise exception 'الاستبيان مغلق'; end if;
    if s.closes_at is not null and s.closes_at < current_date then
      raise exception 'انتهت مدة التعبئة';
    end if;
    if s.password_hash is not null and not s.requires_login
       and s.password_hash <> extensions.crypt(coalesce(p_password,''), s.password_hash) then
      raise exception 'كلمة المرور غير صحيحة';
    end if;
  end if;

  if jsonb_typeof(p_answers) <> 'object' then raise exception 'صيغة الإجابة غير صحيحة'; end if;
  if pg_column_size(p_answers) > 8 * 1024 * 1024 then raise exception 'حجم الإجابة كبير جداً'; end if;

  select coalesce(nullif(a.display_name, ''), a.username) into who
    from public.admins a where a.user_id = (select auth.uid());

  clean_meta := jsonb_strip_nulls(jsonb_build_object(
    'startedAt', case when jsonb_typeof(p_meta->'startedAt') = 'string' then p_meta->'startedAt' end,
    'endedAt', case when jsonb_typeof(p_meta->'endedAt') = 'string' then p_meta->'endedAt' end,
    'durationSec', case when jsonb_typeof(p_meta->'durationSec') = 'number' then p_meta->'durationSec' end,
    'queuedAt', case when jsonb_typeof(p_meta->'queuedAt') = 'string' then p_meta->'queuedAt' end,
    'offline', case when jsonb_typeof(p_meta->'offline') = 'boolean' then p_meta->'offline' end,
    'device', case when jsonb_typeof(p_meta->'device') = 'string' then to_jsonb(left(p_meta->>'device', 120)) end,
    'submittedBy', to_jsonb(who)
  ));

  insert into public.responses (survey_id, answers, source, meta, client_id, history, submitted_by)
  values (p_survey, p_answers,
          case when p_source in ('link','preview') then p_source else 'link' end,
          clean_meta, p_client_id,
          jsonb_build_array(jsonb_build_object('at', now(), 'action', 'submitted',
                                               'by', coalesce(who, 'مجهول'))),
          (select auth.uid()))
  on conflict (client_id) where client_id is not null do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id from public.responses where client_id = p_client_id;
  end if;
  return new_id;
end;
$$;

grant execute on function public.get_public_survey(uuid), public.unlock_survey(uuid,text) to anon, authenticated;
grant execute on function public.submit_response(uuid,jsonb,text,text,jsonb,uuid) to anon, authenticated;
