const stage = document.getElementById('stage');
const cat = document.getElementById('cat');
const catImage = document.getElementById('cat-image');
const bubble = document.getElementById('bubble');
let state = null;
let bubbleTimer = 0;
let dragState = null;
let suppressClick = false;
const hitCanvas = document.createElement('canvas');
const hitContext = hitCanvas.getContext('2d', { willReadFrequently: true });

function prepareHitTest() {
  if (!catImage.naturalWidth) return;
  hitCanvas.width = catImage.naturalWidth;
  hitCanvas.height = catImage.naturalHeight;
  hitContext.clearRect(0, 0, hitCanvas.width, hitCanvas.height);
  hitContext.drawImage(catImage, 0, 0);
}

function hitTest(event) {
  const rect = catImage.getBoundingClientRect();
  if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return false;
  const x = Math.min(hitCanvas.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) * hitCanvas.width / rect.width)));
  const y = Math.min(hitCanvas.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) * hitCanvas.height / rect.height)));
  return hitContext.getImageData(x, y, 1, 1).data[3] > 30;
}

function updateMousePassThrough(event) {
  if (dragState) return;
  window.catApi.setIgnoreMouse(!hitTest(event));
}

function showBubble(text, mood = 'remind') {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  cat.className = mood;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.classList.add('hidden');
    cat.className = 'idle';
  }, 4200);
}

function todayKey() {
  return new Date().toLocaleDateString('sv-SE');
}

function todayCount() {
  return state?.records?.[todayKey()]?.length ?? 0;
}

function progressMessage() {
  const count = todayCount();
  const goal = state.settings.dailyGoal;
  const remaining = Math.max(0, goal - count);
  if (count >= goal) return { text: `今天已达标！完成 ${count} 个`, mood: 'happy' };
  if (!count) return { text: '今天还没打卡，先学一个吧！', mood: 'remind' };
  if (remaining <= 3) return { text: `快达标啦，还差 ${remaining} 个！`, mood: 'happy' };
  return { text: `已打卡 ${count} 个，还差 ${remaining} 个`, mood: 'remind' };
}

function reminderMessage() {
  const remaining = Math.max(0, state.settings.dailyGoal - todayCount());
  if (!remaining) return '今天已达标，真棒！';
  return `该背单词啦！还差 ${remaining} 个`;
}

cat.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !hitTest(event)) return;
  event.preventDefault();
  cat.setPointerCapture(event.pointerId);
  dragState = { pointerId: event.pointerId, moved: false };
  window.catApi.startPetDrag();
});

document.addEventListener('mousemove', updateMousePassThrough);
document.addEventListener('mouseleave', () => window.catApi.setIgnoreMouse(true));

cat.addEventListener('pointermove', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState.moved = true;
  suppressClick = true;
  window.catApi.updatePetDrag();
});

cat.addEventListener('pointerup', async (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const moved = dragState.moved;
  dragState = null;
  if (cat.hasPointerCapture(event.pointerId)) cat.releasePointerCapture(event.pointerId);
  window.catApi.stopPetDrag();
  if (moved) {
    setTimeout(() => { suppressClick = false; }, 0);
  }
  window.catApi.setIgnoreMouse(false);
});

cat.addEventListener('pointercancel', () => {
  if (!dragState) return;
  dragState = null;
  window.catApi.stopPetDrag();
  window.catApi.setIgnoreMouse(false);
});

window.addEventListener('blur', () => {
  if (!dragState) return;
  dragState = null;
  window.catApi.stopPetDrag();
  window.catApi.setIgnoreMouse(false);
});

cat.addEventListener('click', async (event) => {
  if (suppressClick || !hitTest(event)) return;
  state = await window.catApi.loadState();
  const feedback = progressMessage();
  showBubble(feedback.text, feedback.mood);
});

document.addEventListener('contextmenu', (event) => {
  if (!hitTest(event)) return;
  event.preventDefault();
  window.catApi.showPetMenu();
});

window.catApi.onReminder(async () => {
  state = await window.catApi.loadState();
  showBubble(reminderMessage(), 'remind');
  if (state.settings.sound) {
    try {
      const audioContext = new AudioContext();
      await audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.25);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.25);
      oscillator.addEventListener('ended', () => audioContext.close());
    } catch {
      // Audio is optional; the visual reminder remains available.
    }
  }
});

(async () => {
  if (catImage.complete) prepareHitTest();
  else catImage.addEventListener('load', prepareHitTest, { once: true });
  state = await window.catApi.loadState();
  showBubble('喵，今天也要加油！', 'happy');
})();
