// The Monsoon — curved ribbon gallery. Original code by Miracle Mikhael.
// A 2D canvas draws a flat strip of cards; a WebGL pass bends it so the edges
// swell and compress like the inside of a curved wall.
(() => {
  "use strict";

  const ITEMS = [
    { name: "Mist", img: "img/1.webp" },
    { name: "Drizzle", img: "img/2.webp" },
    { name: "Petrichor", img: "img/3.webp" },
    { name: "Squall", img: "img/4.webp" },
    { name: "Still", img: "img/5.webp" },
  ];
  const N = ITEMS.length;
  const BG = [0xef, 0xef, 0xed];
  const PERIOD = 2000;      // ms between auto steps
  const STEP_DUR = 1400;    // ms per auto step
  const IDLE_RESUME = 4000; // ms after user input before auto resumes
  const WARP = { a: 0.42, k: 0.36, p: 2.2, kx: 1.15 };

  const qs = new URLSearchParams(location.search);
  const RECORD = qs.has("record");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const stage = document.getElementById("stage");
  const view = document.getElementById("gl");
  const titleEl = document.querySelector(".title");
  const countEl = document.getElementById("count");
  const srNow = document.getElementById("sr-now");
  document.getElementById("sr-list").innerHTML = ITEMS.map((it, i) => `<li>${pad(i + 1)} ${it.name}</li>`).join("");

  const strip = document.createElement("canvas");
  const ctx = strip.getContext("2d");

  function pad(n) { return String(n).padStart(2, "0"); }
  const mod = (n, m) => ((n % m) + m) % m;

  // ---- easing: cubic-bezier solver --------------------------------------
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-6 || !d) break; t -= e / d; }
      return sy(Math.min(1, Math.max(0, t)));
    };
  }
  const easeStep = bezier(0.5, 0, 0.1, 1);
  const easeSnap = bezier(0.2, 0.7, 0.2, 1);

  // ---- images ------------------------------------------------------------
  const imgs = ITEMS.map(it => { const im = new Image(); im.decoding = "async"; im.src = it.img; return im; });

  // ---- layout ------------------------------------------------------------
  let W = 0, H = 0, dpr = 1, cw = 0, ch = 0, gap = 0, unit = 0, SW = 0;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = innerWidth, cssH = innerHeight;
    W = Math.round(cssW * dpr); H = Math.round(cssH * dpr);
    if (cssW / cssH < 0.8) {
      cw = cssW * 0.48; ch = cw * 1.775;
      if (ch > cssH * 0.56) { ch = cssH * 0.56; cw = ch / 1.775; }
    } else {
      ch = cssH * 0.54; cw = ch / 1.775;
    }
    cw *= dpr; ch *= dpr; gap = cw * 0.13; unit = cw + gap;
    const hw = W / 2;
    const maxS = hw + WARP.kx * hw * (1 - WARP.a) / (WARP.p + 1);
    SW = Math.ceil(2 * maxS + 8);
    strip.width = SW; strip.height = H;
    view.width = W; view.height = H;
    document.documentElement.style.setProperty("--title", (cw / dpr * 0.182).toFixed(1) + "px");
    if (gl) { gl.viewport(0, 0, W, H); allocTex(); }
    dirty = true;
  }

  // ---- strip drawing -----------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawStrip(pos) {
    ctx.fillStyle = `rgb(${BG})`;
    ctx.fillRect(0, 0, SW, H);
    const top = Math.round(H / 2 - ch / 2);
    const half = SW / 2;
    const first = Math.floor(pos - half / unit) - 1, last = Math.ceil(pos + half / unit) + 1;
    const lab = cw * 0.043, cap = cw * 0.037;
    for (let i = first; i <= last; i++) {
      const k = mod(i, N);
      const cx = half + (i - pos) * unit;
      const x = cx - cw / 2;
      if (x > SW || x + cw < 0) continue;
      // image, cover-fit
      const im = imgs[k];
      ctx.save();
      roundRect(x, top, cw, ch, cw * 0.035);
      ctx.clip();
      if (im.complete && im.naturalWidth) {
        const s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
        const iw = im.naturalWidth * s, ih = im.naturalHeight * s;
        ctx.drawImage(im, cx - iw / 2, top + ch / 2 - ih / 2, iw, ih);
      } else { ctx.fillStyle = "#d9d9d6"; ctx.fill(); }
      ctx.restore();
      // labels above the card
      ctx.fillStyle = "#151515";
      ctx.font = `500 ${lab}px Inter, "Helvetica Neue", Arial, sans-serif`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = (lab * 0.1).toFixed(2) + "px";
      ctx.textBaseline = "alphabetic";
      const ly = top - cw * 0.045;
      ctx.textAlign = "left"; ctx.fillText(ITEMS[k].name.toUpperCase(), x + 1, ly);
      ctx.textAlign = "right"; ctx.fillText(pad(k + 1), x + cw - 1, ly);
      // caption under the card, only near centre
      const d = Math.abs(i - pos);
      const a = Math.max(0, 1 - d * 1.6);
      if (a > 0.01) {
        ctx.globalAlpha = a;
        ctx.fillStyle = "#5d5d5a";
        ctx.font = `400 ${cap}px Inter, "Helvetica Neue", Arial, sans-serif`;
        if ("letterSpacing" in ctx) ctx.letterSpacing = (cap * 0.14).toFixed(2) + "px";
        ctx.textAlign = "center";
        ctx.fillText(`MONSOON COLL. ${pad(k + 1)}`, cx, top + ch + cw * 0.08);
        ctx.globalAlpha = 1;
      }
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }

  // ---- WebGL warp --------------------------------------------------------
  let gl = null, tex = null, prog = null, U = {};
  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `precision highp float;
    uniform sampler2D uTex; uniform vec2 uRes; uniform vec2 uStrip; uniform vec4 uWarp; uniform vec3 uBg;
    void main(){
      vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      float hw = uRes.x * 0.5;
      float dx = p.x - hw;
      float nx = abs(dx) / hw;
      float a = uWarp.x, k = uWarp.y, pw = uWarp.z, kx = uWarp.w;
      float t = clamp((nx - a) / (1.0 - a), 0.0, 1.0);
      float S = 1.0 + k * pow(t, pw);
      float sx = abs(dx) + kx * hw * (1.0 - a) * pow(t, pw + 1.0) / (pw + 1.0);
      vec2 s = vec2(uStrip.x * 0.5 + sign(dx) * sx, uRes.y * 0.5 + (p.y - uRes.y * 0.5) / S);
      vec2 uv = s / uStrip;
      vec3 c = texture2D(uTex, uv).rgb;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) c = uBg;
      gl_FragColor = vec4(c, 1.0);
    }`;
  function initGL() {
    if (qs.has("nogl")) return null;
    const g = view.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: RECORD });
    if (!g) return null;
    const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)); return s; };
    prog = g.createProgram();
    g.attachShader(prog, sh(g.VERTEX_SHADER, VS)); g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
    g.linkProgram(prog); g.useProgram(prog);
    const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, "p"); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    for (const n of ["uTex", "uRes", "uStrip", "uWarp", "uBg"]) U[n] = g.getUniformLocation(prog, n);
    tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.uniform1i(U.uTex, 0);
    g.uniform3f(U.uBg, BG[0] / 255, BG[1] / 255, BG[2] / 255);
    return g;
  }
  let texW = 0, texH = 0;
  function allocTex() { texW = 0; texH = 0; }
  function present() {
    if (gl) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (texW !== SW || texH !== H) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, strip); texW = SW; texH = H; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, strip);
      gl.uniform2f(U.uRes, W, H); gl.uniform2f(U.uStrip, SW, H);
      gl.uniform4f(U.uWarp, WARP.a, WARP.k, WARP.p, WARP.kx);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      const c2 = view.getContext("2d");
      c2.drawImage(strip, (SW - W) / 2, 0, W, H, 0, 0, W, H);
    }
  }

  // ---- motion state ------------------------------------------------------
  let clock = 0;                 // virtual ms
  let pos = 0;                   // current card index (float)
  let anim = null;               // {from,to,t0,dur,ease}
  let lastInput = -Infinity;
  let nextAuto = PERIOD;
  let dirty = true;
  let shown = -1;

  function goTo(target, dur, ease) {
    anim = { from: pos, to: target, t0: clock, dur, ease };
  }
  function userInput() { lastInput = clock; nextAuto = clock + IDLE_RESUME; }

  function tick(dt) {
    clock += dt;
    if (!drag && !reduced && clock >= nextAuto && clock - lastInput >= IDLE_RESUME) {
      const base = anim ? anim.to : Math.round(pos);
      goTo(base + 1, STEP_DUR, easeStep);
      nextAuto = clock + PERIOD;
    }
    if (anim && !drag) {
      const u = Math.min(1, (clock - anim.t0) / anim.dur);
      pos = anim.from + (anim.to - anim.from) * anim.ease(u);
      if (u >= 1) { pos = anim.to; anim = null; }
      dirty = true;
    }
    if (dirty) { drawStrip(pos); present(); dirty = false; }
    const now = mod(Math.round(pos), N);
    if (now !== shown) { shown = now; countEl.textContent = pad(now + 1); srNow.textContent = `${pad(now + 1)} ${ITEMS[now].name}`; }
  }

  // ---- input -------------------------------------------------------------
  let drag = null;
  // inverse of the shader warp: css x -> strip offset (device px from strip centre)
  function stripOffset(cssX) {
    const hw = W / 2, dx = cssX * dpr - hw, nx = Math.abs(dx) / hw;
    const t = Math.min(1, Math.max(0, (nx - WARP.a) / (1 - WARP.a)));
    const sx = Math.abs(dx) + WARP.kx * hw * (1 - WARP.a) * Math.pow(t, WARP.p + 1) / (WARP.p + 1);
    return Math.sign(dx) * sx;
  }
  stage.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, s0: stripOffset(e.clientX), pos0: pos, moved: false, hist: [[performance.now(), pos]] };
    anim = null; userInput();
  });
  addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const ddx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(ddx) > 6) { drag.moved = true; stage.classList.add("dragging"); try { stage.setPointerCapture(drag.id); } catch (_) {} }
    if (!drag.moved) return;
    pos = drag.pos0 - (stripOffset(e.clientX) - drag.s0) / unit;
    const t = performance.now(); drag.hist.push([t, pos]); while (drag.hist.length > 6) drag.hist.shift();
    dirty = true; userInput();
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null; stage.classList.remove("dragging");
    if (!d.moved) { // click: jump to the card under the pointer
      const off = stripOffset(d.x0) / unit;
      const target = Math.round(pos + off);
      if (target !== Math.round(pos)) goTo(target, 1000, easeStep);
      else if (Math.abs(pos - target) > 0.001) goTo(target, 600, easeSnap);
      userInput(); return;
    }
    const h = d.hist, a = h[0], b = h[h.length - 1];
    const v = (b[0] - a[0]) > 0 ? (b[1] - a[1]) / (b[0] - a[0]) : 0; // cards per ms
    let target = Math.round(pos + v * 220);
    target = Math.max(Math.round(pos) - 2, Math.min(Math.round(pos) + 2, target));
    goTo(target, 900, easeSnap); userInput();
  }
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);

  let wheelAcc = 0, wheelLock = 0;
  stage.addEventListener("wheel", e => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelAcc += d;
    if (performance.now() < wheelLock) return;
    if (Math.abs(wheelAcc) > 30) {
      const base = anim ? anim.to : Math.round(pos);
      goTo(base + Math.sign(wheelAcc), 1000, easeStep);
      wheelAcc = 0; wheelLock = performance.now() + 450; userInput();
    }
  }, { passive: false });

  addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const base = anim ? anim.to : Math.round(pos);
    goTo(base + (e.key === "ArrowRight" ? 1 : -1), 1000, easeStep); userInput();
  });

  // ---- boot --------------------------------------------------------------
  try { gl = initGL(); } catch (err) { console.warn("WebGL off:", err); gl = null; }
  if (!gl) document.documentElement.classList.add("no-gl");
  layout();
  addEventListener("resize", layout);
  imgs.forEach(im => im.addEventListener("load", () => { dirty = true; if (RECORD) tick(0); }));

  const fontsReady = (document.fonts && document.fonts.load)
    ? Promise.all([document.fonts.load('500 14px Inter'), document.fonts.load('400 14px Inter')]).catch(() => {})
    : Promise.resolve();
  fontsReady.then(() => { dirty = true; });

  window.__ready = Promise.all([fontsReady, ...imgs.map(im => im.decode().catch(() => {}))]).then(() => { dirty = true; tick(0); document.documentElement.classList.add("ready"); });
  window.__advance = ms => tick(ms);
  window.__state = () => ({ pos, clock, gl: !!gl });

  if (!RECORD) {
    let last = performance.now();
    const loop = now => { const dt = Math.min(64, now - last); last = now; tick(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", () => { last = performance.now(); });
  }
})();
