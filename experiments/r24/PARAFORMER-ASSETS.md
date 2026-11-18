# Paraformer-small：固定资源与本地安装

用于独立 R24 轻量候选，仅准备本地静态资源，不发布、不修改现有线上版本，
不调用付费 API。运行在浏览器 Worker 中，无需自建推理服务器。

固定官方 **sherpa-onnx v1.12.20 Paraformer-small** 单线程 SIMD 浏览器包。
其中 81,828,675-byte 模型和 75,352-byte tokens 与此前 native small
实测文件逐字节相同；不用大型 Paraformer 或 SenseVoice 权重替代。

## 安装与复验

Python 3.9+ 标准库即可，从仓库根目录执行：

```sh
python3 experiments/r24/stage_paraformer_assets.py \
  --archive /path/to/paraformer-small-v1.12.20.tar.bz2
python3 experiments/r24/stage_paraformer_assets.py --verify-only
```

提供 `--archive` 时不联网；不提供时仅下载清单固定的官方 GitHub 包，
缓存到系统临时目录。缓存和新下载均验证整个包的固定大小与 SHA256，
成功后才流式读取允许清单中的四个普通文件，不执行代码、不解包路径
或链接。每项资源再次验证，全部成功后才原子切换目标目录。

默认目标 `experiments/r24/tcl-v352-asr-r24-qa/vendor/paraformer/`；
可用 `--dest /path/to/site/vendor/paraformer` 指定独立候选。
已有目标必须完全匹配固定文件和许可文本；遇到修改或未知文件时拒绝覆盖。

```sh
python3 experiments/r24/stage_paraformer_assets.py --verify-only \
  --zip /path/outside/repository/TCL-R24-Paraformer-small-assets.zip
```

生成具有固定路径、顺序、日期与权限的离线资源 ZIP，并输出实际 SHA256。
解压到 site 根目录即可补齐 `vendor/paraformer/`。不同 zlib 版本可能影响
ZIP 压缩字节，解压后的逐文件 SHA256 是跨环境资源身份。
输出不得位于资产源目录内，也不会覆盖已有 ZIP。

## 精确身份和大小

官方 asset ID：329855920；包大小 80,161,695 bytes；官方 SHA256：
`be25b1ef4dcb7a037cf6954ad878737ce7842fa0b512c991ebd39b95d2e6d548`。

固定 `paraformer-support/manifest.json`（1,273 bytes）SHA256：
`9a9538a91e1ba4230577d1a4410fe4ac429039ced6478af15346e378cedc6df2`。
Worker 固定该清单哈希；验证资源后使用 `Module.wasmBinary` 和
`Module.getPreloadedPackage`，避免原 loader 的额外网络请求。

API JS 41,274、runtime JS 95,311、WASM 11,539,169、data 82,547,881 bytes，
共 94,223,635 bytes（约 89.86 MiB），比 SenseVoice 对应四项减少约 62.6%。
data 小于 100 MB，无需分片；保留上游原始字节。模型大文件与离线 ZIP
不提交进 Git；小型源码携带脚本、固定清单及许可即可复现。

## 内存和许可

官方 WASM 与 SenseVoice 包使用相同二进制，初始线性内存仍为 512 MiB，
可增长至 2 GiB；模型缩小不等于这项初始内存已降低。
手机内存、真实录音与大陆下载仍需单独验收。

runtime 的 Apache-2.0、ONNX Runtime / Silero 的 MIT 与模型许可分别处理。
精确 small ONNX 转换源的公开仓库没有 LICENSE 或非空许可字段；
不能把另一个 `funasr/paraformer-zh` 模型卡的 Apache 标注套用在这里。
其 README 准确引用的 DAMO 基础模型在官方 ModelScope API 中标注
Apache License 2.0；这项祖先来源证据与转换仓库本身缺少许可的事实分别保留。
随包保留精确来源、模型名、已取得的运行时许可及完整第三方声明，
详见 `paraformer-support/NOTICE.md`、`license-sources.json`。
