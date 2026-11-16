# R25 独立路径发布准备（未发布）

任务 TCL-R25-ASR-FALLBACK-20261116。本目录是本地可审核准备结果，未push、未创建PR、未合并、未部署。当前用户包内边界要求明确批准后才合并或部署；本目录不表示批准。

## 冻结与隔离

- 新路径：`/tcl-v352-asr-r25-qa/`，22文件；修正版app `2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc`。
- ZIP：`52a47cf131c8dc402747230c672d96dfb1d3a9805b8a3dd18fc3d000c2cbe9d5`。
- B64文本：`d7105747e91bb3a4fc878624b343aa047d1ae142787d72afa1822b94b38cab51`。
- 原217个资源完整树指纹：`13df1a6bac7a368dac95b336f17c89c8fda8c8460a98e38c868bed84092a1cc6`。精确路径/逐项SHA在freeze.json。
- 原site.zip、R24归档、旧版常量与函数定义保持原样；未扩展旧SHA白名单。新增R25只有一个确定归档快照，未开放任意归档更新。

## 文件与顺序

1. `01-ci-maintenance.patch`：只改release_guard.py/test_release_guard.py，新增严格`--stage-r25`、精确归档/22文件/清单版本校验、旧217完整树保护、仅允许精确workflow单步骤插入和逆向回滚。应单独提交CI维护PR，批准前不合并。
2. `02-isolated-r25-release.patch`：只新增`experiments/r25-release/site-only.zip.b64`及pages.yml一个R25 staging步骤。它不包含CI代码；须等已审核的CI维护进入main后，在最新main重新建立独立发布PR并运行固定base/head检查。
3. `03-isolated-r25-rollback.patch`：精确反转第2项，仅删除R25归档及步骤，保留旧217资源和R24。回滚应在当时最新main通过新的PR执行，不复写其他路径、不清理浏览器存储。
4. `candidate-commits.json`：本地CI提交及用于验证的release/rollback对象SHA。release/rollback是无分支、未发布的本地对象，用于完整`--verify-pr`正逆验证；它们不是线上提交。若main前进必须重新基于main建PR，不能直接使用旧对象覆盖main。

## 已做检查

- 基于真实main发行输入重建旧217文件、追加R25得到239，旧文件逐字节保留；22个新增文件哈希和manifest匹配。
- 精确逆向回滚移除R25的22文件后恢复同一旧217指纹。
- 基线可信门禁对独立CI提交验证；R25门禁对实际release/rollback固定SHA验证。完整输出在`ci-maintenance-verify-pr.log`、`release-verify-pr.log`、`rollback-verify-pr.log`。该结果不是公网验证。
- 门禁回归覆盖原92项及新增18项（110项）：错误归档/资源/版本、非普通文件、旧资源缺失/增加/变化、既有目标/符号链接、语法失败不发布部分目录、最终rename期间旧资源被改、workflow越界、错误受信输入及不能混入源码/只改归档。

未运行：GitHub Actions、公网239资源校验、真实iPhone/Android、中国大陆网络和真人准确率。发布后还需公网逐文件HTTP及SHA读取，不能把本地构建成功当作部署或ASR准确率验收。
