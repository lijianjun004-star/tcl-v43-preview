# v3 最终候选采样前补记

当前基线1af535已完成18次固定采样。8dfa7598虽然完成冻结，但未运行性能样本：独立200题/CPU4×/50ms刷新仅2/3保留末字，当前基线3/3，因此进行一次最小修正，将首次records写入前的指纹构造移至事务成功之后。最终app为63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816；CSS仍35a869c9，bridge/Worker不变。

最终独立重负载交替刷新基线/候选各3/3；普通trusted键盘0ms刷新基线/候选各1/3，50ms各3/3。保留0ms原始FAIL，它不构成新增劣化，也不能宣称任意立即刷新绝不丢字。证据见independent/current-heavy-v3、current-keyboard-v3及current-keyboard-baseline-v3。

在开始任何最终候选性能样本前，将完整22文件冻结至/workspace/scratch/r24-perf-candidate-63519c50，见candidate-63519c50-freeze.json。评分条件、18样本配置、原采样脚本939c6c及当前基线不变。8dfa预冻结目录从未测量，不计入性能结果。
