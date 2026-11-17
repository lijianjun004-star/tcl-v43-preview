-- R25 registration recovery v3. Apply AFTER 002; do not rerun 001/002 afterwards.
-- No row is deleted or renamed. Existing operation credentials remain valid
-- until an authorized operator explicitly rotates a pending direct reservation.
BEGIN;
CREATE OR REPLACE FUNCTION public.r25wf_name_identity_service(action text,payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $name_api$
DECLARE
 p jsonb:=coalesce(payload,'{}'::jsonb); a text:=action;
 r public.r25wf_name_registrations; i public.r25wf_invites;
 u public.r25wf_users; n public.r25wf_native_identities;
 v_name text; v_key text; v_operation text; v_proof text; v_hash text;
 v_uid text; v_username text; v_id text; v_marker text;
 v_now timestamptz:=clock_timestamp(); v_count integer; v_role text; v_data jsonb;
 v_rate text; v_limit integer; v_window timestamptz; v_item jsonb; v_uids jsonb;
 v_mapped integer:=0; v_conflicts integer:=0; v_direct boolean:=false;
BEGIN
 PERFORM public.r25wf_require(jsonb_typeof(p)='object' AND octet_length(p::text)<=65536,
  'INVALID_REQUEST','身份请求格式无效');
 -- The HTTP function sends proofs/hashes only. Never persist passwords or raw
 -- operation/invitation secrets in PostgreSQL requests, idempotency or logs.
 PERFORM public.r25wf_require(NOT(p ?| ARRAY['password','operationSecret','inviteCode']),
  'INVALID_REQUEST','秘密字段不得进入业务数据库');

 IF a='limit' THEN
  v_rate:=p->>'rateKey';
  PERFORM public.r25wf_require(v_rate ~ '^[a-f0-9]{64}$' AND p->>'bucket'=ANY(ARRAY['resolve','register','status']),
   'INVALID_REQUEST','限流参数无效');
  v_window:=date_trunc('hour',v_now);
  v_limit:=CASE p->>'bucket' WHEN 'register' THEN 50 ELSE 600 END;
  INSERT INTO public.r25wf_name_rates AS t(rate_key,action,window_start,attempts)
   VALUES(v_rate,p->>'bucket',v_window,1)
   ON CONFLICT ON CONSTRAINT r25wf_name_rates_pkey DO UPDATE SET attempts=t.attempts+1 RETURNING attempts INTO v_count;
  IF v_count>v_limit THEN
   RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','RATE_LIMITED','message','请求过于频繁，请稍后再试'));
  END IF;
  IF p->>'bucket'='register' THEN
   INSERT INTO public.r25wf_name_rates AS t(rate_key,action,window_start,attempts)
    VALUES('global','register',v_window,1)
    ON CONFLICT ON CONSTRAINT r25wf_name_rates_pkey DO UPDATE SET attempts=t.attempts+1 RETURNING attempts INTO v_count;
   IF v_count>200 THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','RATE_LIMITED','message','开户请求达到本小时上限，请稍后再试')); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('allowed',true));
 END IF;

 IF a='backfill' THEN
  PERFORM public.r25wf_require(jsonb_typeof(p->'identities')='array' AND jsonb_array_length(p->'identities')<=200,
   'INVALID_REQUEST','请分批提供最多200个官方核实身份');
  FOR v_item IN SELECT value FROM jsonb_array_elements(p->'identities') LOOP
   v_uid:=v_item->>'uid';v_username:=v_item->>'nativeUsername';
   PERFORM public.r25wf_require(length(v_uid) BETWEEN 1 AND 128 AND v_username ~ '^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$',
    'INVALID_REQUEST','原生身份清单无效');
   SELECT * INTO u FROM public.r25wf_users WHERE uid=v_uid AND active;
   PERFORM public.r25wf_require(u.uid IS NOT NULL,'NOT_FOUND','只能迁移既有启用业务用户');
   SELECT * INTO n FROM public.r25wf_native_identities WHERE uid=v_uid;
   PERFORM public.r25wf_require(n.uid IS NULL OR n.native_username=v_username,'NATIVE_IDENTITY_CONFLICT','既有UID的原生用户名不一致，未改动');
   INSERT INTO public.r25wf_native_identities(uid,native_username) VALUES(v_uid,v_username) ON CONFLICT(uid) DO NOTHING;
   v_name:=btrim(normalize(u.display_name,NFKC),E' \t\n\r\f\v');v_key:=public.r25wf_name_key(v_name);
   SELECT jsonb_agg(uid ORDER BY uid) INTO v_uids FROM public.r25wf_users
    WHERE active AND public.r25wf_name_key(display_name)=v_key;
   IF jsonb_array_length(v_uids)>1 OR length(v_name)>40
      OR EXISTS(SELECT 1 FROM public.r25wf_name_aliases WHERE name_key=v_key AND uid<>v_uid)
      OR EXISTS(SELECT 1 FROM public.r25wf_name_conflicts WHERE name_key=v_key) THEN
    INSERT INTO public.r25wf_name_conflicts(name_key,display_name,uids,reason)
     VALUES(v_key,v_name,v_uids,CASE WHEN length(v_name)>40 THEN 'LEGACY_NAME_LENGTH' ELSE 'DUPLICATE_NAME' END)
     ON CONFLICT(name_key) DO UPDATE SET uids=excluded.uids;
    DELETE FROM public.r25wf_name_aliases WHERE name_key=v_key;
    v_conflicts:=v_conflicts+1;
   ELSE
    INSERT INTO public.r25wf_name_aliases(name_key,display_name,uid,source)
     VALUES(v_key,v_name,v_uid,'legacy') ON CONFLICT(name_key) DO NOTHING;
    v_mapped:=v_mapped+1;
   END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('mapped',v_mapped,'conflicts',v_conflicts));
 END IF;

 IF a='resolveLegacy' THEN
  v_uid:=p->>'providerUid';v_username:=p->>'nativeUsername';
  PERFORM public.r25wf_require(length(v_uid) BETWEEN 1 AND 128 AND v_username ~ '^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$',
   'INVALID_REQUEST','官方身份查询结果无效');
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_name_registrations WHERE native_username=v_username AND state<>'ready'),
   'NAME_PENDING','该姓名开户尚未完成，请恢复原开户尝试');
  SELECT * INTO u FROM public.r25wf_users WHERE uid=v_uid;
  PERFORM public.r25wf_require(u.uid IS NULL OR u.active,'ACCOUNT_DISABLED','账号已停用，请联系管理员');
  SELECT * INTO n FROM public.r25wf_native_identities WHERE uid=v_uid;
  PERFORM public.r25wf_require(n.uid IS NULL OR n.native_username=v_username,'NATIVE_IDENTITY_CONFLICT','原生身份映射不一致');
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('state','ready','username',v_username,
   'uid',v_uid,'displayName',coalesce(u.display_name,''),'legacy',true));
 END IF;

 IF a IN ('resolve','reserve') THEN
  PERFORM public.r25wf_require(jsonb_typeof(p->'name')='string','INVALID_NAME','请填写姓名');
  v_name:=btrim(normalize(p->>'name',NFKC),E' \t\n\r\f\v');v_key:=public.r25wf_name_key(v_name);
  PERFORM public.r25wf_require(length(v_name) BETWEEN 1 AND 40 AND v_name !~ '[[:cntrl:]]'
   AND v_name !~ U&'[\200B-\200F\202A-\202E\2066-\2069\FEFF]',
   'INVALID_NAME','姓名须1至40字，不得包含隐藏控制字符');
 END IF;

 IF a='resolve' THEN
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_name_conflicts WHERE name_key=v_key),
   'NAME_CONFLICT','姓名重名，请加部门或编号，并联系管理员核对旧账号');
  SELECT u0.* INTO u FROM public.r25wf_name_aliases x JOIN public.r25wf_users u0 ON u0.uid=x.uid WHERE x.name_key=v_key;
  IF u.uid IS NOT NULL THEN
   PERFORM public.r25wf_require(u.active,'ACCOUNT_DISABLED','账号已停用，请联系管理员');
   SELECT * INTO n FROM public.r25wf_native_identities WHERE uid=u.uid;
   RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('state','ready','username',n.native_username,'uid',u.uid,'displayName',u.display_name,'legacy',false));
  END IF;
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_name_registrations WHERE name_key=v_key),
   'NAME_PENDING','该姓名有未完成开户，请恢复原开户尝试');
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='NOT_FOUND|未找到姓名，请核对姓名或首次注册';
 END IF;

 PERFORM public.r25wf_require(a IN ('reserve','status','finalize'),'INVALID_ACTION','身份服务不支持此操作');
 v_operation:=p->>'operationId';v_proof:=p->>'operationProof';
 PERFORM public.r25wf_require(v_operation ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
  AND v_proof ~ '^[a-f0-9]{64}$','INVALID_REQUEST','开户操作凭据无效');
 PERFORM pg_advisory_xact_lock(hashtextextended('r25wf-name-op:'||v_operation,0));
 SELECT * INTO r FROM public.r25wf_name_registrations WHERE operation_id=v_operation FOR UPDATE;
 IF r.id IS NOT NULL THEN
  PERFORM public.r25wf_require(r.operation_proof=v_proof,'INVALID_OPERATION_SECRET','无法恢复此开户尝试，请使用原设备或联系管理员');
 END IF;

 IF a='reserve' THEN
  v_direct:=p ? 'role';v_role:=p->>'role';v_hash:=p->>'inviteHash';
  IF v_direct THEN
   PERFORM public.r25wf_require(jsonb_typeof(p->'role')='string' AND v_role IN ('anchor','operator'),
    'INVALID_ROLE','注册身份仅支持主播或运营');
   PERFORM public.r25wf_require(NOT(p ? 'inviteHash'),'INVALID_REQUEST','直接注册无需邀请码');
  ELSE
   PERFORM public.r25wf_require(v_hash ~ '^[a-f0-9]{32}$','INVALID_INVITE','邀请码无效');
  END IF;
  IF r.id IS NOT NULL THEN
   PERFORM public.r25wf_require(r.name_key=v_key AND
    ((v_direct AND r.invite_id IS NULL AND r.role=v_role) OR
     (NOT v_direct AND r.invite_id IS NOT NULL AND r.invite_hash=v_hash)),
    'REGISTRATION_CONFLICT','此操作编号已用于其他姓名、身份或注册方式');
   RETURN jsonb_build_object('ok',true,'data',public.r25wf_name_registration_json(r));
  END IF;
  IF NOT v_direct THEN
   SELECT * INTO i FROM public.r25wf_invites WHERE code_hash=v_hash FOR UPDATE;
   PERFORM public.r25wf_require(i.id IS NOT NULL AND i.consumed_by IS NULL,'INVALID_INVITE','邀请码无效或已被使用');
   PERFORM public.r25wf_require(i.target_uid IS NULL,'INVITE_FOR_EXISTING_ACCOUNT','此邀请码属于既有账号，请先登录原账号再绑定');
   PERFORM public.r25wf_require(i.expires_at>v_now,'INVITE_EXPIRED','邀请码已过期');
   PERFORM public.r25wf_require(i.role IN ('operator','anchor') AND EXISTS(SELECT 1 FROM public.r25wf_users
    WHERE uid=i.created_by AND active AND (role='admin' OR (role='operator' AND i.role='anchor'))),
    'INVALID_INVITE','邀请码发起账号或权限已失效');
   v_role:=i.role;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('r25wf-name-key:'||v_key,0));
  -- Do not occupy a name or consume an invitation before all authorization checks.
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_name_conflicts WHERE name_key=v_key),
   'NAME_CONFLICT','姓名重名，请加部门或编号');
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_name_aliases WHERE name_key=v_key),
   'NAME_TAKEN','姓名已存在，请直接用原密码登录，或加部门/编号');
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_users WHERE active AND public.r25wf_name_key(display_name)=v_key),
   'NAME_TAKEN','姓名属于已有账号，请用原密码登录或联系管理员');
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_name_registrations WHERE name_key=v_key),
   'NAME_PENDING','姓名已有未完成开户，请恢复原尝试');
  PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_native_identities
    WHERE public.r25wf_name_key(native_username)=v_key),
   'NAME_TAKEN','姓名与既有登录名冲突，请直接登录原账号或加部门编号');
  v_id:=gen_random_uuid()::text;v_username:='r25n_'||substr(replace(gen_random_uuid()::text,'-',''),1,24);v_marker:='r25wf-name-v1:'||v_id;
  INSERT INTO public.r25wf_name_registrations(id,operation_id,operation_proof,name_key,display_name,native_username,invite_id,invite_hash,role,native_marker)
   VALUES(v_id,v_operation,v_proof,v_key,v_name,v_username,i.id,v_hash,v_role,v_marker) RETURNING * INTO r;
  IF NOT v_direct THEN
   UPDATE public.r25wf_invites SET consumed_by='reserved:'||r.id,consumed_at=v_now WHERE id=i.id;
  END IF;
  RETURN jsonb_build_object('ok',true,'data',public.r25wf_name_registration_json(r));
 END IF;

 PERFORM public.r25wf_require(r.id IS NOT NULL,'NOT_FOUND','未找到原开户尝试，请检查本机保存的操作编号');
 IF p ? 'name' THEN
  PERFORM public.r25wf_require(public.r25wf_name_key(p->>'name')=r.name_key,'REGISTRATION_CONFLICT','开户姓名与原尝试不一致');
 END IF;
 -- A possession-authenticated status may discover the canonical role. It never
 -- changes that role; explicit roles and all direct finalizations must match.
 IF (a='finalize' AND r.invite_id IS NULL) OR p ? 'role' THEN
  PERFORM public.r25wf_require(jsonb_typeof(p->'role')='string' AND p->>'role'=r.role,
   'REGISTRATION_CONFLICT','开户身份与原尝试不一致，请恢复原身份');
 END IF;
 IF a='status' THEN
  RETURN jsonb_build_object('ok',true,'data',public.r25wf_name_registration_json(r));
 END IF;
 -- Only trusted provider code may finalize. Public clients cannot execute this
 -- function and cannot select/adopt an existing UID via request fields.
 v_uid:=p->>'providerUid';v_username:=p->>'nativeUsername';v_marker:=p->>'marker';
 PERFORM public.r25wf_require(length(v_uid) BETWEEN 1 AND 128 AND v_username=r.native_username AND v_marker=r.native_marker,
  'NATIVE_IDENTITY_CONFLICT','官方身份确认与原预约不一致');
 IF r.state='ready' THEN
  PERFORM public.r25wf_require(r.uid=v_uid,'NATIVE_IDENTITY_CONFLICT','已完成开户的UID不能更换');
  RETURN jsonb_build_object('ok',true,'data',public.r25wf_name_registration_json(r));
 END IF;
 IF r.invite_id IS NOT NULL THEN
 SELECT * INTO i FROM public.r25wf_invites WHERE id=r.invite_id FOR UPDATE;
 PERFORM public.r25wf_require(i.consumed_by='reserved:'||r.id AND i.role=r.role AND EXISTS(SELECT 1 FROM public.r25wf_users
  WHERE uid=i.created_by AND active AND (role='admin' OR (role='operator' AND r.role='anchor'))),
  'ROLE_BINDING_BLOCKED','邀请码预约或发起权限已变化，未绑定账号角色');
 END IF;
 PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_users WHERE uid=v_uid)
  AND NOT EXISTS(SELECT 1 FROM public.r25wf_native_identities WHERE uid=v_uid OR native_username=v_username),
  'NATIVE_IDENTITY_CONFLICT','该UID或原生用户名已属于既有账号，未覆盖原身份');
 PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_name_aliases WHERE name_key=r.name_key)
  AND NOT EXISTS(SELECT 1 FROM public.r25wf_name_conflicts WHERE name_key=r.name_key),
  'NAME_CONFLICT','姓名映射已变化，未合并其他账号');
 -- Claim the reservation for exactly the verified native UID inside this
 -- transaction before the shared profile trigger runs. Any failure rolls this
 -- claim, profile, alias and final invite consumption back together.
 PERFORM pg_advisory_xact_lock(hashtextextended('r25wf-name-key:'||r.name_key,0));
 UPDATE public.r25wf_name_registrations SET uid=v_uid WHERE id=r.id;
 INSERT INTO public.r25wf_users(uid,role,display_name,active) VALUES(v_uid,r.role,r.display_name,true);
 INSERT INTO public.r25wf_native_identities(uid,native_username) VALUES(v_uid,v_username);
 INSERT INTO public.r25wf_name_aliases(name_key,display_name,uid,source) VALUES(r.name_key,r.display_name,v_uid,'selfserve');
 IF r.invite_id IS NOT NULL THEN
  UPDATE public.r25wf_invites SET consumed_by=v_uid,consumed_at=v_now WHERE id=i.id;
 END IF;
 UPDATE public.r25wf_name_registrations SET uid=v_uid,state='ready',finished_at=v_now WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('ok',true,'data',public.r25wf_name_registration_json(r));
