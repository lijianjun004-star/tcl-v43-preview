-- R25 isolated persistent PostgreSQL business API. No cloud command is run here.
-- Apply using the existing environment's admin SQL channel, never from a client.
-- Native Auth provides auth.uid() TEXT and auth.role(); no custom password logic.
BEGIN;

CREATE TABLE IF NOT EXISTS public.r25wf_users (
 uid text PRIMARY KEY CHECK(length(uid) BETWEEN 1 AND 128),
 role text NOT NULL CHECK(role IN ('admin','operator','anchor')),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 60),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.r25wf_settings (
 key text PRIMARY KEY, value jsonb NOT NULL
);
INSERT INTO public.r25wf_settings(key,value) VALUES
 ('schema_version','1'),('private_media','{"enabled":false}')
ON CONFLICT(key) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.r25wf_invites (
 id text PRIMARY KEY,
 code_hash text NOT NULL UNIQUE,
 role text NOT NULL CHECK(role IN ('operator','anchor')),
 display_name text NOT NULL DEFAULT '', target_uid text,
 created_by text NOT NULL REFERENCES public.r25wf_users(uid),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 consumed_by text, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.r25wf_assignments (
 id text PRIMARY KEY, operator_uid text NOT NULL REFERENCES public.r25wf_users(uid),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 board_id text NOT NULL CHECK(length(board_id) BETWEEN 1 AND 40),
 platform text NOT NULL CHECK(length(platform) BETWEEN 1 AND 80),
 join_code text NOT NULL UNIQUE, deadline timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.r25wf_joins (
 assignment_id text NOT NULL REFERENCES public.r25wf_assignments(id),
 anchor_uid text NOT NULL REFERENCES public.r25wf_users(uid),
 joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(assignment_id,anchor_uid)
);
CREATE TABLE IF NOT EXISTS public.r25wf_training (
 id text PRIMARY KEY, anchor_uid text NOT NULL REFERENCES public.r25wf_users(uid),
 assignment_id text REFERENCES public.r25wf_assignments(id),
 board_id text NOT NULL CHECK(length(board_id) BETWEEN 1 AND 40),
 platform text NOT NULL CHECK(length(platform) BETWEEN 1 AND 80),
 duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 0 AND 86400),
 finished_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.r25wf_submissions (
 id text PRIMARY KEY, assignment_id text REFERENCES public.r25wf_assignments(id),
 operator_uid text NOT NULL REFERENCES public.r25wf_users(uid),
 anchor_uid text NOT NULL REFERENCES public.r25wf_users(uid),
 session_id text NOT NULL CHECK(length(session_id) BETWEEN 1 AND 128),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 media jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(media)='array'),
 submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(), late boolean NOT NULL DEFAULT false,
 UNIQUE(anchor_uid,session_id)
);
-- A separate unique path index table prevents two different actors/operations
-- from binding one object to distinct immutable submissions in concurrent calls.
CREATE TABLE IF NOT EXISTS public.r25wf_submission_media (
 object_path text PRIMARY KEY,
 submission_id text NOT NULL REFERENCES public.r25wf_submissions(id),
 owner_uid text NOT NULL REFERENCES public.r25wf_users(uid),
 mime text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 52428800),
 client_sha256 text
);
CREATE TABLE IF NOT EXISTS public.r25wf_feedback (
 id text PRIMARY KEY, submission_id text NOT NULL REFERENCES public.r25wf_submissions(id),
 operator_uid text NOT NULL REFERENCES public.r25wf_users(uid),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.r25wf_idempotency (
 actor_uid text NOT NULL, action text NOT NULL, operation_id text NOT NULL,
 request_body jsonb NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_uid,action,operation_id)
);
CREATE TABLE IF NOT EXISTS public.r25wf_rate_limits (
 actor_uid text NOT NULL, action text NOT NULL, window_start timestamptz NOT NULL,
 attempts integer NOT NULL, PRIMARY KEY(actor_uid,action,window_start)
);
CREATE INDEX IF NOT EXISTS r25wf_assignments_operator_idx ON public.r25wf_assignments(operator_uid,id);
CREATE INDEX IF NOT EXISTS r25wf_joins_anchor_idx ON public.r25wf_joins(anchor_uid,assignment_id);
CREATE INDEX IF NOT EXISTS r25wf_submissions_operator_idx ON public.r25wf_submissions(operator_uid,id);
CREATE INDEX IF NOT EXISTS r25wf_submissions_anchor_idx ON public.r25wf_submissions(anchor_uid,id);
CREATE INDEX IF NOT EXISTS r25wf_submissions_assignment_idx ON public.r25wf_submissions(assignment_id,id);
CREATE INDEX IF NOT EXISTS r25wf_feedback_submission_idx ON public.r25wf_feedback(submission_id,id);

DO $r25wf_rls$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['users','settings','invites','assignments','joins','training','submissions','submission_media','feedback','idempotency','rate_limits'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY','r25wf_'||n);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated','r25wf_'||n);
 END LOOP;
END
$r25wf_rls$;

