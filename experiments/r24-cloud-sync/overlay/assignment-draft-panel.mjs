import {
  assignmentDraftTableText,
  buildAssignmentDraftPrompt,
  readAssignmentDraftResponse,
} from './assignment-drafts.mjs';

export function assignmentDraftPanelHtml() {
  return `
<details class="hub-fold" id="assignmentDraftPanel">
  <summary><span><b>AI 出题草稿</b><small>从资料整理顾客弹幕、参考话术和评分要点</small></span><span class="fold-indicator" aria-hidden="true">展开 ›</span></summary>
  <div class="hub-fold-body">
    <div class="cols-2">
      <div class="field"><label for="assignmentDraftSourceMode">资料来源</label><select id="assignmentDraftSourceMode"><option value="text">粘贴文字</option><option value="table">读取表格</option></select></div>
      <div class="field"><label for="assignmentDraftCount">目标题数</label><select id="assignmentDraftCount"><option value="3">3 题</option><option value="5" selected>5 题</option><option value="7">7 题</option><option value="10">10 题</option><option value="15">15 题</option></select></div>
    </div>
    <div id="assignmentDraftTextFields"><div class="field"><label for="assignmentDraftSourceText">场景、资料或客户原话</label><textarea id="assignmentDraftSourceText" rows="4" placeholder="粘贴顾客需求、使用场景或产品资料"></textarea></div></div>
    <div id="assignmentDraftTableFields" hidden><div class="field"><label for="assignmentDraftSourceFile">选择 Excel 或文本表格</label><input id="assignmentDraftSourceFile" type="file" accept=".xlsx,.xls,.csv,.tsv"><small>支持 XLSX、XLS、CSV、TSV。较长资料可按主题分批。</small></div></div>
    <div id="assignmentDraftCloudControls" hidden>
      <p class="hub-task-tip">点击生成会把所选资料的文字发送给腾讯云模型。请先去除姓名、电话、地址等个人信息，并确认资料可分享。</p>
      <button type="button" class="btn dark" id="assignmentDraftGenerate" aria-describedby="assignmentDraftCloudStatus">AI 一键出题</button>
    </div>
    <p class="scene-tip" id="assignmentDraftCloudStatus" role="status" hidden></p>
    <button type="button" class="btn soft small" id="assignmentDraftRetryAccess" hidden>重试检查云端出题</button>
    <p class="hub-task-tip">也可在此浏览器整理资料，再手动复制到 ChatGPT 或 Gemini。请仅提交可分享的内容。</p>
    <button type="button" class="btn soft" id="assignmentDraftBuildPrompt">整理 AI 指令</button>
    <p class="scene-tip" id="assignmentDraftPromptStatus" role="status"></p>
    <div id="assignmentDraftPromptFields" hidden>
      <div class="field"><label for="assignmentDraftPrompt">整理好的指令</label><textarea id="assignmentDraftPrompt" rows="6" readonly></textarea></div>
      <div class="toolbar">
        <button type="button" class="btn soft" id="assignmentDraftCopyPrompt">复制指令</button>
        <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">打开 ChatGPT</a>
        <a href="https://gemini.google.com/app" target="_blank" rel="noopener noreferrer">打开 Gemini</a>
      </div>
    </div>
    <div class="field"><label for="assignmentDraftResponse">粘贴 AI 返回的 JSON</label><textarea id="assignmentDraftResponse" rows="4" placeholder="粘贴完整的 JSON 结果"></textarea></div>
    <button type="button" class="btn soft" id="assignmentDraftReadResponse">读取草稿</button>
    <div id="assignmentDraftReviewFields" hidden>
      <p class="scene-tip">请核对并修改题面、参考答案和评分要点。价款、配置和安装条款以核实后的资料为准。</p>
      <div id="assignmentDraftRows" class="question-list"></div>
      <div class="toolbar"><button type="button" class="btn dark" id="assignmentDraftConfirm">确认用于本次作业</button></div>
    </div>
    <p class="scene-tip" id="assignmentDraftStatus" role="status"></p>
  </div>
</details>`;
}

