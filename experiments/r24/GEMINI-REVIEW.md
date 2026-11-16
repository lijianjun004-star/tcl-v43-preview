# Gemini 单次复验任务书

任务：TCL-R24-DELIVERY-20261116。用户已授权将该项目材料交给Gemini，使用现有Google AI Pro；最多1条业务请求、0次自动重试，不购买API或升级。

当前实际状态：Google登录连接尚未完成，Gemini业务调用0次。以下是准备好的交接，不是Gemini返回。

请在Gemini支持附件的会话中，从Drive明确附加 `TCL-R24-Gemini-复验输入-b086a0c5.txt`，不要仅粘贴链接并假定已经读到。文件：https://drive.google.com/file/d/18WS9o63pvNx6PbX594vJdzrmWyF0dmBg/view?usp=drivesdk 。SHA256 d13c3e3f54cd39fce7fd32fc7ddc80f42e49962cf21c094ed64e75676fdfbc32。

建议一次发送：

> 对附件中的练播房R24最终源码和证据独立复核，目标是找出影响交付的剩余P1/P2问题。先确认读到冻结app哈希、restoreLocalSession恢复边界，以及音频报告里的模型版本信息。重点检查队列取消及跨场迟到、人工清空、异步身份变化、模型超时资源锁、IndexedDB保存/恢复/失败、导入文件边界。输出每个问题的文件、函数、触发步骤、影响和最小修复；没有证据的事项标为未确定。不要把已读取的测试报告说成你实际运行过；如具备代码执行工具可运行可用的离线测试，否则明确只做代码/证据审阅。最后区分本机版本可交付、真实手机待验、TCL语音准确度待验。只处理本任务，不购买API、不发起递归代理或后台任务。

公开入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/ 。完整源码与证据：GitHub分支 `fix/r24-delivery-20261116`；app固定SHA256 b086a0c5c9610f338d9c5ac86db631b191758c7bc4e7f50228777d6dd5144deb。
