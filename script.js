"use strict";

const COLS = 10;
const ROWS = 20;
const CELL = 30;

const PIECES = {
  I: { color: "#5de5f2", matrix: [[1, 1, 1, 1]] },
  J: { color: "#6f8cff", matrix: [[1, 0, 0], [1, 1, 1]] },
  L: { color: "#ffac68", matrix: [[0, 0, 1], [1, 1, 1]] },
  O: { color: "#ffd768", matrix: [[1, 1], [1, 1]] },
  S: { color: "#65efa7", matrix: [[0, 1, 1], [1, 1, 0]] },
  T: { color: "#a982ff", matrix: [[0, 1, 0], [1, 1, 1]] },
  Z: { color: "#ff78a5", matrix: [[1, 1, 0], [0, 1, 1]] },
};

const canvas = document.querySelector("#gameCanvas");
const context = canvas.getContext("2d");
const nextCanvas = document.querySelector("#nextCanvas");
const nextContext = nextCanvas.getContext("2d");

const scoreElement = document.querySelector("#score");
const linesElement = document.querySelector("#lines");
const levelElement = document.querySelector("#level");
const highScoreElement = document.querySelector("#highScore");
const overlay = document.querySelector("#overlay");
const overlayKicker = document.querySelector("#overlayKicker");
const overlayTitle = document.querySelector("#overlayTitle");
const overlayText = document.querySelector("#overlayText");
const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const restartButton = document.querySelector("#restartButton");
const soundButton = document.querySelector("#soundButton");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");

let board = createBoard();
let activePiece = null;
let nextType = null;
let bag = [];
let score = 0;
let lines = 0;
let level = 1;
let highScore = readHighScore();
let running = false;
let paused = false;
let gameOver = false;
let soundEnabled = true;
let lastDropTime = 0;
let frameId = null;
let audioContext = null;
let pointerStart = null;

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function cloneMatrix(matrix) {
  return matrix.map((row) => [...row]);
}

function refillBag() {
  bag = Object.keys(PIECES);
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [bag[index], bag[randomIndex]] = [bag[randomIndex], bag[index]];
  }
}

function takeType() {
  if (bag.length === 0) refillBag();
  return bag.pop();
}

function makePiece(type) {
  const definition = PIECES[type];
  const matrix = cloneMatrix(definition.matrix);
  return {
    type,
    color: definition.color,
    matrix,
    x: Math.floor((COLS - matrix[0].length) / 2),
    y: -1,
  };
}

function spawnPiece() {
  const type = nextType || takeType();
  nextType = takeType();
  activePiece = makePiece(type);
  drawNext();

  if (collides(activePiece, 0, 0)) {
    finishGame();
  }
}

function collides(piece, offsetX = 0, offsetY = 0, testMatrix = piece.matrix) {
  for (let row = 0; row < testMatrix.length; row += 1) {
    for (let column = 0; column < testMatrix[row].length; column += 1) {
      if (!testMatrix[row][column]) continue;

      const targetX = piece.x + column + offsetX;
      const targetY = piece.y + row + offsetY;

      if (targetX < 0 || targetX >= COLS || targetY >= ROWS) return true;
      if (targetY >= 0 && board[targetY][targetX]) return true;
    }
  }
  return false;
}

function movePiece(direction) {
  if (!canControl()) return;
  if (!collides(activePiece, direction, 0)) {
    activePiece.x += direction;
    playTone(170, 0.018, 0.018);
    draw();
  }
}

function rotateMatrix(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]).reverse());
}

function rotatePiece() {
  if (!canControl()) return;
  const rotated = rotateMatrix(activePiece.matrix);
  const kicks = [0, -1, 1, -2, 2];

  for (const kick of kicks) {
    if (!collides(activePiece, kick, 0, rotated)) {
      activePiece.matrix = rotated;
      activePiece.x += kick;
      playTone(330, 0.03, 0.025);
      draw();
      return;
    }
  }
}

function stepDown(manual = false) {
  if (!canControl()) return;

  if (!collides(activePiece, 0, 1)) {
    activePiece.y += 1;
    if (manual) score += 1;
  } else {
    lockPiece();
  }

  lastDropTime = performance.now();
  updateStats();
  draw();
}

function hardDrop() {
  if (!canControl()) return;
  let distance = 0;
  while (!collides(activePiece, 0, distance + 1)) distance += 1;
  activePiece.y += distance;
  score += distance * 2;
  playTone(110, 0.06, 0.055);
  lockPiece();
  lastDropTime = performance.now();
  updateStats();
  draw();
}

