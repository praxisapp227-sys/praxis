/* timeline.js - Timeline com waveform, zoom (h/v), paginação e camadas.
   Inspirado no ELAN: waveform e camadas compartilham o MESMO eixo de tempo e zoom.
   Âncora: 100% = 10 ms/pixel (=> 100 px/s). Zoom vertical (amplitude) não altera o áudio.
   Playhead é um crosshair próprio (preciso), independente dos controles do <video>. */
(function (P) {
  "use strict";

  var Timeline = {
    wave: null, sr: 16000, duration: 0,
    peaks: null, bucket: 64,           // pré-cálculo de min/max para render rápido
    start: 0, pxPerSec: 100,           // viewport (100 px/s = 10 ms/px = zoom 100%)
    amp: 1,                            // zoom vertical (amplitude)
    layerH: 30,                        // altura de cada camada
    waveH: 100,                        // altura da waveform
    rulerH: 22,
    layersProvider: null, activeIdProvider: null,
    onSeek: null, onSelect: null, onSegmentClick: null,
    sel: null,                         // seleção {a,b} em segundos
    host: null, canvas: null, ctx: null, svg: null, playheadEl: null, selEl: null,
    _dragging: null,

    attach: function (host, hooks) {
      this.host = host; hooks = hooks || {};
      this.layersProvider = hooks.layers; this.activeIdProvider = hooks.activeId;
      this.onSeek = hooks.onSeek; this.onSegmentClick = hooks.onSegmentClick; this.onSelect = hooks.onSelect; this.onSegmentEdit = hooks.onSegmentEdit;
      this.selected = hooks.selected; this.selectionList = hooks.selectionList; this.onSelectOnly = hooks.onSelectOnly; this.onClearSelection = hooks.onClearSelection;
      this.onBlade = hooks.onBlade;
      host.style.position = "relative";
      host.innerHTML = "";
      this.canvas = document.createElement("canvas");
      this.canvas.style.cssText = "display:block;width:100%";
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      // playhead + seleção (divs absolutos, atualização barata)
      this.selEl = document.createElement("div");
      this.selEl.style.cssText = "position:absolute;top:0;bottom:0;background:rgba(79,157,245,.16);border-left:1px solid var(--accent);border-right:1px solid var(--accent);pointer-events:none;display:none";
      host.appendChild(this.selEl);
      this.pendingEl = document.createElement("div");   // faixa de "segmento aberto" (início marcado → agulha), cresce ao tocar
      this.pendingEl.className = "tl-pending";
      host.appendChild(this.pendingEl);
      this.pendingDotEl = document.createElement("div");   // marcador FIXO no ponto de início (linha + bolinha no topo)
      this.pendingDotEl.className = "tl-pending-dot";
      host.appendChild(this.pendingDotEl);
      this.bladeEl = document.createElement("div");   // guia vertical da ferramenta blade (segue o cursor)
      this.bladeEl.className = "tl-blade-guide";
      host.appendChild(this.bladeEl);
      this.playheadEl = document.createElement("div");
      this.playheadEl.className = "tl-playhead";
      this.playheadEl.innerHTML = '<div class="tl-playhead-line"></div><div class="tl-playhead-head" title="Arraste para mover a agulha"></div>';
      host.appendChild(this.playheadEl);

      var self = this;
      // cabeça da agulha: arrastar = mover a agulha (scrub), independente do pan da onda
      this.playheadEl.querySelector(".tl-playhead-head").addEventListener("mousedown", function (e) { e.stopPropagation(); e.preventDefault(); self._scrubbing = true; });
      // onda: clique = buscar, arrasto = rolar · camadas: clique = buscar, arrasto = selecionar
      this.canvas.addEventListener("mousedown", function (e) { self._canvasDown(e); });   // onda + camadas no mesmo canvas
      this.canvas.addEventListener("mousemove", function (e) { self._canvasHover(e); });
      this.canvas.addEventListener("mouseleave", function () { if (self.bladeEl) self.bladeEl.style.display = "none"; });
      window.addEventListener("mousemove", function (e) { self._onMove(e); });
      window.addEventListener("mouseup", function (e) { self._onUp(e); });

      // Barra de visão geral (minimapa): mostra o arquivo inteiro e a janela do viewport, independente do zoom.
      this.ovHost = document.getElementById("seg-overview");
      if (this.ovHost) {
        this.ovHost.style.position = "relative";
        this.ovCanvas = document.createElement("canvas");
        this.ovCanvas.style.cssText = "display:block;width:100%;height:30px;cursor:pointer";
        this.ovHost.appendChild(this.ovCanvas);
        this.ovWin = document.createElement("div");
        this.ovWin.className = "tl-ov-window";
        this.ovHost.appendChild(this.ovWin);
        this.ovPlayEl = document.createElement("div");   // agulha do minimapa (overlay leve, atualiza junto com a principal)
        this.ovPlayEl.className = "tl-ov-playhead";
        this.ovHost.appendChild(this.ovPlayEl);
        this.ovCanvas.addEventListener("mousedown", function (e) { self._ovDown(e); });
        window.addEventListener("mousemove", function (e) { self._ovMove(e); });
        window.addEventListener("mouseup", function () { self._ovDrag = null; });
      }
      // Ctrl+roda = zoom · Shift+roda = rolar (pan horizontal)
      host.addEventListener("wheel", function (e) {
        if (e.ctrlKey || e.metaKey) {   // Ctrl+roda (⌘+roda no Mac; o gesto de pinça do trackpad também chega como ctrlKey)
          e.preventDefault();
          var t = self.xToTime(self._localX(e));
          self.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, t);
        } else if (e.shiftKey) {
          e.preventDefault();
          var d = e.deltaY || e.deltaX;
          self.panBy(d * 0.5 / self.pxPerSec);   // px de roda → segundos
        }
      }, { passive: false });
      return this;
    },

    setAudio: function (wave, sr, duration, bucket) {
      this.wave = wave; this.sr = sr || 16000;
      this.bucket = bucket || 64;
      this.waveOffset = 0;
      this.duration = duration || (wave ? wave.length / this.sr : 0);
      this._computePeaks();
      this.start = 0;
      this.pxPerSec = 100; this.render();   // default: escala real (100% = 10 ms/px), não ajustar à largura
      return this;
    },
    // Recebe picos min/max já calculados (Float32 intercalado mn,mx) numa taxa de
    // "baldes" bucketHz, sem precisar guardar a onda inteira. Usado pela leitura
    // em streaming de arquivos grandes. waveOffset (s) desloca a onda no eixo de
    // anotação, para casar com os segmentos quando o áudio tem TIME_ORIGIN.
    setPeaks: function (peaks, bucketHz, waveDuration, waveOffset) {
      this.wave = null; this.sr = bucketHz; this.bucket = 1;
      this.waveOffset = waveOffset || 0;
      this.peaks = peaks; this.duration = this.waveOffset + (waveDuration || (peaks ? (peaks.length / 2) / bucketHz : 0));
      this.start = 0;
      this.pxPerSec = 100; this.render();   // default: escala real (100% = 10 ms/px), não ajustar à largura
      return this;
    },
    _computePeaks: function () {
      if (!this.wave) { this.peaks = null; return; }
      var n = Math.ceil(this.wave.length / this.bucket);
      var pk = new Float32Array(n * 2);
      for (var i = 0; i < n; i++) {
        var s = i * this.bucket, e = Math.min(this.wave.length, s + this.bucket);
        var mn = 1, mx = -1;
        for (var j = s; j < e; j++) { var v = this.wave[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
        pk[i * 2] = mn; pk[i * 2 + 1] = mx;
      }
      this.peaks = pk;
    },

    width: function () { return Math.max(200, this.host.clientWidth); },
    visibleDur: function () { return this.width() / this.pxPerSec; },
    timeToX: function (t) { return (t - this.start) * this.pxPerSec; },
    xToTime: function (x) { return this.start + x / this.pxPerSec; },
    _localX: function (e) { var r = this.host.getBoundingClientRect(); return e.clientX - r.left; },

    clampStart: function () {
      var maxStart = Math.max(0, this.duration - this.visibleDur());
      if (this.start > maxStart) this.start = maxStart;
      if (this.start < 0) this.start = 0;
    },
    zoomFit: function () { this.pxPerSec = this.width() / Math.max(0.001, this.duration); this.start = 0; this.render(); },
    zoomReset: function () { this.setZoomAround(100, this._centerTime()); },   // 100% = 10ms/px
    _centerTime: function () { return this.start + this.visibleDur() / 2; },
    zoomBy: function (factor, aroundSec) { this.setZoomAround(this.pxPerSec * factor, aroundSec != null ? aroundSec : this._centerTime()); },
    setZoomAround: function (pxPerSec, aroundSec) {
      var minPPS = this.width() / Math.max(0.001, this.duration) * 0.9;   // não menos que "cabe tudo"
      var maxPPS = 4000;                                                  // ~0.25 ms/px
      pxPerSec = Math.max(minPPS, Math.min(maxPPS, pxPerSec));
      var xFrac = (aroundSec - this.start) / this.visibleDur();
      this.pxPerSec = pxPerSec;
      this.start = aroundSec - xFrac * this.visibleDur();
      this.clampStart(); this.render();
    },
    zoomPct: function () { return Math.round(this.pxPerSec / 100 * 100); },   // 100px/s => 100%

    pageNext: function () { this.start += this.visibleDur() * 0.9; this.clampStart(); this.render(); },
    pagePrev: function () { this.start -= this.visibleDur() * 0.9; this.clampStart(); this.render(); },
    // Rola a vista em dt segundos (usado por Shift+roda e arrasto na onda).
    panBy: function (dt) { this.start += dt; this.clampStart(); this.render(); },


    setAmplitude: function (a) { this.amp = a; this.render(); },
    setLayerH: function (h) { this.layerH = h; this.render(); },

    // --- Render -----------------------------------------------------------------
    render: function () {
      if (!this.host) return;
      var __t = P._perf ? performance.now() : 0;
      var W = this.width();
      var layers = this._layers = (this.layersProvider ? this.layersProvider() : []);   // cache p/ hit-test/overview
      var layersH = layers.length * this.layerH;
      var H = this.rulerH + this.waveH + layersH;
      var dpr = window.devicePixelRatio || 1;
      this.canvas.width = W * dpr; this.canvas.height = H * dpr;     // canvas cobre régua+onda+CAMADAS (sem DOM/GC)
      this.canvas.style.height = H + "px";
      var ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var dark = document.documentElement.getAttribute("data-theme") !== "light";
      var cBg = dark ? "#0f1216" : "#ffffff", cWave = dark ? "#4f9df5" : "#2b6fb8",
          cRuler = dark ? "#2a323d" : "#d9e1ea", cTxt = dark ? "#9fb0c0" : "#5a6b7b", cMid = dark ? "#2a323d" : "#e2e8ef";
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = cBg; ctx.fillRect(0, 0, W, this.rulerH + this.waveH);

      // régua
      var step = this._niceTimeStep(), t0 = Math.ceil(this.start / step) * step;
      ctx.strokeStyle = cRuler; ctx.fillStyle = cTxt; ctx.font = "10px Segoe UI, sans-serif"; ctx.lineWidth = 1;
      for (var t = t0; t <= this.start + this.visibleDur(); t += step) {
        var x = this.timeToX(t);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.rulerH); ctx.stroke();
        ctx.fillText(P.fmtTime(t, step < 1), x + 3, 14);
      }
      // waveform
      var midY = this.rulerH + this.waveH / 2;
      ctx.strokeStyle = cMid; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
      if (this.peaks) {
        ctx.strokeStyle = cWave; ctx.beginPath();
        var half = (this.waveH / 2) * 0.95;   // altura fixa da faixa: o amp escala o VALOR (clampado a ±1), não a faixa, senão a onda invade as camadas
        var wOff = this.waveOffset || 0;
        for (var px = 0; px < W; px++) {
          var ta = this.xToTime(px) - wOff, tb = this.xToTime(px + 1) - wOff;
          var ba = Math.floor(ta * this.sr / this.bucket), bb = Math.max(ba + 1, Math.floor(tb * this.sr / this.bucket));
          if (bb * 2 > this.peaks.length) bb = this.peaks.length / 2;
          var mn = 1, mx = -1;
          for (var b = ba; b < bb; b++) { if (b < 0) continue; var lo = this.peaks[b * 2], hi = this.peaks[b * 2 + 1]; if (lo < mn) mn = lo; if (hi > mx) mx = hi; }
          if (mx < mn) continue;
          var y1 = midY - Math.max(-1, Math.min(1, mx * this.amp)) * half;
          var y2 = midY - Math.max(-1, Math.min(1, mn * this.amp)) * half;
          ctx.moveTo(px + 0.5, y1); ctx.lineTo(px + 0.5, y2 + 0.5);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = cTxt; ctx.fillText("Carregue uma mídia de áudio pra ver a onda.", 10, midY);
      }

      // camadas desenhadas no CANVAS (sem nós SVG por segmento → sem churn de DOM/GC)
      this._drawLayers(ctx, W, this.rulerH + this.waveH, layers);
      this.host.style.minHeight = H + "px";
      this._updatePlayheadEl();
      if (this.sel) this._updateSelEl(); else this.selEl.style.display = "none";
      this.renderOverview();
      if (this.onRender) this.onRender();
      if (__t) { var d = performance.now() - __t; if (d > 18) console.log("[praxis SLOW] Timeline.render " + d.toFixed(0) + "ms · " + (this._layers ? this._layers.reduce(function (a, l) { return a + l.segments.length; }, 0) : 0) + " seg · zoom " + this.zoomPct() + "%"); }
    },

    // --- Minimapa (visão geral do arquivo inteiro, independente do zoom) --------
    renderOverview: function () {
      if (!this.ovHost || !this.ovCanvas) return;
      var W = this.ovHost.clientWidth || this.width(), Hh = 30, dpr = window.devicePixelRatio || 1;
      this.ovCanvas.width = W * dpr; this.ovCanvas.height = Hh * dpr;
      var ctx = this.ovCanvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var dark = document.documentElement.getAttribute("data-theme") !== "light";
      ctx.clearRect(0, 0, W, Hh);
      ctx.fillStyle = dark ? "#161a20" : "#eef2f6"; ctx.fillRect(0, 0, W, Hh);
      var dur = Math.max(0.001, this.duration);
      var layers = this._layers || (this.layersProvider ? this.layersProvider() : []);
      var rows = Math.max(1, layers.length), rowH = (Hh - 4) / rows;
      layers.forEach(function (L, i) {
        var y = 2 + i * rowH;
        L.segments.forEach(function (s, si) {
          if (!(isFinite(s.tStart) && isFinite(s.tEnd))) return;
          var x0 = s.tStart / dur * W, x1 = s.tEnd / dur * W;
          ctx.globalAlpha = 0.85; ctx.fillStyle = L.color(s, si);
          ctx.fillRect(x0, y, Math.max(1, x1 - x0), Math.max(1, rowH - 1));
        });
      });
      ctx.globalAlpha = 1;
      // janela do viewport (zona visível na timeline) + agulha (overlay leve)
      var left = this.start / dur * W, w = this.visibleDur() / dur * W;
      this.ovWin.style.left = left + "px"; this.ovWin.style.width = Math.max(6, w) + "px";
      this._updateOvPlayhead();
    },
    _updateOvPlayhead: function () {
      if (!this.ovPlayEl || !this.ovHost) return;
      var dur = Math.max(0.001, this.duration);
      this.ovPlayEl.style.left = (this._pht != null ? (this._pht / dur * this.ovHost.clientWidth) : -10) + "px";
    },
    _ovX: function (e) { return e.clientX - this.ovHost.getBoundingClientRect().left; },
    _ovDown: function (e) {
      var W = this.ovHost.clientWidth, x = this._ovX(e), dur = this.duration;
      var left = this.start / dur * W, w = this.visibleDur() / dur * W;
      if (x < left || x > left + w) { this.start = (x / W) * dur - this.visibleDur() / 2; this.clampStart(); this.render(); }   // fora da janela: pula
      this._ovDrag = { x0: this._ovX(e), start0: this.start };
    },
    _ovMove: function (e) {
      if (!this._ovDrag) return;
      var W = this.ovHost.clientWidth, dur = this.duration;
      this.start = this._ovDrag.start0 + (this._ovX(e) - this._ovDrag.x0) / W * dur;
      this.clampStart(); this.render();
    },

    // Desenha as camadas no CANVAS (bandas + segmentos + rótulos). Zero DOM por segmento.
    _drawLayers: function (ctx, W, yTop, layers) {
      var activeId = this.activeIdProvider ? this.activeIdProvider() : null;
      var dark = document.documentElement.getAttribute("data-theme") !== "light";
      var cLine = dark ? "rgba(140,160,180,.28)" : "#d9e1ea", cActive = "rgba(79,157,245,.6)", cLabel = dark ? "#9fb0c0" : "#5a6b7b";
      var vStart = this.start, vEnd = this.start + this.visibleDur(), lh = this.layerH, self = this;
      ctx.font = "10px Segoe UI, sans-serif";
      layers.forEach(function (L, i) {
        var y = yTop + i * lh, active = L.id === activeId;
        ctx.fillStyle = active ? "rgba(79,157,245,.06)" : (dark ? "rgba(255,255,255,.015)" : "rgba(0,0,0,.015)");
        ctx.fillRect(0, y, W, lh - 2);
        ctx.strokeStyle = active ? cActive : cLine; ctx.lineWidth = active ? 1 : 0.5;
        ctx.strokeRect(0.5, y + 0.5, W - 1, lh - 3);
        for (var si = 0; si < L.segments.length; si++) {
          var s = L.segments[si];
          if (!(isFinite(s.tStart) && isFinite(s.tEnd)) || s.tEnd < vStart || s.tStart > vEnd) continue;
          var x0 = self.timeToX(s.tStart), x1 = self.timeToX(s.tEnd), w = Math.max(1.5, x1 - x0);
          ctx.globalAlpha = 0.85; ctx.fillStyle = L.color(s, si); ctx.fillRect(x0, y + 3, w, lh - 8); ctx.globalAlpha = 1;
          // seam: contorno de cada bloco → mostra a fronteira entre segmentos adjacentes mesmo de mesma cor (corte visível)
          ctx.strokeStyle = dark ? "rgba(15,18,22,.6)" : "rgba(255,255,255,.7)"; ctx.lineWidth = 1;
          ctx.strokeRect(x0 + 0.5, y + 3.5, Math.max(1, w - 1), lh - 9);
          if (self.selected && self.selected(s)) { ctx.strokeStyle = "#4f9df5"; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y + 4, Math.max(1, w - 2), lh - 10); }   // selecionado: contorno de acento
          if (w > 26 && s.value) { ctx.fillStyle = "#fff"; ctx.fillText(String(s.value).slice(0, Math.floor(w / 6)), x0 + 4, y + lh / 2 + 2); }
        }
        // marcadores de índice: linha vertical + diamante na faixa superior (zona de clique para remover)
        if (L.marks) {
          var mc = L.markColor || "#f0a030";
          for (var mi = 0; mi < L.marks.length; mi++) {
            var mk = L.marks[mi]; if (!mk || !isFinite(mk.t) || mk.t < vStart || mk.t > vEnd) continue;
            var mx = self.timeToX(mk.t);
            ctx.strokeStyle = mc; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mx + 0.5, y + 2); ctx.lineTo(mx + 0.5, y + lh - 4); ctx.stroke();
            ctx.fillStyle = mc; ctx.beginPath(); ctx.moveTo(mx, y + 1); ctx.lineTo(mx + 4, y + 5); ctx.lineTo(mx, y + 9); ctx.lineTo(mx - 4, y + 5); ctx.closePath(); ctx.fill();
          }
        }
        ctx.fillStyle = cLabel; ctx.fillText(L.name, 4, y + 11);
      });
    },
    _localY: function (e) { var r = this.host.getBoundingClientRect(); return e.clientY - r.top; },
    // Segmento sob a coordenada (px,py) do canvas - sem alocação (usa this._layers em cache).
    _hitSeg: function (px, py) {
      var yTop = this.rulerH + this.waveH, lh = this.layerH;
      if (py < yTop) return null;
      var layers = this._layers || (this.layersProvider ? this.layersProvider() : []);
      var L = layers[Math.floor((py - yTop) / lh)]; if (!L) return null;
      var t = this.xToTime(px);
      for (var si = 0; si < L.segments.length; si++) {
        var s = L.segments[si];
        if (isFinite(s.tStart) && isFinite(s.tEnd) && t >= s.tStart && t <= s.tEnd) return { L: L, si: si, s: s, x0: this.timeToX(s.tStart), x1: this.timeToX(s.tEnd) };
      }
      return null;
    },
    // Marcador de índice sob a coordenada (só a faixa superior da banda, onde fica o diamante).
    _hitMark: function (px, py) {
      var yTop = this.rulerH + this.waveH, lh = this.layerH;
      if (py < yTop) return null;
      var layers = this._layers || [];
      var li = Math.floor((py - yTop) / lh), L = layers[li]; if (!L || !L.marks || !L.marks.length) return null;
      var band = py - (yTop + li * lh);
      if (band < 0 || band > 11) return null;
      for (var i = 0; i < L.marks.length; i++) { var mx = this.timeToX(L.marks[i].t); if (Math.abs(px - mx) <= 6) return { L: L, mi: i, m: L.marks[i] }; }
      return null;
    },
    // Modo blade (ferramenta lâmina): clicar num segmento o divide no ponto do cursor.
    bladeMode: false,
    setBlade: function (on) {
      this.bladeMode = !!on;
      if (!this.bladeMode && this.bladeEl) this.bladeEl.style.display = "none";
      if (this.canvas) this.canvas.style.cursor = "";
    },
    // mousedown no canvas: régua/onda = buscar/rolar; área de camadas = segmento (borda/corpo) ou seleção.
    _canvasDown: function (e) {
      var py = this._localY(e);
      if (py < this.rulerH + this.waveH) { this._onDown(e, "wave"); return; }
      var px = this._localX(e), hit = this._hitSeg(px, py), EDGE = 5;
      var mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      if (!this.bladeMode) { var mk0 = this._hitMark(px, py); if (mk0 && this.onMarkClick) { this.onMarkClick(mk0.L, mk0.mi, mk0.m); return; } }   // clique num marcador de índice o remove
      if (this.bladeMode) {   // corta o segmento clicado no tempo do cursor; sem selecionar/mover/rolar
        if (hit && this.onBlade) this.onBlade(hit.L, hit.si, hit.s, this.xToTime(px));
        return;
      }
      if (!hit) { this._onDown(e, "layers"); return; }
      if (Math.abs(px - hit.x0) <= EDGE) { this._startResize(hit.L, hit.si, hit.s, "start", mods); return; }
      if (Math.abs(px - hit.x1) <= EDGE) { this._startResize(hit.L, hit.si, hit.s, "end", mods); return; }
      this._startMove(hit.L, hit.si, hit.s, px, mods);
    },
    _canvasHover: function (e) {
      var py = this._localY(e);
      if (py < this.rulerH + this.waveH) { if (this.canvas.style.cursor) this.canvas.style.cursor = ""; if (this.bladeEl) this.bladeEl.style.display = "none"; return; }
      var px = this._localX(e), hit = this._hitSeg(px, py), EDGE = 5;
      if (this.bladeMode) {   // guia vertical seguindo o cursor; realça quando há segmento para cortar
        this.canvas.style.cursor = hit ? "crosshair" : "default";
        if (this.bladeEl) {
          this.bladeEl.style.display = "block";
          this.bladeEl.style.left = px + "px";
          this.bladeEl.classList.toggle("armed", !!hit);
        }
        return;
      }
      if (this.bladeEl && this.bladeEl.style.display !== "none") this.bladeEl.style.display = "none";
      if (this._hitMark(px, py)) { this.canvas.style.cursor = "pointer"; return; }   // sobre um marcador de índice: remover ao clicar
      this.canvas.style.cursor = hit ? ((Math.abs(px - hit.x0) <= EDGE || Math.abs(px - hit.x1) <= EDGE) ? "ew-resize" : "grab") : "";
    },

    _niceTimeStep: function () {
      var target = 90 / this.pxPerSec;   // ~90px entre marcas
      var steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
      for (var i = 0; i < steps.length; i++) if (steps[i] >= target) return steps[i];
      return 600;
    },

    // --- Playhead / seleção -----------------------------------------------------
    linkPlayer: true,   // vincula a rolagem ao player: a vista segue a playhead (tocando ou ao arrastar)
    setLinkPlayer: function (on) {
      this.linkPlayer = !!on;
      if (this.linkPlayer && this._pht != null) this.setPlayheadTime(this._pht, true);   // reenquadra já
    },
    setPlayheadTime: function (t, following) {
      this._pht = t;
      // Vinculado: sempre traz a playhead à vista quando ela sai do quadro (tocando ou arrastando o player).
      // Desvinculado: rola livre, nunca reenquadra sozinho.
      if (this.linkPlayer && (t < this.start || t > this.start + this.visibleDur())) {
        this.start = t - this.visibleDur() * 0.15; this.clampStart(); this.render();
      }
      this._updatePlayheadEl();
    },
    _updatePlayheadEl: function () {
      if (this._pht == null) return;
      var x = this.timeToX(this._pht);
      var vis = x >= 0 && x <= this.width();
      this.playheadEl.style.display = vis ? "block" : "none";
      this.playheadEl.style.left = x + "px";
      this._updatePendingEl();    // faixa do segmento aberto cresce junto com a agulha
      this._updateOvPlayhead();   // mantém a agulha do minimapa em sincronia (mesmo sem re-render)
    },
    // Faixa "segmento aberto": do início marcado até a agulha. Cresce enquanto a mídia toca.
    setPending: function (startT) { this._pending = startT; this._updatePendingEl(); },
    clearPending: function () { this._pending = null; if (this.pendingEl) this.pendingEl.style.display = "none"; if (this.pendingDotEl) this.pendingDotEl.style.display = "none"; },
    _updatePendingEl: function () {
      if (!this.pendingEl) return;
      if (this._pending == null || this._pht == null) { this.pendingEl.style.display = "none"; if (this.pendingDotEl) this.pendingDotEl.style.display = "none"; return; }
      var x0 = this.timeToX(this._pending), x1 = this.timeToX(this._pht);
      this.pendingEl.style.display = "block";
      this.pendingEl.style.left = Math.min(x0, x1) + "px";
      this.pendingEl.style.width = Math.max(0, Math.abs(x1 - x0)) + "px";
      if (this.pendingDotEl) { this.pendingDotEl.style.display = "block"; this.pendingDotEl.style.left = x0 + "px"; }   // fixo no início
    },
    _updateSelEl: function () {
      var x0 = this.timeToX(this.sel.a), x1 = this.timeToX(this.sel.b);
      this.selEl.style.display = "block";
      this.selEl.style.left = Math.min(x0, x1) + "px";
      this.selEl.style.width = Math.abs(x1 - x0) + "px";
    },
    clearSelection: function () { this.sel = null; this.selEl.style.display = "none"; if (this.onSelect) this.onSelect(null); },

    // Monta o "grupo" a mover/redimensionar (a seleção, se s estiver nela; senão só s) com, por item,
    // os tempos originais e os vizinhos NÃO selecionados (pl/pr) - que dão os limites coletivos.
    _groupItems: function (L, s, group) {
      var self = this, segs = L.segments;
      group = (group || [s]).filter(function (g) { return segs.indexOf(g) >= 0; });
      if (!group.length) group = [s];
      var idxSet = {}; group.forEach(function (g) { idxSet[segs.indexOf(g)] = true; });
      return group.map(function (g) {
        var gi = segs.indexOf(g), pl = 0, pr = self.duration, j;
        for (j = gi - 1; j >= 0; j--) if (!idxSet[j]) { pl = isFinite(segs[j].tEnd) ? segs[j].tEnd : 0; break; }
        for (j = gi + 1; j < segs.length; j++) if (!idxSet[j]) { pr = isFinite(segs[j].tStart) ? segs[j].tStart : self.duration; break; }
        return { s: g, t0s: g.tStart, t0e: g.tEnd, pl: pl, pr: pr };
      });
    },
    // Redimensiona a borda (esq/dir). Em grupo: a MESMA borda de todos os selecionados se move junto; o
    // limite é coletivo (quando o menor chega no mínimo, trava todos - comportamento DaVinci).
    _startResize: function (L, si, s, edge, mods) {
      mods = mods || {};
      var sel = this.selectionList ? this.selectionList() : [], inSel = sel && sel.indexOf(s) >= 0;
      if (!inSel && !mods.ctrl && !mods.shift && this.onSelectOnly) this.onSelectOnly(L, s);
      var group = (inSel && sel.length > 1) ? sel : [s];
      // Fronteira compartilhada: num resize simples (1 segmento), se a borda arrastada encosta na borda de um
      // vizinho, as duas se movem juntas (edição de fronteira). Só quando não é resize coletivo de vários.
      var partner = null, EPS = 0.02, segs = L.segments, k;
      if (group.length === 1) {
        if (edge === "end") { for (k = 0; k < segs.length; k++) if (segs[k] !== s && isFinite(segs[k].tStart) && Math.abs(segs[k].tStart - s.tEnd) < EPS) { partner = segs[k]; break; } }
        else { for (k = 0; k < segs.length; k++) if (segs[k] !== s && isFinite(segs[k].tEnd) && Math.abs(segs[k].tEnd - s.tStart) < EPS) { partner = segs[k]; break; } }
      }
      this._resizing = { L: L, si: si, s: s, edge: edge, x0edge: (edge === "start" ? s.tStart : s.tEnd), items: this._groupItems(L, s, group), partner: partner };
    },
    // Move o(s) segmento(s) no tempo (arrasto no corpo). Em grupo: todos os selecionados juntos, limite coletivo.
    _startMove: function (L, si, s, x0, mods) {
      mods = mods || {};
      var sel = this.selectionList ? this.selectionList() : [], inSel = sel && sel.indexOf(s) >= 0;
      var group = (inSel && sel.length > 1) ? sel : [s];
      this._movingSeg = { L: L, si: si, s: s, x0: x0, moved: false, mods: mods, needSelect: !inSel && !mods.ctrl && !mods.shift, items: this._groupItems(L, s, group) };
    },
    _onDown: function (e, area) {
      var x = this._localX(e);
      this._dragging = { x0: x, t0: this.xToTime(x), moved: false, area: area, start0: this.start };
    },
    _onMove: function (e) {
      if (this._scrubbing) { if (this.onSeek) this.onSeek(Math.max(0, this.xToTime(this._localX(e)))); return; }
      if (this._movingSeg) {
        var M = this._movingSeg, mx = this._localX(e);
        if (Math.abs(mx - M.x0) > 3 && !M.moved) { M.moved = true; if (M.needSelect && this.onSelectOnly) this.onSelectOnly(M.L, M.s); }
        if (M.moved) {
          var dt = (mx - M.x0) / this.pxPerSec, dtMin = -Infinity, dtMax = Infinity;
          M.items.forEach(function (it) { dtMin = Math.max(dtMin, it.pl - it.t0s); dtMax = Math.min(dtMax, it.pr - it.t0e); });
          dt = Math.max(dtMin, Math.min(dtMax, dt));
          M.items.forEach(function (it) { it.s.tStart = it.t0s + dt; it.s.tEnd = it.t0e + dt; it.s.locked = true; });
          this.render();
        }
        return;
      }
      if (this._resizing) {
        var R = this._resizing, dt2 = this.xToTime(this._localX(e)) - R.x0edge, MIN = 0.02, lo2 = -Infinity, hi2 = Infinity;
        if (R.partner) {   // fronteira compartilhada: a borda de s e a do parceiro se movem juntas
          var target = this.xToTime(this._localX(e));
          if (R.edge === "end") {   // borda comum = tEnd de s = tStart do parceiro
            var border = Math.max(R.s.tStart + MIN, Math.min(R.partner.tEnd - MIN, target));
            R.s.tEnd = border; R.partner.tStart = border;
          } else {
            var border2 = Math.max(R.partner.tStart + MIN, Math.min(R.s.tEnd - MIN, target));
            R.s.tStart = border2; R.partner.tEnd = border2;
          }
          R.s.locked = true; R.partner.locked = true;
          this.render();
          return;
        }
        if (R.edge === "end") {
          R.items.forEach(function (it) { lo2 = Math.max(lo2, (it.t0s + MIN) - it.t0e); hi2 = Math.min(hi2, it.pr - it.t0e); });
          dt2 = Math.max(lo2, Math.min(hi2, dt2));
          R.items.forEach(function (it) { it.s.tEnd = it.t0e + dt2; it.s.locked = true; });
        } else {
          R.items.forEach(function (it) { lo2 = Math.max(lo2, it.pl - it.t0s); hi2 = Math.min(hi2, (it.t0e - MIN) - it.t0s); });
          dt2 = Math.max(lo2, Math.min(hi2, dt2));
          R.items.forEach(function (it) { it.s.tStart = it.t0s + dt2; it.s.locked = true; });
        }
        this.render();
        return;
      }
      if (!this._dragging) return;
      var d = this._dragging, x = this._localX(e);
      if (Math.abs(x - d.x0) > 3) d.moved = true;
      if (!d.moved) return;
      if (d.area === "wave") {                       // arrasto na onda = rolar (pan)
        this.start = d.start0 - (x - d.x0) / this.pxPerSec; this.clampStart(); this.render();
      } else {                                        // arrasto nas camadas = selecionar
        var t2 = this.xToTime(x);
        this.sel = { a: Math.min(d.t0, t2), b: Math.max(d.t0, t2) }; this._updateSelEl();
      }
    },
    _onUp: function (e) {
      if (this._scrubbing) { this._scrubbing = false; return; }
      if (this._movingSeg) {
        var M = this._movingSeg; this._movingSeg = null;
        if (M.moved) { if (this.onSegmentEdit) this.onSegmentEdit(M.L, M.si, M.s); }
        else if (this.onSegmentClick) this.onSegmentClick(M.L, M.si, M.s, M.mods);
        return;
      }
      if (this._resizing) { var R = this._resizing; this._resizing = null; if (this.onSegmentEdit) this.onSegmentEdit(R.L, R.si, R.s); return; }
      if (!this._dragging) return;
      var d = this._dragging; this._dragging = null;
      if (d.moved) { if (d.area === "layers" && this.onSelect) { this.onSelect(this.sel); this.sel = null; this.selEl.style.display = "none"; } }   // vira seleção de segmentos e some a faixa azul
      else { if (d.area === "layers") { this.clearSelection(); if (this.onClearSelection) this.onClearSelection(); } if (this.onSeek) this.onSeek(d.t0); }
    }
  };

  P.Timeline = Timeline;
})(window.Praxis = window.Praxis || {});
