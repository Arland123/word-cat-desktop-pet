const api = window.catApi;
const byId = (id) => document.getElementById(id);
const elements = {
  streakLine: byId('streak-line'), newWords: byId('stat-new'), reviewWords: byId('stat-review'), streak: byId('stat-streak'), total: byId('stat-total'),
  todayDate: byId('today-date'), newProgressCount: byId('new-progress-count'), newProgressLabel: byId('new-progress-label'), newProgressFill: byId('new-progress-fill'), reviewProgressCount: byId('review-progress-count'), reviewProgressLabel: byId('review-progress-label'), reviewProgressFill: byId('review-progress-fill'),
  newWordButton: byId('new-word-button'), reviewWordButton: byId('review-word-button'), undoNewButton: byId('undo-new-button'), undoReviewButton: byId('undo-review-button'), history: byId('history'), toast: byId('toast'),
  refreshButton: byId('refresh-button'),
  settingsForm: byId('settings-form'), newGoal: byId('new-goal'), reviewGoal: byId('review-goal'),
  apiForm: byId('api-form'), apiKey: byId('api-key'), model: byId('model'), endpoint: byId('endpoint'),
  chatList: byId('chat-list'), chatForm: byId('chat-form'), chatInput: byId('chat-input'), clearChat: byId('clear-chat')
};
const recordModal = byId('record-modal');
const recordTitle = byId('record-title');
const recordNewCount = byId('record-new-count');
const recordReviewCount = byId('record-review-count');
let state = null;
let chatMessages = [];
let catPersonality = '你是用户桌面上的学习小猫，主要陪伴用户完成单词打卡。请用简洁、温暖、自然的中文回复，适时提醒用户坚持单词学习；不要虚构打卡记录，也不要泄露敏感信息。';
let toastTimer = 0;
let modalResolver = null;
let lastDateKey = dateKey();
let refreshInFlight = null;

function dateKey(date = new Date()) {
  return date.toLocaleDateString('sv-SE');
}

function keyFromOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return dateKey(date);
}