function lockPiece() {
  let lockedAboveBoard = false;

  activePiece.matrix.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (!value) return;
      const boardY = activePiece.y + rowIndex;
      const boardX = activePiece.x + columnIndex;
      if (boardY < 0) {
        lockedAboveBoard = true;
      } else {
        board[boardY][boardX] = activePiece.color;
      }
    });
  });

  if (lockedAboveBoard) {
    finishGame();
    return;
  }

  const cleared = clearFullLines();
  if (cleared > 0) {
    const points = [0, 100, 300, 500, 800];
    score += points[cleared] * level;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    playClearSound(cleared);
  }

  updateHighScore();
  updateStats();
  spawnPiece();
}

function clearFullLines() {
  let cleared = 0;
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row].every(Boolean)) {
      board.splice(row, 1);
      board.unshift(Array(COLS).fill(null));
      cleared += 1;
      row += 1;
    }
  }
  return cleared;
}

function getDropInterval() {
  return Math.max(90, 820 - (level - 1) * 65);
}

function getGhostY() {
  let ghostY = activePiece.y;
  while (!collides({ ...activePiece, y: ghostY }, 0, 1)) ghostY += 1;
  return ghostY;
}

function drawBlock(targetContext, x, y, size, color, alpha = 1) {
  const gap = Math.max(2, size * 0.07);
  targetContext.save();
  targetContext.globalAlpha = alpha;
  targetContext.fillStyle = color;
  targetContext.shadowColor = color;
  targetContext.shadowBlur = alpha < 0.5 ? 0 : size * 0.25;
  targetContext.fillRect(x + gap, y + gap, size - gap * 2, size - gap * 2);
  targetContext.shadowBlur = 0;
  targetContext.fillStyle = "rgba(255, 255, 255, 0.24)";
  targetContext.fillRect(x + gap * 1.6, y + gap * 1.6, size - gap * 3.2, Math.max(2, size * 0.08));
  targetContext.fillStyle = "rgba(0, 0, 0, 0.18)";
  targetContext.fillRect(x + gap * 1.7, y + size - gap * 2.6, size - gap * 3.4, Math.max(2, size * 0.07));
  targetContext.restore();
}

function drawGrid() {
  context.fillStyle = "#090c18";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.035)";
  context.lineWidth = 1;

  for (let column = 0; column <= COLS; column += 1) {
    context.beginPath();
    context.moveTo(column * CELL + 0.5, 0);
    context.lineTo(column * CELL + 0.5, ROWS * CELL);
    context.stroke();
  }
  for (let row = 0; row <= ROWS; row += 1) {
    context.beginPath();
    context.moveTo(0, row * CELL + 0.5);
    context.lineTo(COLS * CELL, row * CELL + 0.5);
    context.stroke();
  }
}

function drawMatrix(matrix, offsetX, offsetY, color, alpha = 1) {
  matrix.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      const y = offsetY + rowIndex;
      if (value && y >= 0) {
        drawBlock(context, (offsetX + columnIndex) * CELL, y * CELL, CELL, color, alpha);
      }
    });
  });
}

function draw() {
  drawGrid();
  board.forEach((row, rowIndex) => {
    row.forEach((color, columnIndex) => {
      if (color) drawBlock(context, columnIndex * CELL, rowIndex * CELL, CELL, color);
    });
  });

  if (activePiece && !gameOver) {
    drawMatrix(activePiece.matrix, activePiece.x, getGhostY(), activePiece.color, 0.18);
    drawMatrix(activePiece.matrix, activePiece.x, activePiece.y, activePiece.color);
  }
}

function drawNext() {
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  nextContext.fillStyle = "rgba(8, 11, 23, 0.48)";
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!nextType) return;

  const { matrix, color } = PIECES[nextType];
  const size = 24;
  const width = matrix[0].length * size;
  const height = matrix.length * size;
  const offsetX = (nextCanvas.width - width) / 2;
  const offsetY = (nextCanvas.height - height) / 2;

  matrix.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value) drawBlock(nextContext, offsetX + columnIndex * size, offsetY + rowIndex * size, size, color);
    });
  });
}

function updateStats() {
  scoreElement.textContent = String(score).padStart(6, "0");
  linesElement.textContent = String(lines);
  levelElement.textContent = String(level);
  highScoreElement.textContent = String(highScore).padStart(6, "0");
}

function setStatus(text, active = false) {
  statusText.textContent = text;
  statusDot.classList.toggle("active", active);
}

