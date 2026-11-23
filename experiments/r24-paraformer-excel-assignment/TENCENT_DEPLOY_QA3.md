# R24 Excel QA3 → 腾讯云 CloudBase 静态托管｜部署说明

用户 2026-11-23 决定：由用户或 Codex 在已登录腾讯云的环境部署，Claude 部署后做公网核验。

## 目标与边界

| 项 | 值 |
|---|---|
| 环境 | 上海 `unknown-roadrunner-d7cap6e21f517`（已有静态托管） |
| 新目录 | `tcl-r24-paraformer-excel-qa/`（与 GitHub 测试站同名） |
| 版本 | `r24-paraformer-excel-assignment-20261123-qa3-review-fixes` |
| 内容 | 36 个文件：32 个前端 + 4 个固定 Paraformer 模型，与 GitHub 测试站逐字节相同 |
| 不得改动 | 已有目录 `tcl-r24-paraformer/` 等其他静态目录、数据库、云函数、域名、R25 |

- **禁止** `tcb hosting deploy --prune`：它会删除本次发布以外的远端文件，可能误删其他目录。
- 目标目录上传前必须为空。如果不为空，**停止并报告**，不要覆盖。

## 0. 前提

Python 3、Node.js、git、`curl`、`sha256sum`；CloudBase CLI 3.9.3（`npm i -g @cloudbase/cli@3.9.3`），已登录国内站，并有该环境的权限（`tcb login`，默认走设备授权）。

## 1. 取固定源码与发行包

```bash
git clone https://github.com/lijianjun004-star/tcl-v43-preview.git && cd tcl-v43-preview
git checkout 5c3de29946777454cca367d15abe7db6cd6723f5   # 或更新的 main，但下一行哈希必须一致
echo "65ce635c9987c033d0963502a88ee56795a5afcdd0308ca5bab116e3b04eeaa9  experiments/r24-paraformer-excel-release/site-only.zip" | sha256sum --check --strict
git show origin/claude/paraformer-excel-qa-verify-mum367:experiments/r24-paraformer-excel-assignment/tools/verify_public_route.py > /tmp/verify_public_route.py
```

## 2. 下载固定模型并生成 36 个文件（与 Pages 部署用同一个带校验的暂存命令）

```bash
MODEL=/tmp/r24-paraformer-model.tar.bz2
curl --fail --location --silent --show-error --retry 3 --max-time 300 --max-filesize 80161695 \
  --proto "=https" --proto-redir "=https" --output "$MODEL" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-wasm-simd-1.12.20-vad-asr-zh_en-paraformer_small.tar.bz2"
echo "be25b1ef4dcb7a037cf6954ad878737ce7842fa0b512c991ebd39b95d2e6d548  $MODEL" | sha256sum --check --strict
rm -rf _cb && mkdir _cb
python3 release-ci/release_guard.py --stage-r24-paraformer-excel _cb experiments/r24-paraformer-excel-release/site-only.zip "$MODEL"
# 期望输出：R24_PARAFORMER_STAGE_PASS {"files": 36, ...}
find _cb/tcl-r24-paraformer-excel-qa -type f | wc -l   # 期望 36
```

上传前可先在本机核验一遍：

```bash
(cd _cb && python3 -m http.server 8799 --bind 127.0.0.1 >/dev/null 2>&1 &) ; sleep 1
python3 -I /tmp/verify_public_route.py http://127.0.0.1:8799/tcl-r24-paraformer-excel-qa/   # 期望 "matched": 36, "pass": true
```

## 3. 确认目标目录为空

```bash
tcb hosting list tcl-r24-paraformer-excel-qa -e unknown-roadrunner-d7cap6e21f517
# 期望：没有文件。若已有文件，停止并报告。
```

## 4. 上传（只上传这一个目录）

```bash
tcb hosting deploy _cb/tcl-r24-paraformer-excel-qa tcl-r24-paraformer-excel-qa \
  -e unknown-roadrunner-d7cap6e21f517 --verify
tcb hosting list tcl-r24-paraformer-excel-qa -e unknown-roadrunner-d7cap6e21f517   # 期望 36 个文件
```

## 5. 公网核验

```bash
python3 -I /tmp/verify_public_route.py \
  https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-paraformer-excel-qa/
# 期望 {"files": 36, "matched": 36, "pass": true}
# 已有正式目录不受影响（app.js 应仍为 37eb6128…）：
curl -sS "https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-paraformer/app.js" | sha256sum
```

浏览器首次打开默认测试域名会出现腾讯云「风险提醒」，等倒计时结束后点「确定访问」。

入口：https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-paraformer-excel-qa/

## 6. 撤下（只删这个新目录）

```bash
tcb hosting delete tcl-r24-paraformer-excel-qa --dir --dry-run -e unknown-roadrunner-d7cap6e21f517   # 先预览，确认只列出本目录 36 个文件
tcb hosting delete tcl-r24-paraformer-excel-qa --dir -e unknown-roadrunner-d7cap6e21f517
```

## 说明

- 仍是浏览器本机 IndexedDB + 人工传 JSON；腾讯云域名与 GitHub 域名的本机记录互不相通，没有接入 CloudBase 数据库。
- 部署后请把第 4、5 步的输出发给 Claude，由 Claude 在放行该域名后再独立核验 36/36，并跑浏览器测试。
