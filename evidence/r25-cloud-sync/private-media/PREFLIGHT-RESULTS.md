# R25 私有存储前置实测记录

仅真实CloudBase Auth/PG/Storage与Chromium，合成0.5秒440Hz WAV；不含真人、手机硬件、ASR或MP4/AAC解码验收。所有试验均经root逐次授权，未自行改云配置/策略，未删除用户数据。

1. `results/20261117T003136772905Z/result.json`：4原生账号登录/UID与业务角色检查通过，owner上传HTTP403；未执行后续测试。
2. `results/20261117T003356921185Z/result.json`：增强安全诊断后仅再试一次上传，明确HTTP403 / STORAGE_ACCESS_DENIED，provider指出 `r25wf_object_insert_guard` 拒绝。原失败未覆盖。公开文档只描述最终metadata注入，不能证明INSERT WITH CHECK执行时已有完整owner/metadata；具体哪项谓词失效未单独证实。
3. root应用仅新bucket两条INSERT策略的compat补丁后，`results/20261117T003552426342Z/result.json`：owner成功上传；info为size16044/contentType audio/wav，metadata对象为空（SQL最终metadata由root另查确认），owner完整下载hash匹配；未关联operator、outsider、anonymous的SDK下载/签名均未允许；直接PostgREST storage schema伪造objects行HTTP406 / DATABASE_PGRST106；owner覆盖被HTTP403拒绝。此轮在remove API返回ok时被测试驱动判FAIL，原件保留。
4. `results/20261117T003740189948Z/result.json`：只读检查证明第3轮同一原对象在remove请求后仍可完整下载，16044字节、SHA与fixture一致，未被删除。PG DELETE RLS可能过滤0行且API200，原驱动仅把返回ok当成删除成功，属于夹具判定错误；现改为检查实际removedCount及后续完整字节，不改产品删除策略。此轮outsider仍HTTP404；真实Range返回206、Content-Range `bytes 0-99/16044`、Accept-Ranges `bytes`，100字节切片hash一致。

截至本记录：合并上述各自范围可确认基本owner读写、未关联用户隔离、覆盖/实际删除无效、storage schema当前不暴露、合成WAV Range206。不能声称完整storage-only单轮全部通过，也未验证媒体关联提交/受理运营读取。匿名SDK的StorageError没有HTTP状态，完整suite已追加无Authorization直接GET确认，尚待执行。签名bearer实测也待完整suite；产品路线仍是鉴权download→本机Blob URL。

root负责在上述前置结果后决定是否开启private_media，再授权完整suite。所有失败与驱动修正均保留，不循环重跑至通过。
