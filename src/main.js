import { Game } from './core/Game.js';

const bootScreen = document.getElementById('boot-screen');
const statusEl = document.getElementById('boot-status');
const progressEl = document.getElementById('boot-progress');
const startButton = document.getElementById('boot-start');

function fail(message) {
  if (statusEl) statusEl.textContent = message;
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = 'Unavailable';
  }
}

async function boot() {
  const game = new Game({ container: document.getElementById('viewport') });

  try {
    await game.init((progress, label) => {
      if (progressEl) progressEl.style.width = `${Math.round(progress * 100)}%`;
      if (statusEl && label) statusEl.textContent = label;
    });
  } catch (error) {
    console.error('[Verde Block 4] Failed to initialise', error);
    fail('WebGL initialisation failed — see the console for details.');
    return;
  }

  startButton.disabled = false;
  startButton.textContent = 'Explore your farm';

  startButton.addEventListener(
    'click',
    () => {
      bootScreen.classList.add('is-hidden');
      game.start();
    },
    { once: true },
  );

  // Expose for debugging in the browser console.
  window.verdeGame = game;
}

if (typeof WebGLRenderingContext === 'undefined') {
  fail('WebGL is not available in this browser.');
} else {
  boot();
}
