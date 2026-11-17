# R25 注册恢复修复已部署（2026-11-17）

任务 TCL-R25-REGISTRATION-RECOVERY-DEPLOY-20261117。用户此前“上传吧”已授权同范围正式部署，并确认目标CloudBase控制台登录。ChatGPT统筹/Codex实现与云端执行，内部独立检查及GitHub发布；新增外部Gemini/Claude业务请求0、付费模型API0，无新环境、托管、域名或套餐。

入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/
版本：r25-registration-recovery-20261117。

## 实际执行

1. 正式CloudBase授权及国内上海环境核对通过；原Event函数r25wf_name_identity，Nodejs20.19、128MiB、60秒、index.main，原执行角色、环境变量、路由/CORS不变。旧函数代码/config、原14张业务和身份表19行完整数据、函数定义/列信息已私有备份；不将备份或凭据上传仓库。
2. 初次迁移使用runtime service_role而报FailedOperation.PGExecuteSqlError；只读确认字段仍NOT NULL/003不存在。查询确认原表owner与runtime角色不同；使用官方ExecutePGSql管理默认所有者通道成功执行审定002→003，没有放大runtime角色权限。此错误作为部署工具选择失败保留，不当作产品测试失败，也没有重跑001/schema/存储脚本。
3. 官方SDK COS路径更新原函数，installDependency=false，保留打包生产依赖；等待Active。实际回下载index/handler/provider与冻结源码哈希一致，配置逐项不变。
4. 独立只读核验003两份函数prosrc、SECURITY DEFINER/search_path、PUBLIC/anon/authenticated禁执行与service_role准入、invite成对可空；原14表19行逐行MD5多重集保留。测试账号退役后再次通过。
5. GitHub CI139精确head d5d57ae5983c9ffd25ec60c2c4a4f0c967f44d82，检查44101980262成功；merge8981781e4366611fdfe46af69c8172e7e5969ea9。
6. 最新main上独立发行PR140只替换一份experiments/r25-release/site-only.zip.b64，head1a30cd054c97f73cd7c1bdb70f44d6df86501215；检查44113534312成功，精确head合并a0f5b819fa9a107facb6bb1e71d80dbdffc24967。Pages44113696230成功。未整体合并源码分支，根site.zip和workflow保持。
7. 真实公网246/246资源首轮HTTP200且SHA一致，旧217资源保留，0失败/0补读；含4次首尾锚点共250次HTTP请求，版本稳定。

## 实测（分开报告，不合并通过率）

- 真实云端身份/SQL/Native恢复：36/36。直接主播/运营注册、admin公开注册拒绝、预约无Native及已真实创建Native但未业务finalize两条恢复、旧proof拒绝、新proof同role/username/UID完成、ready不可重发。已建Native窗口是受控管理调用后恢复，不宣称注入实际服务器崩溃。
- 官方SDK浏览器真实Auth/业务：18/18。五账号独立会话登录、服务me同UID/role、提交真实回执、幂等同回执、收件运营可读、无关运营/主播拒绝、文字反馈持久化。
- 实际候选SDK适配器+Auth/PG/Storage（合成管理侧测试admin）：19/19。管理员ID全集与权威只读列表一致，3244字节合成WAV私有上传，owner/接收运营/admin逐字节SHA下载一致，无关运营不能读提交或附件。仅静态适配器在批准origin以本地候选文件加载，API/SDK成功响应均非模拟；这组不冒充真实产品UI。
- 最终公开产品UI：29/29。无配置/SDK/成功响应注入、无请求拦截；真实恢复码校验、清空输入、同操作/secret/UID继续、首次密码登录、实际me UID/role、四角色工作台及合成收件范围；重要静态响应哈希均为发行版本，0页面异常/0模型请求。390px手机模拟不是物理手机。
- 独立数据库复核：2个函数、14表、19个原行，部署后及测试退役后均PASS。之前本地54/20/102/1/7+7/162分别见上一层verification，不能与云断言合为一个比例。

## 测试账户与数据

仅本轮明确R25恢复验收前缀的5个注册账号及1个可信管理侧测试admin；逐一核验operationId/UID/native username/Description marker/role后封禁Native并业务active=false。实际回读6/6 BLOCKED、6/6 inactive；不影响原账号。所有浏览器context关闭。

为保留不可变提交策略，没有删除任何数据。保留2条明确合成验收提交、反馈、1个3244字节合成私有WAV及其预约/身份记录；不会再作为可选active收件运营。管理员仍可看到标识为验收的合成记录。原14表19行保持不变。私有fixture含随机测试密码/恢复秘密，不上传仓库、网盘或聊天。

## NOT RUN

物理iPhone/Android、真实大陆网络、真实麦克风/相机与ASR准确率、原正式账号首次密码的实际登录、PostgreSQL多连接竞争调度未在本轮验收。测试admin证明真实admin角色边界，不等于原管理员密码登录。保留早期历史失败及NOT RUN，不覆盖为通过。

## 回退

仅经独立PR回退前端到邻近已审定name-invite归档（B64dee92ada…）；保留002/003及兼容identity handler恢复能力。不得恢复001/旧handler、删直接预约、清浏览器或重建原账号。停止新增注册须在另一个明确变更中限制register而保留status/resolve。

## 证据及复现

本目录JSON/JSONL均为允许字段投影或公开GitHub/静态资源证据，不含原数据、凭据或私有fixture。reproduce/是本轮实际执行工具源码快照，包含当前绝对路径，复现须先审阅和替换路径；默认dry-run的工具不会云写，带--execute及deploy脚本会产生相应明确操作，不能直接当作只读脚本批量运行。
