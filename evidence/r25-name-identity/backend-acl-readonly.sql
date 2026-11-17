-- Read-only catalog/privilege evidence; contains no user or credential data.
SELECT jsonb_build_object(
  'tables', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'rls_enabled', c.relrowsecurity,
      'anon_any_dml', has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE'),
      'authenticated_any_dml', has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'),
      'policy_count', (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)
    ) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN (
      'r25wf_native_identities','r25wf_name_aliases','r25wf_name_conflicts',
      'r25wf_name_registrations','r25wf_name_rates'
    )
  ),
  'functions', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'security_definer', p.prosecdef,
      'anon_execute', has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_role_execute', has_function_privilege('service_role',p.oid,'EXECUTE'),
      'config', p.proconfig
    ) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'r25wf_name_key','r25wf_native_identity_namespace_guard',
      'r25wf_name_profile_guard','r25wf_name_registration_json','r25wf_name_identity_service'
    )
  )
) AS acl_evidence;
