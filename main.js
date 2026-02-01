const { Engine, Render, Runner, World, Bodies, Body, Events, Composite } = Matter;

// =====================
// 게임 설정
// =====================
const W = 420;
const H = 720;
const wall = 22;

const topLineY = 150;            // 데드라인(게임오버 기준)
const waterY = topLineY + 100;   // 수면(물 시작) 높이
const waterBottomY = H - wall;   // 물 바닥(벽 두께 고려)

const waterDensity = 1.0;        // 물 밀도 기준(상대값)
const BUOY_K = 0.00125;          // 부력 보정(너무 뜨면 ↓, 너무 가라앉으면 ↑)
const DRAG_K = 0.03;             // 물 저항(크면 둔해짐)

let score = 0;
let gameOver = false;

// 고스트(조준)
let aimX = W / 2;
let aimActive = false;

const SPRITES = [
  { texture: "./src/img001.png", srcW: 512, srcH: 512 },
  { texture: "./src/img002.png", srcW: 512, srcH: 512 },
  { texture: "./src/img003.png", srcW: 512, srcH: 512 },
  { texture: "./src/img004.png", srcW: 512, srcH: 512 },
  { texture: "./src/img005.png", srcW: 512, srcH: 512 },
  { texture: "./src/img006.png", srcW: 512, srcH: 512 },
  { texture: "./src/img007.png", srcW: 512, srcH: 512 },
  { texture: "./src/img008.png", srcW: 512, srcH: 512 },
  { texture: "./src/img009.png", srcW: 512, srcH: 512 },
  { texture: "./src/img010.png", srcW: 512, srcH: 512 },
  { texture: "./src/img011.png", srcW: 512, srcH: 512 },
];

// 고스트용 이미지 캐시(깜빡임 방지)
const spriteCache = new Map();
function getSpriteForLevel(level) {
  const idx = Math.min(level, SPRITES.length - 1);
  const s = SPRITES[idx];

  if (!spriteCache.has(s.texture)) {
    const img = new Image();
    img.src = s.texture;
    spriteCache.set(s.texture, img);
  }

  return { ...s, img: spriteCache.get(s.texture) };
}

// =====================
// 단계 설정 (이름/색상 삭제)
// =====================
const levels = [
  { radius: 14, points: 1,   density: 0.70 },
  { radius: 18, points: 3,   density: 0.80 },
  { radius: 23, points: 6,   density: 0.90 },
  { radius: 28, points: 10,  density: 1.00 },
  { radius: 34, points: 15,  density: 1.05 },
  { radius: 40, points: 21,  density: 1.10 },
  { radius: 48, points: 28,  density: 0.95 },
  { radius: 58, points: 36,  density: 1.15 },
  { radius: 70, points: 45,  density: 1.20 },
  { radius: 86, points: 60,  density: 1.25 },
  { radius: 95, points: 100, density: 1.30 },
];

// DOM
const scoreEl = document.getElementById("score");
const timeEl  = document.getElementById("time"); // ✅ 타이머 DOM (HTML에 <span id="time">00:00</span> 필요)
const resetBtn = document.getElementById("reset");
const gameDiv = document.getElementById("game");

// =====================
// 타이머(플레이 누적 시간)
// =====================
let timerRunning = false;
let startTimeMs = 0;
let elapsedMs = 0;

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function setTime(ms) {
  if (timeEl) timeEl.textContent = formatTime(ms);
}
setTime(0);

// =====================
// 거품 + 파문 + 사운드
// =====================
const bubbles = []; // {x,y,vx,vy,r,life,maxLife,alpha}
const ripples = []; // {x,y,r,vr,life,maxLife,alpha}

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

// "뾱"(합치기)
function playPop(level = 0) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  const base = 560 - level * 16;
  const startFreq = Math.max(180, base);
  const endFreq = startFreq * 0.58;

  o.type = "triangle";
  o.frequency.setValueAtTime(startFreq, now);
  o.frequency.exponentialRampToValueAtTime(endFreq, now + 0.08);

  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.18, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

  o.connect(g);
  g.connect(audioCtx.destination);

  o.start(now);
  o.stop(now + 0.13);
}

