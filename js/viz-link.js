// Link scene for the algorithm visualizer: replays Puzzle.encode() step by
// step, from settings and letters to bits, bytes and finally base64 text.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const bin = (n, width) => n.toString(2).padStart(width, '0');
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const show = (ch) => (ch === ' ' ? '␣' : ch);

  // What each section is called in the key and on byte labels.
  const SECTIONS = [
    ['settings', 'Settings'], ['size', 'Grid size'], ['seed', 'Seed'], ['title', 'Title'],
    ['words', 'Letters'], ['end', 'End marker'], ['pad', 'Padding'],
  ];

  // Milliseconds each step is held at 1×. The first few of a repeated step are
  // slow so students can follow; the rest speed up.
  const MS = {
    settings: 5200, size: 3200, seed: 3600, title: 3400, headerByte: 550,
    titleCharSlow: 1300, titleCharFast: 260, words: 5200, word: 900, wordFirst: 1400,
    letterSlow: 1500, letterFast: 300, endSlow: 1900, endFast: 420,
    byteFirst: 2400, byte: 160, endList: 2200, pad: 2600, base64: 5200,
    groupSlow: 1600, groupsRest: 5200, done: 0,
  };
  const KEY = new Set(['settings', 'size', 'seed', 'title', 'words', 'word', 'end-list', 'pad', 'base64', 'done']);

  let compare = null;
  let st = null;

  function buildTimeline(events) {
    const out = [];
    let titleChars = 0;
    let wordCount = 0;
    let wordBytes = 0;
    let slowGroups = 0;
    const groups = events.filter((e) => e.type === 'b64').length;
    const groupFast = Math.max(40, MS.groupsRest / Math.max(1, groups - 3));
    for (const e of events) {
      let ms = 0;
      switch (e.type) {
        case 'settings': ms = MS.settings; break;
        case 'size': ms = MS.size; break;
        case 'seed': ms = MS.seed; break;
        case 'title': ms = e.length ? MS.title : MS.title / 2; break;
        case 'title-char': ms = titleChars++ < 3 ? MS.titleCharSlow : MS.titleCharFast; break;
        case 'words': ms = MS.words; break;
        case 'word': ms = wordCount++ === 0 ? MS.wordFirst : MS.word; break;
        case 'letter': ms = wordCount === 1 ? MS.letterSlow : MS.letterFast; break;
        case 'end-word': ms = wordCount === 1 ? MS.endSlow : MS.endFast; break;
        case 'bits': ms = 0; break;
        case 'byte':
          if (isStream(e)) ms = wordBytes++ === 0 ? MS.byteFirst : MS.byte;
          else ms = MS.headerByte;
          break;
        case 'end-list': ms = MS.endList; break;
        case 'pad': ms = MS.pad; break;
        case 'base64': ms = MS.base64; break;
        case 'b64': ms = slowGroups++ < 3 ? MS.groupSlow : groupFast; break;
        case 'done': ms = MS.done; break;
      }
      out.push({ ...e, ms });
    }
    return out;
  }

  // Bytes cut from the 5-bit letter stream (rather than written whole).
  const isStream = (e) => e.sections.some((s) => s === 'words' || s === 'end' || s === 'pad');

  function freshState() {
    return {
      stage: 'Settings',
      focus: [],
      text: '',
      bytes: [],          // { value, sections, label }
      bitSections: [],    // section of every bit written so far
      buffer: [],         // { b, s } bits waiting to fill a byte
      newBytes: 0,        // how many bytes the latest step added
      showAlpha: false,
      alphaHi: -1,
      showB64: false,
      groups: [],         // { bits, sections, ch }
      b64Hi: -1,
      reading: null,      // [start, end) bit range being turned into a character
      byteCount: 0,
      wordBytesSeen: 0,
      done: false,
      firstEnd: true,
    };
  }

  // Focus-card parts: { bits, sections | section, cap } or { val, cap } or 'to' (an arrow).
  const bitsPart = (bits, section, cap) => ({ bits, section, cap });
  const valPart = (val, cap) => ({ val: String(val), cap });

  function apply(e) {
    st.newBytes = 0;
    switch (e.type) {
      case 'settings':
        st.stage = 'Byte 1: settings';
        st.focus = [
          bitsPart(bin(e.version, 4), 'settings', `version ${e.version}`),
          bitsPart('00', 'settings', 'unused'),
          bitsPart(e.diagonal ? '1' : '0', 'settings', `diagonal ${e.diagonal ? 'on' : 'off'}`),
          bitsPart(e.backwards ? '1' : '0', 'settings', `backwards ${e.backwards ? 'on' : 'off'}`),
          'to', valPart(e.value, 'byte'),
        ];
        st.text = `A byte is 8 bits, each 0 or 1. The first byte packs three settings: the format version in the top 4 bits, then one bit each for diagonal and backwards words. Together, ${bin(e.value, 8)} is the number ${e.value}.`;
        break;

      case 'size':
        st.stage = 'Byte 2: grid size';
        st.focus = [valPart(`${e.size}×${e.size}`, 'grid'), 'to', bitsPart(bin(e.size, 8), 'size', `${e.size} in binary`)];
        st.text = `Next, the grid size. ${e.size} written in binary is ${bin(e.size, 8)}.`;
        break;

      case 'seed': {
        const b = [(e.seed >> 16) & 0xff, (e.seed >> 8) & 0xff, e.seed & 0xff];
        st.stage = 'Bytes 3–5: random seed';
        st.focus = [valPart(e.seed.toLocaleString('en-US'), 'seed'), 'to', ...b.map((x, i) => bitsPart(bin(x, 8), 'seed', `byte ${i + 3}`))];
        st.text = `The random seed ${e.seed} rebuilds the whole grid, so it’s the most important part. It needs 24 bits, which is 3 bytes.`;
        break;
      }

      case 'title':
        st.stage = 'Title';
        st.focus = e.length
          ? [valPart(`“${e.title}”`, 'title'), 'to', valPart(e.length, 'bytes long')]
          : [valPart('(none)', 'title'), 'to', valPart(0, 'bytes long')];
        st.text = e.length
          ? `The title is stored as UTF-8, the standard way to turn text into bytes. First one byte for its length (${e.length}), then the bytes themselves. Plain letters take 1 byte each; an emoji takes 4.`
          : 'This puzzle has no title, so just one byte saying its length is 0.';
        break;

      case 'title-char':
        st.focus = [valPart(show(e.ch), 'character'), 'to', valPart(e.bytes.join(' '), e.bytes.length > 1 ? `${e.bytes.length} bytes` : 'UTF-8'), 'to',
          ...e.bytes.map((x) => bitsPart(bin(x, 8), 'title'))];
        st.text = e.bytes.length > 1
          ? `“${e.ch}” isn’t a plain letter, so UTF-8 uses ${e.bytes.length} bytes for it: ${e.bytes.join(', ')}.`
          : `“${show(e.ch)}” is UTF-8 byte ${e.bytes[0]}.`;
        break;

      case 'words':
        st.stage = 'Words: 5 bits per letter';
        st.showAlpha = true;
        st.alphaHi = -1;
        st.focus = [valPart('A', 'letter 1'), 'to', bitsPart('00001', 'words'), valPart('Z', 'letter 26'), 'to', bitsPart('11010', 'words'),
          valPart('end', '0'), 'to', bitsPart('00000', 'end')];
        st.text = `Now the ${plural(e.count, 'word')}. A normal byte per letter would waste space: 5 bits can count from 0 to 31, which is enough for A–Z (1–26), Ñ (27) and 0 for “end of word”. So each letter takes 5 bits instead of 8.`;
        break;

      case 'word':
        st.stage = `Word: ${e.word}`;
        st.text = `Packing ${e.word}, letter by letter.`;
        break;

      case 'letter':
        st.alphaHi = e.code;
        st.focus = [valPart(e.ch, 'letter'), 'to', valPart(e.code, 'number'), 'to', bitsPart(bin(e.code, 5), 'words', '5 bits')];
        st.text = `${e.ch} is letter ${e.code}, which is ${bin(e.code, 5)} in 5 bits. The bits go into the waiting line below.`;
        break;

      case 'end-word':
        st.alphaHi = 0;
        st.focus = [valPart('end', `end of ${e.word}`), 'to', valPart(0, 'number'), 'to', bitsPart('00000', 'end', '5 bits')];
        st.text = `${e.word} is done, so add 00000 to mark the end of the word.`;
        break;

      case 'end-list':
        st.alphaHi = 0;
        st.stage = 'End of the list';
        st.focus = [valPart('end', 'no more words'), 'to', bitsPart('00000', 'end', '5 bits')];
        st.text = 'A second 00000 straight after a word’s end means there are no more words.';
        break;

      case 'bits':
        for (const b of e.bits) st.buffer.push({ b, s: e.section });
        break;

      case 'pad': {
        st.stage = 'Padding';
        const left = st.buffer.map((x) => x.b).join('');
        st.focus = [bitsPart(left, st.buffer.map((x) => x.s), `${left.length} left over`), bitsPart('0'.repeat(e.bits), 'pad', 'padding'), 'to', valPart('1 byte', '')];
        st.text = `Only ${plural(left.length, 'bit')} are left, which isn’t a whole byte. Fill it up with ${e.bits} zeros so the last byte is complete.`;
        break;
      }

      case 'byte': {
        st.bytes.push({ value: e.value, sections: e.sections, label: e.label });
        st.bitSections.push(...e.sections);
        st.newBytes = 1;
        if (isStream(e)) {
          st.buffer.splice(0, 8);
          if (st.wordBytesSeen++ === 0) {
            st.text = `8 bits are waiting, so they’re cut off into a byte: ${bin(e.value, 8)} = ${e.value}. Letters don’t line up with bytes, and that’s fine: a letter can be split across two bytes.`;
          }
        }
        break;
      }

      case 'base64':
        st.stage = 'Base64: bytes to link text';
        st.showAlpha = false;
        st.showB64 = true;
        st.buffer = [];
        st.focus = [valPart('3 bytes', '8 bits each'), 'to', valPart('24 bits', ''), 'to', valPart('4 characters', '6 bits each')];
        st.text = `That’s ${plural(e.bytes, 'byte')} of binary data, but a link can only hold text. Base64 regroups the same ${e.bits} bits into 6-bit chunks. 6 bits count from 0 to 63, and each number picks one of 64 link-safe characters: A–Z, a–z, 0–9, - and _.`;
        break;

      case 'b64': {
        const sections = st.bitSections.slice(e.start, e.start + e.bits.length);
        for (let i = 0; i < e.padded; i++) sections.push('pad');
        const bits = e.bits + '0'.repeat(e.padded);
        st.groups.push({ bits, sections, ch: e.ch });
        st.b64Hi = e.value;
        st.reading = [e.start, e.start + e.bits.length];
        st.focus = [bitsPart(bits, sections, '6 bits'), 'to', valPart(e.value, 'number'), 'to', valPart(e.ch, 'character')];
        st.text = e.padded
          ? `The last chunk only has ${plural(e.bits.length, 'bit')}, so it’s padded with zeros: ${bits} = ${e.value} → ${e.ch}.`
          : `${e.bits} is ${e.value}, and character number ${e.value} is “${e.ch}”.`;
        break;
      }

      case 'done':
        st.stage = 'The link';
        st.done = true;
        st.reading = null;
        st.b64Hi = -1;
        st.focus = [valPart(st.bytes.length, 'bytes'), 'to', valPart(e.code.length, 'characters')];
        st.text = `Done! ${plural(st.bytes.length, 'byte')} became ${plural(e.code.length, 'character')}. `
          + (e.dropped ? `(Standard base64 would add ${e.dropped === 1 ? 'an “=”' : '“==”'} at the end to round up to a multiple of 4; it isn’t needed here, so it’s dropped.) ` : '')
          + 'To play, the browser runs every step backwards to get the seed and words, then rebuilds the grid. And because the letters are scrambled into bits, nobody can read the answers from the link.';
        break;
    }
  }

  // ---- drawing --------------------------------------------------------------

  function bitCells(bits, sections, offset = -1) {
    const wrap = el('span', 'lk-bits');
    [...bits].forEach((b, i) => {
      const s = Array.isArray(sections) ? sections[i] : sections;
      const cell = el('span', `lk-bit sec-${s}`, b);
      if (offset >= 0 && st.reading && offset + i >= st.reading[0] && offset + i < st.reading[1]) cell.classList.add('reading');
      wrap.append(cell);
    });
    return wrap;
  }

  function renderFocus() {
    $('lk-stage').textContent = st.stage;
    $('lk-focus').replaceChildren(...st.focus.map((p) => {
      if (p === 'to') return el('span', 'lk-arrow', '→');
      const part = el('div', 'lk-part');
      if (p.bits !== undefined) part.append(bitCells(p.bits, p.section));
      else part.append(el('div', 'lk-val', p.val));
      if (p.cap) part.append(el('div', 'lk-cap', p.cap));
      return part;
    }));
  }

  function byteLabel(b) {
    if (b.label === 'settings') return 'settings';
    if (b.label === 'size') return 'size';
    if (b.label === 'seed') return 'seed';
    if (b.label === 'length') return 'title length';
    if (b.label) return `“${show(b.label)}”`;
    return '';
  }

  function renderBytes() {
    const n = st.bytes.length;
    $('lk-bytes').replaceChildren(...st.bytes.map((b, i) => {
      const box = el('div', 'lk-byte' + (i >= n - st.newBytes ? ' new' : ''));
      box.append(bitCells(bin(b.value, 8), b.sections, i * 8));
      const meta = el('div', 'lk-byte-meta');
      meta.append(el('span', 'lk-dec', String(b.value)));
      const label = byteLabel(b);
      if (label) meta.append(el('span', 'lk-label', label));
      box.append(meta);
      return box;
    }));
    $('lk-bytecount').textContent = plural(n, 'byte');

    const buf = $('lk-buffer');
    buf.hidden = !st.buffer.length;
    if (st.buffer.length) {
      buf.replaceChildren(el('span', 'lk-buffer-label', 'Waiting for a full byte:'),
        bitCells(st.buffer.map((x) => x.b).join(''), st.buffer.map((x) => x.s)),
        el('span', 'lk-buffer-count', `${st.buffer.length}/8`));
    }
  }

  function renderAlphabets() {
    $('lk-alpha-card').hidden = !st.showAlpha;
    if (st.showAlpha) {
      const items = ['end', ...Puzzle.ALPHABET].map((ch, i) => {
        const it = el('span', 'lk-alpha-item' + (i === st.alphaHi ? ' hi' : ''));
        it.append(el('b', '', ch), el('small', '', String(i)));
        return it;
      });
      $('lk-alpha').replaceChildren(...items);
    }

    $('lk-b64-card').hidden = !st.showB64;
    if (st.showB64) {
      $('lk-b64alpha').replaceChildren(...[...Puzzle.BASE64URL].map((ch, i) => {
        const it = el('span', 'lk-alpha-item' + (i === st.b64Hi ? ' hi' : ''));
        it.append(el('b', '', ch), el('small', '', String(i)));
        return it;
      }));
      $('lk-groups').replaceChildren(...st.groups.map((g, i) => {
        const box = el('div', 'lk-group' + (i === st.groups.length - 1 && !st.done ? ' new' : ''));
        box.append(bitCells(g.bits, g.sections), el('div', `lk-char sec-${firstReal(g.sections)}`, g.ch));
        return box;
      }));
    }
  }

  // Section a character mostly "belongs" to: its first non-padding bit.
  const firstReal = (sections) => sections.find((s) => s !== 'pad') || 'pad';

  function renderDone() {
    $('lk-done-card').hidden = !st.done;
    if (!st.done) return;
    const origin = location.href.split('#')[0];
    const link = $('lk-link');
    link.replaceChildren(el('span', 'lk-origin', `${origin}#`), ...st.groups.map((g) => el('span', `lk-char sec-${firstReal(g.sections)}`, g.ch)));

    const max = Math.max(...compare.map((c) => c.len));
    $('lk-compare').replaceChildren(...compare.map((c) => {
      const row = el('div', 'lk-bar-row' + (c.packed ? ' packed' : ''));
      row.title = `${c.label}: ${c.len} characters`;
      const track = el('div', 'lk-bar-track');
      const bar = el('div', 'lk-bar');
      bar.style.width = `${(c.len / max) * 100}%`;
      track.append(bar);
      row.append(el('span', 'lk-bar-label', c.label), track, el('span', 'lk-bar-value', String(c.len)));
      return row;
    }));
  }

  function render() {
    renderFocus();
    renderAlphabets();
    renderBytes();
    renderDone();
  }

  // Lengths of readable alternatives, for the comparison at the end.
  function comparisons(p) {
    const readable = new URLSearchParams();
    if (p.title) readable.set('title', p.title);
    readable.set('size', p.size);
    readable.set('seed', p.seed);
    readable.set('diagonal', p.diagonal ? 1 : 0);
    readable.set('backwards', p.backwards ? 1 : 0);
    readable.set('words', p.words.join(','));
    const withGrid = new URLSearchParams(readable);
    withGrid.delete('seed');
    withGrid.set('grid', p.grid.join(''));
    return [
      { label: 'Whole grid, as text', len: withGrid.toString().length },
      { label: 'Seed and words, as text', len: readable.toString().length },
      { label: 'Packed (this link)', len: p.code.length, packed: true },
    ];
  }

  function buildLegend() {
    $('lk-legend').replaceChildren(...SECTIONS.map(([key, label]) => {
      const li = el('li');
      li.append(el('span', `lk-swatch sec-${key}`), label);
      return li;
    }));
  }

  window.LinkScene = {
    title: 'How the link is packed',
    keys: KEY,
    load(p) {
      compare = comparisons(p);
      buildLegend();
      return buildTimeline(Puzzle.traceEncoding(p));
    },
    reset() { st = freshState(); },
    apply,
    render,
    get text() { return st.text; },
    get stats() { return [['Bytes', st.bytes.length], ['Characters', st.groups.length]]; },
  };
})();
