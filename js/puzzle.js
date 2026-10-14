// Puzzle generation, solving and share-code encoding. No DOM access, so it
// can be loaded in the browser (as window.Puzzle) or required from Node.
//
// Share codes don't contain the grid. They hold a seed plus the inputs, and
// the grid is regenerated deterministically. That keeps links short, but it
// means generate() must never change behaviour for an existing VERSION: bump
// VERSION and keep the old path around instead.
(function (root) {
  'use strict';

  const VERSION = 1;
  const MIN_SIZE = 6;
  const MAX_SIZE = 20;
  const FILLER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // 5-bit codes: 0 ends a word, 1..27 are letters.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÑ';
  const MAX_TITLE_BYTES = 120;

  // [dRow, dCol]
  const DIRS = {
    E: [0, 1], S: [1, 0], SE: [1, 1], NE: [-1, 1],
    W: [0, -1], N: [-1, 0], NW: [-1, -1], SW: [1, -1],
  };
  const ALL_DIRS = Object.values(DIRS);

  function directionsFor({ diagonal = true, backwards = false } = {}) {
    const names = ['E', 'S'];
    if (diagonal) names.push('SE', 'NE');
    if (backwards) names.push('W', 'N');
    if (backwards && diagonal) names.push('NW', 'SW');
    return names.map((n) => DIRS[n]);
  }

  // Uppercase, strip accents (except Ñ), keep only letters we can encode.
  function normalizeWord(word) {
    let out = '';
    for (const ch of String(word).toUpperCase()) {
      if (ch === 'Ñ') { out += ch; continue; }
      const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
      if (/^[A-Z]$/.test(base)) out += base;
    }
    return out;
  }

  // Accepts a string (comma / newline separated) or an array. Dedupes.
  function parseWords(input) {
    const raw = Array.isArray(input) ? input : String(input).split(/[\n,;]+/);
    const seen = new Set();
    const words = [];
    for (const w of raw) {
      const n = normalizeWord(w);
      if (n.length >= 2 && !seen.has(n)) {
        seen.add(n);
        words.push(n);
      }
    }
    return words;
  }

  function autoSize(words) {
    const longest = Math.max(0, ...words.map((w) => w.length));
    const letters = words.reduce((sum, w) => sum + w.length, 0);
    const bySpace = Math.ceil(Math.sqrt(letters * 2.2));
    return clamp(Math.max(longest, bySpace, 8), MIN_SIZE, MAX_SIZE);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // Small seeded PRNG; identical output in every JS engine.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues;
    return c ? crypto.getRandomValues(new Uint32Array(1))[0] & 0xffffff : Math.floor(Math.random() * 0x1000000);
  }

  // `trace`, if given, receives every step for the algorithm visualizer. It
  // must never change how `rand` is consumed, or share codes would break.
  function tryPlace(grid, size, letters, dirs, rand, trace) {
    const candidates = [];
    for (const [dr, dc] of dirs) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const er = r + dr * (letters.length - 1);
          const ec = c + dc * (letters.length - 1);
          if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
          let overlaps = 0;
          let clash = -1;
          for (let i = 0; i < letters.length; i++) {
            const cell = grid[(r + dr * i) * size + (c + dc * i)];
            if (cell === null) continue;
            if (cell !== letters[i]) { clash = i; break; }
            overlaps++;
          }
          // A word fully overlapping another (e.g. CAT inside CATS) is useless.
          const ok = clash === -1 && overlaps < letters.length;
          if (trace) trace({ type: 'check', r, c, dr, dc, ok, clash, overlaps });
          if (ok) candidates.push({ r, c, dr, dc, overlaps });
        }
      }
    }
    if (trace) trace({ type: 'scanned', candidates });
    if (!candidates.length) return null;
    // Mild preference for crossings so grids feel woven rather than stacked.
    const crossing = candidates.filter((p) => p.overlaps > 0);
    const roll = crossing.length ? rand() : null;
    const pool = roll !== null && roll < 0.4 ? crossing : candidates;
    const pick = pool[Math.floor(rand() * pool.length)];
    if (trace) trace({ type: 'choose', roll, crossing: crossing.length, pool, fromCrossing: pool === crossing, pick });
    for (let i = 0; i < letters.length; i++) {
      grid[(pick.r + pick.dr * i) * size + (pick.c + pick.dc * i)] = letters[i];
    }
    return pick;
  }

  // Deterministic for a given (words, size, diagonal, backwards, seed).
  function generate({ words, size, diagonal = true, backwards = false, seed, trace }) {
    const rand = mulberry32(seed);
    words = parseWords(words);
    size = clamp(size || autoSize(words), MIN_SIZE, MAX_SIZE);
    const dirs = directionsFor({ diagonal, backwards });
    const order = [...words].sort((a, b) => b.length - a.length);
    if (trace) trace({ type: 'begin', size, seed, order, dirs });

    let best = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      if (trace) trace({ type: 'attempt', n: attempt + 1 });
      const grid = new Array(size * size).fill(null);
      const placed = [];
      const skipped = [];
      for (const word of order) {
        const letters = [...word];
        if (trace) trace({ type: 'word', word });
        const pos = letters.length <= size ? tryPlace(grid, size, letters, dirs, rand, trace) : null;
        if (pos) placed.push(word);
        else skipped.push(word);
        if (trace) {
          if (pos) trace({ type: 'place', word, ...pos });
          else trace({ type: 'skip', word, reason: letters.length > size ? 'too-long' : 'no-fit' });
        }
      }
      if (trace) trace({ type: 'attempt-end', n: attempt + 1, skipped: [...skipped] });
      if (!best || placed.length > best.placed.length) best = { grid, placed, skipped };
      if (!skipped.length) break;
    }

    if (trace) trace({ type: 'fill-start', grid: [...best.grid] });
    const grid = [];
    for (let i = 0; i < best.grid.length; i++) {
      let ch = best.grid[i];
      if (ch === null) {
        ch = FILLER[Math.floor(rand() * FILLER.length)];
        if (trace) trace({ type: 'fill', i, ch });
      }
      grid.push(ch);
    }
    if (trace) trace({ type: 'done', grid });
    // Keep the user's original ordering for the word list.
    const placedWords = words.filter((w) => best.placed.includes(w));
    return { size, grid, words: placedWords, skipped: best.skipped };
  }

  // Every step of building a decoded puzzle's grid, for the visualizer.
  function traceGeneration(puzzle) {
    const events = [];
    const { size, seed, diagonal, backwards, words } = puzzle;
    generate({ words, size, diagonal, backwards, seed, trace: (e) => events.push(e) });
    return events;
  }

  // Make a new puzzle. Searches seeds until every word fits; words that can't
  // fit are dropped so the share code regenerates exactly this grid.
  function create({ title = '', words, size = 0, diagonal = true, backwards = false }) {
    let list = parseWords(words);
    const skipped = [];
    while (list.length) {
      let best = null;
      for (let i = 0; i < 20; i++) {
        const seed = randomSeed();
        const r = generate({ words: list, size, diagonal, backwards, seed });
        if (!best || r.words.length > best.words.length) best = { ...r, seed };
        if (!r.skipped.length) break;
      }
      if (!best.skipped.length) {
        const puzzle = { title, diagonal, backwards, ...best, skipped };
        puzzle.code = encode(puzzle);
        return puzzle;
      }
      skipped.push(...best.skipped);
      list = best.words;
      size = best.size;
    }
    return null;
  }

  // Find a word in the grid in any of the 8 directions.
  function findWord(grid, size, word) {
    const letters = [...word];
    const n = letters.length;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r * size + c] !== letters[0]) continue;
        for (const [dr, dc] of ALL_DIRS) {
          const er = r + dr * (n - 1);
          const ec = c + dc * (n - 1);
          if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
          let i = 1;
          while (i < n && grid[(r + dr * i) * size + (c + dc * i)] === letters[i]) i++;
          if (i === n) return { r0: r, c0: c, r1: er, c1: ec };
        }
      }
    }
    return null;
  }

  // ---- share codes ----------------------------------------------------------
  // Bytes, then base64url:
  //   [0]    version << 4 | diagonal << 1 | backwards
  //   [1]    size
  //   [2..4] seed (24 bits)
  //   [5]    title length in UTF-8 bytes, followed by the title
  //   rest   words as 5-bit codes, each word ending in 0; an empty word ends the list

  function toBase64Url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  function encode({ title = '', size, seed, diagonal, backwards, words }) {
    let titleBytes = new TextEncoder().encode(title);
    if (titleBytes.length > MAX_TITLE_BYTES) {
      // Trim whole characters until it fits.
      let t = title;
      while (new TextEncoder().encode(t).length > MAX_TITLE_BYTES) t = [...t].slice(0, -1).join('');
      titleBytes = new TextEncoder().encode(t);
    }
    const bytes = [
      (VERSION << 4) | (diagonal ? 2 : 0) | (backwards ? 1 : 0),
      size,
      (seed >> 16) & 0xff, (seed >> 8) & 0xff, seed & 0xff,
      titleBytes.length, ...titleBytes,
    ];
    let acc = 0;
    let bits = 0;
    const push = (code) => {
      acc = (acc << 5) | code;
      bits += 5;
      while (bits >= 8) {
        bits -= 8;
        bytes.push((acc >> bits) & 0xff);
      }
      acc &= (1 << bits) - 1;
    };
    for (const w of words) {
      for (const ch of w) push(ALPHABET.indexOf(ch) + 1);
      push(0);
    }
    push(0);
    if (bits) bytes.push((acc << (8 - bits)) & 0xff);
    return toBase64Url(bytes);
  }

  function decode(code) {
    let bytes;
    try { bytes = fromBase64Url(String(code).replace(/^#/, '')); } catch { return null; }
    if (bytes.length < 7 || bytes[0] >> 4 !== VERSION) return null;
    const diagonal = !!(bytes[0] & 2);
    const backwards = !!(bytes[0] & 1);
    const size = bytes[1];
    const seed = (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
    const titleEnd = 6 + bytes[5];
    if (size < MIN_SIZE || size > MAX_SIZE || titleEnd > bytes.length) return null;
    let title;
    try { title = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(6, titleEnd)); } catch { return null; }

    const words = [];
    let word = '';
    let acc = 0;
    let bits = 0;
    outer: for (let i = titleEnd; i < bytes.length; i++) {
      acc = (acc << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        const c = (acc >> bits) & 31;
        acc &= (1 << bits) - 1;
        if (c === 0) {
          if (!word) break outer;
          words.push(word);
          word = '';
        } else if (c <= ALPHABET.length) {
          word += ALPHABET[c - 1];
        } else {
          return null;
        }
      }
    }
    if (!words.length) return null;

    const r = generate({ words, size, diagonal, backwards, seed });
    return { title, size, seed, diagonal, backwards, grid: r.grid, words: r.words, code: encode({ title, size, seed, diagonal, backwards, words }) };
  }

  const api = { MIN_SIZE, MAX_SIZE, parseWords, autoSize, generate, create, findWord, encode, decode, traceGeneration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Puzzle = api;
})(typeof window !== 'undefined' ? window : globalThis);
