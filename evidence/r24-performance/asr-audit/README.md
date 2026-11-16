# 语音路径只读性能审查

审查基线 app：`d090543e3bdd010dfa95580c4f6a5dcd7185f116225ff02674120954c10cbecf`。
最初只读阶段没有修改产品、没有重新下载模型、没有调用付费 API 或 Gemini。后续有界试验见下文；产品始终未改。

**已确认的放大路径**：Whisper 下载事件直接触发 `renderTurnStatus`，基线随后重建整张逐题复盘表。保留的真实桌面 Chromium 记录中，Base 有 1195 次总进度回调，其中 1186 次为下载；Tiny 有 574 次总回调，其中 565 次为下载。其耗时数据是过去的完整转写墙钟时间，不能作为本轮主线程长任务或手机流畅度证明。原始文件路径、哈希和统计见 `audit.json`。

建议由 app owner 合并下载进度的界面更新（例如每100–200ms至多一次）；文字状态仍更新，终态、错误和会话所属校验不延迟。按可见阶段/受影响行更新复盘可以同时去掉高成本的全表重建。

**Whisper 执行位置的边界**：`whisper-bridge.mjs` 在页面中导入 Transformers.js 3.8.1，选择 `device:'wasm'`，没有配置独立 Worker 或 WASM proxy。固定版本官方 `src/backends/onnx.js` 第217–219行明确说明 proxy 可防界面冻结，并将 `ONNX_ENV.wasm.proxy` 默认设为 false；该对象导出为 `env.backends.onnx`。因此 `await` 不代表把计算移到了页面外。这里只确认架构，尚未测出当前用户设备上模型推理的主线程长任务大小。

`upstream-sources.json` 保存本次读取的官方版本 URL、时间、HTTP状态和内容哈希。两份上游源码仅作为资料，未执行。若以后评估启用 `env.backends.onnx.wasm.proxy=true`，需单独通过真实浏览器初始化、推理、取消/超时和媒体回归，不能仅凭这个开关宣称手机流畅度已验证。

**Vosk 与音频准备**：Vosk 只在12个文件完成时刷新进度，11个下载阶段事件被忽略；不是 Whisper 那种每个数据块重绘。真实 AudioBuffer 采用单次 OfflineAudioContext 原生混音/重采样，JS仍有PCM扫描与复制，但没有证据表明它是本轮主要卡顿来源。没有改动识别模型、精度或资源互斥机制。

## 有界人工运行时试验

使用同一固定 Transformers.js 3.8.1 浏览器包，通过 AutoModel 执行手工生成的223字节 ONNX MatMul（1024×1024，非学习权重）。单线程 WASM，每种配置预热一次、记录三次，不下载真实语音模型。

- proxy=false：三次运行84.9–90.7ms，推理期间页面10ms定时心跳为0，观测到90/86/85ms长任务，无Worker。
- proxy=true：三次运行88.6–101ms，推理期间10ms心跳各8/9/8次，最大心跳间隔26.3ms，测量窗内无长任务，观测到1个Blob Worker。
- 六次均验证输出形状与首尾值128，页面错误0。这里证明人工算子可以移到Worker，**不证明Whisper decoder缓存跨线程传输的兼容性或真机流畅度**，也不宣称运算更快。

完整脚本与结果：`proxy_runtime_probe.py`、`proxy-runtime-result.json`。第一次测量含初始化任务与测量窗重叠，原始结果与脚本留在 `proxy-runtime-attempt-01.*`；最终版本明确只计起点之后的长任务。生成的ONNX文件位于scratch，可由脚本重建，不作为产品资源。

## 有界真实 Tiny 候选：访问失败后停止

按root后续授权，仅在scratch复制bridge并添加 `env.backends.onnx.wasm.proxy=true`，使用既有公开银行电话样本和固定Tiny revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`。测试使用现有单镜像模式，保证失败不会自动尝试第二主机。

首个样本在模型初始化前失败：hf-mirror的config/tokenizer/preprocessor资源返回浏览器 `net::ERR_FAILED`。没有得到可用模型，没有创建模型Worker，完成推理0次。按约定停止，没有改用其他主机或重复请求来重试。未据此推测失败原因。

原始结果和日志见 `whisper-proxy-result.json`、`whisper-proxy-run.log`；测试脚本 `whisper_proxy_probe.py` 可追溯候选bridge哈希。结论见 `verdict.json`：**本轮不应仅凭人工算子通过就启用产品proxy开关**。下载进度合并、输入保存和复盘渲染的独立修复可继续；Whisper主线程架构仍是明确未解决的边界。付费API调用0次、Gemini调用0次。
