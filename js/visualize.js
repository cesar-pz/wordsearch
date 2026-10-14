// Algorithm visualizer shell: one player per scene (grid building, link
// packing), shared play / step / skip / speed controls and the tabs.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let speed = 1;
  let active = null;

  // Plays a scene's timed steps. Each step is applied, then held for its `ms`.
  function createPlayer(scene) {
    let timeline = [];
    let pos = 0;   // next step to apply
    let hold = 0;  // ms left before the next step
    let playing = false;
    let rafId = null;
    let lastTime = null;

    const player = {
      scene,
      get playing() { return playing; },
      get started() { return pos > 0; },
      get finished() { return pos >= timeline.length; },
      load(p) { pause(); timeline = scene.load(p); reset(); },
      play,
      pause,
      reset,
      step() {
        pause();
        while (pos < timeline.length) {
          const e = timeline[pos++];
          scene.apply(e);
          if (scene.keys.has(e.type)) break;
        }
        hold = 0;
        draw();
      },
      skipToEnd() {
        pause();
        while (pos < timeline.length) scene.apply(timeline[pos++]);
        draw();
      },
      draw,
    };

    function reset() { scene.reset(); pos = 0; hold = 0; }

    function advance(budget) {
      while (true) {
        if (hold > budget) { hold -= budget; return; }
        budget -= hold;
        hold = 0;
        if (pos >= timeline.length) { pause(); return; }
        const e = timeline[pos++];
        scene.apply(e);
        hold = e.ms;
      }
    }

    function frame(t) {
      rafId = null;
      if (!playing) return;
      const dt = lastTime === null ? 0 : Math.min(t - lastTime, 100);
      lastTime = t;
      advance(dt * speed);
      draw();
      if (playing) rafId = requestAnimationFrame(frame);
    }

    function play() {
      if (pos >= timeline.length) reset();
      playing = true;
      lastTime = null;
      if (rafId === null) rafId = requestAnimationFrame(frame);
      draw();
    }

    function pause() {
      playing = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    }

    function draw() {
      scene.render();
      if (active === player) drawShared();
    }

    return player;
  }

  const players = { grid: createPlayer(GridScene), link: createPlayer(LinkScene) };

  // Narration, header stats and control states for the active scene.
  function drawShared() {
    const { scene } = active;
    $('v-title').textContent = scene.title;
    $('v-text').textContent = scene.text;
    $('v-stats').replaceChildren(...scene.stats.map(([label, value]) => {
      const span = document.createElement('span');
      span.append(`${label} `);
      const b = document.createElement('span');
      b.className = 'v-stat';
      b.textContent = value;
      span.append(b);
      return span;
    }));
    $('v-play').textContent = active.finished ? 'Replay' : active.playing ? 'Pause' : 'Play';
    $('v-step').disabled = active.finished;
    $('v-end').disabled = active.finished;
  }

  function selectTab(name) {
    if (active) active.pause();
    active = players[name];
    for (const [key, el] of [['grid', 'scene-grid'], ['link', 'scene-link']]) {
      $(el).hidden = key !== name;
      const tab = $(`tab-${key}`);
      tab.setAttribute('aria-selected', String(key === name));
      tab.tabIndex = key === name ? 0 : -1;
    }
    if (active.started) active.draw();
    else active.play();
  }

  function start(p) {
    for (const pl of Object.values(players)) pl.load(p);
    active = null;
    selectTab('grid');
  }

  function stop() {
    for (const pl of Object.values(players)) pl.pause();
  }

  $('v-play').addEventListener('click', () => {
    if (active.playing) { active.pause(); active.draw(); } else active.play();
  });
  $('v-step').addEventListener('click', () => active.step());
  $('v-end').addEventListener('click', () => active.skipToEnd());
  $('v-restart').addEventListener('click', () => { active.reset(); active.play(); });
  $('v-speed').addEventListener('change', (e) => { speed = parseFloat(e.target.value) || 1; });
  $('tab-grid').addEventListener('click', () => selectTab('grid'));
  $('tab-link').addEventListener('click', () => selectTab('link'));
  // Arrow keys move between tabs, as in the ARIA tabs pattern.
  $('v-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = active === players.grid ? 'link' : 'grid';
    selectTab(next);
    $(`tab-${next}`).focus();
  });

  window.Visualizer = { start, stop };
})();
