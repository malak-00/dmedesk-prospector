/* Caro's little games, played in a window over the app (the screen side; the rules are in gamelogic.js).
   Seven short ones: memory match, a sliding picture of Caro, copy the pattern, catch the stars, perfect timing,
   tic-tac-toe against Caro, and odd one out. dmeGames.play(id, onFinish) opens one; onFinish({ id, won, label })
   is called when it ends. Loaded after gamelogic.js and before buddy-fun.js, which picks the game of the day. */
(function () {
  "use strict";

  const L = window.dmeGameLogic;
  if (!L) return;

  const GAMES = [
    { id: "memory", title: "Memory match", blurb: "Find all six pairs.", icon: "sparkle" },
    { id: "slide", title: "Slide the picture", blurb: "Put Caro back together.", icon: "puzzle" },
    { id: "simon", title: "Copy the pattern", blurb: "Repeat the lights. Reach round 6.", icon: "bolt" },
    { id: "catch", title: "Catch the stars", blurb: "20 seconds. Catch 12.", icon: "target" },
    { id: "timing", title: "Perfect timing", blurb: "Stop the marker in the zone, 3 times out of 5.", icon: "bell" },
    { id: "ttt", title: "Tic-tac-toe vs Caro", blurb: "Win or draw.", icon: "megaphone" },
    { id: "odd", title: "Odd one out", blurb: "Spot the different icon. Find 8 in 30 seconds.", icon: "flame" },
  ];
  const SYMBOLS = ["heart", "bolt", "trophy", "target", "sparkle", "flame", "bell", "sun"];
  const rand = Math.random;

  let overlay = null;
  let stage = null;
  let token = 0; // bumped when a game ends or is closed, so late timers do nothing
  let timers = [];
  let raf = 0;
  let finishCb = null;
  let currentId = "";

  const later = (fn, ms) => {
    const mine = token;
    const id = setTimeout(() => { if (mine === token) fn(); }, ms);
    timers.push(id);
    return id;
  };
  function stopTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(raf);
  }

  function close() {
    token += 1;
    stopTimers();
    if (overlay) { overlay.remove(); overlay = null; }
    stage = null;
    document.documentElement.classList.remove("game-open");
  }

  /* ---------- the window ---------- */

  function frame(game) {
    close();
    overlay = document.createElement("div");
    overlay.className = "bg-overlay";
    overlay.innerHTML = `
      <div class="bg-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(game.title)}">
        <div class="bg-head"><div><div class="bg-title">${escapeHtml(game.title)}</div><div class="bg-blurb">${escapeHtml(game.blurb)}</div></div>
          <button type="button" class="btn btn-ghost btn-small" data-bg="close">Close</button></div>
        <div class="bg-stage" id="bgStage"></div>
      </div>`;
    document.body.append(overlay);
    document.documentElement.classList.add("game-open");
    stage = overlay.querySelector("#bgStage");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest('[data-bg="close"]')) close();
      else if (e.target.closest('[data-bg="again"]')) play(currentId, finishCb);
    });
  }

  function finish(result) {
    if (!stage) return;
    token += 1; // anything still scheduled is cancelled
    stopTimers();
    const won = Boolean(result.won);
    stage.innerHTML = `<div class="bg-result ${won ? "is-won" : ""}">
      <div class="bg-result-title">${escapeHtml(won ? (result.title || "Nice one!") : "So close!")}</div>
      <div class="bg-result-label">${escapeHtml(result.label || "")}</div>
      <div class="bg-result-actions"><button type="button" class="btn btn-primary" data-bg="again">Play again</button><button type="button" class="btn btn-ghost" data-bg="close">Done</button></div>
    </div>`;
    if (won && window.dmeBuddy && window.dmeBuddy.api) window.dmeBuddy.api.confetti(stage);
    if (finishCb) finishCb({ id: currentId, won, label: result.label || "" });
  }

  /* ---------- the games ---------- */

  const GAME = {
    memory() {
      const icons = ["heart", "bolt", "trophy", "target", "sparkle", "flame"];
      const deck = L.memoryDeck(6, rand);
      let open = [];
      let moves = 0;
      let matched = 0;
      let lock = false;
      stage.innerHTML = `<div class="bg-status"><span>Moves: <strong id="bgMoves">0</strong></span></div>
        <div class="bg-memory">${deck.map((p, i) => `<button type="button" class="bg-tile" data-i="${i}" aria-label="Card ${i + 1}"><span class="bg-face" style="color:hsl(${p * 55 + 190} 55% 52%)">${uiIcon(icons[p])}</span></button>`).join("")}</div>`;
      stage.querySelector(".bg-memory").addEventListener("click", (e) => {
        const tile = e.target.closest(".bg-tile");
        if (!tile || lock || tile.classList.contains("is-up") || tile.classList.contains("is-done")) return;
        tile.classList.add("is-up");
        open.push(tile);
        if (open.length < 2) return;
        moves += 1;
        stage.querySelector("#bgMoves").textContent = moves;
        const [a, b] = open;
        open = [];
        if (deck[a.dataset.i] === deck[b.dataset.i]) {
          a.classList.add("is-done"); b.classList.add("is-done");
          matched += 1;
          if (matched === 6) later(() => finish({ won: true, label: `Done in ${moves} moves` }), 450);
        } else {
          lock = true;
          later(() => { a.classList.remove("is-up"); b.classList.remove("is-up"); lock = false; }, 700);
        }
      });
    },

    slide() {
      const poses = ["wave", "thumbs", "party", "thinking", "note", "phone", "wink"];
      const api = window.dmeBuddy && window.dmeBuddy.api;
      const file = api && api.POSES ? api.POSES[poses[Math.floor(rand() * poses.length)]] : "bd-wave.webp";
      const url = `avatar/${file}`;
      let state = L.slideShuffle(3, 60, rand);
      let moves = 0;
      const draw = () => {
        stage.innerHTML = `<div class="bg-status"><span>Moves: <strong>${moves}</strong></span><img class="bg-peek" src="${url}" alt="" title="The finished picture"></div>
          <div class="bg-slide">${state.map((v, i) => v === 0
            ? '<span class="bg-blank"></span>'
            : `<button type="button" class="bg-slice" data-i="${i}" aria-label="Piece ${v}" style="background-image:url(${url});background-position:${((v - 1) % 3) * 50}% ${Math.floor((v - 1) / 3) * 50}%"></button>`).join("")}</div>`;
      };
      draw();
      stage.addEventListener("click", (e) => {
        const piece = e.target.closest(".bg-slice");
        if (!piece) return;
        const next = L.slideMove(state, 3, Number(piece.dataset.i));
        if (next === state) return;
        state = next;
        moves += 1;
        draw();
        if (L.isSlideSolved(state, 3)) later(() => finish({ won: true, label: `Solved in ${moves} moves` }), 400);
      });
    },

    simon() {
      let seq = [];
      let pos = 0;
      let waiting = false;
      const colours = ["var(--accent)", "var(--score-high, #2eb872)", "var(--score-mid, #d9a21b)", "var(--score-low, #e2695c)"];
      stage.innerHTML = `<div class="bg-status"><span id="bgRound">Get ready</span></div>
        <div class="bg-simon">${colours.map((c, i) => `<button type="button" class="bg-pad" data-p="${i}" style="--c:${c}" aria-label="Pad ${i + 1}"></button>`).join("")}</div>`;
      const pads = [...stage.querySelectorAll(".bg-pad")];
      const flash = (i) => { pads[i].classList.add("is-lit"); later(() => pads[i].classList.remove("is-lit"), 320); };
      const round = () => {
        seq = L.simonNext(seq, 4, rand);
        pos = 0;
        waiting = false;
        stage.querySelector("#bgRound").textContent = `Round ${seq.length} of 6: watch`;
        seq.forEach((p, k) => later(() => flash(p), 700 + k * 600));
        later(() => { waiting = true; stage.querySelector("#bgRound").textContent = `Round ${seq.length} of 6: your turn`; }, 700 + seq.length * 600);
      };
      stage.querySelector(".bg-simon").addEventListener("click", (e) => {
        const pad = e.target.closest(".bg-pad");
        if (!pad || !waiting) return;
        const p = Number(pad.dataset.p);
        flash(p);
        if (seq[pos] !== p) { waiting = false; later(() => finish({ won: false, label: `You reached round ${seq.length}` }), 500); return; }
        pos += 1;
        if (pos === seq.length) {
          waiting = false;
          if (seq.length >= 6) later(() => finish({ won: true, label: "All six rounds" }), 500);
          else later(round, 800);
        }
      });
      later(round, 500);
    },

    catch() {
      let score = 0;
      const total = 20000;
      const started = Date.now();
      stage.innerHTML = `<div class="bg-status"><span>Stars: <strong id="bgScore">0</strong> / 12</span></div>
        <div class="bg-timebar"><span id="bgTime" style="width:100%"></span></div>
        <div class="bg-arena" id="bgArena"></div>`;
      const arena = stage.querySelector("#bgArena");
      const spawn = () => {
        if (Date.now() - started >= total) return;
        const spot = L.catchSpot(rand);
        const star = document.createElement("button");
        star.type = "button";
        star.className = "bg-star";
        star.setAttribute("aria-label", "Star");
        star.style.left = `${spot.x}%`;
        star.style.top = `${spot.y}%`;
        star.innerHTML = uiIcon("sparkle");
        arena.append(star);
        const life = Math.max(520, 950 - score * 22);
        later(() => { if (star.isConnected) { star.remove(); later(spawn, 180); } }, life);
        star.addEventListener("click", () => {
          if (!star.isConnected) return;
          star.remove();
          score += 1;
          stage.querySelector("#bgScore").textContent = score;
          if (score >= 12) { later(() => finish({ won: true, label: `${score} stars, with ${Math.max(0, Math.round((total - (Date.now() - started)) / 1000))} s to spare` }), 250); return; }
          later(spawn, 120);
        });
      };
      const tick = () => {
        const left = Math.max(0, total - (Date.now() - started));
        const bar = stage.querySelector("#bgTime");
        if (bar) bar.style.width = `${(left / total) * 100}%`;
        if (left <= 0) finish({ won: score >= 12, label: `${score} star${score === 1 ? "" : "s"} caught` });
        else later(tick, 100);
      };
      spawn();
      tick();
    },

    timing() {
      let round = 0;
      let hits = 0;
      let zone = L.timingZone(0, rand);
      let t0 = performance.now();
      let position = 0;
      let stopped = false;
      stage.innerHTML = `<div class="bg-status"><span id="bgTRound">Round 1 of 5</span><span>Hits: <strong id="bgHits">0</strong></span></div>
        <div class="bg-track" id="bgTrack"><span class="bg-zone" id="bgZone"></span><span class="bg-marker" id="bgMarker"></span></div>
        <div class="bg-center"><button type="button" class="btn btn-primary" id="bgStop">Stop!</button></div>
        <div class="bg-note" id="bgTNote">Stop the marker inside the green zone.</div>`;
      const zoneEl = stage.querySelector("#bgZone");
      const marker = stage.querySelector("#bgMarker");
      const note = stage.querySelector("#bgTNote");
      const place = () => { zoneEl.style.left = `${(zone.centre - zone.width / 2) * 100}%`; zoneEl.style.width = `${zone.width * 100}%`; };
      place();
      const step = (now) => {
        if (stopped || !stage) return;
        const speed = 0.9 + round * 0.25; // sweeps per second
        const phase = (((now - t0) / 1000) * speed) % 2;
        position = phase <= 1 ? phase : 2 - phase;
        marker.style.left = `${position * 100}%`;
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      const stop = () => {
        if (stopped) return;
        stopped = true;
        const hit = L.timingHit(position, zone);
        if (hit) hits += 1;
        stage.querySelector("#bgHits").textContent = hits;
        note.textContent = hit ? "In the zone!" : "Just missed.";
        note.className = `bg-note ${hit ? "is-good" : "is-bad"}`;
        round += 1;
        if (round >= 5) { later(() => finish({ won: hits >= 3, label: `${hits} of 5 in the zone` }), 800); return; }
        later(() => {
          zone = L.timingZone(round, rand);
          place();
          stopped = false;
          t0 = performance.now();
          stage.querySelector("#bgTRound").textContent = `Round ${round + 1} of 5`;
          note.textContent = "Stop the marker inside the green zone.";
          note.className = "bg-note";
          raf = requestAnimationFrame(step);
        }, 900);
      };
      stage.querySelector("#bgStop").addEventListener("click", stop);
      stage.querySelector("#bgStop").focus();
    },

    ttt() {
      let board = Array(9).fill(null);
      let busy = false;
      const draw = () => {
        stage.innerHTML = `<div class="bg-status"><span>You are X. Caro is O.</span></div>
          <div class="bg-ttt">${board.map((c, i) => `<button type="button" class="bg-cell" data-i="${i}" ${c ? "disabled" : ""}>${c || ""}</button>`).join("")}</div>`;
      };
      const check = () => {
        const w = L.tttWinner(board);
        if (!w) return false;
        later(() => finish(w === "X" ? { won: true, label: "You beat Caro" } : w === "draw" ? { won: true, label: "A draw. Well played", title: "Nicely held!" } : { won: false, label: "Caro got that one" }), 500);
        return true;
      };
      draw();
      stage.addEventListener("click", (e) => {
        const cell = e.target.closest(".bg-cell");
        if (!cell || busy) return;
        const i = Number(cell.dataset.i);
        if (board[i]) return;
        board = board.slice(); board[i] = "X";
        draw();
        if (check()) return;
        busy = true;
        later(() => {
          board = board.slice(); board[L.tttCaroMove(board, rand, 0.25)] = "O";
          busy = false;
          draw();
          check();
        }, 450);
      });
    },

    odd() {
      let score = 0;
      let left = 30000;
      let last = Date.now();
      let round = null;
      const draw = () => {
        round = L.oddRound(16, SYMBOLS.length, rand);
        stage.querySelector("#bgOdd").innerHTML = Array.from({ length: 16 }, (_, i) => `<button type="button" class="bg-sym" data-i="${i}" aria-label="Icon ${i + 1}">${uiIcon(SYMBOLS[i === round.oddIndex ? round.odd : round.base])}</button>`).join("");
      };
      stage.innerHTML = `<div class="bg-status"><span>Found: <strong id="bgScore">0</strong> / 8</span><span id="bgPenalty"></span></div>
        <div class="bg-timebar"><span id="bgTime" style="width:100%"></span></div>
        <div class="bg-odd" id="bgOdd"></div>`;
      draw();
      stage.querySelector("#bgOdd").addEventListener("click", (e) => {
        const sym = e.target.closest(".bg-sym");
        if (!sym) return;
        if (Number(sym.dataset.i) === round.oddIndex) {
          score += 1;
          stage.querySelector("#bgScore").textContent = score;
          if (score >= 8) { later(() => finish({ won: true, label: `Found 8 with ${Math.max(0, Math.round(left / 1000))} s to spare` }), 250); return; }
          draw();
        }
        else { left -= 3000; const p = stage.querySelector("#bgPenalty"); p.textContent = "-3 s"; later(() => { p.textContent = ""; }, 700); }
      });
      const tick = () => {
        const now = Date.now();
        left -= now - last;
        last = now;
        const bar = stage.querySelector("#bgTime");
        if (bar) bar.style.width = `${Math.max(0, left / 30000) * 100}%`;
        if (left <= 0) finish({ won: score >= 8, label: `${score} found` });
        else later(tick, 100);
      };
      tick();
    },
  };

  function play(id, onFinish) {
    const game = GAMES.find((g) => g.id === id);
    if (!game || !GAME[id]) return;
    currentId = id;
    finishCb = onFinish || null;
    frame(game);
    GAME[id]();
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay) { e.stopPropagation(); close(); } }, true);

  window.dmeGames = { list: GAMES, play, close, isOpen: () => Boolean(overlay) };
})();