export function bindAssignmentDraftPanel({ panel, parseDocumentFile, getAssignmentScope, scopeInputs = [], cloud, invalidate, confirm }) {
  if (!panel) return;

  const find = suffix => panel.querySelector(`#assignmentDraft${suffix}`);
  const mode = find('SourceMode');
  const sourceText = find('SourceText');
  const sourceFile = find('SourceFile');
  const count = find('Count');
  const buildButton = find('BuildPrompt');
  const promptFields = find('PromptFields');
  const prompt = find('Prompt');
  const promptStatus = find('PromptStatus');
  const response = find('Response');
  const reviewFields = find('ReviewFields');
  const rowsContainer = find('Rows');
  const draftStatus = find('Status');
  const cloudControls = find('CloudControls');
  const cloudStatus = find('CloudStatus');
  const generateButton = find('Generate');
  const retryButton = find('RetryAccess');

  let rows = [];
  let sourceRevision = 0;
  let draftRevision = 0;
  let promptScope;
  let cloudAvailable;
  let checkingCloud = false;
  let generating = false;

  function setCloudStatus(message) {
    cloudStatus.textContent = message;
    cloudStatus.hidden = !message;
  }

  function draftChanged() {
    draftRevision++;
    if (generating) setCloudStatus('资料、范围或草稿已更改，本次生成结果将舍弃。');
    else if (cloudAvailable) setCloudStatus('');
  }

  function sourceChanged() {
    sourceRevision++;
    draftChanged();
    prompt.value = '';
    promptFields.hidden = true;
    promptStatus.textContent = '';
    if (rows.length) {
      invalidate();
      draftStatus.textContent = '资料已变化，请核对草稿后重新确认。';
    }
  }

  mode.addEventListener('change', () => {
    find('TextFields').hidden = mode.value !== 'text';
    find('TableFields').hidden = mode.value !== 'table';
    sourceChanged();
  });
  sourceText.addEventListener('input', sourceChanged);
  sourceFile.addEventListener('change', sourceChanged);
  count.addEventListener('change', sourceChanged);
  for (const input of scopeInputs) input.addEventListener('change', sourceChanged);

  function sameScope(scope) {
    const current = getAssignmentScope();
    return scope.boardId === current.boardId && scope.category === current.category && scope.platform === current.platform;
  }

  async function readSource(status) {
    if (mode.value !== 'table') return sourceText.value;
    const file = sourceFile.files?.[0];
    if (!file) throw new Error('请先选择表格文件。');
    if (!/\.(xlsx?|csv|tsv)$/iu.test(file.name)) throw new Error('请选择 XLSX、XLS、CSV 或 TSV 文件。');
    status('正在本地读取表格…');
    return assignmentDraftTableText(await parseDocumentFile(file, { assignmentExcel: true }));
  }

  const isCurrentCloud = () => panel.isConnected && cloud?.isCurrent();

  async function checkCloudAccess() {
    if (!isCurrentCloud() || cloudAvailable !== undefined || checkingCloud) return;
    checkingCloud = true;
    retryButton.hidden = true;
    setCloudStatus('正在检查云端出题服务…');
    try {
      const available = await cloud.getAvailability();
      if (!isCurrentCloud()) return;
      cloudAvailable = available === true;
      cloudControls.hidden = !cloudAvailable;
      setCloudStatus(cloudAvailable ? '' : '当前账号暂无法使用云端出题，可继续手动整理指令。');
    } catch {
      if (!isCurrentCloud()) return;
      setCloudStatus('暂时无法确认云端出题服务。可以重试检查或继续手动整理指令。');
      retryButton.hidden = false;
    } finally {
      checkingCloud = false;
    }
  }

  if (cloud) {
    panel.addEventListener('toggle', () => { if (panel.open) void checkCloudAccess(); });
    retryButton.addEventListener('click', checkCloudAccess);
    if (panel.open) void checkCloudAccess();
  }

  generateButton.addEventListener('click', async () => {
    if (!cloudAvailable || !isCurrentCloud() || generating) return;
    const revision = draftRevision;
    const scope = getAssignmentScope();
    const desiredCount = Number(count.value);
    const isCurrent = () => isCurrentCloud() && revision === draftRevision && sameScope(scope);
    generating = true;
    generateButton.disabled = true;
    setCloudStatus('');
    let requested = false;
    try {
      const source = await readSource(setCloudStatus);
      if (!isCurrent()) return;
      if (!source.trim()) throw new Error('请先输入出题资料。');
      invalidate();
      setCloudStatus('正在生成草稿，请稍候…');
      requested = true;
      const generated = await cloud.generate({ material: source.trim(), boardId: scope.boardId, platform: scope.platform, count: desiredCount });
      if (!isCurrent()) return;
      rows = readAssignmentDraftResponse(JSON.stringify(generated));
      renderDraftRows();
      draftStatus.textContent = `已生成 ${rows.length} 道草稿题。核对后请确认用于本次作业。`;
      setCloudStatus('草稿已生成，可在下方编辑。');
    } catch (error) {
      if (!isCurrent()) return;
      if (!requested) {
        setCloudStatus(error instanceof Error ? error.message : '资料读取失败，请重试。');
        return;
      }
      if (error?.code === 'AI_DRAFT_UNAVAILABLE') {
        cloudAvailable = false;
        cloudControls.hidden = true;
      }
      const hints = {
        AI_DRAFT_UNAVAILABLE: '当前账号暂无法使用云端出题。',
        AI_DRAFT_LIMIT: '今天的一键出题次数已用完。',
        AI_DRAFT_INPUT_INVALID: '请检查资料格式，最多可填写 20,000 字。',
        AI_DRAFT_RESPONSE_INVALID: '生成的草稿未通过题目校验，请调整资料后重试。',
        RATE_LIMITED: '出题请求过多，请稍后再试。',
      };
      const code = error?.code;
      const hint = Object.hasOwn(hints, code) ? hints[code] : '云端出题未完成，请稍后重试。';
      setCloudStatus(`${hint}也可以手动整理指令。`);
    } finally {
      generating = false;
      generateButton.disabled = false;
    }
  });

  buildButton.addEventListener('click', async () => {
    const revision = ++sourceRevision;
    const scope = getAssignmentScope();
    const desiredCount = Number(count.value);
    const currentSource = () => panel.isConnected && revision === sourceRevision;
    prompt.value = '';
    promptFields.hidden = true;
    promptStatus.textContent = '';
    buildButton.disabled = true;
    try {
      const source = await readSource(message => { promptStatus.textContent = message; });
      if (!currentSource()) return;
      if (!sameScope(scope)) throw new Error('训练板块或平台已变化，请重新整理指令。');
      prompt.value = buildAssignmentDraftPrompt(source, { ...scope, count: desiredCount });
      promptScope = scope;
      promptFields.hidden = false;
      promptStatus.textContent = '指令已整理。复制后可在所选 AI 服务中生成草稿。';
    } catch (error) {
      if (currentSource()) promptStatus.textContent = error instanceof Error ? error.message : '资料读取失败，请重试。';
    } finally {
      buildButton.disabled = false;
    }
  });

  find('CopyPrompt').addEventListener('click', async () => {
    if (!prompt.value) return;
    if (!sameScope(promptScope)) {
      sourceChanged();
      promptStatus.textContent = '训练板块或平台已变化，请重新整理指令。';
      return;
    }
    const revision = sourceRevision;
    try {
      await navigator.clipboard.writeText(prompt.value);
      if (panel.isConnected && revision === sourceRevision) promptStatus.textContent = '指令已复制。';
    } catch {
      if (!panel.isConnected || revision !== sourceRevision) return;
      prompt.focus();
      prompt.select();
      promptStatus.textContent = '指令已选中，可手动复制。';
    }
  });

  function renderDraftRows() {
    const document = panel.ownerDocument;
    const fragment = document.createDocumentFragment();
    for (const [index, row] of rows.entries()) {
      const card = document.createElement('article');
      card.className = 'q-card';
      card.dataset.assignmentDraftRow = String(index + 1);
      const heading = document.createElement('h3');
      heading.textContent = `第 ${index + 1} 题`;
      card.append(heading);
      for (const [key, label, lineCount] of [
        ['question', '顾客弹幕', 2],
        ['answer', '参考话术', 3],
        ['keyPoints', '评分要点（每行一条）', 3],
      ]) {
        const field = document.createElement('div');
        field.className = 'field';
        const title = document.createElement('label');
        const editor = document.createElement('textarea');
        editor.id = `assignmentDraft-${index}-${key}`;
        editor.rows = lineCount;
        editor.dataset.draftField = key;
        editor.value = key === 'keyPoints' ? row.keyPoints.join('\n') : row[key];
        title.htmlFor = editor.id;
        title.textContent = label;
        editor.addEventListener('input', () => {
          draftChanged();
          row[key] = key === 'keyPoints'
            ? editor.value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
            : editor.value;
          invalidate();
          draftStatus.textContent = '草稿已编辑，请核对后重新确认。';
        });
        field.append(title, editor);
        card.append(field);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn soft small';
      remove.dataset.removeDraftQuestion = '';
      remove.textContent = `移除第 ${index + 1} 题`;
      remove.addEventListener('click', () => {
        draftChanged();
        rows.splice(index, 1);
        invalidate();
        renderDraftRows();
        draftStatus.textContent = rows.length ? `剩余 ${rows.length} 题，请重新确认。` : '草稿已清空。';
        (rowsContainer.querySelector('[data-remove-draft-question]') || find('ReadResponse')).focus();
      });
      card.append(remove);
      fragment.append(card);
    }
    rowsContainer.replaceChildren(fragment);
    reviewFields.hidden = rows.length === 0;
  }

  response.addEventListener('input', () => {
    draftChanged();
    if (!rows.length) return;
    rows = [];
    invalidate();
    renderDraftRows();
    draftStatus.textContent = '结果已更改，请重新读取草稿。';
  });

  find('ReadResponse').addEventListener('click', () => {
    draftChanged();
    invalidate();
    rows = [];
    try {
      rows = readAssignmentDraftResponse(response.value);
      draftStatus.textContent = `已读取 ${rows.length} 道草稿题。核对后请确认用于本次作业。`;
    } catch (error) {
      draftStatus.textContent = error instanceof Error ? error.message : '读取草稿失败，请检查 JSON。';
    }
    renderDraftRows();
  });

  find('Confirm').addEventListener('click', () => {
    if (!rows.length) return;
    draftChanged();
    try {
      confirm(rows.map(row => ({ ...row, keyPoints: [...row.keyPoints] })));
      draftStatus.textContent = `已设为本次作业，共 ${rows.length} 题。可点击「发布作业」。`;
    } catch (error) {
      draftStatus.textContent = error instanceof Error ? error.message : '请检查草稿后重新确认。';
    }
  });
}
