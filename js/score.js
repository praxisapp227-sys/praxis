/* score.js - Módulo de partitura (Verovio) ao lado do vídeo na aba ① Segmentar.
   Render offline (Leland embutida no SVG do Verovio; texto em Edwin). Sincroniza o
   compasso corrente com a mídia pela ponte tempo↔compasso da camada de prática
   (segmentos {tStart,tEnd,mStart,mEnd}). Só LÊ P.Segmenter.tiers; nunca escreve.
   Verovio (~7 MB) é carregado sob demanda no 1º "Abrir partitura". */
(function (P) {
  "use strict";

  var S = {
    tk: null, ready: false, _loading: null,
    host: null,                 // #seg-score (área de render, rola)
    _raw: null,                 // { kind:'xml'|'zip', data } - para re-render no resize
    name: "", measureCount: 0, _cur: -1,
    sourceTierId: null,         // camada de prática fonte de compassos (null = 1ª com compassos)
    scale: 40,                  // zoom da partitura (menor = mais compassos por linha e mais linhas visíveis)
    viewMode: "display",        // "display" (melhor uso da tela, reflui) | "page" (quebras do arquivo, folha)
    mnumAll: false,             // número de compasso em todos os compassos (true) ou só no início de cada sistema (false)
    notation: "original",       // "original" (padrão: cifra crua do arquivo = o que o participante viu) | grafia da Grafia (chediak/chediak-sign/jazz/realbook/compacta)
    _notated: null, _notatedFor: null,   // cache do XML já convertido para a grafia atual
    follow: true,               // durante o play, a partitura segue a agulha (destaca+rola). Desligado = rolar livre (como o "vincular" da timeline).
    suppressed: false,          // aba ②: enquanto o segmento em foco não tem início+fim completos, a partitura "não sabe" → nada de realce/rolagem (mesmo tocando, com ou sem acoplamento).
    pickMode: false, _onPick: null, _eventMap: null,   // modo de codificação por clique: clicar nota/pausa devolve os decimais início/fim.

    init: function () {
      this.host = document.getElementById("seg-score");
      var self = this;
      try { var sv = parseInt(localStorage.getItem("praxis.score.scale"), 10); if (!isNaN(sv)) this.scale = Math.max(16, Math.min(72, sv)); } catch (e) {}
      try { var vm = localStorage.getItem("praxis.score.view"); if (vm === "page" || vm === "display") this.viewMode = vm; } catch (e) {}
      try { this.mnumAll = localStorage.getItem("praxis.score.mnum") === "1"; } catch (e) {}
      try { this.follow = localStorage.getItem("praxis.score.follow") !== "0"; } catch (e) {}   // padrão: segue a agulha
      try { var nt = localStorage.getItem("praxis.notation"); if (nt === "lima") nt = "compacta"; if (nt === "original" || (window.Grafia && window.Grafia.NOTATIONS.indexOf(nt) >= 0)) this.notation = nt; } catch (e) {}
      var open = document.getElementById("score-open"), inp = document.getElementById("score-file");
      if (open && inp) {
        open.addEventListener("click", function () { inp.click(); });
        inp.addEventListener("change", function () { if (this.files[0]) { self.loadFile(this.files[0]); this.value = ""; } });
      }
      var coll = document.getElementById("score-collapse");
      if (coll) coll.addEventListener("click", function () { self.toggleCollapsed(); });
      var inv = document.getElementById("score-invert");
      if (inv) inv.addEventListener("click", function () { self.toggleInvert(); });
      var zo = document.getElementById("score-zoomout"), zi = document.getElementById("score-zoomin");
      if (zo) zo.addEventListener("click", function () { self.zoomScore(1 / 1.15); });
      if (zi) zi.addEventListener("click", function () { self.zoomScore(1.15); });
      var vb = document.getElementById("score-view");
      if (vb) vb.addEventListener("click", function () { self.setViewMode(self.viewMode === "page" ? "display" : "page"); });
      var mn = document.getElementById("score-mnum");
      if (mn) mn.addEventListener("click", function () { self.setMnumAll(!self.mnumAll); });
      var fl = document.getElementById("score-follow");
      if (fl) { fl.classList.toggle("active", this.follow); fl.addEventListener("click", function () { self.setFollow(!self.follow); }); }
      // Ctrl/⌘ + roda sobre a partitura = zoom (como na timeline); roda simples = rolagem nativa
      if (this.host) this.host.addEventListener("wheel", function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault(); self.zoomScore(e.deltaY < 0 ? 1.12 : 1 / 1.12);
      }, { passive: false });
      // Clique num compasso → leva a mídia ao início dele (inverso do realce automático). Delegado no host (sobrevive ao re-render).
      if (this.host) this.host.addEventListener("click", function (e) {
        // Modo "pick" (codificação por clique): clicar numa nota/pausa devolve os decimais início/fim ao callback.
        if (self.pickMode) {
          var ev = e.target && e.target.closest ? e.target.closest("g.note, g.rest, g.chord") : null;
          if (ev && ev.id) { var d = self.eventDecimals(ev.id); if (d && self._onPick) self._onPick(ev.id, d); }
          return;
        }
        if (!P.Segmenter || !P.Segmenter.media) return;
        var g = e.target && e.target.closest ? e.target.closest("g.measure") : null; if (!g) return;
        var ms = self.host.querySelectorAll("g.measure"), idx = Array.prototype.indexOf.call(ms, g); if (idx < 0) return;
        // Cicla pelas instâncias: pula pra próxima vez que o compasso é tocado DEPOIS de onde o player está;
        // se já passou da última, volta pra primeira. Clicar repetido percorre as repetições sucessivamente.
        var times = self.timesAtMeasure(idx); if (!times.length) return;
        var cur = P.Segmenter.annNow ? P.Segmenter.annNow() : 0, next = null;
        for (var i = 0; i < times.length; i++) { if (times[i] > cur + 0.06) { next = times[i]; break; } }
        if (next == null) next = times[0];
        P.Segmenter.seekTo(Math.max(0, next));
      });
      // Reflow ao redimensionar o painel (o resizer externo sempre vence: estreitou → joga compassos pra próxima linha)
      if (window.ResizeObserver && this.host) {
        var rot; this._lastW = 0;
        this._ro = new ResizeObserver(function () {
          var cw = self.host.clientWidth; if (!cw || self.viewMode === "page") return;
          if (Math.abs(cw - self._lastW) < 12) return;   // ignora micro-variações
          self._lastW = cw; clearTimeout(rot);
          rot = setTimeout(function () { if (self._raw) self.render(); }, 130);
        });
        this._ro.observe(this.host);
      }
      this._updateZoomLabel(); this._updateViewLabel();
      if (mn) mn.classList.toggle("active", this.mnumAll);
    },
    // Zoom da partitura: muda o `scale` do Verovio → quantos compassos cabem por linha
    // (e quantas linhas na mesma altura). Persistido. Re-renderiza do _raw guardado.
    setScale: function (v) {
      this.scale = Math.max(16, Math.min(72, Math.round(v)));
      try { localStorage.setItem("praxis.score.scale", this.scale); } catch (e) {}
      this._updateZoomLabel();
      this.render();
    },
    zoomScore: function (mult) { this.setScale((this.scale || 40) * mult); },
    _updateZoomLabel: function () { var el = document.getElementById("score-zoomval"); if (el) el.textContent = Math.round((this.scale || 40) / 40 * 100) + "%"; },
    // Alterna Página (quebras do arquivo, folha impressa) e Display (melhor uso da tela, reflui).
    setViewMode: function (mode) {
      this.viewMode = (mode === "page") ? "page" : "display";
      try { localStorage.setItem("praxis.score.view", this.viewMode); } catch (e) {}
      this._updateViewLabel();
      this.render();
    },
    _updateViewLabel: function () {
      var b = document.getElementById("score-view"); if (!b) return;
      var page = this.viewMode === "page";
      b.classList.toggle("active", page);
      b.title = page ? "Modo Página (quebras do arquivo). Clique para Display (aproveita a tela)." : "Modo Display (aproveita a tela). Clique para Página (folha impressa).";
      var lab = b.querySelector(".score-view-lab"); if (lab) lab.textContent = page ? "Página" : "Display";
    },
    // Número de compasso em todos os compassos (útil pra transcrição) ou só no início de cada sistema.
    setMnumAll: function (on) {
      this.mnumAll = !!on;
      try { localStorage.setItem("praxis.score.mnum", this.mnumAll ? "1" : "0"); } catch (e) {}
      var b = document.getElementById("score-mnum");
      if (b) { b.classList.toggle("active", this.mnumAll); b.title = this.mnumAll ? "Números em todos os compassos. Clique para mostrar só no início de cada linha." : "Números só no início de cada linha. Clique para mostrar em todos os compassos."; }
      this.render();
    },
    // Inverte as cores da partitura (fundo escuro). Independente do tema do app.
    toggleInvert: function () {
      if (!this.host) return;
      var on = this.host.classList.toggle("inverted");
      var b = document.getElementById("score-invert"); if (b) b.classList.toggle("active", on);
    },

    setStatus: function (msg) { var el = document.getElementById("score-status"); if (el) el.textContent = msg || ""; },

    // Carrega o Verovio (~7 MB) uma única vez, sob demanda.
    ensureVerovio: function () {
      var self = this;
      if (this.ready) return Promise.resolve();
      if (this._loading) return this._loading;
      this._loading = new Promise(function (res, rej) {
        var s = document.createElement("script");
        s.src = new URL("vendor/verovio/verovio-org-latest.js", document.baseURI).href;
        s.onload = function () {
          if (!(window.verovio && verovio.module)) { rej(new Error("Verovio não carregou")); return; }
          function boot() { try { self.tk = new verovio.toolkit(); self.ready = true; res(); } catch (e) { rej(e); } }
          if (verovio.module.calledRun) boot(); else verovio.module.onRuntimeInitialized = boot;
        };
        s.onerror = function () { rej(new Error("Falha ao carregar o Verovio")); };
        document.head.appendChild(s);
      });
      return this._loading;
    },

    loadFile: async function (file) {
      try {
        this.setStatus("Carregando o motor de partitura…");
        await this.ensureVerovio();
        var xml = null;
        if (/\.mxl$/i.test(file.name)) { try { xml = await _mxlToXml(await file.arrayBuffer()); } catch (e) { xml = null; } }
        else { xml = await file.text(); }
        if (xml != null) { this._raw = { kind: "xml", data: this._sanitizeXML(xml) }; }
        else { this._raw = { kind: "zip", data: _b64(await file.arrayBuffer()) }; }   // .mxl que não descompactou: carrega o zip cru (Verovio descompacta)
        this._notated = null; this._harmSpecs = [];   // invalida o cache de grafia e as cifras da partitura anterior (arquivo novo)
        this.name = file.name;
        this.render();
        this.setStatus(this.name + " · " + this.measureCount + " compassos");
      } catch (e) { this.setStatus("Erro: " + (e && e.message ? e.message : e)); }
    },
    // Remove os <staff-details ... print-object="no"/> auto-fechados (toggles no meio da partitura, típicos de
    // leadsheets "expandidas"): eles fazem o Chrome NÃO pintar o 1º compasso de cada sistema no SVG inline.
    // São só marcadores de visibilidade de pentagrama; não mudam o conteúdo musical. (Confirmado com arquivo real.)
    _sanitizeXML: function (xml) {
      if (typeof xml !== "string") return xml;
      return xml.replace(/<staff-details\b[^>]*\bprint-object="no"[^>]*\/>/g, "");
    },

    // Extrai seções da partitura carregada a partir do MusicXML cru. Duas fontes, como o
    // João marca as seções: barra dupla (<bar-style>light-light</bar-style>) e marca de ensaio
    // (<rehearsal>). Devolve marcadores {measure, name} em ordinal de compasso (1..N), na mesma
    // convenção da transcrição (compasso = posição do <measure> na 1ª parte). null = sem partitura
    // legível; [] = partitura sem barra dupla nem marca de ensaio.
    extractSections: function () {
      if (!this._raw || this._raw.kind !== "xml" || typeof this._raw.data !== "string") return null;
      var doc;
      try { doc = new DOMParser().parseFromString(this._raw.data, "application/xml"); } catch (e) { return null; }
      if (!doc || doc.getElementsByTagName("parsererror").length) return null;
      var part = doc.querySelector("part"); if (!part) return null;
      var measures = part.getElementsByTagName("measure"), total = measures.length;
      if (!total) return [];
      var byMeasure = {};   // ordinal -> nome (nome de ensaio vence nome vazio de barra dupla)
      function mark(ord, name) {
        if (ord < 1 || ord > total) return;
        if (!(ord in byMeasure) || (name && !byMeasure[ord])) byMeasure[ord] = name || "";
      }
      for (var i = 0; i < total; i++) {
        var ord = i + 1, meas = measures[i];
        // marca de ensaio → começo de seção neste compasso
        var reh = meas.getElementsByTagName("rehearsal")[0];
        if (reh && reh.textContent) { var t = reh.textContent.trim(); if (t) mark(ord, t); }
        // barras: barra dupla = fim de seção → nova seção no próximo compasso (ou neste, se à esquerda)
        var bars = meas.getElementsByTagName("barline");
        for (var b = 0; b < bars.length; b++) {
          var bl = bars[b];
          if (bl.getElementsByTagName("repeat").length) continue;   // barra de repetição não é seção
          var styEl = bl.getElementsByTagName("bar-style")[0];
          var sty = styEl ? (styEl.textContent || "").trim() : "";
          if (sty !== "light-light") continue;   // light-heavy sem repetição = barra final da peça; não abre seção
          var loc = (bl.getAttribute("location") || "right").toLowerCase();
          mark(loc === "left" ? ord : ord + 1, "");
        }
      }
      var out = Object.keys(byMeasure).map(function (k) { return { measure: +k, name: byMeasure[k] }; });
      out.sort(function (a, b) { return a.measure - b.measure; });
      return out;
    },

    // ===================== Cifragem (Grafia) =====================
    // Troca a grafia das cifras e re-renderiza. Persiste a escolha (padrão global).
    setNotation: function (n) {
      if (n !== "original" && (!window.Grafia || window.Grafia.NOTATIONS.indexOf(n) < 0)) return;
      this.notation = n;
      try { localStorage.setItem("praxis.notation", n); } catch (e) {}
      this._notated = null;
      if (this._raw && this.ready) this.render();
    },
    // XML pronto para o Verovio, com as cifras já convertidas para a grafia atual (cacheado).
    _dataForRender: function () {
      if (!this._raw || this._raw.kind !== "xml") return this._raw ? this._raw.data : "";
      if (this.notation === "original") return this._raw.data;   // cifra crua do arquivo (o que o participante viu)
      if (this._notated != null && this._notatedFor === this.notation) return this._notated;
      this._notated = this._applyNotation(this._raw.data);
      this._notatedFor = this.notation;
      return this._notated;
    },
    // Mapa: <kind> semântico do MusicXML → chave de tipo da Grafia.
    _KINDMAP: {
      "major": "maj", "": "maj", "none": "maj",
      "minor": "min", "augmented": "aug", "diminished": "dim",
      "dominant": "7", "major-seventh": "maj7", "minor-seventh": "m7",
      "diminished-seventh": "dim7", "augmented-seventh": "7#5", "half-diminished": "m7b5",
      "major-minor": "mMaj7", "minor-major": "mMaj7",
      "major-sixth": "6", "minor-sixth": "m6",
      "dominant-ninth": "9", "major-ninth": "maj9", "minor-ninth": "m9",
      "dominant-11th": "11", "dominant-13th": "13",
      "suspended-second": "sus2", "suspended-fourth": "sus4", "power": "5"
    },
    // Deduz a chave de tipo da Grafia a partir do <kind> + <degree>s. Se não reconhecer (com alterações
    // que não sei mapear), devolve null → mantém o `text` original do arquivo (sem regressão).
    _grafiaType: function (kindEl, h) {
      var kind = (kindEl.textContent || "").trim().toLowerCase();
      var base = this._KINDMAP[kind];
      var degs = h.getElementsByTagName("degree");
      if (!degs.length) return base || null;
      if (degs.length === 1) {
        var d = degs[0];
        var vEl = d.getElementsByTagName("degree-value")[0], aEl = d.getElementsByTagName("degree-alter")[0], tEl = d.getElementsByTagName("degree-type")[0];
        var val = vEl ? parseInt(vEl.textContent, 10) : NaN;
        var alt = aEl ? (parseInt(aEl.textContent, 10) || 0) : 0;
        var dt = tEl ? (tEl.textContent || "").trim().toLowerCase() : "";
        if (base === "7") {
          if (val === 9 && alt === -1) return "7b9";
          if (val === 9 && alt === 1) return "7#9";
          if (val === 11 && alt === 1) return "7#11";
          if (val === 5 && alt === 1) return "7#5";
          if (val === 5 && alt === -1) return "7b5";
          if (val === 9 && alt === 0 && dt === "add") return "9";
        }
        if (base === "maj" && val === 9 && dt === "add") return "add9";
        if (base === "6" && val === 9 && dt === "add") return "69";
        if (base === "9" && val === 5 && (dt === "subtract" || dt === "omit")) return "9omit5";
        if (base === "m7" && val === 9 && alt === 0 && dt === "add") return "m9";
      }
      // sus4 com 7 (e 9): dominante suspenso → 7sus4 / 9sus4 (o 7 aqui é o b7 da cifra).
      if (base === "sus4") {
        var s7 = false, s9 = false, sOk = degs.length > 0;
        for (var j = 0; j < degs.length; j++) {
          var sd = degs[j];
          var sv = parseInt((sd.getElementsByTagName("degree-value")[0] || {}).textContent, 10);
          var sa = parseInt((sd.getElementsByTagName("degree-alter")[0] || {}).textContent, 10) || 0;
          var stt = ((sd.getElementsByTagName("degree-type")[0] || {}).textContent || "").trim().toLowerCase();
          if (stt !== "add") { sOk = false; break; }
          if (sv === 7) s7 = true; else if (sv === 9 && sa === 0) s9 = true; else { sOk = false; break; }
        }
        if (sOk && s7) return s9 ? "9sus4" : "7sus4";
      }
      // Dominante com extensões NATURAIS empilhadas (add 9/11/13 sem alteração) → a mais alta nomeia o acorde.
      if (base === "7") {
        var allNat = degs.length > 0, hi = 0;
        for (var k = 0; k < degs.length; k++) {
          var dd = degs[k];
          var vv = parseInt((dd.getElementsByTagName("degree-value")[0] || {}).textContent, 10);
          var aa = parseInt((dd.getElementsByTagName("degree-alter")[0] || {}).textContent, 10) || 0;
          var tt = ((dd.getElementsByTagName("degree-type")[0] || {}).textContent || "").trim().toLowerCase();
          var lvl = (vv === 13 || vv === 6) ? 13 : (vv === 11 || vv === 4) ? 11 : (vv === 9 || vv === 2) ? 9 : 0;
          if (tt !== "add" || aa !== 0 || !lvl) { allNat = false; break; }
          if (lvl > hi) hi = lvl;
        }
        if (allNat && hi) return hi === 13 ? "13" : hi === 11 ? "11" : "9";
      }
      return null;   // alterações não reconhecidas: preserva o original
    },
    // Mapa: <kind> semântico → decomposição base (tríade/sétima/6ª/tensões implícitas) para o GERADOR da Grafia.
    _KINDBASE: {
      "major": { triad: "maj" }, "": { triad: "maj" }, "none": { triad: "maj" },
      "minor": { triad: "min" }, "augmented": { triad: "aug" }, "diminished": { triad: "dim" },
      "dominant": { triad: "maj", seventh: "dom" }, "major-seventh": { triad: "maj", seventh: "maj" },
      "minor-seventh": { triad: "min", seventh: "dom" }, "diminished-seventh": { triad: "dim", seventh: "dim" },
      "augmented-seventh": { triad: "aug", seventh: "dom" },
      "half-diminished": { triad: "min", seventh: "dom", tensions: [{ deg: 5, alt: -1 }] },
      "major-minor": { triad: "min", seventh: "maj" }, "minor-major": { triad: "min", seventh: "maj" },
      "major-sixth": { triad: "maj", sixth: true }, "minor-sixth": { triad: "min", sixth: true },
      "dominant-ninth": { triad: "maj", seventh: "dom", tensions: [{ deg: 9, alt: 0 }] },
      "major-ninth": { triad: "maj", seventh: "maj", tensions: [{ deg: 9, alt: 0 }] },
      "minor-ninth": { triad: "min", seventh: "dom", tensions: [{ deg: 9, alt: 0 }] },
      "dominant-11th": { triad: "maj", seventh: "dom", tensions: [{ deg: 9, alt: 0 }, { deg: 11, alt: 0 }] },
      "dominant-13th": { triad: "maj", seventh: "dom", tensions: [{ deg: 9, alt: 0 }, { deg: 11, alt: 0 }, { deg: 13, alt: 0 }] },
      "suspended-second": { triad: "sus2" }, "suspended-fourth": { triad: "sus4" }, "power": { triad: "5" }
    },
    // Constrói o descritor {triad,seventh,sixth,tensions} a partir do kind + <degree>s (equivalentes 2/4/6 → 9/11/13).
    _harmDescriptor: function (kindEl, h) {
      var kind = (kindEl.textContent || "").trim().toLowerCase();
      var base = this._KINDBASE[kind]; if (!base) return null;
      var tens = (base.tensions || []).map(function (t) { return { deg: t.deg, alt: t.alt }; });
      var degs = h.getElementsByTagName("degree");
      for (var i = 0; i < degs.length; i++) {
        var d = degs[i], vEl = d.getElementsByTagName("degree-value")[0], aEl = d.getElementsByTagName("degree-alter")[0], tEl = d.getElementsByTagName("degree-type")[0];
        if (!vEl) continue;
        var dt = tEl ? (tEl.textContent || "").trim().toLowerCase() : "add";
        if (dt === "subtract" || dt === "omit") continue;
        var v = parseInt(vEl.textContent, 10), a = aEl ? (parseInt(aEl.textContent, 10) || 0) : 0;
        var deg = v === 2 ? 9 : v === 4 ? 11 : v === 6 ? 13 : v;
        if ([5, 9, 11, 13].indexOf(deg) < 0) continue;
        var found = false;
        for (var j = 0; j < tens.length; j++) { if (tens[j].deg === deg) { tens[j].alt = a; found = true; break; } }
        if (!found) tens.push({ deg: deg, alt: a });
      }
      return { triad: base.triad, seventh: base.seventh || null, sixth: !!base.sixth, tensions: tens };
    },
    // Fundamental/baixo de um <harmony> como string tipo "Bb" (which = "root" | "bass"); null se ausente.
    _stepAlter: function (h, which) {
      var st = h.getElementsByTagName(which + "-step")[0]; if (!st) return null;
      var step = (st.textContent || "").trim(); if (!step) return null;
      var al = h.getElementsByTagName(which + "-alter")[0];
      var a = al ? (parseInt(al.textContent, 10) || 0) : 0;
      return step + (a === 1 ? "#" : a === 2 ? "x" : a === -1 ? "b" : a === -2 ? "bb" : "");
    },
    // Reescreve o atributo text de cada <kind> conforme a grafia (fallback do Verovio) E monta this._harmSpecs
    // (uma entrada por <harmony>, na ordem do documento = ordem dos g.harm no SVG) para a sobreposição tipográfica.
    _applyNotation: function (xml) {
      var G = window.Grafia;
      this._harmSpecs = [];
      if (!G || typeof xml !== "string") return xml;
      var doc;
      try { doc = new DOMParser().parseFromString(xml, "application/xml"); } catch (e) { return xml; }
      if (!doc || doc.getElementsByTagName("parsererror").length) return xml;
      var conv = (this.notation === "jazz" || this.notation === "realbook") ? "us" : "br";
      var harms = doc.getElementsByTagName("harmony"), changed = 0;
      for (var i = 0; i < harms.length; i++) {
        var h = harms[i], kindEl = h.getElementsByTagName("kind")[0];
        if (!kindEl) { this._harmSpecs.push(null); continue; }
        var root = this._stepAlter(h, "root"), bass = this._stepAlter(h, "bass");
        var type = this._grafiaType(kindEl, h);
        if (type) {                                   // tipo nomeado (idiomático: ø, Δ, fração 6/9…)
          var suffix = G.symbol(type, { notation: this.notation, convention: conv });
          if (suffix != null) { kindEl.setAttribute("text", suffix); kindEl.setAttribute("use-symbols", "no"); changed++; }
          this._harmSpecs.push(root ? { root: root, type: type, notation: this.notation, convention: conv, bass: bass } : null);
        } else {                                      // sem tipo nomeado: gerador a partir das partes
          var desc = this._harmDescriptor(kindEl, h);
          if (desc && root) {
            desc.root = root; desc.bass = bass; desc.notation = this.notation; desc.convention = conv;
            this._harmSpecs.push({ gen: desc });
          } else this._harmSpecs.push(null);
        }
      }
      if (!changed) return xml;
      try { return new XMLSerializer().serializeToString(doc); } catch (e) { return xml; }
    },
    // Sobrepõe a tipografia da Grafia (HTML+grafia.css: empilhado, sobrescrito, fração) sobre cada cifra do Verovio,
    // via <foreignObject> no mesmo sistema de coordenadas do g.harm (alinha por x/y/font-size do tspan interno).
    _overlayGrafia: function () {
      if (this.notation === "original") return;   // sem overlay: mostra a cifra crua do Verovio
      var G = window.Grafia; if (!G || !this._harmSpecs || !this.host) return;
      var SVGNS = "http://www.w3.org/2000/svg", XHTML = "http://www.w3.org/1999/xhtml";
      var harms = this.host.querySelectorAll("g.harm");
      for (var i = 0; i < harms.length; i++) {
        var spec = this._harmSpecs[i]; if (!spec) continue;
        var harm = harms[i];
        var inner = harm.querySelector("tspan[font-size]") || harm.querySelector("tspan"); if (!inner) continue;
        var x = parseFloat(inner.getAttribute("x")), y = parseFloat(inner.getAttribute("y")), fs = parseFloat(inner.getAttribute("font-size"));
        if (!(isFinite(x) && isFinite(y) && isFinite(fs) && fs > 0)) continue;
        var htmlStr = spec.gen ? G.chordHtml(spec.gen) : G.html(spec); if (!htmlStr) continue;
        var fill = inner.getAttribute("fill") || harm.getAttribute("fill") || "";
        var text = harm.querySelector("text"); if (text) text.style.visibility = "hidden";
        var fo = document.createElementNS(SVGNS, "foreignObject");
        fo.setAttribute("x", x); fo.setAttribute("y", y - fs);
        fo.setAttribute("width", Math.max(fs * 9, 200)); fo.setAttribute("height", fs * 2.2);
        fo.setAttribute("class", "grafia-fo"); fo.setAttribute("overflow", "visible");
        var div = document.createElementNS(XHTML, "div");
        div.setAttribute("class", "grafia-fo-inner");
        div.setAttribute("style", "font-size:" + fs + "px;" + (fill ? "color:" + fill + ";" : ""));
        div.innerHTML = htmlStr;
        fo.appendChild(div); harm.appendChild(fo);
      }
    },

    // Estado da partitura para embutir no .praxis (arquivo é pequeno; viaja com o projeto).
    // Assim ela é recuperada no começo da sessão junto com áudio e vídeo, sem prompt de permissão.
    serialize: function () {
      if (!this._raw) return null;
      return { name: this.name, raw: this._raw, sourceTierId: this.sourceTierId || null };
    },
    // Restaura a partitura embutida ao abrir um projeto.
    restore: async function (obj) {
      if (!obj || !obj.raw) return;
      try {
        this.setStatus("Carregando a partitura do projeto…");
        await this.ensureVerovio();
        this._raw = obj.raw; this.name = obj.name || "partitura"; this._notated = null;
        if (obj.sourceTierId) this.sourceTierId = obj.sourceTierId;
        this.render();
        this.setStatus(this.name + " · " + this.measureCount + " compassos");
      } catch (e) { this.setStatus("Erro ao restaurar a partitura: " + (e && e.message ? e.message : e)); }
    },

    render: function () {
      if (!this.ready || !this.host || !this._raw) return;
      var w = Math.max(240, this.host.clientWidth - 20), scale = this.scale || 40;
      var page = this.viewMode === "page";
      this.tk.setOptions({
        font: "Leland", scale: scale,
        pageWidth: Math.round(w * 100 / scale),
        pageHeight: 60000, adjustPageHeight: true,   // máximo do Verovio; adjustPageHeight encolhe pra caber o conteúdo
        breaks: page ? "encoded" : "auto",            // Página = quebras do arquivo; Display = melhor uso da tela
        svgViewBox: true,                              // SVG responsivo (viewBox) - reflui certo e não corta bordas
        // margem esquerda 50 (padrão do Verovio): garante que o início de cada sistema não caia em x negativo.
        pageMarginTop: 20, pageMarginBottom: 20, pageMarginLeft: 50, pageMarginRight: 50,
        mnumInterval: this.mnumAll ? 1 : 0,           // número de compasso: todos (1) ou só no início do sistema (0)
        header: "none", footer: "none"
      });
      if (this._raw.kind === "zip") this.tk.loadZipDataBase64(this._raw.data); else this.tk.loadData(this._dataForRender());
      var pages = this.tk.getPageCount() || 1, svg = "";
      for (var p = 1; p <= pages; p++) svg += this.tk.renderToSVG(p);
      svg = svg.replace(/font-family="Times, serif"/g, 'font-family="Edwin, Times, serif"');
      this.host.innerHTML = svg;
      this._overlayGrafia();   // tipografia empilhada da Grafia sobre as cifras do Verovio
      this.measureCount = this.host.querySelectorAll("g.measure").length;
      this._cur = -1;
      this.buildEventMap();   // mapa evento(id)→decimais início/fim (modo de clique + ficha digital)
      if (P.Transcript && P.Transcript.renderFicha) P.Transcript.renderFicha();   // ficha reflete a fórmula da peça
    },

    // --- Codificação por clique / ficha digital -------------------------------------------------------------
    // Mapa id-do-evento (nota OU pausa) → { mStart, mEnd, ord } via timemap do Verovio. Reproduz a ficha:
    // fração = (qstamp − início do compasso) / duração do compasso (semínimas), arredondada a 2 casas;
    // mStart = ordinal do compasso (1-based) + fração; mEnd = fim da nota (próximo ataque) − 0.01, no compasso
    // onde a nota termina. Cobre tercinas, mudanças de fórmula e anacruse (o Verovio já dá o qstamp certo).
    buildEventMap: function () {
      this._eventMap = {}; this._measSpans = [];
      if (!this.tk || !this.tk.renderToTimemap) { this._extractTimeSigs(); return; }
      var tm; try { var raw = this.tk.renderToTimemap({ includeMeasures: true, includeRests: true }); tm = (typeof raw === "string") ? JSON.parse(raw) : raw; } catch (e) { this._extractTimeSigs(); return; }
      if (!tm || !tm.length) { this._extractTimeSigs(); return; }
      var measures = [], totalQ = 0, i;
      for (i = 0; i < tm.length; i++) { if (tm[i].measureOn) measures.push({ q: tm[i].qstamp, ord: measures.length + 1 }); if (tm[i].qstamp > totalQ) totalQ = tm[i].qstamp; }
      if (!measures.length) { this._extractTimeSigs(); return; }
      for (i = 0; i < measures.length; i++) { measures[i].end = (i + 1 < measures.length) ? measures[i + 1].q : Math.max(totalQ, measures[i].q + 1); measures[i].dur = (measures[i].end - measures[i].q) || 1; }
      this._measSpans = measures;
      function measAt(q, atEnd) { for (var m = measures.length - 1; m >= 0; m--) { if (atEnd ? (q > measures[m].q + 1e-6) : (q >= measures[m].q - 1e-6)) return measures[m]; } return measures[0]; }
      function frac(q, m) { return Math.round(((q - m.q) / m.dur) * 100) / 100; }
      var r2 = function (x) { return Math.round(x * 100) / 100; };
      var offOf = {};
      for (i = 0; i < tm.length; i++) { var q = tm[i].qstamp; (tm[i].off || []).forEach(function (id) { offOf[id] = q; }); (tm[i].restsOff || []).forEach(function (id) { offOf[id] = q; }); }
      for (i = 0; i < tm.length; i++) {
        var ev = tm[i], onIds = (ev.on || []).concat(ev.restsOn || []), isRest = {};
        (ev.restsOn || []).forEach(function (id) { isRest[id] = true; });
        for (var c = 0; c < onIds.length; c++) {
          var id = onIds[c], onQ = ev.qstamp, offQ = (offOf[id] != null) ? offOf[id] : onQ;
          var mS = measAt(onQ, false), mE = measAt(offQ, true);
          this._eventMap[id] = { mStart: r2(mS.ord + frac(onQ, mS)), mEnd: r2(mE.ord + frac(offQ, mE) - 0.01), ord: mS.ord, rest: !!isRest[id] };
        }
      }
      this._extractTimeSigs();
    },
    eventDecimals: function (id) { return (this._eventMap && this._eventMap[id]) || null; },
    // Duração (em semínimas) do compasso de ordinal 1-based - para converter figuras (semínima/colcheia…) em fração.
    measureDurQuarters: function (ord) { var m = this._measSpans && this._measSpans[ord - 1]; return (m && m.dur) || 4; },
    // Fórmulas de compasso distintas da peça (para a ficha). Vazio se não há partitura.
    timeSigs: function () { return (this._timeSigs || []).slice(); },
    // Ficha digital de um compasso: para cada subdivisão comum, os decimais de início e de fim (fim = próximo − 0.01).
    // Mesma lógica da ficha impressa, mas gerada da fórmula - funciona para qualquer compasso.
    fichaFor: function (beats, beatType) {
      var measDur = beats * 4 / beatType;   // duração em semínimas
      function grid(n, label) {
        if (!(n > 0) || n % 1 !== 0) return null;
        var starts = [], ends = [];
        for (var k = 0; k < n; k++) { starts.push(Math.round((k / n) * 100) / 100); ends.push(Math.round(((k + 1) / n) * 100) / 100 - 0.01); }
        return { label: label, starts: starts, ends: ends };
      }
      return [grid(measDur, "Semínima"), grid(measDur * 2, "Colcheia"), grid(measDur * 4, "Semicolcheia"), grid(measDur * 3, "Tercina de colcheia")].filter(Boolean);
    },
    // MusicXML de um compasso cheio de uma subdivisão (q=semínima, e=colcheia, s=semicolcheia, t=tercina de colcheia).
    // MusicXML de 1 compasso de uma subdivisão, com os decimais JÁ EMBUTIDOS: início como <direction> (acima) e
    // fim como <lyric> (abaixo). Assim o Verovio alinha os números às notas sozinho - sem overlay por pixel.
    _fichaMeasureXml: function (ts, kind) {
      var measDur = ts.beats * 4 / ts.beatType, n, durEach, type, trip = false;
      if (kind === "q") { n = measDur; durEach = 12; type = "quarter"; }
      else if (kind === "e") { n = measDur * 2; durEach = 6; type = "eighth"; }
      else if (kind === "s") { n = measDur * 4; durEach = 3; type = "16th"; }
      else { n = measDur * 3; durEach = 4; type = "eighth"; trip = true; }
      if (!(n > 0) || n % 1 !== 0) return null;
      function fdec(x) { x = Math.round(x * 100) / 100; return x === 0 ? ".0" : String(x).replace(/^0\./, "."); }
      var P7 = ["C", "D", "E", "F", "G", "A", "B"], out = [], k;
      for (k = 0; k < n; k++) {
        var ini = fdec(Math.round((k / n) * 100) / 100), fim = fdec(Math.round(((k + 1) / n) * 100) / 100 - 0.01);
        out.push('<direction placement="above"><direction-type><words>' + ini + '</words></direction-type></direction>');
        var s = '<note><pitch><step>' + P7[k % 7] + '</step><octave>5</octave></pitch><duration>' + durEach + '</duration><type>' + type + '</type>';
        if (trip) { s += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'; var p = k % 3; if (p === 0) s += '<notations><tuplet type="start"/></notations>'; else if (p === 2) s += '<notations><tuplet type="stop"/></notations>'; }
        s += '<lyric><syllabic>single</syllabic><text>' + fim + '</text></lyric></note>';
        out.push(s);
      }
      return '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>12</divisions><time><beats>' + ts.beats + '</beats><beat-type>' + ts.beatType + '</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' + out.join("") + '</measure></part></score-partwise>';
    },
    // Ficha VISUAL: um pentagrama por subdivisão (toolkit próprio, sem tocar na peça carregada). Os decimais já
    // vêm embutidos no MusicXML (início acima = <direction>, fim abaixo = <lyric>), então nada de overlay.
    renderFichaVisual: function (host) {
      if (!host) return;
      var self = this;
      this.ensureVerovio().then(function () {
        if (!self._fichaTk) { try { self._fichaTk = new verovio.toolkit(); } catch (e) { return; } }
        var tk = self._fichaTk;
        var sigs = self.timeSigs(); if (!sigs.length) sigs = [{ beats: 2, beatType: 4 }, { beats: 3, beatType: 4 }, { beats: 4, beatType: 4 }];
        var frag = document.createElement("div");
        var kinds = [{ k: "q", label: "Semínima" }, { k: "e", label: "Colcheia" }, { k: "s", label: "Semicolcheia" }, { k: "t", label: "Tercina de colcheia" }];
        var hint = document.createElement("p"); hint.className = "hint"; hint.style.marginTop = "0"; hint.textContent = "Início (acima) e fim (abaixo, = próximo − 0,01) por nota. O modo de clique calcula isso sozinho."; frag.appendChild(hint);
        sigs.forEach(function (ts) {
          var title = document.createElement("div"); title.style.cssText = "font-weight:700;margin:10px 0 2px"; title.textContent = ts.beats + "/" + ts.beatType; frag.appendChild(title);
          kinds.forEach(function (kd) {
            var xml = self._fichaMeasureXml(ts, kd.k); if (!xml) return;
            tk.setOptions({ scale: 30, adjustPageHeight: true, pageMarginTop: 2, pageMarginBottom: 2, pageMarginLeft: 4, pageMarginRight: 4, header: "none", footer: "none", svgViewBox: true, breaks: "none", mnumInterval: 0 });
            tk.loadData(xml);
            var svg = tk.renderToSVG(1);
            var lab = document.createElement("div"); lab.className = "hint"; lab.style.cssText = "font-size:10px;margin-top:6px"; lab.textContent = kd.label; frag.appendChild(lab);
            var sw = document.createElement("div"); sw.className = "tr-ficha-staff"; sw.style.cssText = "background:#fff;border-radius:4px;padding:2px 0;overflow-x:auto"; sw.innerHTML = svg;
            frag.appendChild(sw);
          });
        });
        host.innerHTML = ""; host.appendChild(frag);
      }).catch(function () {});
    },
    // Liga/desliga o modo de clique. onPick(id, {mStart,mEnd,ord,rest}) é chamado a cada clique numa nota/pausa.
    setPickMode: function (on, onPick) {
      this.pickMode = !!on; this._onPick = on ? (onPick || null) : null;
      if (this.host) this.host.classList.toggle("score-pick", this.pickMode);
      if (!on) this.clearPicks();
    },
    clearPicks: function () {
      if (!this.host) return;
      var els = this.host.querySelectorAll(".pick-start, .pick-end");
      for (var i = 0; i < els.length; i++) els[i].classList.remove("pick-start", "pick-end");
    },
    // Realça a nota/pausa escolhida (kind: "start" | "end"). Remove o realce anterior do mesmo tipo.
    markPick: function (id, kind) {
      if (!this.host) return;
      var cls = kind === "end" ? "pick-end" : "pick-start";
      var old = this.host.querySelectorAll("." + cls);
      for (var i = 0; i < old.length; i++) old[i].classList.remove(cls);
      var el = this.host.querySelector('g[id="' + id + '"]');
      if (el) el.classList.add(cls);
    },
    // Fórmulas de compasso distintas da peça, para a ficha digital. Lê do MEI do Verovio (funciona p/ xml e mxl).
    _extractTimeSigs: function () {
      this._timeSigs = [];
      var xml = null;
      try { if (this.tk && this.tk.getMEI) xml = this.tk.getMEI({ noLayout: true }); } catch (e) {}
      if (!xml) { try { xml = (this._raw && this._raw.kind === "xml") ? this._dataForRender() : null; } catch (e2) {} }
      if (!xml) return;
      var out = [], seen = {};
      function add(b, u) { if (b > 0 && u > 0) { var k = b + "/" + u; if (!seen[k]) { seen[k] = 1; out.push({ beats: b, beatType: u }); } } }
      try {
        var doc = new DOMParser().parseFromString(xml, "application/xml");
        var all = doc.getElementsByTagName("*");
        for (var i = 0; i < all.length; i++) {
          var el = all[i], tag = (el.localName || el.tagName || "").toLowerCase();
          if (tag === "time") { var b = el.getElementsByTagName("beats")[0], t = el.getElementsByTagName("beat-type")[0]; if (b && t) add(+b.textContent, +t.textContent); }
          else if (tag === "metersig") add(+(el.getAttribute("count") || 0), +(el.getAttribute("unit") || 0));
          else { var mc = el.getAttribute && el.getAttribute("meter.count"), mu = el.getAttribute && el.getAttribute("meter.unit"); if (mc && mu) add(+mc, +mu); }
        }
      } catch (e3) {}
      this._timeSigs = out;
    },

    // Remove o realce e zera o compasso corrente (partitura "não sabe onde está").
    _clearHighlight: function () {
      var host = this.host; if (!host) return;
      var svg = host.querySelector("svg"); if (svg) { var old = svg.querySelector("#score-hl"); if (old) old.remove(); }
      this._cur = -1;
    },
    // Suprime totalmente o acompanhamento da partitura (sem realce nem rolagem). Ligar limpa o realce atual.
    setSuppressed: function (on) {
      on = !!on;
      if (on === this.suppressed) { if (on) this._clearHighlight(); return; }
      this.suppressed = on;
      if (on) this._clearHighlight();
    },
    // Realça o compasso idx (0-based) e (se doScroll !== false) rola até o centro. doScroll=false só move o realce
    // sem rolar - usado quando "seguir a agulha" está desligado (deixa o usuário olhar outra região).
    highlightMeasure: function (idx, doScroll) {
      if (this.suppressed) return;   // partitura em branco (segmento sem dados completos)
      if (idx === this._cur) return;
      var host = this.host; if (!host) return;
      var svg = host.querySelector("svg"); if (!svg) return;
      var old = svg.querySelector("#score-hl"); if (old) old.remove();
      var ms = svg.querySelectorAll("g.measure");
      this._cur = idx;
      if (!ms[idx]) return;
      var g = ms[idx];
      // bbox do compasso SEM os overlays de cifra (foreignObject largo, com overflow visível): eles inflariam
      // o realce e o fariam invadir o compasso seguinte. Escondo, meço, restauro (só ao trocar de compasso).
      var fos = g.querySelectorAll("foreignObject.grafia-fo"), disp = [];
      for (var k = 0; k < fos.length; k++) { disp.push(fos[k].getAttribute("display")); fos[k].setAttribute("display", "none"); }
      var bb; try { bb = g.getBBox(); } catch (e) { bb = null; }
      for (var k2 = 0; k2 < fos.length; k2++) { if (disp[k2] == null) fos[k2].removeAttribute("display"); else fos[k2].setAttribute("display", disp[k2]); }
      if (!bb) return;
      // Largura horizontal pela PAUTA (barra-a-barra): não inclui cifras/ligaduras/quiálteras que transbordam
      // para o compasso seguinte. Vertical pelo compasso todo (bb), para cobrir a linha de cifras acima da pauta.
      var hx = bb.x, hw = bb.width, staff = g.querySelector("g.staff");
      if (staff) { try { var sbb = staff.getBBox(); if (sbb.width > 0) { hx = sbb.x; hw = sbb.width; } } catch (e) {} }
      var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("id", "score-hl"); r.setAttribute("class", "score-hl");
      r.setAttribute("x", hx); r.setAttribute("y", bb.y); r.setAttribute("width", hw); r.setAttribute("height", bb.height);
      g.parentNode.insertBefore(r, g);
      if (doScroll === false) return;   // realce fica, mas não rola (modo "olhar livre")
      // Rola só o necessário p/ mostrar o SISTEMA inteiro do compasso tocado (não corta no meio): se já está
      // todo visível, não mexe; se está cortado em cima, alinha o topo; se em baixo, alinha a base (com margem).
      var gr = g.getBoundingClientRect(), hr = host.getBoundingClientRect(), margin = 12;
      if (gr.top < hr.top + margin) host.scrollTo({ top: Math.max(0, host.scrollTop + (gr.top - hr.top) - margin), behavior: "smooth" });
      else if (gr.bottom > hr.bottom - margin) host.scrollTo({ top: host.scrollTop + (gr.bottom - hr.bottom) + margin, behavior: "smooth" });
    },

    // Camada de prática fonte de compassos (a escolhida, ou a 1ª com mStart/mEnd finitos).
    _sourceTier: function () {
      var ts = P.Segmenter.tiers || [], self = this;
      if (this.sourceTierId) { var t = ts.filter(function (x) { return x.id === self.sourceTierId; })[0]; if (t) return t; }
      return ts.filter(function (t) { return t.kind === "practice" && t.segments.some(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); }); })[0];
    },
    // Tempo de anotação → índice de compasso (0-based) por interpolação linear no segmento.
    measureAtTime: function (T, strict) {
      var t = this._sourceTier(); if (!t) return -1;
      var segs = t.segments, first = null, last = null;
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (!(isFinite(s.tStart) && isFinite(s.tEnd) && isFinite(s.mStart) && isFinite(s.mEnd))) continue;
        if (!first || s.tStart < first.tStart) first = s;
        if (!last || s.tEnd > last.tEnd) last = s;
        if (T >= s.tStart && T <= s.tEnd) {
          var frac = s.tEnd > s.tStart ? (T - s.tStart) / (s.tEnd - s.tStart) : 0;
          return Math.round(s.mStart + frac * (s.mEnd - s.mStart)) - 1;
        }
      }
      if (strict) return -1;   // modo estrito: sem chutes de ponta (usado pela seleção de trecho - só move com dado real)
      if (!first) return -1;
      // Fora de qualquer segmento mapeado: ancora nas pontas (voltar ao início → 1º compasso; passar do fim → último).
      // Lacuna interna → -1 (mantém o último compasso destacado, sem pular).
      if (T <= first.tStart) return first.mStart - 1;
      if (T >= last.tEnd) return last.mEnd - 1;
      return -1;
    },
    // Inverso: TODOS os tempos de anotação em que o compasso (0-based) é tocado - uma instância por segmento da
    // camada-fonte que o cobre (o mesmo compasso reaparece a cada repetição da prática), ORDENADOS. Fatias iguais
    // dentro do segmento. Vazio se o compasso não está mapeado.
    timesAtMeasure: function (idx0) {
      var t = this._sourceTier(); if (!t) return [];
      var m = idx0 + 1, segs = t.segments, out = [];   // mStart/mEnd são 1-based
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (!(isFinite(s.tStart) && isFinite(s.tEnd) && isFinite(s.mStart) && isFinite(s.mEnd))) continue;
        if (m >= s.mStart && m <= s.mEnd) {
          var n = (s.mEnd - s.mStart) + 1;
          out.push(s.tStart + (m - s.mStart) / n * (s.tEnd - s.tStart));
        }
      }
      out.sort(function (a, b) { return a - b; });
      return out;
    },
    // Chamado pela agulha (renderPlayhead) da ①. doScroll opcional: por padrão respeita o toggle "seguir a agulha"
    // (rola só se follow ligado); chamadas deliberadas (clicar/selecionar trecho) passam true para sempre rolar.
    // ESTRITO: só destaca dentro de cobertura real da camada-fonte - nunca chuta o 1º/último compasso (região sem
    // dado deixa a partitura parada, mesmo tocando).
    syncToTime: function (T, doScroll) {
      if (this.suppressed || !this.ready || !this.measureCount) return;
      var idx = this.measureAtTime(T, true);
      if (idx >= 0 && idx < this.measureCount) this.highlightMeasure(idx, doScroll == null ? this.follow : doScroll);
    },
    // Liga/desliga "seguir a agulha". Ao religar, salta para o compasso atual.
    setFollow: function (on) {
      this.follow = !!on;
      try { localStorage.setItem("praxis.score.follow", this.follow ? "1" : "0"); } catch (e) {}
      var b = document.getElementById("score-follow"); if (b) b.classList.toggle("active", this.follow);
      if (this.follow && P.Segmenter && P.Segmenter.annNow) { this._cur = -1; this.syncToTime(P.Segmenter.annNow(), true); }
    },

    toggleCollapsed: function () {
      var stage = document.querySelector(".seg-stage"); if (!stage) return;
      var hidden = stage.classList.toggle("score-collapsed");
      var b = document.getElementById("score-collapse");
      if (b) {
        b.title = hidden ? "Mostrar a partitura" : "Ocultar a partitura";
        b.innerHTML = hidden
          ? '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l12 12M7.4 4.3A6.8 6.8 0 0 1 9 4c5 0 7.5 5 7.5 5a13 13 0 0 1-2.1 2.7M4.9 5.5A13 13 0 0 0 1.5 9S4 14 9 14a6.8 6.8 0 0 0 2.4-.45"/></svg>'
          : '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 9S4 4 9 4s7.5 5 7.5 5-2.5 5-7.5 5S1.5 9 1.5 9z"/><circle cx="9" cy="9" r="2"/></svg>';
      }
      if (P._refreshPanels) P._refreshPanels();   // atualiza a lista de painéis minimizados
    }
  };

  function _b64(buf) { var u = new Uint8Array(buf), s = "", chunk = 0x8000; for (var i = 0; i < u.length; i += chunk) s += String.fromCharCode.apply(null, u.subarray(i, i + chunk)); return btoa(s); }

  // Extrai o MusicXML de dentro de um .mxl (ZIP) no navegador, pra podermos sanear o XML antes de renderizar.
  // Lê pelo Central Directory (tamanhos confiáveis, sem depender de data descriptors) e descomprime com
  // DecompressionStream. Se algo falhar, quem chama cai no fluxo antigo (Verovio descompacta o zip, sem sanear).
  async function _mxlToXml(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), td = new TextDecoder("utf-8");
    var eocd = -1;
    for (var p = u8.length - 22; p >= 0; p--) { if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; } }
    if (eocd < 0) throw new Error("EOCD não encontrado");
    var cdOff = dv.getUint32(eocd + 16, true), cdCount = dv.getUint16(eocd + 10, true);
    var entries = [], off = cdOff;
    for (var n = 0; n < cdCount; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), compSize = dv.getUint32(off + 20, true);
      var nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), commentLen = dv.getUint16(off + 32, true);
      var localOff = dv.getUint32(off + 42, true);
      var name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
      entries.push({ name: name, method: method, compSize: compSize, localOff: localOff });
      off += 46 + nameLen + extraLen + commentLen;
    }
    var cand = entries.filter(function (e) { return /\.xml$/i.test(e.name) && !/container\.xml$/i.test(e.name); });
    if (!cand.length) cand = entries.filter(function (e) { return /\.xml$/i.test(e.name); });
    cand.sort(function (a, b) { return b.compSize - a.compSize; });
    var e = cand[0]; if (!e) throw new Error("Sem MusicXML no .mxl");
    var lo = e.localOff, lNameLen = dv.getUint16(lo + 26, true), lExtraLen = dv.getUint16(lo + 28, true);
    var dataStart = lo + 30 + lNameLen + lExtraLen, comp = u8.subarray(dataStart, dataStart + e.compSize);
    var bytes;
    if (e.method === 0) { bytes = comp; }
    else if (e.method === 8) {
      var ds = new DecompressionStream("deflate-raw");
      bytes = new Uint8Array(await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer());
    } else { throw new Error("Compressão não suportada (" + e.method + ")"); }
    return td.decode(bytes);
  }

  P.Score = S;
})(window.Praxis = window.Praxis || {});
