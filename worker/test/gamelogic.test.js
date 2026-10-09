import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g = require('../../docs/gamelogic.js');

test('the same seed gives the same sequence, so tests can fix "random" choices', () => {
  const a = g.seeded(7);
  const b = g.seeded(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(g.seeded(7)(), g.seeded(8)());
});

test('a sliding picture is only a legal mix of the solved one, so it can always be solved', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const rng = g.seeded(seed);
    const state = g.slideShuffle(3, 40, rng);
    assert.deepEqual(state.slice().sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(g.isSlideSolved(state, 3), false);
    // Undoing the mix is possible: it was built from legal moves, so a path back exists (checked by solved parity).
    const inversions = state.filter(Boolean).reduce((n, v, i, all) => n + all.slice(i + 1).filter((w) => w < v).length, 0);
    assert.equal(inversions % 2, 0); // an odd count would be unsolvable on a 3x3
  }
});

test('only tiles next to the blank slide, and sliding swaps them', () => {
  const solved = g.slideSolved(3); // 1 2 3 / 4 5 6 / 7 8 blank
  assert.deepEqual(solved, [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  assert.deepEqual(g.slideMovable(solved, 3).sort(), [5, 7]);
  assert.deepEqual(g.slideMove(solved, 3, 0), solved); // far away: nothing happens
  const moved = g.slideMove(solved, 3, 7);
  assert.deepEqual(moved, [1, 2, 3, 4, 5, 6, 7, 0, 8]);
  assert.equal(g.isSlideSolved(moved, 3), false);
  assert.equal(g.isSlideSolved(g.slideMove(moved, 3, 8), 3), true);
});

test('a memory deck has every picture exactly twice', () => {
  const deck = g.memoryDeck(6, g.seeded(3));
  assert.equal(deck.length, 12);
  for (let i = 0; i < 6; i += 1) assert.equal(deck.filter((x) => x === i).length, 2);
});

test('tic-tac-toe finds wins and draws', () => {
  assert.equal(g.tttWinner(['X', 'X', 'X', null, 'O', 'O', null, null, null]), 'X');
  assert.equal(g.tttWinner(['O', 'X', null, 'O', 'X', null, 'O', null, null]), 'O');
  assert.equal(g.tttWinner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), 'draw');
  assert.equal(g.tttWinner(Array(9).fill(null)), null);
});

test('Caro blocks, takes a win, and sometimes slips', () => {
  // O to move: take the win at 2.
  assert.equal(g.tttCaroMove(['O', 'O', null, 'X', 'X', null, null, null, null], g.seeded(1), 0), 2);
  // X threatens 0-1-2; O has no win of its own, so it blocks at 2.
  assert.equal(g.tttCaroMove(['X', 'X', null, null, 'O', null, null, null, null], g.seeded(1), 0), 2);
  // With slip = 1 she always plays some empty square.
  const empty = [null, 'X', null, null, 'O', null, null, null, null];
  for (let seed = 1; seed < 20; seed += 1) assert.equal(empty[g.tttCaroMove(empty, g.seeded(seed), 1)], null);
});

test('she cannot be beaten when she never slips, but a slip can lose her the game', () => {
  const play = (slip, seed) => {
    const rng = g.seeded(seed);
    let board = Array(9).fill(null);
    let turn = 'X';
    while (!g.tttWinner(board)) {
      const empty = board.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
      const i = turn === 'X' ? empty[Math.floor(rng() * empty.length)] : g.tttCaroMove(board, rng, slip);
      board = board.slice();
      board[i] = turn;
      turn = turn === 'X' ? 'O' : 'X';
    }
    return g.tttWinner(board);
  };
  let xWinsWithoutSlip = 0;
  let xWinsWithSlip = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    if (play(0, seed) === 'X') xWinsWithoutSlip += 1;
    if (play(0.4, seed) === 'X') xWinsWithSlip += 1;
  }
  assert.equal(xWinsWithoutSlip, 0); // random play never beats perfect play
  assert.ok(xWinsWithSlip > 0);
});

test('an odd-one-out round hides one different symbol among the rest', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const r = g.oddRound(16, 8, g.seeded(seed));
    assert.notEqual(r.base, r.odd);
    assert.ok(r.base >= 0 && r.base < 8 && r.odd >= 0 && r.odd < 8);
    assert.ok(r.oddIndex >= 0 && r.oddIndex < 16);
  }
});

test('the pattern grows by one pad a round, and the timing zone narrows', () => {
  let seq = [];
  const rng = g.seeded(5);
  for (let i = 0; i < 5; i += 1) seq = g.simonNext(seq, 4, rng);
  assert.equal(seq.length, 5);
  assert.ok(seq.every((p) => p >= 0 && p < 4));
  const rngZ = g.seeded(2);
  const widths = [0, 1, 2, 3, 4].map((r) => g.timingZone(r, rngZ).width);
  assert.ok(widths.every((w, i) => i === 0 || w <= widths[i - 1]));
  assert.ok(widths[4] >= 0.1);
  const zone = { width: 0.2, centre: 0.5 };
  assert.equal(g.timingHit(0.55, zone), true);
  assert.equal(g.timingHit(0.65, zone), false);
  for (let seed = 1; seed < 30; seed += 1) {
    const z = g.timingZone(0, g.seeded(seed));
    assert.ok(z.centre - z.width / 2 >= 0.1 && z.centre + z.width / 2 <= 0.9);
  }
});

test('a star always appears inside the play area', () => {
  for (let seed = 1; seed < 50; seed += 1) {
    const s = g.catchSpot(g.seeded(seed));
    assert.ok(s.x >= 8 && s.x <= 86 && s.y >= 8 && s.y <= 80);
  }
});