// "첨벙"(물 입수)
function playSplash(strength = 1.0) {
  if (!audioCtx) return;

  const now = audioCtx.currentTime;

  const bufferSize = Math.floor(audioCtx.sampleRate * 0.12);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const t = i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * (1 - t);
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.exponentialRampToValueAtTime(300, now + 0.12);

  const gain = audioCtx.createGain();
  const amp = Math.min(0.22, 0.08 + strength * 0.10);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(amp, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  noise.start(now);
  noise.stop(now + 0.15);

  // 저음 둥
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(120, now);
  o.frequency.exponentialRampToValueAtTime(75, now + 0.12);

  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.min(0.12, 0.04 + strength * 0.06), now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(now);
  o.stop(now + 0.18);
}

function spawnBubbles(x, y, count = 18) {
  for (let i = 0; i < count; i++) {
    const r = 2.5 + Math.random() * 5.5;
    bubbles.push({
      x: x + (Math.random() - 0.5) * 34,
      y: y + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -1.2 - Math.random() * 2.1,
      r,
      life: 0,
      maxLife: 45 + Math.random() * 35,
      alpha: 1.0
    });
  }
}

function spawnRipple(x, strength = 1) {
  ripples.push({
    x,
    y: waterY + 2,
    r: 8,
    vr: 3.2 + strength * 2.0,
    life: 0,
    maxLife: 22 + strength * 8,
    alpha: 0.9
  });
}

// =====================
// 엔진 / 렌더
// =====================
const engine = Engine.create();
engine.world.gravity.y = 1.05;

const render = Render.create({
  element: gameDiv,
  engine,
  options: {
    width: W,
    height: H,
    wireframes: false,
    background: "transparent",
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  },
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// =====================
// 바닥/벽
// =====================
const floor = Bodies.rectangle(W / 2, H + wall / 2, W, wall, {
  isStatic: true,
  render: { fillStyle: "rgba(0,0,0,0.08)" }
});
const leftWall = Bodies.rectangle(-wall / 2, H / 2, wall, H, {
  isStatic: true,
  render: { fillStyle: "rgba(0,0,0,0.06)" }
});
const rightWall = Bodies.rectangle(W + wall / 2, H / 2, wall, H, {
  isStatic: true,
  render: { fillStyle: "rgba(0,0,0,0.06)" }
});

World.add(engine.world, [floor, leftWall, rightWall]);

// =====================
// 유틸 / 스코어
// =====================
function setScore(v) {
  score = v;
  scoreEl.textContent = score;
}

function randDropLevel() {
  return Math.floor(Math.random() * 4); // 0~3 랜덤 (원하면 바꾸기)
}

// ✅ "현재 드롭할 것" / "다음 후보" 분리
let currentLevel = randDropLevel();
let nextLevel = randDropLevel();

// ✅ 클릭 순간 고스트가 바로 다음으로 바뀌는 거 방지
let ghostLockUntil = 0; // ms timestamp

function spriteScaleForRadius(radius, srcW, srcH) {
  const targetW = radius * 2;
  const targetH = radius * 2;
  return {
    xScale: targetW / srcW,
    yScale: targetH / srcH,
  };
}

function makeBall(x, y, level) {
  const L = levels[level];
  const { texture, srcW, srcH } = getSpriteForLevel(level);
  const { xScale, yScale } = spriteScaleForRadius(L.radius, srcW, srcH);

  const body = Bodies.circle(x, y, L.radius, {
    restitution: 0.15,
    friction: 0.15,
    frictionAir: 0.005,
    label: "ball",
    render: {
      fillStyle: "transparent",
      strokeStyle: "transparent",
      lineWidth: 0,
      sprite: {
        texture,
        xScale,
        yScale,
      }
    }
  });

  body.level = level;
  body.fluidDensity = L.density;
  body.mergeCooldownUntil = 0;
  body.wasInWater = false;

  World.add(engine.world, body);
  return body;
}

// =====================
// 조준/클램프
// =====================
function clampX(clientX){
  const rect = render.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  return Math.max(50, Math.min(W - 50, x));
}

gameDiv.addEventListener("pointermove", (e) => {
  aimActive = true;
  aimX = clampX(e.clientX);
});
gameDiv.addEventListener("pointerenter", (e) => {
  aimActive = true;
  aimX = clampX(e.clientX);
});
gameDiv.addEventListener("pointerleave", () => {
  aimActive = false;
});

// =====================
// 입력 (✅ 타이머 시작 + 고스트가 "다음"으로 즉시 바뀌지 않게 처리)
// =====================
gameDiv.addEventListener("pointerdown", (e) => {
  if (gameOver) return;

  ensureAudio();

  // ✅ 첫 입력에서 타이머 시작
  if (!timerRunning) {
    timerRunning = true;
    startTimeMs = performance.now() - elapsedMs;
  }

  const x = aimActive ? aimX : clampX(e.clientX);
  const y = topLineY - 80;

  // ✅ 지금 보여주던 currentLevel을 드롭
  const dropLevel = currentLevel;
  makeBall(x, y, dropLevel);
  spawnBubbles(x, waterY + 6, 4);

  // ✅ 잠깐(90ms) 고스트를 dropLevel로 고정 -> "다음이 튀어나오는" 느낌 제거
  ghostLockUntil = performance.now() + 90;

  // ✅ 그 다음에 currentLevel을 next로 넘기고, next는 새로 뽑기
  currentLevel = nextLevel;
  nextLevel = randDropLevel();
});

// =====================
// 합치기(쿨다운)
// =====================
Events.on(engine, "collisionStart", (event) => {
  if (gameOver) return;

  const now = engine.timing.timestamp;

  for (const { bodyA: a, bodyB: b } of event.pairs) {
    if (a.label !== "ball" || b.label !== "ball") continue;
    if (a.level === undefined || b.level === undefined) continue;
    if (a.level !== b.level) continue;

    if ((a.mergeCooldownUntil ?? 0) > now) continue;
    if ((b.mergeCooldownUntil ?? 0) > now) continue;

    const level = a.level;
    if (level >= levels.length - 1) continue;

    a.mergeCooldownUntil = now + 200;
    b.mergeCooldownUntil = now + 200;

    const nx = (a.position.x + b.position.x) / 2;
    const ny = (a.position.y + b.position.y) / 2;

    World.remove(engine.world, a);
    World.remove(engine.world, b);

    const inWater = ny > waterY;
    spawnBubbles(nx, ny, inWater ? 34 : 20);
    playPop(level + 1);

    if (Math.abs(ny - waterY) < 30) spawnRipple(nx, 0.8);

    makeBall(nx, ny - 6, level + 1);
    setScore(score + levels[level + 1].points);
  }
});

// =====================
// 업데이트: 타이머 + 부력/저항 + 거품/파문 업데이트 + 게임오버 체크
// =====================
Events.on(engine, "afterUpdate", () => {
  // ✅ 타이머 업데이트
  if (timerRunning && !gameOver) {
    elapsedMs = performance.now() - startTimeMs;
    setTime(elapsedMs);
  }

  const bodies = Composite.allBodies(engine.world);
  const g = engine.world.gravity.y;

  // 거품 업데이트
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const p = bubbles[i];
    p.life += 1;
    p.x += p.vx;
    p.y += p.vy;

    const t = p.life / p.maxLife;
    p.alpha = Math.max(0, 1 - t);

    if (p.y < waterY - 10) p.life += 2;
    if (p.life >= p.maxLife) bubbles.splice(i, 1);
  }

  // 파문 업데이트
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.life += 1;
    r.r += r.vr;
    const t = r.life / r.maxLife;
    r.alpha = Math.max(0, 0.9 * (1 - t));
    if (r.life >= r.maxLife) ripples.splice(i, 1);
  }

  if (gameOver) return;

  for (const b of bodies) {
    if (b.label !== "ball") continue;

    const rad = b.circleRadius ?? 0;
    const top = b.position.y - rad;
    const bottom = b.position.y + rad;

    const isInWaterNow = bottom > waterY;

    // 물에 처음 들어가면 첨벙
    if (isInWaterNow && !b.wasInWater) {
      b.wasInWater = true;

      const strength = Math.min(2.0, Math.max(0.6, Math.abs(b.velocity.y) * 0.7));

      spawnRipple(b.position.x, strength);
      spawnBubbles(b.position.x, waterY + 10, 10 + Math.floor(10 * strength));
      playSplash(strength);
    }
    if (!isInWaterNow) b.wasInWater = false;

    // 물 속 처리
    if (isInWaterNow) {
      const submerged = Math.max(0, Math.min(1, (bottom - waterY) / (2 * rad)));

      const fruitDensity = b.fluidDensity ?? 1.0;
      const ratio = waterDensity / fruitDensity;

      const buoyancy = b.mass * g * ratio * submerged;
      Body.applyForce(b, b.position, { x: 0, y: -buoyancy * BUOY_K });

      const drag = DRAG_K * submerged;
      Body.applyForce(b, b.position, {
        x: -b.velocity.x * drag * 0.001,
        y: -b.velocity.y * drag * 0.001,
      });

      const nearSurface = Math.abs(top - waterY) < 14;
      if (nearSurface) {
        const wobble = Math.sin(engine.timing.timestamp * 0.01 + b.position.x * 0.05) * 0.00006;
        Body.applyForce(b, b.position, { x: 0, y: -wobble });
      }
    }

    // 게임오버 체크
    const topOfBall = b.position.y - rad;
    if (topOfBall < topLineY && b.speed < 0.2) {
      gameOver = true;
      timerRunning = false; // ✅ 타이머 정지
      setTimeout(() => alert("Game Over!"), 50);
      break;
    }
  }
});

// =====================
// 렌더: 데드라인 + 물 + 파문 + 거품 + (마지막) 고스트
// =====================
Events.on(render, "afterRender", () => {
  const ctx = render.context;

  // 데드라인
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, topLineY);
  ctx.lineTo(W, topLineY);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 0, 0, 0.65)";
  ctx.setLineDash([10, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 물(바다)
  ctx.save();
  const grad = ctx.createLinearGradient(0, waterY, 0, waterBottomY);
  grad.addColorStop(0, "rgba(80, 170, 255, 0.40)");
  grad.addColorStop(1, "rgba(30, 110, 220, 0.62)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, waterY, W, waterBottomY - waterY);

  // 수면 물결
  const t = engine.timing.timestamp * 0.004;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 10) {
    const wave = Math.sin(t + x * 0.05) * 4.5;
    const y = waterY + wave;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.stroke();

  // 파문
  for (const r of ripples) {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${r.alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 거품
  for (const p of bubbles) {
    if (p.y < waterY - 5) continue;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * p.alpha})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x - p.r * 0.25, p.y - p.r * 0.25, p.r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.75 * p.alpha})`;
    ctx.fill();
  }

  ctx.restore(); // 물 레이어 끝

  // =====================
  // 고스트 + 가이드 라인(맨 마지막)
  // =====================
  if (aimActive && !gameOver) {
    const now = performance.now();
    const showLevel = (now < ghostLockUntil) ? currentLevel : currentLevel;

    const L = levels[showLevel];
    const gx = aimX;
    const gy = topLineY - 80;

    ctx.save();

    // 가이드 라인
    ctx.beginPath();
    ctx.moveTo(gx, topLineY - 40);
    ctx.lineTo(gx, H - 10);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.stroke();
    ctx.setLineDash([]);

    // 고스트 이미지
    const { img } = getSpriteForLevel(showLevel);
    const size = L.radius * 2;

    if (img.complete && img.naturalWidth > 0) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, gx - size / 2, gy - size / 2, size, size);
      ctx.globalAlpha = 1.0;
    } else {
      // 로드 지연시 fallback
      ctx.beginPath();
      ctx.arc(gx, gy, L.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.stroke();
    }

    ctx.restore();
  }
});

// =====================
// 리셋
// =====================
resetBtn.addEventListener("click", () => {
  World.clear(engine.world, false);
  Engine.clear(engine);

  bubbles.length = 0;
  ripples.length = 0;

  gameOver = false;
  setScore(0);

  // ✅ 타이머 초기화
  timerRunning = false;
  startTimeMs = 0;
  elapsedMs = 0;
  setTime(0);

  World.add(engine.world, [floor, leftWall, rightWall]);

  currentLevel = randDropLevel();
  nextLevel = randDropLevel();
});
