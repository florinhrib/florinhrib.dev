/*! pixel-portrait.js: a Canvas 2D stepped mosaic for a portrait. No dependencies, no network.
 *
 * Markup (works with no JavaScript: the plain sharp <img> is the content):
 *   <div class="pp" data-pixel-portrait>
 *     <img src="portrait.jpg" width="900" height="900" alt="Real alt text">   (or a <picture> with AVIF/WebP/JPEG)
 *   </div>
 *
 * What the script adds: one aria-hidden <canvas> over the img. At rest the canvas is transparent and the
 * real img shows, so the resting state is always the browser's own sharp rendering of the photo.
 * Hover (with intent), keyboard focus or a tap steps the mosaic 2, 4, 8, 16 CSS px (on a 280 px frame);
 * leaving reassembles it, ending in a short cross-dissolve into the real photo.
 *
 * Block colours are exact area averages computed once in linear light, on a grid anchored at the frame
 * centre so every block of one level is exactly 2x2 blocks of the level below (the blocks visibly merge
 * and split instead of jumping). Per frame the work is one drawImage of a tiny canvas, only when the
 * level changes; between changes only the canvas opacity is set.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    peakCols: 18,     // target blocks across the frame at full pixelation; blocks are whole device px that double per
                      // level, so the level count is chosen to land nearest this (16 CSS px blocks on a 280 px frame)
    levels: 4,        // nested steps; each step doubles the block size
    inMs: 280,        // pixelate duration (hover in), full range
    outMs: 560,       // reassemble duration (hover out), full range
    ease: [0, 0, 0.58, 1], // CSS ease-out: every step stays on screen for at least 3 frames
    fadeSpan: 0.5,    // part of the first step spent cross-dissolving between the photo and the finest mosaic
    intentMs: 80,     // hover intent: poll interval ...
    intentPx: 10,     // ... trigger once the pointer moved less than this between polls ...
    dwellMs: 240,     // ... or once it has stayed this long
    rmMs: 200,        // prefers-reduced-motion: plain opacity cross-fade, no stepping
    rmLevel: 3,       // reduced motion: the single mosaic level faded to (8 CSS px on a 280 px frame)
    holdMs: 260,      // tap or autoplay pulse: time held at full pixelation
    touchAutoplay: true, // hover:none devices: one pulse when the portrait is first 60 percent in view
    keyboard: true,   // make the frame focusable (role img, named by the alt); focus pixelates, blur reassembles
    maxSide: 2048     // safety cap for the canvas backing store (device px)
  };

  // ---- small helpers -------------------------------------------------------------------------
  function cubicBezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i, e, d;
      for (i = 0; i < 8; i++) {
        e = sx(t) - x;
        if (Math.abs(e) < 1e-6) return sy(t);
        d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      var lo = 0, hi = 1; t = x;
      while (hi - lo > 1e-6) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  }

  var S2L = new Float32Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i / 255;
    S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function l2s(v) {
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  function pct(s, fallback) {
    var m = /(-?[\d.]+)%/.exec(s || '');
    return m ? parseFloat(m[1]) / 100 : fallback;
  }
  function readOptions(el) {
    var o = {}, k, v, ds = el.dataset;
    for (k in DEFAULTS) {
      var key = 'pp' + k.charAt(0).toUpperCase() + k.slice(1); // data-pp-in-ms -> ppInMs
      if (ds[key] == null) continue;
      v = ds[key];
      o[k] = Array.isArray(DEFAULTS[k]) ? v.split(',').map(parseFloat)
           : typeof DEFAULTS[k] === 'number' ? parseFloat(v)
           : typeof DEFAULTS[k] === 'boolean' ? v !== 'false' : v;
    }
    return o;
  }
  var idle = window.requestIdleCallback ? function (f) { return requestIdleCallback(f, { timeout: 400 }); }
                                        : function (f) { return setTimeout(f, 30); };
  function release(cv) { if (cv) { cv.width = 1; cv.height = 1; } } // Safari keeps canvas memory around otherwise

  // ---- the component ----------------------------------------------------------------------------
  function PixelPortrait(root, options) {
    var self = this;
    this.root = root;
    this.img = root.querySelector('img');
    this.o = Object.assign({}, DEFAULTS, readOptions(root), options || {});
    this.ease = cubicBezier.apply(null, this.o.ease);
    this.p = 0; this.target = 0; this.from = 0; this.t0 = 0; this.dur = 0; this.raf = 0;
    this.grid = null; this.drawn = -1; this.opacity = -1; this.pending = 0; this.dev = null;
    this.rmq = matchMedia('(prefers-reduced-motion: reduce)');
    this.rm = this.rmq.matches;

    var cv = this.canvas = document.createElement('canvas');
    cv.className = 'pp-canvas';
    cv.setAttribute('aria-hidden', 'true');
    cv.setAttribute('role', 'presentation');
    root.appendChild(cv);
    this.ctx = cv.getContext('2d');
    if (!this.ctx) { cv.remove(); return; }

    this.tick = function (now) { self.step(now); };
    this.bind();
    this.observeSize();
    this.whenImageReady();
    root.pixelPortrait = this;
  }

  PixelPortrait.prototype.bind = function () {
    var self = this, root = this.root, o = this.o;
    var intentTimer = 0, enterT = 0, ix = 0, iy = 0, lx = 0, ly = 0;

    function check() {
      var now = performance.now();
      if (now - enterT >= o.dwellMs || Math.hypot(lx - ix, ly - iy) < o.intentPx) { intentTimer = 0; self.to(1); return; }
      ix = lx; iy = ly;
      intentTimer = setTimeout(check, o.intentMs);
    }
    root.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      if (self.p > 0) { self.to(1); return; } // re-entering mid-reassembly: reverse at once, never jump
      enterT = performance.now(); ix = lx = e.clientX; iy = ly = e.clientY;
      clearTimeout(intentTimer); intentTimer = setTimeout(check, o.intentMs);
    });
    root.addEventListener('pointermove', function (e) { lx = e.clientX; ly = e.clientY; });
    root.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      clearTimeout(intentTimer); intentTimer = 0;
      if (!self.hasFocusVisible()) self.to(0);
    });
    // Touch: a tap (pointerup without a scroll, which would fire pointercancel instead) plays one pulse.
    root.addEventListener('pointerup', function (e) { if (e.pointerType === 'touch') self.pulse(); });

    if (o.keyboard) {
      // A focus stop needs a role and a name (WCAG 4.1.2): expose the frame as the image it
      // shows, named by the img's own alt text. Focus pixelates, blur reassembles.
      if (!root.hasAttribute('tabindex')) root.tabIndex = 0;
      root.setAttribute('role', 'img');
      this.img.setAttribute('aria-hidden', 'true'); // the frame carries the name; one image in the tree
      var name = function () { root.setAttribute('aria-label', self.img.getAttribute('alt') || 'Portrait'); };
      name();
      this.img.addEventListener('load', name);
      root.addEventListener('focus', function () { if (self.hasFocusVisible()) self.to(1); });
      root.addEventListener('blur', function () { self.to(0); });
    }

    var onRm = function () { self.rm = self.rmq.matches; self.from = self.p = self.target; self.drawn = -1; self.render(); };
    if (this.rmq.addEventListener) this.rmq.addEventListener('change', onRm);

    if (o.touchAutoplay && matchMedia('(hover: none)').matches && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        if (!self.rm) self.whenReady(function () { setTimeout(function () { self.pulse(); }, 150); });
      }, { threshold: 0.6 });
      io.observe(root);
    }
    this.img.addEventListener('load', function () { self.whenImageReady(); }); // src, srcset or <source> changed
  };

  PixelPortrait.prototype.hasFocusVisible = function () {
    try { return this.root.matches(':focus-visible'); } catch (e) { return document.activeElement === this.root; }
  };

  // ---- sizing: exact device pixels, follows resize and devicePixelRatio changes ------------------
  PixelPortrait.prototype.observeSize = function () {
    var self = this, cv = this.canvas;
    function fromCss() {
      var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      return { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), dpr: dpr };
    }
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function (entries) {
        var e = entries[0], d = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0], css = fromCss();
        // Use the exact device-pixel size only when it agrees with CSS size x DPR (within snapping).
        // Headless Chrome with an emulated deviceScaleFactor reports CSS px here, for example.
        var ok = d && Math.abs(d.inlineSize - css.w) <= 1.5 && Math.abs(d.blockSize - css.h) <= 1.5;
        self.setDev(ok ? { w: d.inlineSize, h: d.blockSize, dpr: css.dpr } : css);
      });
      try { ro.observe(cv, { box: 'device-pixel-content-box' }); } catch (err) { ro.observe(cv); }
    } else {
      window.addEventListener('resize', function () { self.setDev(fromCss()); });
    }
    // Safari has no device-pixel-content-box: watch the resolution as well (MDN devicePixelRatio pattern).
    var mq;
    (function watchDpr() {
      if (mq && mq.removeEventListener) mq.removeEventListener('change', watchDpr);
      mq = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      if (mq.addEventListener) mq.addEventListener('change', watchDpr);
      if (self.dev) self.setDev(fromCss());
    })();
    this.setDev(fromCss());
  };

  PixelPortrait.prototype.setDev = function (dev) {
    if (!dev.w || !dev.h) return;
    var k = Math.min(1, this.o.maxSide / Math.max(dev.w, dev.h));
    dev = { w: Math.max(1, Math.round(dev.w * k)), h: Math.max(1, Math.round(dev.h * k)), dpr: dev.dpr * k };
    var old = this.dev;
    if (old && old.w === dev.w && old.h === dev.h) return;
    this.dev = dev;
    this.schedule();
  };

  // ---- image readiness ---------------------------------------------------------------------------
  // decode() runs off the main thread; without it the first drawImage decodes synchronously
  // (measured: a 1200 x 1500 AVIF took 43 to 122 ms that way in Chrome).
  PixelPortrait.prototype.whenImageReady = function () {
    var self = this, img = this.img;
    if (img.complete && img.naturalWidth) {
      (img.decode ? img.decode() : Promise.resolve()).then(function () { self.schedule(); }, function () {});
    } // otherwise the 'load' listener calls this again
  };
  PixelPortrait.prototype.whenReady = function (fn) {
    if (this.grid) fn(); else (this.readyQueue || (this.readyQueue = [])).push(fn);
  };
  PixelPortrait.prototype.schedule = function () {
    var self = this;
    if (this.pending) return;
    this.pending = 1;
    idle(function () { self.pending = 0; self.build(); });
  };

  // ---- build: crop like object-fit: cover, then exact linear-light block averages per level ---------
  // Two idle tasks (crop and read, then averages), each well under the 50 ms long-task line even on a
  // 4x slower CPU; a newer build (resize, new src) cancels an unfinished one through the token.
  PixelPortrait.prototype.build = function () {
    var img = this.img, dev = this.dev, o = this.o, self = this;
    if (!dev || !img.complete || !img.naturalWidth) return;
    var t0 = performance.now(), token = this.token = (this.token || 0) + 1;
    var W = dev.w, H = dev.h;

    // 1. Source crop that matches the img's object-fit: cover and object-position.
    var cs = getComputedStyle(img), pos = (cs.objectPosition || '50% 50%').split(' ');
    var px = pct(pos[0], 0.5), py = pct(pos[1], 0.5);
    var nw = img.naturalWidth, nh = img.naturalHeight, s = Math.max(W / nw, H / nh);
    var sw = W / s, sh = H / s, sx = (nw - sw) * px, sy = (nh - sh) * py;

    var src = document.createElement('canvas');
    src.width = W; src.height = H;
    var sctx = src.getContext('2d', { willReadFrequently: true }); // CPU-backed: cheap getImageData
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);

    // 2. Grid: block sizes double per level; all grids share one origin at the anchor (frame centre).
    // Blocks are whole device px and double per level. On a small frame (the compact portrait at 1x)
    // the finest block would round up to 1 px and push the peak far past the target, so drop levels
    // while that brings the peak nearer the target (compared on a log scale).
    var L = o.levels;
    var peak = Math.max(2, W / o.peakCols);
    var b0 = Math.max(1, Math.round(peak / Math.pow(2, L - 1)));
    while (L > 2 && b0 === 1 && Math.abs(Math.log2(Math.pow(2, L - 1) / peak)) > Math.abs(Math.log2(Math.pow(2, L - 2) / peak))) L--;
    var ax = Math.round(W * pct(this.root.dataset.ppAnchorX, 0.5));
    var ay = Math.round(H * pct(this.root.dataset.ppAnchorY, 0.5));
    var levels = [], k, b;
    for (k = 0; k < L; k++) {
      b = b0 << k;
      var ox = ax - Math.ceil(ax / b) * b, oy = ay - Math.ceil(ay / b) * b;
      levels.push({ b: b, ox: ox, oy: oy, cols: Math.ceil((W - ox) / b), rows: Math.ceil((H - oy) / b) });
    }

    // 3. Exact averages. Fallback for a CORS-tainted image (getImageData throws): browser downscale.
    var data = null, t1 = performance.now();
    try { data = sctx.getImageData(0, 0, W, H).data; } catch (err) { data = null; }
    var t2 = performance.now();
    idle(function () {
      if (token !== self.token) { release(src); return; }
      self.finish(data, src, levels, W, H, b0, dev, { cropAndRead: +(t2 - t0).toFixed(1), readOnly: +(t2 - t1).toFixed(1) });
    });
  };

  PixelPortrait.prototype.finish = function (data, src, levels, W, H, b0, dev, parts) {
    var t3 = performance.now(), k, L = levels.length, cv = this.canvas;
    for (k = 0; k < L; k++) levels[k].canvas = document.createElement('canvas');
    if (data) this.averages(data, W, H, levels); else this.approximate(src, levels);
    this.mode = data ? 'exact' : 'approx';
    parts.averages = +(performance.now() - t3).toFixed(1);
    this.buildParts = parts;

    if (this.levels) for (k = 0; k < this.levels.length; k++) release(this.levels[k].canvas);
    release(src); // A only needs the tiny level canvases; the full-size crop is freed at once
    cv.width = W; cv.height = H; // also resets context state
    this.levels = levels;
    this.grid = { W: W, H: H, b0: b0, dpr: dev.dpr };
    this.buildMs = parts.cropAndRead + parts.averages; // main-thread time, excluding the idle gap
    this.drawn = -1; this.opacity = -1;
    this.render();
    this.root.classList.add('pp-ready');
    var q = this.readyQueue; this.readyQueue = null;
    if (q) q.forEach(function (f) { f(); });
    if (this.target !== this.p) this.to(this.target, true);
    this.root.dispatchEvent(new CustomEvent('pixelportrait:ready', { detail: this.state() }));
  };

  PixelPortrait.prototype.averages = function (data, W, H, levels) {
    var f = levels[0], n = f.cols * f.rows;
    var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), N = new Float32Array(n);
    var colOf = new Int32Array(W), x, y, k, j;
    for (x = 0; x < W; x++) colOf[x] = ((x - f.ox) / f.b) | 0;
    for (y = 0; y < H; y++) {
      var rowBase = (((y - f.oy) / f.b) | 0) * f.cols, i = y * W * 4;
      for (x = 0; x < W; x++, i += 4) {
        j = rowBase + colOf[x];
        var a = data[i + 3] / 255;
        R[j] += S2L[data[i]] * a; G[j] += S2L[data[i + 1]] * a; B[j] += S2L[data[i + 2]] * a; A[j] += a; N[j] += 1;
      }
    }
    var cur = { R: R, G: G, B: B, A: A, N: N };
    for (k = 0; k < levels.length; k++) {
      var lv = levels[k];
      if (k > 0) { // aggregate 2x2 children of the previous level (grids are nested)
        var pv = levels[k - 1], m = lv.cols * lv.rows;
        var nx = { R: new Float32Array(m), G: new Float32Array(m), B: new Float32Array(m), A: new Float32Array(m), N: new Float32Array(m) };
        var pc = new Int32Array(pv.cols), pr;
        for (x = 0; x < pv.cols; x++) pc[x] = Math.floor((pv.ox + x * pv.b - lv.ox) / lv.b);
        for (y = 0; y < pv.rows; y++) {
          pr = Math.floor((pv.oy + y * pv.b - lv.oy) / lv.b) * lv.cols;
          for (x = 0; x < pv.cols; x++) {
            var cIdx = y * pv.cols + x, pIdx = pr + pc[x];
            nx.R[pIdx] += cur.R[cIdx]; nx.G[pIdx] += cur.G[cIdx]; nx.B[pIdx] += cur.B[cIdx]; nx.A[pIdx] += cur.A[cIdx]; nx.N[pIdx] += cur.N[cIdx];
          }
        }
        cur = nx;
      }
      var cv = lv.canvas; cv.width = lv.cols; cv.height = lv.rows;
      var cx = cv.getContext('2d'), id = cx.createImageData(lv.cols, lv.rows), d = id.data;
      for (j = 0; j < lv.cols * lv.rows; j++) {
        var aa = cur.A[j], o4 = j * 4;
        if (aa > 0) { d[o4] = l2s(cur.R[j] / aa); d[o4 + 1] = l2s(cur.G[j] / aa); d[o4 + 2] = l2s(cur.B[j] / aa); }
        d[o4 + 3] = cur.N[j] ? Math.round(255 * aa / cur.N[j]) : 0;
      }
      cx.putImageData(id, 0, 0);
    }
  };

  PixelPortrait.prototype.approximate = function (src, levels) {
    levels.forEach(function (lv) {
      var cv = lv.canvas; cv.width = lv.cols; cv.height = lv.rows;
      var cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, lv.ox, lv.oy, lv.cols * lv.b, lv.rows * lv.b, 0, 0, lv.cols, lv.rows);
    });
  };

  // ---- animation ----------------------------------------------------------------------------------
  PixelPortrait.prototype.to = function (target, force) {
    if (!force && target === this.target && (this.raf || this.p === target)) return;
    this.target = target;
    if (!this.grid) return; // remembered; build() resumes it
    var full = this.rm ? this.o.rmMs : target > this.p ? this.o.inMs : this.o.outMs;
    this.from = this.p;
    this.t0 = performance.now();
    this.dur = Math.abs(target - this.from) * full; // reversing mid-way takes only the remaining distance
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  };

  PixelPortrait.prototype.pulse = function () {
    var self = this;
    clearTimeout(this.pulseTimer);
    this.to(1);
    this.pulseTimer = setTimeout(function () { self.to(0); },
      (this.rm ? this.o.rmMs : this.o.inMs) * (1 - this.p) + this.o.holdMs);
  };

  PixelPortrait.prototype.step = function (now) {
    var t = this.dur > 0 ? Math.min(1, Math.max(0, (now - this.t0) / this.dur)) : 1;
    var e = this.rm ? t : this.ease(t);
    this.p = this.from + (this.target - this.from) * e;
    if (t >= 1) this.p = this.target;
    this.render();
    if (t < 1) this.raf = requestAnimationFrame(this.tick);
    else this.raf = 0;
  };

  // Level and opacity are pure functions of p, so any frame can be reproduced (and reversed) exactly.
  PixelPortrait.prototype.render = function () {
    if (!this.grid) return;
    var L = this.levels.length, v = this.p * L, lvl, op;
    if (this.rm) { lvl = this.p > 0 ? Math.min(L, this.o.rmLevel) : 0; op = this.p; }
    else {
      lvl = v <= 1e-6 ? 0 : Math.min(L, Math.ceil(v - 1e-6));
      var f = Math.min(1, v / this.o.fadeSpan);
      op = f * f * (3 - 2 * f); // smoothstep
    }
    if (lvl !== this.drawn) {
      var perf = window.__ppPerf, t0 = perf ? performance.now() : 0;
      var ctx = this.ctx, g = this.grid;
      ctx.clearRect(0, 0, g.W, g.H);
      if (lvl > 0) {
        var lv = this.levels[lvl - 1];
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(lv.canvas, 0, 0, lv.cols, lv.rows, lv.ox, lv.oy, lv.cols * lv.b, lv.rows * lv.b);
      }
      this.drawn = lvl;
      if (perf) perf.push(performance.now() - t0);
    }
    op = Math.round(op * 1000) / 1000;
    if (op !== this.opacity) { this.canvas.style.opacity = op; this.opacity = op; }
  };

  // Test and debug hooks: seek('in' | 'out', fraction of the full-range animation) renders that frame.
  PixelPortrait.prototype.seek = function (dir, frac) {
    cancelAnimationFrame(this.raf); this.raf = 0;
    var e = this.rm ? frac : this.ease(frac);
    this.p = dir === 'in' ? e : 1 - e;
    this.target = this.from = this.p;
    this.render();
    return this.state();
  };
  PixelPortrait.prototype.state = function () {
    var g = this.grid, L = this.levels ? this.levels.length : this.o.levels;
    return {
      ready: !!g, mode: this.mode, reducedMotion: this.rm, p: this.p, level: this.drawn,
      opacity: this.opacity, canvasW: this.canvas.width, canvasH: this.canvas.height,
      dpr: g ? g.dpr : null, buildMs: this.buildMs, buildParts: this.buildParts,
      blocksDevicePx: g ? this.levels.map(function (l) { return l.b; }) : null,
      blocksCssPx: g ? this.levels.map(function (l) { return +(l.b / g.dpr).toFixed(2); }) : null,
      levels: L
    };
  };
  PixelPortrait.prototype.destroy = function () {
    cancelAnimationFrame(this.raf);
    if (this.levels) this.levels.forEach(function (l) { release(l.canvas); });
    release(this.canvas);
    this.canvas.remove();
  };

  // ---- boot: progressive enhancement only --------------------------------------------------------
  function boot() {
    var test = document.createElement('canvas');
    if (!test.getContext || !test.getContext('2d') || !window.matchMedia) return; // plain img stays
    document.querySelectorAll('[data-pixel-portrait]').forEach(function (el) {
      if (!el.pixelPortrait && el.querySelector('img')) new PixelPortrait(el);
    });
  }
  window.PixelPortrait = PixelPortrait;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
