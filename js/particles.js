/**
 * 分子球粒子系统
 * - 待机：分子球自动旋转
 * - 握拳：球缩小
 * - 张手：球放大，内部有小球
 * - 比耶：显示 "Li su"
 * - 双手：显示日期时间
 */

const PARTICLE_COUNT = 800;
const SPHERE_RADIUS = 140;
const INNER_SPHERE_RADIUS = 55;
const FPS_SAMPLE_INTERVAL = 2000;
const PI2 = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.39996

// 物理参数
const ROTATION_SPEED = 0.4;       // 自动旋转速度
const PARTICLE_FRICTION = 0.92;
const MORPH_SPEED = 0.04;         // 形态变化速度

// 连线参数
const LINK_DISTANCE = 50;          // 粒子间连线最大距离
const LINK_OPACITY = 0.15;

// ── 水墨背景（带离屏缓存）────────────────────────────────────────────────────────
class InkWashBackground {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this._noiseCanvas = null;
    this._mountains = [];
    this._cachedBg = null; // 离屏缓存
    this._generateMountains();
  }

  _generateMountains() {
    this._mountains = [];
    for (let layer = 0; layer < 4; layer++) {
      const points = [];
      const segments = 20;
      const baseY = this.h * (0.55 + layer * 0.1);
      for (let i = 0; i <= segments; i++) {
        const x = (i / segments) * this.w;
        const y = baseY + Math.sin(i * 0.8 + layer * 2) * 40 * (1 - layer * 0.2)
                  + Math.sin(i * 1.5 + layer) * 20;
        points.push({ x, y });
      }
      this._mountains.push({ points, opacity: 0.06 - layer * 0.012 });
    }
  }

  _ensureNoise() {
    if (this._noiseCanvas) return;
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d');
    // 使用ImageData批量写入（比fillRect快）
    const imageData = ctx.createImageData(this.w, this.h);
    const data = imageData.data;
    for (let i = 0; i < 300; i++) {
      const x = Math.floor(Math.random() * this.w);
      const y = Math.floor(Math.random() * this.h);
      const idx = (y * this.w + x) * 4;
      const alpha = Math.floor(Math.random() * 10);
      data[idx] = 80;     // R
      data[idx+1] = 70;   // G
      data[idx+2] = 60;   // B
      data[idx+3] = alpha; // A
    }
    ctx.putImageData(imageData, 0, 0);
    this._noiseCanvas = c;
  }

  _renderToCache() {
    // 渲染完整背景到离屏canvas
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d');

    // 宣纸底色
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, this.w, this.h);

    // 噪点纹理
    this._ensureNoise();
    ctx.drawImage(this._noiseCanvas, 0, 0);

    // 远山
    for (const mt of this._mountains) {
      ctx.beginPath();
      ctx.moveTo(0, this.h);
      for (const p of mt.points) ctx.lineTo(p.x, p.y);
      ctx.lineTo(this.w, this.h);
      ctx.closePath();
      ctx.fillStyle = `rgba(30,40,60,${mt.opacity})`;
      ctx.fill();
    }

    this._cachedBg = c;
  }

  draw(ctx) {
    // 如果缓存不存在，渲染一次
    if (!this._cachedBg) {
      this._renderToCache();
    }
    // 从缓存绘制（比每帧重绘快很多）
    ctx.drawImage(this._cachedBg, 0, 0);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this._noiseCanvas = null;
    this._cachedBg = null; // 清除缓存，下次绘制时重新渲染
    this._generateMountains();
  }
}

