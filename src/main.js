const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let petWindow = null;
let panelWindow = null;
let chatWindow = null;
let tray = null;
let quitRequested = false;
let dragAnchor = null;
let dragLastCursor = null;

const dataDir = path.join(app.getPath('userData'), 'word-cat');
const dataFile = path.join(dataDir, 'state.json');
const legacyDataFile = path.join(__dirname, '..', 'data', 'state.json');
const catPersonalityFile = path.join(__dirname, '..', 'cat-personality.md');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const defaultCatPersonality = '你是用户桌面上的学习小猫，主要陪伴用户完成单词打卡。请用简洁、温暖、自然的中文回复，适时提醒用户坚持单词学习；不要虚构打卡记录，也不要泄露敏感信息。';

const defaultState = {
  settings: {
    newWordsGoal: 10,
    reviewWordsGoal: 20,
    petScale: 1,
    reminderEnabled: true,
    reminderStart: '09:00',
    reminderEnd: '22:00',
    reminderInterval: 60,
    aiApiKey: '',
    aiModel: 'step-3.7-flash',
    aiEndpoint: 'https://api.stepfun.com/step_plan/v1/chat/completions'
  },
  records: {},
  studyEvents: {}
};

const PET_BASE_WIDTH = 270;
// 高度需要给耳朵高度锚定的气泡留出向上生长的空间
const PET_BASE_HEIGHT = 420;
const PET_RIGHT_MARGIN = 60;
const PET_BOTTOM_MARGIN = 90;

function clampPetScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.round(Math.min(2, Math.max(0.5, number)) * 100) / 100;
}

