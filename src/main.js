const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
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
    stepfunApiKey: '',
    stepfunModel: 'step-3.7-flash',
    stepfunEndpoint: 'https://api.stepfun.com/v1/chat/completions'
  },
  records: {}
};

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
    settings.stepfunApiKey = typeof settings.stepfunApiKey === 'string' ? settings.stepfunApiKey.trim() : '';
    settings.stepfunModel = typeof settings.stepfunModel === 'string' && settings.stepfunModel.trim() ? settings.stepfunModel.trim() : defaultState.settings.stepfunModel;
    if (settings.stepfunModel === 'step-1-8k' || settings.stepfunModel === 'step-3.5-flash') settings.stepfunModel = defaultState.settings.stepfunModel;
    settings.stepfunEndpoint = normalizeEndpoint(settings.stepfunEndpoint, defaultState.settings.stepfunEndpoint);
    const normalized = {
      settings,
      records: normalizeRecords(loaded.records)
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

function normalizeEndpoint(value, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return fallback;
    const pathName = url.pathname.replace(/\/+$/, '');
    if (url.hostname === 'api.stepfun.com' && (!pathName || pathName === '/step_plan')) {
      return 'https://api.stepfun.com/v1/chat/completions';
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

function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  petWindow = new BrowserWindow({
    width: 270,
    height: 290,
    x: workArea.x + workArea.width - 330,
    y: workArea.y + workArea.height - 380,
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
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitRequested = true;
  stopPetDrag();
});

ipcMain.handle('state:load', () => ensureState());
ipcMain.handle('state:save', (_event, state) => {
  const current = ensureState();
  const safeState = {
    settings: {
      ...current.settings,
      newWordsGoal: clampInteger(state?.settings?.newWordsGoal, 0, 500, current.settings.newWordsGoal),
      reviewWordsGoal: clampInteger(state?.settings?.reviewWordsGoal, 0, 500, current.settings.reviewWordsGoal),
      stepfunApiKey: typeof state?.settings?.stepfunApiKey === 'string' ? state.settings.stepfunApiKey.trim() : current.settings.stepfunApiKey,
      stepfunModel: typeof state?.settings?.stepfunModel === 'string' && state.settings.stepfunModel.trim() ? state.settings.stepfunModel.trim() : current.settings.stepfunModel,
      stepfunEndpoint: normalizeEndpoint(state?.settings?.stepfunEndpoint, current.settings.stepfunEndpoint)
    },
    records: normalizeRecords(state?.records && typeof state.records === 'object' ? state.records : current.records)
  };
  saveState(safeState);
  return true;
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
  Menu.buildFromTemplate([
    { label: '打开打卡面板', click: createPanelWindow },
    { label: '打开聊天面板', click: createChatWindow },
    { type: 'separator' },
    { label: '最小化桌宠', click: () => petWindow.hide() },
    { label: '退出', click: () => { quitRequested = true; app.quit(); } }
  ]).popup({ window: petWindow });
});
ipcMain.handle('pet:get-position', () => {
  if (!petWindow || petWindow.isDestroyed()) return { x: 0, y: 0 };
  const [x, y] = petWindow.getPosition();
  return { x, y };
});
ipcMain.on('pet:move', (_event, { x, y } = {}) => {
  if (!petWindow || petWindow.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  petWindow.setPosition(Math.round(x), Math.round(y), false);
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
ipcMain.handle('chat:send', async (_event, { messages, settings } = {}) => {
  const current = ensureState();
  const apiKey = (settings?.stepfunApiKey || current.settings.stepfunApiKey || process.env.STEPFUN_API_KEY || '').trim();
  if (!apiKey) throw new Error('请先在设置中填写 StepFun API Key，或设置 STEPFUN_API_KEY 环境变量');
  const endpoint = normalizeEndpoint(settings?.stepfunEndpoint, current.settings.stepfunEndpoint);
  const model = settings?.stepfunModel?.trim() || current.settings.stepfunModel;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: false })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || body?.error?.code || JSON.stringify(body);
    throw new Error(`StepFun 请求失败（${response.status}）：${detail}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('StepFun 返回内容格式异常');
  return content;
});
