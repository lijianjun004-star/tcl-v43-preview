-- Install after schema-repository-scoring.sql. The normal API authenticates the viewer.
-- No end-user or worker role can run this projection or read queue rows directly.
begin;
create function public.tcl_r24_sync_v1_read_repository_reviews(
  p_assignment_id text, p_team_id text, p_viewer_id text, p_viewer_role text, p_ids text[]
) returns table (id text, repository_review jsonb)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select s.id,
    case
      when j.state in ('scored','archived') and j.receipt->>'origin' = 'openai_review'
        and j.result->>'source' = 'openai_offline' and jsonb_typeof(j.result->'items') = 'array'
      then jsonb_build_object('status','pending_review','evaluation',jsonb_build_object(
        'source','openai_offline','model',j.result->'model','degraded',false,
        'overallScore',j.result->'overallScore','grade',j.result->'grade',
        'items',(select jsonb_agg(jsonb_build_object('questionIndex',item->'questionIndex',
           'score',item->'score','matchedPoints',item->'matchedPoints','missedPoints',item->'missedPoints',
           'comment',item->'comment','suggestedScript',item->'suggestedScript') order by n)
           from jsonb_array_elements(j.result->'items') with ordinality as detail(item,n))))
      when g.grant_id is not null and j.state='ready' then jsonb_build_object('status','waiting')
      when g.grant_id is not null and j.state='attempting' and j.lease_until > now()
        then jsonb_build_object('status','processing')
      else jsonb_build_object('status','needs_attention')
    end
  from public.tcl_r24_sync_v1_submissions s
  join public.tcl_r24_sync_v1_assignments a on a.id=s.assignment_id and a.team_id=s.team_id
  join r24_repo_scoring.jobs j on j.job_id=s.id
  left join r24_repo_scoring.allowlist g on g.grant_id=j.grant_id and g.team_id=s.team_id
    and g.anchor_id=s.anchor_id and g.assignment_id=s.assignment_id
  where s.team_id=p_team_id and s.assignment_id=p_assignment_id and s.id=any(p_ids)
    and cardinality(p_ids) between 1 and 20
    and ((p_viewer_role='operator' and a.payload->>'operatorId'=p_viewer_id)
      or (p_viewer_role='anchor' and s.anchor_id=p_viewer_id
        and (a.payload->'recipients'='[]'::jsonb or
          a.payload->'recipients' @> jsonb_build_array(jsonb_build_object('id',p_viewer_id)))))
    and (s.payload->'evaluation' is null or j.receipt->>'origin'='openai_review');
$$;
revoke all on function public.tcl_r24_sync_v1_read_repository_reviews(text,text,text,text,text[])
  from public, anon, authenticated, r24_scoring_worker;
grant execute on function public.tcl_r24_sync_v1_read_repository_reviews(text,text,text,text,text[]) to service_role;
commit;