EXCEPTION
 WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code',split_part(SQLERRM,'|',1),'message',split_part(SQLERRM,'|',2)));
 WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','REGISTRATION_CONFLICT','message','姓名、身份或原生账号已由其他尝试预约，请恢复原操作'));
 WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','PROVIDER_UNAVAILABLE','message','身份服务尚未确认完成，请保留原操作后重试'));
END $name_api$;
REVOKE ALL ON FUNCTION public.r25wf_name_identity_service(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.r25wf_name_identity_service(text,jsonb) TO service_role;
COMMENT ON FUNCTION public.r25wf_name_identity_service(text,jsonb) IS 'R25 name identity administrative service only. Native UID is supplied solely by trusted official Auth adapter; browser roles have no execution privilege.';
-- Administrative recovery only: this function is never routed by the public
-- handler. The operator verifies the person and official native account first.
-- Rotate recovery proof with compare-and-swap, preserving the full reservation.
CREATE OR REPLACE FUNCTION public.r25wf_name_recovery_rotate(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $recovery$
DECLARE
 p jsonb:=payload; r public.r25wf_name_registrations;
 v_operation text; v_old text; v_new text;
BEGIN
 PERFORM public.r25wf_require(jsonb_typeof(p)='object' AND octet_length(p::text)<=4096,
  'INVALID_REQUEST','恢复参数无效');
 PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p) k
  WHERE k<>ALL(ARRAY['reservationId','operationId','name','role','expectedProof','newProof'])),
  'INVALID_REQUEST','恢复参数含不支持字段');
 PERFORM public.r25wf_require(jsonb_typeof(p->'reservationId')='string'
  AND jsonb_typeof(p->'operationId')='string' AND jsonb_typeof(p->'name')='string'
  AND jsonb_typeof(p->'role')='string' AND jsonb_typeof(p->'expectedProof')='string'
  AND jsonb_typeof(p->'newProof')='string', 'INVALID_REQUEST','恢复参数不完整');
 v_operation:=p->>'operationId';v_old:=p->>'expectedProof';v_new:=p->>'newProof';
 PERFORM public.r25wf_require(v_operation ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
  AND v_old ~ '^[a-f0-9]{64}$' AND v_new ~ '^[a-f0-9]{64}$' AND v_old<>v_new
  AND p->>'role' IN ('anchor','operator'), 'INVALID_REQUEST','恢复凭据格式无效');
 -- Same lock order as reserve/status/finalize: outstanding finalization either
 -- completes first (and this refuses), or must use the newly rotated proof.
 PERFORM pg_advisory_xact_lock(hashtextextended('r25wf-name-op:'||v_operation,0));
 SELECT * INTO r FROM public.r25wf_name_registrations WHERE operation_id=v_operation FOR UPDATE;
 PERFORM public.r25wf_require(r.id IS NOT NULL,'NOT_FOUND','未找到原预约');
 PERFORM public.r25wf_require(r.state='reserved' AND r.uid IS NULL,
  'RECOVERY_NOT_PENDING','原预约已完成，不得重发注册恢复凭据，请正常登录');
 PERFORM public.r25wf_require(r.invite_id IS NULL AND r.invite_hash IS NULL,
  'RECOVERY_NOT_DIRECT','旧邀请预约需要原邀请恢复流程');
 PERFORM public.r25wf_require(r.id=p->>'reservationId' AND r.display_name=p->>'name'
  AND r.role=p->>'role' AND r.operation_proof=v_old,
  'RECOVERY_STALE','预约与核对快照不一致，请重新核对，未改动任何凭据');
 UPDATE public.r25wf_name_registrations SET operation_proof=v_new WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('rotated',true,
  'reservationId',r.id,'operationId',r.operation_id,'name',r.display_name,'role',r.role));
EXCEPTION WHEN SQLSTATE 'P0001' THEN
 RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code',split_part(SQLERRM,'|',1),'message',split_part(SQLERRM,'|',2)));
END $recovery$;
REVOKE ALL ON FUNCTION public.r25wf_name_recovery_rotate(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.r25wf_name_recovery_rotate(jsonb) TO service_role;
COMMENT ON FUNCTION public.r25wf_name_recovery_rotate(jsonb) IS 'Trusted administrative proof rotation for verified pending direct registrations only. No role, native identity, UID or password mutation. Never expose through HTTP.';
NOTIFY pgrst,'reload schema';
COMMIT;
