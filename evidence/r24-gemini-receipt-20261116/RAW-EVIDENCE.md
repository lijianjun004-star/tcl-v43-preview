# Gemini 返回包原始证据

原件不作更正；结论以 RECEIPT.md 对照审查为准。以下JSON为附件原文，非本轮ChatGPT实际执行日志。

## 01-gemini-sandbox-execution-log.json

SHA-256 `17be342ebe77a2a53d29579ca485fe1fa32d0b83820ea4fd79277673796e4fb6`；字节数 17701。

```json
{
  "environment": {
    "os": "Linux ace 6.12.105+ #1 SMP Sat Sep 19 19:37:41 UTC 2026 x86_64 GNU/Linux",
    "python": "Python 3.11.2",
    "node": "v18.20.4",
    "working_copy": "/tmp/r24_exec_copy",
    "network_outbound": false
  },
  "outer_zip_sha256": "635c8795c2a8cb0312e0e67f39b40b7fd764f0a8855f5bf20be40c3af0896f81",
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
  "static_manifest_version": "r24-review-stability-20261116",
  "static_manifest_all_22_matched": true,
  "static_manifest_files": [
    {
      "file": "app-config.json",
      "expected": "52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511",
      "actual": "52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511",
      "match": true
    },
    {
      "file": "app.js",
      "expected": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
      "actual": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
      "match": true
    },
    {
      "file": "asr-glossary.mjs",
      "expected": "cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245",
      "actual": "cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245",
      "match": true
    },
    {
      "file": "asr-normalize.mjs",
      "expected": "9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13",
      "actual": "9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13",
      "match": true
    },
    {
      "file": "glossary-ui.mjs",
      "expected": "e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb",
      "actual": "e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb",
      "match": true
    },
    {
      "file": "index.html",
      "expected": "39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e",
      "actual": "39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e",
      "match": true
    },
    {
      "file": "legacy-65.json",
      "expected": "d122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f",
      "actual": "d122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f",
      "match": true
    },
    {
      "file": "lib/parser.js",
      "expected": "8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8",
      "actual": "8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8",
      "match": true
    },
    {
      "file": "lib/pdf.js",
      "expected": "3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b",
      "actual": "3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b",
      "match": true
    },
    {
      "file": "lib/qa-import.js",
      "expected": "fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86",
      "actual": "fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86",
      "match": true
    },
    {
      "file": "lib/xls.js",
      "expected": "11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c",
      "actual": "11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c",
      "match": true
    },
    {
      "file": "lib/zip.js",
      "expected": "5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4",
      "actual": "5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4",
      "match": true
    },
    {
      "file": "r23-model-choice.js",
      "expected": "c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596",
      "actual": "c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596",
      "match": true
    },
    {
      "file": "style.css",
      "expected": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2",
      "actual": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2",
      "match": true
    },
    {
      "file": "training-boards.json",
      "expected": "e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11",
      "actual": "e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11",
      "match": true
    },
    {
      "file": "vendor/opencc/LICENSE",
      "expected": "960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e",
      "actual": "960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e",
      "match": true
    },
    {
      "file": "vendor/opencc/LICENSES/Apache-2.0.txt",
      "expected": "b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308",
      "actual": "b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308",
      "match": true
    },
    {
      "file": "vendor/opencc/THIRD_PARTY_LICENSES.md",
      "expected": "42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806",
      "actual": "42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806",
      "match": true
    },
    {
      "file": "vendor/opencc/t2cn.mjs",
      "expected": "b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6",
      "actual": "b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6",
      "match": true
    },
    {
      "file": "whisper-bridge.mjs",
      "expected": "01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2",
      "actual": "01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2",
      "match": true
    },
    {
      "file": "whisper-worker.mjs",
      "expected": "5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b",
      "actual": "5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b",
      "match": true
    }
  ],
  "executions": [
    {
      "label": "verify_package.py",
      "command": "python3 verify_package.py",
      "exit_code": 0,
      "stdout": "PACKAGE PASS 426 payload files",
      "stderr": ""
    },
    {
      "label": "release-ci/test_release_guard.py",
      "command": "python3 release-ci/test_release_guard.py",
      "exit_code": 0,
      "stdout": "verify-pages-release PASS: exact R2.4 static bundle; all preceding stages preserved\nR24_STAGE_PASS {\"app_sha\": \"5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29\", \"files\": 3, \"old_assets_unchanged\": 4}\nverify-pages-release PASS: exact R2.4 same-route update/rollback; old pages unchanged\nR24_STAGE_PASS {\"app_sha\": \"5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29\", \"files\": 5, \"old_assets_unchanged\": 4}\nR24_STAGE_PASS {\"app_sha\": \"f4918c8ac9858f83b2c0307536179d6bd283bc7c20ba34b53074721f43611f4a\", \"files\": 5, \"old_assets_unchanged\": 4}\nR24_UPDATE_PASS {\"changed\": [\"tcl-v352-asr-r24-qa/app.js\", \"tcl-v352-asr-r24-qa/lib/parser.js\", \"tcl-v352-asr-r24-qa/lib/qa-import.js\", \"tcl-v352-asr-r24-qa/static-manifest.json\"], \"direction\": \"update\", \"protected_assets\": 4, \"total_assets\": 9}\nR24_STAGE_PASS {\"app_sha\": \"f4918c8ac9858f83b2c0307536179d6bd283bc7c20ba34b53074721f43611f4a\", \"files\": 5, \"old_assets_unchanged\": 4}\nR24_STAGE_PASS {\"app_sha\": \"5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29\", \"files\": 5, \"old_assets_unchanged\": 4}\nR24_UPDATE_PASS {\"changed\": [\"tcl-v352-asr-r24-qa/app.js\", \"tcl-v352-asr-r24-qa/lib/parser.js\", \"tcl-v352-asr-r24-",
      "stderr": "test_asr_addition_preserves_existing_files (__main__.ASRReleaseGateTests.test_asr_addition_preserves_existing_files) ... ok\ntest_asr_after_release_is_immutable (__main__.ASRReleaseGateTests.test_asr_after_release_is_immutable) ... ok\ntest_asr_manifest_and_allowlist_enforced (__main__.ASRReleaseGateTests.test_asr_manifest_and_allowlist_enforced) ... ok\ntest_asr_namespace_is_distinct_from_r4 (__main__.ASRReleaseGateTests.test_asr_namespace_is_distinct_from_r4) ... ok\ntest_each_baseline_file_cannot_change_or_disappear (__main__.ASRReleaseGateTests.test_each_baseline_file_cannot_change_or_disappear) ... ok\ntest_pinned_sources_and_workflow_are_restrictive (__main__.AutoqaGateTests.test_pinned_sources_and_workflow_are_restrictive) ... ok\ntest_patch_is_two_source_files_only (__main__.AutoqaNamespaceFixGateTests.test_patch_is_two_source_files_only) ... ok\ntest_actual_output_bound (__main__.GateTests.test_actual_output_bound) ... ok\ntest_crc_mismatch (__main__.GateTests.test_crc_mismatch) ... ok\ntest_exact_asr_accessible_end_dialog_release (__main__.GateTests.test_exact_asr_accessible_end_dialog_release) ... ok\ntest_exact_asr_restart_device_preview_and_digit_release (__main__.GateTests.test"
    },
    {
      "label": "evidence/r6-autoqa/run_static_checks.mjs",
      "command": "node evidence/r6-autoqa/run_static_checks.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r6-autoqa/run_static_checks.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r6-autoqa/verify_whisper_worker_protocol.mjs",
      "command": "node evidence/r6-autoqa/verify_whisper_worker_protocol.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r6-autoqa/verify_whisper_worker_protocol.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r6-autoqa/verify_model_source_fallback.mjs",
      "command": "node evidence/r6-autoqa/verify_model_source_fallback.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r6-autoqa/verify_model_source_fallback.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r6-autoqa/verify_Glossary_ASR.mjs",
      "command": "node evidence/r6-autoqa/verify_Glossary_ASR.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r6-autoqa/verify_Glossary_ASR.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r6-autoqa/verify_no_Paid_API.mjs",
      "command": "node evidence/r6-autoqa/verify_no_Paid_API.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r6-autoqa/verify_no_Paid_API.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r24-qa-import/tests/parser-Extract-Tests.mjs",
      "command": "node evidence/r24-qa-import/tests/parser-Extract-Tests.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r24-qa-import/tests/parser-Extract-Tests.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r24-qa-import/tests/practice_pool.mjs",
      "command": "node evidence/r24-qa-import/tests/practice_pool.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r24-qa-import/tests/practice_pool.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r24-qa-import/tests/test_pdf_Streams.mjs",
      "command": "node evidence/r24-qa-import/tests/test_pdf_Streams.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r24-qa-import/tests/test_pdf_Streams.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "evidence/r24-qa-import/tests/verify_no_paid_apis.mjs",
      "command": "node evidence/r24-qa-import/tests/verify_no_paid_apis.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/evidence/r24-qa-import/tests/verify_no_paid_apis.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "tests/unit/test_compliance.mjs",
      "command": "node tests/unit/test_compliance.mjs",
      "exit_code": 1,
      "stdout": "",
      "stderr": "node:internal/modules/cjs/loader:1143\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/r24_exec_copy/tests/unit/test_compliance.mjs'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)\n    at Module._load (node:internal/modules/cjs/loader:981:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v18.20.4"
    },
    {
      "label": "tests/playwright/session_smooth_recovery.py (blocked check)",
      "command": "python3 tests/playwright/session_smooth_recovery.py",
      "exit_code": 2,
      "stdout": "",
      "stderr": "python3: can't open file '/tmp/r24_exec_copy/tests/playwright/session_smooth_recovery.py': [Errno 2] No such file or directory"
    },
    {
      "label": "evidence/r24-performance/independent/record-cache.py (blocked check)",
      "command": "python3 evidence/r24-performance/independent/record-cache.py",
      "exit_code": 2,
      "stdout": "",
      "stderr": "python3: can't open file '/tmp/r24_exec_copy/evidence/r24-performance/independent/record-cache.py': [Errno 2] No such file or directory"
    }
  ]
}
```

