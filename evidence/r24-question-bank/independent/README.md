# qa-import 独立复审

仅使用人工构造的问答和来源地址，通过 Node 执行当前模块；没有调用 Gemini、浏览器或外部服务。应用仍在修改中，这里只记录被测模块快照，不宣称整套应用已经冻结或发布。

修前独立实测确认三类问题：适用范围重叠漏报同问异答；不安全数字 SKU 静默舍入；来源别名的 URL 路径大小写或空白值导致来源丢失。确切输入及输出见 [before.json](before.json)，owner 的另一次修前实测见 [scope-metadata-before.json](../import/scope-metadata-before.json)。

修后独立复验 **17/17 通过**，源码在本次执行中未改变。范围覆盖：全部平台/京东、品类/板块双向、京东与天猫组合平台；不同型号、SKU、SKU 大小写、互斥品类/平台/板块保持独立。另核验不安全数字拒绝、数字字符串原样保存、来源大小写冲突拒绝、空白来源回退及正式来源优先于旧显示标签。

- 修前模块 SHA-256：`bdab842328e276aa63d84f8acb91c8d91bac9631408471d723372f6b5fb58fff`。该值在初始失败探针后、owner 修复前读取；具体观察时间边界写在 before.json。
- 修后被测模块 SHA-256：`fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86`。
- 修后原始结果：[after.json](after.json)。复现脚本：[review-probes.mjs](review-probes.mjs)，从仓库根目录运行 `node evidence/r24-question-bank/independent/review-probes.mjs`。

边界：JSON 同时存在互相矛盾的 `question/问题` 或 `answer/答案` 时，仍沿用原有的首个非空字段规则；这项旧行为依负责人要求仅记录，没有扩大本轮修改。这里没有验证真实业务参数、生产账号权限、真机浏览器或模型推理。
