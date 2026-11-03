'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 컵 섞기(야바위): 화면·입력·소리. 규칙은 logic.js (LOGIC_CUPS).
const L = LOGIC_CUPS;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640, CUP_Y = 372, LIFT = 52;
const canvas = $('game'), ctx = canvas.getContext('2d');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('cupshuffleMuted') === '1';
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  swap: (dur) => tone(200 + Math.random() * 60, Math.min(0.16, dur * 0.5), 'sine', 0.035, 140),
  lift: () => tone(330, 0.1, 'triangle', 0.04, 160),
  ok: () => { tone(660, 0.1, 'triangle', 0.06); setTimeout(() => tone(990, 0.16, 'triangle', 0.06), 90); },
  bad: () => { tone(220, 0.3, 'sawtooth', 0.06, -120); },
  round: () => tone(520, 0.12, 'square', 0.03),
  over: () => { tone(330, 0.2, 'sawtooth', 0.05, -120); setTimeout(() => tone(196, 0.35, 'sawtooth', 0.05, -80), 180); },
  best: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'triangle', 0.06), i * 90)),
};

// ---------- 상태 ----------
let G = L.newGame(L.rng(1), { level: 'easy' });
let state = 'title';                    // title · play · paused · over
let level = 'easy', tut = false, newBest = false, clock = 0, floats = [], banner = null, shake = 0, lastPhase = '';
let best = Number(store.get('cupshuffleBest')) || 0;

