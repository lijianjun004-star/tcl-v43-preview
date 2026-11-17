# 首轮夹具计数失败及修正

首次冻结后运行145项门禁用例，`test_exact_name_invite_update_and_reverse_preserve_all_older_bytes` 一项失败：

```text
AssertionError: 28 != 29
Ran 145 tests in 27.483s
FAILED (failures=1)
```

最终快照新增 `name-identity.mjs`，测试夹具也同步增加了一个文件。原断言把正向新版和反向回滚的文件数都与新版资源数比较；回滚正确移除该新增文件后，夹具实际为28项，断言却期待29项。这两个数字仅属于合成夹具；真实站点的对应数量为246和245。

修正后分别验证正向为“旧资源数＋姓名邀请码版资源数”、反向为“旧资源数＋恢复版资源数”，并继续验证全部旧资源与精确变更集合。仅修改测试断言，未因该失败改动产品runtime或生产门禁策略。

全145项重跑通过，27.636秒，完整结果见 [unit-tests-final.log](unit-tests-final.log)。真实归档完整正反构建亦通过，217个旧资源逐字节保持；见 [complete-stage-final.log](complete-stage-final.log)。后续精确head的GitHub CI同样成功。
