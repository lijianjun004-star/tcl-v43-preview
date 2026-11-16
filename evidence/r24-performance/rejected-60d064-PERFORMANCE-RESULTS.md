# 页面卡顿性能对照

Three independent contexts per 20/100/200-turn group at CPU 1x/4x, same Chromium 390x844 touch viewport, each with 500 synthetic library rows. Input uses 40 ASCII characters separated by 20ms (800ms deliberate pacing included). No inference, real phone, or business data. The shared worker was not exclusive; final sampling overlapped other independent browser validations. Latencies include UI scheduling and are observational, structural counts are acceptance gates.

## 实测与边界

基线与候选各18个独立上下文，全部保留输入末尾并刷新恢复。数据均为人工500条资料及20/100/200题历史文字快照，没有录音、模型或真实业务内容。CPU4×是桌面模拟减速，不代表某款手机性能。字号与viewport检查只能定位缩放风险，不能代替iOS键盘真机测试。

| CPU | 题数 | 隐藏行（前→后） | 首屏逐题行（前→后） | 40字事务（前→后，各3次） | records.put（前→后，各3次） | 逐题打开中位[范围]ms（前→后） | 输入40字中位[范围]ms（前→后） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1× | 20 | 20→0 | 20→20 | [40, 40, 40]→[1, 1, 1] | [800, 800, 800]→[20, 20, 20] | 330.6 [307.5,337.7]→294.6 [180.1,307.7] | 1011.9 [982,1023]→1038.4 [1013.8,1038.7] |
| 1× | 100 | 100→0 | 100→20 | [40, 40, 40]→[2, 2, 2] | [4000, 4000, 4000]→[200, 200, 200] | 407.2 [406.3,455.3]→332.7 [331.2,454.9] | 1074.6 [1012.9,1093.5]→1241.3 [1075.3,1369.1] |
| 1× | 200 | 200→0 | 200→20 | [40, 40, 40]→[2, 1, 1] | [8000, 8000, 8000]→[400, 200, 200] | 498 [470.2,518]→311.3 [305.1,478] | 1124.8 [1076.2,1149.2]→990 [953.2,1642.1] |
| 4× | 20 | 20→0 | 20→20 | [40, 40, 40]→[3, 2, 2] | [800, 800, 800]→[60, 40, 40] | 443.1 [368.4,523.8]→648.3 [565.1,718.1] | 1525.5 [1458,1591.9]→2065.6 [1849.6,2610.3] |
| 4× | 100 | 100→0 | 100→20 | [40, 40, 40]→[2, 2, 3] | [4000, 4000, 4000]→[200, 200, 300] | 950.3 [932.7,1033]→652 [387.6,663.6] | 2280.6 [2249.6,2680.1]→1707.8 [1443.2,1870.3] |
| 4× | 200 | 200→0 | 200→20 | [40, 40, 40]→[2, 2, 2] | [8000, 8000, 8000]→[400, 400, 400] | 1744.2 [1690.2,1958]→695.6 [426.4,923.8] | 2819.2 [2737.3,2985.7]→1665.1 [1232,1669.2] |

输入总耗时含40次×20ms的固定发送间隔；不把该差值说成整个产品或真实手机提速比例。Long Task、下一帧延迟分位数、每次样本和范围保存在JSON中。本次环境非独占，最终样本与其他独立浏览器验收并行；共享机器负载会影响时间，不能把034候选更低的耗时替换到最终60d结果。采用不预建隐藏逐题表、首屏最多20行、40字最多8事务、末尾数据完整等结构条件验收。

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
