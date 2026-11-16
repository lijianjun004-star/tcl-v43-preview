# 页面卡顿性能对照：当前线上基线与即时保存候选 v3

Three independent contexts per 20/100/200-turn group at CPU 1x/4x, same Chromium 390x844 touch viewport, each with 500 synthetic library rows. Input uses 40 ASCII characters separated by 20ms (800ms deliberate pacing included). No inference, real phone, or business data. The shared worker was not isolated. Baseline sampling overlapped other independent browser validations; final candidate sampling started after those scripts exited. Resource load was therefore not identical. Latencies include UI scheduling and are observational; structural counts are acceptance gates.

此报告仅判定性能采样。发布仍要求相同app哈希的快速刷新、跨标签CAS、事务失败与分页/编辑正确性通过；发现数据回归必须拒绝。此前034597/60d064防抖候选已因丢字拒绝，旧数据保留，不能与本候选混用。

## 实测与边界

基线与候选各18个独立上下文，全部保留输入末尾并刷新恢复。数据均为人工500条资料及20/100/200题历史文字快照，没有录音、模型或真实业务内容。CPU4×是桌面模拟减速，不代表某款手机性能。字号与viewport检查只能定位缩放风险，不能代替iOS键盘真机测试。

| CPU | 题数 | 隐藏行（前→后） | 首屏逐题行（前→后） | 40字事务（前→后，各3次） | records.put（前→后，各3次） | 逐题打开中位[范围]ms（前→后） | 输入40字中位[范围]ms（前→后） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1× | 20 | 0→0 | 20→20 | [40, 40, 40]→[40, 40, 40] | [800, 800, 800]→[20, 20, 20] | 471.4 [297.6,559.7]→325.8 [324,376.7] | 1699.9 [1605.5,1929.2]→1086.5 [1055.7,1108.5] |
| 1× | 100 | 0→0 | 100→20 | [40, 40, 40]→[40, 40, 40] | [4000, 4000, 4000]→[100, 100, 100] | 403.9 [390.6,652.3]→339.1 [324.1,341.5] | 1819.3 [1166,2158.8]→1135.9 [1079.3,1139] |
| 1× | 200 | 0→0 | 200→20 | [40, 40, 40]→[40, 40, 40] | [8000, 8000, 8000]→[200, 200, 200] | 458.5 [447.2,460.7]→339.9 [325.5,417.6] | 1603.9 [1124.4,1636.2]→1176.9 [1126.3,1200.8] |
| 4× | 20 | 0→0 | 20→20 | [40, 40, 40]→[40, 40, 40] | [800, 800, 800]→[20, 20, 20] | 459.3 [428.3,507.4]→417.9 [400.8,524.6] | 1910.2 [1797.8,2035]→1585.2 [1444.3,1594.8] |
| 4× | 100 | 0→0 | 100→20 | [40, 40, 40]→[40, 40, 40] | [4000, 4000, 4000]→[100, 100, 100] | 943.3 [760.8,1105.4]→442.8 [377.7,471.2] | 2166.3 [2103.6,2281.7]→1785.9 [1660.9,1910.9] |
| 4× | 200 | 0→0 | 200→20 | [40, 40, 40]→[40, 40, 40] | [8000, 8000, 8000]→[200, 200, 200] | 1248.1 [1163,1252]→373.1 [369.9,383.6] | 2648.2 [2635.5,2872.7]→2298.4 [2290.1,2398.4] |

输入总耗时含40次×20ms的固定发送间隔；不把该差值说成整个产品或真实手机提速比例。Long Task、下一帧延迟分位数、每次样本和范围保存在JSON中。本次机器非隔离；基线样本与其他独立浏览器验收并行，最终候选在这些脚本退出后采样，资源负载并不完全一致。耗时不能用来断言因果提速比例；不能混用旧防抖候选的结果。采用不预建隐藏逐题表、首屏最多20行、保留40次即时checkpoint、未变历史记录最多N次put、末尾数据完整等条件验收。

原始fixture中的checkpointBytes字段实际记录JSON字符串UTF-16代码单元数，并非字节数，本对照不使用该值作体积结论。

## 验收

- PASS：same_browser_and_configuration
- PASS：all_18_samples_each
- PASS：source_stable_each
- PASS：baseline_and_candidate_keep_text
- PASS：candidate_no_page_errors
- PASS：candidate_no_hidden_summary_rows
- PASS：candidate_initial_rows_at_most20
- PASS：candidate_40_immediate_checkpoint_transactions
- PASS：candidate_unchanged_records_put_at_most_N
- PASS：candidate_40_input_events
- PASS：candidate_input_fonts16
- PASS：candidate_viewport_stable
- PASS：candidate_500_library_search
- PASS：candidate_30_nav_no_interval_growth
