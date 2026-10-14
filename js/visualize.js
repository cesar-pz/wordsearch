// Algorithm visualizer: replays Puzzle.generate() step by step from the
// trace it emits, so what students watch is exactly how the grid was built.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HUES = [230, 145, 32, 285, 350, 185, 50, 260, 10, 100, 320, 200];
  const hl = (k) => `hsl(${HUES[k % HUES.length]} 80% 52%)`;

  const ARROW = { '0,1': '→', '1,0': '↓', '1,1': '↘', '-1,1': '↗', '0,-1': '←', '-1,0': '↑', '-1,-1': '↖', '1,-1': '↙' };
  const arrow = (p) => ARROW[`${p.dr},${p.dc}`];
  const at = (p) => `row ${p.r + 1}, col ${p.c + 1}`;
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  // Pseudocode line numbers (see #v-code in index.html).
  const L = { sort: 0, word: 1, scan: 2, clash: 4, fits: 5, skip: 6, roll: 7, write: 8, retry: 9, fill: 10 };

  // Milliseconds each step is held for at 1× speed. A word's whole scan and
  // the whole fill take a fixed time however many cells are involved.
  const MS = {
    begin: 3200, attempt: 1600, word: 1100, scan: 2800, scanned: 2200, skip: 2400,
    choose: 2600, letter: 120, placed: 500, retryEnd: 2600, okEnd: 1200, fillStart: 1800, fill: 2200,
  };
  // Steps that "Step ›" stops after.
  const KEY = new Set(['begin', 'attempt', 'word', 'scanned', 'skip', 'choose', 'placed', 'attempt-end', 'fill-start', 'done']);

  let puzzle = null;
  let timeline = [];
  let pos = 0;        // next timeline step to apply
  let hold = 0;       // ms left before applying the next step
  let playing = false;
  let speed = 1;
  let rafId = null;
  let lastTime = null;
  let st = null;      // what's on screen
  let cells = [];

  // Turn the raw trace into timed steps; placing a word becomes one step per letter.
  function buildTimeline(events) {
    const out = [];
    let checkMs = 0;
    let fillMs = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'begin': out.push({ ...e, ms: MS.begin }); break;
        case 'attempt': out.push({ ...e, ms: e.n === 1 ? 0 : MS.attempt }); break;
        case 'word': {
          let checks = 0;
          for (let j = i + 1; j < events.length && events[j].type === 'check'; j++) checks++;
          checkMs = checks ? MS.scan / checks : 0;
          out.push({ ...e, ms: MS.word });
          break;
        }
        case 'check': out.push({ ...e, ms: checkMs }); break;
        case 'scanned': out.push({ ...e, ms: e.candidates.length ? MS.scanned : 600 }); break;
        case 'choose': out.push({ ...e, ms: MS.choose }); break;
        case 'place':
          [...e.word].forEach((ch, k) => out.push({ type: 'letter', word: e.word, ch, r: e.r + e.dr * k, c: e.c + e.dc * k, ms: MS.letter }));
          out.push({ ...e, type: 'placed', ms: MS.placed });
          break;
        case 'skip': out.push({ ...e, ms: MS.skip }); break;
        case 'attempt-end': out.push({ ...e, ms: e.skipped.length ? MS.retryEnd : MS.okEnd }); break;
        case 'fill-start': {
          const empty = e.grid.filter((ch) => ch === null).length;
          fillMs = empty ? MS.fill / empty : 0;
          out.push({ ...e, empty, ms: MS.fillStart });
          break;
        }
        case 'fill': out.push({ ...e, ms: fillMs }); break;
        case 'done': out.push({ ...e, ms: 0 }); break;
      }
    }
    return out;
  }

  function freshState() {
    const n = puzzle.size * puzzle.size;
    return {
      order: [],
      status: {},        // word -> 'current' | 'placed' | 'skipped'
      color: {},         // word -> index into HUES
      grid: new Array(n).fill(null),
      owner: new Array(n).fill(-1),
      shared: new Set(), // cells where two words cross
      filler: new Array(n).fill(false),
      heat: new Array(n).fill(0),
      ghost: null,       // placement currently being checked
      pool: null,        // candidates the pick is made from
      pick: null,
      placed: [],        // { r, c, dr, dc, len, color }
      word: null,
      attempt: 1,
      checked: 0, fits: 0, cross: 0,
      line: -1,
      text: '',
    };
  }

  function apply(e) {
    const n = puzzle.size;
    switch (e.type) {
      case 'begin':
        st.order = e.order;
        e.order.forEach((w, i) => { st.color[w] = i; });
        st.line = L.sort;
        st.text = `First, sort the ${plural(e.order.length, 'word')} from longest to shortest. Long words are the hardest to fit, so they go in while the grid is still empty.`;
        break;

      case 'attempt':
        if (e.n === 1) break;
        Object.assign(st, freshState(), { order: st.order, color: st.color, attempt: e.n });
        st.line = L.retry;
        st.text = `Attempt ${e.n}: starting again with an empty grid. The random numbers keep going, so this time the words land in different places.`;
        break;

      case 'word':
        st.word = e.word;
        st.status[e.word] = 'current';
        st.heat.fill(0);
        st.ghost = st.pool = st.pick = null;
        st.checked = st.fits = st.cross = 0;
        st.line = L.word;
        st.text = `Next word: ${e.word} (${plural(e.word.length, 'letter')}). Try it in every allowed direction, starting from every cell.`;
        break;

      case 'check': {
        st.checked++;
        st.ghost = { ...e, len: st.word.length };
        if (e.ok) {
          st.fits++;
          if (e.overlaps) st.cross++;
          st.heat[e.r * n + e.c]++;
        }
        st.line = e.ok ? L.fits : L.clash;
        let why;
        if (e.ok) why = e.overlaps ? `fits, sharing ${plural(e.overlaps, 'letter')} with another word` : 'fits';
        else if (e.clash >= 0) {
          const cr = e.r + e.dr * e.clash;
          const cc = e.c + e.dc * e.clash;
          why = `clash: letter ${e.clash + 1} is ${st.word[e.clash]}, but that cell already has ${st.grid[cr * n + cc]}`;
        } else why = 'it would sit completely on top of another word';
        st.text = `${st.word} ${arrow(e)} from ${at(e)}: ${why}.`;
        break;
      }

      case 'scanned':
        st.ghost = null;
        st.line = L.fits;
        st.text = e.candidates.length
          ? `Checked ${plural(st.checked, 'placement')} that stay on the grid. ${st.fits} fit (green), and ${st.cross} of them cross another word.`
          : `Checked ${plural(st.checked, 'placement')}, and none of them fit.`;
        break;

      case 'skip':
        st.status[e.word] = 'skipped';
        st.ghost = st.pool = st.pick = null;
        st.heat.fill(0);
        st.line = L.skip;
        st.text = e.reason === 'too-long'
          ? `${e.word} is longer than the grid is wide, so it can’t fit anywhere.`
          : `Nowhere left for ${e.word}. It’s left out of this attempt.`;
        break;

      case 'choose': {
        st.pool = e.pool;
        st.pick = e.pick;
        st.line = e.roll === null ? L.write : L.roll;
        let how;
        if (e.roll === null) how = `None of them cross another word, so choose from all ${e.pool.length}.`;
        else if (e.fromCrossing) how = `Random roll ${e.roll.toFixed(2)} is under 0.40, so choose only from the ${e.crossing} that cross. Crossings make the words harder to spot.`;
        else how = `Random roll ${e.roll.toFixed(2)} is 0.40 or more, so choose from all ${e.pool.length}.`;
        st.text = `${how} Picked ${arrow(e.pick)} from ${at(e.pick)}.`;
        break;
      }

      case 'letter': {
        const i = e.r * n + e.c;
        if (st.grid[i] !== null) st.shared.add(i);
        else st.owner[i] = st.color[e.word];
        st.grid[i] = e.ch;
        st.pool = null;
        st.heat.fill(0);
        st.line = L.write;
        st.text = `Writing ${e.word} into the grid.`;
        break;
      }

      case 'placed':
        st.status[e.word] = 'placed';
        st.placed.push({ r: e.r, c: e.c, dr: e.dr, dc: e.dc, len: e.word.length, color: st.color[e.word] });
        st.pick = null;
        st.text = e.overlaps
          ? `${e.word} is in the grid, sharing ${plural(e.overlaps, 'letter')} with another word (circled).`
          : `${e.word} is in the grid.`;
        break;

      case 'attempt-end':
        st.word = null;
        st.ghost = st.pool = st.pick = null;
        if (e.skipped.length) {
          st.line = L.retry;
          st.text = `This attempt left out ${e.skipped.join(', ')}. Wipe the grid and try again (up to 25 attempts).`;
        } else {
          st.line = L.retry;
          st.text = 'Every word found a place!';
        }
        break;

      case 'fill-start':
        st.line = L.fill;
        st.text = `Fill the ${plural(e.empty, 'empty cell')} with random letters so the hidden words blend in.`;
        break;

      case 'fill':
        st.grid[e.i] = e.ch;
        st.filler[e.i] = true;
        break;

      case 'done':
        st.line = -1;
        st.text = `Done! The share link stores only the words, the grid size and the random seed (${puzzle.seed}). Every random number comes from that seed, so each player’s browser repeats these exact steps and builds this same grid.`;
        break;
    }
  }

  // ---- drawing --------------------------------------------------------------

  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function seg(p, len, attrs) {
    return svg('line', {
      x1: p.c + 0.5, y1: p.r + 0.5,
      x2: p.c + p.dc * (len - 1) + 0.5, y2: p.r + p.dr * (len - 1) + 0.5,
      ...attrs,
    });
  }

  function render() {
    const n = puzzle.size;
    for (let i = 0; i < n * n; i++) {
      const el = cells[i];
      const ch = st.grid[i];
      el.textContent = ch ?? '';
      el.className = 'cell'
        + (ch === null ? ' v-empty' : '')
        + (st.filler[i] ? ' v-filler' : '')
        + (st.shared.has(i) ? ' v-shared' : '');
      el.style.color = ch !== null && !st.filler[i] && st.owner[i] >= 0 ? hl(st.owner[i]) : '';
      el.style.background = st.heat[i] ? `rgba(76, 174, 110, ${Math.min(0.12 + st.heat[i] * 0.12, 0.55)})` : '';
    }

    const out = [];
    for (const p of st.placed) {
      out.push(seg(p, p.len, { class: 'v-placed', stroke: hl(p.color), 'stroke-width': 0.78 }));
    }
    if (st.pool) {
      for (const p of st.pool) {
        if (p === st.pick) continue;
        out.push(seg(p, st.word.length, { class: 'v-cand', 'stroke-width': 0.1 }));
      }
    }
    if (st.pick && st.word) {
      out.push(seg(st.pick, st.word.length, { class: 'v-pick', stroke: hl(st.color[st.word]), 'stroke-width': 0.78 }));
    }
    const g = st.ghost;
    if (g) {
      out.push(seg(g, g.len, { class: g.ok ? 'v-ghost ok' : 'v-ghost bad', 'stroke-width': 0.78 }));
      for (let k = 0; k < g.len; k++) {
        const r = g.r + g.dr * k;
        const c = g.c + g.dc * k;
        if (k === g.clash) {
          out.push(svg('circle', { cx: c + 0.5, cy: r + 0.5, r: 0.42, class: 'v-clash' }));
        } else if (st.grid[r * n + c] === null) {
          const t = svg('text', { x: c + 0.5, y: r + 0.53, class: 'v-ghost-letter' });
          t.textContent = st.word[k];
          out.push(t);
        }
      }
    }
    $('v-marks').replaceChildren(...out);

    $('v-words').replaceChildren(...st.order.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      const s = st.status[w];
      if (s) li.className = `v-${s}`;
      if (s === 'placed' || s === 'current') li.style.setProperty('--hl', hl(st.color[w]));
      return li;
    }));

    [...$('v-code').children].forEach((li, i) => li.classList.toggle('active', i === st.line));
    $('v-text').textContent = st.text;
    $('v-attempt').textContent = st.attempt;
    $('v-checked').textContent = st.checked;
    $('v-fit').textContent = st.fits;
    $('v-cross').textContent = st.cross;

    const finished = pos >= timeline.length;
    $('v-play').textContent = finished ? 'Replay' : playing ? 'Pause' : 'Play';
    $('v-step').disabled = finished;
    $('v-end').disabled = finished;
  }

  // ---- playback -------------------------------------------------------------

  function advance(budget) {
    while (true) {
      if (hold > budget) { hold -= budget; return; }
      budget -= hold;
      hold = 0;
      if (pos >= timeline.length) { pause(); return; }
      const e = timeline[pos++];
      apply(e);
      hold = e.ms;
    }
  }

  function frame(t) {
    rafId = null;
    if (!playing) return;
    const dt = lastTime === null ? 0 : Math.min(t - lastTime, 100);
    lastTime = t;
    advance(dt * speed);
    render();
    if (playing) rafId = requestAnimationFrame(frame);
  }

  function play() {
    if (pos >= timeline.length) reset();
    playing = true;
    lastTime = null;
    if (rafId === null) rafId = requestAnimationFrame(frame);
    render();
  }

  function pause() {
    playing = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function reset() {
    st = freshState();
    pos = 0;
    hold = 0;
  }

  function step() {
    pause();
    while (pos < timeline.length) {
      const e = timeline[pos++];
      apply(e);
      if (KEY.has(e.type)) break;
    }
    hold = 0;
    render();
  }

  function skipToEnd() {
    pause();
    while (pos < timeline.length) apply(timeline[pos++]);
    render();
  }

  function start(p) {
    pause();
    puzzle = p;
    timeline = buildTimeline(Puzzle.traceGeneration(p));
    const board = $('v-board');
    board.style.setProperty('--n', p.size);
    $('v-marks').setAttribute('viewBox', `0 0 ${p.size} ${p.size}`);
    cells = Array.from({ length: p.size * p.size }, () => document.createElement('div'));
    $('v-cells').replaceChildren(...cells);
    $('v-seed').textContent = p.seed;
    reset();
    render();
    play();
  }

  $('v-play').addEventListener('click', () => (playing ? pause() : play(), render()));
  $('v-step').addEventListener('click', step);
  $('v-end').addEventListener('click', skipToEnd);
  $('v-restart').addEventListener('click', () => { reset(); play(); });
  $('v-speed').addEventListener('change', (e) => { speed = parseFloat(e.target.value) || 1; });

  window.Visualizer = { start, stop: pause };
})();
