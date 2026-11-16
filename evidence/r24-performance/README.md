# 卡顿与页面稳定性证据索引

这里保留多个候选及失败记录，不能按目录名中的 final 推断已发布或最终通过。当前源码交付以根目录 AI_CONTEXT.md 和发行归档为准。

| 阶段 | app SHA256 前缀 | 性能样本 | 结论/位置 |
| --- | --- | --- | --- |
| 原题库版基线 | d090543e | 18 | baseline/；历史比较，已不是本轮当前线上基线 |
| 首次延迟保存候选 | 034597b1 | 18 | candidate/；快速刷新丢字，拒绝 |
| 加 beforeunload 的延迟保存候选 | 60d06449 | 18 | final-candidate/；重负载50ms刷新0/3，基线3/3，拒绝。REJECTED-60d064-RESULTS.md及comparison.json保留拒绝结论 |
| 当前 smooth-mobile 基线 | 1af53554 | 18 | baseline-current/；从d82e0ad精确提取22文件，已经含Worker及总览懒加载 |
| 恢复即时保存、差量records初版 | 4d537b5a | 0 | 发现线上已更新，停止旧基线测量，不发布 |
| 移植至当前线上基线 | 8dfa7598 | 0 | 仅冻结，独立重负载刷新2/3、基线3/3，修正前不发布 |
| 首次缓存移至成功提交后 | 63519c50 | 18 | 最终性能采样14/14通过；PERFORMANCE-RESULTS-v3.md及comparison-v3.json，完整22文件与发行源一致 |

当前测量计划是 `MEASUREMENT-PLAN-v3.md`，及 CSS/候选采样前补记 `PLAN-v3-css-addendum.md`、`PLAN-v3-candidate-addendum.md`。v1计划“最多8事务”已随延迟保存候选拒绝；v2/v3保留每字立即保存，评价未变记录的重复写量，不能混用旧候选的40→2事务数字。

独立刷新/编辑/音频与缓存正确性见 `independent/`；移动布局见 `mobile/`；ASR审计见 `asr-audit/`。早期独立ASR Worker代理试验未放行；随后另一会话已经发布的新Worker基线会被保留，本轮性能文字样本没有加载或调用模型，不能用于判断ASR准确度或模型推理提速。

所有性能场景为人工资料和历史文字快照。共享桌面Chromium的CPU4×节流不是手机；耗时报告原始样本、中位数和全范围，不宣称真实手机整体提速比例。普通trusted键盘0ms立即刷新在当前基线与635候选均仅1/3保留末尾，50ms均3/3；保留失败边界，不能说任意立即刷新绝不丢内容。
