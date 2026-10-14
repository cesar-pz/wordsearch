// Duck theme, shared with Ducktionary: sunny day / starry night, wandering
// ASCII ducks, and the theme / ducks / motion toggles.
(function () {
  'use strict';

  // ASCII ducks drawn facing left; flipped with CSS when heading right.
  // Each sprite has two frames that alternate (waddling feet / flickering thrusters).
  const DAY_DUCK_FRAMES = [
    [
      '   __',
      ' <(o )___',
      '  ( ._> /',
      '   `---\'',
      '    /  \\',
    ],
    [
      '   __',
      ' <(o )___',
      '  ( ._> /',
      '   `---\'',
      '    |  |',
    ],
  ];

  const SPACE_DUCK_SPRITES = [
    // Flying saucer duck
    [
      [
        '      __',
        '    <(o )___',
        '  .-( ._> /-.',
        ' (___`---\'___)',
        '   \'-......-\'',
        '    \' ^ \' ^ \'',
      ],
      [
        '      __',
        '    <(o )___',
        '  .-( ._> /-.',
        ' (___`---\'___)',
        '   \'-......-\'',
        '    ^ \' ^ \' ^',
      ],
    ],
    // Rocket-pack duck
    [
      [
        '   __',
        ' <(o )___',
        '  ( ._> /[]==-',
        '   `---\'  ~*~',
      ],
      [
        '   __',
        ' <(o )___',
        '  ( ._> /[]=-~',
        '   `---\'  *~*',
      ],
    ],
  ];

  class DuckParade {
    constructor(container) {
      this.container = container;
      this.ducks = [];
      this.isNight = false;
      this.lastTime = null;
      this.enabled = true;
      this.animated = true;
      this.frameId = null;
      this.tick = this.tick.bind(this);

      // Re-scatter the ducks when the window size changes
      window.addEventListener('resize', () => {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => this.spawn(), 250);
      });
    }

    setMode(isNight) {
      this.isNight = isNight;
      this.spawn();
      this.updateLoop();
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      this.container.hidden = !enabled;
      this.updateLoop();
    }

    setAnimated(animated) {
      this.animated = animated;
      this.updateLoop();
    }

    // Only run the animation loop while ducks are both visible and allowed to move
    updateLoop() {
      const shouldRun = this.enabled && this.animated;
      if (shouldRun && this.frameId === null) {
        this.lastTime = null;
        this.frameId = requestAnimationFrame(this.tick);
      } else if (!shouldRun && this.frameId !== null) {
        cancelAnimationFrame(this.frameId);
        this.frameId = null;
      }
    }

    spawn() {
      this.container.replaceChildren();
      this.ducks = [];
      const width = window.innerWidth;
      const height = window.innerHeight;
      const count = width < 600 ? 3 : 6;

      for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = this.isNight ? 'duck space-duck' : 'duck day-duck';
        const art = document.createElement('pre');
        art.className = 'duck-art';
        // Random phase so ducks don't waddle in sync. A variable, not an inline
        // animation-delay, so it doesn't also offset the backflip.
        art.style.setProperty('--phase', `${Math.random() * -2}s`);
        el.appendChild(art);
        this.container.appendChild(el);

        const frames = this.isNight
          ? SPACE_DUCK_SPRITES[Math.floor(Math.random() * SPACE_DUCK_SPRITES.length)]
          : DAY_DUCK_FRAMES;
        const speed = this.isNight ? 40 + Math.random() * 50 : 18 + Math.random() * 22;
        const duck = {
          el,
          art,
          frames,
          frame: 0,
          frameTimer: 0,
          x: Math.random() * width,
          // Day ducks stroll along the lower part of the screen; space ducks roam anywhere
          y: this.isNight ? Math.random() * (height - 80) : height * (0.55 + Math.random() * 0.35),
          baseY: 0,
          dir: Math.random() < 0.5 ? -1 : 1,
          speed,
          pause: 0,
          phase: Math.random() * Math.PI * 2,
        };
        duck.baseY = duck.y;
        art.textContent = frames[0].join('\n');
        this.ducks.push(duck);
        this.render(duck);
      }
    }

    tick(time) {
      const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, 0.1);
      this.lastTime = time;
      const width = window.innerWidth;

      for (const duck of this.ducks) {
        if (this.isNight) this.flySpaceDuck(duck, dt, width);
        else this.walkDayDuck(duck, dt, width);
        this.render(duck);
      }

      this.frameId = requestAnimationFrame(this.tick);
    }

    walkDayDuck(duck, dt, width) {
      if (duck.pause > 0) {
        duck.pause -= dt;
        duck.el.classList.add('resting');
        return;
      }
      duck.el.classList.remove('resting');

      duck.x += duck.dir * duck.speed * dt;
      const duckWidth = duck.el.offsetWidth || 70;
      if (duck.x < 0) {
        duck.x = 0;
        duck.dir = 1;
      } else if (duck.x > width - duckWidth) {
        duck.x = width - duckWidth;
        duck.dir = -1;
      }

      // Now and then, stop to look around or wander the other way
      if (Math.random() < dt * 0.15) {
        duck.pause = 1 + Math.random() * 2.5;
      } else if (Math.random() < dt * 0.08) {
        duck.dir *= -1;
      }

      this.advanceFrame(duck, dt, 0.25);
    }

    flySpaceDuck(duck, dt, width) {
      duck.x += duck.dir * duck.speed * dt;
      duck.phase += dt * 1.5;
      duck.y = duck.baseY + Math.sin(duck.phase) * 25;

      // Warp across the screen edges
      const duckWidth = duck.el.offsetWidth || 120;
      if (duck.dir < 0 && duck.x < -duckWidth) {
        duck.x = width;
        duck.baseY = Math.random() * (window.innerHeight - 80);
      } else if (duck.dir > 0 && duck.x > width) {
        duck.x = -duckWidth;
        duck.baseY = Math.random() * (window.innerHeight - 80);
      }

      this.advanceFrame(duck, dt, 0.15);
    }

    advanceFrame(duck, dt, interval) {
      duck.frameTimer += dt;
      if (duck.frameTimer >= interval) {
        duck.frameTimer = 0;
        duck.frame = (duck.frame + 1) % duck.frames.length;
        duck.art.textContent = duck.frames[duck.frame].join('\n');
      }
    }

    // Every duck backflips at once: one class on the duck layer drives the
    // animation for all of them.
    backflip() {
      if (!this.enabled || !this.animated) return;
      const FLIP_MS = 900;
      const width = window.innerWidth;
      for (const duck of this.ducks) {
        // Space ducks can be off-screen mid-warp; pull them just inside the edge.
        const w = duck.el.offsetWidth || 120;
        duck.x = Math.min(Math.max(duck.x, 0), width - w);
        duck.pause = FLIP_MS / 1000 + 0.2; // day ducks stop walking to flip
        this.render(duck);
      }
      clearTimeout(this.flipTimeout);
      this.container.classList.remove('backflip');
      void this.container.offsetWidth; // restart if it's already flipping
      this.container.classList.add('backflip');
      this.flipTimeout = setTimeout(() => this.container.classList.remove('backflip'), FLIP_MS + 100);
    }

    render(duck) {
      duck.el.style.transform = `translate(${duck.x}px, ${duck.y}px)`;
      duck.art.classList.toggle('flipped', duck.dir > 0);
    }
  }

  // Same keys as Ducktionary, so preferences carry over when both games are
  // served from the same origin.
  function loadPref(key) {
    try { return localStorage.getItem(`ducktionary-${key}`); } catch { return null; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(`ducktionary-${key}`, value); } catch { /* ignore */ }
  }

  function createStarfield(starfield) {
    const STAR_COUNT = 140;
    for (let i = 0; i < STAR_COUNT; i++) {
      const star = document.createElement('span');
      star.className = Math.random() < 0.15 ? 'star sparkle' : 'star';
      const size = Math.random() * 2.5 + 0.5;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.animationDelay = `${Math.random() * 4}s`;
      star.style.animationDuration = `${Math.random() * 3 + 2}s`;
      starfield.appendChild(star);
    }
  }

  let parade = null;
  window.Ducks = { backflip: () => parade && parade.backflip() };

  function init() {
    const themeToggle = document.getElementById('theme-toggle');
    const ducksToggle = document.getElementById('ducks-toggle');
    const motionToggle = document.getElementById('motion-toggle');
    parade = new DuckParade(document.getElementById('duckfield'));
    createStarfield(document.getElementById('starfield'));

    let ducksOn = true;
    let motionOn = true;

    function setTheme(isNight) {
      document.body.classList.toggle('night', isNight);
      parade.setMode(isNight);
      themeToggle.textContent = isNight ? '☀️' : '🌙';
      themeToggle.setAttribute('aria-label', isNight ? 'Switch to day mode' : 'Switch to night mode');
      themeToggle.title = themeToggle.getAttribute('aria-label');
    }

    function setDucks(enabled) {
      ducksOn = enabled;
      parade.setEnabled(enabled);
      ducksToggle.setAttribute('aria-pressed', String(enabled));
      ducksToggle.setAttribute('aria-label', enabled ? 'Hide ducks' : 'Show ducks');
      ducksToggle.title = ducksToggle.getAttribute('aria-label');
    }

    function setMotion(enabled) {
      motionOn = enabled;
      document.body.classList.toggle('no-motion', !enabled);
      parade.setAnimated(enabled);
      motionToggle.setAttribute('aria-pressed', String(enabled));
      motionToggle.setAttribute('aria-label', enabled ? 'Turn off animations' : 'Turn on animations');
      motionToggle.title = motionToggle.getAttribute('aria-label');
    }

    const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
    const savedTheme = loadPref('theme');
    const savedDucks = loadPref('ducks');
    const savedMotion = loadPref('motion');
    setDucks(savedDucks ? savedDucks === 'on' : true);
    setMotion(savedMotion ? savedMotion === 'on' : !mq('(prefers-reduced-motion: reduce)'));
    setTheme(savedTheme ? savedTheme === 'night' : mq('(prefers-color-scheme: dark)'));

    themeToggle.addEventListener('click', () => {
      const isNight = !document.body.classList.contains('night');
      setTheme(isNight);
      savePref('theme', isNight ? 'night' : 'day');
    });
    ducksToggle.addEventListener('click', () => {
      setDucks(!ducksOn);
      savePref('ducks', ducksOn ? 'on' : 'off');
    });
    motionToggle.addEventListener('click', () => {
      setMotion(!motionOn);
      savePref('motion', motionOn ? 'on' : 'off');
    });
  }

  init();
})();
