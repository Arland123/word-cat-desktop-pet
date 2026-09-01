const api = window.catApi;
const list = document.getElementById('chat-list');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const clearButton = document.getElementById('clear-chat');
let state = null;
let personality = '';
let messages = [];

function dateKey(date = new Date()) { return date.toLocaleDateString('sv-SE'); }
function keyFromOffset(offset) { const date = new Date(); date.setDate(date.getDate() - offset); return dateKey(date); }
function recordsFor(key = dateKey()) { return Array.isArray(state.records[key]) ? state.records[key] : []; }
function streak() {
  let value = 0;
  for (let offset = 0; offset < 3650; offset += 1) {
    if (recordsFor(keyFromOffset(offset)).length >= state.settings.dailyGoal) value += 1;
    else if (offset > 0) break;
  }
  return value;
}
function learningContext() {
  const today = recordsFor().length;
  const goal = state.settings.dailyGoal;
  const total = Object.values(state.records).reduce((sum, records) => sum + (Array.isArray(records) ? records.length : 0), 0);
  return `用户单词学习数据（仅用于准确反馈，不要猜测或修改）：今天已打卡 ${today} 个，目标 ${goal} 个，还差 ${Math.max(0, goal - today)} 个；连续达标 ${streak()} 天；累计 ${total} 个。`;
}
function render() {
  if (!messages.length) { list.innerHTML = '<p class="empty">说点什么吧，喵。</p>'; return; }
  list.innerHTML = '';
  messages.forEach((message) => {
    const item = document.createElement('article');
    item.className = `message ${message.role}`;
    item.textContent = message.content;
    list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content) return;
  messages.push({ role: 'user', content });
  input.value = '';
  render();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    state = await api.loadState();
    personality = await api.loadCatPersonality();
    const reply = await api.sendChat({ messages: [{ role: 'system', content: personality }, { role: 'system', content: learningContext() }, ...messages], settings: state.settings });
    messages.push({ role: 'assistant', content: reply });
  } catch (error) {
    messages.push({ role: 'assistant', content: `暂时没连上 StepFun：${error.message}` });
  } finally {
    button.disabled = false;
    render();
    input.focus();
  }
});

clearButton.addEventListener('click', () => { messages = []; render(); input.focus(); });

(async () => {
  state = await api.loadState();
  personality = await api.loadCatPersonality();
  render();
  input.focus();
})();
