-- Read-only checks tailored to MEDSP at dff29b9ad206cde0b9b7503ac209472b6c009745.
-- Keep this check aligned with application RPC calls when future features change.
DO $checks$
DECLARE missing text;
BEGIN
  SELECT string_agg(name, ', ') INTO missing
  FROM unnest(ARRAY['auth.users','public.admins','public.projects','public.surveys',
                   'public.responses','public.rubble_entities']) AS names(name)
  WHERE to_regclass(name) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Required tables missing: %', missing; END IF;
  SELECT string_agg(name, ', ') INTO missing
  FROM unnest(ARRAY['apply_import','create_account','delete_account','get_public_survey',
                   'list_accounts_v3','list_published','list_survey_titles','my_role','my_surveys',
                   'reset_account_password','rubble_photos','rubble_transfer_feed',
                   'set_survey_password','submit_response','unlock_survey','update_account_access']) AS names(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname=name);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Required RPC functions missing: %', missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
                 AND table_name='admins' AND column_name='entity') THEN
    RAISE EXCEPTION 'Required admins.entity column is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='create_account' AND 'p_entity'=ANY(p.proargnames))
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='update_account_access' AND 'p_entity'=ANY(p.proargnames)) THEN
    RAISE EXCEPTION 'The entity-aware account functions mentioned in the final historical migration are missing';
  END IF;
END
$checks$;