function recordsFor(key = dateKey()) {
  const value = state.records[key];
  if (Array.isArray(value)) return { newWords: value.length, reviewWords: 0 };
  return value && typeof value === 'object' ? value : { newWords: 0, reviewWords: 0 };
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

async function refreshState(showToast = false) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = api.loadState().then((nextState) => {
    state = nextState || {};
    state.settings ||= {};
    state.records ||= {};
    state.settings.newWordsGoal ??= state.settings.dailyGoal ?? 10;
    state.settings.reviewWordsGoal ??= 20;
    const today = dateKey();
    const crossedDay = today !== lastDateKey;
    lastDateKey = today;
    render();
    if (showToast) toast(crossedDay ? '日期已更新' : '数据已刷新');
  }).catch(() => {
    if (showToast) toast('刷新失败，请稍后重试');
  }).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function calculateStreak() {
  let streak = 0;
  for (let offset = 0; offset < 3650; offset += 1) {
    const record = recordsFor(keyFromOffset(offset));
    if (record.newWords >= state.settings.newWordsGoal && record.reviewWords >= state.settings.reviewWordsGoal) streak += 1;
    else if (offset === 0) continue;
    else break;
  }
  return streak;
}

function renderHistory() {
  elements.history.innerHTML = '';
  for (let offset = 13; offset >= 0; offset -= 1) {
    const key = keyFromOffset(offset);
    const record = recordsFor(key);
    const count = record.newWords + record.reviewWords;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `day${count ? ' done' : ''}${offset === 0 ? ' today' : ''}`;
    const complete = record.newWords >= state.settings.newWordsGoal && record.reviewWords >= state.settings.reviewWordsGoal;
    cell.innerHTML = `<span class="day-date">${key.slice(5)}</span><span class="day-metrics"><b>新词 <em>${record.newWords}</em></b><b>复习 <em>${record.reviewWords}</em></b></span><span class="day-status">${complete ? '已完成' : count ? '进行中' : '未开始'}</span>`;
    cell.addEventListener('click', async () => {
      const value = await showRecordPrompt(`补录 ${key} 学习数量`, record);
      if (value === null || ![value.newWords, value.reviewWords].every((number) => Number.isInteger(number) && number >= 0 && number <= 500)) return;
      if (!value.newWords && !value.reviewWords) delete state.records[key];
      else state.records[key] = value;
      if (state.studyEvents) delete state.studyEvents[key];
      await api.saveState(state);
      render();
      toast('补录已保存');
    });
    elements.history.appendChild(cell);
  }
}

function render() {
  const today = recordsFor();
  const newGoal = state.settings.newWordsGoal;
  const reviewGoal = state.settings.reviewWordsGoal;
  const streak = calculateStreak();
  const total = Object.values(state.records).reduce((sum, value) => { const record = Array.isArray(value) ? { newWords: value.length, reviewWords: 0 } : value; return sum + (record?.newWords || 0) + (record?.reviewWords || 0); }, 0);
  const newRemaining = Math.max(0, newGoal - today.newWords);
  const reviewRemaining = Math.max(0, reviewGoal - today.reviewWords);
  elements.newWords.textContent = today.newWords;
  elements.reviewWords.textContent = today.reviewWords;
  elements.streak.textContent = streak;
  elements.total.textContent = total;
  elements.todayDate.textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
  elements.newProgressCount.textContent = `${today.newWords} / ${newGoal}`;
  elements.newProgressLabel.textContent = newRemaining ? `还差 ${newRemaining} 个新词` : '新词目标已完成';
  elements.reviewProgressCount.textContent = `${today.reviewWords} / ${reviewGoal}`;
  elements.reviewProgressLabel.textContent = reviewRemaining ? `还差 ${reviewRemaining} 个复习词` : '复习目标已完成';
  elements.newProgressFill.style.transform = `scaleX(${newGoal ? Math.min(1, today.newWords / newGoal) : 1})`;
  elements.reviewProgressFill.style.transform = `scaleX(${reviewGoal ? Math.min(1, today.reviewWords / reviewGoal) : 1})`;
  elements.newProgressFill.parentElement.setAttribute('aria-valuemax', newGoal);
  elements.newProgressFill.parentElement.setAttribute('aria-valuenow', today.newWords);
  elements.reviewProgressFill.parentElement.setAttribute('aria-valuemax', reviewGoal);
  elements.reviewProgressFill.parentElement.setAttribute('aria-valuenow', today.reviewWords);
  elements.streakLine.textContent = !newRemaining && !reviewRemaining ? `今天新词和复习都达标，连续打卡 ${streak} 天` : `今天已完成新词 ${today.newWords} 个、复习 ${today.reviewWords} 个`;
  elements.undoNewButton.disabled = today.newWords === 0;
  elements.undoReviewButton.disabled = today.reviewWords === 0;
  renderHistory();
}

function showRecordPrompt(title, value) {
  recordTitle.textContent = title;
  recordNewCount.value = value.newWords;
  recordReviewCount.value = value.reviewWords;
  recordModal.classList.remove('hidden');
  setTimeout(() => { recordNewCount.focus(); recordNewCount.select(); }, 30);
  return new Promise((resolve) => { modalResolver = resolve; });
}

function closeRecordPrompt(value) {
  recordModal.classList.add('hidden');
  modalResolver?.(value);
  modalResolver = null;
}

byId('record-cancel').addEventListener('click', () => closeRecordPrompt(null));
byId('record-save').addEventListener('click', () => closeRecordPrompt({ newWords: Number(recordNewCount.value), reviewWords: Number(recordReviewCount.value) }));
recordModal.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeRecordPrompt(null);
  if (event.key === 'Enter') closeRecordPrompt({ newWords: Number(recordNewCount.value), reviewWords: Number(recordReviewCount.value) });
});

async function addStudyRecord(type) {
  const key = dateKey();
  state = await api.recordStudy({ newWords: type === 'newWords' ? 1 : 0, reviewWords: type === 'reviewWords' ? 1 : 0, date: key });
  render();
  toast(type === 'newWords' ? '已记录一个新词' : '已记录一次复习');
}

elements.newWordButton.addEventListener('click', () => addStudyRecord('newWords'));
elements.reviewWordButton.addEventListener('click', () => addStudyRecord('reviewWords'));

elements.undoNewButton.addEventListener('click', async () => {
  const key = dateKey();
  state = await api.undoNewWord(key);
  render();
  toast('已撤销一个新词');
});

elements.undoReviewButton.addEventListener('click', async () => {
  const key = dateKey();
  state = await api.undoReviewWord(key);
  render();
  toast('已撤销一次复习');
});

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const newWordsGoal = Number(elements.newGoal.value);
  const reviewWordsGoal = Number(elements.reviewGoal.value);
  if (![newWordsGoal, reviewWordsGoal].every((value) => Number.isInteger(value) && value >= 0 && value <= 500) || (newWordsGoal === 0 && reviewWordsGoal === 0)) {
    toast('请检查打卡设置');
    return;
  }
  state.settings = { ...state.settings, newWordsGoal, reviewWordsGoal };
  await api.saveState(state);
  render();
  toast('打卡设置已保存');
});