CREATE OR REPLACE FUNCTION public.r25wf_require(ok boolean, code text, message text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE=code||'|'||message;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.r25wf_require(boolean,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.r25wf_profile(u public.r25wf_users)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('uid',u.uid,'id',u.uid,'role',u.role,'displayName',u.display_name,'username',u.uid,'active',u.active)
$$;
REVOKE ALL ON FUNCTION public.r25wf_profile(public.r25wf_users) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.r25wf_assignment_json(a public.r25wf_assignments)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',a.id,'operatorUid',a.operator_uid,'operatorId',a.operator_uid,
 'operatorName',(SELECT u.display_name FROM public.r25wf_users u WHERE u.uid=a.operator_uid),
 'title',a.title,'boardId',a.board_id,'platform',a.platform,'joinCode',a.join_code,'deadline',a.deadline,'createdAt',a.created_at)
$$;
REVOKE ALL ON FUNCTION public.r25wf_assignment_json(public.r25wf_assignments) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.r25wf_submission_json(s public.r25wf_submissions, full_snapshot boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',s.id,'assignmentId',s.assignment_id,'operatorUid',s.operator_uid,'operatorId',s.operator_uid,
 'operatorName',(SELECT u.display_name FROM public.r25wf_users u WHERE u.uid=s.operator_uid),
 'anchorUid',s.anchor_uid,'anchorName',(SELECT u.display_name FROM public.r25wf_users u WHERE u.uid=s.anchor_uid),
 'sessionId',s.session_id,'snapshot',CASE WHEN full_snapshot THEN s.snapshot ELSE NULL END,
 'turnCount',jsonb_array_length(s.snapshot->'turns'),'media',s.media,'submittedAt',s.submitted_at,'late',s.late)
$$;
REVOKE ALL ON FUNCTION public.r25wf_submission_json(public.r25wf_submissions,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.r25wf_feedback_json(f public.r25wf_feedback)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',f.id,'submissionId',f.submission_id,'operatorUid',f.operator_uid,
 'operatorName',(SELECT u.display_name FROM public.r25wf_users u WHERE u.uid=f.operator_uid),'body',f.body,'createdAt',f.created_at)
$$;
REVOKE ALL ON FUNCTION public.r25wf_feedback_json(public.r25wf_feedback) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.r25wf_training_json(t public.r25wf_training)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',t.id,'anchorUid',t.anchor_uid,'assignmentId',t.assignment_id,
 'boardId',t.board_id,'platform',t.platform,'durationSeconds',t.duration_seconds,'finishedAt',t.finished_at)
$$;
REVOKE ALL ON FUNCTION public.r25wf_training_json(public.r25wf_training) FROM PUBLIC,anon,authenticated;

-- Called only as a policy predicate. It is intentionally the one helper with
-- authenticated EXECUTE: direct invocation reveals only a boolean for that user.
CREATE OR REPLACE FUNCTION public.r25wf_can_read_media(path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE actor text; u public.r25wf_users;
BEGIN
 actor:=auth.uid()::text;
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR actor='' OR length(path)>512
    OR path IS NULL OR path ~ '(^|/)\.\.(/|$)' THEN RETURN false; END IF;
 SELECT * INTO u FROM public.r25wf_users WHERE uid=actor AND active;
 IF NOT FOUND THEN RETURN false; END IF;
 IF split_part(path,'/',1)=actor AND length(split_part(path,'/',2))>0 THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public.r25wf_submission_media m
  JOIN public.r25wf_submissions s ON s.id=m.submission_id
  WHERE m.object_path=path AND (s.anchor_uid=actor OR s.operator_uid=actor OR u.role='admin'));
