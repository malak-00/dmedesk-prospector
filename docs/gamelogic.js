/* The rules of Caro's little games, kept separate from the screen so they can be tested on their own
   (worker/test/gamelogic.test.js). Nothing here touches the page. */
(function (root) {
  "use strict";

  // A small seedable random number generator (mulberry32), so a test can fix the "random" choices.
  function seeded(seed) {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pickIndex = (n, rng) => Math.floor(rng() * n);
  function shuffled(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = pickIndex(i + 1, rng);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- sliding picture: tiles 1..n*n-1 and a blank (0), solved when in order with the blank last ---------- */

  const slideSolved = (n) => Array.from({ length: n * n }, (_, i) => (i + 1) % (n * n));
  const isSlideSolved = (state, n) => state.every((v, i) => v === (i + 1) % (n * n));

  // Tiles next to the blank, which are the ones that can slide into it.
  function slideMovable(state, n) {
    const blank = state.indexOf(0);
    const r = Math.floor(blank / n);
    const c = blank % n;
    const out = [];
    if (r > 0) out.push(blank - n);
    if (r < n - 1) out.push(blank + n);
    if (c > 0) out.push(blank - 1);
    if (c < n - 1) out.push(blank + 1);
    return out;
  }

  function slideMove(state, n, index) {
    if (!slideMovable(state, n).includes(index)) return state;
    const next = state.slice();
    const blank = next.indexOf(0);
    [next[blank], next[index]] = [next[index], next[blank]];
    return next;
  }

  // Mixed by making legal moves from the solved picture, so it can always be solved (and never starts solved).
  function slideShuffle(n, steps, rng) {
    let state = slideSolved(n);
    let previous = -1;
    for (let i = 0; i < steps; i += 1) {
      const options = slideMovable(state, n).filter((m) => m !== previous);
      const move = options[pickIndex(options.length, rng)];
      previous = state.indexOf(0);
      state = slideMove(state, n, move);
    }
    return isSlideSolved(state, n) ? slideShuffle(n, steps + 1, rng) : state;
  }

  /* ---------- memory match ---------- */

  const memoryDeck = (pairs, rng) => shuffled(Array.from({ length: pairs * 2 }, (_, i) => i % pairs), rng);

  /* ---------- tic-tac-toe: the player is X and moves first; Caro is O ---------- */

  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  function tttWinner(board) {
    for (const [a, b, c] of LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    return board.every(Boolean) ? "draw" : null;
  }

  // Best score for O from this position (+1 O wins, -1 X wins, 0 draw), taking turns.
  const seen = new Map(); // positions already scored, so each is worked out once
  function minimax(board, turn) {
    const key = board.map((c) => c || "-").join("") + turn;
    if (seen.has(key)) return seen.get(key);
    const result = minimaxScore(board, turn);
    seen.set(key, result);
    return result;
  }
  function minimaxScore(board, turn) {
    const w = tttWinner(board);
    if (w === "O") return 1;
    if (w === "X") return -1;
    if (w === "draw") return 0;
    const scores = [];
    board.forEach((cell, i) => {
      if (cell) return;
      const next = board.slice();
      next[i] = turn;
      scores.push(minimax(next, turn === "O" ? "X" : "O"));
    });
    return turn === "O" ? Math.max(...scores) : Math.min(...scores);
  }

  // Caro's move: usually the best one, but with some chance she slips, so she can be beaten.
  function tttCaroMove(board, rng, slip = 0.25) {
    const empty = board.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
    if (rng() < slip) return empty[pickIndex(empty.length, rng)];
    let best = -2;
    let moves = [];
    for (const i of empty) {
      const next = board.slice();
      next[i] = "O";
      const score = minimax(next, "X");
      if (score > best) { best = score; moves = [i]; } else if (score === best) moves.push(i);
    }
    return moves[pickIndex(moves.length, rng)];
  }

  /* ---------- odd one out ---------- */

  // A grid of `cells` copies of one symbol with a single different one hidden among them.
  function oddRound(cells, symbolCount, rng) {
    const base = pickIndex(symbolCount, rng);
    let odd = pickIndex(symbolCount - 1, rng);
    if (odd >= base) odd += 1;
    return { base, odd, oddIndex: pickIndex(cells, rng), cells };
  }

  /* ---------- pattern memory (Simon): the sequence grows by one random pad each round ---------- */

  const simonNext = (sequence, pads, rng) => sequence.concat(pickIndex(pads, rng));

  /* ---------- perfect timing: a marker sweeps a bar, stop it inside the zone ---------- */

  // The zone gets narrower each round (round 0 is the widest). position and centre are 0 to 1.
  const timingZone = (round, rng) => {
    const width = Math.max(0.1, 0.3 - round * 0.05);
    return { width, centre: 0.15 + width / 2 + rng() * (0.7 - width) };
  };
  const timingHit = (position, zone) => Math.abs(position - zone.centre) <= zone.width / 2;

  /* ---------- catch the stars: where the next star appears (percent of the play area) ---------- */

  const catchSpot = (rng) => ({ x: 8 + rng() * 78, y: 8 + rng() * 72 });

  const api = {
    seeded, shuffled, slideSolved, isSlideSolved, slideMovable, slideMove, slideShuffle, memoryDeck,
    tttWinner, tttCaroMove, oddRound, simonNext, timingZone, timingHit, catchSpot,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.dmeGameLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
