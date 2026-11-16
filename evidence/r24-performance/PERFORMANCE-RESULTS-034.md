# 页面卡顿性能对照

Three independent contexts per 20/100/200-turn group at CPU 1x/4x, same Chromium 390x844 touch viewport, each with 500 synthetic library rows. Input uses 40 ASCII characters separated by 20ms (800ms deliberate pacing included). No inference, real phone, or business data. Latencies include UI scheduling and are observational, structural counts are acceptance gates.

## 实测与边界

基线与候选各18个独立上下文，全部保留输入末尾并刷新恢复。数据均为人工500条资料及20/100/200题历史文字快照，没有录音、模型或真实业务内容。CPU4×是桌面模拟减速，不代表某款手机性能。字号与viewport检查只能定位缩放风险，不能代替iOS键盘真机测试。

| CPU | 题数 | 隐藏行（前→后） | 首屏逐题行（前→后） | 40字事务（前→后，各3次） | records.put（前→后，各3次） | 逐题打开中位ms（前→后） | 输入40字中位ms（前→后） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1× | 20 | 20→0 | 20→20 | [40, 40, 40]→[1, 1, 1] | [800, 800, 800]→[20, 20, 20] | 330.6→310.7 | 1011.9→953 |
| 1× | 100 | 100→0 | 100→20 | [40, 40, 40]→[1, 1, 1] | [4000, 4000, 4000]→[100, 100, 100] | 407.2→322.1 | 1074.6→933.7 |
| 1× | 200 | 200→0 | 200→20 | [40, 40, 40]→[1, 1, 1] | [8000, 8000, 8000]→[200, 200, 200] | 498→318.8 | 1124.8→939.9 |
| 4× | 20 | 20→0 | 20→20 | [40, 40, 40]→[2, 2, 2] | [800, 800, 800]→[40, 40, 40] | 443.1→460.5 | 1525.5→1205.8 |
| 4× | 100 | 100→0 | 100→20 | [40, 40, 40]→[2, 2, 2] | [4000, 4000, 4000]→[200, 200, 200] | 950.3→401.5 | 2280.6→1196.8 |
| 4× | 200 | 200→0 | 200→20 | [40, 40, 40]→[2, 2, 2] | [8000, 8000, 8000]→[400, 400, 400] | 1744.2→429.4 | 2819.2→1184.7 |

输入总耗时含40次×20ms的固定发送间隔；不把该差值说成整个产品或真实手机提速比例。Long Task、下一帧延迟分位数、每次样本和范围保存在JSON中。共享机器负载会影响时间；采用不预建隐藏逐题表、首屏最多20行、40字最多8事务、末尾数据完整等结构条件验收。

原始fixture中的checkpointBytes字段实际记录JSON字符串UTF-16代码单元数，并非字节数，本对照不使用该值作体积结论。

## 验收

- PASS：same_browser_and_configuration
- PASS：all_18_samples_each
- PASS：source_stable_each
- PASS：baseline_and_candidate_keep_text
- PASS：candidate_no_page_errors
- PASS：candidate_no_hidden_summary_rows
- PASS：candidate_initial_rows_at_most20
- PASS：candidate_40_char_writes_at_most8
- PASS：candidate_input_fonts16
- PASS：candidate_viewport_stable
- PASS：candidate_500_library_search
- PASS：candidate_30_nav_no_interval_growth
