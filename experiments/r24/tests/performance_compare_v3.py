#!/usr/bin/env python3
"""V3 current-baseline immediate-save measurements; no release approval without independent durability checks."""
import json, math, pathlib, statistics, sys
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/'evidence/r24-performance'
paths=[pathlib.Path(sys.argv[i]) if len(sys.argv)>i else OUT/name/'result.json' for i,name in [(1,'baseline-current'),(2,'immediate-candidate-current')]]
before,after=[json.loads(p.read_text()) for p in paths]
def med(values):return statistics.median(values)
def quantile(values,q):
 values=sorted(values)
 return values[max(0,math.ceil(q*len(values))-1)] if values else None
def derived(rows):
 return {'samples':len(rows),
  'restore_ms':[round(x['restore_overview']['elapsedMs'],1) for x in rows],
  'restore_median_ms':round(med([x['restore_overview']['elapsedMs'] for x in rows]),1),
  'details_ms':[round(x['open_details']['elapsedMs'],1) for x in rows],
  'details_median_ms':round(med([x['open_details']['elapsedMs'] for x in rows]),1),
  'overview_dom_nodes':[x['restore_overview']['domNodes'] for x in rows],
  'overview_hidden_rows':[x['restore_overview']['summaryRows'] for x in rows],
  'initial_detail_rows':[x['details_initial_rows'] for x in rows],
  'typing_ms':[round(x['typing_events_end_ms'],1) for x in rows],
  'typing_median_ms':round(med([x['typing_events_end_ms'] for x in rows]),1),
  'write_transactions':[sum(t['mode']=='readwrite' for t in x['typing']['tx']) for x in rows],
  'record_puts':[x['typing']['puts'].get('records',0) for x in rows],
  'input_next_frame_p50_ms':[round(quantile([a['ms'] for a in x['typing']['inputFrames']],.5),1) for x in rows],
  'input_next_frame_p95_ms':[round(quantile([a['ms'] for a in x['typing']['inputFrames']],.95),1) for x in rows],
  'longtask_count':[len(x['typing']['longtasks']) for x in rows],
  'longtask_max_ms':[max([a['duration'] for a in x['typing']['longtasks']] or [0]) for x in rows],
  'total_blocking_ms':[sum(max(0,a['duration']-50) for a in x['typing']['longtasks']) for x in rows]}
checks={
 'same_browser_and_configuration':before['browser']==after['browser'] and before['configuration']==after['configuration'],
 'all_18_samples_each':len(before['samples'])==len(after['samples'])==18,
 'source_stable_each':before['source_unchanged'] and after['source_unchanged'],
 'baseline_and_candidate_keep_text':before['checks']['all_saved_and_reloaded'] and after['checks']['all_saved_and_reloaded'],
 'candidate_no_page_errors':not after['errors'],
 'candidate_no_hidden_summary_rows':all(x['restore_overview']['summaryRows']==0 for x in after['samples']),
 'candidate_initial_rows_at_most20':all(0<x['details_initial_rows']<=20 for x in after['samples']),
 'candidate_40_immediate_checkpoint_transactions':all(sum(t['mode']=='readwrite' for t in x['typing']['tx'])==40 for x in after['samples']),
 'candidate_unchanged_records_put_at_most_N':all(x['typing']['puts'].get('records',0)<=x['turns'] for x in after['samples']),
 'candidate_40_input_events':all(len(x['typing']['inputFrames'])==40 for x in after['samples']),
 'candidate_input_fonts16':all(f['fontPx']>=16 for x in after['samples'] for k in ['overview_fields','detail_fields','post_fields'] for f in x[k]),
 'candidate_viewport_stable':all(x[k]['viewport']['scale']==1 and x[k]['viewport']['scrollWidth']<=390 and x[k]['viewport']['innerWidth']==390 for x in after['samples'] for k in ['restore_overview','open_details','typing']),
 'candidate_500_library_search':after['checks']['library_500_search_correct'],
 'candidate_30_nav_no_interval_growth':after['checks']['navigation_no_interval_growth']}
