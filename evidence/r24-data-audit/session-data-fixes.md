# 本机会话数据一致性修复

源码 app.js SHA-256：`88b3ce2a8a9cf889f1579337f6d78f83e03dbf3c9bff6fffbb41f1ca0e25e900`。

实证问题：两个同姓名标签修改同一场的不同题时，旧标签的整场 checkpoint 覆盖较新答案，逐题 records 与恢复结果不一致；旧标签还可继续把冲突版本提交给运营。另有手动清空后 Vosk 补转写重新计入要点覆盖的问题。before 目录保留最小复现、结果及截图；均使用合成数据，没有读取用户手机数据库。

修复采用每姓名 checkpoint 槽位的持久 writeToken/revision。一个标签自己的保存依次执行；跨标签版本不同则整笔拒绝并提示刷新恢复。每次成功保存用同一 IndexedDB 事务写本场全部不超过200条轻量逐题记录、checkpoint及变化媒体。失败不会出现 records 先成功而 checkpoint 失败。发生冲突时，本页修改保留，并提供专用 JSON 导出按钮；普通个人记录导出仍只代表成功保存的数据。

恢复在同一只读事务读取最新元数据与对应媒体；支持旧版无 writeToken 记录的首次升级。提交先确认本场保存成功，再在提交事务中核对 token、场次与姓名；旧标签不能提交冲突版本。pagehide使用同一版本检查。清空回答保留识别原文，但不计其要点覆盖；浏览器识别迟到结果也不回填已清空输入。

验证：concurrency/result.json 10项、session/result.json 10项全部通过，实际Chromium原生IndexedDB、后者使用合成录音及模拟ASR，均零页面错误且源码哈希前后不变。manual-clear-regression.cjs 3组与regression.cjs 14组通过。独立提交专项见stale-submission-after.json。

边界：这是同一浏览器内的数据一致性机制，不是账号鉴权或跨设备同步。冲突时拒绝覆盖，不提供实时多人合并。未结束的MediaRecorder片段、浏览器数据清理、真机硬件与业务语音准确率仍不在这些结果内。