function apiSettings() {
  return { stepfunApiKey: elements.apiKey.value.trim(), stepfunModel: elements.model.value.trim(), stepfunEndpoint: elements.endpoint.value.trim() };
}

function learningContext() {
  const today = recordsFor();
  const newGoal = state.settings.newWordsGoal;
  const reviewGoal = state.settings.reviewWordsGoal;
  const recent = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const key = keyFromOffset(offset);
    const record = recordsFor(key);
    recent.push(`${key}: 新词 ${record.newWords} 个、复习 ${record.reviewWords} 个`);
  }
  return [
    '这是用户当前的单词学习数据，请据此给出准确反馈，不要猜测或修改数据：',
    `今天（${dateKey()}）已学习新词 ${today.newWords} 个（目标 ${newGoal} 个），复习 ${today.reviewWords} 个（目标 ${reviewGoal} 个）。`,
    `连续达标 ${calculateStreak()} 天，累计学习 ${Object.values(state.records).reduce((sum, value) => { const record = Array.isArray(value) ? { newWords: value.length, reviewWords: 0 } : value; return sum + (record?.newWords || 0) + (record?.reviewWords || 0); }, 0)} 个。`,
    `最近 7 天：${recent.join('；')}。`
  ].join('\n');
}

elements.apiForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!elements.model.value.trim() || !elements.endpoint.value.trim()) return toast('请填写模型和接口地址');
  state.settings = { ...state.settings, ...apiSettings() };
  await api.saveState(state);
  toast('StepFun 设置已保存');
});

function renderChat() {
  if (!chatMessages.length) {
    elements.chatList.innerHTML = '<p class="empty">输入一句话，和猫咪聊聊。</p>';
    return;
  }
  elements.chatList.innerHTML = '';
  chatMessages.forEach((message) => {
    const item = document.createElement('article');
    item.className = `message ${message.role}`;
    item.textContent = message.content;
    elements.chatList.appendChild(item);
  });
  elements.chatList.scrollTop = elements.chatList.scrollHeight;
}

async function sendChatMessage(event) {
  if (event) event.preventDefault();
  if (elements.chatForm.querySelector('button').disabled) return;
  const content = elements.chatInput.value.trim();
  if (!content) return;
  chatMessages.push({ role: 'user', content });
  elements.chatInput.value = '';
  renderChat();
  const button = elements.chatForm.querySelector('button');
  button.disabled = true;
  try {
    state = await api.loadState();
    catPersonality = await api.loadCatPersonality();
    const raw = await api.sendChat({
      messages: [
        { role: 'system', content: catPersonality },
        { role: 'system', content: learningContext() },
        { role: 'system', content: window.chatActions.modelProtocol() },
        ...chatMessages
      ],
      settings: apiSettings()
    });
    const result = await window.chatActions.handleModelResponse(raw, api);
    if (result.state) state = result.state;
    chatMessages.push({ role: 'assistant', content: result.reply });
  } catch (error) {
    chatMessages.push({ role: 'assistant', content: `暂时没连上 StepFun：${error.message}` });
  } finally {
    button.disabled = false;
    renderChat();
    elements.chatInput.focus();
  }
}

elements.chatInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  sendChatMessage();
});
elements.chatForm.addEventListener('submit', sendChatMessage);

elements.clearChat.addEventListener('click', () => { chatMessages = []; renderChat(); });
elements.refreshButton.addEventListener('click', () => refreshState(true));
window.addEventListener('focus', () => refreshState());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshState();
});
setInterval(() => {
  if (dateKey() !== lastDateKey) refreshState();
}, 30000);

(async () => {
  await refreshState();
  elements.newGoal.value = state.settings.newWordsGoal;
  elements.reviewGoal.value = state.settings.reviewWordsGoal;
  elements.apiKey.value = state.settings.stepfunApiKey || '';
  elements.model.value = state.settings.stepfunModel || 'step-3.7-flash';
  elements.endpoint.value = state.settings.stepfunEndpoint || 'https://api.stepfun.com/step_plan/v1/chat/completions';
  render();
  renderChat();
})();
