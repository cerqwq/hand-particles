import { HandDetector } from './hand.js';
import { ParticleSystem } from './particles.js';

const canvas = document.getElementById('canvas');
const video = document.getElementById('video');
const statusEl = document.getElementById('status');

let particles;
let handDetector;
let lastTime = performance.now();
let frameId = null;

// ── 手势状态文本 ──────────────────────────────────────────────────
const GESTURE_STATUS = {
  none: '静待出招',
  fist: '握拳 — 收缩',
  open: '张手 — 展开',
  peace: 'Li su',
  twohands: '',
};

// ── 设置面板 ──────────────────────────────────────────────────────
function initSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  const toggle = document.getElementById('settingsToggle');

  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      panel.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== toggle) {
        panel.classList.remove('open');
      }
    });
    // Escape键关闭面板
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) {
        panel.classList.remove('open');
      }
    });
  }

  // 特效开关
  const toggleTrails = document.getElementById('toggleTrails');
  const toggleGlow = document.getElementById('toggleGlow');
  const toggleLinks = document.getElementById('toggleLinks');

  if (toggleTrails) {
    toggleTrails.addEventListener('change', () => {
      particles.effects.trails = toggleTrails.checked;
    });
  }
  if (toggleGlow) {
    toggleGlow.addEventListener('change', () => {
      particles.effects.glow = toggleGlow.checked;
    });
  }
  if (toggleLinks) {
    toggleLinks.addEventListener('change', () => {
      particles.effects.links = toggleLinks.checked;
    });
  }

  // 粒子数量滑块
  const particleCount = document.getElementById('particleCount');
  const particleCountLabel = document.getElementById('particleCountLabel');
  if (particleCount) {
    particleCount.addEventListener('input', () => {
      const count = parseInt(particleCount.value);
      if (particleCountLabel) particleCountLabel.textContent = count;
      // 重新初始化粒子系统
      if (particles) {
        particles.setParticleCount(count);
      }
    });
  }

  // 颜色选择器
  const colorSwatches = document.querySelectorAll('.swatch');
  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      // 移除其他active状态
      colorSwatches.forEach(s => s.classList.remove('active'));
      // 设置当前active
      swatch.classList.add('active');
      // 应用颜色
      const color = swatch.dataset.color;
      if (particles) {
        particles.setColorMode(color);
      }
    });
  });

  return document.getElementById('fpsDisplay');
}

let fpsDisplayEl = null;
let fpsUpdateTimer = 0;

// ── 渲染循环 ──────────────────────────────────────────────────────
function tick(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  particles.update(dt);
  particles.draw();

  fpsUpdateTimer += dt;
  if (fpsUpdateTimer > 0.5 && fpsDisplayEl) {
    fpsDisplayEl.textContent = particles.getFPS() + ' FPS';
    fpsUpdateTimer = 0;
  }

  frameId = requestAnimationFrame(tick);
}

// ── 日期时间更新（双手模式）────────────────────────────────────────
let dateTimeInterval = null;

function startDateTimeUpdate() {
  if (dateTimeInterval) return;
  dateTimeInterval = setInterval(() => {
    if (particles && handDetector && handDetector.state.gesture === 'twohands') {
      const now = new Date();
      const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      particles.showText(`${dateStr}\n${timeStr}`, 2);
    }
  }, 1000);
}

function stopDateTimeUpdate() {
  if (dateTimeInterval) {
    clearInterval(dateTimeInterval);
    dateTimeInterval = null;
  }
}

// ── 主程序 ────────────────────────────────────────────────────────
async function main() {
  particles = new ParticleSystem(canvas);
  fpsDisplayEl = initSettingsPanel();

  window.addEventListener('resize', () => particles.resize());

  const statusTextEl = statusEl.querySelector('.status-text');
  statusTextEl.textContent = '正在启动摄像头和手势模型...';

  let prevGesture = 'none';

  handDetector = new HandDetector(video, (result) => {
    const gesture = result.gesture;

    // 手势变化时触发文字显示
    if (gesture !== prevGesture) {
      if (gesture === 'peace') {
        particles.showText('Li su', 5);
      } else if (gesture === 'twohands') {
        startDateTimeUpdate();
      } else {
        stopDateTimeUpdate();
      }
      prevGesture = gesture;
    }

    particles.setGesture(gesture);

    // 更新状态文本
    if (gesture === 'twohands') {
      const now = new Date();
      statusTextEl.textContent = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    } else {
      statusTextEl.textContent = GESTURE_STATUS[gesture] || '';
    }

    // 镜像 X 坐标
    const px = (1 - result.palmX) * particles.w;
    const py = result.palmY * particles.h;
    particles.setTarget(px, py);
  });

  lastTime = performance.now();
  frameId = requestAnimationFrame(tick);
}

// ── 清理 ──────────────────────────────────────────────────────────
function cleanup() {
  stopDateTimeUpdate();
  if (frameId !== null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
  if (handDetector) {
    handDetector.destroy();
    handDetector = null;
  }
  if (particles) {
    particles.destroy();
    particles = null;
  }
}

main().catch(err => {
  console.error('Initialization failed:', err);
  const statusTextEl = statusEl.querySelector('.status-text');
  statusTextEl.textContent = '初始化失败: ' + err.message;
  statusEl.style.color = 'rgba(180, 40, 40, 0.8)';

  const retryBtn = document.createElement('button');
  retryBtn.textContent = '重试';
  retryBtn.className = 'retry-btn';
  retryBtn.onclick = () => {
    retryBtn.remove();
    statusEl.style.color = '';
    main();
  };
  statusEl.appendChild(retryBtn);
});

window.addEventListener('beforeunload', cleanup);