/* @test-hooks:start */
window.__cs = { get G() { return G; }, get state() { return state; }, L, step: (dt) => update(dt), tap: (x, y) => tapAt(x, y) };
/* @test-hooks:end */

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelectorAll('button:not([data-share])').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level); }); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
let daily = false;                                                   // 이번 판이 오늘의 판인가 (로비의 daily.js)
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>목숨 3 · 느리게</small></button><button data-level="normal">보통<small>목숨 2 · 시간 제한 · 기록</small></button>${window.arcadeDaily ? arcadeDaily.buttonHtml() : ''}</div>`;
function onOverlayButton(lv) { if (state === 'paused') { resume(); return; } start(lv); }
function showTitle() {
  state = 'title';
  showOverlay(`<h1>컵 섞기</h1><p>공이 들어간 컵을 <b>눈으로 따라가세요</b>!<br>섞기가 끝나면 공이 든 컵을 눌러요.</p>
    <p class="help">맞히면 다음 라운드, 컵이 늘고 점점 빨라져요.<br>틀리면 ❤ 가 줄어요. 끝까지 버텨 보세요!</p>
    ${best ? `<div class="big">최고 ${best}라운드</div>` : ''}${lvButtons()}<p class="note"><span class="pc">컵을 클릭 · 숫자 1~6 키</span><span class="touch">컵을 톡 누르기</span></p>`);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = lv === 'normal' ? 'normal' : 'easy';
  daily = !tut && lv === 'normal' && !!(window.arcadeDaily && arcadeDaily.take());
  G = L.newGame(daily ? arcadeDaily.rng() : Math.random, { level, tutorial: tut });
  floats = []; banner = null; newBest = false; shake = 0; lastPhase = '';
  state = 'play'; hideOverlay();
  banner = { text: tut ? '연습' : '라운드 1', t: 0 };
}
function gameOver() {
  state = 'over'; sfx.over();
  const cleared = G.cleared;
  if (!tut && window.arcadeRun) arcadeRun({ level, bad: cleared <= 1 });         // 연패 구제(로비): 1라운드도 못 넘기면 나쁜 판
  if (newBest) setTimeout(sfx.best, 500);                         // 기록은 맞힐 때마다 바로 저장해 두고, 여기서는 알리기만
  setTimeout(() => {
    if (state !== 'over') return;
    showOverlay(`<h2>게임 끝!</h2><div class="big">${cleared}라운드 성공</div><p>점수 <b>${G.score}</b>${newBest ? ' · 🎉 새 최고 기록!' : level === 'normal' ? ` · 최고 ${best}라운드` : ' · 쉬움에서는 기록이 저장되지 않아요'}</p>${daily ? arcadeDaily.result('컵 섞기', G.score, '점') : ''}${lvButtons()}`);
  }, 1000);
}
function pause() { if (state !== 'play') return; state = 'paused'; showOverlay(`<h2>일시정지</h2><button>계속하기</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }
function toggleMute() { muted = !muted; store.set('cupshuffleMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }

// ---------- 좌표 ----------
const spacing = (n) => (n <= 3 ? 104 : n === 4 ? 82 : n === 5 ? 68 : 58);
const cupW = (n) => Math.min(62, spacing(n) - 12);
const slotX = (n, i) => W / 2 + (i - (n - 1) / 2) * spacing(n);
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// 컵 하나의 지금 위치와 앞뒤 (섞는 중이면 호를 그리며 움직임)
function cupPose(cupId) {
  const n = G.n, slot = G.slots.indexOf(cupId);
  let x = slotX(n, slot), y = CUP_Y, depth = 0;
  if (G.phase === 'shuffle') {
    const u = ease(Math.min(1, G.swapT));
    for (const [a, b] of G.swaps[G.si]) {
      if (slot === a || slot === b) {
        const other = slot === a ? b : a, sign = slot === a ? 1 : -1, xa = slotX(n, slot), xb = slotX(n, other);
        x = xa + (xb - xa) * u; depth = Math.sin(Math.PI * u) * sign;
        y = CUP_Y + depth * 30;
      }
    }
  }
  return { x, y, depth, slot };
}

// ---------- 입력 ----------
function toGame(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
function tapAt(x, y) {
  if (state !== 'play' || G.phase !== 'pick') return;
  const n = G.n, hw = Math.max(spacing(n) / 2, 30);
  if (y < CUP_Y - 110 || y > CUP_Y + 60) return;
  for (let i = 0; i < n; i++) {
    if (Math.abs(x - slotX(n, i)) <= hw - 2) { doPick(i); return; }
  }
}
function doPick(i) { if (L.pick(G, i)) handleEvents(); }
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); const p = toGame(e); tapAt(p.x, p.y); });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') { if (!e.repeat) state === 'paused' ? resume() : pause(); return; }
  if (e.code === 'KeyM') { if (!e.repeat) toggleMute(); return; }
  const m = /^(Digit|Numpad)([1-6])$/.exec(e.code);
  if (m && state === 'play' && G.phase === 'pick' && Number(m[2]) <= G.n) doPick(Number(m[2]) - 1);
});
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 갱신 ----------
function handleEvents() {
  for (const ev of G.events) {
    if (ev.type === 'swap') sfx.swap(ev.dur);
    else if (ev.type === 'round') { if (ev.round > 1 || lastPhase !== '') { banner = { text: tut ? '연습' : `라운드 ${ev.round}`, t: 0 }; sfx.round(); } }
    else if (ev.type === 'pick') {
      tutorialSignal('pick');
      const px = ev.slot >= 0 ? slotX(G.n, ev.slot) : W / 2;
      if (ev.correct) { sfx.ok(); tutorialSignal('correct'); floats.push({ x: px, y: CUP_Y - 100, t: 0, text: G.streak >= 2 ? `${G.streak}연속! +${10 * G.round + 5 * G.streak}` : `정답! +${10 * G.round + 5 * G.streak}`, color: '#9dff9d' }); if (level === 'normal' && !tut && G.cleared > best) { best = G.cleared; newBest = true; store.set('cupshuffleBest', String(best)); } }
      else { sfx.bad(); shake = 0.3; floats.push({ x: px, y: CUP_Y - 100, t: 0, text: ev.timeout ? '시간 초과!' : '아쉬워요!', color: '#ff9a9a' }); }
    } else if (ev.type === 'over') gameOver();
  }
  G.events.length = 0;
}
function update(dt) {
  clock += dt;
  if (state === 'play') {
    const before = G.phase;
    L.step(G, dt);
    handleEvents();
    if (before !== G.phase && G.phase === 'down') sfx.lift();
    lastPhase = G.phase;
  }
  for (const f of floats) f.t += dt; floats = floats.filter((f) => f.t < 1.4);
  if (banner) { banner.t += dt; if (banner.t > 1.3) banner = null; }
  shake = Math.max(0, shake - dt);
}