## 02-RELEASE_IDENTITY.json

SHA-256 `cf20384de4f3798440740822ca95a150e02954dc752eac3ed54841af9caca8f2`；字节数 1409。

```json
{
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
}

```

## 03-static-manifest.json

SHA-256 `d44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7`；字节数 2015。

```json
{
  "version": "r24-review-stability-20261116",
  "files": {
    "app-config.json": "52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511",
    "app.js": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
    "asr-glossary.mjs": "cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245",
    "asr-normalize.mjs": "9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13",
    "glossary-ui.mjs": "e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb",
    "index.html": "39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e",
    "legacy-65.json": "d122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f",
    "lib/parser.js": "8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8",
    "lib/pdf.js": "3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b",
    "lib/qa-import.js": "fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86",
    "lib/xls.js": "11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c",
    "lib/zip.js": "5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4",
    "r23-model-choice.js": "c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596",
    "style.css": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2",
    "training-boards.json": "e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11",
    "vendor/opencc/LICENSE": "960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e",
    "vendor/opencc/LICENSES/Apache-2.0.txt": "b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308",
    "vendor/opencc/THIRD_PARTY_LICENSES.md": "42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806",
    "vendor/opencc/t2cn.mjs": "b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6",
    "whisper-bridge.mjs": "01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2",
    "whisper-worker.mjs": "5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b"
  }
}

```

