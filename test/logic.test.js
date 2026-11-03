'use strict';
// 컵 섞기 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const fresh = (opts = {}) => L.newGame(L.rng(7), Object.assign({ level: 'normal' }, opts));
const clearEv = (st) => { const e = st.events.slice(); st.events.length = 0; return e; };
// 선택 단계까지 시간을 보낸다
const toPick = (st) => { for (let i = 0; i < 20000 && st.phase !== 'pick'; i++) L.step(st, 1 / 60); assert.strictEqual(st.phase, 'pick'); };
const ballSlot = (st) => st.slots.indexOf(st.ball);

test('round parameters grow with the round and stay within limits', () => {
  for (const level of ['easy', 'normal']) {
    let prev = null;
    for (let r = 1; r <= 40; r++) {
      const p = L.roundParams(level, r);
      assert.ok(p.n >= 3 && p.n <= L.MAX_CUPS, `${level} r${r} cups ${p.n}`);
      assert.ok(p.dur >= 0.2 && p.dur <= 0.62);
      if (prev) { assert.ok(p.n >= prev.n); assert.ok(p.swaps >= prev.swaps); assert.ok(p.dur <= prev.dur + 1e-9); }
      prev = p;
    }
  }
  assert.ok(L.roundParams('normal', 10).dur < L.roundParams('easy', 10).dur, 'normal is faster than easy');
  assert.strictEqual(L.roundParams('easy', 1).n, 3);
});

test('new game: starts at round 1 showing the ball; lives by level', () => {
  const e = fresh({ level: 'easy' }), n = fresh({ level: 'normal' });
  assert.strictEqual(e.round, 1); assert.strictEqual(e.phase, 'show');
  assert.strictEqual(e.lives, 3); assert.strictEqual(n.lives, 2);
  assert.deepStrictEqual(e.slots, [0, 1, 2]);
  assert.ok(e.ball >= 0 && e.ball < 3);
});

test('same seed gives the same shuffle', () => {
  const a = L.newGame(L.rng(5), { level: 'normal' }), b = L.newGame(L.rng(5), { level: 'normal' });
  assert.deepStrictEqual(a.swaps, b.swaps); assert.strictEqual(a.ball, b.ball);
});

test('phases run in order: show, down, shuffle, pick', () => {
  const st = fresh(); const seen = [st.phase];
  for (let i = 0; i < 20000 && st.phase !== 'pick'; i++) { L.step(st, 1 / 60); if (seen[seen.length - 1] !== st.phase) seen.push(st.phase); }
  assert.deepStrictEqual(seen, ['show', 'down', 'shuffle', 'pick']);
});

test('swaps: valid slots, disjoint pairs when doubled, and the ball moves at least twice', () => {
  // 실제 라운드들을 만들어 검사: 맞히며 넘어가기
  for (const level of ['easy', 'normal']) {
    const st = L.newGame(L.rng(11), { level });
    for (let r = 1; r <= 14; r++) {
      assert.strictEqual(st.round, r);
      let movedBall = 0, slot = st.ball;
      for (const pairs of st.swaps) {
        const flat = pairs.flat(); assert.strictEqual(new Set(flat).size, flat.length, 'pairs in one swap are disjoint');
        for (const [a, b] of pairs) { assert.ok(a >= 0 && b < st.n && a < b); if (slot === a) { slot = b; movedBall++; } else if (slot === b) { slot = a; movedBall++; } }
      }
      assert.ok(movedBall >= 2, `${level} round ${r}: ball moved ${movedBall}`);
      assert.strictEqual(slot, st.finalBallSlot);
      toPick(st);
      assert.strictEqual(ballSlot(st), st.finalBallSlot, 'the simulated swaps match the real ones');
      assert.deepStrictEqual([...st.slots].sort(), Array.from({ length: st.n }, (_, i) => i), 'slots stay a permutation');
      L.pick(st, ballSlot(st));
      for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60);
    }
  }
});

test('picking the right cup scores and moves to the next round', () => {
  const st = fresh(); toPick(st); clearEv(st);
  assert.strictEqual(L.pick(st, ballSlot(st)), true);
  assert.strictEqual(st.correct, true);
  assert.strictEqual(st.score, 10 * 1 + 5 * 1);
  assert.strictEqual(st.cleared, 1);
  assert.ok(clearEv(st).some((e) => e.type === 'pick' && e.correct));
  for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.round, 2); assert.strictEqual(st.phase, 'show');
  assert.strictEqual(st.lives, 2);
});