function showOverlay(kicker, title, text, buttonText) {
  overlayKicker.textContent = kicker;
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startButton.textContent = buttonText;
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function newGame() {
  board = createBoard();
  bag = [];
  activePiece = null;
  nextType = takeType();
  score = 0;
  lines = 0;
  level = 1;
  running = true;
  paused = false;
  gameOver = false;
  lastDropTime = performance.now();
  spawnPiece();
  updateStats();
  hideOverlay();
  setStatus("游戏进行中", true);
  pauseButton.textContent = "暂停";
  playTone(440, 0.07, 0.04);

  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = requestAnimationFrame(gameLoop);
}

function togglePause(forcePause = false) {
  if (!running || gameOver) return;
  paused = forcePause ? true : !paused;

  if (paused) {
    showOverlay("休息一下", "游戏暂停", "调整好节奏，随时继续挑战", "继续游戏");
    setStatus("已暂停", false);
    pauseButton.textContent = "继续";
  } else {
    hideOverlay();
    setStatus("游戏进行中", true);
    pauseButton.textContent = "暂停";
    lastDropTime = performance.now();
    playTone(440, 0.05, 0.03);
  }
}

function finishGame() {
  running = false;
  gameOver = true;
  updateHighScore();
  updateStats();
  showOverlay("本局结束", "挑战结束", `最终得分 ${score} · 消除 ${lines} 行`, "再来一局");
  setStatus("等待重新开始", false);
  pauseButton.textContent = "暂停";
  playGameOverSound();
}

function canControl() {
  return running && !paused && !gameOver && activePiece;
}

function gameLoop(time) {
  if (running && !paused && time - lastDropTime >= getDropInterval()) {
    stepDown(false);
  }
  draw();
  frameId = requestAnimationFrame(gameLoop);
}

function readHighScore() {
  try {
    return Number.parseInt(localStorage.getItem("neon-tetris-high-score") || "0", 10);
  } catch {
    return 0;
  }
}

function updateHighScore() {
  if (score <= highScore) return;
  highScore = score;
  try {
    localStorage.setItem("neon-tetris-high-score", String(highScore));
  } catch {
    // The game still works when browser storage is unavailable.
  }
}

function ensureAudioContext() {
  if (!soundEnabled) return null;
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function playTone(frequency, duration = 0.05, volume = 0.035, delay = 0) {
  const audio = ensureAudioContext();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function playClearSound(count) {
  [0, 1, 2].forEach((step) => playTone(360 + step * 120 + count * 30, 0.07, 0.04, step * 0.06));
}

function playGameOverSound() {
  [0, 1, 2].forEach((step) => playTone(250 - step * 55, 0.12, 0.035, step * 0.1));
}

function performAction(action) {
  const actions = {
    left: () => movePiece(-1),
    right: () => movePiece(1),
    rotate: rotatePiece,
    down: () => stepDown(true),
    drop: hardDrop,
  };
  actions[action]?.();
}

document.addEventListener("keydown", (event) => {
  const keysToBlock = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "];
  if (keysToBlock.includes(event.key)) event.preventDefault();

  if (event.key.toLowerCase() === "r") {
    newGame();
    return;
  }
  if (event.key.toLowerCase() === "p" || event.key === "Escape") {
    togglePause();
    return;
  }
  if (!canControl()) return;

  const keyActions = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "rotate",
    ArrowDown: "down",
    " ": "drop",
  };
  performAction(keyActions[event.key]);
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    performAction(button.dataset.action);
  });
});

canvas.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart || !canControl()) return;
  const deltaX = event.clientX - pointerStart.x;
  const deltaY = event.clientY - pointerStart.y;
  pointerStart = null;

  if (Math.abs(deltaX) < 18 && Math.abs(deltaY) < 18) {
    rotatePiece();
  } else if (Math.abs(deltaX) > Math.abs(deltaY)) {
    const steps = Math.min(3, Math.max(1, Math.round(Math.abs(deltaX) / 38)));
    for (let step = 0; step < steps; step += 1) movePiece(deltaX > 0 ? 1 : -1);
  } else if (deltaY > 80) {
    hardDrop();
  } else if (deltaY > 20) {
    stepDown(true);
  }
});

startButton.addEventListener("click", () => {
  if (paused && running) togglePause();
  else newGame();
});

pauseButton.addEventListener("click", () => togglePause());
restartButton.addEventListener("click", newGame);
soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundButton.setAttribute("aria-label", soundEnabled ? "关闭音效" : "打开音效");
  if (soundEnabled) playTone(520, 0.06, 0.04);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && running && !paused) togglePause(true);
});

updateStats();
drawNext();
draw();