## SHA256SUMS.txt

SHA-256 `4c87a13dcf7af4c44533a5b9b0a5a2730397770c6940ac60248a534610160a33`；字节数 400。

```text
d867c568a4333f95156ac208d2507334f5accb228a38ca06008c736e7b8d8c9a  00-GEMINI-R24-REVIEW-STABILITY-REPORT-20261116.md
17be342ebe77a2a53d29579ca485fe1fa32d0b83820ea4fd79277673796e4fb6  01-gemini-sandbox-execution-log.json
cf20384de4f3798440740822ca95a150e02954dc752eac3ed54841af9caca8f2  02-RELEASE_IDENTITY.json
d44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7  03-static-manifest.json

```

## ChatGPT 本轮新增公网哈希读取

实际读取时间 2026-11-16T21:36:53.775157+00:00；仅HTTP与hash，不是功能或真机测试。

```json
{
  "main_commit": "3277519a917e8bea8aa7fa5846b4348d8627353d",
  "latest_pages_run": 43958381029,
  "release_archive_sha256": "8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a",
  "checks": [
    {
      "path": "app-config.json",
      "http_status": 200,
      "local_sha256": "52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511",
      "public_sha256": "52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "app.js",
      "http_status": 200,
      "local_sha256": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
      "public_sha256": "63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "asr-glossary.mjs",
      "http_status": 200,
      "local_sha256": "cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245",
      "public_sha256": "cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "asr-normalize.mjs",
      "http_status": 200,
      "local_sha256": "9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13",
      "public_sha256": "9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "glossary-ui.mjs",
      "http_status": 200,
      "local_sha256": "e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb",
      "public_sha256": "e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "index.html",
      "http_status": 200,
      "local_sha256": "39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e",
      "public_sha256": "39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "legacy-65.json",
      "http_status": 200,
      "local_sha256": "d122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f",
      "public_sha256": "d122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "lib/parser.js",
      "http_status": 200,
      "local_sha256": "8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8",
      "public_sha256": "8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "lib/pdf.js",
      "http_status": 200,
      "local_sha256": "3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b",
      "public_sha256": "3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "lib/qa-import.js",
      "http_status": 200,
      "local_sha256": "fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86",
      "public_sha256": "fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "lib/xls.js",
      "http_status": 200,
      "local_sha256": "11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c",
      "public_sha256": "11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "lib/zip.js",
      "http_status": 200,
      "local_sha256": "5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4",
      "public_sha256": "5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "r23-model-choice.js",
      "http_status": 200,
      "local_sha256": "c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596",
      "public_sha256": "c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "style.css",
      "http_status": 200,
      "local_sha256": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2",
      "public_sha256": "35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "training-boards.json",
      "http_status": 200,
      "local_sha256": "e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11",
      "public_sha256": "e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "vendor/opencc/LICENSE",
      "http_status": 200,
      "local_sha256": "960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e",
      "public_sha256": "960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "vendor/opencc/LICENSES/Apache-2.0.txt",
      "http_status": 200,
      "local_sha256": "b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308",
      "public_sha256": "b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "vendor/opencc/THIRD_PARTY_LICENSES.md",
      "http_status": 200,
      "local_sha256": "42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806",
      "public_sha256": "42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "vendor/opencc/t2cn.mjs",
      "http_status": 200,
      "local_sha256": "b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6",
      "public_sha256": "b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "whisper-bridge.mjs",
      "http_status": 200,
      "local_sha256": "01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2",
      "public_sha256": "01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "whisper-worker.mjs",
      "http_status": 200,
      "local_sha256": "5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b",
      "public_sha256": "5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b",
      "manifest_matches_local": true,
      "public_matches_local": true
    },
    {
      "path": "static-manifest.json",
      "http_status": 200,
      "local_sha256": "d44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7",
      "public_sha256": "d44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7",
      "manifest_matches_local": true,
      "public_matches_local": true
    }
  ],
  "note": "Fresh HTTP/hash checks only, no product functional suite or real-device tests."
}
```
