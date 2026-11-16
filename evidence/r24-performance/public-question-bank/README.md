# 最终公网题库回归

公开 GitHub Pages URL 上实际 Chromium UI + 原生 IndexedDB，全部 32 项通过：原 31 项完整题库导入/审核/练播/复盘/刷新恢复/提交回归，另加 1 项浏览器实际 app.js 响应版本验证。数据为人工构造，无真人业务表、音频或模型请求；不等同物理手机或语音准确率验收。

预期 app SHA256 `63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816`。测试前后远端 app/parser/qa-import 三项哈希一致。浏览器 requestfinished 事件记录 16 份实际 app.js 响应，全部 HTTP200 且正文 SHA256 匹配该最终版，无拦截替换脚本或产品改动。页面错误 0。

结果 `result.json` 包含各项断言和逐次浏览器响应 URL/状态/哈希。测试 `experiments/r24/tests/question_bank.py` 的可选环境变量 `R24_EXPECT_APP_SHA` 只增加版本证据，原 31 项断言保持不变。
