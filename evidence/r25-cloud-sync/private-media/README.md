# R25 原生私有媒体真实验收

状态：PREPARED，未向云端执行。必须等待root明确通知schema/helper、storage SQL及测试角色已应用后才能加 `--execute`。脚本从已有原生账号登录，不创建账号、不配置云资源、不自行开启媒体capability、不自动重试失败suite。

构建（不发云请求）：

```bash
node /workspace/r25-backend-tests/media/build.cjs
python /workspace/r25-backend-tests/media/run_private_storage.py
```

获通知后先测存储ACL，供root决定是否开启媒体capability：

```bash
python /workspace/r25-backend-tests/media/run_private_storage.py --execute --storage-only
```

root确认媒体capability开启后，执行完整关联提交与运营收取：

```bash
python /workspace/r25-backend-tests/media/run_private_storage.py --execute
```

默认私有配置 `/workspace/r25-cloud-test-credentials.json` 必须owner-only，含anchor/operator/outsider/admin四原生账号。凭据仅在内存传给独立浏览器context；不写日志、trace、截图、request headers。签名URL仅在内存转交给另一个context验证bearer限制，不写证据。登录origin沿用root已添加白名单的127.0.0.1:8765，页面壳本地route.fulfill；Auth/PG/Storage请求没有mock。不是产品UI测试。

合成fixture是0.5秒440Hz单声道16kHz/16bit WAV。preflight上传1对象，完整suite至多5个小WAV对象（owner4个、outsider1个），加一个应被拒绝的PostgREST伪造metadata请求；每次运行使用新runId。对象保留用于证据，客户端删除按设计应被拒绝；之后若需要清理由root用受控管理端Storage API完成。不处理真实用户音视频。

覆盖：owner上传/下载字节hash；未关联operator/outsider/anon读和签名拒绝；覆盖/删除拒绝后原字节不变；无效JWT拒绝；直接PostgREST暴露storage schema并伪造objects行应拒绝；真实Range GET查206/Content-Range/100字节切片hash；短期签名URL在另一个context无Authorization仍可下载，记录为bearer限制而非产品私有访问方案。

完整suite另建合成任务/加入，验证不存在/foreign实际对象/伪size/伪MIME/4附件提交被拒，3实际附件提交获得回执，关联运营及admin下载hash一致、outsider/anon仍被拒、重复绑定附件拒绝、运营logout后读取拒绝。真实SQL回执与Storage读为依据，不把本机outbox作为送达。

结果保存在独立 `results/<UTC>/result.json`，失败保留。Range失败独立记为RANGE_NOT_CONFIRMED，不承诺视频拖动；若其余ACL通过，整文件鉴权Blob播放仍可单独评估。真手机、MP4/AAC解码、长录音/内存、真实音视频seek、国内网络及ASR准确率未测。
