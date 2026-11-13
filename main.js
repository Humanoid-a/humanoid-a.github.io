/* ==========================================================
   humanoid-a.github.io — vanilla JS, no build step.
   1. theme toggle      4. scroll reveal
   2. typing tagline    5. hero: A* + lidar navigation agent
   3. nav state         6. terminal easter egg
   ========================================================== */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  $('#year').textContent = new Date().getFullYear();

  /* ---------- 1. theme ---------- */
  const root = document.documentElement;
  const sysLight = matchMedia('(prefers-color-scheme: light)');
  const currentTheme = () => root.dataset.theme || (sysLight.matches ? 'light' : 'dark');
  const themeListeners = [];
  function setTheme(t) {
    root.dataset.theme = t;
    store.set('theme', t);
    themeListeners.forEach(fn => fn());
  }
  $('#theme-toggle').addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  sysLight.addEventListener('change', () => themeListeners.forEach(fn => fn()));

  /* ---------- 2. typing tagline ---------- */
  const phrases = [
    'I build agents that see, navigate, and learn.',
    'embodied AI · world models · robot navigation',
    'researcher @ UW Robot Learning Lab',
    'shipped a game on Steam, once.',
  ];
  const typer = $('#typer');
  if (reducedMotion) {
    typer.textContent = phrases[0];
  } else {
    let pi = 0, ci = 0, deleting = false;
    (function tick() {
      const p = phrases[pi];
      ci += deleting ? -1 : 1;
      typer.textContent = p.slice(0, ci) || ' ';
      let delay = deleting ? 28 : 55 + Math.random() * 40;
      if (!deleting && ci === p.length) { deleting = true; delay = 2200; }
      else if (deleting && ci === 0) { deleting = false; pi = (pi + 1) % phrases.length; delay = 400; }
      setTimeout(tick, delay);
    })();
  }

  /* ---------- 3. nav state ---------- */
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const navLinks = $$('.nav-links a');
  const sectionObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['about', 'research', 'projects', 'experience', 'contact'].forEach(id => {
    const el = document.getElementById(id);
    if (el) sectionObs.observe(el);
  });

  /* ---------- 4. scroll reveal ---------- */
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach((el, i) => {
    el.style.transitionDelay = (i % 4) * 60 + 'ms';
    revealObs.observe(el);
  });

  /* ---------- 5. hero: navigation agent ---------- */
  initNavAgent();

  function initNavAgent() {
    const canvas = $('#nav-canvas');
    const hero = $('.hero');
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, CELL = 26, cols = 0, rows = 0;
    let wall, seen, visited;          // Uint8Array / Float32Array per cell
    let agent, path = [], target = null, lastPlan = 0;
    let mouse = null, mouseAt = 0, wanderTarget = null;
    let running = false, visible = true, raf = 0;
    let colors = {};

    const idx = (c, r) => r * cols + c;
    const inb = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;

    function readColors() {
      const cs = getComputedStyle(root);
      const g = n => cs.getPropertyValue(n).trim();
      colors = { accent: g('--accent'), accent2: g('--accent-2'), text: g('--text-3'), light: currentTheme() === 'light' };
    }
    themeListeners.push(() => { readColors(); if (!running) draw(performance.now()); });

    function rgba(hex, a) {
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }

    function build() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = rect.width; H = rect.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      CELL = W < 600 ? 22 : 26;
      cols = Math.ceil(W / CELL); rows = Math.ceil(H / CELL);
      wall = new Uint8Array(cols * rows);
      seen = new Float32Array(cols * rows);
      visited = new Float32Array(cols * rows);

      // Indoor-ish map: wall segments with gaps (like rooms + corridors) plus a few pillars.
      const nSeg = Math.round((cols * rows) / 55);
      for (let s = 0; s < nSeg; s++) {
        const horiz = Math.random() < 0.5;
        const len = 3 + Math.floor(Math.random() * 8);
        let c = Math.floor(Math.random() * cols), r = Math.floor(Math.random() * rows);
        for (let k = 0; k < len; k++) {
          if (inb(c, r)) wall[idx(c, r)] = 1;
          horiz ? c++ : r++;
        }
      }
      for (let p = 0; p < nSeg / 2; p++) {
        const c = Math.floor(Math.random() * cols), r = Math.floor(Math.random() * rows);
        wall[idx(c, r)] = 1;
      }
      // start somewhere free on the right side (away from the text)
      let sc = Math.floor(cols * 0.93), sr = Math.floor(rows * 0.2);
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (inb(sc + dc, sr + dr)) wall[idx(sc + dc, sr + dr)] = 0;
      agent = { x: sc + 0.5, y: sr + 0.5, trail: [] };
      path = []; target = null; wanderTarget = null;
    }

    // --- A* (8-connected, no corner cutting) with a tiny binary heap ---
    function astar(sc, sr, tc, tr) {
      const N = cols * rows, start = idx(sc, sr), goal = idx(tc, tr);
      if (wall[goal]) return null;
      const g = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const heap = []; // [f, node]
      const push = (f, n) => {
        heap.push([f, n]); let i = heap.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
      };
      const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last; let i = 0;
          for (;;) {
            const l = 2 * i + 1, r = l + 1; let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
          }
        }
        return top;
      };
      const h = (c, r) => { const dx = Math.abs(c - tc), dy = Math.abs(r - tr); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
      g[start] = 0; push(h(sc, sr), start);
      const now = performance.now();
      while (heap.length) {
        const [, n] = pop();
        if (closed[n]) continue;
        closed[n] = 1; visited[n] = now;
        if (n === goal) break;
        const c = n % cols, r = (n / cols) | 0;
        for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
          if (!dc && !dr) continue;
          const nc = c + dc, nr = r + dr;
          if (!inb(nc, nr)) continue;
          const m = idx(nc, nr);
          if (wall[m] || closed[m]) continue;
          if (dc && dr && (wall[idx(c + dc, r)] || wall[idx(c, r + dr)])) continue;
          const ng = g[n] + (dc && dr ? Math.SQRT2 : 1);
          if (ng < g[m]) { g[m] = ng; came[m] = n; push(ng + h(nc, nr), m); }
        }
      }
      if (came[goal] === -1 && goal !== start) return null;
      const out = [];
      for (let n = goal; n !== -1 && n !== start; n = came[n]) out.push({ x: (n % cols) + 0.5, y: ((n / cols) | 0) + 0.5 });
      return out.reverse();
    }

    function randomFree() {
      for (let t = 0; t < 200; t++) {
        const c = Math.floor(Math.random() * cols), r = Math.floor(Math.random() * rows);
        if (!wall[idx(c, r)]) return { c, r };
      }
      return null;
    }

    function plan(now) {
      const useMouse = mouse && now - mouseAt < 4000;
      let t = useMouse ? mouse : wanderTarget;
      if (!useMouse && (!t || !path.length)) { t = wanderTarget = randomFree(); }
      if (!t) return;
      const changed = !target || target.c !== t.c || target.r !== t.r;
      if (!changed && path.length) return;
      if (!changed && Math.floor(agent.x) === t.c && Math.floor(agent.y) === t.r) return; // already there
      if (now - lastPlan < 90 && path.length) return;
      lastPlan = now;
      const p = astar(Math.floor(agent.x), Math.floor(agent.y), t.c, t.r);
      target = t;
      if (p) path = p;
      else if (!useMouse) wanderTarget = null; // unreachable: pick another next frame
    }

    // --- lidar: cast rays, mark walls as "seen" ---
    const RAYS = 48, RANGE = 7;
    function lidar(now) {
      const hits = [];
      for (let i = 0; i < RAYS; i++) {
        const a = (i / RAYS) * Math.PI * 2 + now * 0.0004;
        const dx = Math.cos(a), dy = Math.sin(a);
        let d = 0, hx = agent.x, hy = agent.y, hit = false;
        while (d < RANGE) {
          d += 0.2; hx = agent.x + dx * d; hy = agent.y + dy * d;
          const c = Math.floor(hx), r = Math.floor(hy);
          if (!inb(c, r)) break;
          if (wall[idx(c, r)]) { seen[idx(c, r)] = now; hit = true; break; }
        }
        hits.push({ x: hx, y: hy, hit });
      }
      return hits;
    }

    function step(dt) {
      if (!path.length) return;
      const speed = 6.5; // cells / s
      let move = speed * dt;
      while (move > 0 && path.length) {
        const n = path[0], dx = n.x - agent.x, dy = n.y - agent.y, d = Math.hypot(dx, dy);
        if (d <= move) { agent.x = n.x; agent.y = n.y; path.shift(); move -= d; }
        else { agent.x += (dx / d) * move; agent.y += (dy / d) * move; move = 0; }
      }
      agent.trail.push({ x: agent.x, y: agent.y });
      if (agent.trail.length > 40) agent.trail.shift();
    }

    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      const A = colors.accent, A2 = colors.accent2, T = colors.text, L = colors.light;

      // grid dots
      ctx.fillStyle = rgba(T, L ? 0.28 : 0.22);
      for (let c = 0; c <= cols; c++) for (let r = 0; r <= rows; r++) ctx.fillRect(c * CELL - 0.75, r * CELL - 0.75, 1.5, 1.5);

      // A* explored cells (fade out)
      for (let i = 0; i < visited.length; i++) {
        const age = now - visited[i];
        if (age < 700) {
          ctx.fillStyle = rgba(A2, 0.10 * (1 - age / 700));
          ctx.fillRect((i % cols) * CELL + 1, ((i / cols) | 0) * CELL + 1, CELL - 2, CELL - 2);
        }
      }

      // walls: faint when unknown, bright when recently seen by lidar
      for (let i = 0; i < wall.length; i++) {
        if (!wall[i]) continue;
        const age = now - seen[i];
        const k = seen[i] ? Math.max(0, 1 - age / 6000) : 0;
        ctx.fillStyle = rgba(T, (L ? 0.10 : 0.09) + 0.08 * k);
        const x = (i % cols) * CELL, y = ((i / cols) | 0) * CELL;
        ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
        if (k > 0) { ctx.strokeStyle = rgba(A, 0.55 * k); ctx.lineWidth = 1; ctx.strokeRect(x + 2.5, y + 2.5, CELL - 5, CELL - 5); }
      }

      const P = v => v * CELL;
      if (agent) {
        // lidar rays
        const hits = running ? lidar(now) : [];
        ctx.lineWidth = 1;
        for (const h of hits) {
          ctx.strokeStyle = rgba(A, 0.07);
          ctx.beginPath(); ctx.moveTo(P(agent.x), P(agent.y)); ctx.lineTo(P(h.x), P(h.y)); ctx.stroke();
          if (h.hit) { ctx.fillStyle = rgba(A, 0.8); ctx.fillRect(P(h.x) - 1.5, P(h.y) - 1.5, 3, 3); }
        }

        // planned path
        if (path.length) {
          ctx.strokeStyle = rgba(A, 0.6); ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
          ctx.beginPath(); ctx.moveTo(P(agent.x), P(agent.y));
          for (const n of path) ctx.lineTo(P(n.x), P(n.y));
          ctx.stroke(); ctx.setLineDash([]);
        }

        // goal marker
        if (target) {
          const gx = P(target.c + 0.5), gy = P(target.r + 0.5), s = 6 + Math.sin(now / 250) * 1.5;
          ctx.strokeStyle = rgba(A2, 0.8); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(gx - s, gy); ctx.lineTo(gx + s, gy); ctx.moveTo(gx, gy - s); ctx.lineTo(gx, gy + s); ctx.stroke();
          ctx.beginPath(); ctx.arc(gx, gy, s + 3, 0, Math.PI * 2); ctx.stroke();
        }

        // trail
        for (let i = 0; i < agent.trail.length; i++) {
          const t = agent.trail[i];
          ctx.fillStyle = rgba(A, (i / agent.trail.length) * 0.35);
          ctx.beginPath(); ctx.arc(P(t.x), P(t.y), 2, 0, Math.PI * 2); ctx.fill();
        }

        // agent
        const ax = P(agent.x), ay = P(agent.y);
        const glow = ctx.createRadialGradient(ax, ay, 0, ax, ay, 26);
        glow.addColorStop(0, rgba(A, 0.35)); glow.addColorStop(1, rgba(A, 0));
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ax, ay, 26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = A; ctx.beginPath(); ctx.arc(ax, ay, 5.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    let last = performance.now();
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      plan(now); step(dt); draw(now);
      raf = requestAnimationFrame(loop);
    }
    function start() { if (running || reducedMotion) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
    function stop() { running = false; cancelAnimationFrame(raf); }

    // --- input ---
    function cellFromEvent(x, y) {
      const r = canvas.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
      return { c: Math.floor((x - r.left) / CELL), r: Math.floor((y - r.top) / CELL) };
    }
    addEventListener('mousemove', e => {
      const c = cellFromEvent(e.clientX, e.clientY);
      if (c && inb(c.c, c.r)) { mouse = c; mouseAt = performance.now(); }
    }, { passive: true });
    hero.addEventListener('touchstart', e => {
      const t = e.touches[0], c = cellFromEvent(t.clientX, t.clientY);
      if (c && inb(c.c, c.r)) { mouse = c; mouseAt = performance.now(); }
    }, { passive: true });
    canvas.addEventListener('click', e => {
      const c = cellFromEvent(e.clientX, e.clientY);
      if (!c || !inb(c.c, c.r)) return;
      if (Math.floor(agent.x) === c.c && Math.floor(agent.y) === c.r) return;
      const i = idx(c.c, c.r);
      wall[i] = wall[i] ? 0 : 1; seen[i] = performance.now();
      path = []; target = null; // force a replan around the change
      if (!running) draw(performance.now());
    });

    let resizeT;
    addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => { build(); if (!running) draw(performance.now()); }, 150);
    });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible && !document.hidden ? start() : stop(); }).observe(hero);
    document.addEventListener('visibilitychange', () => { document.hidden || !visible ? stop() : start(); });

    readColors(); build();
    if (reducedMotion) draw(performance.now()); else start();
  }

  /* ---------- 6. terminal ---------- */
  const term = $('#term'), body = $('#term-body'), input = $('#term-in'), form = $('#term-form');
  const hist = []; let hi = 0, booted = false;
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text || href}</a>`;
  const print = (html, cls = 'out') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; body.appendChild(d); body.scrollTop = body.scrollHeight; };
  const go = id => { closeTerm(); document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' }); };

  const LINKS = {
    github: 'https://github.com/Humanoid-a',
    linkedin: 'https://www.linkedin.com/in/andyxw',
    email: 'mailto:andyxw@uw.edu',
    resume: 'docs/Wang_Resume_261112.pdf',
    steam: 'https://store.steampowered.com/app/3327910/Trigonomis/',
    bilibili: 'https://space.bilibili.com/481586636',
    novicereader: 'https://novicereader.com/',
  };

  const commands = {
    help: () => print(
`<span class="hl">available commands</span>
  whoami        who is this guy
  neofetch      system info, but it's me
  ls            list sections
  cd &lt;section&gt;  jump to a section (about, research, projects, experience, contact)
  cat interests what I'm into
  projects      things I've shipped
  open &lt;name&gt;   github | linkedin | email | resume | steam | bilibili | novicereader
  theme [l|d]   toggle light / dark
  history       command history
  clear         clear screen
  exit          close terminal`),
    whoami: () => print(`Andy Xu Wang: CS @ University of Washington.\nUndergrad researcher in the Robot Learning Lab (indoor navigation agents)\nand on the ARUW vision team (autonomous sentry robot, ROS2).`),
    neofetch: () => print(
`<span class="hl">       ▄▄▄▄▄▄▄       </span>  <span class="hl">andy</span>@<span class="hl">uw</span>
<span class="hl">     ▄█▀     ▀█▄     </span>  ----------------
<span class="hl">    ██  ▄▀▀▀▄  ██    </span>  <span class="hl2">OS</span>:      Human 19.x (Seattle build)
<span class="hl">    ██  █ ● █  ██    </span>  <span class="hl2">Host</span>:    University of Washington, CS '29
<span class="hl">    ██  ▀▄▄▄▀  ██    </span>  <span class="hl2">Kernel</span>:  embodied-ai
<span class="hl">     ▀█▄     ▄█▀     </span>  <span class="hl2">Uptime</span>:  coding since a TABS mod in 2021
<span class="hl">       ▀▀▀▀▀▀▀       </span>  <span class="hl2">Shell</span>:   python, c++, c#, java
                       <span class="hl2">Packages</span>: pytorch, ros2, docker, django
                       <span class="hl2">Locale</span>:  en_US, zh_CN, ja_JP
                       <span class="hl2">GPU</span>:     always busy`),
    ls: () => print(`<span class="hl">about/</span>  <span class="hl">now/</span>  <span class="hl">research/</span>  <span class="hl">projects/</span>  <span class="hl">experience/</span>  <span class="hl">beyond/</span>  <span class="hl">contact/</span>  resume.pdf`),
    cd: a => {
      const s = (a[0] || '').replace(/\/$/, '').replace(/^\.\//, '');
      if (!s || s === '~') return print('already home.');
      if (s === '..') return print('nice try. there is nothing above home.');
      if (document.getElementById(s)) return go(s);
      print(`cd: no such section: ${esc(s)}`, 'err');
    },
    cat: a => {
      const f = (a[0] || '').toLowerCase();
      if (f === 'interests' || f === 'interests.txt') return print('embodied AI · world models · online learning · recursive self-improvement · NLP\nautonomous navigation · RL · multimodal LLMs / VLMs · 3D reconstruction');
      if (f === 'resume.pdf') return print(`binary file. try: ${link(LINKS.resume, 'open resume')}`);
      print(`cat: ${esc(f || '(nothing)')}: no such file. try "cat interests"`, 'err');
    },
    projects: () => print(
`${link(LINKS.steam, 'Trigonomis')}       2D shooter in Unity, released on Steam
${link(LINKS.novicereader, 'NoviceReader')}     paper reader that explains at your level
${link('https://github.com/Humanoid-a/aruwpaperio', 'paperio-rl')}       RL agent for a territory game (POMDP)
${link('http://www.gpeclub.com/', 'GPE Club')}         club site, GPE-Hub app, Chrome extension
${link('https://github.com/Humanoid-a/QAE', 'QAE')}              query auto-encoder for clinical retrieval`),
    open: a => {
      const k = (a[0] || '').toLowerCase();
      if (!LINKS[k]) return print(`open: unknown target "${esc(k)}". options: ${Object.keys(LINKS).join(', ')}`, 'err');
      print(`opening ${k}…`); window.open(LINKS[k], k === 'email' ? '_self' : '_blank', 'noopener');
    },
    theme: a => {
      const t = (a[0] || '')[0];
      setTheme(t === 'l' ? 'light' : t === 'd' ? 'dark' : currentTheme() === 'dark' ? 'light' : 'dark');
      print(`theme → ${currentTheme()}`);
    },
    history: () => print(hist.map((h, i) => `${String(i + 1).padStart(3)}  ${esc(h)}`).join('\n') || '(empty)'),
    clear: () => { body.innerHTML = ''; },
    exit: () => closeTerm(),
    pwd: () => print('/home/andy'),
    date: () => print(new Date().toString()),
    echo: a => print(esc(a.join(' '))),
    sudo: a => print(a.join(' ').includes('hire') ? `permission granted ✓ → ${link(LINKS.email, 'andyxw@uw.edu')}` : 'andy is not in the sudoers file. This incident will be reported.', a.join(' ').includes('hire') ? 'out' : 'err'),
    rm: () => print('nope.', 'err'),
    vim: () => print('you are now trapped in vim. (just kidding, type "exit")'),
    hello: () => print('hi! 👋 type "help" to look around.'),
  };
  commands.hi = commands.hello;
  commands.about = commands.whoami;
  commands.man = commands.help;
  commands['?'] = commands.help;

  function run(line) {
    const raw = line.trim();
    print(esc(raw), 'cmd');
    if (!raw) return;
    hist.push(raw); hi = hist.length;
    const [cmd, ...args] = raw.split(/\s+/);
    const fn = commands[cmd.toLowerCase()];
    fn ? fn(args) : print(`command not found: ${esc(cmd)}. type "help".`, 'err');
  }

  function openTerm() {
    term.hidden = false;
    if (!booted) {
      booted = true;
      print(`<span class="hl">andy-os</span> v1.0, last login: ${new Date().toDateString()}\ntype <span class="hl">help</span> to get started. <span class="hl">tab</span> autocompletes, <span class="hl">↑/↓</span> for history, <span class="hl">esc</span> to close.\n`);
    }
    setTimeout(() => input.focus(), 10);
  }
  function closeTerm() { term.hidden = true; }

  $('#term-open').addEventListener('click', openTerm);
  $('#term-close').addEventListener('click', closeTerm);
  term.addEventListener('mousedown', e => { if (e.target === term) closeTerm(); });
  form.addEventListener('submit', e => { e.preventDefault(); run(input.value); input.value = ''; });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); if (hi > 0) input.value = hist[--hi]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const v = input.value, parts = v.split(/\s+/);
      const pool = parts.length > 1
        ? (parts[0] === 'open' ? Object.keys(LINKS) : parts[0] === 'cd' ? ['about', 'now', 'research', 'projects', 'experience', 'beyond', 'contact'] : parts[0] === 'cat' ? ['interests'] : [])
        : Object.keys(commands);
      const last = parts[parts.length - 1];
      const m = pool.filter(p => p.startsWith(last));
      if (m.length === 1) { parts[parts.length - 1] = m[0]; input.value = parts.join(' ') + (parts.length === 1 ? ' ' : ''); }
      else if (m.length > 1) print(m.join('  '));
    }
  });
  addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement !== input;
    if (e.key === 'Escape' && !term.hidden) closeTerm();
    else if ((e.key === '`' || e.key === '~') && term.hidden && !typing) { e.preventDefault(); openTerm(); }
  });
})();
