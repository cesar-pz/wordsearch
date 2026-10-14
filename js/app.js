(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PREFS_KEY = 'wordsearch:prefs';
  const MINE_KEY = 'wordsearch:mine';
  const PROGRESS_PREFIX = 'wordsearch:progress:';
  const WATCH = 'watch/'; // #watch/<code> opens the algorithm visualizer
  const SAMPLE_WORDS = ['DUCK', 'POND', 'FEATHER', 'QUACK', 'WADDLE', 'PUDDLE'];

  // Hues for found-word highlights, cycled in order.
  const HUES = [230, 145, 32, 285, 350, 185, 50, 260, 10, 100];
  const hl = (k) => `hsl(${HUES[k % HUES.length]} 85% 55%)`;

  let game = null; // current play state
  let timerId = null;
  let currentHash = null; // hash the current view was rendered for
  let vizPuzzle = null;   // puzzle shown in the visualizer

  // ---- storage helpers (storage can be missing or throw) -------------------

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  // Codes of puzzles made in this browser, so their author can edit them
  // without other players being shown the words.
  function isMine(code) {
    return (load(MINE_KEY) || []).includes(code);
  }
  function markMine(code) {
    const mine = (load(MINE_KEY) || []).filter((c) => c !== code);
    mine.unshift(code);
    save(MINE_KEY, mine.slice(0, 50));
  }

  // ---- routing --------------------------------------------------------------

  function route() {
    // Setting location.hash can fire both hashchange and popstate.
    if (location.hash === currentHash) return;
    currentHash = location.hash;
    if (game && !game.done) persist();
    stopTimer();
    Visualizer.stop();
    game = null;
    const hash = location.hash.slice(1);
    const watching = hash.startsWith(WATCH);
    const code = watching ? hash.slice(WATCH.length) : hash;
    const puzzle = code ? Puzzle.decode(code) : null;
    if (puzzle && watching) {
      showViz(puzzle);
    } else if (puzzle) {
      showPlay(puzzle);
    } else {
      if (code) toast('That link doesn’t contain a valid puzzle.');
      showCreate();
    }
  }

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
    document.querySelector('.container').classList.toggle('wide', id === 'play' || id === 'viz');
    window.scrollTo(0, 0);
  }

  // ---- confirm dialog -------------------------------------------------------

  function confirmDialog(message, okLabel) {
    const dlg = $('confirm');
    $('confirm-msg').textContent = message;
    $('confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => {
      // Resolve from the button click directly; 'close' covers Escape.
      const done = (ok) => {
        dlg.removeEventListener('click', onClick);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        resolve(ok);
      };
      const onClick = (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        e.preventDefault();
        done(btn.value === 'ok');
      };
      const onClose = () => done(dlg.returnValue === 'ok');
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('close', onClose);
    });
  }

  // ---- create view ----------------------------------------------------------

  const sizeSelect = $('f-size');
  sizeSelect.add(new Option('Auto', ''));
  for (let n = Puzzle.MIN_SIZE; n <= Puzzle.MAX_SIZE; n++) {
    sizeSelect.add(new Option(`${n} × ${n}`, String(n)));
  }

  function showCreate(prefill) {
    const prefs = load(PREFS_KEY) || {};
    const opts = prefill || prefs;
    $('f-diagonal').checked = opts.diagonal ?? true;
    $('f-backwards').checked = opts.backwards ?? false;
    sizeSelect.value = prefill ? String(prefill.size) : prefs.size ?? '';
    $('f-title').value = prefill ? prefill.title : '';
    $('f-words').value = prefill ? prefill.words.join('\n') : '';
    $('create-error').hidden = true;
    document.title = 'Word Search';
    show('create');
  }

  function formError(msg) {
    const err = $('create-error');
    err.textContent = msg;
    err.hidden = false;
  }

  // Build a puzzle from the form, or show an error and return null.
  function puzzleFromForm({ sampleIfEmpty = false } = {}) {
    let words = Puzzle.parseWords($('f-words').value);
    if (!words.length && sampleIfEmpty) words = SAMPLE_WORDS;
    const size = parseInt(sizeSelect.value, 10) || 0;
    const opts = {
      diagonal: $('f-diagonal').checked,
      backwards: $('f-backwards').checked,
    };
    save(PREFS_KEY, { ...opts, size: sizeSelect.value });

    const fail = (msg) => { formError(msg); return null; };
    if (!words.length) return fail('Add at least one word (2+ letters).');
    const longest = words.reduce((a, w) => (w.length > a.length ? w : a), '');
    if (longest.length > Puzzle.MAX_SIZE) {
      return fail(`Words can be at most ${Puzzle.MAX_SIZE} letters long.`);
    }
    if (size && longest.length > size) {
      return fail(`“${longest}” doesn’t fit in a ${size} × ${size} grid.`);
    }

    const puzzle = Puzzle.create({ title: $('f-title').value.trim(), words, size, ...opts });
    if (!puzzle) return fail('Couldn’t fit any words. Try a bigger grid.');
    markMine(puzzle.code);
    return puzzle;
  }

  $('create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const puzzle = puzzleFromForm();
    if (!puzzle) return;
    if (puzzle.skipped.length) {
      try { sessionStorage.setItem('wordsearch:skipped', puzzle.skipped.join(', ')); } catch { /* ignore */ }
    }
    location.hash = puzzle.code;
  });

  $('btn-visualize').addEventListener('click', () => {
    const puzzle = puzzleFromForm({ sampleIfEmpty: true });
    if (!puzzle) return;
    if (puzzle.skipped.length) toast(`Left out (didn’t fit): ${puzzle.skipped.join(', ')}`);
    location.hash = WATCH + puzzle.code;
  });

  // ---- visualizer view ------------------------------------------------------

  function showViz(puzzle) {
    vizPuzzle = { ...puzzle, mine: isMine(puzzle.code) };
    document.title = 'How the grid is built · Word Search';
    $('v-new').textContent = vizPuzzle.mine ? 'Edit puzzle' : 'Make your own';
    show('viz');
    Visualizer.start(puzzle);
  }

  $('v-playgame').addEventListener('click', () => {
    if (vizPuzzle) location.hash = vizPuzzle.code;
  });
  $('v-new').addEventListener('click', () => openEditor(vizPuzzle));

  // ---- play view ------------------------------------------------------------

  const progressKey = (code) => PROGRESS_PREFIX + code;

  function showPlay(puzzle) {
    const saved = load(progressKey(puzzle.code));
    game = {
      ...puzzle,
      mine: isMine(puzzle.code),
      found: [],        // { index, r0, c0, r1, c1 }
      bankOpen: false,  // word bank currently visible
      bankSeen: false,  // player has confirmed revealing the bank before
      revealed: false,  // answer locations shown; play continues
      startedAt: Date.now(),
      elapsed: 0,       // ms, frozen once finished
      done: false,
      sel: null,        // { r0, c0, r1, c1 } current selection
      anchor: null,     // { r, c } first tap in tap-tap mode
      dragging: false,
    };
    if (saved) {
      game.found = (saved.found || []).filter((f) => f.index < puzzle.words.length);
      game.bankSeen = !!saved.bankSeen;
      game.bankOpen = !!saved.bankOpen;
      game.revealed = !!saved.revealed;
      game.elapsed = saved.elapsed || 0;
      game.startedAt = Date.now() - game.elapsed;
      game.done = !!saved.done && game.found.length === puzzle.words.length;
    }

    document.title = (puzzle.title || 'Word Search') + ' · Word Search';
    $('p-title').textContent = puzzle.title || 'Word Search';
    $('btn-edit').textContent = game.mine ? 'Edit puzzle' : 'Make your own';

    let notice = '';
    try {
      const skipped = sessionStorage.getItem('wordsearch:skipped');
      if (skipped) notice = `Some words didn’t fit and were left out: ${skipped}. Try a bigger grid.`;
      sessionStorage.removeItem('wordsearch:skipped');
    } catch { /* ignore */ }
    setNotice(notice);

    $('board').style.setProperty('--n', puzzle.size);
    $('marks').setAttribute('viewBox', `0 0 ${puzzle.size} ${puzzle.size}`);
    $('cells').replaceChildren(...puzzle.grid.map((ch) => {
      const d = document.createElement('div');
      d.className = 'cell';
      d.textContent = ch;
      return d;
    }));

    renderWords();
    renderMarks();
    show('play');
    if (game.done) finish(true);
    else startTimer();
  }

  function setNotice(text, kind = 'info') {
    const el = $('p-notice');
    el.textContent = text;
    el.className = `message ${kind}`;
    el.hidden = !text;
  }

  function persist() {
    save(progressKey(game.code), {
      found: game.found.map(({ index, r0, c0, r1, c1 }) => ({ index, r0, c0, r1, c1 })),
      bankSeen: game.bankSeen,
      bankOpen: game.bankOpen,
      revealed: game.revealed,
      elapsed: game.done ? game.elapsed : Date.now() - game.startedAt,
      done: game.done,
    });
  }

  function renderWords() {
    const foundAt = new Map(game.found.map((f, k) => [f.index, k]));
    // Once the game is over there's nothing left to spoil.
    const open = game.bankOpen || game.done;
    const items = [];
    game.words.forEach((w, i) => {
      const k = foundAt.get(i);
      if (k === undefined && !open) return;
      const li = document.createElement('li');
      li.textContent = w;
      if (k !== undefined) {
        li.className = 'found';
        li.style.setProperty('--hl', hl(k));
      } else if (game.revealed) {
        li.className = 'revealed';
      }
      items.push(li);
    });
    $('p-words').replaceChildren(...items);

    const left = game.words.length - foundAt.size;
    $('p-hidden').textContent = open || !left
      ? ''
      : `${left} hidden word${left === 1 ? '' : 's'} left to find.`;

    const bankBtn = $('btn-bank');
    bankBtn.hidden = game.done;
    bankBtn.textContent = game.bankOpen ? 'Hide words' : 'Show words';
    bankBtn.setAttribute('aria-expanded', String(game.bankOpen));

    $('p-found').textContent = foundAt.size;
    $('p-total').textContent = game.words.length;
    $('btn-reveal').disabled = game.done || game.revealed;
    // Watching the build would give the answers away, so only offer it after.
    $('btn-watch').hidden = !(game.done || game.revealed);
  }

  function line(r0, c0, r1, c1, cls, color) {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', c0 + 0.5);
    l.setAttribute('y1', r0 + 0.5);
    l.setAttribute('x2', c1 + 0.5);
    l.setAttribute('y2', r1 + 0.5);
    l.setAttribute('stroke-width', 0.78);
    l.setAttribute('class', cls);
    if (color) l.setAttribute('stroke', color);
    return l;
  }

  function renderMarks() {
    const out = [];
    const foundIdx = new Set();
    game.found.forEach((f, k) => {
      foundIdx.add(f.index);
      out.push(line(f.r0, f.c0, f.r1, f.c1, 'found', hl(k)));
    });
    if (game.revealed) {
      game.words.forEach((w, i) => {
        if (foundIdx.has(i)) return;
        const p = Puzzle.findWord(game.grid, game.size, w);
        if (p) out.push(line(p.r0, p.c0, p.r1, p.c1, 'revealed'));
      });
    }
    const s = game.sel || (game.anchor && { r0: game.anchor.r, c0: game.anchor.c, r1: game.anchor.r, c1: game.anchor.c });
    if (s) out.push(line(s.r0, s.c0, s.r1, s.c1, 'sel'));
    $('marks').replaceChildren(...out);
  }

  // ---- timer ----------------------------------------------------------------

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function startTimer() {
    stopTimer();
    const tick = () => { $('p-timer').textContent = fmt(Date.now() - game.startedAt); };
    tick();
    timerId = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function finish(restoring) {
    stopTimer();
    if (!restoring) {
      game.elapsed = Date.now() - game.startedAt;
      game.done = true;
      game.anchor = null;
      persist();
    }
    $('p-timer').textContent = fmt(game.elapsed);
    renderWords();
    renderMarks();
    setNotice(`🦆 Quack! Nice work, you found all ${game.words.length} words in ${fmt(game.elapsed)}.`, 'success');
    // Hard mode: solved without ever seeing the word bank or the answers.
    if (!restoring && !game.bankSeen && !game.revealed && window.Ducks) setTimeout(Ducks.backflip, 2000);
  }

  // ---- selection (drag, or tap start then tap end) --------------------------

  function cellAt(e) {
    const rect = $('cells').getBoundingClientRect();
    const n = game.size;
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * n);
    return { r: Math.min(n - 1, Math.max(0, r)), c: Math.min(n - 1, Math.max(0, c)) };
  }

  // Snap the line from start to the pointer onto one of the 8 directions.
  function snap(r0, c0, r, c) {
    const dr = r - r0;
    const dc = c - c0;
    if (!dr && !dc) return { r0, c0, r1: r0, c1: c0 };
    const step = Math.round(Math.atan2(dr, dc) / (Math.PI / 4));
    const ur = Math.round(Math.sin(step * Math.PI / 4));
    const uc = Math.round(Math.cos(step * Math.PI / 4));
    let len = ur && uc ? Math.round((Math.abs(dr) + Math.abs(dc)) / 2) : Math.abs(ur ? dr : dc);
    const n = game.size;
    while (len > 0) {
      const r1 = r0 + ur * len;
      const c1 = c0 + uc * len;
      if (r1 >= 0 && r1 < n && c1 >= 0 && c1 < n) break;
      len--;
    }
    return { r0, c0, r1: r0 + ur * len, c1: c0 + uc * len };
  }

  function selectionText(s) {
    const len = Math.max(Math.abs(s.r1 - s.r0), Math.abs(s.c1 - s.c0));
    const ur = Math.sign(s.r1 - s.r0);
    const uc = Math.sign(s.c1 - s.c0);
    let out = '';
    for (let i = 0; i <= len; i++) out += game.grid[(s.r0 + ur * i) * game.size + (s.c0 + uc * i)];
    return out;
  }

  function checkSelection(s) {
    const text = selectionText(s);
    const rev = [...text].reverse().join('');
    const foundIdx = new Set(game.found.map((f) => f.index));
    const index = game.words.findIndex((w, i) => !foundIdx.has(i) && (w === text || w === rev));
    if (index === -1) return;
    game.found.push({ index, ...s });
    renderWords();
    persist();
    if (game.found.length === game.words.length) finish();
  }

  const board = $('board');

  board.addEventListener('pointerdown', (e) => {
    if (!game || game.done || e.button > 0) return;
    e.preventDefault();
    const { r, c } = cellAt(e);
    if (game.anchor && game.anchor.r === r && game.anchor.c === c) {
      game.anchor = null; // tapping the start cell again cancels
      renderMarks();
      return;
    }
    const start = game.anchor || { r, c };
    game.sel = snap(start.r, start.c, r, c);
    game.dragging = true;
    board.setPointerCapture(e.pointerId);
    renderMarks();
  });

  board.addEventListener('pointermove', (e) => {
    if (!game || !game.dragging) return;
    const { r, c } = cellAt(e);
    const next = snap(game.sel.r0, game.sel.c0, r, c);
    if (next.r1 !== game.sel.r1 || next.c1 !== game.sel.c1) {
      game.sel = next;
      renderMarks();
    }
  });

  board.addEventListener('pointerup', () => {
    if (!game || !game.dragging) return;
    game.dragging = false;
    const s = game.sel;
    game.sel = null;
    if (s.r0 === s.r1 && s.c0 === s.c1) {
      game.anchor = { r: s.r0, c: s.c0 }; // single tap: wait for the end cell
    } else {
      game.anchor = null;
      checkSelection(s);
    }
    renderMarks();
  });

  board.addEventListener('pointercancel', () => {
    if (!game) return;
    game.dragging = false;
    game.sel = null;
    renderMarks();
  });

  // ---- actions --------------------------------------------------------------

  $('btn-bank').addEventListener('click', async () => {
    if (!game) return;
    if (!game.bankOpen && !game.bankSeen) {
      const ok = await confirmDialog('Are you sure you want to reveal the words?', 'Show words');
      if (!ok || !game) return;
      game.bankSeen = true;
    }
    game.bankOpen = !game.bankOpen;
    renderWords();
    persist();
  });

  $('btn-share').addEventListener('click', async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied! Send it to anyone to play.');
    } catch {
      window.prompt('Copy this link:', url);
    }
  });

  $('btn-reveal').addEventListener('click', async () => {
    if (!game || game.done || game.revealed) return;
    const ok = await confirmDialog('Reveal where all the words are? You can keep playing.', 'Reveal answers');
    if (!ok || !game || game.done) return;
    // The answers give the words away, so open the word bank too.
    game.revealed = true;
    game.bankSeen = true;
    game.bankOpen = true;
    renderWords();
    renderMarks();
    persist();
  });

  $('btn-restart').addEventListener('click', async () => {
    if (!game) return;
    if (game.found.length && !game.done) {
      const ok = await confirmDialog('Start over? Your found words and time will be cleared.', 'Restart');
      if (!ok || !game) return;
    }
    try { localStorage.removeItem(progressKey(game.code)); } catch { /* ignore */ }
    game = null;
    currentHash = null;
    route();
  });

  // Open the create form. Only the puzzle's author gets its words prefilled;
  // anyone else starts blank.
  function openEditor(source) {
    const prefill = source && source.mine
      ? { title: source.title, words: source.words, size: source.size, diagonal: source.diagonal, backwards: source.backwards }
      : null;
    if (game && !game.done) persist();
    stopTimer();
    Visualizer.stop();
    history.pushState(null, '', location.pathname + location.search);
    currentHash = location.hash;
    game = null;
    showCreate(prefill);
  }

  $('btn-edit').addEventListener('click', () => openEditor(game));
  $('btn-watch').addEventListener('click', () => {
    if (game) location.hash = WATCH + game.code;
  });

  // Save elapsed time when leaving so a reload resumes the clock where it was.
  window.addEventListener('pagehide', () => { if (game && !game.done) persist(); });

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  route();
})();
