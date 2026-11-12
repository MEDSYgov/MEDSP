-- ===== المرحلة الأولى من ملاحظات الميدان =====
-- 1) رابط عام لكل استبيان: يفتح دون تسجيل دخول، ويطلب اسم المستبين وكنيته.
--    الرابط يحمل رمزاً سرياً (public_token)؛ إلغاؤه أو توليد غيره يُبطل القديم فوراً.
-- 2) سقف حجم الإجابة 20 ميغابايت (صور الاستمارة الرسمية كثيرة).
-- 3) الاستمارة الرسمية للأنقاض: حذف أيام العمل والرحلات وساعات العمل اليومية،
--    والموقع الجغرافي اختياري، وصور الموقع الثلاث إلزامية.

alter table public.surveys add column if not exists public_token text;
create unique index if not exists surveys_public_token_key on public.surveys (public_token) where public_token is not null;

/* توليد رابط عام جديد (أو إلغاؤه بـ p_enable = false). للمدير العام ومدير المنصة. */
create or replace function public.set_public_token(p_survey uuid, p_enable boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  t := case when p_enable then translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_') end;
  update public.surveys set public_token = t where id = p_survey;
  if not found then raise exception 'الاستبيان غير موجود'; end if;
  return t;
end; $$;
revoke all on function public.set_public_token(uuid, boolean) from public, anon;
grant execute on function public.set_public_token(uuid, boolean) to authenticated;

/* هل يُسمح بفتح الاستبيان/الإرسال: حساب مخوّل، أو رمز الرابط العام الصحيح */
create or replace function public.fill_allowed(s public.surveys, p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not s.requires_login
      or public.can_fill(s.id)
      or (p_token is not null and s.public_token is not null and p_token = s.public_token);
$$;
revoke all on function public.fill_allowed(public.surveys, text) from public, anon, authenticated;

drop function if exists public.get_public_survey(uuid);
create or replace function public.get_public_survey(p_survey uuid, p_token text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare s public.surveys; pname text; via_token boolean;
begin
  select * into s from public.surveys where id = p_survey;
  if not found then return jsonb_build_object('status','missing'); end if;
  if not s.is_open then return jsonb_build_object('status','closed'); end if;
  if s.closes_at is not null and s.closes_at < current_date then
    return jsonb_build_object('status','expired');
  end if;
  select name into pname from public.projects where id = s.project_id;
  via_token := p_token is not null and s.public_token is not null and p_token = s.public_token;

  if p_token is not null and not via_token then
    return jsonb_build_object('status','link-revoked', 'projectName', coalesce(pname,''),
      'survey', jsonb_build_object('id', s.id, 'title', s.title));
  end if;

  if not public.fill_allowed(s, p_token) then
    return jsonb_build_object(
      'status', case when (select auth.uid()) is null then 'login' else 'forbidden' end,
      'projectName', coalesce(pname,''),
      'survey', jsonb_build_object('id', s.id, 'title', s.title));
  end if;

  if s.password_hash is not null and not s.requires_login and not via_token then
    return jsonb_build_object(
      'status','ok', 'needsPassword', true, 'projectName', coalesce(pname,''),
      'survey', jsonb_build_object('id', s.id, 'title', s.title));
  end if;

  return jsonb_build_object(
    'status','ok', 'needsPassword', false,
    'requiresLogin', s.requires_login and not via_token,
    'publicLink', via_token,
    'projectName', coalesce(pname,''),
    'survey', jsonb_build_object('id', s.id, 'title', s.title,
                                 'description', s.description, 'pages', s.pages));
end;
$$;

drop function if exists public.submit_response(uuid, jsonb, text, text, jsonb, uuid);
create or replace function public.submit_response(
  p_survey uuid, p_answers jsonb, p_password text default null,
  p_source text default 'link', p_meta jsonb default '{}'::jsonb, p_client_id uuid default null,
  p_token text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare s public.surveys; new_id uuid; existing uuid; clean_meta jsonb; who text; via_token boolean; respondent text;
begin
  if p_client_id is not null then
    select id into existing from public.responses where client_id = p_client_id;
    if found then return existing; end if;
  end if;

  select * into s from public.surveys where id = p_survey;
  if not found then raise exception 'الاستبيان غير موجود'; end if;
  via_token := p_token is not null and s.public_token is not null and p_token = s.public_token;

  if p_token is not null and not via_token then
    raise exception 'رابط الاستبيان أُلغي. اطلب الرابط الجديد من مدير المنصة.' using errcode = '42501';
  end if;

  if not public.fill_allowed(s, p_token) then
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
    if s.password_hash is not null and not s.requires_login and not via_token
       and s.password_hash <> extensions.crypt(coalesce(p_password,''), s.password_hash) then
      raise exception 'كلمة المرور غير صحيحة';
    end if;
  end if;

  if jsonb_typeof(p_answers) <> 'object' then raise exception 'صيغة الإجابة غير صحيحة'; end if;
  if pg_column_size(p_answers) > 20 * 1024 * 1024 then raise exception 'حجم الإجابة كبير جداً'; end if;

  respondent := nullif(btrim(left(coalesce(p_meta->>'respondent', ''), 120)), '');
  if via_token and respondent is null then
    raise exception 'اكتب اسمك وكنيتك قبل الإرسال';
  end if;

  select coalesce(nullif(a.display_name, ''), a.username) into who
    from public.admins a where a.user_id = (select auth.uid());
  if via_token then who := respondent; end if;

  clean_meta := jsonb_strip_nulls(jsonb_build_object(
    'startedAt', case when jsonb_typeof(p_meta->'startedAt') = 'string' then p_meta->'startedAt' end,
    'endedAt', case when jsonb_typeof(p_meta->'endedAt') = 'string' then p_meta->'endedAt' end,
    'durationSec', case when jsonb_typeof(p_meta->'durationSec') = 'number' then p_meta->'durationSec' end,
    'queuedAt', case when jsonb_typeof(p_meta->'queuedAt') = 'string' then p_meta->'queuedAt' end,
    'offline', case when jsonb_typeof(p_meta->'offline') = 'boolean' then p_meta->'offline' end,
    'device', case when jsonb_typeof(p_meta->'device') = 'string' then to_jsonb(left(p_meta->>'device', 120)) end,
    'submittedBy', to_jsonb(who),
    'respondent', to_jsonb(respondent),
    'via', case when via_token then to_jsonb('public-link'::text) end
  ));

  insert into public.responses (survey_id, answers, source, meta, client_id, history, submitted_by)
  values (p_survey, p_answers,
          case when p_source in ('link','preview') then p_source else 'link' end,
          clean_meta, p_client_id,
          jsonb_build_array(jsonb_build_object('at', now(), 'action', 'submitted',
                                               'by', coalesce(who, 'مجهول'))),
          case when via_token then null else (select auth.uid()) end)
  on conflict (client_id) where client_id is not null do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id from public.responses where client_id = p_client_id;
  end if;
  return new_id;
end;
$$;

grant execute on function public.get_public_survey(uuid, text) to anon, authenticated;
grant execute on function public.submit_response(uuid, jsonb, text, text, jsonb, uuid, text) to anon, authenticated;

/* ---------- تعديلات الاستمارة الرسمية ---------- */
create or replace function public.rt_phase1_nodes(p jsonb)
returns jsonb language plpgsql immutable as $$
declare res jsonb := '[]'::jsonb; n jsonb; nm text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return p; end if;
  for n in select * from jsonb_array_elements(p) loop
    nm := n->>'name';
    if nm in ('rt_work_days', 'rt_trips', 'rt_daily_hours') then continue; end if;
    if nm = 'rt_point' then
      n := n || jsonb_build_object('required', false,
        'hint', 'اختياري: حدّد موقعك، أو اكتب الإحداثيات، أو اخترها من الخريطة. إن تُرك فارغاً يُعتمد مركز القرية المختارة.');
    elsif nm in ('rt_photo_before', 'rt_photo_during', 'rt_photo_after') then
      n := n || jsonb_build_object('required', true);
    end if;
    if n ? 'children' then n := jsonb_set(n, '{children}', public.rt_phase1_nodes(n->'children')); end if;
    res := res || jsonb_build_array(n);
  end loop;
  return res;
end; $$;

update public.surveys set pages = public.rt_phase1_nodes(pages)
where pages::text like '%"rt_volume"%';

drop function public.rt_phase1_nodes(jsonb);