END $$;
REVOKE ALL ON FUNCTION public.r25wf_can_read_media(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.r25wf_can_read_media(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.r25wf_immutable_submission()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONFLICT|已提交内容不可修改或删除'; END $$;
REVOKE ALL ON FUNCTION public.r25wf_immutable_submission() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS r25wf_submission_immutable ON public.r25wf_submissions;
CREATE TRIGGER r25wf_submission_immutable BEFORE UPDATE OR DELETE ON public.r25wf_submissions
 FOR EACH ROW EXECUTE FUNCTION public.r25wf_immutable_submission();

CREATE OR REPLACE FUNCTION public.r25wf_api(action text, payload jsonb DEFAULT '{}'::jsonb, operation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $r25wf_api$
DECLARE
 v_actor text; v_user public.r25wf_users; v_action text; v_write boolean;
 v_payload jsonb; v_op text; v_prior public.r25wf_idempotency;
 v_data jsonb; v_response jsonb; v_items jsonb; v_next text;
 v_id text; v_assignment_id text; v_operator text; v_session text; v_code text;
 v_limit integer:=50; v_cursor text; v_query text:=''; v_now timestamptz:=clock_timestamp();
 v_assignment public.r25wf_assignments; v_join public.r25wf_joins;
 v_invite public.r25wf_invites; v_submission public.r25wf_submissions;
 v_feedback public.r25wf_feedback; v_training public.r25wf_training;
 v_snapshot jsonb; v_turn jsonb; v_media jsonb; v_item jsonb;
 v_path text; v_mime text; v_size bigint; v_meta jsonb; v_owner text;
 v_attempts integer; v_window timestamptz; v_display text; v_role text;
 v_deadline timestamptz; v_enabled boolean:=false; v_count integer; v_duration integer;
BEGIN
 v_actor:=auth.uid()::text;
 PERFORM public.r25wf_require(auth.role()='authenticated' AND v_actor IS NOT NULL AND length(v_actor) BETWEEN 1 AND 128,
  'AUTH_REQUIRED','请使用正式账号登录');
 PERFORM public.r25wf_require(action IS NOT NULL AND length(action) BETWEEN 1 AND 60,'INVALID_PAYLOAD','缺少有效操作');
 v_action:=CASE action WHEN 'invites.accept' THEN 'invites.redeem' WHEN 'bootstrap' THEN 'me' ELSE action END;
 v_payload:=coalesce(payload,'{}'::jsonb);
 PERFORM public.r25wf_require(jsonb_typeof(v_payload)='object','INVALID_PAYLOAD','payload必须为对象');
 PERFORM public.r25wf_require(octet_length(v_payload::text)<=524288,'LIMIT_EXCEEDED','请求内容超过512KiB');
 SELECT * INTO v_user FROM public.r25wf_users WHERE uid=v_actor;
 IF FOUND THEN PERFORM public.r25wf_require(v_user.active,'ACCOUNT_DISABLED','账号已停用，请联系管理员'); END IF;
 SELECT coalesce((value->>'enabled')::boolean,false) INTO v_enabled FROM public.r25wf_settings WHERE key='private_media';
 v_enabled:=coalesce(v_enabled,false);
 IF v_action='me' THEN
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('registered',v_user.uid IS NOT NULL,
   'user',CASE WHEN v_user.uid IS NULL THEN jsonb_build_object('uid',v_actor,'id',v_actor,'role','pending','displayName','','username',v_actor,'active',true)
       ELSE public.r25wf_profile(v_user) END,
   'capabilities',jsonb_build_object('schemaVersion',1,'assignments',true,'submissions',true,'feedback',true,
     'privateMedia',v_enabled,'mediaBucket','r25wf-private','maxMediaFiles',3,'maxMediaBytes',52428800,
     'questionBank',false,'questionMetadataV2',false)));
 END IF;
 PERFORM public.r25wf_require(v_user.uid IS NOT NULL OR v_action='invites.redeem','NOT_REGISTERED','请先绑定管理员提供的角色邀请');
 v_write:=v_action=ANY(ARRAY['invites.create','invites.redeem','assignments.create','assignments.join','training.record','submissions.create','feedback.create']);
 IF v_write THEN
  v_op:=operation_id;
  PERFORM public.r25wf_require(v_op IS NOT NULL AND v_op ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$',
   'OPERATION_ID_REQUIRED','写操作需要稳定的operation_id');
  -- Persistent idempotency plus a per-actor transaction lock serialize retries.
  PERFORM pg_advisory_xact_lock(hashtextextended('r25wf:'||v_actor,0));
  SELECT * INTO v_prior FROM public.r25wf_idempotency i
   WHERE i.actor_uid=v_actor AND i.action=v_action AND i.operation_id=v_op;
  IF FOUND THEN
   PERFORM public.r25wf_require(v_prior.request_body=v_payload,'IDEMPOTENCY_CONFLICT','同一operation_id不能提交不同内容');
   RETURN v_prior.response;
  END IF;
 END IF;
 IF v_payload ? 'limit' THEN
  PERFORM public.r25wf_require(jsonb_typeof(v_payload->'limit')='number' AND (v_payload->>'limit') ~ '^[0-9]{1,3}$',
   'INVALID_PAYLOAD','limit必须为1至100整数');
  v_limit:=(v_payload->>'limit')::integer;
  PERFORM public.r25wf_require(v_limit BETWEEN 1 AND 100,'INVALID_PAYLOAD','limit必须为1至100整数');
 END IF;
 v_cursor:=nullif(v_payload->>'cursor','');
 PERFORM public.r25wf_require(v_cursor IS NULL OR length(v_cursor)<=128,'INVALID_PAYLOAD','游标无效');

 CASE v_action
 WHEN 'operators.list' THEN
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.uid),'[]') INTO v_items FROM
   (SELECT u.uid,public.r25wf_profile(u) AS j FROM public.r25wf_users u
    WHERE active AND role IN ('operator','admin') AND (v_cursor IS NULL OR u.uid>v_cursor)
    ORDER BY u.uid LIMIT v_limit) x;
  v_next:=CASE WHEN jsonb_array_length(v_items)=v_limit THEN v_items->(v_limit-1)->>'uid' ELSE NULL END;
  v_data:=jsonb_build_object('items',v_items,'nextCursor',v_next);

 WHEN 'invites.create' THEN
  PERFORM public.r25wf_require(v_user.role IN ('admin','operator'),'FORBIDDEN','仅管理员或运营可以创建邀请');
  v_role:=v_payload->>'role';
  PERFORM public.r25wf_require(v_role IN ('operator','anchor') AND (v_user.role='admin' OR v_role='anchor'),
   'FORBIDDEN','此账号不能邀请该角色');
  v_display:=btrim(coalesce(v_payload->>'displayName',''));
  PERFORM public.r25wf_require(length(v_display)<=60,'FIELD_TOO_LONG','显示姓名最多60字');
  PERFORM public.r25wf_require(length(coalesce(v_payload->>'targetUid',''))<=128,'FIELD_TOO_LONG','目标用户ID过长');
  PERFORM public.r25wf_require(NOT (v_payload ? 'expiresHours') OR (v_payload->>'expiresHours') ~ '^[0-9]{1,3}$',
   'INVALID_PAYLOAD','邀请有效小时必须为整数');
  v_count:=coalesce((v_payload->>'expiresHours')::integer,48);
  PERFORM public.r25wf_require(v_count BETWEEN 1 AND 168,'INVALID_PAYLOAD','邀请有效期须1至168小时');
  v_window:=date_trunc('hour',v_now);
  INSERT INTO public.r25wf_rate_limits AS r(actor_uid,action,window_start,attempts) VALUES(v_actor,v_action,v_window,1)
   ON CONFLICT ON CONSTRAINT r25wf_rate_limits_pkey DO UPDATE SET attempts=r.attempts+1 RETURNING attempts INTO v_attempts;
  IF v_attempts>50 THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','RATE_LIMITED','message','创建邀请过于频繁，请稍后再试')); END IF;
  v_code:=replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.r25wf_invites(id,code_hash,role,display_name,target_uid,created_by,expires_at)
   VALUES(gen_random_uuid()::text,md5(v_code),v_role,v_display,nullif(v_payload->>'targetUid',''),v_actor,v_now+make_interval(hours=>v_count)) RETURNING * INTO v_invite;
  v_data:=jsonb_build_object('invite',jsonb_build_object('id',v_invite.id,'code',v_code,'role',v_invite.role,
    'targetUid',v_invite.target_uid,'displayName',v_invite.display_name,'expiresAt',v_invite.expires_at));

 WHEN 'invites.redeem' THEN
  v_code:=lower(btrim(coalesce(v_payload->>'code','')));
  PERFORM public.r25wf_require(length(v_code) BETWEEN 12 AND 64,'INVALID_INVITE','邀请无效');
  v_window:=date_trunc('hour',v_now);
  INSERT INTO public.r25wf_rate_limits AS r(actor_uid,action,window_start,attempts) VALUES(v_actor,v_action,v_window,1)
   ON CONFLICT ON CONSTRAINT r25wf_rate_limits_pkey DO UPDATE SET attempts=r.attempts+1 RETURNING attempts INTO v_attempts;
  IF v_attempts>20 THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','RATE_LIMITED','message','绑定尝试过于频繁，请稍后再试')); END IF;
  SELECT * INTO v_invite FROM public.r25wf_invites WHERE code_hash=md5(v_code) FOR UPDATE;
  IF NOT FOUND OR (v_invite.target_uid IS NOT NULL AND v_invite.target_uid<>v_actor) THEN
   RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_INVITE','message','邀请无效或不属于当前账号'));
  END IF;
  PERFORM public.r25wf_require(v_user.uid IS NULL,'ALREADY_REGISTERED','账号已绑定角色，不能用邀请更换权限');
  PERFORM public.r25wf_require(v_invite.consumed_by IS NULL,'INVALID_INVITE','邀请已被使用');
  PERFORM public.r25wf_require(v_invite.expires_at>v_now,'INVITE_EXPIRED','邀请已过期');
  -- A disabled inviter cannot grant new access with an old unused invitation.
  PERFORM public.r25wf_require(EXISTS(SELECT 1 FROM public.r25wf_users WHERE uid=v_invite.created_by AND active
   AND (role='admin' OR (role='operator' AND v_invite.role='anchor'))),'INVALID_INVITE','邀请发起账号不再有效');
  v_display:=coalesce(nullif(btrim(v_payload->>'displayName'),''),nullif(v_invite.display_name,''),'用户'||right(v_actor,6));
  PERFORM public.r25wf_require(length(v_display) BETWEEN 1 AND 60,'FIELD_TOO_LONG','显示姓名须1至60字');
  INSERT INTO public.r25wf_users(uid,role,display_name) VALUES(v_actor,v_invite.role,v_display) RETURNING * INTO v_user;
  UPDATE public.r25wf_invites SET consumed_by=v_actor,consumed_at=v_now WHERE id=v_invite.id;
  v_data:=jsonb_build_object('user',public.r25wf_profile(v_user),'registered',true);

 WHEN 'assignments.create' THEN
  PERFORM public.r25wf_require(v_user.role IN ('operator','admin'),'FORBIDDEN','仅运营可以发布作业');
  v_id:=coalesce(nullif(v_payload->>'id',''),gen_random_uuid()::text);
  PERFORM public.r25wf_require(v_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$','INVALID_PAYLOAD','作业ID无效');
  PERFORM public.r25wf_require(length(btrim(coalesce(v_payload->>'title',''))) BETWEEN 1 AND 120,'INVALID_PAYLOAD','作业名称须1至120字');
  PERFORM public.r25wf_require(length(btrim(coalesce(v_payload->>'boardId',''))) BETWEEN 1 AND 40,'INVALID_PAYLOAD','训练板块须1至40字');
  PERFORM public.r25wf_require(length(btrim(coalesce(v_payload->>'platform',''))) BETWEEN 1 AND 80,'INVALID_PAYLOAD','平台须1至80字');
  IF nullif(v_payload->>'deadline','') IS NOT NULL THEN
   BEGIN v_deadline:=(v_payload->>'deadline')::timestamptz;
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_PAYLOAD|截止时间无效'; END;
   PERFORM public.r25wf_require(isfinite(v_deadline) AND v_deadline>v_now AND v_deadline<v_now+interval '366 days',
    'INVALID_PAYLOAD','截止时间须为未来一年内');
  END IF;
  INSERT INTO public.r25wf_assignments(id,operator_uid,title,board_id,platform,join_code,deadline)
   VALUES(v_id,v_actor,btrim(v_payload->>'title'),btrim(v_payload->>'boardId'),btrim(v_payload->>'platform'),
    substr(replace(gen_random_uuid()::text,'-',''),1,12),v_deadline) RETURNING * INTO v_assignment;
  v_data:=jsonb_build_object('assignment',public.r25wf_assignment_json(v_assignment));

 WHEN 'assignments.list' THEN
  v_query:=btrim(coalesce(v_payload->>'query',''));
  PERFORM public.r25wf_require(length(v_query)<=120,'FIELD_TOO_LONG','查询条件最多120字');
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.id),'[]') INTO v_items FROM
   (SELECT a.id,public.r25wf_assignment_json(a) AS j FROM public.r25wf_assignments a
    WHERE (v_user.role='admin' OR (v_user.role='operator' AND a.operator_uid=v_actor)
     OR (v_user.role='anchor' AND EXISTS(SELECT 1 FROM public.r25wf_joins j WHERE j.assignment_id=a.id AND j.anchor_uid=v_actor)))
    AND (v_cursor IS NULL OR a.id>v_cursor)
    AND (v_query='' OR strpos(lower(a.title||' '||a.platform),lower(v_query))>0)
    ORDER BY a.id LIMIT v_limit) x;
  v_next:=CASE WHEN jsonb_array_length(v_items)=v_limit THEN v_items->(v_limit-1)->>'id' ELSE NULL END;
  v_data:=jsonb_build_object('items',v_items,'nextCursor',v_next);

 WHEN 'assignments.join' THEN
  PERFORM public.r25wf_require(v_user.role='anchor','FORBIDDEN','仅主播可以加入训练作业');
  v_code:=lower(btrim(coalesce(v_payload->>'joinCode','')));
  IF v_code<>'' THEN
   PERFORM public.r25wf_require(length(v_code)<=64,'INVALID_PAYLOAD','作业码无效');
   SELECT * INTO v_assignment FROM public.r25wf_assignments WHERE join_code=v_code;
  ELSE
   SELECT a.* INTO v_assignment FROM public.r25wf_assignments a JOIN public.r25wf_joins j ON j.assignment_id=a.id
    WHERE a.id=v_payload->>'assignmentId' AND j.anchor_uid=v_actor;
  END IF;
  PERFORM public.r25wf_require(v_assignment.id IS NOT NULL,'NOT_FOUND','作业码无效或作业不存在');
  SELECT * INTO v_join FROM public.r25wf_joins WHERE assignment_id=v_assignment.id AND anchor_uid=v_actor;
  IF NOT FOUND THEN
   PERFORM public.r25wf_require(v_assignment.deadline IS NULL OR v_assignment.deadline>v_now,'ASSIGNMENT_CLOSED','作业已截止，不能新加入');
   INSERT INTO public.r25wf_joins(assignment_id,anchor_uid) VALUES(v_assignment.id,v_actor) RETURNING * INTO v_join;
  END IF;
  v_data:=jsonb_build_object('join',jsonb_build_object('assignmentId',v_join.assignment_id,'anchorUid',v_join.anchor_uid,'joinedAt',v_join.joined_at),
   'assignment',public.r25wf_assignment_json(v_assignment));

 WHEN 'assignments.progress' THEN
  SELECT * INTO v_assignment FROM public.r25wf_assignments WHERE id=v_payload->>'assignmentId';
  PERFORM public.r25wf_require(v_assignment.id IS NOT NULL,'NOT_FOUND','作业不存在');
  PERFORM public.r25wf_require(v_user.role='admin' OR (v_user.role='operator' AND v_assignment.operator_uid=v_actor),
   'FORBIDDEN','无权读取该作业进度');
  SELECT coalesce(jsonb_agg(jsonb_build_object('anchorUid',j.anchor_uid,'displayName',u.display_name,'joinedAt',j.joined_at,
   'trainingCount',(SELECT count(*) FROM public.r25wf_training t WHERE t.assignment_id=j.assignment_id AND t.anchor_uid=j.anchor_uid),
   'submissionCount',(SELECT count(*) FROM public.r25wf_submissions s WHERE s.assignment_id=j.assignment_id AND s.anchor_uid=j.anchor_uid),
   'lastTrainedAt',(SELECT max(t.finished_at) FROM public.r25wf_training t WHERE t.assignment_id=j.assignment_id AND t.anchor_uid=j.anchor_uid))
   ORDER BY j.anchor_uid),'[]') INTO v_items FROM public.r25wf_joins j JOIN public.r25wf_users u ON u.uid=j.anchor_uid
   WHERE j.assignment_id=v_assignment.id;
  v_data:=jsonb_build_object('assignment',public.r25wf_assignment_json(v_assignment),'items',v_items);

 WHEN 'training.record' THEN
  PERFORM public.r25wf_require(v_user.role='anchor','FORBIDDEN','仅主播可以记录练习');
  v_id:=v_payload->>'id';
  PERFORM public.r25wf_require(v_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$','INVALID_PAYLOAD','训练记录ID无效');
  v_assignment_id:=nullif(v_payload->>'assignmentId','');
  IF v_assignment_id IS NOT NULL THEN
   SELECT * INTO v_assignment FROM public.r25wf_assignments WHERE id=v_assignment_id;
   PERFORM public.r25wf_require(v_assignment.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.r25wf_joins
    WHERE assignment_id=v_assignment_id AND anchor_uid=v_actor),'NOT_JOINED','请先加入该作业');
   PERFORM public.r25wf_require(v_payload->>'boardId'=v_assignment.board_id AND v_payload->>'platform'=v_assignment.platform,
    'INVALID_PAYLOAD','训练板块与作业不一致');
  END IF;
  PERFORM public.r25wf_require(length(coalesce(v_payload->>'boardId','')) BETWEEN 1 AND 40 AND length(coalesce(v_payload->>'platform','')) BETWEEN 1 AND 80,
   'INVALID_PAYLOAD','板块或平台无效');
  PERFORM public.r25wf_require(NOT(v_payload ? 'durationSeconds') OR (v_payload->>'durationSeconds') ~ '^[0-9]{1,5}$',
   'INVALID_PAYLOAD','练习时长须为整数');
  v_duration:=coalesce((v_payload->>'durationSeconds')::integer,0);
  PERFORM public.r25wf_require(v_duration BETWEEN 0 AND 86400,'LIMIT_EXCEEDED','练习时长超过上限');
  INSERT INTO public.r25wf_training(id,anchor_uid,assignment_id,board_id,platform,duration_seconds)
   VALUES(v_id,v_actor,v_assignment_id,v_payload->>'boardId',v_payload->>'platform',v_duration) RETURNING * INTO v_training;
  v_data:=jsonb_build_object('training',public.r25wf_training_json(v_training));

 WHEN 'training.list' THEN
  PERFORM public.r25wf_require(v_user.role IN ('anchor','admin'),'FORBIDDEN','无权读取私人练习记录');
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.id),'[]') INTO v_items FROM
   (SELECT t.id,public.r25wf_training_json(t) AS j FROM public.r25wf_training t
    WHERE (t.anchor_uid=v_actor OR v_user.role='admin') AND (v_cursor IS NULL OR t.id>v_cursor)
    ORDER BY t.id LIMIT v_limit) x;
  v_next:=CASE WHEN jsonb_array_length(v_items)=v_limit THEN v_items->(v_limit-1)->>'id' ELSE NULL END;
  v_data:=jsonb_build_object('items',v_items,'nextCursor',v_next);

 WHEN 'submissions.create' THEN
  PERFORM public.r25wf_require(v_user.role='anchor','FORBIDDEN','仅主播可以提交自己的训练');
  v_id:=v_payload->>'id';
  PERFORM public.r25wf_require(v_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$','INVALID_PAYLOAD','提交ID无效');
  v_assignment_id:=nullif(v_payload->>'assignmentId','');
  v_operator:=coalesce(nullif(v_payload->>'operatorId',''),nullif(v_payload->>'operatorUid',''));
  IF v_assignment_id IS NOT NULL THEN
   SELECT * INTO v_assignment FROM public.r25wf_assignments WHERE id=v_assignment_id;
   PERFORM public.r25wf_require(v_assignment.id IS NOT NULL,'NOT_FOUND','作业不存在');
   PERFORM public.r25wf_require(EXISTS(SELECT 1 FROM public.r25wf_joins WHERE assignment_id=v_assignment_id AND anchor_uid=v_actor),
    'NOT_JOINED','请先加入该作业');
   PERFORM public.r25wf_require(v_operator IS NULL OR v_operator=v_assignment.operator_uid,'FORBIDDEN','接收运营必须是该作业发布者');
   v_operator:=v_assignment.operator_uid;
  END IF;
  PERFORM public.r25wf_require(EXISTS(SELECT 1 FROM public.r25wf_users WHERE uid=v_operator AND active AND role IN ('operator','admin')),
   'INVALID_PAYLOAD','请选择有效的接收运营');
  v_session:=coalesce(nullif(v_payload->>'sessionId',''),v_id);
  PERFORM public.r25wf_require(length(v_session) BETWEEN 1 AND 128,'INVALID_PAYLOAD','场次ID无效');
  v_snapshot:=v_payload->'snapshot';
  PERFORM public.r25wf_require(jsonb_typeof(v_snapshot)='object' AND octet_length(v_snapshot::text)<=393216,
   'LIMIT_EXCEEDED','提交快照须为不超过384KiB的对象');
  PERFORM public.r25wf_require(jsonb_typeof(v_snapshot->'turns')='array','INVALID_PAYLOAD','快照缺少逐题记录');
  PERFORM public.r25wf_require(jsonb_array_length(v_snapshot->'turns') BETWEEN 1 AND 200,'LIMIT_EXCEEDED','每场须1至200题');
  IF v_assignment_id IS NOT NULL THEN
   PERFORM public.r25wf_require((NOT(v_snapshot ? 'boardId') OR v_snapshot->>'boardId'=v_assignment.board_id)
    AND (NOT(v_snapshot ? 'platform') OR v_snapshot->>'platform'=v_assignment.platform),
    'INVALID_PAYLOAD','提交板块与作业不一致');
  END IF;
  FOR v_turn IN SELECT value FROM jsonb_array_elements(v_snapshot->'turns') LOOP
   PERFORM public.r25wf_require(jsonb_typeof(v_turn)='object' AND octet_length(v_turn::text)<=32768,'LIMIT_EXCEEDED','每题须为不超过32KiB的对象');
   PERFORM public.r25wf_require(NOT(v_turn ? 'answer') OR (jsonb_typeof(v_turn->'answer')='string' AND length(v_turn->>'answer')<=12000),
    'INVALID_PAYLOAD','回答须为不超过12000字的文字');
   PERFORM public.r25wf_require(NOT(v_turn ? 'transcript') OR (jsonb_typeof(v_turn->'transcript')='string' AND length(v_turn->>'transcript')<=12000),
    'INVALID_PAYLOAD','转写须为不超过12000字的文字');
   PERFORM public.r25wf_require(NOT(v_turn ? 'prompt') OR (jsonb_typeof(v_turn->'prompt')='string' AND length(v_turn->>'prompt')<=8000),
    'INVALID_PAYLOAD','问题须为不超过8000字的文字');
  END LOOP;
  v_media:=coalesce(v_payload->'media','[]'::jsonb);
  PERFORM public.r25wf_require(jsonb_typeof(v_media)='array','MEDIA_INVALID','附件清单须为数组');
  PERFORM public.r25wf_require(jsonb_array_length(v_media)<=3,'LIMIT_EXCEEDED','每次提交最多3个附件');
  IF jsonb_array_length(v_media)>0 THEN
   PERFORM public.r25wf_require(v_enabled,'MEDIA_NOT_AVAILABLE','私有媒体尚未启用，请明确选择仅交文字或稍后重试');
   FOR v_item IN SELECT value FROM jsonb_array_elements(v_media) LOOP
    PERFORM public.r25wf_require(jsonb_typeof(v_item)='object','MEDIA_INVALID','附件格式无效');
    v_path:=v_item->>'path'; v_mime:=split_part(lower(v_item->>'mime'),';',1);
    PERFORM public.r25wf_require(length(v_path) BETWEEN 3 AND 512 AND split_part(v_path,'/',1)=v_actor
     AND length(split_part(v_path,'/',2))>0 AND v_path !~ '(^|/)\.\.(/|$)', 'MEDIA_INVALID','附件路径不属于本人');
    PERFORM public.r25wf_require((v_item->>'size') ~ '^[0-9]{1,8}$','MEDIA_INVALID','附件大小无效');
    v_size:=(v_item->>'size')::bigint;
    PERFORM public.r25wf_require(v_size BETWEEN 1 AND 52428800,'LIMIT_EXCEEDED','单个附件须1B至50MiB');
    PERFORM public.r25wf_require(v_mime=ANY(ARRAY['audio/webm','video/webm','audio/mp4','video/mp4','audio/ogg','video/ogg',
     'audio/wav','audio/x-wav','audio/mpeg','audio/aac','audio/x-m4a','video/quicktime']),'MEDIA_INVALID','不支持该音视频格式');
    PERFORM public.r25wf_require(NOT(v_item ? 'sha256') OR coalesce(v_item->>'sha256','') ~ '^[a-fA-F0-9]{64}$','MEDIA_INVALID','附件声明哈希无效');
    -- Storage API sets these metadata/owner values. Never trust client size alone.
    SELECT metadata,owner_id INTO v_meta,v_owner FROM storage.objects WHERE bucket_id='r25wf-private' AND name=v_path;
    PERFORM public.r25wf_require(v_meta IS NOT NULL AND v_owner=v_actor,'MEDIA_INVALID','附件尚未上传或不属于本人');
    PERFORM public.r25wf_require((v_meta->>'size') ~ '^[0-9]{1,8}$','MEDIA_INVALID','云端附件大小未确认');
    PERFORM public.r25wf_require((v_meta->>'size')::bigint=v_size AND split_part(lower(v_meta->>'mimetype'),';',1)=v_mime,
     'MEDIA_INVALID','附件大小或格式与云端对象不一致');
    PERFORM public.r25wf_require(NOT EXISTS(SELECT 1 FROM public.r25wf_submission_media WHERE object_path=v_path),
     'MEDIA_ALREADY_ATTACHED','该附件已绑定其他提交，不能重复使用');
   END LOOP;
   PERFORM public.r25wf_require((SELECT count(DISTINCT x->>'path') FROM jsonb_array_elements(v_media) x)=jsonb_array_length(v_media),
    'MEDIA_INVALID','附件清单存在重复对象');
  END IF;
  INSERT INTO public.r25wf_submissions(id,assignment_id,operator_uid,anchor_uid,session_id,snapshot,media,late)
   VALUES(v_id,v_assignment_id,v_operator,v_actor,v_session,v_snapshot,v_media,
    v_assignment_id IS NOT NULL AND v_assignment.deadline IS NOT NULL AND v_now>v_assignment.deadline) RETURNING * INTO v_submission;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_media) LOOP
   INSERT INTO public.r25wf_submission_media(object_path,submission_id,owner_uid,mime,size_bytes,client_sha256)
    VALUES(v_item->>'path',v_id,v_actor,split_part(lower(v_item->>'mime'),';',1),(v_item->>'size')::bigint,v_item->>'sha256');
  END LOOP;
  v_data:=jsonb_build_object('receiptId',v_id,'submission',public.r25wf_submission_json(v_submission,true));

 WHEN 'submissions.list' THEN
  v_assignment_id:=nullif(v_payload->>'assignmentId','');
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.id),'[]') INTO v_items FROM
   (SELECT s.id,public.r25wf_submission_json(s,false) AS j FROM public.r25wf_submissions s
    WHERE (v_user.role='admin' OR (v_user.role='operator' AND s.operator_uid=v_actor) OR (v_user.role='anchor' AND s.anchor_uid=v_actor))
     AND (v_assignment_id IS NULL OR s.assignment_id=v_assignment_id) AND (v_cursor IS NULL OR s.id>v_cursor)
    ORDER BY s.id LIMIT v_limit) x;
  v_next:=CASE WHEN jsonb_array_length(v_items)=v_limit THEN v_items->(v_limit-1)->>'id' ELSE NULL END;
  v_data:=jsonb_build_object('items',v_items,'nextCursor',v_next);

 WHEN 'submissions.get','feedback.list','feedback.create' THEN
  v_id:=coalesce(nullif(v_payload->>'submissionId',''),nullif(v_payload->>'id',''));
  SELECT * INTO v_submission FROM public.r25wf_submissions WHERE id=v_id;
  PERFORM public.r25wf_require(v_submission.id IS NOT NULL,'NOT_FOUND','提交不存在');
  PERFORM public.r25wf_require(v_user.role='admin' OR v_submission.operator_uid=v_actor OR v_submission.anchor_uid=v_actor,
   'FORBIDDEN','无权读取其他人的提交或反馈');
  IF v_action='submissions.get' THEN
   v_data:=jsonb_build_object('submission',public.r25wf_submission_json(v_submission,true));
  ELSIF v_action='feedback.list' THEN
   SELECT coalesce(jsonb_agg(x.j ORDER BY x.id),'[]') INTO v_items FROM
    (SELECT f.id,public.r25wf_feedback_json(f) AS j FROM public.r25wf_feedback f
     WHERE f.submission_id=v_submission.id AND (v_cursor IS NULL OR f.id>v_cursor) ORDER BY f.id LIMIT v_limit) x;
   v_next:=CASE WHEN jsonb_array_length(v_items)=v_limit THEN v_items->(v_limit-1)->>'id' ELSE NULL END;
   v_data:=jsonb_build_object('items',v_items,'nextCursor',v_next);
  ELSE
   PERFORM public.r25wf_require(v_user.role='admin' OR (v_user.role='operator' AND v_submission.operator_uid=v_actor),
    'FORBIDDEN','仅接收运营可以写反馈');
   v_id:=coalesce(nullif(v_payload->>'id',''),gen_random_uuid()::text);
   PERFORM public.r25wf_require(v_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$','INVALID_PAYLOAD','反馈ID无效');
   PERFORM public.r25wf_require(jsonb_typeof(v_payload->'body')='string' AND length(btrim(v_payload->>'body')) BETWEEN 1 AND 5000,
    'INVALID_PAYLOAD','反馈须1至5000字');
   INSERT INTO public.r25wf_feedback(id,submission_id,operator_uid,body) VALUES(v_id,v_submission.id,v_actor,btrim(v_payload->>'body')) RETURNING * INTO v_feedback;
   v_data:=jsonb_build_object('feedback',public.r25wf_feedback_json(v_feedback));
  END IF;

 ELSE
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_ACTION|不支持该操作';
 END CASE;
 v_response:=jsonb_build_object('ok',true,'data',v_data);
 IF v_write THEN
  INSERT INTO public.r25wf_idempotency(actor_uid,action,operation_id,request_body,response)
   VALUES(v_actor,v_action,v_op,v_payload,v_response);
 END IF;
 RETURN v_response;
EXCEPTION
 WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code',split_part(SQLERRM,'|',1),'message',split_part(SQLERRM,'|',2)));
 WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','CONFLICT','message','记录已存在或同一场次已提交，请查询云端后重试原操作'));
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_PAYLOAD','message','字段格式或数值无效'));
 WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INTERNAL_ERROR','message','云端未确认完成，请保留本机内容并重试原操作'));
END
$r25wf_api$;
REVOKE ALL ON FUNCTION public.r25wf_api(text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.r25wf_api(text,jsonb,text) TO authenticated;
COMMENT ON FUNCTION public.r25wf_api(text,jsonb,text) IS 'R25 isolated native-auth workflow API v1; actor always auth.uid(); operation_id required for writes';
NOTIFY pgrst, 'reload schema';
COMMIT;