report={'status':'PERFORMANCE_MEASUREMENT_PASS' if all(checks.values()) else 'FAIL','release_verdict':'REQUIRES_INDEPENDENT_CORRECTNESS_ACCEPTANCE','plan':'MEASUREMENT-PLAN-v3.md','method':'Three independent contexts per 20/100/200-turn group at CPU 1x/4x, same Chromium 390x844 touch viewport, each with 500 synthetic library rows. Input uses 40 ASCII characters separated by 20ms (800ms deliberate pacing included). No inference, real phone, or business data. The shared worker was not isolated. Baseline sampling overlapped other independent browser validations; final candidate sampling started after those scripts exited. Resource load was therefore not identical. Latencies include UI scheduling and are observational; structural counts are acceptance gates.','before_report':str(paths[0]),'after_report':str(paths[1]),'source_hashes_before':before['source_hashes'],'source_hashes_after':after['source_hashes'],'checks':checks,'groups':[]}
for rate in [1,4]:
 for n in [20,100,200]:
  sel=lambda d:[x for x in d['samples'] if x['cpu_rate']==rate and x['turns']==n]
  report['groups'].append({'cpu_rate':rate,'turns':n,'before':derived(sel(before)),'after':derived(sel(after))})
(OUT/'comparison-v3.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines=['# 页面卡顿性能对照：当前线上基线与即时保存候选 v3\n',report['method']+'\n','此报告仅判定性能采样。发布仍要求相同app哈希的快速刷新、跨标签CAS、事务失败与分页/编辑正确性通过；发现数据回归必须拒绝。此前034597/60d064防抖候选已因丢字拒绝，旧数据保留，不能与本候选混用。\n','## 实测与边界\n','基线与候选各18个独立上下文，全部保留输入末尾并刷新恢复。数据均为人工500条资料及20/100/200题历史文字快照，没有录音、模型或真实业务内容。CPU4×是桌面模拟减速，不代表某款手机性能。字号与viewport检查只能定位缩放风险，不能代替iOS键盘真机测试。\n','| CPU | 题数 | 隐藏行（前→后） | 首屏逐题行（前→后） | 40字事务（前→后，各3次） | records.put（前→后，各3次） | 逐题打开中位[范围]ms（前→后） | 输入40字中位[范围]ms（前→后） |','| --- | --- | --- | --- | --- | --- | --- | --- |']
for g in report['groups']:
 a,b=g['before'],g['after'];lines.append(f"| {g['cpu_rate']}× | {g['turns']} | {a['overview_hidden_rows'][0]}→{b['overview_hidden_rows'][0]} | {a['initial_detail_rows'][0]}→{b['initial_detail_rows'][0]} | {a['write_transactions']}→{b['write_transactions']} | {a['record_puts']}→{b['record_puts']} | {a['details_median_ms']} [{min(a['details_ms'])},{max(a['details_ms'])}]→{b['details_median_ms']} [{min(b['details_ms'])},{max(b['details_ms'])}] | {a['typing_median_ms']} [{min(a['typing_ms'])},{max(a['typing_ms'])}]→{b['typing_median_ms']} [{min(b['typing_ms'])},{max(b['typing_ms'])}] |")
lines+=['\n输入总耗时含40次×20ms的固定发送间隔；不把该差值说成整个产品或真实手机提速比例。Long Task、下一帧延迟分位数、每次样本和范围保存在JSON中。本次机器非隔离；基线样本与其他独立浏览器验收并行，最终候选在这些脚本退出后采样，资源负载并不完全一致。耗时不能用来断言因果提速比例；不能混用旧防抖候选的结果。采用不预建隐藏逐题表、首屏最多20行、保留40次即时checkpoint、未变历史记录最多N次put、末尾数据完整等条件验收。\n','原始fixture中的checkpointBytes字段实际记录JSON字符串UTF-16代码单元数，并非字节数，本对照不使用该值作体积结论。\n','## 验收\n']
lines += [f"- {'PASS' if ok else 'FAIL'}：{name}" for name,ok in checks.items()]
(OUT/'PERFORMANCE-RESULTS-v3.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'status':report['status'],'checks':checks},ensure_ascii=False,indent=2))
if report['status']!='PERFORMANCE_MEASUREMENT_PASS':raise SystemExit(1)
