const api = window.catApi;
const byId = (id) => document.getElementById(id);
const elements = {
  streakLine: byId('streak-line'), today: byId('stat-today'), goalStat: byId('stat-goal'), streak: byId('stat-streak'), total: byId('stat-total'),
  todayDate: byId('today-date'), progressCount: byId('progress-count'), progressLabel: byId('progress-label'), progressFill: byId('progress-fill'),
  checkinButton: byId('checkin-button'), undoButton: byId('undo-button'), remindButton: byId('remind-button'), history: byId('history'), toast: byId('toast'),
  settingsForm: byId('settings-form'), goal: byId('goal'), interval: byId('interval'), startTime: byId('start-time'), endTime: byId('end-time'), sound: byId('sound'),
  apiForm: byId('api-form'), apiKey: byId('api-key'), model: byId('model'), endpoint: byId('endpoint'),
  chatList: byId('chat-list'), chatForm: byId('chat-form'), chatInput: byId('chat-input'), clearChat: byId('clear-chat')
};
const recordModal = byId('record-modal');
const recordTitle = byId('record-title');
const recordCount = byId('record-count');
let state = null;
let chatMessages = [];
let catPersonality = '你是用户桌面上的学习小猫，主要陪伴用户完成单词打卡。请用简洁、温暖、自然的中文回复，适时提醒用户坚持单词学习；不要虚构打卡记录，也不要泄露敏感信息。';
let toastTimer = 0;
let modalResolver = null;

function dateKey(date = new Date()) {
  return date.toLocaleDateString('sv-SE');
}

function keyFromOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return dateKey(date);
}

function recordsFor(key = dateKey()) {
  return Array.isArray(state.records[key]) ? state.records[key] : [];
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

function calculateStreak() {
  let streak = 0;
  for (let offset = 0; offset < 3650; offset += 1) {
    const count = recordsFor(keyFromOffset(offset)).length;
    if (count >= state.settings.dailyGoal) streak += 1;
    else if (offset === 0) continue;
    else break;
  }
  return streak;
}

function renderHistory() {
  elements.history.innerHTML = '';
  for (let offset = 13; offset >= 0; offset -= 1) {
    const key = keyFromOffset(offset);
    const count = recordsFor(key).length;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `day${count ? ' done' : ''}${offset === 0 ? ' today' : ''}`;
    cell.innerHTML = `<strong>${count}</strong><small>${key.slice(5)}</small>`;
    cell.addEventListener('click', async () => {
      const value = await showRecordPrompt(`补录 ${key} 打卡数量`, count);
      if (value === null || !Number.isInteger(value) || value < 0 || value > 500) return;
      if (!value) delete state.records[key];
      else state.records[key] = Array.from({ length: value }, (_, index) => `manual-${key}-${index}`);
      await api.saveState(state);
      render();
      toast('补录已保存');
    });
    elements.history.appendChild(cell);
  }
}

function render() {
  const today = recordsFor().length;
  const goal = state.settings.dailyGoal;
  const streak = calculateStreak();
  const total = Object.values(state.records).reduce((sum, records) => sum + (Array.isArray(records) ? records.length : 0), 0);
  const remaining = Math.max(0, goal - today);
  const percent = Math.min(100, Math.round((today / goal) * 100));
  elements.today.textContent = today;
  elements.goalStat.textContent = goal;
  elements.streak.textContent = streak;
  elements.total.textContent = total;
  elements.todayDate.textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
  elements.progressCount.textContent = `${today} / ${goal}`;
  elements.progressLabel.textContent = remaining ? `还差 ${remaining} 个单词` : '今日目标已完成';
  elements.progressFill.style.transform = `scaleX(${percent / 100})`;
  elements.progressFill.parentElement.setAttribute('aria-valuemax', goal);
  elements.progressFill.parentElement.setAttribute('aria-valuenow', today);
  elements.streakLine.textContent = today >= goal ? `今天已达标，连续打卡 ${streak} 天` : `今天已完成 ${today} 个单词`;
  elements.undoButton.disabled = today === 0;
  renderHistory();
}

function showRecordPrompt(title, value) {
  recordTitle.textContent = title;
  recordCount.value = value;
  recordModal.classList.remove('hidden');
  setTimeout(() => { recordCount.focus(); recordCount.select(); }, 30);
  return new Promise((resolve) => { modalResolver = resolve; });
}

function closeRecordPrompt(value) {
  recordModal.classList.add('hidden');
  modalResolver?.(value);
  modalResolver = null;
}

byId('record-cancel').addEventListener('click', () => closeRecordPrompt(null));
byId('record-save').addEventListener('click', () => closeRecordPrompt(Number(recordCount.value)));
recordModal.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeRecordPrompt(null);
  if (event.key === 'Enter') closeRecordPrompt(Number(recordCount.value));
});

