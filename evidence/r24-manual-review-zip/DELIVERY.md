# 当前版手动 Gemini 复验 ZIP 交付核验

本轮仅制作及校验ZIP，Gemini调用0、未改产品；交付链接及版本在AI_CONTEXT.md同任务节。

## package.json

```json
{
  "path": "/workspace/shared/deliverables/TCL-R24-review-stability-Gemini-Review-20261116.zip",
  "zip_bytes": 8163529,
  "zip_sha256": "635c8795c2a8cb0312e0e67f39b40b7fd764f0a8855f5bf20be40c3af0896f81",
  "zip_files": 429,
  "uncompressed_bytes": 12828881,
  "manifest_payload_files": 426,
  "release_identity": {
    "task_id": "TCL-R24-MANUAL-GEMINI-ZIP-20261116",
    "owner": "ChatGPT",
    "packager": "this Codex session",
    "external_Gemini_requests_for_this_pack": 0,
    "main_commit": "93584fa34e4e05906cca5241dd92aa900f7a900d",
    "source_evidence_commit": "9963a554b3eedae0635826a73ce1e1813ca70bdc",
    "implementation_commit": "97d343d0af910506931385b59bc547f217887d60",
    "release_commit": "f6ee029dd2b23265a5504847ab4bcdce6ce56347",
    "product_PR": 121,
    "product_Pages_run": 43951625263,
    "latest_documentation_Pages_run": 43955059858,
    "version": "r24-review-stability-20261116",
    "app_sha256": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
    "css_sha256": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2",
    "archive_zip_sha256": "8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a",
    "archive_b64_sha256": "f31dda6f04a1b32d2e38dba9e6db6b3f0c2d9ed62c84613caef1f7e78be4c3da",
    "app_url": "https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/",
    "current_product_files": 22,
    "total_deployed_assets_as_previously_verified": 217,
    "provenance": "Product bytes equal source/evidence branch and main exact frozen deployment archive; the five critical public resources were independently fetched during packaging. Existing reports are prior evidence, not new test executions.",
    "readback_control": "MANUAL-R24-EB5D4B2C02AAACC8BF7B"
  },
  "new_packaging_checks": [
    "ZIP CRC",
    "exact ZIP byte readback",
    "per-payload SHA256",
    "main archive/source equality22 resources",
    "5 critical public resources HTTP200 and exactbytes",
    "bounded secret/signed-wallet scan"
  ],
  "product_tests_reexecuted": false,
  "gemini_requests_sent": 0,
  "drive_url": "https://drive.google.com/file/d/1fEEhIN8r-7Hq0ccj-hxbi2THt2OfnEdv/view?usp=drivesdk",
  "drive_file_id": "1fEEhIN8r-7Hq0ccj-hxbi2THt2OfnEdv",
  "drive_shared": false,
  "drive_download_roundtrip": "exact byte equality and ZIP CRC pass",
  "drive_roundtrip_sha256": "635c8795c2a8cb0312e0e67f39b40b7fd764f0a8855f5bf20be40c3af0896f81"
}
```

## independent.json

```json
{
  "scope": "Independent read-only ZIP integrity/provenance/manifest audit; extracted to temporary directory and ran verify_package.py only; no product suite, upload, Gemini call or repo change.",
  "zip_path": "/workspace/shared/deliverables/TCL-R24-review-stability-Gemini-Review-20261116.zip",
  "zip_bytes": 8163529,
  "zip_sha256": "635c8795c2a8cb0312e0e67f39b40b7fd764f0a8855f5bf20be40c3af0896f81",
  "checks": {
    "exact_outer_bytes_sha256": true,
    "crc_safe_unique_unencrypted_paths": true,
    "entries": 429,
    "uncompressed_bytes": 12828881,
    "bounded_secret_signed_wallet_scan": {
      "outer_and_embedded_items_scanned": 627,
      "embedded_items": 197,
      "findings": [],
      "scope": "Pattern-based static scan of outer payload and decoded bounded ZIP/TAR staging archives; not a guarantee against arbitrary hidden secrets."
    },
    "verify_package": {
      "returncode": 0,
      "stdout": "PACKAGE PASS 426 payload files",
      "stderr": ""
    },
    "main_archive_product_equality": {
      "main_commit": "93584fa34e4e05906cca5241dd92aa900f7a900d",
      "resource_count": 22,
      "all_bytes_equal": true,
      "app_sha256": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
      "css_sha256": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2"
    },
    "source_branch_product_equality": {
      "source_evidence_commit": "9963a554b3eedae0635826a73ce1e1813ca70bdc",
      "all_22_bytes_equal": true
    },
    "chinese_instructions_identity_readback_consistent": true,
    "public_critical_checks_packaging_report": [
      {
        "path": "app.js",
        "http_status": 200,
        "sha256": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
        "matches": true
      },
      {
        "path": "style.css",
        "http_status": 200,
        "sha256": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2",
        "matches": true
      },
      {
        "path": "static-manifest.json",
        "http_status": 200,
        "sha256": "d44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7",
        "matches": true
      },
      {
        "path": "whisper-worker.mjs",
        "http_status": 200,
        "sha256": "5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b",
        "matches": true
      },
      {
        "path": "whisper-bridge.mjs",
        "http_status": 200,
        "sha256": "01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2",
        "matches": true
      }
    ],
    "sha256sums_entries_verified": 426
  },
  "issues": [],
  "extracted_root": "/workspace/scratch/r24-manual-independent-1vo2cr48",
  "status": "PASS",
  "product_suite_reexecuted": false
}
```

## 可复制复验任务

```text
请独立复验附加ZIP的卡顿、意外缩放和长场练播稳定性。先解压并读《00-先读说明》和 RELEASE_IDENTITY.json，再查源码与测试，勿用旧smooth附件代替。

核对版本：main 93584fa，实施源码97d343d，清单r24-review-stability-20261116；app.js SHA-256应为63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816。请返回实际哈希、包内readback字段和值及相关源码原文。无法读取就说明，勿凭提示推测。

重点检查：
1. 手机16px输入、焦点、长链接/连续文字与横向溢出，是否仍会意外放大或跳动；区分主动手势缩放。
2. 录音→快速切题→结束→复盘→刷新恢复，迟到回调和Worker加载、镜像、串行推理、PCM转移、超时/错误与资源锁，是否串题或阻塞。
3. 20/100/200题复盘分页、进度合并、编辑/音频节点保留、每字立即保存、记录指纹缓存、失败重试和跨标签冲突，是否漏题、丢字或覆盖旧场。
4. 已审核导入题优先、缺题回退示例、型号/SKU/答案/来源隔离、人工修改和清空保护是否保持。

可执行就在临时副本运行适用检查，保存环境、命令、退出码和日志。缺依赖、浏览器或网络标“未运行”；不能执行写“仅静态审查”。旧证据不算本次实跑；保留版本和失败记录，勿把少量性能样本、纯音推理当成全面通过。

请一次返回：读取核验、实际阅读/执行范围；已证实P1/P2缺陷的文件/函数/行号或原文、触发条件、证据、最小修复与必要测试；另列推测、未验证项和发布建议。无缺陷也须说明限制。仅审查，不改产品、部署、购买或调用付费API，不虚构真机、大陆网络或TCL语音准确率验收。

```