// ---------- 그리기 ----------
function drawCup(x, y, w, lift, color, depth) {
  const h = 68, top = w * 0.74, sc = 1 + depth * 0.06, by = y - lift;
  ctx.save(); ctx.translate(x, by); ctx.scale(sc, sc);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, lift + 6, w * 0.5 + lift * 0.1, 8, 0, 0, 7); ctx.fill();
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, color[0]); g.addColorStop(0.45, color[1]); g.addColorStop(1, color[0]);
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-top / 2, -h); ctx.quadraticCurveTo(0, -h - 10, top / 2, -h); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.32)'; ctx.beginPath(); ctx.moveTo(-w / 2 + 6, -4); ctx.lineTo(-top / 2 + 5, -h + 4); ctx.lineTo(-top / 2 + 11, -h + 4); ctx.lineTo(-w / 2 + 13, -4); ctx.fill();
  ctx.fillStyle = color[2]; ctx.fillRect(-w / 2 + 1, -14, w - 2, 7);                       // 아래 띠
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(0, 0, w / 2, 6, 0, 0, 7); ctx.fill();   // 입구
  ctx.restore();
}
function drawBall(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 6, 13, 5, 0, 0, 7); ctx.fill();
  const g = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, 13); g.addColorStop(0, '#ffb0a0'); g.addColorStop(1, '#e02a2a');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 1, 12, 0, 7); ctx.fill();
}
const CUP_COLORS = [['#c43a2a', '#ff6a50', '#ffd23a']];
function draw() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * shake * 2, (Math.random() - 0.5) * 8 * shake * 2);
  // 밤 시장 배경
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1c1030'); bg.addColorStop(0.5, '#4a2a3a'); bg.addColorStop(1, '#2a1608');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) { const lx = 30 + i * 60, sw = Math.sin(clock * 1.2 + i) * 3; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(lx, 40); ctx.lineTo(lx + sw, 78); ctx.stroke(); ctx.fillStyle = i % 2 ? '#ffb02e' : '#ff5a6e'; ctx.beginPath(); ctx.ellipse(lx + sw, 90, 13, 16, 0, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,230,150,.2)'; ctx.beginPath(); ctx.arc(lx + sw, 90, 30, 0, 7); ctx.fill(); }
  // 야바위 판 (붉은 천을 덮은 상자)
  ctx.fillStyle = '#5a3a1a'; ctx.fillRect(10, CUP_Y - 36, W - 20, 150);
  ctx.fillStyle = '#b02a3a'; ctx.fillRect(18, CUP_Y - 30, W - 36, 126);
  ctx.fillStyle = 'rgba(255,255,255,.07)'; for (let x = 18; x < W - 18; x += 24) ctx.fillRect(x, CUP_Y - 30, 12, 126);
  ctx.fillStyle = '#3a2410'; ctx.fillRect(10, CUP_Y + 114, W - 20, 12);
  ctx.fillRect(30, CUP_Y + 126, 14, 60); ctx.fillRect(W - 44, CUP_Y + 126, 14, 60);

  const n = G.n, w = cupW(n), ballSlot = G.slots.indexOf(G.ball);
  // 공 (컵 아래 바닥에 놓임): 보여 줄 때와 결과에서만 보인다
  const showBall = G.phase === 'show' || G.phase === 'down' || G.phase === 'result';
  const poses = []; for (let id = 0; id < n; id++) poses.push({ id, ...cupPose(id) });
  if (showBall) { const bp = poses.find((p) => p.id === G.ball); drawBall(bp.x, bp.y); }
  // 뒤쪽 컵부터 그리기
  poses.sort((a, b) => a.depth - b.depth || a.y - b.y);
  for (const p of poses) {
    let lift = 0;
    if (G.phase === 'show') lift = p.id === G.ball ? LIFT * Math.min(1, G.t / 0.3) * (G.t > L.SHOW - 0.25 ? Math.max(0, (L.SHOW - G.t) / 0.25) : 1) : 0;
    else if (G.phase === 'result') { const t = Math.min(1, G.t / 0.3); if (p.id === G.ball || p.slot === G.picked) lift = LIFT * t; }
    else if (G.phase === 'pick') lift = Math.max(0, Math.sin(clock * 5 + p.slot) * 2.5);
    drawCup(p.x, p.y, w, lift, CUP_COLORS[0], p.depth);
    if (G.phase === 'result' && p.slot === G.picked) { ctx.strokeStyle = G.correct ? '#9dff9d' : '#ff9a9a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y - 34 - lift, w * 0.7, 0, 7); ctx.stroke(); }
    if (G.phase === 'pick' && state === 'play') { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '800 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(p.slot + 1), p.x, p.y + 24); }
  }
  ctx.restore();
  drawHud();
}
function drawHud() {
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, W, 38);
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '900 17px sans-serif'; ctx.fillText(tut ? '연습' : `라운드 ${G.round}`, 10, 25);
  ctx.textAlign = 'center'; ctx.font = '800 14px sans-serif'; ctx.fillStyle = '#ffe9a8'; ctx.fillText(`점수 ${G.score}`, W / 2 - 4, 24);
  if (!tut) { ctx.textAlign = 'left'; ctx.font = '16px sans-serif'; ctx.fillStyle = '#ff6a7a'; ctx.fillText('♥'.repeat(Math.max(0, G.lives)) + '♡'.repeat(Math.max(0, G.params.lives - Math.max(0, G.lives))), 10, 56); }
  // 안내 문구
  ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  const msg = { show: '공을 잘 보세요! 👀', down: '준비…', shuffle: '잘 따라가세요…', pick: '공이 든 컵은? 눌러 보세요!', result: G.correct ? (G.streak >= 2 ? `${G.streak}연속 정답!` : '정답!') : (G.picked < 0 ? '시간 초과!' : '아쉬워요!') }[G.phase] || '';
  ctx.font = '900 20px sans-serif'; ctx.fillStyle = G.phase === 'result' ? (G.correct ? '#9dff9d' : '#ff9a9a') : '#fff';
  ctx.strokeText(msg, W / 2, 190); ctx.fillText(msg, W / 2, 190);
  // 남은 시간(보통)
  if (G.phase === 'pick' && G.params.pickLimit && !tut) { const f = Math.max(0, 1 - G.pickT / G.params.pickLimit); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(60, 206, 240, 9); ctx.fillStyle = f > 0.3 ? '#7be0ff' : '#ff6a7a'; ctx.fillRect(61, 207, 238 * f, 7); }
  if (G.phase === 'shuffle') { const done = G.si + G.swapT, tot = G.swaps.length; ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(110, 206, 140, 6); ctx.fillStyle = '#ffd23a'; ctx.fillRect(111, 207, 138 * Math.min(1, done / tot), 4); }
  for (const f of floats) { const k = f.t / 1.4; ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.font = '900 18px sans-serif'; ctx.strokeText(f.text, f.x, f.y - k * 30); ctx.fillText(f.text, f.x, f.y - k * 30); ctx.globalAlpha = 1; }
  if (banner) { const a = banner.t < 0.2 ? banner.t / 0.2 : banner.t > 1 ? Math.max(0, (1.3 - banner.t) / 0.3) : 1; ctx.globalAlpha = a; ctx.font = '900 40px sans-serif'; ctx.fillStyle = '#ffd23a'; ctx.lineWidth = 7; ctx.strokeText(banner.text, W / 2, 130); ctx.fillText(banner.text, W / 2, 130); ctx.globalAlpha = 1; }
  // 컵 수 · 다음 단계 힌트
  ctx.font = '700 11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(`컵 ${G.n}개`, W - 34, 56);
}

let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
showTitle();
requestAnimationFrame(frame);
