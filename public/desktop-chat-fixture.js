(() => {
  const initial = [
    { id: 'lin', name: '林小雨', messages: [{ direction: 'incoming', text: '想了解一下团队协作怎么开始。', stamp: '09:30' }] },
    { id: 'chen', name: '陈先生', messages: [{ direction: 'incoming', text: '下午可以安排演示吗？', stamp: '09:31' }] },
    { id: 'zhou', name: '周女士', messages: [{ direction: 'incoming', text: '我先看看资料，谢谢。', stamp: '09:32' }] },
  ];
  const state = {
    selected: 'lin',
    conversations: initial.map(conversation => ({ ...conversation, unread: 0, composer: '', messages: conversation.messages.map(message => ({ ...message })) })),
    fault: { mode: 'normal', delayMs: 800, blocked: false, deliveryState: 'clear' },
    sent: [],
    ime: { mode: 'zh', composition: '', page: 0, style: 'microsoft', dictionary: {}, doubleQuoteOpen: true, singleQuoteOpen: true },
  };
  const $ = selector => document.querySelector(selector);
  const byName = name => state.conversations.find(item => item.name === name || item.id === name);
  const current = () => state.conversations.find(item => item.id === state.selected);
  const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const clone = value => JSON.parse(JSON.stringify(value));
  const composer = () => $('#composer');
  const resetIme = () => { state.ime.composition = ''; state.ime.page = 0; };
  const candidatePages = () => {
    const words = state.ime.dictionary[state.ime.composition] || [];
    return Array.from({ length: Math.ceil(words.length / 9) }, (_, page) => words.slice(page * 9, page * 9 + 9));
  };
  const candidates = () => (candidatePages()[state.ime.page] || []).map((text, index) => ({ key: String(index + 1), text }));
  const renderIme = () => {
    const box = $('#ime-candidates'); const items = candidates();
    box.dataset.style = state.ime.style; box.hidden = !state.ime.composition;
    if (box.hidden) { box.replaceChildren(); return; }
    const header = document.createElement('div'); header.className = 'ime-label'; header.textContent = `虚构输入法 · ${state.ime.composition} · ${state.ime.page + 1}/${Math.max(1, candidatePages().length)}`;
    const list = document.createElement('div'); list.className = 'ime-list';
    for (const item of items) { const candidate = document.createElement('span'); candidate.className = 'ime-candidate'; candidate.textContent = `${item.key}. ${item.text}`; list.append(candidate); }
    if (!items.length) { const unknown = document.createElement('span'); unknown.className = 'ime-unknown'; unknown.textContent = '候选不完整'; list.append(unknown); }
    box.replaceChildren(header, list);
  };
  const insertAtCaret = text => {
    const input = composer(); const conversation = current(); const start = Number.isInteger(input.selectionStart) ? input.selectionStart : conversation.composer.length; const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    conversation.composer = `${conversation.composer.slice(0, start)}${text}${conversation.composer.slice(end)}`;
    input.value = conversation.composer; const next = start + text.length; input.setSelectionRange(next, next); renderList();
  };
  const eraseBeforeCaret = () => {
    const input = composer(); const conversation = current(); const start = input.selectionStart ?? conversation.composer.length; const end = input.selectionEnd ?? start;
    if (start === 0 && end === 0) return; const from = start === end ? start - 1 : start;
    conversation.composer = `${conversation.composer.slice(0, from)}${conversation.composer.slice(end)}`; input.value = conversation.composer; input.setSelectionRange(from, from); renderList();
  };
  const chinesePunctuation = char => {
    const plain = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；', '(': '（', ')': '）', '\\': '、', '<': '《', '>': '》' };
    if (char === '"') { const value = state.ime.doubleQuoteOpen ? '“' : '”'; state.ime.doubleQuoteOpen = !state.ime.doubleQuoteOpen; return value; }
    if (char === "'") { const value = state.ime.singleQuoteOpen ? '‘' : '’'; state.ime.singleQuoteOpen = !state.ime.singleQuoteOpen; return value; }
    return plain[char] || char;
  };
  const requireComposerFocus = () => { if (document.activeElement !== composer()) throw new Error('虚构输入法要求消息输入框保持焦点。'); };
  const selectCandidate = key => {
    const candidate = candidates().find(item => item.key === key); if (!candidate) throw new Error('当前候选页没有该编号。');
    insertAtCaret(candidate.text); resetIme(); renderIme();
  };
  const imeKey = command => {
    if (typeof command !== 'string' || !/^(text\t[\x20-\x7e]|key\t(?:shift|escape|pagedown|backspace))$/.test(command)) throw new Error('虚构输入法命令无效。');
    requireComposerFocus(); const [kind, value] = command.split('\t'); const ime = state.ime;
    if (kind === 'key') {
      if (value === 'shift') { if (ime.composition) throw new Error('拼音组合中不能切换输入语言。'); ime.mode = ime.mode === 'zh' ? 'en' : 'zh'; renderIme(); return; }
      if (value === 'escape') { resetIme(); renderIme(); return; }
      if (value === 'pagedown') { const pages = candidatePages(); if (!ime.composition || ime.page + 1 >= pages.length) throw new Error('没有下一页虚构候选词。'); ime.page++; renderIme(); return; }
      if (value === 'backspace') { if (ime.composition) { ime.composition = ime.composition.slice(0, -1); ime.page = 0; renderIme(); } else eraseBeforeCaret(); return; }
      return;
    }
    if (ime.composition && /^[1-9]$/.test(value)) { selectCandidate(value); return; }
    if (ime.mode === 'en') { insertAtCaret(value); return; }
    if (/^[A-Za-z]$/.test(value)) { ime.composition += value.toLowerCase(); ime.page = 0; renderIme(); return; }
    if (ime.composition) throw new Error('请先选择或取消当前拼音组合。');
    insertAtCaret(chinesePunctuation(value));
  };
  const imeScene = () => {
    const input = composer(); const rect = input.getBoundingClientRect(); const width = Math.max(1, window.innerWidth); const height = Math.max(1, window.innerHeight); const items = candidates();
    return clone({ focused: document.activeElement === input, field: { x: Math.max(0, Math.min(1, rect.x / width)), y: Math.max(0, Math.min(1, rect.y / height)), width: Math.max(0, Math.min(1, rect.width / width)), height: Math.max(0, Math.min(1, rect.height / height)) }, text: current().composer, composition: state.ime.composition, candidates: items, confidence: document.activeElement === input ? .99 : .9, blocked: !!(state.ime.composition && !items.length) });
  };
  const configureIme = entries => {
    if (!Array.isArray(entries) || entries.length > 500) throw new Error('虚构输入法词典无效。'); const dictionary = {};
    for (const entry of entries) { if (!entry || typeof entry.spelling !== 'string' || !/^[a-z]{1,64}$/.test(entry.spelling) || !Array.isArray(entry.candidates) || entry.candidates.length > 81 || entry.candidates.some(word => typeof word !== 'string' || !word || word.length > 64)) throw new Error('虚构输入法词典无效。'); dictionary[entry.spelling] = [...new Set(entry.candidates)]; }
    state.ime.dictionary = dictionary; resetIme(); renderIme();
  };
  const setImeStyle = style => { if (!['microsoft', 'wechat', 'sogou', 'baidu'].includes(style)) throw new Error('虚构输入法样式无效。'); state.ime.style = style; renderIme(); };
  const preview = conversation => {
    const last = conversation.messages.at(-1);
    return last ? `${last.direction === 'outgoing' ? '我：' : ''}${last.text}` : '暂无消息';
  };
  const renderList = () => {
    const list = $('#conversation-list');
    list.replaceChildren(...state.conversations.map(conversation => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `conversation ${conversation.id === state.selected ? 'active' : ''}`;
      button.dataset.conversation = conversation.name;
      const name = document.createElement('span'); name.className = 'conversation-name'; name.textContent = conversation.name;
      const last = document.createElement('span'); last.className = 'conversation-preview'; last.textContent = preview(conversation);
      button.append(name, last);
      if (conversation.unread) { const unread = document.createElement('b'); unread.className = 'unread'; unread.textContent = String(conversation.unread); button.append(unread); }
      button.addEventListener('click', () => switchConversation(conversation.name));
      return button;
    }));
  };
  const render = () => {
    const conversation = current();
    $('#chat-header').replaceChildren(Object.assign(document.createElement('span'), { textContent: conversation.name }), Object.assign(document.createElement('small'), { textContent: '虚构会话' }));
    const messages = $('#messages');
    messages.replaceChildren(...conversation.messages.map(message => {
      const row = document.createElement('div'); row.className = `message ${message.direction}`;
      const bubble = document.createElement('div'); bubble.className = 'bubble';
      const text = document.createElement('span'); text.textContent = message.text;
      const time = document.createElement('span'); time.className = 'stamp'; time.textContent = message.stamp;
      bubble.append(text, time); row.append(bubble); return row;
    }));
    messages.scrollTop = messages.scrollHeight;
    const composer = $('#composer');
    if (composer.value !== conversation.composer) composer.value = conversation.composer;
    renderList();
    renderIme();
  };
  const switchConversation = name => {
    const conversation = byName(name);
    if (!conversation) throw new Error(`未知虚构会话：${name}`);
    state.selected = conversation.id; conversation.unread = 0; resetIme(); render();
    return conversation.name;
  };
  const inject = (name, text, at) => {
    const conversation = byName(name);
    if (!conversation || typeof text !== 'string' || !text.trim()) throw new Error('注入消息无效。');
    conversation.messages.push({ direction: 'incoming', text: text.trim(), stamp: at || stamp() });
    if (conversation.id !== state.selected) conversation.unread += 1;
    render(); return clone(conversation.messages.at(-1));
  };
  const send = async text => {
    const conversation = current(); const message = (text ?? conversation.composer).trim();
    if (!message) return { sent: false, reason: 'empty' };
    if (state.fault.mode === 'no_send') { state.fault.deliveryState = 'failed'; render(); return { sent: false, reason: 'no_send' }; }
    if (state.fault.mode === 'delay') { state.fault.deliveryState = 'pending'; render(); await new Promise(resolve => setTimeout(resolve, state.fault.delayMs)); }
    if (state.fault.blocked) { state.fault.deliveryState = 'failed'; render(); return { sent: false, reason: 'blocked' }; }
    const outgoing = { direction: 'outgoing', text: message, stamp: stamp() };
    conversation.messages.push(outgoing); conversation.composer = ''; state.fault.deliveryState = 'clear';
    state.sent.push({ conversation: conversation.name, ...outgoing }); render(); return { sent: true, message: clone(outgoing) };
  };
  $('#composer').addEventListener('input', event => { current().composer = event.target.value; resetIme(); renderIme(); });
  $('#send').addEventListener('click', () => { void send(); });
  $('#composer').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } });
  document.querySelectorAll('[data-inject]').forEach(button => button.addEventListener('click', () => inject(button.dataset.inject, `${button.dataset.inject} 的测试新消息`)));
  $('#fault').addEventListener('change', event => setFault({ mode: event.target.value }));
  $('#close-fixture').addEventListener('click', () => window.close());
  const setFault = input => {
    const next = { ...state.fault, ...input };
    if (!['normal', 'no_send', 'delay'].includes(next.mode)) throw new Error('未知发送故障。');
    if (!Number.isFinite(next.delayMs) || next.delayMs < 0 || next.delayMs > 10000) throw new Error('延迟无效。');
    state.fault = next; $('#fault').value = next.mode; render(); return clone(state.fault);
  };
  window.desktopRepliesFixture = {
    inject,
    switchConversation,
    manualSend: send,
    setComposer: text => { if (typeof text !== 'string') throw new Error('输入内容无效。'); current().composer = text; render(); },
    configureIme,
    imeKey,
    imeScene,
    setImeStyle,
    setFault,
    result: () => clone({
      activeConversationName: current().name,
      conversations: state.conversations.map(({ id, name, unread, composer, messages }) => ({ id, name, unread, composer, messages })),
      sent: state.sent,
      fault: state.fault,
      sceneBlocked: state.fault.blocked,
      deliveryState: state.fault.deliveryState,
    }),
  };
  render();
})();