elements.checkinButton.addEventListener('click', async () => {
  const key = dateKey();
  const records = recordsFor(key);
  records.push(`checkin-${Date.now()}-${crypto.randomUUID()}`);
  state.records[key] = records;
  await api.saveState(state);
  render();
  toast(records.length >= state.settings.dailyGoal ? '今日目标已完成' : '已记录一次打卡');
});

elements.undoButton.addEventListener('click', async () => {
  const key = dateKey();
  const records = recordsFor(key);
  if (!records.length) return;
  records.pop();
  if (records.length) state.records[key] = records;
  else delete state.records[key];
  await api.saveState(state);
  render();
  toast('已撤销一次打卡');
});

elements.remindButton.addEventListener('click', () => {
  api.triggerReminder();
  toast('已提醒桌宠');
});

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const dailyGoal = Number(elements.goal.value);
  const intervalMinutes = Number(elements.interval.value);
  if (!Number.isInteger(dailyGoal) || dailyGoal < 1 || dailyGoal > 500 || !Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 480) {
    toast('请检查打卡设置');
    return;
  }
  state.settings = { ...state.settings, dailyGoal, intervalMinutes, reminderStart: elements.startTime.value, reminderEnd: elements.endTime.value, sound: elements.sound.checked };
  await api.saveState(state);
  render();
  toast('打卡设置已保存');
});

function apiSettings() {
  return { stepfunApiKey: elements.apiKey.value.trim(), stepfunModel: elements.model.value.trim(), stepfunEndpoint: elements.endpoint.value.trim() };
}

function learningContext() {
  const today = recordsFor().length;
  const goal = state.settings.dailyGoal;
  const remaining = Math.max(0, goal - today);
  const recent = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const key = keyFromOffset(offset);
    recent.push(`${key}: ${recordsFor(key).length} 个`);
  }
  return [
    '这是用户当前的单词学习数据，请据此给出准确反馈，不要猜测或修改数据：',
    `今天（${dateKey()}）已打卡 ${today} 个，今日目标 ${goal} 个，${remaining ? `还差 ${remaining} 个` : '今日目标已完成'}。`,
    `连续达标 ${calculateStreak()} 天，累计打卡 ${Object.values(state.records).reduce((sum, records) => sum + (Array.isArray(records) ? records.length : 0), 0)} 个。`,
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

elements.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
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
    const reply = await api.sendChat({
      messages: [
        { role: 'system', content: catPersonality },
        { role: 'system', content: learningContext() },
        ...chatMessages
      ],
      settings: apiSettings()
    });
    chatMessages.push({ role: 'assistant', content: reply });
  } catch (error) {
    chatMessages.push({ role: 'assistant', content: `暂时没连上 StepFun：${error.message}` });
  } finally {
    button.disabled = false;
    renderChat();
    elements.chatInput.focus();
  }
});

elements.clearChat.addEventListener('click', () => { chatMessages = []; renderChat(); });

(async () => {
  state = await api.loadState();
  state.records ||= {};
  state.settings.dailyGoal ||= 20;
  elements.goal.value = state.settings.dailyGoal;
  elements.interval.value = state.settings.intervalMinutes;
  elements.startTime.value = state.settings.reminderStart;
  elements.endTime.value = state.settings.reminderEnd;
  elements.sound.checked = state.settings.sound;
  elements.apiKey.value = state.settings.stepfunApiKey || '';
  elements.model.value = state.settings.stepfunModel || 'step-3.7-flash';
  elements.endpoint.value = state.settings.stepfunEndpoint || 'https://api.stepfun.com/v1/chat/completions';
  render();
  renderChat();
})();
