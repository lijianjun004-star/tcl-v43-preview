-- Apply schema-postgresql.sql, schema-device-grants.sql,
-- schema-device-self-service.sql and schema-identity-v2.sql first.
-- Run only in an isolated PostgreSQL test database.
begin;
do $test$
declare
  v_anchor jsonb;
  v_operator jsonb;
  v_used jsonb;
  v_issue jsonb;
  v_reset jsonb;
  v_reset_id text;
  v_old_id text;
  v_preexisting text := 'r24-existing-user';
  v_result jsonb;
begin
  if has_function_privilege('anon','public.tcl_r24_sync_v1_auto_enroll_device(text,text,text,text)','execute')
    or has_function_privilege('authenticated','public.tcl_r24_sync_v1_activate_device(text,text,text,text)','execute')
    or has_function_privilege('service_role','public.tcl_r24_sync_v1_reset_device_binding(text)','execute') then
    raise exception 'incorrect function grants';
  end if;
  if not has_function_privilege('service_role','public.tcl_r24_sync_v1_auto_enroll_device(text,text,text,text)','execute')
    or has_table_privilege('service_role','public.tcl_r24_sync_v1_device_attempts','update') then
    raise exception 'incorrect service authority';
  end if;

  -- Owners created these rows under the original pilot schema.
  insert into public.tcl_r24_sync_v1_enrollments
    (id,team_id,display_name,role,active)
  values (v_preexisting,'r24-pilot','之前 Ａ主播','anchor',true);
  insert into public.tcl_r24_sync_v1_device_grants (code_digest,enrollment_id,activation_expires_at)
  values (repeat('b',64),v_preexisting,clock_timestamp()+interval '1 day');
  v_result := public.tcl_r24_sync_v1_auto_enroll_device('之前 A主播','operator',repeat('c',64),repeat('1',64));
  if v_result <> '{"status":"exists","registeredRole":"anchor"}'::jsonb then
    raise exception 'legacy canonical name could be duplicated or changed';
  end if;
  v_result := public.tcl_r24_sync_v1_activate_device('之前 A主播',null,repeat('b',64),repeat('c',64));
  if v_result->>'id' is distinct from v_preexisting then raise exception 'legacy grant lost'; end if;

  v_anchor := public.tcl_r24_sync_v1_auto_enroll_device('测试主播','anchor',repeat('d',64),repeat('1',64));
  v_operator := public.tcl_r24_sync_v1_auto_enroll_device('测试运营','operator',repeat('e',64),repeat('2',64));
  v_old_id := v_anchor->>'id';
  if v_anchor->>'status' is distinct from 'enrolled' or v_operator->>'role' is distinct from 'operator'
    or v_old_id is null or v_operator->>'id' = v_old_id then
    raise exception 'auto enroll failed';
  end if;
  if not exists (select 1 from public.tcl_r24_sync_v1_enrollments
    where id = v_old_id and enroll_mode = 'auto-approved' and enrolled_at is not null) then
    raise exception 'enrollment metadata missing';
  end if;
  v_result:=public.tcl_r24_sync_v1_auto_enroll_device('测试主播','anchor',repeat('d',64),repeat('2',64));
  if v_result<>v_anchor then raise exception 'same device retry changed identity or grant'; end if;
  v_result:=public.tcl_r24_sync_v1_auto_enroll_device('测试主播','operator',repeat('f',64),repeat('3',64));
  if v_result <> '{"status":"exists","registeredRole":"anchor"}'::jsonb then
    raise exception 'wrong role attempt did not return original role';
  end if;
  v_result:=public.tcl_r24_sync_v1_auto_enroll_device('撞设备码','anchor',repeat('d',64),repeat('3',64));
  if v_result->>'status' is distinct from 'device_conflict' or exists (
    select 1 from public.tcl_r24_sync_v1_enrollments where display_name='撞设备码'
  ) then raise exception 'device uniqueness failure left an account'; end if;

  v_issue:=public.tcl_r24_sync_v1_issue_device_code(repeat('d',64),repeat('4',64));
  if v_issue->>'name' is distinct from '测试主播' or v_issue->>'role' is distinct from 'anchor'
    or (v_issue->>'expiresAt')::timestamptz - clock_timestamp() not between interval '29 minutes' and interval '30 minutes' then
    raise exception 'code response lacks identity or valid expiry';
  end if;
  perform public.tcl_r24_sync_v1_issue_device_code(repeat('d',64),repeat('5',64));
  v_result:=public.tcl_r24_sync_v1_activate_device('测试主播','anchor',repeat('4',64),repeat('3',64));
  if v_result->>'errorCode' is distinct from 'CODE_EXPIRED' then raise exception 'superseded code remained valid'; end if;
  v_result:=public.tcl_r24_sync_v1_activate_device('测试主播','operator',repeat('5',64),repeat('3',64));
  if v_result <> '{"errorCode":"CODE_MISMATCH","registeredRole":"anchor"}'::jsonb then
    raise exception 'wrong role consumed grant';
  end if;
  v_used:=public.tcl_r24_sync_v1_activate_device('测试主播','anchor',repeat('5',64),repeat('3',64));
  if v_used->>'id' is distinct from v_old_id then raise exception 'device not bound to original identity'; end if;
  v_result:=public.tcl_r24_sync_v1_activate_device('测试主播','anchor',repeat('5',64),repeat('3',64));
  if v_result<>v_used then raise exception 'same device transport retry failed'; end if;
  v_result:=public.tcl_r24_sync_v1_activate_device('测试主播','anchor',repeat('5',64),repeat('f',64));
  if v_result->>'errorCode' is distinct from 'CODE_USED' then raise exception 'used code bound another phone'; end if;

  insert into public.tcl_r24_sync_v1_assignments values
    ('fixture-assignment','r24-pilot', '{"id":"fixture-assignment","teamId":"r24-pilot"}');
  insert into public.tcl_r24_sync_v1_submissions values
    (repeat('a',64),'r24-pilot','fixture-assignment',v_old_id,clock_timestamp(),jsonb_build_object(
      'id',repeat('a',64),'teamId','r24-pilot','assignmentId','fixture-assignment','anchorId',v_old_id
    ));
  v_reset:=public.tcl_r24_sync_v1_reset_device_binding(v_old_id);
  if v_reset <> '{"reset":true}'::jsonb
    or exists (select 1 from public.tcl_r24_sync_v1_device_grants where enrollment_id=v_old_id and revoked_at is null)
    or not exists (select 1 from public.tcl_r24_sync_v1_submissions where anchor_id=v_old_id) then
    raise exception 'reset removed history or did not revoke all devices';
  end if;
  v_result:=public.tcl_r24_sync_v1_auto_enroll_device('测试主播','operator',repeat('f',64),repeat('6',64));
  if v_result->>'registeredRole' is distinct from 'anchor' then raise exception 'reset role escalation'; end if;
  v_result:=public.tcl_r24_sync_v1_auto_enroll_device('测试主播','anchor',repeat('f',64),repeat('6',64));
  v_reset_id:=v_result->>'id';
  if v_reset_id is distinct from v_old_id or v_result->>'role' is distinct from 'anchor'
     or (v_result->>'deviceId') is not distinct from (v_anchor->>'deviceId') then
    raise exception 'reset consumed the wrong identity';
  end if;
  v_result:=public.tcl_r24_sync_v1_auto_enroll_device('测试主播','anchor',repeat('7',64),repeat('8',64));
  if v_result->>'status' is distinct from 'exists' then raise exception 'reset slot remained valid'; end if;

  for n in 1..11 loop
    v_result:=public.tcl_r24_sync_v1_count_device_attempt(repeat('c',64),'auto-enroll',true);
    if (v_result->>'allowed')::boolean is distinct from (n <= 10) then
      raise exception 'unexpected rate bucket result';
    end if;
  end loop;
  v_result:=public.tcl_r24_sync_v1_count_device_attempt(repeat('c',64),'activate',true);
  if v_result->>'allowed' is distinct from 'true' then raise exception 'activation shares enrollment bucket'; end if;
end;
$test$;
rollback;
