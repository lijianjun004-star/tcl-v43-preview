const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const roleName = role => ({ anchor: '主播', operator: '运营', admin: '管理员', pending: '待绑定邀请' }[role] || '未分配角色');
const when = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
const newId = () => globalThis.crypto.randomUUID();
const snapshotOf = submission => submission.snapshot || submission;
const feedbackRows = rows => rows?.length ? rows.map(row => `<article class="cloud-feedback"><b>人工反馈 · ${escape(when(row.createdAt))}</b><p>${escape(row.body)}</p></article>`).join('') : '<p class="muted">暂未收到人工反馈。</p>';

export function createCloudWorkspace({ workflow, boards, onIdentityReady, onLogout, onStart, onLocalRecords, getLocalResume=()=>null, onResumeReview=()=>{}, onExportLegacy=()=>{}, toast = () => {}, downloadJSON = () => {} }) {
  let mountSequence = 0, operators = [], assignments = [];const mediaUrls=new Set();
  const releaseMedia=()=>{for(const url of mediaUrls)URL.revokeObjectURL(url);mediaUrls.clear();};
  const board = id => boards.find(row => row.id === id) || boards[0];
  const boardOptions = () => boards.map(row => `<option value="${escape(row.id)}">${escape(row.category)}</option>`).join('');
  const setPlatforms = (container, boardId, platformId) => {
    const select = container.querySelector(`#${boardId}`), platform = container.querySelector(`#${platformId}`);
    const fill = () => { platform.innerHTML = board(select.value).platforms.map(value => `<option>${escape(value)}</option>`).join(''); };
    select.addEventListener('change', fill); fill();
  };
  function status(container, text, error = false) {
    const node = container.querySelector('[data-cloud-status]');
    if (node) { node.textContent = text; node.classList.toggle('error', error); node.setAttribute('role', error ? 'alert' : 'status'); }
  }
  function bindTask(container, selector, run, success) {
    const button = container.querySelector(selector); if (!button) return;
    button.addEventListener('click', async () => {
      if (button.disabled) return; button.disabled = true; status(container, '正在连接云端…');
      try { const result = await run(); if (button.isConnected) { if (success) status(container, success); await result?.after?.(); } }
      catch (error) { if (button.isConnected) status(container, error?.message || '操作未确认成功，请重试', true); }
      finally { if (button.isConnected&&button.dataset.confirmed!=='1') button.disabled = false; }
    });
  }
  async function mount(container) {
    releaseMedia();const id = ++mountSequence;
    const alive = () => container.querySelector(`[data-cloud-screen="${id}"]`) !== null;
    const user = workflow.user;
    if (!user) { mountLogin(container, id); return; }
    if(user.role === 'pending'){mountPending(container,id,user);return;}
    const operator = ['operator', 'admin'].includes(user.role), resume=getLocalResume();
    container.innerHTML = `<section class="cloud-workspace" data-cloud-screen="${id}">
      <div class="identity-bar"><span class="r2-avatar">${escape([...user.displayName][0] || '·')}</span><span class="r2-identity-text"><b>${escape(user.displayName)}</b><small>${escape(roleName(user.role))} · 正式账号</small></span><button type="button" id="cloudSignOut" class="ghost-btn">退出账号</button></div>
      <div class="cloud-toolbar"><button id="cloudRefresh" class="btn soft" type="button">刷新作业与反馈</button>${operator ? '' : '<button id="cloudLocalRecords" class="btn soft" type="button">本机练习记录</button>'}</div>
      <p data-cloud-status class="cloud-status" role="status">正在读取本人可见的云端记录…</p>
      ${!operator&&resume?`<button type="button" id="cloudResumePractice" class="resume-review"><span>恢复本人本机最近练习</span><b>${escape(resume.title)}</b><small>文字与已保存音视频仍在这台设备，不会自动上传</small></button>`:''}
      ${operator ? publishForm() : practiceForm()}
      <section class="panel"><h2>${operator ? '我发布的作业' : '运营布置的作业'}</h2><p class="muted">${operator ? '主播主动提交前，只有加入和训练状态对你可见。' : '加入后开始练播，文字和录音仍先保存在这台设备。'}</p><div id="cloudAssignments" class="assignment-results"></div></section>
      <section class="panel"><h2>${operator ? '云端收件箱' : '我的云端提交与反馈'}</h2><p class="muted">${operator ? '这里只显示主动提交给你的记录。' : '已确认回执的记录可在其他设备登录后查看。'} ${workflow.getState().capabilities.media?'媒体只在主播明确选择后私有上传。':'当前只同步文字，录音录像没有上传。'}</p><div id="cloudSubmissions" class="question-list"></div></section>
      ${user.role === 'admin' ? invitationForm() : ''}
      <details class="panel"><summary>旧本机体验记录</summary><p class="muted">旧本机记录仍保留在原浏览器，尚未上传；正式账号使用独立空间，不会按姓名自动认领旧数据。</p><button id="cloudExportLegacy" class="btn soft" type="button">只读导出旧本机文字（不上传）</button></details>
      <section class="panel" id="cloudDetail" hidden></section>
      <section class="panel" id="cloudPending" hidden></section>
      <details class="panel"><summary>账号安全 · 修改密码</summary><form id="cloudPasswordForm"><div class="field"><label for="cloudOldPassword">原密码</label><input id="cloudOldPassword" required type="password" autocomplete="current-password"></div><div class="field"><label for="cloudNewPassword">新密码（至少12位）</label><input id="cloudNewPassword" required type="password" minlength="12" maxlength="128" autocomplete="new-password"></div><button type="submit" class="btn soft">修改正式账号密码</button></form></details>
    </section>`;
    bindTask(container, '#cloudSignOut', async () => { await onLogout(); }, '已退出账号');
    container.querySelector('#cloudLocalRecords')?.addEventListener('click', onLocalRecords);
    container.querySelector('#cloudResumePractice')?.addEventListener('click', onResumeReview);
    container.querySelector('#cloudExportLegacy')?.addEventListener('click', onExportLegacy);
    const refresh = async () => {
      status(container, '正在刷新云端记录…');
      try {
        const [nextAssignments, submissions, pending] = await Promise.all([
          workflow.listAll('assignments.list'), workflow.listAll('submissions.list'), workflow.pendingOperations()
        ]);
        if (!alive() || workflow.user?.uid !== user.uid) return;
        assignments = nextAssignments;
        renderAssignments(container, nextAssignments, operator, refresh);
        renderSubmissions(container, submissions, user);
        renderPending(container, pending, refresh);
        status(container, `云端已更新 · ${new Date().toLocaleTimeString('zh-CN')}`);
      } catch (error) { if (alive()) status(container, error.message, true); }
    };
    bindTask(container, '#cloudRefresh', refresh);
    if (operator) bindPublish(container, refresh); else bindPractice(container);
    if (user.role === 'admin') bindInvitations(container);
    container.querySelector('#cloudPasswordForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); if (button.disabled) return;
      const oldInput = form.querySelector('#cloudOldPassword'), newInput = form.querySelector('#cloudNewPassword');
      const oldPassword = oldInput.value, newPassword = newInput.value; oldInput.value = ''; newInput.value = ''; button.disabled = true;
      try { await workflow.changePassword(oldPassword, newPassword); status(container, '正式账号密码已更新'); }
      catch (error) { if (button.isConnected) status(container, error.message, true); }
      finally { if (button.isConnected&&button.dataset.confirmed!=='1') button.disabled = false; }
    });
    await refresh();
  }
  function mountLogin(container, id) {
    const state = workflow.getState();
    container.innerHTML = `<section class="name-login cloud-workspace" data-cloud-screen="${id}"><div class="name-login-card"><span class="eyebrow">TCL · 正式账号</span><h2>登录练播房</h2><p>账号身份由云端验证，作业、文字提交和反馈可以跨设备读取。录音录像仍先保存在这台设备。旧本机体验记录仍保留在原浏览器，尚未上传，也不会按姓名自动归属正式账号。</p><form id="cloudLoginForm"><div class="field"><label for="cloudUsername">账号</label><input id="cloudUsername" required maxlength="64" autocomplete="username"></div><div class="field"><label for="cloudPassword">密码</label><input id="cloudPassword" required type="password" maxlength="128" autocomplete="current-password"></div><button type="submit" class="btn primary wide">登录</button></form><p data-cloud-status class="cloud-status${state.error ? ' error' : ''}" role="status">${escape(state.error)}</p>
      <details class="cloud-register"><summary>已有正式账号？绑定管理员邀请</summary><form id="cloudRegisterForm"><div class="field"><label for="cloudRegisterName">账号</label><input id="cloudRegisterName" required maxlength="64" autocomplete="username"></div><div class="field"><label for="cloudDisplayName">显示姓名</label><input id="cloudDisplayName" required maxlength="40" autocomplete="name"></div><div class="field"><label for="cloudRegisterPassword">账号密码</label><input id="cloudRegisterPassword" required type="password" maxlength="128" autocomplete="current-password"></div><div class="field"><label for="cloudInvitationCode">邀请口令</label><input id="cloudInvitationCode" required maxlength="128" autocomplete="off"></div><p class="muted">正式账号由管理员开通。邀请决定业务角色，不能自行选择运营或管理员身份。</p><button type="submit" class="btn primary">登录并绑定邀请</button></form></details></div></section>`;
    const login = container.querySelector('#cloudLoginForm');
    login.addEventListener('submit', async event => {
      event.preventDefault(); const button = login.querySelector('button'); if (button.disabled) return;
      const name = container.querySelector('#cloudUsername').value, input = container.querySelector('#cloudPassword'), password = input.value; input.value = ''; button.disabled = true;
      try { status(container, '正在验证账号…'); await workflow.signIn(name, password); await onIdentityReady(); }
      catch (error) { if (button.isConnected) status(container, error.message, true); }
      finally { if (button.isConnected&&button.dataset.confirmed!=='1') button.disabled = false; }
    });
    const registration = container.querySelector('#cloudRegisterForm');
    async function register(existing = false) {
      const values = { username: container.querySelector('#cloudRegisterName').value.trim(), displayName: container.querySelector('#cloudDisplayName').value.trim(), password: container.querySelector('#cloudRegisterPassword').value, invitationCode: container.querySelector('#cloudInvitationCode').value.trim() };
      if (!values.username || !values.password || !values.invitationCode || !values.displayName) return status(container, '请填写账号、显示姓名、邀请口令和账号密码', true);
      container.querySelector('#cloudRegisterPassword').value = '';
      const buttons = [...registration.querySelectorAll('button')]; if (buttons.some(button => button.disabled)) return; buttons.forEach(button => { button.disabled = true; });
      try {
        status(container, existing ? '正在登录并核验邀请…' : '正在通过官方账号服务注册…');
        if (existing) {
          try { await workflow.signIn(values.username, values.password); }
          catch (error) { if (!['PROFILE_REQUIRED', 'NOT_REGISTERED', 'INVITE_REQUIRED'].includes(error.code)) throw error; }
          await workflow.redeemInvitation(values.invitationCode, values.displayName);
        } else await workflow.register(values);
        await onIdentityReady();
      } catch (error) { if (buttons[0].isConnected) status(container, error.message, true); }
      finally { buttons.forEach(button => { if (button.isConnected&&button.dataset.confirmed!=='1') button.disabled = false; }); }
    }
    registration.addEventListener('submit', event => { event.preventDefault(); void register(true); });
  }
  function mountPending(container, id, user) {
    container.innerHTML = `<section class="cloud-workspace panel" data-cloud-screen="${id}"><h2>账号已验证，请绑定邀请</h2><p>${escape(user.displayName)}，你的正式账号已登录，业务角色需要管理员邀请确认。</p><div class="field"><label for="cloudPendingCode">邀请口令</label><input id="cloudPendingCode" autocomplete="off" maxlength="128"></div><div class="field"><label for="cloudPendingName">显示姓名</label><input id="cloudPendingName" maxlength="40" value="${escape(user.displayName)}" autocomplete="name"></div><button id="cloudRedeemInvite" class="btn primary" type="button">核验并绑定邀请</button><button id="cloudPendingLogout" class="btn soft" type="button">退出账号</button><p data-cloud-status class="cloud-status" role="status">绑定完成前，不能读取作业或提交记录。</p><details><summary>修改账号密码</summary><form id="cloudPendingPasswordForm"><div class="field"><label for="cloudPendingOldPassword">原密码</label><input id="cloudPendingOldPassword" required type="password" autocomplete="current-password"></div><div class="field"><label for="cloudPendingNewPassword">新密码（至少12位）</label><input id="cloudPendingNewPassword" required type="password" minlength="12" autocomplete="new-password"></div><button type="submit" class="btn soft">修改密码</button></form></details></section>`;
    bindTask(container,'#cloudRedeemInvite',async()=>{
      const code=container.querySelector('#cloudPendingCode').value.trim();if(!code)throw new Error('请填写管理员提供的邀请口令');
      await workflow.redeemInvitation(code,container.querySelector('#cloudPendingName').value.trim());await onIdentityReady();
    });
    bindTask(container,'#cloudPendingLogout',onLogout);
    container.querySelector('#cloudPendingPasswordForm').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');if(button.disabled)return;
      const old=form.querySelector('#cloudPendingOldPassword').value,next=form.querySelector('#cloudPendingNewPassword').value;form.reset();button.disabled=true;
      try{await workflow.changePassword(old,next);status(container,'密码已更新，仍需绑定邀请后使用工作台');}catch(error){status(container,error.message,true);}finally{if(button.isConnected)button.disabled=false;}
    });
  }
  function practiceForm() {
    return `<section class="panel"><h2>开始自由练播</h2><div class="cols-2"><div class="field"><label for="cloudPracticeBoard">训练板块</label><select id="cloudPracticeBoard">${boardOptions()}</select></div><div class="field"><label for="cloudPracticePlatform">平台</label><select id="cloudPracticePlatform"></select></div></div><button id="cloudFreePractice" class="btn primary wide" type="button">检查设备，准备练播</button><div class="field"><label for="cloudJoinCode">输入运营给你的作业口令</label><input id="cloudJoinCode" maxlength="32" autocomplete="off" placeholder="12位作业口令"></div><button id="cloudJoinByCode" class="btn soft wide" type="button">加入云端作业</button></section>`;
  }
  function bindPractice(container) {
    setPlatforms(container, 'cloudPracticeBoard', 'cloudPracticePlatform');
    bindTask(container,'#cloudJoinByCode',async()=>{
      const joinCode=container.querySelector('#cloudJoinCode').value.trim();if(!/^[0-9a-f]{12}$/i.test(joinCode))throw new Error('请输入运营提供的12位作业口令');
      const result=await workflow.durableWrite('assignments.join',{joinCode},'code:'+joinCode.toLowerCase());
      const row=result.assignment;if(!row?.id)throw new Error('云端加入结果不完整，请刷新作业列表');
      assignments=[row,...assignments.filter(item=>item.id!==row.id)];
      await onStart({boardId:row.boardId,platform:row.platform,assignment:row});
    });
    container.querySelector('#cloudFreePractice').addEventListener('click', async () => {try{await onStart({ boardId: container.querySelector('#cloudPracticeBoard').value, platform: container.querySelector('#cloudPracticePlatform').value, assignment: null });}catch(error){status(container,error.message,true);}});
  }
  function publishForm() {
    return `<section class="panel"><h2>发布训练作业</h2><div class="field"><label for="cloudAssignmentTitle">作业名称</label><input id="cloudAssignmentTitle" maxlength="120" placeholder="例如：电视产品问答"></div><div class="cols-2"><div class="field"><label for="cloudAssignmentBoard">训练板块</label><select id="cloudAssignmentBoard">${boardOptions()}</select></div><div class="field"><label for="cloudAssignmentPlatform">平台</label><select id="cloudAssignmentPlatform"></select></div></div><div class="field"><label for="cloudAssignmentDeadline">截止时间（可选）</label><input id="cloudAssignmentDeadline" type="datetime-local"></div><button id="cloudPublishAssignment" class="btn primary wide" type="button">发布到云端</button></section>`;
  }
  function bindPublish(container, refresh) {
    setPlatforms(container, 'cloudAssignmentBoard', 'cloudAssignmentPlatform'); let id = newId();
    bindTask(container, '#cloudPublishAssignment', async () => {
      const title = container.querySelector('#cloudAssignmentTitle').value.trim(); if (!title) throw new Error('请输入作业名称');
      const rawDeadline = container.querySelector('#cloudAssignmentDeadline').value;
      const deadline = rawDeadline ? new Date(rawDeadline).toISOString() : '';
      if (deadline && new Date(deadline).getTime() <= Date.now()) throw new Error('截止时间需要晚于现在');
      await workflow.durableWrite('assignments.create', { id, title, boardId: container.querySelector('#cloudAssignmentBoard').value, platform: container.querySelector('#cloudAssignmentPlatform').value, deadline }, id);
      id = newId(); container.querySelector('#cloudAssignmentTitle').value = ''; await refresh();
    }, '作业已由云端确认发布');
  }
  function renderAssignments(container, rows, operator, refresh) {
    const holder = container.querySelector('#cloudAssignments');
    holder.innerHTML = rows.length ? rows.map(row => `<article class="assignment-row"><div><b>${escape(row.title)}</b><small>${escape(board(row.boardId).category)} · ${escape(row.platform)} · ${escape(row.operatorName || '运营')}${operator ? ` · 作业口令 ${escape(row.joinCode || '')}` : ''}${row.deadline ? ` · 截止 ${escape(when(row.deadline))}` : ''}</small></div><button type="button" class="btn small primary" data-cloud-assignment="${escape(row.id)}">${operator ? '查看进度' : '继续训练'}</button></article>`).join('') : '<div class="empty compact">暂无云端作业。</div>';
    holder.querySelectorAll('[data-cloud-assignment]').forEach(button => button.addEventListener('click', async () => {
      if (button.disabled) return; const row = rows.find(item => item.id === button.dataset.cloudAssignment); button.disabled = true;
      try {
        if (operator) { const data = await workflow.call('assignments.progress', { assignmentId: row.id }); showProgress(container, row, data); }
        else { await workflow.durableWrite('assignments.join', { assignmentId: row.id }, row.id); await onStart({ boardId: row.boardId, platform: row.platform, assignment: row }); }
      } catch (error) { status(container, error.message, true); }
      finally { if (button.isConnected&&button.dataset.confirmed!=='1') button.disabled = false; }
    }));
  }
  function showProgress(container, assignment, data) {
    const detail = container.querySelector('#cloudDetail'); detail.hidden = false;
    const rows = data.items || data.joins || [];
    detail.innerHTML = `<h2>${escape(assignment.title)} · 作业进度</h2><p class="muted">未主动提交的回答和录音不会在这里显示。</p>${rows.map(row => `<div class="log-row"><b>${escape(row.displayName || row.anchorName || '主播')}</b><span>${escape(row.trainingCount || 0)}次练习 · ${row.submissionCount ? '已提交' : '未提交'}</span></div>`).join('') || '<p class="muted">暂时没有主播加入。</p>'}`;
  }
  function renderSubmissions(container, rows, user) {
    const holder = container.querySelector('#cloudSubmissions');
    holder.innerHTML = rows.length ? rows.map(row => `<button type="button" class="cloud-submission-row" data-cloud-submission="${escape(row.id)}"><b>${escape(row.assignmentTitle || snapshotOf(row).category || '训练提交')}</b><span>${escape(row.anchorName || '')} · ${escape(when(row.submittedAt))}${row.late ? ' · 逾期提交' : ''}</span><small>云端已确认 · ${escape(row.receiptId || row.id)}${row.feedbackCount ? ` · ${row.feedbackCount}条人工反馈` : ''}</small></button>`).join('') : '<div class="empty compact">暂无已确认的云端提交。</div>';
    holder.querySelectorAll('[data-cloud-submission]').forEach(button => button.addEventListener('click', () => void openSubmission(container, button.dataset.cloudSubmission, user)));
  }
  async function openSubmission(container, id, user) {
    releaseMedia();const detail = container.querySelector('#cloudDetail'); detail.hidden = false; detail.innerHTML = '<p role="status">正在读取已授权的记录…</p>';
    try {
      const [data, feedback] = await Promise.all([workflow.call('submissions.get', { submissionId: id }), workflow.listAll('feedback.list', { submissionId: id })]);
      if (!detail.isConnected || workflow.user?.uid !== user.uid) return;
      const submission = data.submission || data, snap = snapshotOf(submission);
      detail.innerHTML = `<h2>已提交的训练记录</h2><p>${escape(snap.category || '')} · ${escape(snap.platform || '')} · ${escape(when(submission.submittedAt))}</p><p class="notice">${submission.media?.length?'本次提交包含主动选择的私有附件，点击后按当前账号权限读取。':'仅文字已提交。录音录像仍在主播原设备，没有上传。'}</p>${(submission.media||[]).map((media,index)=>`<div class="cloud-media"><b>附件 ${index+1} · ${escape(media.mime)} · ${(media.size/1048576).toFixed(1)}MiB</b><button type="button" class="btn soft" data-cloud-media="${index}">读取并播放授权附件</button><div data-cloud-player="${index}"></div></div>`).join('')}${(snap.turns || []).map((turn, index) => `<article class="submission-turn"><b>${index + 1}. ${escape(turn.prompt || turn.question)}</b><p>${escape(turn.manualCleared ? '已手动清空回答' : turn.answer || turn.transcript || '无文字回答')}</p><small>${escape([turn.model && `型号：${turn.model}`, turn.sku && `SKU：${turn.sku}`, turn.source && `来源：${turn.source}`].filter(Boolean).join(' · '))}</small></article>`).join('')}<h3>人工文字反馈</h3><div>${feedbackRows(feedback)}</div>${['operator', 'admin'].includes(user.role) && submission.operatorId === user.uid ? '<div class="field"><label for="cloudFeedbackBody">反馈内容</label><textarea id="cloudFeedbackBody" maxlength="5000" rows="5"></textarea></div><button type="button" class="btn primary" id="cloudSaveFeedback">保存反馈到云端</button>' : ''}`;
      detail.querySelectorAll('[data-cloud-media]').forEach(button=>button.addEventListener('click',async()=>{
        if(button.disabled)return;button.disabled=true;const index=Number(button.dataset.cloudMedia),media=submission.media[index];
        try{const blob=await workflow.downloadMedia(media.path);if(!detail.isConnected||workflow.user?.uid!==user.uid)return;const url=URL.createObjectURL(blob);mediaUrls.add(url);const player=document.createElement(media.mime.startsWith('video/')?'video':'audio');player.controls=true;player.preload='metadata';player.playsInline=true;player.src=url;player.style.maxWidth='100%';detail.querySelector(`[data-cloud-player="${index}"]`).replaceChildren(player);button.textContent='已读取私有附件';}
        catch(error){if(button.isConnected){button.disabled=false;status(container,error.message,true);}}
      }));
      const feedbackId = newId();
      bindTask(container, '#cloudSaveFeedback', async () => {
        const body = detail.querySelector('#cloudFeedbackBody').value.trim(); if (!body) throw new Error('请填写反馈内容');
        await workflow.durableWrite('feedback.create', { id: feedbackId, submissionId: id, body }, feedbackId);
        await openSubmission(container, id, user);
      }, '人工反馈已保存');
    } catch (error) { if (detail.isConnected) detail.innerHTML = `<p role="alert">${escape(error.message)}</p>`; }
  }
  function renderPending(container, rows, refresh) {
    const holder = container.querySelector('#cloudPending'); holder.hidden = rows.length === 0;
    holder.innerHTML = `<h2>尚未确认的云端操作</h2><p class="muted">这些操作保留了原始内容和操作编号。重试会查询或完成同一次操作，不会改成新的提交。</p>${rows.map(row => `<article class="cloud-pending"><span>${escape(row.action)} · ${escape(when(row.createdAt))}</span><button type="button" class="btn soft" data-cloud-retry="${escape(row.id)}">重试原操作</button><button type="button" class="btn soft" data-cloud-export="${escape(row.id)}">下载文字备份</button></article>`).join('')}`;
    holder.querySelectorAll('[data-cloud-export]').forEach(button => button.addEventListener('click', () => downloadJSON('TCL-待确认文字.json', rows.find(row => row.id === button.dataset.cloudExport).payload)));
    holder.querySelectorAll('[data-cloud-retry]').forEach(button => button.addEventListener('click', async () => {
      if (button.disabled) return; button.disabled = true; const row = rows.find(item => item.id === button.dataset.cloudRetry);
      try { await workflow.durableWrite(row.action, row.payload, row.id.slice(row.action.length + 1)); await refresh(); }
      catch (error) { status(container, error.message, true); }
      finally { if (button.isConnected&&button.dataset.confirmed!=='1') button.disabled = false; }
    }));
  }
  function invitationForm() {
    return '<section class="panel"><h2>邀请成员</h2><p class="muted">邀请口令交给对应成员本人。对方由管理员开通正式账号后，登录并绑定邀请，角色由云端核验。</p><div class="field"><label for="cloudInviteRole">邀请角色</label><select id="cloudInviteRole"><option value="anchor">主播</option><option value="operator">运营</option></select></div><button id="cloudCreateInvite" class="btn primary" type="button">生成一次性邀请口令</button><p id="cloudInviteResult" class="cloud-invitation" role="status"></p></section>';
  }
  function bindInvitations(container) {
    bindTask(container, '#cloudCreateInvite', async () => {
      const data = await workflow.call('invites.create', { role: container.querySelector('#cloudInviteRole').value }, newId());
      container.querySelector('#cloudInviteResult').textContent = `邀请口令：${data.invite.code}；有效期至 ${when(data.invite.expiresAt)}`;
    });
  }
  async function mountSubmissionPanel(container, { getSnapshot, getAttachments=()=>[], hasMedia, beforeSubmit, onConfirmed }) {
    const user=workflow.user;if(!user||user.role!=='anchor')return;
    const snap=getSnapshot(),mediaEnabled=workflow.getState().capabilities.media===true,attachments=getAttachments();
    const attachmentChoices=mediaEnabled?`<fieldset class="cloud-attachment-options"><legend>选择本次提交范围</legend><label class="cloud-text-consent"><input type="radio" name="cloudSubmissionMode" value="text">只提交文字，录音录像仍保留在本机。</label><label class="cloud-text-consent"><input type="radio" name="cloudSubmissionMode" value="media">文字及我主动选择的附件一起提交。</label>${attachments.map((row,index)=>`<label class="cloud-text-consent"><input type="checkbox" data-cloud-attachment="${index}"${row.blob.size>50*1024*1024?' disabled':''}>${escape(row.label)} · ${(row.blob.size/1048576).toFixed(1)}MiB${row.blob.size>50*1024*1024?'（超过单附件50MiB限制，请另行下载保留）':''}</label>`).join('')||'<p class="muted">本场没有可上传附件。</p>'}<small>最多选择3个附件，每个不超过50MiB。没有勾选的录音录像不会上传，也不会从本机删除。</small></fieldset>`:'<label class="cloud-text-consent"><input type="checkbox" id="cloudTextOnlyConsent">我选择仅提交文字；录音录像没有上传，请保留或下载原文件。</label>';
    container.innerHTML=`<div class="review-heading"><h3>主动提交本次记录</h3><span>由主播决定</span></div><p>只有云端返回回执后才算提交成功。${hasMedia?'本场录音录像仍先保存在这台设备。':'本场没有待上传媒体。'}</p><div class="field"><label for="cloudSubmitOperator">接收运营</label><select id="cloudSubmitOperator"><option value="">正在读取可提交的运营…</option></select></div>${attachmentChoices}<button id="cloudSubmitText" class="btn primary wide" type="button">确认范围并提交</button><p class="cloud-status" data-cloud-status role="status">尚未发送给运营。</p>`;
    const uploaded=new Map();
    try{
      operators=await workflow.listAll('operators.list');if(!container.isConnected||workflow.user?.uid!==user.uid)return;
      const selector=container.querySelector('#cloudSubmitOperator');selector.innerHTML='<option value="">请选择接收运营</option>'+operators.map(row=>`<option value="${escape(row.uid||row.id)}">${escape(row.displayName||row.username||'运营')}</option>`).join('');
      if(snap.assignmentId){const current=assignments.find(row=>row.id===snap.assignmentId);if(current?.operatorId){selector.value=current.operatorId;}else{selector.innerHTML='<option>作业发布运营（由云端核验）</option>';}selector.disabled=true;}
    }catch(error){status(container,error.message,true);const button=container.querySelector('#cloudSubmitText');if(button)button.disabled=true;return;}
    bindTask(container,'#cloudSubmitText',async()=>{
      const latest=clone(getSnapshot()),pending=(await workflow.pendingOperations()).find(row=>row.id==='submissions.create:'+latest.id);
      let payload;
      if(pending){payload=pending.payload;status(container,'正在重试原待确认提交，保留之前的文字和附件范围…');}
      else{
        const mode=mediaEnabled?container.querySelector('input[name="cloudSubmissionMode"]:checked')?.value:container.querySelector('#cloudTextOnlyConsent').checked?'text':null;
        if(!mode)throw new Error('请先明确本次提交范围；不会自动上传或省略录音录像');
        const receiver=container.querySelector('#cloudSubmitOperator').value;
        if(!latest.assignmentId&&!receiver)throw new Error('请选择接收运营');
        await beforeSubmit();
        const selected=mode==='media'?[...container.querySelectorAll('[data-cloud-attachment]:checked')].map(input=>attachments[Number(input.dataset.cloudAttachment)]):[];
        if(mode==='media'&&(selected.length<1||selected.length>3))throw new Error('请选择1到3个受支持的附件，或明确选择只提交文字');
        const media=[];
        for(const [index,row] of selected.entries()){
          status(container,`正在上传第${index+1}/${selected.length}个附件，尚未确认送达…`);
          if(!uploaded.has(row.id))uploaded.set(row.id,await workflow.uploadMedia(row.blob));media.push(uploaded.get(row.id));
        }
        payload={id:latest.id,sessionId:latest.id,assignmentId:latest.assignmentId||null,...(!latest.assignmentId?{operatorId:receiver}:{}),snapshot:latest,media};
      }
      const result=await workflow.durableWrite('submissions.create',payload,latest.id),submission=result?.submission;
      if(!submission?.id||!submission.submittedAt||!result.receiptId)throw new Error('云端没有返回完整回执，送达状态未确认');
      await onConfirmed(submission,result);
      status(container,`云端已确认 · 回执${result.receiptId}。${submission.media?.length?'文字及所选'+submission.media.length+'个私有附件已提交。':'仅文字已提交，录音录像没有上传。'}${result.clientWarning||''}`);
      const button=container.querySelector('#cloudSubmitText');if(button){button.textContent='✓ 提交已获云端回执';button.dataset.confirmed='1';button.disabled=true;}
    });
  }

  return { mount, mountSubmissionPanel, releaseMedia, invalidate: () => { releaseMedia();mountSequence++; assignments = []; operators = []; } };
}
