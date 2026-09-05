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

function todayRecord() {
  const value = state?.records?.[todayKey()];
  if (Array.isArray(value)) return { newWords: value.length, reviewWords: 0 };
  return value && typeof value === 'object' ? value : { newWords: 0, reviewWords: 0 };
}

function progressMessage() {
  const record = todayRecord();
  const newRemaining = Math.max(0, state.settings.newWordsGoal - record.newWords);
  const reviewRemaining = Math.max(0, state.settings.reviewWordsGoal - record.reviewWords);
  if (!newRemaining && !reviewRemaining) return { text: `今天新词 ${record.newWords} 个、复习 ${record.reviewWords} 个，目标都完成啦！`, mood: 'happy' };
  if (!record.newWords && !record.reviewWords) return { text: '今天还没有学习记录，先记一个新词吧！', mood: 'remind' };
  return { text: `今天新词 ${record.newWords} 个、复习 ${record.reviewWords} 个；还差新词 ${newRemaining}、复习 ${reviewRemaining}`, mood: newRemaining + reviewRemaining <= 3 ? 'happy' : 'remind' };
}

cat.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !hitTest(event)) return;
  event.preventDefault();
  cat.setPointerCapture(event.pointerId);
  dragState = { pointerId: event.pointerId, moved: false };
  cat.classList.add('dragging');
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
  cat.classList.remove('dragging');
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
  cat.classList.remove('dragging');
  window.catApi.stopPetDrag();
  window.catApi.setIgnoreMouse(false);
});

window.addEventListener('blur', () => {
  if (!dragState) return;
  dragState = null;
  cat.classList.remove('dragging');
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

(async () => {
  if (catImage.complete) prepareHitTest();
  else catImage.addEventListener('load', prepareHitTest, { once: true });
  state = await window.catApi.loadState();
  showBubble('喵，今天也要加油！', 'happy');
})();