function ensureState() {
  fs.mkdirSync(dataDir, { recursive: true });
  const sourceFile = fs.existsSync(dataFile) ? dataFile : legacyDataFile;
  if (!fs.existsSync(sourceFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultState, null, 2), 'utf8');
  }
  try {
    const loaded = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) || {};
    const legacySettings = loaded.settings || {};
    const settings = {
      ...defaultState.settings,
      ...legacySettings,
      newWordsGoal: legacySettings.newWordsGoal ?? legacySettings.new_words_goal ?? legacySettings.dailyGoal ?? legacySettings.daily_goal ?? defaultState.settings.newWordsGoal,
      reviewWordsGoal: legacySettings.reviewWordsGoal ?? legacySettings.review_words_goal ?? defaultState.settings.reviewWordsGoal
    };
    settings.newWordsGoal = clampInteger(settings.newWordsGoal, 0, 500, defaultState.settings.newWordsGoal);
    settings.reviewWordsGoal = clampInteger(settings.reviewWordsGoal, 0, 500, defaultState.settings.reviewWordsGoal);
    const legacyApiKey = typeof (legacySettings.aiApiKey ?? legacySettings.stepfunApiKey) === 'string' ? (legacySettings.aiApiKey ?? legacySettings.stepfunApiKey).trim() : '';
    settings.aiApiKey = legacyApiKey;
    const legacyModel = legacySettings.aiModel ?? legacySettings.stepfunModel;
    settings.aiModel = typeof legacyModel === 'string' && legacyModel.trim() ? legacyModel.trim() : defaultState.settings.aiModel;
    if (settings.aiModel === 'step-1-8k' || settings.aiModel === 'step-3.5-flash') settings.aiModel = defaultState.settings.aiModel;
    settings.aiEndpoint = normalizeEndpoint(legacySettings.aiEndpoint ?? legacySettings.stepfunEndpoint, defaultState.settings.aiEndpoint);
    settings.petScale = clampPetScale(legacySettings.petScale ?? defaultState.settings.petScale);
    settings.reminderEnabled = typeof legacySettings.reminderEnabled === 'boolean' ? legacySettings.reminderEnabled : defaultState.settings.reminderEnabled;
    settings.reminderStart = normalizeTime(legacySettings.reminderStart, defaultState.settings.reminderStart);
    settings.reminderEnd = normalizeTime(legacySettings.reminderEnd, defaultState.settings.reminderEnd);
    settings.reminderInterval = clampInteger(legacySettings.reminderInterval, 5, 720, defaultState.settings.reminderInterval);
    delete settings.stepfunApiKey;
    delete settings.stepfunModel;
    delete settings.stepfunEndpoint;
    const normalized = {
      settings,
      records: normalizeRecords(loaded.records),
      studyEvents: normalizeStudyEvents(loaded.studyEvents)
    };
    if (sourceFile !== dataFile) saveState(normalized);
    return normalized;
  } catch {
    return structuredClone(defaultState);
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeTime(value, fallback) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function normalizeRecord(value) {
  if (Array.isArray(value)) return { newWords: value.length, reviewWords: 0 };
  if (!value || typeof value !== 'object') return { newWords: 0, reviewWords: 0 };
  return {
    newWords: clampInteger(value.newWords ?? value.new_words, 0, 500, 0),
    reviewWords: clampInteger(value.reviewWords ?? value.review_words, 0, 500, 0)
  };
}

function normalizeRecords(records) {
  if (!records || typeof records !== 'object') return {};
  return Object.fromEntries(Object.entries(records).map(([key, value]) => [key, normalizeRecord(value)]));
}

function normalizeEvent(value) {
  if (value === 'newWords') return { newWords: 1, reviewWords: 0 };
  if (value === 'reviewWords') return { newWords: 0, reviewWords: 1 };
  if (!value || typeof value !== 'object') return { newWords: 0, reviewWords: 0 };
  return {
    newWords: clampInteger(value.newWords, 0, 500, 0),
    reviewWords: clampInteger(value.reviewWords, 0, 500, 0)
  };
}

function normalizeStudyEvents(events) {
  if (!events || typeof events !== 'object') return {};
  return Object.fromEntries(Object.entries(events).map(([key, value]) => [
    key,
    (Array.isArray(value) ? value : []).map(normalizeEvent).filter((entry) => entry.newWords || entry.reviewWords).slice(-1000)
  ]).filter(([, value]) => value.length));
}

function normalizeEndpoint(value, fallback) {
  try {
    const url = new URL(value);
    const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return fallback;
    const pathName = url.pathname.replace(/\/+$/, '');
    if (url.hostname === 'api.stepfun.com') {
      if (!pathName || pathName === '/step_plan' || pathName === '/step_plan/v1') {
        return 'https://api.stepfun.com/step_plan/v1/chat/completions';
      }
      if (pathName === '/step_plan/v1/chat/completions' || pathName === '/v1/chat/completions') {
        return `https://api.stepfun.com${pathName}`;
      }
    }
    if (!pathName || pathName === '/v1') {
      return `${url.origin}${pathName}/chat/completions`;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function saveState(state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2), 'utf8');
}

const backupDir = path.join(dataDir, 'backups');

function backupState(now = new Date()) {
  try {
    if (!fs.existsSync(dataFile)) return;
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = `${now.toLocaleDateString('sv-SE')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    fs.copyFileSync(dataFile, path.join(backupDir, `backup-${stamp}.json`));
    const files = fs.readdirSync(backupDir).filter((name) => name.startsWith('backup-') && name.endsWith('.json')).sort();
    while (files.length > 3) fs.unlinkSync(path.join(backupDir, files.shift()));
  } catch { /* 备份失败不影响主流程 */ }
}

function todayKey() {
  return new Date().toLocaleDateString('sv-SE');
}

function normalizeDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return value;
  }
  return todayKey();
}

function adjustStudyRecord({ newWords = 0, reviewWords = 0, date } = {}) {
  const state = ensureState();
  const newCount = Number(newWords);
  const reviewCount = Number(reviewWords);
  if (![newCount, reviewCount].every((value) => Number.isInteger(value) && value >= 0 && value <= 500)) {
    throw new Error('打卡数量必须是 0 到 500 之间的整数');
  }
  const key = normalizeDateKey(date);
  const current = normalizeRecord(state.records[key]);
  if (current.newWords + newCount > 500 || current.reviewWords + reviewCount > 500) {
    throw new Error('当天记录不能超过 500');
  }
  state.records[key] = {
    newWords: current.newWords + newCount,
    reviewWords: current.reviewWords + reviewCount
  };
  if (newCount > 0 || reviewCount > 0) {
    const events = state.studyEvents[key] || [];
    events.push({ newWords: newCount, reviewWords: reviewCount });
    state.studyEvents[key] = events.slice(-1000);
  }
  saveState(state);
  return state;
}

function setStudyRecord({ newWords, reviewWords, date } = {}) {
  const state = ensureState();
  const hasNew = newWords !== null && newWords !== undefined;
  const hasReview = reviewWords !== null && reviewWords !== undefined;
  if (!hasNew && !hasReview) throw new Error('至少需要指定新词或复习词数量');
  const values = [hasNew ? Number(newWords) : null, hasReview ? Number(reviewWords) : null];
  if (values.some((value) => value !== null && (!Number.isInteger(value) || value < 0 || value > 500))) {
    throw new Error('打卡数量必须是 0 到 500 之间的整数');
  }
  const key = normalizeDateKey(date);
  const current = normalizeRecord(state.records[key]);
  const next = { newWords: hasNew ? values[0] : current.newWords, reviewWords: hasReview ? values[1] : current.reviewWords };
  if (next.newWords || next.reviewWords) {
    state.records[key] = next;
    // 重建为单条批量事件，保证撤销按钮和聊天撤销继续可用
    state.studyEvents[key] = [{ newWords: next.newWords, reviewWords: next.reviewWords }];
  } else {
    delete state.records[key];
    delete state.studyEvents[key];
  }
  saveState(state);
  return state;
}

function undoStudyRecord(date) {
  const state = ensureState();
  const key = normalizeDateKey(date);
  const current = normalizeRecord(state.records[key]);
  const events = state.studyEvents[key] || [];
  const batch = normalizeEvent(events.pop());
  if (!batch.newWords && !batch.reviewWords) return { state, undone: null };
  current.newWords = Math.max(0, current.newWords - batch.newWords);
  current.reviewWords = Math.max(0, current.reviewWords - batch.reviewWords);
  if (current.newWords || current.reviewWords) state.records[key] = current;
  else delete state.records[key];
  if (events.length) state.studyEvents[key] = events;
  else delete state.studyEvents[key];
  saveState(state);
  return { state, undone: batch };
}

function undoLastNewWord(date) {
  const state = ensureState();
  const key = normalizeDateKey(date);
  const current = normalizeRecord(state.records[key]);
  const events = state.studyEvents[key] || [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const entry = normalizeEvent(events[index]);
    if (entry.newWords > 0) {
      entry.newWords -= 1;
      if (entry.newWords || entry.reviewWords) events[index] = entry;
      else events.splice(index, 1);
      current.newWords = Math.max(0, current.newWords - 1);
      if (current.newWords || current.reviewWords) state.records[key] = current;
      else delete state.records[key];
      if (events.length) state.studyEvents[key] = events;
      else delete state.studyEvents[key];
      saveState(state);
      return state;
    }
  }
  // 事件历史缺失（例如旧版本补录覆盖过）时仍直接回退数量
  if (current.newWords > 0) {
    current.newWords -= 1;
    if (current.newWords || current.reviewWords) state.records[key] = current;
    else delete state.records[key];
    saveState(state);
  }
  return state;
}

function undoLastReviewWord(date) {
  const state = ensureState();
  const key = normalizeDateKey(date);
  const current = normalizeRecord(state.records[key]);
  const events = state.studyEvents[key] || [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const entry = normalizeEvent(events[index]);
    if (entry.reviewWords > 0) {
      entry.reviewWords -= 1;
      if (entry.newWords || entry.reviewWords) events[index] = entry;
      else events.splice(index, 1);
      current.reviewWords = Math.max(0, current.reviewWords - 1);
      if (current.newWords || current.reviewWords) state.records[key] = current;
      else delete state.records[key];
      if (events.length) state.studyEvents[key] = events;
      else delete state.studyEvents[key];
      saveState(state);
      return state;
    }
  }
  // 事件历史缺失（例如旧版本补录覆盖过）时仍直接回退数量
  if (current.reviewWords > 0) {
    current.reviewWords -= 1;
    if (current.newWords || current.reviewWords) state.records[key] = current;
    else delete state.records[key];
    saveState(state);
  }
  return state;
}

function petBoundsFor(scale, anchor) {
  const width = Math.round(PET_BASE_WIDTH * scale);
  const height = Math.round(PET_BASE_HEIGHT * scale);
  const workArea = screen.getPrimaryDisplay().workArea;
  const base = anchor || { right: workArea.x + workArea.width - PET_RIGHT_MARGIN, bottom: workArea.y + workArea.height - PET_BOTTOM_MARGIN };
  return {
    width,
    height,
    x: Math.round(base.right - width),
    y: Math.round(base.bottom - height)
  };
}

function applyPetScale(value) {
  const scale = clampPetScale(value);
  const state = ensureState();
  if (state.settings.petScale === scale && petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:scale', scale);
    return scale;
  }
  state.settings.petScale = scale;
  saveState(state);
  if (petWindow && !petWindow.isDestroyed()) {
    const [currentX, currentY] = petWindow.getPosition();
    const [currentWidth, currentHeight] = petWindow.getSize();
    const next = petBoundsFor(scale, { right: currentX + currentWidth, bottom: currentY + currentHeight });
    petWindow.setBounds(next);
    petWindow.webContents.send('pet:scale', scale);
  }
  return scale;
}

function createPetWindow() {
  const scale = clampPetScale(ensureState().settings.petScale);
  const bounds = petBoundsFor(scale);
  petWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWindow.webContents.on('did-finish-load', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:scale', clampPetScale(ensureState().settings.petScale));
  });
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return;
  }
  panelWindow = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 720,
    minHeight: 600,
    title: '单词猫咪 · 打卡面板',
    backgroundColor: '#f6f8fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  panelWindow.on('close', (event) => {
    if (!quitRequested) {
      event.preventDefault();
      panelWindow.hide();
    }
  });
  panelWindow.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
}

function chatPosition() {
  const width = 360;
  const height = 460;
  const margin = 14;
  const petBounds = petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null;
  const display = screen.getDisplayNearestPoint(petBounds ? { x: petBounds.x, y: petBounds.y } : screen.getCursorScreenPoint());
  const area = display.workArea;
  const clampY = (value) => Math.max(area.y + 8, Math.min(value, area.y + area.height - height - 8));
  if (petBounds) {
    const left = petBounds.x - width - margin;
    if (left >= area.x + 8) return { x: left, y: clampY(petBounds.y) };
    const right = petBounds.x + petBounds.width + margin;
    if (right + width <= area.x + area.width - 8) return { x: right, y: clampY(petBounds.y) };
    const below = petBounds.y + petBounds.height + margin;
    if (below + height <= area.y + area.height - 8) return { x: Math.max(area.x + 8, Math.min(petBounds.x, area.x + area.width - width - 8)), y: below };
  }
  return { x: area.x + area.width - width - 8, y: area.y + area.height - height - 8 };
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    const position = chatPosition();
    chatWindow.setPosition(position.x, position.y, false);
    chatWindow.show();
    chatWindow.focus();
    return;
  }
  const position = chatPosition();
  chatWindow = new BrowserWindow({
    width: 360,
    height: 460,
    minWidth: 320,
    minHeight: 380,
    maxWidth: 440,
    maxHeight: 620,
    x: position.x,
    y: position.y,
    title: '小猫聊天',
    backgroundColor: '#f3f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  chatWindow.on('close', (event) => {
    if (!quitRequested) {
      event.preventDefault();
      chatWindow.hide();
    }
  });
  chatWindow.on('closed', () => { chatWindow = null; });
  chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
}

function configureAutoLaunch() {
  if (process.platform !== 'win32') return;
  const args = app.isPackaged ? ['--autostart'] : [app.getAppPath(), '--autostart'];
  app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args });
}

function sendToPet(channel, payload) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, payload);
}

const REMINDER_TEMPLATES = [
  { tag: 'both', text: '该背单词啦，还差新词 {new} 个、复习 {review} 个，喵~' },
  { tag: 'both', text: '目标就在眼前，新词差 {new}、复习差 {review}，加油喵！' },
  { tag: 'new', text: '学累了吗？顺手记几个词，新词只差 {new} 个啦。' },
  { tag: 'new', text: '坚持就是胜利，新词还差 {new} 个就达标了喵！' },
  { tag: 'review', text: '喵，今天的复习还差 {review} 个，别忘了~' },
  { tag: 'review', text: '复习 {review} 个就完成今天的目标啦，冲一把？' },
  { tag: 'none', text: '今天一个词都还没记录哦，先从新词开始吧，喵~' },
  { tag: 'none', text: '打卡还没开始哦，背几个词让我看到你的进度喵~' }
];

function buildReminderText(record, settings) {
  const newRemaining = Math.max(0, settings.newWordsGoal - record.newWords);
  const reviewRemaining = Math.max(0, settings.reviewWordsGoal - record.reviewWords);
  if (!newRemaining && !reviewRemaining) return null;
  let candidates;
  if (!record.newWords && !record.reviewWords && settings.newWordsGoal > 0) {
    candidates = REMINDER_TEMPLATES.filter((item) => item.tag === 'none');
  } else if (newRemaining && reviewRemaining) {
    candidates = REMINDER_TEMPLATES.filter((item) => item.tag !== 'none');
  } else if (newRemaining) {
    candidates = REMINDER_TEMPLATES.filter((item) => item.tag === 'new');
  } else {
    candidates = REMINDER_TEMPLATES.filter((item) => item.tag === 'review');
  }
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  return picked.text.replace('{new}', String(newRemaining)).replace('{review}', String(reviewRemaining));
}

let lastReminderAt = Date.now();

function reminderDue(state, now = new Date(), lastAt = lastReminderAt) {
  const settings = state.settings;
  if (!settings.reminderEnabled) return { due: false };
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (settings.reminderStart > settings.reminderEnd) {
    if (hhmm < settings.reminderStart && hhmm > settings.reminderEnd) return { due: false };
  } else if (hhmm < settings.reminderStart || hhmm > settings.reminderEnd) {
    return { due: false };
  }
  if (!settings.newWordsGoal && !settings.reviewWordsGoal) return { due: false };
  const record = normalizeRecord(state.records[now.toLocaleDateString('sv-SE')]);
  const newRemaining = Math.max(0, settings.newWordsGoal - record.newWords);
  const reviewRemaining = Math.max(0, settings.reviewWordsGoal - record.reviewWords);
  if (!newRemaining && !reviewRemaining) return { due: false };
  if (Date.now() - lastAt < settings.reminderInterval * 60000) return { due: false };
  return { due: true, newRemaining, reviewRemaining };
}

function checkReminder() {
  try {
    const state = ensureState();
    if (!reminderDue(state).due) return;
    lastReminderAt = Date.now();
    const text = buildReminderText(normalizeRecord(state.records[todayKey()]), state.settings);
    if (!text) return;
    if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) petWindow.show();
    sendToPet('pet:bubble', { text, mood: 'remind' });
  } catch { /* 提醒失败不影响主流程 */ }
}

function broadcastState(state) {
  for (const window of [panelWindow, chatWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('state:changed', state);
  }
}

function snapshotRecord(date) {
  return normalizeRecord(ensureState().records[normalizeDateKey(date)]);
}

function calculateStreak(state) {
  let streak = 0;
  for (let offset = 0; offset < 3650; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const record = normalizeRecord(state.records[date.toLocaleDateString('sv-SE')]);
    if (record.newWords >= state.settings.newWordsGoal && record.reviewWords >= state.settings.reviewWordsGoal) streak += 1;
    else if (offset > 0) break;
  }
  return streak;
}

function celebrateStudy({ state, key, kind, counts, previous, undone }) {
  const record = normalizeRecord(state.records[key]);
  let message;
  let mood = 'happy';
  if (kind === 'undo') {
    mood = 'remind';
    if (undone && (undone.newWords || undone.reviewWords)) {
      const parts = [];
      if (undone.newWords) parts.push(`新词 -${undone.newWords}`);
      if (undone.reviewWords) parts.push(`复习 -${undone.reviewWords}`);
      message = `已撤销最近一次打卡（${parts.join('、')}），随时重新开始，喵~`;
    } else {
      message = '没有找到可以撤销的打卡记录，喵~';
    }
  } else {
    const parts = [];
    if (kind === 'set') {
      if (counts?.newWords !== null && counts?.newWords !== undefined) parts.push(`新词 ${record.newWords}`);
      if (counts?.reviewWords !== null && counts?.reviewWords !== undefined) parts.push(`复习 ${record.reviewWords}`);
      message = `已更新${key === todayKey() ? '今天' : key}：${parts.join('、')}`;
    } else {
      if (counts?.newWords) parts.push(`新词 +${counts.newWords}`);
      if (counts?.reviewWords) parts.push(`复习 +${counts.reviewWords}`);
      message = `打卡成功：${parts.join('、')}`;
    }
    const crossedGoal = (current, before, goal) => goal > 0 && current >= goal && before < goal;
    if (crossedGoal(record.newWords, previous.newWords, state.settings.newWordsGoal) && crossedGoal(record.reviewWords, previous.reviewWords, state.settings.reviewWordsGoal)) {
      message += `，今日目标全部达成，已连续打卡 ${calculateStreak(state)} 天！🎉`;
    } else if (crossedGoal(record.newWords, previous.newWords, state.settings.newWordsGoal)) {
      message += '，新词目标达成！🎉';
    } else if (crossedGoal(record.reviewWords, previous.reviewWords, state.settings.reviewWordsGoal)) {
      message += '，复习目标达成！🎉';
    }
  }
  sendToPet('pet:bubble', { text: message, mood });
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send('panel:toast', message);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'cat-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('单词猫咪');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开打卡面板', click: createPanelWindow },
    { label: '打开聊天面板', click: createChatWindow },
    { label: '显示桌宠', click: () => petWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => { quitRequested = true; app.quit(); } }
  ]));
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => createPanelWindow());
  app.whenReady().then(() => {
  configureAutoLaunch();
  const loginSettings = process.platform === 'win32' ? app.getLoginItemSettings() : {};
  const launchedAtLogin = process.argv.includes('--autostart') || loginSettings.wasOpenedAtLogin;
  createPetWindow();
  if (!launchedAtLogin) createPanelWindow();
  createTray();
  backupState();
  setInterval(checkReminder, 30000);
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitRequested = true;
  stopPetDrag();
});

ipcMain.handle('state:load', () => ensureState());
ipcMain.handle('settings:save', (_event, settings) => {
  const current = ensureState();
  const next = {
    settings: {
      ...current.settings,
      newWordsGoal: clampInteger(settings?.newWordsGoal, 0, 500, current.settings.newWordsGoal),
      reviewWordsGoal: clampInteger(settings?.reviewWordsGoal, 0, 500, current.settings.reviewWordsGoal),
      aiApiKey: typeof settings?.aiApiKey === 'string' ? settings.aiApiKey.trim() : current.settings.aiApiKey,
      petScale: clampPetScale(settings?.petScale ?? current.settings.petScale),
      aiModel: typeof settings?.aiModel === 'string' && settings.aiModel.trim() ? settings.aiModel.trim() : current.settings.aiModel,
      aiEndpoint: normalizeEndpoint(settings?.aiEndpoint, current.settings.aiEndpoint),
      reminderEnabled: typeof settings?.reminderEnabled === 'boolean' ? settings.reminderEnabled : current.settings.reminderEnabled,
      reminderStart: normalizeTime(settings?.reminderStart, current.settings.reminderStart),
      reminderEnd: normalizeTime(settings?.reminderEnd, current.settings.reminderEnd),
      reminderInterval: clampInteger(settings?.reminderInterval, 5, 720, current.settings.reminderInterval)
    },
    records: current.records,
    studyEvents: current.studyEvents
  };
  saveState(next);
  return next;
});
ipcMain.handle('study:record', (_event, counts) => {
  const previous = snapshotRecord(counts?.date);
  const state = adjustStudyRecord(counts);
  broadcastState(state);
  if (counts?.viaChat) celebrateStudy({ state, key: normalizeDateKey(counts?.date), kind: 'record', counts, previous });
  return state;
});
ipcMain.handle('study:set', (_event, counts) => {
  const previous = snapshotRecord(counts?.date);
  const state = setStudyRecord(counts);
  broadcastState(state);
  if (counts?.viaChat) celebrateStudy({ state, key: normalizeDateKey(counts?.date), kind: 'set', counts, previous });
  return state;
});
ipcMain.handle('study:undo', (_event, payload) => {
  const date = typeof payload === 'string' ? payload : payload?.date;
  const { state, undone } = undoStudyRecord(date);
  broadcastState(state);
  if (payload?.viaChat) celebrateStudy({ state, key: normalizeDateKey(date), kind: 'undo', undone });
  return state;
});
ipcMain.handle('study:undo-new', (_event, date) => {
  const state = undoLastNewWord(date);
  broadcastState(state);
  return state;
});
ipcMain.handle('study:undo-review', (_event, date) => {
  const state = undoLastReviewWord(date);
  broadcastState(state);
  return state;
});
ipcMain.handle('panel:show', createPanelWindow);
ipcMain.handle('chat:show', createChatWindow);
ipcMain.handle('cat:personality', () => {
  try {
    const content = fs.readFileSync(catPersonalityFile, 'utf8').trim();
    return content || defaultCatPersonality;
  } catch {
    return defaultCatPersonality;
  }
});
ipcMain.on('pet:context-menu', () => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const scale = clampPetScale(ensureState().settings.petScale);
  const sizeItem = (label, value) => ({
    label,
    type: 'checkbox',
    checked: Math.abs(scale - value) < 0.001,
    click: () => applyPetScale(value)
  });
  Menu.buildFromTemplate([
    { label: '打开打卡面板', click: createPanelWindow },
    { label: '打开聊天面板', click: createChatWindow },
    {
      label: '大小',
      submenu: [
        sizeItem('小（75%）', 0.75),
        sizeItem('默认（100%）', 1),
        sizeItem('大（125%）', 1.25),
        sizeItem('特大（150%）', 1.5)
      ]
    },
    { type: 'separator' },
    { label: '最小化桌宠', click: () => petWindow.hide() },
    { label: '退出', click: () => { quitRequested = true; app.quit(); } }
  ]).popup({ window: petWindow });
});
function stopPetDrag() {
  dragAnchor = null;
  dragLastCursor = null;
}

function startPetDrag() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  stopPetDrag();
  const [windowX, windowY] = petWindow.getPosition();
  const cursor = screen.getCursorScreenPoint();
  dragAnchor = { windowX, windowY, cursorX: cursor.x, cursorY: cursor.y };
  dragLastCursor = cursor;
}

ipcMain.on('pet:drag-start', startPetDrag);
ipcMain.on('pet:drag-move', () => {
  if (!dragAnchor || !petWindow || petWindow.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  if (point.x === dragLastCursor?.x && point.y === dragLastCursor?.y) return;
  dragLastCursor = point;
  const nextX = dragAnchor.windowX + point.x - dragAnchor.cursorX;
  const nextY = dragAnchor.windowY + point.y - dragAnchor.cursorY;
  const [currentX, currentY] = petWindow.getPosition();
  if (Math.round(nextX) === currentX && Math.round(nextY) === currentY) return;
  petWindow.setPosition(Math.round(nextX), Math.round(nextY), false);
});
ipcMain.on('pet:drag-end', stopPetDrag);
ipcMain.on('pet:set-ignore-mouse', (_event, ignore) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});
ipcMain.on('pet:scale-step', (_event, delta) => {
  const current = clampPetScale(ensureState().settings.petScale);
  applyPetScale(current + Number(delta) * 0.05);
});
const chatRequests = new Map();
ipcMain.handle('chat:send', async (event, { messages, settings } = {}) => {
  const current = ensureState();
  const apiKey = (settings?.aiApiKey || current.settings.aiApiKey || process.env.AI_API_KEY || process.env.STEPFUN_API_KEY || '').trim();
  if (!apiKey) throw new Error('请先在设置中填写 API Key，或设置 AI_API_KEY 环境变量');
  const endpoint = normalizeEndpoint(settings?.aiEndpoint, current.settings.aiEndpoint);
  const model = settings?.aiModel?.trim() || current.settings.aiModel;
  const controller = new AbortController();
  chatRequests.set(event.sender.id, controller);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = body?.error?.message || body?.message || body?.error?.code || JSON.stringify(body);
      throw new Error(`AI 请求失败（${response.status}）：${detail}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      const body = await response.json().catch(() => ({}));
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('AI 返回内容格式异常');
      return content;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith('data:')) continue;
        const payload = data.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            full += delta;
            event.sender.send('chat:delta', delta);
          }
        } catch { /* 跳过不完整的 SSE 行 */ }
      }
    }
    return full;
  } catch (error) {
    if (controller.signal.aborted) return null;
    throw error;
  } finally {
    chatRequests.delete(event.sender.id);
  }
});
ipcMain.on('chat:abort', (event) => {
  chatRequests.get(event.sender.id)?.abort();
});
ipcMain.handle('data:export', async (event) => {
  const state = ensureState();
  const parent = BrowserWindow.fromWebContents?.(event.sender) || panelWindow;
  const result = await dialog.showSaveDialog(parent, {
    title: '导出打卡数据',
    defaultPath: `word-cat-backup-${todayKey()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, JSON.stringify(state, null, 2), 'utf8');
  return { saved: result.filePath };
});

module.exports = { reminderDue, buildReminderText, backupState };