// ── 分子球粒子系统 ───────────────────────────────────────────────────
export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.time = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.gesture = 'none';
    this._frameCount = 0;
    this._lastFPSSample = performance.now();
    this._currentFPS = 60;
    this._hueOffset = 0;

    // 分子球参数
    this._sphereRadius = SPHERE_RADIUS;
    this._targetSphereRadius = SPHERE_RADIUS;
    this._innerSphereRadius = INNER_SPHERE_RADIUS;
    this._rotationAngle = 0;
    this._tiltAngle = 0.3; // 球体倾斜

    // 文字显示
    this._displayText = '';
    this._displayTimer = 0;
    this._textOpacity = 0;

    // 效果
    this.effects = { trails: true, glow: true, links: true };

    // 颜色模式
    this._colorMode = 'multi'; // multi, yellow, blue, cyan, green, red
    this._colorPresets = {
      multi: null, // 使用默认彩虹色
      yellow: { hue: 45, sat: 100, light: 60 },
      blue: { hue: 210, sat: 80, light: 55 },
      cyan: { hue: 180, sat: 100, light: 50 },
      green: { hue: 120, sat: 100, light: 50 },
      red: { hue: 0, sat: 100, light: 50 },
    };

    this._setupDPI();
    this._inkBg = new InkWashBackground(this.w, this.h);
    this._initParticles();
  }

  // ── 公共 API ──────────────────────────────────────────────────────
  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  setGesture(g) {
    this.gesture = g;
    switch (g) {
      case 'fist':
        this._targetSphereRadius = 45;
        break;
      case 'open':
        this._targetSphereRadius = 220;
        break;
      default:
        this._targetSphereRadius = SPHERE_RADIUS;
    }
  }

  showText(text, duration = 3) {
    this._displayText = text;
    this._displayTimer = duration;
    this._textOpacity = 1;
  }

  setColorMode(mode) {
    this._colorMode = mode;
  }

  setParticleCount(count) {
    // 重新初始化粒子系统
    this._initParticles(count);
  }

  getParticleCount() { return this.particles.length; }
  getFPS() { return Math.round(this._currentFPS); }

  // ── 初始化 ────────────────────────────────────────────────────────
  _setupDPI() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.targetX = w / 2;
    this.targetY = h / 2;
  }

  _initParticles(count = PARTICLE_COUNT) {
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push(this._createParticle(i, count));
    }
  }

  _createParticle(i, count = PARTICLE_COUNT) {
    // 斐波那契球面分布
    const y = 1 - (i / (count - 1)) * 2; // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;

    return {
      // 球面坐标
      theta: theta,
      phi: Math.acos(y),
      baseRadius: SPHERE_RADIUS,
      // 随机偏移
      offsetTheta: (Math.random() - 0.5) * 0.3,
      offsetPhi: (Math.random() - 0.5) * 0.2,
      wobblePhase: Math.random() * PI2,
      wobbleSpeed: 0.5 + Math.random() * 1.5,
      wobbleAmount: 3 + Math.random() * 8,
      // 视觉
      size: 1.2 + Math.random() * 2,
      baseAlpha: 0.7 + Math.random() * 0.3,
      hue: (i / count) * 360,
      depth: 0, // 渲染时计算
      // 是否属于内球
      isInner: i >= count * 0.85, // 15% 的粒子属于内球
    };
  }

  // ── 更新 ──────────────────────────────────────────────────────────
  update(dt) {
    this.time += dt;
    this._hueOffset = (this._hueOffset + dt * 8) % 360;

    // 平滑过渡球半径
    this._sphereRadius += (this._targetSphereRadius - this._sphereRadius) * MORPH_SPEED;

    // 自动旋转
    const rotSpeed = this.gesture === 'fist' ? ROTATION_SPEED * 2.5 : ROTATION_SPEED;
    this._rotationAngle += dt * rotSpeed;

    // 轻微倾斜摆动
    this._tiltAngle = 0.25 + Math.sin(this.time * 0.3) * 0.1;

    // 文字计时器
    if (this._displayTimer > 0) {
      this._displayTimer -= dt;
      if (this._displayTimer < 0.5) {
        this._textOpacity = this._displayTimer / 0.5;
      }
      if (this._displayTimer <= 0) {
        this._displayText = '';
        this._textOpacity = 0;
      }
    }

    // FPS 统计
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFPSSample > FPS_SAMPLE_INTERVAL) {
      this._currentFPS = this._frameCount / ((now - this._lastFPSSample) / 1000);
      this._frameCount = 0;
      this._lastFPSSample = now;
    }
  }

  // ── 绘制 ──────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const time = this.time;
    const cx = this.targetX;
    const cy = this.targetY;

    // 背景
    this._inkBg.draw(ctx);

    // 拖尾
    if (this.effects.trails) {
      ctx.fillStyle = 'rgba(10,10,18,0.15)';
      ctx.fillRect(0, 0, w, h);
    }

    // 计算 3D 投影
    const projected = [];
    const cosR = Math.cos(this._rotationAngle);
    const sinR = Math.sin(this._rotationAngle);
    const cosT = Math.cos(this._tiltAngle);
    const sinT = Math.sin(this._tiltAngle);

    for (const p of this.particles) {
      const isInner = p.isInner && this.gesture === 'open';
      const baseR = isInner ? this._innerSphereRadius : this._sphereRadius;

      // 球面坐标 → 笛卡尔
      const theta = p.theta + p.offsetTheta + (isInner ? time * 0.8 : 0);
      const phi = p.phi + p.offsetPhi;
      const wobble = Math.sin(time * p.wobbleSpeed + p.wobblePhase) * p.wobbleAmount;
      const r = baseR + wobble;

      let x = r * Math.sin(phi) * Math.cos(theta);
      let y = r * Math.cos(phi);
      let z = r * Math.sin(phi) * Math.sin(theta);

      // 旋转（绕 Y 轴）
      const x2 = x * cosR - z * sinR;
      const z2 = x * sinR + z * cosR;

      // 倾斜（绕 X 轴）
      const y2 = y * cosT - z2 * sinT;
      const z3 = y * sinT + z2 * cosT;

      // 透视投影
      const fov = 600;
      const scale = fov / (fov + z3 + 200);

      projected.push({
        p,
        x: cx + x2 * scale,
        y: cy + y2 * scale,
        z: z3,
        scale,
        isInner,
      });
    }

    // 深度排序（远→近）
    projected.sort((a, b) => a.z - b.z);

    // 绘制连线（分子键效果）
    if (this.effects.links) {
      this._drawLinks(ctx, projected);
    }

    // 绘制粒子
    this._drawParticles(ctx, projected, time);

    // 绘制球体边缘发光
    if (this.effects.glow) {
      this._drawSphereGlow(ctx, cx, cy);
    }

    // 内球边缘发光（张手时）
    if (this.gesture === 'open' && this.effects.glow) {
      this._drawInnerGlow(ctx, cx, cy);
    }

    // 绘制文字
    if (this._displayText && this._textOpacity > 0) {
      this._drawText(ctx, cx, cy);
    }
  }

  // ── 粒子连线（空间分区优化）──────────────────────────────────────
  _drawLinks(ctx, projected) {
    ctx.lineWidth = 0.5;
    const maxDist = LINK_DISTANCE * (this._sphereRadius / SPHERE_RADIUS);

    // 只对球面附近的粒子连线（性能优化）
    const surface = projected.filter(p => !p.isInner);

    // 空间分区
    const CELL_SIZE = maxDist;
    const grid = {};
    surface.forEach((p, idx) => {
      const cx = Math.floor(p.x / CELL_SIZE);
      const cy = Math.floor(p.y / CELL_SIZE);
      const key = `${cx},${cy}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(idx);
    });

    // 只检查相邻格子
    for (const key in grid) {
      const [cx, cy] = key.split(',').map(Number);
      const indices = grid[key];

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKey = `${cx+dx},${cy+dy}`;
          const neighborIndices = grid[neighborKey];
          if (!neighborIndices) continue;

          for (const i of indices) {
            for (const j of neighborIndices) {
              if (i >= j) continue; // 避免重复
              const a = surface[i];
              const b = surface[j];
              const dx = a.x - b.x;
              const dy = a.y - b.y;
              const dist = Math.sqrt(dx * dx + dy * dy);

              if (dist < maxDist) {
                const alpha = (1 - dist / maxDist) * LINK_OPACITY * a.scale * b.scale;
                const hue = (a.p.hue + this._hueOffset) % 360;
                ctx.strokeStyle = `hsla(${hue},60%,50%,${alpha.toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
              }
            }
          }
        }
      }
    }
  }

  // ── 粒子绘制 ──────────────────────────────────────────────────────
  _drawParticles(ctx, projected, time) {
    ctx.globalCompositeOperation = 'lighter';

    const preset = this._colorPresets[this._colorMode];

    for (const { p, x, y, z, scale, isInner } of projected) {
      const depthAlpha = Math.max(0.2, Math.min(1, (z + 200) / 400));
      const alpha = p.baseAlpha * depthAlpha * scale;
      const size = p.size * scale * (isInner ? 0.7 : 1);

      // 颜色（根据颜色模式）
      let hue, sat, light;
      if (preset) {
        hue = preset.hue;
        sat = preset.sat + '%';
        light = preset.light + '%';
      } else {
        hue = (p.hue + this._hueOffset) % 360;
        sat = isInner ? '80%' : '70%';
        light = isInner ? '75%' : '65%';
      }

      // 外层辉光
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue},${sat},${light},${(alpha * 0.15).toFixed(3)})`;
      ctx.arc(x, y, size * 3, 0, PI2);
      ctx.fill();

      // 中层
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue},${sat},${light},${(alpha * 0.4).toFixed(3)})`;
      ctx.arc(x, y, size * 1.5, 0, PI2);
      ctx.fill();

      // 核心
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue},90%,85%,${alpha.toFixed(3)})`;
      ctx.arc(x, y, size, 0, PI2);
      ctx.fill();

      // 白色热点
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue},100%,95%,${(alpha * 0.6).toFixed(3)})`;
      ctx.arc(x, y, size * 0.4, 0, PI2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  // ── 球体边缘发光 ──────────────────────────────────────────────────
  _drawSphereGlow(ctx, cx, cy) {
    const r = this._sphereRadius;
    const pulse = 0.8 + Math.sin(this.time * 2) * 0.2;

    // 外层光晕
    const grad = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.4);
    grad.addColorStop(0, `rgba(100,150,255,${(0.03 * pulse).toFixed(3)})`);
    grad.addColorStop(0.5, `rgba(80,120,220,${(0.02 * pulse).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(60,100,200,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.4, 0, PI2);
    ctx.fill();

    // 边缘光线
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hue = (this._hueOffset + 200) % 360;
    const edgeGrad = ctx.createRadialGradient(cx, cy, r * 0.95, cx, cy, r * 1.1);
    edgeGrad.addColorStop(0, `hsla(${hue},70%,60%,0)`);
    edgeGrad.addColorStop(0.5, `hsla(${hue},80%,65%,${(0.06 * pulse).toFixed(3)})`);
    edgeGrad.addColorStop(1, `hsla(${hue},70%,60%,0)`);
    ctx.fillStyle = edgeGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.1, 0, PI2);
    ctx.fill();
    ctx.restore();
  }

  // ── 内球发光 ──────────────────────────────────────────────────────
  _drawInnerGlow(ctx, cx, cy) {
    const r = this._innerSphereRadius;
    const pulse = 0.8 + Math.sin(this.time * 3) * 0.2;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.3);
    grad.addColorStop(0, `rgba(150,200,255,${(0.04 * pulse).toFixed(3)})`);
    grad.addColorStop(0.7, `rgba(100,150,220,${(0.02 * pulse).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(80,120,200,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.3, 0, PI2);
    ctx.fill();
  }

  // ── 文字绘制 ──────────────────────────────────────────────────────
  _drawText(ctx, cx, cy) {
    ctx.save();
    ctx.globalAlpha = this._textOpacity;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this.gesture === 'twohands') {
      // 日期时间显示
      ctx.font = 'bold 48px "Noto Serif SC", serif';
      ctx.fillStyle = 'rgba(200,220,255,0.9)';
      ctx.shadowColor = 'rgba(100,150,255,0.5)';
      ctx.shadowBlur = 20;
      const now = new Date();
      const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      ctx.fillText(dateStr, cx, cy - 30);
      ctx.font = 'bold 64px "Noto Serif SC", serif';
      ctx.fillText(timeStr, cx, cy + 30);
    } else {
      // "Li su" 文字
      ctx.font = 'bold 72px "Ma Shan Zheng", cursive';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.shadowColor = 'rgba(150,200,255,0.6)';
      ctx.shadowBlur = 30;
      ctx.fillText(this._displayText, cx, cy);
    }

    ctx.restore();
  }

  resize() {
    this._setupDPI();
    this._inkBg.resize(this.w, this.h);
  }

  destroy() {
    this.particles = [];
  }
}
