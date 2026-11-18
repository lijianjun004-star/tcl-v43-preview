# SenseVoiceSmall：固定资源与离线安装

此脚本仅准备本地候选的模型资源，不修改现有线上文件、不发布站点，
也不调用付费 API。识别在浏览器 Worker 内执行；普通静态 HTTP 即可提供
这些同源文件，无需自建推理服务、跨源隔离响应头或账号。

使用官方 sherpa-onnx **v1.12.20** 的单线程 SIMD SenseVoiceSmall int8
浏览器发行包，不混用本机 Python 的 sherpa-onnx 2.0.1 运行时。

## 复现

从仓库根目录运行（Python 3.9+，只需标准库）：

```sh
python3 experiments/r24/stage_sensevoice_assets.py \
  --archive /path/to/sensevoice-v1.12.20.tar.bz2
```

已有 archive 时完全不访问网络。不传 `--archive` 时，脚本只从清单中固定的
官方 GitHub Release URL 下载，使用系统临时目录中的独立缓存。
任何已有缓存也必须通过相同大小及 SHA256 校验。

默认安装到 `experiments/r24/tcl-v352-asr-r24-qa/vendor/sensevoice/`；
可用 `--dest /path/to/site/vendor/sensevoice` 指定其他独立候选。
脚本先验证整个压缩包，再流式读取允许清单中的四个普通文件，
不执行包中代码、不解包路径或符号链接。三个数据分片也分别检查
大小和 SHA256，再核对拼接后的原始数据；全部成功后才切换安装目录。
若目录已存在，则逐字节身份校验；发现未知或修改后的文件即失败，
不会覆盖该目录。

```sh
python3 experiments/r24/stage_sensevoice_assets.py --verify-only
python3 experiments/r24/stage_sensevoice_assets.py --verify-only \
  --zip /path/outside/repository/TCL-R24-SenseVoice-assets.zip
```

第二条命令生成确定性 ZIP（固定路径、日期、顺序、权限），并输出实际
大小和 SHA256。解压到对应 site 根目录即可恢复 `vendor/sensevoice/`。
ZIP 压缩字节仍受本机 zlib 版本影响；解压后每项资源的固定 SHA256
才是跨环境内容身份。

## 固定身份和传输

官方包 SHA256：
`b3d47b2dbfef23c09b2fd20dc4eb82b6a07c763c9b0197e92dea736bc981eb5b`
（165,723,573 bytes，GitHub 官方 asset digest）。

小型资源清单 `sensevoice-support/manifest.json` SHA256：
`d63e3d6c587d49ac5a14508465afbb55db6a4f7e26cee934238e7b5ada43a90e`。
Worker 应固定这份清单哈希，校验资源后使用原始 loader 支持的
`Module.wasmBinary` / `Module.getPreloadedPackage`，避免隐式二次请求。

必需文件：API JS 41,274 bytes、loader JS 95,318 bytes、WASM 11,539,169
bytes、data 240,193,589 bytes，总计 251,869,350 bytes（约 240.2 MiB）。
data 按 80 MiB、80 MiB、约 69.1 MiB 拆成三个 `.bin` 文件；没有单个
文件超过 100 MB。分片仅解决传输和文件大小，浏览器仍需完整模型。
不要把大文件或资源 ZIP 提交进源码分支；单独保存离线资产包，
小型源码包携带脚本、固定清单及许可文件即可复现。

## 许可与实际边界

runtime 是 Apache-2.0；SenseVoiceSmall 模型采用 FunASR 模型协议 v1.1，
二者不能混为一个许可。随包保留完整模型许可、来源、模型名，
以及 ONNX Runtime、Silero VAD 和第三方声明；详见
`sensevoice-support/NOTICE.md` 与 `license-sources.json`。

上游构建使用 512 MiB 初始 WASM 内存并允许增长，另外还需下载缓冲和
模型内存。资源可复现与桌面浏览器通过不等于低内存手机已验收。
首次下载的耗时、国内网络可达性、手机内存/录音、页面关闭中断恢复，
仍需分别以真实设备测试；本脚本不作这些测试结果的替代。
