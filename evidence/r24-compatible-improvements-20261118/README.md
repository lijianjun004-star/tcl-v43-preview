# TCL 练播房 R24 兼容优化候选

保留 R24 原界面以及主播、运营选角色后只填姓名的本机流程。发布基线为 `r24-review-stability-20261116`，本次独立候选为 `r24-compatible-improvements-20261118`。

## 变更范围

- R25 的识别超时改进移入 R24。模型初始化、下载或推理超时后终止专用 Whisper Worker，释放占用。该次 Whisper 实例保持停用，原有备用 Vosk 控件可以继续使用。外部注入且无法终止的推理仍保持资源锁。
- 使用 R25 已采用的 OpenCC 词组表，统一「支援」为「支持」、「記憶體」为「内存」等大陆简体用词。型号、SKU、数字和单位通过回归。仅处理新生成的识别文本，原始转写和人工编辑保护仍由原练播逻辑处理。
- 22 个静态文件中的 19 个与冻结安装包逐字节一致，包括 `index.html`、`style.css`、`app.js`、题库以及 Whisper Worker。其余三个是两个识别模块和版本清单。Base／Tiny 选择和现有备用模型操作保持原样。
- 当前线上 R25 与 R24 的静态教学内容完全相同，包括 16 个板块、48 道教学题、25 个示例、65 张历史卡、13 个政策来源和 112 个公开型号。对比覆盖题库、示例话术及解析器。候选沿用 R24 的本机记录格式、数据库和存储键。R25 云端身份及记录仍通过其独立入口使用。

## 实际复验

| 测试 | 结果 |
| --- | --- |
| 原版／候选 UI 对照 | 67 项通过。320、390、430 px 下分别核对网关、两种姓名页及两种首页。15 个可见 DOM 状态和截图完全一致，差异为 0 像素。 |
| 两版业务流程 | 各 21 项通过。虚拟设备实际进入三题练播、录制音视频、模拟转写、晚到结果保护手工编辑、结束复盘、刷新前后解码播放。 |
| 原版数据兼容 | 23 项通过。在同一隔离 localhost 中用原版练播并保存，再切换为候选。原始文字快照和四个 IndexedDB 媒体对象 SHA-256 一致，三题录音和整场录像恢复后均推进播放。 |
| 代码回归 | Node 测试 18/18，通过转写队列、缓存、导入来源、词表及并发。独立确定性测试另测 Worker 11/11、简体转换 12/12。两个原断言随本次预期行为调整，分别改为验证实际 Worker 终止和「支援→支持」。 |
| 浏览器 Worker 资源释放 | 2/2。用真实 Chromium Worker、挂起的模拟模型运行时和合成 PCM 分别触发加载与推理超时。两次 Worker 均实际关闭，资源锁解除，重复请求未发起新加载。首轮夹具匹配错误文字时多写了空格，纠正后重跑，产品文件没有变更。 |
| 真实 Base／Tiny | 两款均用冻结权重和新的桥接模块处理同一条 7.765 秒公开普通话电话录音。Base 字符错误 3/22，Tiny 错 11/22，与冻结版同样本相同。 |

实体手机、物理音视频设备、大陆网络和 TCL 口播准确率未验收。真实识别测试使用公开语料。[PolyAI minds14，CC BY 4.0](https://huggingface.co/datasets/PolyAI/minds14)

## 试用与回退

候选安装包共 22 文件，252,850 字节。SHA-256 为 `feaeb7e6e8bfe097c7c2da743488bf63405e5275a337d81127ecc0744da0ec63`。Drive 回读、ZIP CRC 与文件清单已核对。可解压到独立文件夹，从解压根目录运行 `python3 -m http.server 8874 --bind 127.0.0.1`，然后打开 `http://127.0.0.1:8874/tcl-v352-asr-r24-qa/`。试用请使用独立的临时本机地址。

候选 PR 以历史 R24 源码分支 `fix/r24-review-stability-20261116` 的 `9963a554b3eedae0635826a73ce1e1813ca70bdc` 为基线，仅供代码评审，正式发布另行确认。当前 main `b6e2ec8736bbb48d995202b9b8567902326a915d` 及 Pages 继续提供原始 R24 和现有 R25。原版回滚 ZIP SHA-256 为 `8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a`。

[候选试用 ZIP](https://drive.google.com/file/d/1HSuGJJm85JOhS3qzVAn4X9LyKWNYqeZR/view?usp=drivesdk) · [原版回滚 ZIP](https://drive.google.com/file/d/1PTeS3N7K29v0iZ9gmiMywN_c3ThFqomo/view?usp=drivesdk) · [当前线上 Pages](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/44253745220)