test('a streak raises the score; a wrong pick resets it and costs a life but repeats the round', () => {
  const st = fresh({ level: 'easy' });
  let expected = 0;
  for (let r = 1; r <= 3; r++) { toPick(st); expected += 10 * r + 5 * r; L.pick(st, ballSlot(st)); for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60); }
  assert.strictEqual(st.score, expected);
  toPick(st); const wrong = (ballSlot(st) + 1) % st.n;
  L.pick(st, wrong); assert.strictEqual(st.correct, false); assert.strictEqual(st.streak, 0); assert.strictEqual(st.lives, 2);
  for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.round, 4, 'the round is repeated');
  assert.strictEqual(st.over, false);
});

test('running out of lives ends the game', () => {
  const st = fresh({ level: 'normal' });
  for (let k = 0; k < 2; k++) { toPick(st); L.pick(st, (ballSlot(st) + 1) % st.n); for (let i = 0; i < 200 && st.phase === 'result' && !st.over; i++) L.step(st, 1 / 60); }
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.lives, 0);
  assert.ok(clearEv(st).some((e) => e.type === 'over'));
  assert.strictEqual(L.pick(st, 0), false);
});

test('picking is ignored before the shuffle ends and after choosing', () => {
  const st = fresh();
  assert.strictEqual(L.pick(st, 0), false);
  for (let i = 0; i < 60 * 3; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.phase, 'shuffle'); assert.strictEqual(L.pick(st, 0), false);
  toPick(st);
  assert.strictEqual(L.pick(st, 99), false); assert.strictEqual(L.pick(st, -1), false);
  assert.strictEqual(L.pick(st, 0), true); assert.strictEqual(L.pick(st, 1), false);
});

test('normal has a pick time limit that counts as a wrong answer; easy waits forever', () => {
  const n = fresh({ level: 'normal' }); toPick(n);
  for (let i = 0; i < 60 * 7; i++) L.step(n, 1 / 60);
  assert.strictEqual(n.phase, 'pick');
  for (let i = 0; i < 60 * 2; i++) L.step(n, 1 / 60);
  assert.strictEqual(n.phase, 'result'); assert.strictEqual(n.correct, false); assert.strictEqual(n.lives, 1);
  assert.ok(clearEv(n).some((e) => e.type === 'pick' && e.timeout));
  const e = fresh({ level: 'easy' }); toPick(e);
  for (let i = 0; i < 60 * 60; i++) L.step(e, 1 / 60);
  assert.strictEqual(e.phase, 'pick');
});

test('step with a huge dt gives the same result as many small steps', () => {
  const a = L.newGame(L.rng(3), { level: 'easy' }), b = L.newGame(L.rng(3), { level: 'easy' });
  for (let i = 0; i < 60 * 12; i++) L.step(a, 1 / 60);
  L.step(b, 12);
  assert.strictEqual(a.phase, b.phase);
  assert.deepStrictEqual(a.slots, b.slots);
});

test('tutorial mode: three cups, slow short shuffle, no life lost, no time limit', () => {
  const st = L.newGame(L.rng(2), { level: 'normal', tutorial: true });
  assert.strictEqual(st.n, 3); assert.strictEqual(st.swaps.length, 4); assert.ok(st.dur >= 0.8);
  toPick(st);
  for (let i = 0; i < 60 * 30; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.phase, 'pick', 'no time limit');
  L.pick(st, (ballSlot(st) + 1) % st.n);
  assert.strictEqual(st.lives, st.params.lives);
  for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.over, false); assert.strictEqual(st.round, 1);
});

test('events: round, swap and swapEnd fire in order for every swap', () => {
  const st = fresh({ level: 'easy' }); const ev = [];
  for (let i = 0; i < 20000 && st.phase !== 'pick'; i++) { L.step(st, 1 / 60); ev.push(...clearEv(st)); }
  const swaps = ev.filter((e) => e.type === 'swap'), ends = ev.filter((e) => e.type === 'swapEnd');
  assert.strictEqual(swaps.length, st.swaps.length); assert.strictEqual(ends.length, st.swaps.length);
  swaps.forEach((e, i) => { assert.strictEqual(e.si, i); assert.strictEqual(ends[i].si, i); });
  assert.ok(ev.some((e) => e.type === 'round'));
});
