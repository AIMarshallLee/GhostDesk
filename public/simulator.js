(() => {
  const $ = id => document.getElementById(id);
  const embedded = window.parent !== window;
  const relayToken = document.querySelector('meta[name="flowdesk-relay"]')?.content;
  const parentOrigin = embedded ? (() => { try { return document.referrer ? new URL(document.referrer).origin : (location.protocol === 'file:' || location.href === 'about:srcdoc') ? 'null' : ''; } catch { return ''; } })() : '';
  const relayTarget = parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*';
  let state, selected = 'lin', timer, backoff = 500, sequence = 0, sampleBusy = false, readyReported = false;
  let choice = { mode: 'rules', replyMode: 'auto', dirty: false };
  const pending = new Map(), signatures = { conversations: '', messages: '', jobs: '', events: '' };
  const setSampleBusy = value => {
    sampleBusy = value;
    document.querySelectorAll('#message-input,#send-message,#mode,#reply-mode,#start,#pause,#stop,#takeover,#reset,#apply-faults,.faults input,.sample-grid button').forEach(control => { control.disabled = value; });
  };
  const escape = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const toast = text => { const el = $('toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); };
  const http = async (method, path, body, retried = false) => {
    const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 401 && !retried) { await http('GET', '/bootstrap', undefined, true); return http(method, path, body, true); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
  };
  const request = (method, path, body) => {
    if (!embedded) return http(method, path, body);
    const id = `sim-${Date.now()}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('嵌入请求超时')); }, 8000);
      pending.set(id, { resolve, reject, timeout });
      parent.postMessage({ channel: 'flowdesk-simulator', token: relayToken, id, request: { method, path, body } }, relayTarget);
    });
  };
  addEventListener('message', event => {
    if (!embedded || event.source !== parent || !relayToken || event.data?.token !== relayToken || event.data.channel !== 'flowdesk-simulator') return;
    const item = pending.get(event.data.id); if (!item) return;
    clearTimeout(item.timeout); pending.delete(event.data.id);
    event.data.error ? item.reject(new Error(event.data.error)) : item.resolve(event.data.result);
  });
  const replace = (id, signature, html, preserveScroll = false) => {
    if (signatures[id] === signature) return;
    const element = $(id), top = preserveScroll ? element.scrollTop : 0;
    signatures[id] = signature; element.innerHTML = html;
    if (preserveScroll) element.scrollTop = top;
  };
  function render() {
    if (!state) return;
    const current = state.conversations.find(c => c.id === selected) || state.conversations[0];
    if (!current) return;
    selected = current.id;
    const conversationSignature = JSON.stringify(state.conversations.map(c => [c.id, c.name, c.topic, c.enabled, c.id === selected]));
    replace('conversation-list', conversationSignature, state.conversations.map(c => `<button class="conversation ${c.id === selected ? 'active' : ''}" data-id="${c.id}"><strong>${escape(c.name)}</strong><small>${escape(c.topic)} · ${c.enabled ? '自动处理' : '人工接管'}</small></button>`).join(''));
    $('chat-title').textContent = current.name; $('chat-topic').textContent = current.topic + (current.enabled ? ' · 自动处理已启用' : ' · 人工接管中');
    $('conversation-mode').textContent = current.enabled ? '自动处理' : '人工接管'; $('takeover').textContent = current.enabled ? '人工接管' : '恢复自动';
    const messages = state.messages.filter(m => m.conversationId === selected);
    const messageSignature = JSON.stringify([selected, ...messages.map(m => [m.id, m.text, m.role, m.createdAt, m.deliveryKey])]);
    replace('message-list', messageSignature, messages.map(m => `<article class="message ${m.role}"><div>${escape(m.text)}</div><small>${m.role === 'assistant' ? (m.source === 'live' ? '真实模型测试草稿' : '测试规则回复') : m.role === 'human' ? '人工接管' : '虚构客户'} · ${new Date(m.createdAt).toLocaleTimeString()}</small></article>`).join(''), true);
    const automation = state.automation;
    $('engine-status').textContent = automation.status === 'running' ? (automation.replyMode === 'manual' ? '人工复制草稿中' : '自动回复运行中') : automation.status === 'paused' ? '已暂停' : '已停止';
    $('engine-detail').textContent = `来源：${automation.mode === 'live' ? 'live · 已配置 provider（仅测试会话）' : 'rules · 明确非 AI'}；${automation.processing ? '正在处理' : '等待消息'}`;
    $('engine-dot').className = `dot ${automation.status}`;
    if (!choice.dirty) { $('mode').value = automation.mode; $('reply-mode').value = automation.replyMode || 'auto'; choice = { mode: $('mode').value, replyMode: $('reply-mode').value, dirty: false }; }
    ['received', 'sent', 'duplicates', 'failed', 'handoff', 'pending'].forEach(key => $(`stat-${key}`).textContent = state.stats[key]);
    const jobs = state.jobs.slice(-8).reverse(), jobSignature = JSON.stringify(jobs.map(j => [j.id, j.status, j.reply, j.attempts, j.error]));
    replace('jobs', jobSignature, jobs.map(j => `<div class="job"><strong>${escape(j.status)}</strong> · ${escape(j.id)}${j.error ? `<br><small>错误：${escape(j.error)}</small>` : ''}${j.reply ? `<br>${escape(j.reply)} ${j.status === 'ready' ? `<button class="copy-reply" data-job="${j.id}">复制回复</button>` : ''}` : ''}</div>`).join('') || '<div class="muted">暂无后台任务</div>', true);
    const events = state.events.slice(0, 8), eventSignature = JSON.stringify(events.map(e => [e.at, e.type, e.detail]));
    replace('events', eventSignature, events.map(e => `<div class="event">${escape(e.type)} · ${escape(e.detail)}</div>`).join(''), true);
    if (embedded && !readyReported) {
      let parentAccessBlocked = false;
      try { void parent.document.body; } catch { parentAccessBlocked = true; }
      parent.postMessage({ channel: 'flowdesk-simulator-ready', token: relayToken, version: state.version, conversationCount: state.conversations.length, parentAccessBlocked }, relayTarget);
      readyReported = true;
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, document.hidden || state?.automation.status === 'stopped' ? Math.max(backoff, 3000) : backoff); }
  async function refresh() {
    try { state = await request('GET', '/sandbox/state'); backoff = 500; $('connection').textContent = '本地沙箱已连接'; render(); }
    catch (error) { $('connection').textContent = `连接失败：${error.message}`; backoff = Math.min(backoff * 2, 8000); }
    schedule();
  }
  async function control(action, override = {}) {
    const mode = override.mode || choice.mode, replyMode = override.replyMode || choice.replyMode;
    if (action === 'start' && mode === 'live' && !await approveLive()) return false;
    try {
      await request('POST', '/sandbox/control', { action, mode, replyMode, allowLive: mode === 'live' });
      if (action === 'start') choice.dirty = false;
      await refresh(); return true;
    } catch (error) { toast(error.message); return false; }
  }
  const approveLive = () => new Promise(resolve => {
    const dialog = $('live-dialog');
    $('live-provider').textContent = `Provider：${state?.provider?.baseUrl || '未配置'}；模型：${state?.provider?.model || '未配置'}`;
    const finish = allowed => { dialog.close(); resolve(allowed); };
    $('live-cancel').onclick = () => finish(false); $('live-allow').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal();
  });
  async function changed() {
    choice = { mode: $('mode').value, replyMode: $('reply-mode').value, dirty: true };
    if (state?.automation.status === 'running') {
      await control('pause', { mode: state.automation.mode, replyMode: state.automation.replyMode });
      toast('已暂停；保留你的新选择，重新启动后才会应用。');
    }
  }
  const send = (conversationId, text, id) => request('POST', '/sandbox/messages', { conversationId, text, id, role: 'customer' });
  const waitFor = async (predicate, label, deadline = 6000) => {
    const until = Date.now() + deadline;
    while (Date.now() < until) { await refresh(); if (predicate(state)) return state; await sleep(30); }
    throw new Error(`样例超时：${label}`);
  };
  const readySample = async () => {
    if (sampleBusy) throw new Error('样例正在运行');
    setSampleBusy(true);
    try {
      await control('reset'); choice = { mode: 'rules', replyMode: 'auto', dirty: false };
      await control('start'); await waitFor(s => s.automation.status === 'running' && s.automation.mode === 'rules' && s.automation.replyMode === 'auto' && !s.automation.processing && s.jobs.length === 0, '样例前置条件');
    } catch (error) { setSampleBusy(false); throw error; }
  };
  const result = (expected, actual, passed) => { $('sample-result').innerHTML = `<strong class="${passed ? 'pass' : 'fail'}">${passed ? 'PASS' : 'FAIL'}</strong><br>预期：${escape(expected)}<br>实际：${escape(actual)}`; };
  async function sample(type) {
    if (sampleBusy) { toast('样例正在运行'); return; }
    $('sample-result').textContent = '正在运行本次样例…';
    try {
      await readySample();
      if (type === 'burst') {
        await Promise.all(['第一条', '第二条', '第三条'].map((text, index) => send('lin', text, `burst-${index}`)));
        const s = await waitFor(x => x.jobs.length === 3 && x.jobs.every(j => j.status === 'sent'), '连续三条');
        const actual = s.messages.filter(m => m.role === 'assistant').length; result('3 个 job sent，3 条 assistant 消息', `${actual} 条 assistant，sent=${s.stats.sent}`, actual === 3 && s.stats.sent === 3);
      } else if (type === 'multi') {
        await Promise.all(['lin', 'chen', 'zhou'].map((id, index) => send(id, `多会话 ${index + 1}`, `multi-${id}`)));
        const s = await waitFor(x => x.jobs.length === 3 && x.jobs.every(j => j.status === 'sent'), '多会话');
        const counts = Object.fromEntries(['lin', 'chen', 'zhou'].map(id => [id, s.messages.filter(m => m.role === 'assistant' && m.conversationId === id).length]));
        const passed = Object.values(counts).every(count => count === 1); result('lin/chen/zhou 各 1 条回复', JSON.stringify(counts), passed);
      } else if (type === 'duplicate') {
        const id = 'duplicate-case'; await send('lin', '重复消息', id); await send('lin', '重复消息', id);
        const s = await waitFor(x => x.jobs.length === 1 && x.jobs[0].status === 'sent', '重复 ID');
        const replies = s.messages.filter(m => m.role === 'assistant').length; result('1 个 job、1 条回复、duplicates=1', `jobs=${s.jobs.length} replies=${replies} duplicates=${s.stats.duplicates}`, s.jobs.length === 1 && replies === 1 && s.stats.duplicates === 1);
      } else if (type === 'ack') {
        await request('POST', '/sandbox/faults', { generateFailures: 0, sendFailures: 0, ackLosses: 1, delayMs: 0 }); await send('chen', 'ACK 测试');
        const s = await waitFor(x => x.jobs[0]?.status === 'sent', 'ACK 重试');
        const replies = s.messages.filter(m => m.role === 'assistant').length; result('ACK 丢失后仍只有 1 条回复', `replies=${replies} events=${s.events.filter(e => e.type === 'ack_lost').length}`, replies === 1 && s.events.some(e => e.type === 'ack_lost'));
      } else if (type === 'failure') {
        await request('POST', '/sandbox/faults', { generateFailures: 3, sendFailures: 0, ackLosses: 0, delayMs: 0 }); await send('zhou', '失败三次');
        const s = await waitFor(x => x.jobs[0]?.status === 'failed', '三次失败上限');
        result('3 次失败后 job failed，未发送', `attempts=${s.jobs[0].attempts} failed=${s.stats.failed} replies=${s.messages.filter(m => m.role === 'assistant').length}`, s.jobs[0].attempts === 3 && s.stats.failed === 1 && s.messages.filter(m => m.role === 'assistant').length === 0);
      } else {
        await request('POST', '/sandbox/faults', { generateFailures: 0, sendFailures: 0, ackLosses: 0, delayMs: 700 }); await send('lin', '延迟暂停');
        await sleep(80); await control('pause', { mode: 'rules', replyMode: 'auto' });
        await waitFor(x => x.automation.status === 'paused' && x.jobs[0]?.status === 'queued', '延迟后暂停');
        await sleep(800); await refresh();
        const replies = state.messages.filter(m => m.role === 'assistant').length; result('暂停超过 700ms 后仍 queued，0 条 assistant 消息', `status=${state.jobs[0].status} replies=${replies}`, state.jobs[0].status === 'queued' && replies === 0);
      }
    } catch (error) { result('样例断言通过', error.message, false); } finally { setSampleBusy(false); }
  }
  $('message-form').addEventListener('submit', async event => { event.preventDefault(); const input = $('message-input'); if (!input.value.trim()) return; try { await send(selected, input.value.trim()); input.value = ''; await refresh(); } catch (error) { toast(error.message); } });
  $('conversation-list').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) { selected = button.dataset.id; render(); } });
  ['start', 'pause', 'stop'].forEach(id => $(id).onclick = () => control(id));
  $('mode').onchange = changed; $('reply-mode').onchange = changed;
  $('takeover').onclick = async () => { const current = state?.conversations.find(c => c.id === selected); if (!current) return; try { await request('POST', `/sandbox/conversations/${selected}`, { enabled: !current.enabled }); await refresh(); } catch (error) { toast(error.message); } };
  $('reset').onclick = () => control('reset');
  $('apply-faults').onclick = async () => { try { await request('POST', '/sandbox/faults', { generateFailures: +$('fault-generate').value, sendFailures: +$('fault-send').value, ackLosses: +$('fault-ack').value, delayMs: +$('fault-delay').value }); toast('故障设置已提交。'); await refresh(); } catch (error) { toast(error.message); } };
  $('jobs').onclick = async event => {
    const button = event.target.closest('.copy-reply'); if (!button) return;
    try {
      if (embedded) await request('POST', '/sandbox/clipboard', { jobId: button.dataset.job });
      else {
        const job = state.jobs.find(item => item.id === button.dataset.job);
        if (!job?.reply) throw new Error('没有可复制的草稿');
        await navigator.clipboard.writeText(job.reply);
        await request('POST', '/sandbox/copy', { jobId: job.id });
      }
      toast('草稿已复制，未发送。'); await refresh();
    } catch (error) { toast(`复制失败：${error.message}`); }
  };
  document.querySelectorAll('[data-sample]').forEach(button => button.onclick = () => sample(button.dataset.sample));
  (async () => { try { if (!embedded) await http('GET', '/bootstrap'); $('connection').textContent = embedded ? '等待父窗口中继' : '本地沙箱已连接'; await refresh(); } catch (error) { $('connection').textContent = `无法初始化：${error.message}`; schedule(); } })();
})();
