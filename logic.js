'use strict';
// 컵 섞기(야바위): 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 공이 든 컵을 눈으로 따라가다가, 섞기가 끝나면 공이 있는 컵을 고른다. 맞히면 다음 라운드(컵이 늘고 빨라짐), 틀리면 목숨이 줄어든다.
(function (root) {
  const SHOW = 1.4, DOWN = 0.5, RESULT = 1.7;      // 공 보여 주기 · 컵 내리기 · 결과 보여 주기(초)
  const MAX_CUPS = 6;
  const LEVELS = {
    easy: { label: '쉬움', lives: 3, pickLimit: 0 },
    normal: { label: '보통', lives: 2, pickLimit: 8 },
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

  // 라운드마다 컵 수 · 섞는 횟수 · 한 번 섞는 시간 · 두 쌍을 동시에 섞을 확률
  function roundParams(level, round) {
    if (level === 'easy') {
      return { n: round <= 3 ? 3 : round <= 8 ? 4 : 5, swaps: Math.min(18, 4 + Math.floor(round * 1.5)), dur: Math.max(0.32, 0.62 - 0.025 * round), doubleP: round >= 6 ? 0.2 : 0 };
    }
    return { n: round <= 2 ? 3 : round <= 4 ? 4 : round <= 8 ? 5 : 6, swaps: Math.min(26, 6 + round * 2), dur: Math.max(0.2, 0.5 - 0.03 * round), doubleP: round >= 3 ? 0.3 : 0 };
  }

  function makeRound(st) {
    const rand = st.rand, tut = st.tutorial;
    const p = tut ? { n: 3, swaps: 4, dur: 0.8, doubleP: 0 } : roundParams(st.level, st.round);
    const n = p.n, slots = Array.from({ length: n }, (_, i) => i);     // 칸 번호 → 그 칸의 컵 번호
    const ball = Math.floor(rand() * n);
    const swaps = [];
    let ballSlot = ball;                                                  // 공이 든 컵의 현재 칸
    let last = null;
    for (let k = 0; k < p.swaps; k++) {
      let pairs;
      const wantDouble = n >= 4 && rand() < p.doubleP;
      const pick2 = () => { const a = Math.floor(rand() * n); let b = Math.floor(rand() * (n - 1)); if (b >= a) b++; return [Math.min(a, b), Math.max(a, b)]; };
      let first = pick2();
      if (k % 3 === 0 && first[0] !== ballSlot && first[1] !== ballSlot) { const o = Math.floor(rand() * (n - 1)); first = [Math.min(ballSlot, o >= ballSlot ? o + 1 : o), Math.max(ballSlot, o >= ballSlot ? o + 1 : o)]; }   // 공이 한 번도 안 움직이지 않게
      if (last && first[0] === last[0] && first[1] === last[1]) first = pick2();
      pairs = [first];
      if (wantDouble) { for (let tries = 0; tries < 10; tries++) { const q = pick2(); if (q[0] !== first[0] && q[0] !== first[1] && q[1] !== first[0] && q[1] !== first[1]) { pairs.push(q); break; } } }
      for (const [a, b] of pairs) { if (ballSlot === a) ballSlot = b; else if (ballSlot === b) ballSlot = a; }
      swaps.push(pairs); last = first;
    }
    st.n = n; st.slots = slots; st.ball = ball; st.swaps = swaps; st.dur = p.dur; st.si = 0; st.swapT = 0; st.finalBallSlot = ballSlot;
    st.phase = 'show'; st.t = 0; st.picked = -1; st.correct = null; st.pickT = 0;
    st.events.push({ type: 'round', round: st.round, n });
  }

  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const lv = LEVELS[opts.level] ? opts.level : 'normal';
    const params = LEVELS[lv];
    const st = { rand, level: lv, params, tutorial: !!opts.tutorial, round: 1, lives: params.lives, score: 0, streak: 0, cleared: 0, over: false, events: [], phase: 'show', t: 0 };
    makeRound(st);
    return st;
  }

  // 컵을 고른다 (칸 번호). 고를 수 있는 때가 아니면 무시
  function pick(st, slot) {
    if (st.over || st.phase !== 'pick' || slot < 0 || slot >= st.n) return false;
    return resolve(st, slot);
  }
  function resolve(st, slot) {
    st.picked = slot;
    st.correct = slot >= 0 && st.slots[slot] === st.ball;
    if (st.correct) { st.streak++; st.cleared = st.round; st.score += 10 * st.round + 5 * st.streak; }
    else { st.streak = 0; if (!st.tutorial) st.lives--; }
    st.phase = 'result'; st.t = 0;
    st.events.push({ type: 'pick', slot, correct: st.correct, timeout: slot < 0 });
    return true;
  }

  function step(st, dt) {
    let left = dt;
    while (left > 1e-9 && !st.over) {
      if (st.phase === 'show') { const need = SHOW - st.t; if (left < need) { st.t += left; left = 0; } else { left -= need; st.phase = 'down'; st.t = 0; } }
      else if (st.phase === 'down') { const need = DOWN - st.t; if (left < need) { st.t += left; left = 0; } else { left -= need; st.phase = 'shuffle'; st.t = 0; st.si = 0; st.swapT = 0; startSwap(st); } }
      else if (st.phase === 'shuffle') {
        const need = (1 - st.swapT) * st.dur;
        if (left < need) { st.swapT += left / st.dur; left = 0; }
        else {
          left -= need;
          for (const [a, b] of st.swaps[st.si]) { const x = st.slots[a]; st.slots[a] = st.slots[b]; st.slots[b] = x; }
          st.events.push({ type: 'swapEnd', si: st.si });
          st.si++; st.swapT = 0;
          if (st.si >= st.swaps.length) { st.phase = 'pick'; st.t = 0; st.pickT = 0; st.events.push({ type: 'pickTime' }); }
          else startSwap(st);
        }
      } else if (st.phase === 'pick') {
        const lim = st.params.pickLimit;
        if (lim && !st.tutorial) { const need = lim - st.pickT; if (left < need) { st.pickT += left; left = 0; } else { left = 0; resolve(st, -1); } }
        else { st.pickT += left; left = 0; }
      } else if (st.phase === 'result') {
        const need = RESULT - st.t;
        if (left < need) { st.t += left; left = 0; }
        else {
          left -= need;
          if (st.correct) st.round++;
          if (st.lives <= 0) { st.over = true; st.events.push({ type: 'over' }); }
          else makeRound(st);
        }
      } else break;
    }
  }
  function startSwap(st) { st.events.push({ type: 'swap', si: st.si, pairs: st.swaps[st.si], dur: st.dur }); }

  const api = { SHOW, DOWN, RESULT, MAX_CUPS, LEVELS, rng, roundParams, newGame, pick, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_CUPS = api;
})(typeof window !== 'undefined' ? window : globalThis);
