/* segmenter.js - Módulo A: player + segmentação multi-tier + Whisper.
   Modos de segmentação (como no ELAN):
     - "two"  : two keystrokes / não-adjacente (Enter marca início, Enter marca fim). DEFAULT.
     - "one"  : one keystroke / adjacente (cada Enter fecha o atual e abre o próximo; Esc encerra).
   Compensação de reação (delay em ms) recua o corte. Até 9 tiers, cada uma de
   vocabulário controlado (categorias customizáveis) ou texto livre. */
(function (P) {
  "use strict";

  var uid = 0;
  function nid() { return "t" + (++uid); }
  function _clone(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  var DEFAULT_VOCAB = [
    ["EX", "Execução"], ["VC", "Vocalização"]
  ];

  // Modelos Whisper (ONNX). O base é vendorizado (offline no disco); os demais são
  // baixados sob demanda do HuggingFace na 1ª vez e ficam no cache do navegador
  // (offline depois). Só fp32 (o q8 corrompe o texto neste runtime). Maior = melhor e mais pesado.
  // dtype: os menores rodam em fp32 (o q8/int8 corrompe o texto neste runtime); os GRANDES em
  // fp16 (metade do peso → compila/roda muito mais rápido na GPU, qualidade quase idêntica à fp32;
  // fp32 no large-v3 é inviável - compila por dezenas de minutos). Sem dtype = fp32.
  var WHISPER_MODELS = [
    { id: "Xenova/whisper-tiny", label: "Tiny", size: "75 MB", prec: "fp32" },
    { id: "Xenova/whisper-base", label: "Base", size: "145 MB", vendored: true, prec: "fp32" },
    { id: "Xenova/whisper-small", label: "Small", size: "490 MB", prec: "fp32" },
    { id: "Xenova/whisper-medium", label: "Medium", size: "1,5 GB", prec: "fp32" },
    { id: "onnx-community/whisper-large-v3-turbo", label: "Large v3 turbo", size: "800 MB", prec: "fp16", dtype: { encoder_model: "fp16", decoder_model_merged: "fp16" } },
    { id: "onnx-community/whisper-large-v3", label: "Large v3", size: "1,5 GB", prec: "fp16", dtype: { encoder_model: "fp16", decoder_model_merged: "fp16" } }
  ];
  function whisperModelById(id) { return WHISPER_MODELS.filter(function (m) { return m.id === id; })[0]; }

  var S = {
    media: null, file: null,
    tiers: [], categories: [], activeTierId: null, activeSeg: null, _editIdx: -1,
    segMode: "two", delayMs: 40,
    frameStep: 0.04,          // "quadro" aproximado na web
    pending: {}, chain: {},   // por tier
    selection: [], _selSet: null, _selAnchor: null,   // seleção múltipla de segmentos (camada ativa)
    refs: {}, onGenGCP: null,
    _raf: null,
    whisperModel: "Xenova/whisper-base",   // modelo selecionado (persistido)
    _wsInstalled: null,                     // ids já baixados/cacheados (persistido)

    init: function (refs, onGenGCP) {
      this.refs = refs; this.onGenGCP = onGenGCP;
      var self = this;

      // tiers iniciais (comportamento controlado + verbalização livre)
      this.tiers = [
        { id: nid(), name: "Comportamento de prática", kind: "practice",
          vocab: DEFAULT_VOCAB.map(function (v) { return { code: v[0], label: v[1] }; }),
          activeCat: "EX", segments: [] },
        { id: nid(), name: "Verbalização", kind: "free", vocab: [], activeCat: null, segments: [] }
      ];
      this.activeTierId = this.tiers[0].id;

      // arquivo
      refs.drop.addEventListener("click", function () { self.pickMedia(); });
      ["dragover", "dragenter"].forEach(function (e) { refs.drop.addEventListener(e, function (ev) { ev.preventDefault(); refs.drop.classList.add("hover"); }); });
      ["dragleave", "drop"].forEach(function (e) { refs.drop.addEventListener(e, function (ev) { ev.preventDefault(); refs.drop.classList.remove("hover"); }); });
      refs.drop.addEventListener("drop", async function (ev) {
        var items = ev.dataTransfer.items, files = [], byName = {};
        if (P.hasFSA && items && items.length && items[0].getAsFileSystemHandle) {
          for (var i = 0; i < items.length; i++) {
            var it = items[i]; if (it.kind !== "file") continue;
            try { var h = await it.getAsFileSystemHandle(); if (h && h.kind === "file") { var f = await h.getFile(); files.push(f); byName[f.name] = h; continue; } } catch (e) {}
            var ff = it.getAsFile(); if (ff) files.push(ff);
          }
          if (files.length) { self.loadFiles(files, byName); return; }
        }
        if (ev.dataTransfer.files.length) self.loadFiles(ev.dataTransfer.files);
      });
      refs.fileInput.addEventListener("change", function () { if (this.files.length) { self.loadFiles(this.files); this.value = ""; } });
      var vh = document.getElementById("video-hide"); if (vh) vh.addEventListener("click", function () { self.toggleVideoHidden(); });
      try { var vs = parseFloat(localStorage.getItem("praxis.video.scale")); if (!isNaN(vs)) this._videoScale = Math.max(0.5, Math.min(4, vs)); } catch (e) {}
      var vzo = document.getElementById("video-zoomout"), vzi = document.getElementById("video-zoomin");
      if (vzo) vzo.addEventListener("click", function () { self.zoomVideo(1 / 1.15); });
      if (vzi) vzi.addEventListener("click", function () { self.zoomVideo(1.15); });
      if (refs.player) refs.player.addEventListener("wheel", function (e) { if (!(e.ctrlKey || e.metaKey) || !self._playerVideo()) return; e.preventDefault(); self.zoomVideo(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
      this._applyVideoScale();

      // projeto
      if (refs.saveProject) refs.saveProject.addEventListener("click", function () { self.exportProject(); });
      if (refs.openProject) refs.openProject.addEventListener("click", function () { self.openProjectPicker(); });
      if (refs.openProjectFile) refs.openProjectFile.addEventListener("change", function () { if (this.files[0]) self.importProject(this.files[0]); });

      // transporte
      refs.playBtn.addEventListener("click", function () { self.togglePlay(); });
      refs.nav.forEach(function (b) { b.addEventListener("click", function () { self.nudge(parseFloat(b.dataset.nudge)); }); });
      refs.toStart.addEventListener("click", function () { if (self.media) self.seekTo(0); });
      refs.speed.forEach(function (b) { b.addEventListener("click", function () { self.setSpeed(parseFloat(b.dataset.speed)); }); });

      // modo / delay
      refs.segMode.addEventListener("change", function () { self.segMode = this.value; self.setStatus("Modo: " + (this.value === "one" ? "one keystroke (adjacente)" : "two keystrokes (não-adjacente)"), ""); });
      refs.delay.addEventListener("input", function () { self.delayMs = parseInt(this.value, 10) || 0; refs.delayVal.textContent = self.delayMs + " ms"; });

      // tiers
      refs.addTier.addEventListener("click", function () { self.addTier(); });

      // whisper / ações
      refs.whisperBtn.addEventListener("click", function () { self.startTranscription(null); });
      if (refs.whisperPause) refs.whisperPause.addEventListener("click", function () { self.pauseTranscription(); });
      if (refs.whisperHere) refs.whisperHere.addEventListener("click", function () { self.startTranscription(self.media ? self.media.currentTime : 0); });
      this.loadWhisperPrefs();
      var wsel = document.getElementById("seg-wmodel"), wget = document.getElementById("seg-wmodel-get");
      if (wsel) wsel.addEventListener("change", function () { self.setWhisperModel(this.value); });
      if (wget) wget.addEventListener("click", function () { self.downloadWhisperModel(); });
      this.renderWhisperModelUI();
      this._checkVendoredModel();   // o Base vem no zip de release; no repositório git ele não existe
      if (refs.merge) refs.merge.addEventListener("input", function () {
        self.mergeGap = parseFloat(refs.merge.value);
        if (refs.mergeVal) refs.mergeVal.textContent = self.mergeGap.toFixed(1).replace(".", ",") + " s";
        self.regroupFromRaw();
      });
      if (refs.merge) refs.merge.addEventListener("change", function () { self.commit(); });   // registra no histórico ao soltar
      var ub = document.getElementById("seg-undo"), rb = document.getElementById("seg-redo");
      if (ub) ub.addEventListener("click", function () { self.undo(); });
      if (rb) rb.addEventListener("click", function () { self.redo(); });
      if (refs.genGcp) refs.genGcp.addEventListener("click", function () { self.generateGCP(); });
      this.refreshExportUI();   // monta a UI de exportação nas abas Segmentar e Transcrever
      if (refs.split) refs.split.addEventListener("click", function () { self.splitAtCursor(); });
      if (refs.blade) refs.blade.addEventListener("click", function () { self.toggleBlade(); });
      if (refs.mergePrev) refs.mergePrev.addEventListener("click", function () { self.mergeActive(-1); });
      if (refs.mergeNext) refs.mergeNext.addEventListener("click", function () { self.mergeActive(1); });
      if (refs.resetWhisper) refs.resetWhisper.addEventListener("click", function () { self.resetWhisper(); });

      // atalhos
      document.addEventListener("keydown", function (ev) { self.onKey(ev); });

      P.Timeline.attach(refs.timeline, {
        layers: function () { return self.timelineLayers(); },
        activeId: function () { return self.activeTierId; },
        selected: function (s) { return self._isSelected(s); },          // predicado p/ realçar no canvas
        selectionList: function () { return self.selection; },           // refs selecionados (mover/redimensionar em grupo)
        onSelectOnly: function (L, s) { self.activeTierId = L.id; self._setSelection([s]); self._selAnchor = s; self.renderTiers(); self.renderPicker(); },   // arrastar item não-selecionado seleciona só ele
        onClearSelection: function () { if (self.selection.length) self.clearSelection(); },   // clique em espaço vazio limpa a seleção
        onSelect: function (sel) {   // arrastar na área das camadas (rubber-band) → seleciona os segmentos da camada ativa no intervalo
          if (!sel) return;
          var t = self.activeTier(); if (!t) return;
          var a = Math.min(sel.a, sel.b), b = Math.max(sel.a, sel.b);
          var hits = t.segments.filter(function (s) { return isFinite(s.tStart) && isFinite(s.tEnd) && s.tStart < b && s.tEnd > a; });
          self._setSelection(hits); self._selAnchor = hits.length ? hits[0] : null;
        },
        onSeek: function (t) { if (self.media) self.seekTo(t); },
        onSegmentClick: function (L, si, s, mods) { self._onSegClick(L, si, s, mods); },
        onBlade: function (L, si, s, time) { self.bladeSplit(L, s, time); },   // ferramenta blade: divide o segmento clicado no ponto do cursor
        onMarkClick: function (L, mi, m) { self.removeIndexMark(L.id, m); },   // clique num marcador de índice (faixa superior da banda) o remove

        onSegmentEdit: function (L, si, s) {   // fim de um arrasto/resize (de 1 ou vários): reflete na lista e registra no histórico
          self.activeTierId = L.id; self.activeSeg = { tierId: L.id, index: L.segments.indexOf(s) };
          self.renderList(); self.updateActions(); self.commit();
          self.setStatus("Segmento(s) ajustado(s).", "");
        }
      });

      this.renderTiers();
      this.renderPicker();
      this.renderList();
      this.renderTimeline();
      this.resetHistory();   // linha de base do desfazer/refazer
      this._renderMediaPrompt([]);   // estado vazio do player (carregar mídia é pelo modal / zona de importação)
    },

    activeTier: function () { var self = this; return this.tiers.filter(function (t) { return t.id === self.activeTierId; })[0]; },

    // Camadas com vocabulário/escores clicáveis (picker + código na lista).
    isScored: function (t) { return !!t && (t.kind === "controlled" || t.kind === "practice" || t.kind === "dimensao"); },
    escalaMaxOf: function (t) { return (t && t.escalaMax) || (t && t.vocab ? t.vocab.length : 0) || 5; },

    // Cor de um escore numa dimensão: matiz base da camada (cor), clareando os
    // escores baixos. Escore mais alto = tom mais saturado. Fallback: paleta.
    // Cor de um código de comportamento: usa a cor customizada do vocabulário (v.color) se houver, senão a paleta por posição.
    codeColor: function (t, code) {
      if (t && t.vocab) { for (var i = 0; i < t.vocab.length; i++) if (t.vocab[i].code === code) return t.vocab[i].color || P.GCP.colorFor.call(P.GCP, code, i); }
      return P.GCP.colorFor.call(P.GCP, code, 0);
    },
    dimColor: function (t, value) {
      var base = t.cor || P.PALETTE_COLOR[this.tiers.indexOf(t) % P.PALETTE_COLOR.length];
      var n = this.escalaMaxOf(t), sc = parseFloat(value);
      if (!isFinite(sc) || n <= 1) return base;
      var frac = Math.max(0, Math.min(1, (sc - 1) / (n - 1)));   // 0 no escore 1, 1 no escore N
      var m = base.replace("#", "");
      if (m.length === 3) m = m.split("").map(function (c) { return c + c; }).join("");
      var r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
      var mix = 0.15 + 0.85 * frac;   // escore baixo clareia até 85% em direção ao branco
      function ch(x) { return Math.round(x * mix + 255 * (1 - mix)); }
      function hx(x) { return ("0" + x.toString(16)).slice(-2); }
      return "#" + hx(ch(r)) + hx(ch(g)) + hx(ch(b));
    },

    // --- Codificação por switch temporal (dimensões) ----------------------------
    // Modelo Miklaszewski: a dimensão é uma função em degraus. Internamente vive
    // como segmentos CONTÍGUOS {tStart,tEnd,value}. Uma "troca" é o ponto onde o
    // escore muda; o valor segura até a próxima troca (ou o fim do tempo analisado).
    // Fonte única: mutam P.Segmenter.tiers; re-renderiza ①, lista, timeline e ④.

    // Fim do tempo analisado (tempo de anotação): mídia carregada ou maior tEnd.
    _dimEnd: function (T) {
      var end = 0, m = this.media;
      if (m && isFinite(m.duration) && m.duration > 0) end = m.duration - (this.mediaOffset || 0);
      end = Math.max(end, this.maxTime());
      if (T != null) end = Math.max(end, T);
      return end > 0 ? end : (T != null ? T + 1 : 1);
    },
    // Trocas (pontos {t,score}) a partir dos segmentos contíguos, ordenadas.
    _dimPoints: function (tier) {
      return (tier.segments || []).slice()
        .filter(function (s) { return isFinite(s.tStart) && s.value !== "" && s.value != null; })
        .sort(function (a, b) { return a.tStart - b.tStart; })
        .map(function (s) { return { t: s.tStart, score: String(s.value) }; });
    },
    // Reconstrói os segmentos contíguos a partir das trocas: dedup por tempo (o
    // último vence) e funde escores iguais adjacentes (troca redundante some).
    _rebuildDim: function (tier, points, end) {
      points = points.filter(function (p) { return isFinite(p.t) && p.score !== "" && p.score != null; })
                     .sort(function (a, b) { return a.t - b.t; });
      var pts = [];
      points.forEach(function (p) {
        var last = pts[pts.length - 1];
        if (last && Math.abs(last.t - p.t) < 0.02) { pts[pts.length - 1] = p; return; }   // mesmo instante: o último vence
        if (last && String(last.score) === String(p.score)) return;                        // escore contínuo: sem troca
        pts.push(p);
      });
      var segs = [];
      for (var i = 0; i < pts.length; i++) {
        var tStart = pts[i].t, tEnd = (i + 1 < pts.length) ? pts[i + 1].t : end;
        if (tEnd <= tStart + 0.001 && i + 1 < pts.length) continue;
        segs.push({ tStart: tStart, tEnd: Math.max(tEnd, tStart + 0.001), value: String(pts[i].score), note: "" });
      }
      tier.segments = segs;
    },
    // Insere uma troca no tempo T com o escore dado (o gesto de codificação).
    dimSwitchAt: function (tier, T, score) {
      if (!tier || tier.kind !== "dimensao") return;
      if (!isFinite(T)) T = this.annNow();
      T = Math.max(0, T);
      var pts = this._dimPoints(tier).filter(function (p) { return Math.abs(p.t - T) > 0.03; });
      pts.push({ t: T, score: String(score) });
      this._rebuildDim(tier, pts, this._dimEnd(T));
      tier.activeCat = String(score);
      this._afterDimEdit(tier); this.commit();
    },
    // Move a troca de índice `index` para newT (limitado entre as vizinhas).
    // (Chamado por mousemove durante o arrasto: NÃO faz commit aqui; o commit vem no fim do arrasto.)
    dimMoveSwitch: function (tier, index, newT) {
      var pts = this._dimPoints(tier);
      if (!pts[index]) return;
      var lo = index > 0 ? pts[index - 1].t + 0.03 : 0;
      var hi = index < pts.length - 1 ? pts[index + 1].t - 0.03 : this._dimEnd();
      pts[index].t = Math.max(lo, Math.min(hi, newT));
      this._rebuildDim(tier, pts, this._dimEnd());
      this._afterDimEdit(tier);
    },
    // Remove a troca de índice `index` (o degrau anterior estende até o seguinte).
    dimDeleteSwitch: function (tier, index) {
      var pts = this._dimPoints(tier);
      if (!pts[index]) return;
      pts.splice(index, 1);
      this._rebuildDim(tier, pts, this._dimEnd());
      this._afterDimEdit(tier); this.commit();
    },
    _afterDimEdit: function (tier) {
      this.renderList(); this.renderTimeline(); this.renderPicker(); this.updateActions();
      if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
    },
    // Escore corrente de uma dimensão no tempo t (o do último switch, que segura
    // até a próxima troca). null quando t cai antes da 1ª troca ou fora de tudo.
    dimScoreAt: function (tier, t) {
      if (!tier || !tier.segments) return null;
      for (var i = 0; i < tier.segments.length; i++) {
        var s = tier.segments[i];
        if (t >= s.tStart - 1e-6 && t < s.tEnd + 1e-6) { var v = parseFloat(s.value); return isFinite(v) ? v : null; }
      }
      return null;
    },
    // --- Índices do modelo (marcadores instantâneos numa dimensão) ---------------
    // Uma ocorrência é um ponto no tempo {t, code}, guardada em tier.marks. O preset
    // dos índices vive em tier.indices [{code, desc, key}]. Aparece como tick na
    // timeline (Feature 1 respeita visible; showIndices oculta só os marcadores) e
    // como marcador na linha em degraus do Multidimensional. Editável por desfazer.
    addIndexMark: function (tier, code, T) {
      if (!tier || tier.kind !== "dimensao") return;
      if (!tier.marks) tier.marks = [];
      T = Math.max(0, (T != null && isFinite(T)) ? T : this.now());   // tempo explícito (aba ④ usa o relógio dela) ou o now() da mídia
      tier.marks.push({ t: T, code: String(code) });
      tier.marks.sort(function (a, b) { return a.t - b.t; });
      this.renderTimeline(); this.renderPicker(); this.commit();
      if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
      var ix = (tier.indices || []).filter(function (x) { return x.code === code; })[0];
      this.setStatus("Índice «" + code + (ix && ix.desc ? " · " + ix.desc : "") + "» marcado em " + P.fmtTime(T, true) + ".", "ok");
    },
    removeIndexMark: function (tierId, mark) {
      var t = this.tiers.filter(function (x) { return x.id === tierId; })[0];
      if (!t || !t.marks) return;
      var i = t.marks.indexOf(mark); if (i < 0) return;
      t.marks.splice(i, 1);
      this.renderTimeline(); this.commit();
      if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
      this.setStatus("Ocorrência de índice removida.", "");
    },

    // Uma categoria (tipo de prática) está ativa em t quando o escore corrente de
    // TODAS as dimensões que ela restringe cai dentro do respectivo intervalo.
    categoryActiveAt: function (cat, t) {
      if (!cat || !cat.intervalos) return false;
      var self = this, ids = Object.keys(cat.intervalos), any = false;
      for (var i = 0; i < ids.length; i++) {
        var tier = this.tiers.filter(function (x) { return x.id === ids[i] && x.kind === "dimensao"; })[0];
        if (!tier) continue;                       // dimensão removida: ignora a restrição
        any = true;
        var sc = this.dimScoreAt(tier, t), iv = cat.intervalos[ids[i]];
        if (sc == null || sc < iv[0] || sc > iv[1]) return false;
      }
      return any;                                  // precisa de ao menos uma dimensão válida no intervalo
    },

    // camadas no formato que a Timeline consome (prática também é ancorada no tempo do áudio)
    timelineLayers: function () {
      var self = this;
      return this.tiers.map(function (t, tierIdx) {
        // índice código→posição pré-computado UMA vez (evita t.vocab.map() por segmento a cada render → sem lixo/GC)
        var codeIdx = null;
        if (t.vocab && t.vocab.length) { codeIdx = {}; for (var i = 0; i < t.vocab.length; i++) codeIdx[t.vocab[i].code] = i; }
        return {
          id: t.id, name: t.name, segments: t.segments,
          // marcadores de índice (só em dimensões e só quando visíveis) - ticks na faixa superior da banda
          marks: (t.kind === "dimensao" && t.showIndices !== false && t.marks && t.marks.length) ? t.marks : null,
          markColor: t.cor || "#f0a030",
          color: function (s) {
            if (t.kind === "dimensao") return self.dimColor(t, s.value);
            if (t.kind === "controlled" || t.kind === "practice") {
              var ci = (codeIdx && codeIdx[s.value] != null) ? codeIdx[s.value] : 0, v = t.vocab && t.vocab[ci];
              return (v && v.color) || P.GCP.colorFor.call(P.GCP, s.value, ci);   // cor customizada do código, se houver
            }
            return P.GCP.colorFor.call(P.GCP, t.name, tierIdx);
          }
        };
      }).filter(function (L, i) { return self.tiers[i].visible !== false; });   // camadas ocultas (Feature 1) não são desenhadas
    },

    // --- Mídia / transporte -----------------------------------------------------
    loadMedia: function (file, opts) {
      opts = opts || {};
      this.file = file;
      // Se o offset não veio explícito (ex.: arrasto na zona de mídia), casa pelo
      // nome com a mídia do ELAN para aplicar o alinhamento em qualquer caminho.
      if (opts.offset == null && this.elanMedia && this.elanMedia.length) {
        var mm = this.elanMedia.filter(function (m) { return m.name === file.name; })[0];
        if (mm) opts.offset = mm.offset;
      }
      this.mediaOffset = opts.offset || 0;   // TIME_ORIGIN da mídia primária (s)
      // ao trocar a mídia primária, remove o vídeo sincronizado anterior (e o pool de buffers)
      this._vpoolDispose();
      if (this.videoEl && this.videoEl.parentNode) this.videoEl.parentNode.removeChild(this.videoEl);
      this.videoEl = null; this.videoOffset = 0;
      var isVideo = /^video\//.test(file.type) || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
      var host = this.refs.player; host.innerHTML = "";
      if (!isVideo) host.insertAdjacentHTML("beforeend", '<div class="audio-only">' + P.escapeHtml(file.name) + '</div>');
      if (this._mediaObjUrl) { try { URL.revokeObjectURL(this._mediaObjUrl); } catch (e) {} this._mediaObjUrl = null; }   // libera a mídia anterior
      var m = document.createElement(isVideo ? "video" : "audio");
      if (!opts.srcUrl) this._mediaObjUrl = URL.createObjectURL(file);
      m.controls = true; m.src = opts.srcUrl || this._mediaObjUrl; m.style.width = "100%";
      host.appendChild(m); this.media = m;
      if (isVideo) this._applyVideoScale();   // vídeo primário também respeita o zoom
      var self = this;
      m.addEventListener("timeupdate", function () { self.updateTime(); self.renderPlayhead(); self.syncVideo(false); });
      // Sem forma de onda (vídeo primário ou mídia transmitida pelo servidor): a duração da timeline vem dos metadados.
      // Antes ela ficava no valor da sessão anterior (ou 1 s), travando rolagem, zoom e o arrasto do último segmento.
      var noWave = isVideo || !!opts.srcUrl;
      m.addEventListener("loadedmetadata", function () {
        if (noWave && self.media === m && isFinite(m.duration) && m.duration > 0 && !self._wavPeaks && !self._wsAudio)
          P.Timeline.setPeaks(null, 400, m.duration, -(self.mediaOffset || 0));
        self.updateTime(); self.renderTimeline();
      });
      m.addEventListener("play", function () { self.loopRaf(); if (self.videoEl && !self._videoHidden) self.videoEl.play().catch(function () {}); self.syncVideo(true); self.updatePlayIcons(); });
      m.addEventListener("pause", function () { if (self.videoEl) self.videoEl.pause(); self.updatePlayIcons(); });
      m.addEventListener("seeked", function () { self.syncVideo(true); });
      m.addEventListener("ratechange", function () { var r = m.playbackRate; if (self._vpool) self._vpool.forEach(function (p) { p.el.playbackRate = r; }); else if (self.videoEl) self.videoEl.playbackRate = r; });
      this.setSpeed(1);
      this._wavPeaks = null;   // onda da mídia anterior não vale para a nova primária
      this._wsAudio = null; this._wsFile = null; this._wsCursor = 0; this._wsRunning = false; this._wsPaused = false; this._wsRaw = [];
      this.updateWhisperUI();
      this.setStatus("Mídia carregada: " + file.name + (this.mediaOffset ? " · alinhamento do ELAN aplicado (offset " + Math.round(this.mediaOffset * 1000) + " ms)" : ""), "ok");
      // Streaming do servidor (srcUrl): não temos os bytes locais → sem decodificar onda (vídeo primário já era assim).
      if (!opts.srcUrl) this.prepareAudio();
      this.renderMediaPanel();
    },

    // Descarrega toda a mídia atual (usado ao abrir um projeto: o novo não pode herdar a mídia do anterior).
    _clearMedia: function () {
      try { if (this.media && this.media.pause) this.media.pause(); } catch (e) {}
      try { if (this.media && this.media.src) URL.revokeObjectURL(this.media.src); } catch (e) {}
      this._vpoolDispose();
      if (this.videoEl) { try { this.videoEl.pause(); } catch (e) {} if (this.videoEl.parentNode) this.videoEl.parentNode.removeChild(this.videoEl); try { if (this.videoEl.src) URL.revokeObjectURL(this.videoEl.src); } catch (e2) {} }
      this.videoEl = null; this.videoFile = null; this.videoOffset = 0;
      this.media = null; this.file = null; this.mediaOffset = 0;
      this._primaryHandle = null; this._companionHandle = null;
      this._primaryPath = null; this._companionPath = null;
      this._wavPeaks = null; this._videoHidden = false; this._relink = null;
      var host = this.refs && this.refs.player; if (host) host.innerHTML = '<div class="audio-only">Nenhuma mídia carregada.</div>';
      if (P.Timeline && P.Timeline.setPeaks) P.Timeline.setPeaks(null, 400, 0);
      this.renderMediaPanel();
    },
    _isVideoFile: function (f) { return !!f && (/^video\//.test(f.type) || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(f.name)); },

    // Carrega vários arquivos de uma vez, de forma ADITIVA (não substitui o que já está carregado):
    // o áudio vira a mídia primária (relógio + forma de onda) e o vídeo vira acompanhante sincronizado.
    loadFiles: function (list, handleByName) {
      var files = Array.prototype.slice.call(list || []); if (!files.length) return;
      var self = this;
      var auds = files.filter(function (f) { return !self._isVideoFile(f); });
      var vids = files.filter(function (f) { return self._isVideoFile(f); });
      // Preserva o offset (TIME_ORIGIN/alinhamento) já vindo do projeto - recarregar a mídia à mão num projeto reaberto
      // não deve zerar o alinhamento salvo. Captura ANTES: loadMedia(primária) zera this.videoOffset, então guardo aqui.
      var savedVideoOff = this.videoOffset || 0;
      var savedOff = this.mediaOffset ? { offset: this.mediaOffset } : {};
      if (!this.media) {
        if (auds.length) this.loadMedia(auds.shift(), savedOff);
        else if (vids.length) this.loadMedia(vids.shift(), savedOff);
      }
      // vídeos passam a acompanhar o áudio primário, mantendo o alinhamento salvo (o último acompanhante prevalece)
      vids.forEach(function (f) { self.attachVideo(f, savedVideoOff); });
      // áudio extra: se o primário for vídeo, promove o áudio a primário e rebaixa o vídeo a acompanhante;
      // se já houver áudio primário, mantém (não descarta trabalho já em curso).
      auds.forEach(function (f) {
        if (!self.file) { self.loadMedia(f); return; }
        if (self._isVideoFile(self.file)) { var v = self.file, vo = self.mediaOffset || 0; self.loadMedia(f); self.attachVideo(v, vo); }
      });
      this._captureHandles(handleByName);
      this.renderMediaPanel();
    },
    // Guarda os atalhos (FileSystemFileHandle) da primária e do acompanhante, casando por nome.
    _captureHandles: function (handleByName) {
      if (!handleByName) return;
      if (this.file && handleByName[this.file.name]) this._primaryHandle = handleByName[this.file.name];
      if (this.videoFile && handleByName[this.videoFile.name]) this._companionHandle = handleByName[this.videoFile.name];
    },

    // Painel "Mídia carregada": lista a primária (referência de tempo) e o acompanhante,
    // com ajuste de alinhamento e remoção. Alimenta o alinhamento manual enquanto o
    // automático (por onda) não é acionado.
    renderMediaPanel: function () {
      var host = document.getElementById("seg-media-loaded"); if (!host) return;
      host.innerHTML = ""; if (!this.file) return;
      var self = this;
      var wrap = document.createElement("div");
      wrap.style.cssText = "margin-top:10px;border:1px solid var(--line);border-radius:8px;padding:8px 10px";
      var title = document.createElement("div");
      title.className = "hint"; title.style.cssText = "margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.3px";
      title.textContent = "Mídia carregada";
      wrap.appendChild(title);
      var rows = [{ role: "primária", file: this.file, isVideo: this._isVideoFile(this.file), kind: "primary" }];
      if (this.videoFile) rows.push({ role: "acompanhante", file: this.videoFile, isVideo: true, kind: "companion" });
      rows.forEach(function (r) {
        var row = document.createElement("div");
        row.className = "row"; row.style.cssText = "gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px";
        row.innerHTML =
          '<span class="pill" style="flex:0 0 auto">' + (r.isVideo ? "vídeo" : "áudio") + '</span>' +
          '<span class="mini" style="flex:1 1 110px;min-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + P.escapeHtml(r.file.name) + '">' + P.escapeHtml(r.file.name) + '</span>' +
          '<span class="mini" style="flex:0 0 auto;opacity:.75">' + r.role + '</span>';
        wrap.appendChild(row);
        if (r.kind === "companion") {
          var off = document.createElement("div");
          off.className = "row"; off.style.cssText = "gap:5px;align-items:center;flex-wrap:wrap;margin-bottom:6px";
          off.innerHTML =
            '<span class="mini" style="flex:0 0 auto">Alinhamento</span>' +
            '<button class="btn sm ghost" data-off="-0.5" title="Atrasa o acompanhante 500 ms">−500</button>' +
            '<button class="btn sm ghost" data-off="-0.1">−100</button>' +
            '<input type="number" step="0.01" value="' + (self.videoOffset || 0).toFixed(2) + '" style="width:70px;flex:0 0 auto" title="offset em segundos">' +
            '<span class="mini">s</span>' +
            '<button class="btn sm ghost" data-off="0.1">+100</button>' +
            '<button class="btn sm ghost" data-off="0.5" title="Adianta o acompanhante 500 ms">+500</button>' +
            '<button class="btn sm ghost" data-remove title="Remover o vídeo acompanhante">Remover</button>';
          Array.prototype.forEach.call(off.querySelectorAll("[data-off]"), function (b) {
            b.addEventListener("click", function () { self.setCompanionOffset((self.videoOffset || 0) + parseFloat(b.dataset.off)); });
          });
          off.querySelector("input").addEventListener("change", function () { var v = parseFloat(this.value); if (isFinite(v)) self.setCompanionOffset(v); });
          off.querySelector("[data-remove]").addEventListener("click", function () { self.removeCompanion(); });
          wrap.appendChild(off);
          if (self._wavPeaks) {
            var auto = document.createElement("div");
            auto.className = "row"; auto.style.cssText = "gap:6px;align-items:center;margin-bottom:4px";
            auto.innerHTML = '<button class="btn sm secondary" data-autoalign style="flex:1" title="Casa a trilha do vídeo com o WAV pela onda de áudio">Alinhar pelo áudio</button>';
            auto.querySelector("[data-autoalign]").addEventListener("click", function () { self.autoAlign(); });
            wrap.appendChild(auto);
          }
        }
      });
      // Sempre disponível: abrir o modal de mídia para localizar/trocar (caso o usuário veja um problema que o Praxis
      // não detectou). É o gatilho manual do mesmo modal que abre sozinho quando a mídia não é encontrada.
      var add = document.createElement("div");
      add.className = "row"; add.style.cssText = "margin-top:6px";
      add.innerHTML = '<button class="btn sm wide" id="seg-add-media" style="display:inline-flex;align-items:center;justify-content:center;gap:7px">' +
        '<svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 14V4h4.5l1.5 2H16v8z"/></svg>Localizar ou trocar mídia</button>';
      add.querySelector("#seg-add-media").addEventListener("click", function () { self.openMediaModal({ blocking: false }); });
      wrap.appendChild(add);
      host.appendChild(wrap);
    },
    // Desloca no tempo os segmentos das camadas ancoradas a um arquivo (item 5): quando o
    // offset daquele arquivo muda em Δ, o conteúdo se move e as notas o acompanham (por −Δ).
    _shiftAnchored: function (anchor, dT) {
      if (!dT || !isFinite(dT)) return 0;
      var n = 0;
      (this.tiers || []).forEach(function (t) {
        if ((t.anchor || "primary") !== anchor) return;
        var moved = false;
        (t.segments || []).forEach(function (s) {
          if (isFinite(s.tStart)) { s.tStart = Math.max(0, s.tStart + dT); moved = true; }
          if (isFinite(s.tEnd)) { s.tEnd = Math.max(0, s.tEnd + dT); moved = true; }
        });
        (t.marks || []).forEach(function (mk) { if (isFinite(mk.t)) { mk.t = Math.max(0, mk.t + dT); moved = true; } });   // marcadores de índice seguem a âncora
        if (moved) n++;
      });
      if (n) {
        this.renderList(); this.renderTimeline();
        var trv = document.getElementById("view-transcricao");
        if (P.Transcript && P.Transcript.render && trv && trv.classList.contains("active")) P.Transcript.render();
        if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
      }
      return n;
    },
    setCompanionOffset: function (v) {
      v = v || 0; var old = this.videoOffset || 0;
      this.videoOffset = v;
      var shifted = this._shiftAnchored("companion", -(v - old));
      // O offset mudou: os frames PRÉ-BUFFERIZADOS do pool estão no offset antigo. Invalida-os e reposiciona TODOS
      // os elementos no alvo atual - senão o vídeo na tela só corrige depois de reabrir/scrub (bug do "só no reload").
      if (this._vpool && this._vpool.length && this.media) {
        var self = this, target = Math.max(0, this.annNow() + (this.videoOffset || 0));   // = m.currentTime + videoOffset - mediaOffset
        this._vpool.forEach(function (p) { p.t = null; try { p.el.currentTime = target; } catch (e) {} });
        this._vSeekAt = Date.now();
      }
      this.syncVideo(true);
      this.setStatus("Alinhamento do acompanhante: " + Math.round(v * 1000) + " ms" + (shifted ? " · " + shifted + " camada(s) seguiram" : "") + ".", "");
      this.renderMediaPanel();
    },
    removeCompanion: function () {
      this._vpoolDispose();   // o pool inteiro (senão um vídeo bufferizado "ressuscitava" no próximo trecho da aba ②)
      if (this.videoEl && this.videoEl.parentNode) this.videoEl.parentNode.removeChild(this.videoEl);
      this.videoEl = null; this.videoFile = null; this.videoOffset = 0;
      this.setStatus("Vídeo acompanhante removido.", "");
      this.renderMediaPanel();
    },
    // Mostra/oculta o vídeo (mesmo padrão da partitura). Oculto, o vídeo não é buscado no
    // scrub/playback (menos trabalho de compositing/seek) - teste de performance na segmentação.
    toggleVideoHidden: function () {
      var wrap = document.querySelector(".player-wrap"); if (!wrap) return;
      this._videoHidden = !wrap.classList.contains("media-hidden");
      wrap.classList.toggle("media-hidden", this._videoHidden);
      if (this._videoHidden && this.videoEl && !this.videoEl.paused) this.videoEl.pause();   // para a decodificação já
      var b = document.getElementById("video-hide");
      if (b) {
        b.title = this._videoHidden ? "Mostrar o vídeo" : "Ocultar o vídeo (esconder acelera a segmentação)";
        b.innerHTML = this._videoHidden
          ? '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l12 12M7.4 4.3A6.8 6.8 0 0 1 9 4c5 0 7.5 5 7.5 5a13 13 0 0 1-2.1 2.7M4.9 5.5A13 13 0 0 0 1.5 9S4 14 9 14a6.8 6.8 0 0 0 2.4-.45"/></svg>'
          : '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 9S4 4 9 4s7.5 5 7.5 5-2.5 5-7.5 5S1.5 9 1.5 9z"/><circle cx="9" cy="9" r="2"/></svg>';
      }
      if (!this._videoHidden) this.syncVideo(true);   // reexibiu: recasa a imagem com a mídia
      if (P._refreshPanels) P._refreshPanels();       // atualiza a lista de painéis minimizados
    },
    // Zoom do vídeo (mesmo sistema da partitura): <=1 cabe no painel; >1 amplia e o painel rola. Persistido.
    setVideoScale: function (v) {
      this._videoScale = Math.max(0.5, Math.min(4, Math.round(v * 100) / 100));
      try { localStorage.setItem("praxis.video.scale", this._videoScale); } catch (e) {}
      this._applyVideoScale();
    },
    zoomVideo: function (mult) { this.setVideoScale((this._videoScale || 1) * mult); },
    _playerVideo: function () { return (this.refs && this.refs.player) ? this.refs.player.querySelector("video") : this.videoEl; },
    _applyVideoScale: function () {
      var s = this._videoScale || 1, self = this;
      function style(v, active) {
        v.style.width = Math.round(s * 100) + "%";
        v.style.maxWidth = s <= 1 ? "100%" : "none";
        v.style.maxHeight = s <= 1 ? "100%" : "none";
        v.style.margin = "auto";   // auto vira 0 quando ampliado → overflow rolável em todos os lados
        v.style.display = active ? "block" : "none";   // pool: só o ativo aparece
      }
      if (this._vpool && this._vpool.length) this._vpool.forEach(function (p) { style(p.el, p.el === self.videoEl); });
      else { var v = this._playerVideo(); if (v) style(v, true); }
      var el = document.getElementById("video-zoomval"); if (el) el.textContent = Math.round(s * 100) + "%";
    },

    // --- Alinhamento automático por onda (item 4) -------------------------------
    // Envelope de energia do WAV primário na janela [0, win], reamostrado a envHz,
    // a partir dos picos já calculados (this._wavPeaks: min/max intercalados).
    _wavEnvelope: function (win, envHz) {
      var r = this._wavPeaks; if (!r || !r.peaks) return null;
      var peaks = r.peaks, pHz = r.bucketHz, nOut = Math.ceil(win * envHz);
      var env = new Float32Array(nOut);
      var perOut = pHz / envHz;   // picos por balde de saída
      for (var k = 0; k < nOut; k++) {
        var p0 = Math.floor(k * perOut), p1 = Math.max(p0 + 1, Math.floor((k + 1) * perOut));
        var acc = 0, cnt = 0;
        for (var p = p0; p < p1 && (2 * p + 1) < peaks.length; p++) { acc += (peaks[2 * p + 1] - peaks[2 * p]); cnt++; }
        env[k] = cnt ? acc / cnt : 0;
      }
      return env;
    },
    // Envelope de energia da trilha de áudio do vídeo acompanhante, capturado tocando
    // um trecho curto mudo em alta velocidade (evita decodificar o arquivo inteiro na RAM).
    _captureVideoEnvelope: function (win, envHz, rate, onProgress) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var file = self.videoFile; if (!file) return reject(new Error("sem vídeo acompanhante"));
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return reject(new Error("Web Audio indisponível"));
        var cap = document.createElement("video");
        cap.preload = "auto"; cap.muted = false;
        // Vídeo carregado como File (arrasto/seletor) = Blob → object URL. Vídeo de projeto REABERTO vem por
        // streaming do servidor e videoFile é só um stub {name,size} → monta a URL de mídia (mesmo origin, sem taint).
        var objUrl = null;
        if (file instanceof Blob) { objUrl = URL.createObjectURL(file); cap.src = objUrl; }
        else { cap.src = self.mediaUrl({ name: file.name, size: file.size, path: self._companionPath }) + "&_ts=" + Date.now(); }
        var ctx = new AC(), src, sp, done = false;
        var nOut = Math.ceil(win * envHz), sum = new Float32Array(nOut), cnt = new Float32Array(nOut);
        function cleanup() { try { cap.pause(); } catch (e) {} try { sp && sp.disconnect(); src && src.disconnect(); } catch (e) {} try { ctx.close(); } catch (e) {} try { if (objUrl) URL.revokeObjectURL(objUrl); } catch (e) {} }
        function finish() {
          if (done) return; done = true; cleanup();
          var env = new Float32Array(nOut);
          for (var k = 0; k < nOut; k++) env[k] = cnt[k] ? sum[k] / cnt[k] : 0;
          resolve(env);
        }
        cap.addEventListener("error", function () { if (!done) { done = true; cleanup(); reject(new Error("não consegui ler o áudio do vídeo")); } });
        cap.addEventListener("loadedmetadata", function () {
          try {
            src = ctx.createMediaElementSource(cap);
            sp = ctx.createScriptProcessor(512, 1, 1);
            sp.onaudioprocess = function (e) {
              var inp = e.inputBuffer.getChannelData(0), rms = 0, i;
              for (i = 0; i < inp.length; i++) rms += inp[i] * inp[i];
              rms = Math.sqrt(rms / inp.length);
              var k = Math.floor(cap.currentTime * envHz);
              if (k >= 0 && k < nOut) { sum[k] += rms; cnt[k]++; }
              var out = e.outputBuffer.getChannelData(0); for (i = 0; i < out.length; i++) out[i] = 0;   // silêncio
              if (onProgress) onProgress(Math.min(1, cap.currentTime / win));
            };
            src.connect(sp); sp.connect(ctx.destination);
            cap.playbackRate = rate || 2; cap.currentTime = 0;
            cap.play().catch(function (err) { if (!done) { done = true; cleanup(); reject(err); } });
          } catch (err) { if (!done) { done = true; cleanup(); reject(err); } }
        });
        cap.addEventListener("timeupdate", function () { if (cap.currentTime >= win) finish(); });
        cap.addEventListener("ended", finish);
        setTimeout(function () { if (!done) finish(); }, Math.max(8000, (win / (rate || 2)) * 1000 + 6000));   // salvaguarda
      });
    },
    // Botão "Alinhar pelo áudio": casa a trilha do vídeo com o WAV por correlação cruzada
    // dos envelopes e aplica o offset (que, pelo item 5, desloca as notas ancoradas ao vídeo).
    autoAlign: async function () {
      if (!this._wavPeaks) { this.setStatus("O alinhamento automático precisa do WAV como mídia primária (a forma de onda).", "err"); return; }
      if (!this.videoFile) { this.setStatus("Carregue o vídeo acompanhante antes de alinhar.", "err"); return; }
      var WIN = 40, ENV_HZ = 25, RATE = 2, SEARCH = 15;   // janela 40 s, 25 Hz, 2×, busca ±15 s
      try {
        this.setStatus("Alinhando: lendo o áudio do vídeo (trecho inicial)…", "work");
        var wav = this._wavEnvelope(WIN, ENV_HZ);
        if (!wav) { this.setStatus("Não há forma de onda do WAV para alinhar.", "err"); return; }
        var vid = await this._captureVideoEnvelope(WIN, ENV_HZ, RATE, function (p) {
          this && null; // noop
        }.bind(this));
        var r = P.xcorrBestLag(wav, vid, Math.round(SEARCH * ENV_HZ));
        if (!isFinite(r.score) || r.score < 0.2) {
          this.setStatus("Alinhamento incerto (correlação baixa " + (r.score || 0).toFixed(2) + "). Ajuste o vídeo à mão pelo painel.", "err");
          return;
        }
        var delta = r.lag / ENV_HZ;                         // segundos que o vídeo está atrasado em relação ao WAV
        var newOff = (this.mediaOffset || 0) + delta;
        this.setCompanionOffset(newOff);
        this.setStatus("Alinhado pelo áudio: vídeo " + Math.round(delta * 1000) + " ms (correlação " + r.score.toFixed(2) + ").", "ok");
      } catch (e) {
        this.setStatus("Falha no alinhamento automático (" + (e && e.message ? e.message : e) + "). Use o ajuste manual do vídeo.", "err");
      }
    },

    // Vídeo sincronizado (só imagem) seguindo a mídia primária (áudio/WAV). TRIPLE-BUFFERING: cria um POOL de N
    // cópias do mesmo arquivo. Uma fica visível/ativa (this.videoEl, toca em sincronia); as outras ficam ocultas,
    // pré-buscadas nos inícios de segmentos vizinhos, para trocar/tocar trechos curtos sem o atraso de busca.
    attachVideo: function (file, offset, srcUrl) {
      if (!this.media) { this.setStatus("Carregue primeiro o áudio (WAV) do ELAN; depois vincule o vídeo.", "err"); return; }
      this._vpoolDispose();
      if (this.videoEl && this.videoEl.parentNode) this.videoEl.parentNode.removeChild(this.videoEl);
      this.videoOffset = offset || 0; this.videoFile = file;
      var host = this.refs.player, self = this, N = this._videoPoolSize();
      this._vpool = [];
      for (var i = 0; i < N; i++) {
        var v = document.createElement("video");
        // srcUrl = streaming do servidor local (range) sem baixar tudo; senão, object URL do File carregado.
        v.src = srcUrl || URL.createObjectURL(file); v.muted = true; v.playsInline = true; v.preload = "auto";
        v.style.cssText = "margin:auto;background:transparent;border-radius:8px;display:" + (i === 0 ? "block" : "none");
        host.insertBefore(v, host.firstChild);
        v.playbackRate = this.media.playbackRate || 1;
        (function (vv) { vv.addEventListener("loadedmetadata", function () { if (vv === self.videoEl) self.syncVideo(true); }); })(v);
        this._vpool.push({ el: v, t: null });
      }
      this.videoEl = this._vpool[0].el;
      this._applyVideoScale();
      this.setStatus("Vídeo vinculado (buffer triplo, áudio " + Math.round((this.mediaOffset || 0) * 1000) + " ms · vídeo " + Math.round((this.videoOffset || 0) * 1000) + " ms).", "ok");
      this.renderMediaPanel();
    },
    // Tamanho do pool de vídeo (triple-buffering). Ajuste manual em localStorage (praxis.video.pool = 1|2|3), ou
    // "auto": 3 em máquina forte, 2 em média, 1 (sem buffer extra) em fraca - para não pesar em notebooks fracos.
    _videoPoolSize: function () {
      var pref = null; try { pref = localStorage.getItem("praxis.video.pool"); } catch (e) {}
      if (pref === "1" || pref === "2" || pref === "3") return +pref;
      var mem = navigator.deviceMemory || 0, cpu = navigator.hardwareConcurrency || 0;   // mem só no Chromium; cpu quase sempre
      if (mem >= 8 && cpu >= 8) return 3;
      if (cpu >= 4 && (mem >= 4 || mem === 0)) return 2;   // mem 0 = desconhecido → benefício da dúvida moderado
      return 1;
    },
    // Recria o pool com o tamanho atual (após mudar o ajuste), preservando arquivo/offset/posição.
    reattachVideoPool: function () {
      if (!this.videoFile || !this.media) return;
      var f = this.videoFile, off = this.videoOffset || 0;
      this.attachVideo(f, off);
      this.syncVideo(true);
    },
    _vpoolDispose: function () {
      if (!this._vpool) return;
      this._vpool.forEach(function (p) { try { p.el.pause(); } catch (e) {} if (p.el.parentNode) p.el.parentNode.removeChild(p.el); try { if (p.el.src) URL.revokeObjectURL(p.el.src); } catch (e2) {} });
      this._vpool = null;
    },
    // Torna `el` o vídeo ativo/visível (os outros do pool ficam ocultos). Aplica a escala/zoom só no ativo.
    _vpoolActivate: function (el) {
      if (!this._vpool) return;
      el.playbackRate = (this.media && this.media.playbackRate) || 1;   // SEMPRE garante a velocidade (mesmo se já for o ativo)
      if (this.videoEl === el) return;
      var old = this.videoEl;
      this.videoEl = el;
      if (old && !old.paused) { try { old.pause(); } catch (e) {} }
      this._applyVideoScale();   // mostra o ativo (block) e oculta o resto (none)
    },
    // Ativa o vídeo do pool já pré-buscado no tempo de anotação T (buffer pronto → toca sem atraso). Se nenhum
    // estiver lá (miss), usa o ativo e busca (fica com o atraso normal). Retorna true no acerto (buffer hit).
    // (Reusar o ativo no replay foi tentado e CONGELAVA o vídeo - rebobinar o elemento visível não completava o
    //  seek; a velocidade no replay é resolvida por `videoPrefetch`/`_vpoolActivate` reaplicarem a taxa.)
    videoActivateAt: function (T) {
      if (!this._vpool || !this._vpool.length) return false;
      var hit = null;
      for (var i = 0; i < this._vpool.length; i++) { var p = this._vpool[i]; if (p.t != null && Math.abs(p.t - T) < 0.05) { hit = p; break; } }
      if (hit) { this._vpoolActivate(hit.el); hit.t = null; return true; }   // vai tocar → invalida a posição bufferizada
      // miss: usa o ativo e busca (fica com o atraso normal)
      var cur = null; for (var j = 0; j < this._vpool.length; j++) if (this._vpool[j].el === this.videoEl) cur = this._vpool[j];
      if (!cur) cur = this._vpool[0];
      this._vpoolActivate(cur.el);
      cur.t = null; this._vSeekAt = Date.now();
      try { cur.el.currentTime = Math.max(0, T + (this.videoOffset || 0)); } catch (e) {}
      return false;
    },
    // Garante que o pool cubra os tempos de anotação `times` (inícios de trechos vizinhos), pré-buscando (pausado)
    // os vídeos que ainda não estão nessas posições. Não mexe no ATIVO enquanto a mídia estiver TOCANDO.
    videoPrefetch: function (times) {
      if (!this._vpool || !this._vpool.length || !times || !times.length) return;
      var self = this, need = times.filter(function (t) { return isFinite(t); });
      function covered(T) { for (var i = 0; i < self._vpool.length; i++) { var p = self._vpool[i]; if (p.t != null && Math.abs(p.t - T) < 0.05) return true; } return false; }
      function isNeeded(t) { for (var k = 0; k < need.length; k++) if (t != null && Math.abs(t - need[k]) < 0.05) return true; return false; }
      var playing = this.media && !this.media.paused;
      need.forEach(function (T) {
        if (covered(T)) return;
        // pega um vídeo "sobrando": não é o ativo-tocando e não cobre uma posição ainda necessária
        var slot = null;
        for (var i = 0; i < self._vpool.length; i++) {
          var p = self._vpool[i];
          if (playing && p.el === self.videoEl) continue;
          if (isNeeded(p.t)) continue;
          slot = p; break;
        }
        if (!slot) return;
        slot.t = T; self._vSeekAt = Date.now();
        slot.el.playbackRate = (self.media && self.media.playbackRate) || 1;   // buffer já na velocidade certa p/ quando for ativado
        try { slot.el.currentTime = Math.max(0, T + (self.videoOffset || 0)); } catch (e) {}
        if (!slot.el.paused) { try { slot.el.pause(); } catch (e2) {} }
      });
    },
    // Desloca o vídeo para casar com a mídia primária. force = busca imediata;
    // caso contrário só corrige quando a deriva passa de ~120 ms (não trava a imagem).
    // Convenção ELAN (verificada por correlação cruzada): tempo_local = tempo_de_anotação + TIME_ORIGIN.
    // JANELA DE CARÊNCIA após um seek: o vídeo precisa de tempo p/ buscar+bufferizar antes de tocar. Sem isso, em
    // trechos curtos cada timeupdate re-buscava o vídeo (deriva > 120 ms enquanto ele ainda alcançava) e ele nunca
    // chegava a tocar - ficava "travado" no início. Na carência (e enquanto ele busca) só deixamos tocar, sem re-buscar.
    syncVideo: function (force) {
      var v = this.videoEl, m = this.media; if (!v || !m) return;
      if (this._videoHidden) { if (v && !v.paused) v.pause(); return; }   // vídeo oculto: não busca (economiza)
      var target = m.currentTime + ((this.videoOffset || 0) - (this.mediaOffset || 0));
      if (target < 0) target = 0;
      if (force) {
        // Só re-busca se estiver REALMENTE fora do alvo. Quando o triple-buffer já pré-posicionou o vídeo (durante
        // o ócio), re-buscar aqui dispara um seek que, sob carga (janela cheia = composição pesada), TRAVA o decoder:
        // readyState cai p/ 1 e o seek nunca completa → imagem congelada. Se já está no alvo, toca direto do quadro.
        if (Math.abs(v.currentTime - target) > 0.08) { this._vSeekAt = Date.now(); try { v.currentTime = target; } catch (e) {} }
      }
      else {
        var now = Date.now();
        var grace = this._vSeekAt && (now - this._vSeekAt < 700);   // logo após um seek: deixa bufferizar/tocar
        // Só corrige deriva GRANDE (o vídeo é referência muda; 1/3 de s é imperceptível) e, ao corrigir, ABRE nova
        // carência. Sem isso, sob carga (janela cheia = thread principal ocupada), o vídeo atrasa > limiar, re-busca,
        // e cada re-busca reinicia o atraso → laço de seeks que "congela" a imagem. A carência deixa ele tocar e
        // alcançar sozinho em vez de re-buscar em cadeia.
        if (!grace && !v.seeking && Math.abs(v.currentTime - target) > 0.34) { this._vSeekAt = now; try { v.currentTime = target; } catch (e) {} }
      }
      if (!m.paused && v.paused) v.play().catch(function () {});
      if (m.paused && !v.paused) v.pause();
    },
    // Busca em tempo de anotação (o tempo dos segmentos). tempo_local = T + offset.
    seekTo: function (T) {
      if (!this.media) return;
      this.media.currentTime = Math.max(0, T + (this.mediaOffset || 0));
      this.syncVideo(true); this.updateTime(); this.renderPlayhead();
    },
    annNow: function () { return (this.media ? this.media.currentTime : 0) - (this.mediaOffset || 0); },

    // Painel de mídia do ELAN: lista os arquivos referenciados (com o offset de
    // sincronia) e deixa o usuário carregar cada um. Áudio (WAV) vira mídia
    // primária (som + forma de onda); vídeo vira imagem sincronizada.
    setElanMedia: function (list) {
      this.elanMedia = list || [];
      var host = document.getElementById("seg-elanmedia"); if (!host) return;
      host.innerHTML = ""; if (!this.elanMedia.length) return;
      var self = this;
      var head = document.createElement("div");
      head.className = "hint"; head.style.cssText = "margin:10px 0 4px";
      head.textContent = "Mídia do ELAN (alinhamento já feito). Carregue os arquivos correspondentes:";
      host.appendChild(head);
      this.elanMedia.forEach(function (md) {
        var row = document.createElement("div");
        row.className = "row"; row.style.cssText = "gap:6px;margin-bottom:6px;align-items:center";
        row.innerHTML =
          '<span class="pill" style="flex:0 0 auto">' + (md.isVideo ? "vídeo" : "áudio") + '</span>' +
          '<span class="mini" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + P.escapeHtml(md.name) + '">' + P.escapeHtml(md.name) + '</span>' +
          '<span class="mini" title="offset de sincronia do ELAN">' + Math.round(md.offset * 1000) + ' ms</span>' +
          '<button class="btn sm secondary" style="flex:0 0 auto">Carregar</button>' +
          '<input type="file" hidden ' + (md.isVideo ? 'accept="video/*,.mp4,.mov,.mkv"' : 'accept="audio/*,.wav"') + '>';
        var btn = row.querySelector("button"), inp = row.querySelector("input");
        function loadElanFile(f, handle) {
          if (md.isVideo) self.attachVideo(f, md.offset); else self.loadMedia(f, { offset: md.offset });
          // guarda o FileSystemFileHandle p/ o "Recarregar mídia (1 clique)" funcionar ao reabrir o projeto
          if (handle) { var bn = {}; bn[f.name] = handle; self._captureHandles(bn); }
        }
        btn.addEventListener("click", async function () {
          // Com File System Access API, abre pelo picker que DEVOLVE handle (persistível), como a zona de mídia normal.
          // Sem isso, a mídia vinda do ELAN entrava por <input file> (sem handle) e não religava ao reabrir.
          if (P.hasFSA && window.showOpenFilePicker) {
            try {
              var acc = md.isVideo ? { "video/*": [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"] } : { "audio/*": [".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"] };
              var hs = await window.showOpenFilePicker({ multiple: false, types: [{ description: md.isVideo ? "Vídeo" : "Áudio", accept: acc }] });
              var h = hs[0], f = await h.getFile();
              loadElanFile(f, h); return;
            } catch (e) { if (e && e.name === "AbortError") return; }   // cancelou → nada; outro erro → cai no <input>
          }
          inp.click();
        });
        inp.addEventListener("change", function () {
          if (!this.files[0]) return;
          loadElanFile(this.files[0], null);
          this.value = "";
        });
        host.appendChild(row);
      });
      var adj = document.createElement("div");
      adj.className = "row"; adj.style.cssText = "gap:6px;margin-top:2px;align-items:center";
      adj.innerHTML = '<span class="mini" style="flex:1">Ajuste fino do vídeo</span>' +
        '<button class="btn sm ghost" data-d="0.1" title="Adianta o vídeo">vídeo +100 ms</button>' +
        '<button class="btn sm ghost" data-d="-0.1" title="Atrasa o vídeo">−100 ms</button>';
      Array.prototype.forEach.call(adj.querySelectorAll("button"), function (b) {
        b.addEventListener("click", function () {
          self.setCompanionOffset((self.videoOffset || 0) + parseFloat(b.dataset.d));
        });
      });
      host.appendChild(adj);
    },

    // Monta a forma de onda. Para WAV (mesmo enorme), lê em blocos e calcula os
    // picos direto, sem carregar o arquivo na memória. Para outros formatos,
    // decodifica pelo navegador quando o tamanho é seguro.
    prepareAudio: async function () {
      var self = this, file = this.file;
      var isWav = /audio\/(x-)?wav|audio\/wave/i.test(file.type) || /\.wav$/i.test(file.name);
      try {
        if (isWav) {
          this.setStatus("Forma de onda: lendo o WAV em blocos…", "work");
          var r = await this.decodeWavPeaks(file, 400, function (p) { self.setStatus("Forma de onda: " + Math.round(p * 100) + "%", "work"); });
          this._wavPeaks = r;   // reaproveitado no alinhamento automático por onda
          this.renderMediaPanel();   // a onda ficou pronta → mostra o botão "Alinhar pelo áudio"
          P.Timeline.setPeaks(r.peaks, r.bucketHz, r.duration, -(this.mediaOffset || 0));
          this.setStatus("Forma de onda pronta · leitura em blocos, memória baixa (" + Math.round(r.peaks.length / 2 / 1000) + " mil pontos, ~" + (r.peaks.byteLength / 1048576).toFixed(1) + " MB).", "ok");
          return;
        }
        var bigCompressed = /^video\//.test(file.type) || file.size > 150 * 1024 * 1024;
        if (bigCompressed) {
          P.Timeline.setPeaks(null, 400, (this.media && isFinite(this.media.duration) ? this.media.duration : this.maxTime()));
          this.setStatus("Arquivo grande compactado: a forma de onda por streaming vale para WAV. Reprodução e segmentos funcionam. Para ver a onda, carregue o WAV correspondente do ELAN.", "err");
          return;
        }
        this.setStatus("Carregando forma de onda (decodificando áudio)…", "work");
        var wave = await this.ensureAudio();      // decodifica + cacheia (_wsAudio/_wsTotal), reaproveitado pelo Whisper
        P.Timeline.setAudio(wave, 16000, this._wsTotal);
        this.setStatus("Forma de onda pronta.", "ok");
      } catch (e) {
        console.error(e);
        this.setStatus("Não consegui gerar a forma de onda (" + (e && e.message ? e.message : e) + "). Reprodução e segmentos seguem funcionando.", "err");
      }
    },

    // Lê um WAV PCM/float em blocos e devolve picos min/max por balde (Float32
    // intercalado), sem materializar o arquivo inteiro. Caminha pelos chunks do
    // RIFF (pula JUNK/LIST etc.) até achar fmt e data.
    decodeWavPeaks: async function (file, bucketHz, onProgress) {
      bucketHz = bucketHz || 400;
      var head = new DataView(await file.slice(0, 262144).arrayBuffer());
      if (head.getUint32(0, false) !== 0x52494646 || head.getUint32(8, false) !== 0x57415645) throw new Error("não é WAV (RIFF/WAVE)");
      var off = 12, fmt = null, dataOff = -1, dataLen = 0;
      while (off + 8 <= head.byteLength) {
        var id = head.getUint32(off, false), sz = head.getUint32(off + 4, true);
        if (id === 0x666d7420) fmt = { format: head.getUint16(off + 8, true), channels: head.getUint16(off + 10, true), sampleRate: head.getUint32(off + 12, true), bits: head.getUint16(off + 22, true) };
        else if (id === 0x64617461) { dataOff = off + 8; dataLen = sz; break; }
        off += 8 + sz + (sz & 1);
      }
      if (!fmt) throw new Error("WAV sem chunk fmt");
      if (dataOff < 0) throw new Error("chunk data não encontrado no cabeçalho");
      if (fmt.format !== 1 && fmt.format !== 3) throw new Error("WAV compactado (formato " + fmt.format + ") não suportado");
      var bytesPer = fmt.bits / 8, frameBytes = bytesPer * (fmt.channels || 1);
      if (dataOff + dataLen > file.size || dataLen <= 0) dataLen = file.size - dataOff;
      var totalFrames = Math.floor(dataLen / frameBytes);
      var duration = totalFrames / fmt.sampleRate;
      var framesPerBucket = Math.max(1, Math.round(fmt.sampleRate / bucketHz));
      var effBucketHz = fmt.sampleRate / framesPerBucket;
      var nBuckets = Math.ceil(totalFrames / framesPerBucket);
      var peaks = new Float32Array(nBuckets * 2);
      var scale = fmt.bits === 16 ? 1 / 32768 : fmt.bits === 32 ? (fmt.format === 3 ? 1 : 1 / 2147483648) : fmt.bits === 8 ? 1 / 128 : 1;
      var bIdx = 0, inBucket = 0, mn = 1, mx = -1;
      var CHUNK = 8 * 1048576; CHUNK -= CHUNK % frameBytes;
      var pos = dataOff, endPos = dataOff + dataLen;
      var ch = fmt.channels || 1;
      while (pos < endPos) {
        var end = Math.min(pos + CHUNK, endPos);
        var abuf = await file.slice(pos, end).arrayBuffer();
        var nframes = Math.floor(abuf.byteLength / frameBytes);
        if (fmt.bits === 16) {
          // caminho rápido para PCM 16-bit (formato dos arquivos reais): Int16Array
          var i16 = new Int16Array(abuf, 0, nframes * ch), inv = 1 / 32768;
          for (var f = 0; f < nframes; f++) {
            var v = i16[f * ch] * inv;
            if (v < mn) mn = v; if (v > mx) mx = v;
            if (++inBucket >= framesPerBucket) { peaks[bIdx * 2] = mn; peaks[bIdx * 2 + 1] = mx; bIdx++; mn = 1; mx = -1; inBucket = 0; }
          }
        } else {
          var view = new DataView(abuf);
          for (var g = 0; g < nframes; g++) {
            var bo = g * frameBytes, w;
            if (fmt.bits === 32 && fmt.format === 3) w = view.getFloat32(bo, true);
            else if (fmt.bits === 32) w = view.getInt32(bo, true) * scale;
            else if (fmt.bits === 8) w = (view.getUint8(bo) - 128) * scale;
            else if (fmt.bits === 24) { var c0 = view.getUint8(bo), c1 = view.getUint8(bo + 1), c2 = view.getUint8(bo + 2), s = (c2 << 16) | (c1 << 8) | c0; if (s & 0x800000) s |= ~0xffffff; w = s / 8388608; }
            else w = 0;
            if (w < mn) mn = w; if (w > mx) mx = w;
            if (++inBucket >= framesPerBucket) { peaks[bIdx * 2] = mn; peaks[bIdx * 2 + 1] = mx; bIdx++; mn = 1; mx = -1; inBucket = 0; }
          }
        }
        pos = end;
        if (onProgress) onProgress((pos - dataOff) / dataLen);
        await new Promise(function (r) { setTimeout(r, 0); });
      }
      if (inBucket > 0 && bIdx < nBuckets) { peaks[bIdx * 2] = mn; peaks[bIdx * 2 + 1] = mx; }
      return { peaks: peaks, bucketHz: effBucketHz, duration: duration };
    },
    togglePlay: function () { if (this.media) { this.media.paused ? this.media.play() : this.media.pause(); } },
    setSpeed: function (r) { if (this.media) { this.media.playbackRate = r; if ("preservesPitch" in this.media) this.media.preservesPitch = true; } this.refs.speed.forEach(function (b) { b.classList.toggle("active", parseFloat(b.dataset.speed) === r); }); },
    // Passa pelos presets de velocidade (dir +1 acelera, -1 desacelera). Snap ao preset mais próximo do atual.
    nudgeSpeed: function (dir) {
      var raw = this.refs.speed.map(function (b) { return parseFloat(b.dataset.speed); });
      var speeds = raw.filter(function (v, i) { return raw.indexOf(v) === i; }).sort(function (a, b) { return a - b; });   // dedupe (botões da timeline + HUD repetem os valores)
      if (!speeds.length) return;
      var cur = this.media ? this.media.playbackRate : 1;
      if (!this.media) { var ab = this.refs.speed.filter(function (b) { return b.classList.contains("active"); })[0]; if (ab) cur = parseFloat(ab.dataset.speed); }
      var idx = 0, best = Infinity;
      for (var i = 0; i < speeds.length; i++) { var d = Math.abs(speeds[i] - cur); if (d < best) { best = d; idx = i; } }
      idx = Math.max(0, Math.min(speeds.length - 1, idx + dir));
      this.setSpeed(speeds[idx]);
      this.setStatus("Velocidade " + String(speeds[idx]).replace(".", ",") + "×.", "");
    },
    nudge: function (dt) { if (!this.media) return; this.media.currentTime = Math.max(0, Math.min(this.media.duration || 1e9, this.media.currentTime + dt)); this.syncVideo(true); this.updateTime(); this.renderPlayhead(); },
    now: function () { return this.media ? Math.max(0, this.annNow() - this.delayMs / 1000) : 0; },
    updateTime: function () {
      if (!this.media) return;
      var cur = P.fmtTime(this.annNow(), true), dur = P.fmtTime((this.media.duration || 0) - (this.mediaOffset || 0));
      this.refs.timeCur.textContent = cur; this.refs.timeDur.textContent = dur;
      var hc = document.getElementById("hud-tcur"), hd = document.getElementById("hud-tdur");
      if (hc) hc.textContent = cur; if (hd) hd.textContent = dur;
    },
    // Sincroniza o ícone do play (transporte da timeline + HUD das outras abas) com a mídia.
    updatePlayIcons: function () {
      var playing = this.media && !this.media.paused;
      var svg = playing
        ? '<svg width="13" height="13" viewBox="0 0 18 18" fill="currentColor"><rect x="3.5" y="2.5" width="4" height="13" rx="1"/><rect x="10.5" y="2.5" width="4" height="13" rx="1"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 18 18" fill="currentColor"><polygon points="4,2 15,9 4,16"/></svg>';
      if (this.refs.playBtn) this.refs.playBtn.innerHTML = svg;
      var h = document.getElementById("hud-play"); if (h) h.innerHTML = playing
        ? '<svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor"><rect x="3.5" y="2.5" width="4" height="13" rx="1"/><rect x="10.5" y="2.5" width="4" height="13" rx="1"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor"><polygon points="4,2 15,9 4,16"/></svg>';
    },
    // Diagnóstico de performance: no console rode  Praxis.Segmenter.perf()  e reproduza;
    // ele imprime os FPS reais e ms/frame por segundo. Praxis.Segmenter.perf(false) desliga.
    perf: function (on) { this._perf = P._perf = (on !== false); return this._perf ? "perf ligado - reproduza e veja os FPS + operações lentas no console" : "perf desligado"; },
    loopRaf: function () {
      var self = this, last = null, frames = 0, acc = 0, jsAcc = 0, jsMax = 0;
      cancelAnimationFrame(this._raf);
      (function tick(ts) {
        if (self._perf && ts != null) {
          if (last != null) { acc += ts - last; frames++; if (acc >= 1000) { console.log("[praxis perf] " + Math.round(frames * 1000 / acc) + " fps · " + (acc / frames).toFixed(1) + " ms/frame · JS " + (jsAcc / frames).toFixed(1) + " ms (pico " + jsMax.toFixed(0) + ") · vídeo " + (self._videoHidden ? "oculto" : (self.videoEl ? "visível" : "nenhum"))); acc = 0; frames = 0; jsAcc = 0; jsMax = 0; } }
          last = ts;
        }
        var __j = self._perf ? performance.now() : 0;
        self.renderPlayhead();
        if (__j) { var jd = performance.now() - __j; jsAcc += jd; if (jd > jsMax) jsMax = jd; }
        if (self.media && !self.media.paused) self._raf = requestAnimationFrame(tick);
      })();
    },

    // --- Teclado ----------------------------------------------------------------
    onKey: function (ev) {
      if (!document.getElementById("view-segmentar").classList.contains("active")) return;
      var tag = (ev.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      // Dimensão ativa: teclas personalizadas para escores 10+ (troca de escore) e para índices (ocorrência).
      // Só disparam na camada ATIVA e têm precedência sobre os atalhos de ação enquanto ativa. (1–9 = escores 1–9, abaixo.)
      var _at = this.activeTier();
      if (_at && _at.kind === "dimensao" && ev.key && ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        var _k = ev.key.toLowerCase();
        if (!(_k >= "1" && _k <= "9")) {
          if (_at.vocab) for (var _vi = 0; _vi < _at.vocab.length; _vi++) {
            if (_at.vocab[_vi].key && String(_at.vocab[_vi].key).toLowerCase() === _k) { ev.preventDefault(); this.dimSwitchAt(_at, this.now(), _at.vocab[_vi].code); return; }
          }
          if (_at.indices) for (var _i = 0; _i < _at.indices.length; _i++) {
            if (_at.indices[_i].key && String(_at.indices[_i].key).toLowerCase() === _k) { ev.preventDefault(); this.addIndexMark(_at, _at.indices[_i].code); return; }
          }
        }
      }
      // atalhos remapeáveis (registro central em P.Keys, editável em Configurações)
      var act = P.Keys && P.Keys.actionFor(ev);
      if (act) { ev.preventDefault(); this._runAction(act); return; }
      // 1–9: código do vocab na camada ativa (dinâmico, não remapeável)
      if (ev.key >= "1" && ev.key <= "9" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        var t = this.activeTier();
        if (t && t.kind === "dimensao") { var vi = +ev.key - 1; if (t.vocab[vi]) this.dimSwitchAt(t, this.now(), t.vocab[vi].code); }
        else if (this.isScored(t)) { var i = +ev.key - 1; if (t.vocab[i]) { t.activeCat = t.vocab[i].code; this.renderPicker(); } }
      }
    },
    _runAction: function (id) {
      switch (id) {
        case "play": this.togglePlay(); break;
        case "tostart": if (this.media) this.seekTo(0); break;
        case "frameBack": this.nudge(-this.frameStep); break;
        case "frameFwd": this.nudge(this.frameStep); break;
        case "halfBack": this.nudge(-0.5); break;
        case "halfFwd": this.nudge(0.5); break;
        case "secBack": this.nudge(-1); break;
        case "secFwd": this.nudge(1); break;
        case "speedUp": this.nudgeSpeed(1); break;
        case "speedDown": this.nudgeSpeed(-1); break;
        case "seg": this.segKey(false); break;
        case "segSkip": this.segKey(true); break;
        case "segMergePrev": this.segMergePrev(); break;
        case "cancel": this.endChain(); this.clearSelection(); if (this.bladeMode) this.setBlade(false); break;
        case "blade": this.toggleBlade(); break;
        case "del": this.deleteSelection(); break;
        case "selall": this.selectAll(); break;
        case "tierUp": this.switchTier(-1); break;
        case "tierDown": this.switchTier(1); break;
        case "undo": this.undo(); break;
        case "redo": this.redo(); break;
        case "zoomIn": P.Timeline.zoomBy(1.3); break;
        case "zoomOut": P.Timeline.zoomBy(1 / 1.3); break;
        case "zoomReset": P.Timeline.zoomReset(); break;
        case "pageNext": P.Timeline.pageNext(); break;
        case "pagePrev": P.Timeline.pagePrev(); break;
      }
    },
    // Seleciona todos os segmentos da camada ativa (Ctrl+A).
    selectAll: function () {
      var t = this.activeTier(); if (!t || !t.segments.length) return;
      this._setSelection(t.segments.slice()); this._selAnchor = t.segments[0];
    },

    switchTier: function (dir) {
      var idx = this.tiers.map(function (t) { return t.id; }).indexOf(this.activeTierId);
      idx = (idx + dir + this.tiers.length) % this.tiers.length;
      this.activeTierId = this.tiers[idx].id;
      this.selection = []; this._selSet = null; this._selAnchor = null;   // seleção é por camada
      this.renderTiers(); this.renderPicker(); this.renderList();
      this._updatePendingUI();   // reflete o estado de "aberto" da camada que passou a ser ativa
    },

    // --- Segmentação ------------------------------------------------------------
    // skip=true (Shift+Enter): apenas reposiciona o ponto aberto no tempo atual, SEM criar segmento -
    // serve para "pular" uma região (deixa um vão). Em ambos os modos, se ainda não há ponto aberto,
    // Shift+Enter só abre o ponto (igual ao primeiro Enter).
    segKey: function (skip) {
      if (!this.media) { this.setStatus("Carregue uma mídia primeiro.", "err"); return; }
      var t = this.activeTier(), tid = t.id, tt = this.now();
      if (this.segMode === "one") {
        if (this.chain[tid] == null) { this.chain[tid] = tt; this.setStatus("Cadeia iniciada em " + P.fmtTime(tt, true) + " (Enter fecha e abre o próximo; Ctrl+Enter pula sem criar; Esc encerra).", "work"); }
        else if (skip) { this.chain[tid] = tt; this.setStatus("Região pulada - ponto reposicionado em " + P.fmtTime(tt, true) + " (sem criar segmento).", ""); }
        else {
          // cria independente da direção (o pushSeg ordena início/fim); só ignora se for o mesmo tempo
          if (Math.abs(tt - this.chain[tid]) > 1e-4) { this.pushSeg(t, this.chain[tid], tt); this.chain[tid] = tt; }
          else this.setStatus("Avance o tempo antes do próximo Enter.", "err");
        }
      } else { // two
        if (this.pending[tid] == null) { this.pending[tid] = tt; this.setStatus("Início marcado em " + P.fmtTime(tt, true) + " - Enter novamente marca o fim.", "work"); }
        else if (skip) { this.pending[tid] = tt; this.setStatus("Região pulada - início remarcado em " + P.fmtTime(tt, true) + " (sem criar segmento).", ""); }
        else {
          if (Math.abs(tt - this.pending[tid]) > 1e-4) { this.pushSeg(t, this.pending[tid], tt); this.pending[tid] = null; }
          else this.setStatus("Marque um fim diferente do início.", "err");
        }
      }
      this._updatePendingUI();
    },
    // Marca o fim do trecho aberto e, em vez de criar um segmento novo, UNE a região ao segmento anterior
    // (estende o anterior sobre [ponto aberto → agora]; os dados do anterior prevalecem). Se não houver anterior,
    // cria normalmente. Atalho padrão: "/".
    segMergePrev: function () {
      if (!this.media) { this.setStatus("Carregue uma mídia primeiro.", "err"); return; }
      var t = this.activeTier(), tid = t.id, tt = this.now();
      var openAt = (this.segMode === "one") ? this.chain[tid] : this.pending[tid];
      if (openAt == null) { this.setStatus("Marque um início (Enter) antes de criar e unir ao anterior.", "err"); return; }
      if (Math.abs(tt - openAt) < 1e-4) { this.setStatus("Avance o tempo antes de criar e unir.", "err"); return; }
      var lo = Math.min(openAt, tt), hi = Math.max(openAt, tt);
      // procura o segmento anterior (o de maior tEnd que termine em lo ou antes) para estender sobre a nova região
      var prev = null, pi = -1;
      for (var i = 0; i < t.segments.length; i++) { var s = t.segments[i]; if (isFinite(s.tEnd) && s.tEnd <= lo + 0.02) { if (!prev || s.tEnd > prev.tEnd) { prev = s; pi = i; } } }
      if (prev) {
        // remove quaisquer segmentos que caiam na nova região (não deixa sobreposição), preservando o anterior
        t.segments = t.segments.filter(function (x) { return x === prev || !(isFinite(x.tStart) && isFinite(x.tEnd) && x.tStart < hi && x.tEnd > lo); });
        prev.tEnd = hi; prev.locked = true;
        pi = t.segments.indexOf(prev);
        this.activeTierId = t.id; this.activeSeg = { tierId: t.id, index: pi };
        this.setStatus("Região unida ao anterior (" + P.fmtTime(prev.tStart, true) + "–" + P.fmtTime(hi, true) + ").", "ok");
      } else {
        this.pushSeg(t, lo, hi);
        this.setStatus("Sem segmento anterior; criado um novo em " + P.fmtTime(lo, true) + "–" + P.fmtTime(hi, true) + ".", "");
      }
      if (this.segMode === "one") this.chain[tid] = tt; else this.pending[tid] = null;
      this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.updateActions(); this.commit();
      this._updatePendingUI();
    },
    // Feedback visual do "segmento aberto" (início marcado, aguardando o fim) na camada ativa:
    // faixa âmbar na timeline (do início até a agulha) + badge no transporte. Some ao fechar/cancelar/trocar de camada.
    _updatePendingUI: function () {
      var t = this.activeTier(), start = null;
      if (t) { var s = (this.segMode === "one") ? this.chain[t.id] : this.pending[t.id]; if (s != null) start = s; }
      if (P.Timeline) { if (start != null && P.Timeline.setPending) P.Timeline.setPending(start); else if (P.Timeline.clearPending) P.Timeline.clearPending(); }
      var badge = document.getElementById("seg-pending"), txt = document.getElementById("seg-pending-txt");
      if (badge) badge.classList.toggle("on", start != null);
      if (txt && start != null) txt.textContent = "aberto em " + P.fmtTime(start, true);
    },
    endChain: function () {
      var t = this.activeTier(), tid = t.id;
      if (this.chain[tid] != null) { this.chain[tid] = null; this.setStatus("Cadeia encerrada.", ""); }
      if (this.pending[tid] != null) { this.pending[tid] = null; this.setStatus("Marcação cancelada.", ""); }
      this._updatePendingUI();
    },

    // --- Seleção múltipla de segmentos (estilo DaVinci: clique = só um; Shift = intervalo; Ctrl = avulso) --------
    _isSelected: function (s) { return this._selSet ? this._selSet.has(s) : false; },
    _setSelection: function (arr) {
      this.selection = arr ? arr.slice() : [];
      this._selSet = new Set(this.selection);
      this.renderList(); this.renderTimeline();
    },
    clearSelection: function () { this._setSelection([]); this._selAnchor = null; },
    _onSegClick: function (L, si, s, mods) {
      mods = mods || {};
      this.activeTierId = L.id;
      if (mods.ctrl) {                          // Ctrl: alterna avulso (sem pegar os do meio)
        var arr = this.selection.slice(), i = arr.indexOf(s);
        if (i >= 0) arr.splice(i, 1); else arr.push(s);
        this._setSelection(arr); this._selAnchor = s;
        this.activeSeg = arr.length ? { tierId: L.id, index: L.segments.indexOf(arr[arr.length - 1]) } : null;
      } else if (mods.shift && this._selAnchor && L.segments.indexOf(this._selAnchor) >= 0) {   // Shift: intervalo da âncora até aqui
        var ia = L.segments.indexOf(this._selAnchor), lo = Math.min(ia, si), hi = Math.max(ia, si);
        this._setSelection(L.segments.slice(lo, hi + 1));
        this.activeSeg = { tierId: L.id, index: si };
      } else {                                   // clique simples: só este + seek
        this._setSelection([s]); this._selAnchor = s;
        this.activeSeg = { tierId: L.id, index: si };
        if (this.media) this.seekTo(s.tStart);
      }
      this.renderTiers(); this.renderPicker();
    },
    // Apaga todos os selecionados (ou o segmento ativo se não houver seleção). Del.
    deleteSelection: function () {
      var t = this.activeTier(); if (!t) return;
      var sel = this._selSet, n = 0;
      if (sel && sel.size) { var before = t.segments.length; t.segments = t.segments.filter(function (s) { return !sel.has(s); }); n = before - t.segments.length; }
      else if (this.activeSeg && this.activeSeg.tierId === t.id && t.segments[this.activeSeg.index]) { t.segments.splice(this.activeSeg.index, 1); n = 1; }
      if (!n) return;
      this.clearSelection(); this.activeSeg = null;
      this.renderList(); this.renderTimeline(); this.updateActions(); this.commit();
      this.setStatus(n + " segmento(s) apagado(s).", "");
    },

    pushSeg: function (t, a, b) {
      var lo = Math.min(a, b), hi = Math.max(a, b);
      if (hi - lo < 1e-4) return;   // segmento nulo (mesmo tempo): ignora
      // Sobrescrita: o novo segmento tem prioridade no intervalo [lo,hi]. Os existentes que sobrepõem são
      // aparados; um menor escrito sobre um maior DIVIDE o maior (antes+depois); um maior sobre menores ABSORVE.
      var kept = [];
      t.segments.forEach(function (s) {
        if (!(isFinite(s.tStart) && isFinite(s.tEnd)) || s.tEnd <= lo || s.tStart >= hi) { kept.push(s); return; }
        if (s.tStart < lo) { var before = _clone(s); before.tEnd = lo; before.locked = true; kept.push(before); }   // pedaço antes
        if (s.tEnd > hi) { var after = _clone(s); after.tStart = hi; after.locked = true; kept.push(after); }        // pedaço depois
        // o miolo sobreposto é descartado (substituído pelo novo)
      });
      kept.push({ tStart: lo, tEnd: hi, value: this.isScored(t) ? (t.activeCat || "") : "", note: "" });
      t.segments = kept.sort(function (x, y) { return x.tStart - y.tStart; });
      this.selection = []; this._selSet = null;   // refs mudaram (aparados/recriados): limpa a seleção
      this.renderList(); this.renderTimeline(); this.updateActions(); this.commit();
      this.setStatus("Segmento em «" + t.name + "» (" + P.fmtTime(lo, true) + "→" + P.fmtTime(hi, true) + ")", "ok");
    },

    // --- Edição: split / merge / reset ------------------------------------------
    // Núcleo da divisão: parte o segmento idx da camada t no tempo ct (dois trechos travados).
    _doSplit: function (t, idx, ct) {
      var s = t.segments[idx];
      if (!s || ct <= s.tStart + 0.01 || ct >= s.tEnd - 0.01) return false;
      // Duplica TODOS os dados do segmento original nas duas metades (valor, nota, códigos, campos extras).
      var a = _clone(s), b = _clone(s);
      a.tEnd = ct; a.locked = true;
      b.tStart = ct; b.locked = true;
      t.segments.splice(idx, 1, a, b);
      this.activeTierId = t.id;
      this.activeSeg = { tierId: t.id, index: idx };
      this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.updateActions(); this.commit();
      this.setStatus("Segmento dividido em " + P.fmtTime(ct, true) + ".", "ok");
      return true;
    },
    // Divide o segmento sob o cursor (playhead) em dois. Trava trechos do Whisper.
    splitAtCursor: function () {
      var t = this.activeTier(); if (!t) return;
      if (!this.media) { this.setStatus("Carregue uma mídia primeiro.", "err"); return; }
      var ct = this.annNow(), idx = -1;   // tempo de anotação (respeita o offset da mídia)
      for (var i = 0; i < t.segments.length; i++) { if (ct > t.segments[i].tStart + 0.01 && ct < t.segments[i].tEnd - 0.01) { idx = i; break; } }
      if (idx < 0) { this.setStatus("Posicione o cursor DENTRO de um segmento da camada ativa para dividir.", "err"); return; }
      this._doSplit(t, idx, ct);
    },
    // Ferramenta blade: ativa/desativa o modo lâmina (clicar num segmento o divide no ponto do cursor).
    toggleBlade: function () { this.setBlade(!this.bladeMode); },
    setBlade: function (on) {
      this.bladeMode = !!on;
      if (P.Timeline && P.Timeline.setBlade) P.Timeline.setBlade(this.bladeMode);
      if (this.refs && this.refs.blade) this.refs.blade.classList.toggle("active", this.bladeMode);
      if (this.bladeMode) this.setStatus("Ferramenta blade ativa - clique num segmento para dividir no ponto do cursor (B ou Esc para sair).", "work");
      else this.setStatus("Ferramenta blade desativada.", "");
    },
    // Divide o segmento s (da camada L) no tempo clicado. Chamado pela timeline no modo blade.
    bladeSplit: function (L, s, time) {
      var idx = L.segments.indexOf(s); if (idx < 0) return;
      if (time <= s.tStart + 0.01 || time >= s.tEnd - 0.01) { this.setStatus("Clique mais para dentro do segmento para dividir.", "err"); return; }
      this._doSplit(L, idx, time);
    },

    // Une o segmento ativo com o anterior (-1) ou próximo (+1).
    mergeActive: function (dir) {
      var t = this.activeTier();
      if (!t || !this.activeSeg || this.activeSeg.tierId !== t.id) { this.setStatus("Selecione um segmento (clique nele) primeiro.", "err"); return; }
      var i = this.activeSeg.index, j = i + dir;
      if (j < 0 || j >= t.segments.length) { this.setStatus("Não há segmento nessa direção.", "err"); return; }
      var lo = Math.min(i, j), A = t.segments[lo], B = t.segments[lo + 1];
      var merged = {
        tStart: A.tStart, tEnd: B.tEnd,
        value: A.value === B.value ? A.value : [A.value, B.value].filter(Boolean).join(" "),
        note: [A.note, B.note].filter(Boolean).join(" "), locked: true
      };
      t.segments.splice(lo, 2, merged);
      this.activeSeg = { tierId: t.id, index: lo };
      this.renderList(); this.renderTimeline(); this.updateActions(); this.commit();
      this.setStatus("Segmentos unidos.", "ok");
    },

    // Descarta edições manuais da camada do Whisper e reconstrói do zero pelo slider.
    resetWhisper: function () {
      var t = this.activeTier();
      if (!t || t.kind !== "free") t = this.tiers.filter(function (x) { return x.kind === "free"; })[0];
      if (!t) { this.setStatus("Nenhuma camada de texto livre.", "err"); return; }
      if (!confirm("Isto descarta os cortes/edições manuais desta camada e volta à segmentação automática do Whisper. Continuar?")) return;
      t.segments = [];
      this.regroupFromRaw(t);
      this.commit();
      this.setStatus("Camada «" + t.name + "» resetada para a segmentação automática do Whisper.", "ok");
    },

    // --- Tiers UI ---------------------------------------------------------------
    addTier: function (hostId, wrapId) {
      var t = { id: nid(), name: "Camada " + (this.tiers.length + 1), kind: "practice", vocab: this.tiers[0] && this.tiers[0].vocab && this.tiers[0].vocab.length ? this.tiers[0].vocab.map(function (v) { return Object.assign({}, v); }) : [{ code: "A", label: "" }], activeCat: null, segments: [] };   // cópia própria dos códigos (editar uma camada não muda a outra)
      t.activeCat = t.vocab[0] ? t.vocab[0].code : null;
      this.tiers.push(t); this.activeTierId = t.id;
      this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.commit();
      this.editTier(t.id, hostId, wrapId);
    },
    // Cria uma camada do tipo dimensão (escore ordinal em degraus no tempo).
    // Escala padrão 1..5, cor da paleta; abre o editor para o usuário nomear e descrever.
    addDimension: function (hostId, wrapId) {
      var N = 5, cor = P.PALETTE_COLOR[this.tiers.length % P.PALETTE_COLOR.length];
      var vocab = []; for (var i = 1; i <= N; i++) vocab.push({ code: String(i), label: "" });
      var t = { id: nid(), name: "Dimensão " + (this.tiers.length + 1), kind: "dimensao", escalaMax: N, cor: cor, vocab: vocab, activeCat: "1", segments: [] };
      this.tiers.push(t); this.activeTierId = t.id;
      this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.commit();
      this.editTier(t.id, hostId, wrapId);
    },
    removeTier: function (id) {
      if (this.tiers.length <= 1) { this.setStatus("É preciso ao menos 1 camada.", "err"); return; }
      this.tiers = this.tiers.filter(function (t) { return t.id !== id; });
      if (this.activeTierId === id) this.activeTierId = this.tiers[0].id;
      // remove referências da dimensão apagada nos intervalos das categorias
      (this.categories || []).forEach(function (c) { if (c.intervalos) delete c.intervalos[id]; });
      this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.commit();
      if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
    },
    editTier: function (id, hostId, wrapId) {
      hostId = hostId || "tier-editor"; wrapId = wrapId || "tier-editor-wrap";
      // Só um editor aberto por vez (Segmentar ①, Transcrever, Multidimensional ④) - evita ids te-* duplicados no DOM.
      ["tier-editor", "tr-tier-editor", "mdim-tier-editor"].forEach(function (h) { if (h !== hostId) { var e = document.getElementById(h); if (e) e.innerHTML = ""; } });
      ["tier-editor-wrap", "tr-tier-editor-wrap", "mdim-tier-editor-wrap"].forEach(function (w) { if (w !== wrapId) { var e = document.getElementById(w); if (e) e.style.display = "none"; } });
      var self = this, t = this.tiers.filter(function (x) { return x.id === id; })[0];
      var host = document.getElementById(hostId);
      var wrap = document.getElementById(wrapId);
      if (!host || !t) return;
      if (wrap) { wrap.style.display = "block"; wrap.open = true; }
      var escala = self.escalaMaxOf(t);
      host.innerHTML =
        '<div class="field"><label>Nome da camada</label><input type="text" id="te-name" value="' + P.escapeHtml(t.name) + '"></div>' +
        '<div class="field"><label>Tipo</label><select id="te-kind"><option value="practice"' + (t.kind === "practice" ? " selected" : "") + '>Comportamento de prática</option><option value="dimensao"' + (t.kind === "dimensao" ? " selected" : "") + '>Dimensão (escore em degraus)</option><option value="free"' + (t.kind === "free" ? " selected" : "") + '>Texto livre (verbalização)</option><option value="controlled"' + (t.kind === "controlled" ? " selected" : "") + '>Vocabulário no tempo</option></select></div>' +
        '<div class="row" id="te-dim-wrap" style="display:none;align-items:flex-end;gap:8px">' +
          '<div class="field" style="flex:1"><label>Escala (nº de pontos)</label><input type="number" id="te-escala" min="2" max="30" step="1" value="' + escala + '"></div>' +
          '<div class="field" style="flex:0 0 auto"><label>Cor</label><input type="color" id="te-cor" value="' + P.escapeHtml(t.cor || P.PALETTE_COLOR[self.tiers.indexOf(t) % P.PALETTE_COLOR.length]) + '" style="width:44px;height:34px;padding:2px"></div>' +
        '</div>' +
        '<div class="field" id="te-vocab-wrap"><label>Códigos de comportamento</label><div id="te-vocab-rows"></div><button class="btn sm ghost" id="te-vocab-add" style="margin-top:2px">' + P.ICON.plus + ' Adicionar código</button></div>' +
        '<div class="field" id="te-esc-wrap" style="display:none"><label>Descrição de cada escore</label><div id="te-esc-rows"></div></div>' +
        '<div class="field" id="te-idx-wrap" style="display:none">' +
          '<label>Índices do modelo</label>' +
          '<div id="te-idx-rows"></div>' +
          '<button class="btn sm ghost" id="te-idx-add" style="margin-top:2px">' + P.ICON.plus + ' Adicionar índice</button>' +
          '<label class="row" style="margin-top:10px;gap:6px;align-items:center"><input type="checkbox" id="te-idx-show"' + (t.showIndices !== false ? " checked" : "") + ' style="flex:0 0 auto"> <span>Mostrar os índices (na timeline e no multidimensional)</span></label>' +
          '<span class="hint">Clique em «tecla» e pressione a tecla do atalho. Ela dispara a ocorrência só quando esta camada está ativa; 1–9 são reservados para o escore.</span>' +
        '</div>' +
        (self.videoFile
          ? '<div class="field"><label>Âncora das notas (ao realinhar, as notas seguem este arquivo)</label>' +
            '<select id="te-anchor"><option value="primary"' + ((t.anchor || "primary") === "primary" ? " selected" : "") + '>Áudio (mídia primária)</option>' +
            '<option value="companion"' + (t.anchor === "companion" ? " selected" : "") + '>Vídeo (acompanhante)</option></select>' +
            '<span class="hint">Deixe no áudio se você codificou ouvindo; escolha o vídeo se codificou pela imagem.</span></div>'
          : '') +
        '<div class="row"><button class="btn" id="te-save">Salvar camada</button><button class="btn ghost" id="te-cancel">Fechar</button></div>';

      var kindSel = document.getElementById("te-kind"), escalaInp = document.getElementById("te-escala");
      var vocabRows = document.getElementById("te-vocab-rows"), escRows = document.getElementById("te-esc-rows"), idxRows = document.getElementById("te-idx-rows");
      function mkRemove() { var b = document.createElement("button"); b.type = "button"; b.className = "btn sm ghost"; b.style.cssText = "flex:0 0 auto"; b.title = "Remover"; b.innerHTML = P.ICON.close; return b; }

      // Códigos de comportamento (practice/controlled): uma linha por código.
      function addVocabRow(code, label) {
        var row = document.createElement("div"); row.className = "te-row"; row.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px";
        row.innerHTML = '<input class="te-v-code" placeholder="código" value="' + P.escapeHtml(code || "") + '" style="flex:0 0 72px">' +
          '<input class="te-v-label" placeholder="rótulo (ex.: Execução)" value="' + P.escapeHtml(label || "") + '" style="flex:1">';
        var rm = mkRemove(); rm.addEventListener("click", function () { row.remove(); }); row.appendChild(rm);
        vocabRows.appendChild(row);
      }
      // Descrição por escore (dimensão): N linhas fixas (1..N), preservando texto e teclas já definidas.
      // Escores 1–9 usam as teclas fixas 1–9; escores 10+ ganham uma tecla personalizada (captura), pois os dígitos acabam.
      function renderEscRows(N) {
        var cur = {}, curKey = {};
        Array.prototype.forEach.call(escRows.querySelectorAll(".te-e-desc"), function (inp) { cur[inp.dataset.score] = inp.value; });
        Array.prototype.forEach.call(escRows.querySelectorAll(".te-e-key"), function (b) { curKey[b.dataset.score] = b.dataset.key || ""; });
        (t.vocab || []).forEach(function (v) { if (cur[v.code] == null) cur[v.code] = v.label || ""; if (curKey[v.code] == null && v.key) curKey[v.code] = v.key; });   // 1ª montagem: puxa dos rótulos/teclas existentes
        escRows.innerHTML = "";
        for (var i = 1; i <= N; i++) {
          var row = document.createElement("div"); row.className = "te-row"; row.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px";
          row.innerHTML = '<span class="mini" style="flex:0 0 56px;color:var(--txt-dim)">Escore ' + i + '</span>' +
            '<input class="te-e-desc" data-score="' + i + '" placeholder="descrição do escore ' + i + '" value="' + P.escapeHtml(cur[i] || "") + '" style="flex:1 1 auto;min-width:0">';
          escRows.appendChild(row);
          if (i <= 9) {
            var hint = document.createElement("span"); hint.className = "pill"; hint.style.cssText = "flex:0 0 auto;opacity:.7"; hint.title = "Tecla de atalho fixa deste escore"; hint.textContent = "tecla " + i;
            row.appendChild(hint);
          } else {
            var kb = document.createElement("button"); kb.type = "button"; kb.className = "btn sm te-e-key"; kb.dataset.score = i; kb.style.cssText = "flex:0 0 auto;font-family:ui-monospace,monospace"; kb.title = "Clique e pressione a tecla de atalho deste escore";
            setKey(kb, (curKey[i] || "").toLowerCase()); kb.addEventListener("click", function () { armKey(this); });
            row.appendChild(kb);
          }
        }
      }
      // Índices (dimensão): código, descrição e um botão «tecla» que captura o atalho ao ser pressionado.
      function setKey(btn, k) { btn.dataset.key = k || ""; btn.textContent = k ? k.toUpperCase() : "definir tecla"; btn.style.opacity = k ? "1" : ".7"; }
      function armKey(btn) {
        var prev = btn.dataset.key || ""; btn.textContent = "pressione…"; btn.style.opacity = "1";
        function onK(e) {
          e.preventDefault(); e.stopPropagation(); document.removeEventListener("keydown", onK, true);
          if (e.key === "Escape") { setKey(btn, prev); return; }
          if (e.key === "Backspace" || e.key === "Delete") { setKey(btn, ""); return; }
          var k = (e.key && e.key.length === 1) ? e.key.toLowerCase() : "";
          if (!k) { setKey(btn, prev); self.setStatus("Use uma tecla única (letra, número ou símbolo).", "err"); return; }
          if (k >= "1" && k <= "9") { setKey(btn, prev); self.setStatus("As teclas 1–9 são reservadas para os escores 1–9.", "err"); return; }
          var dup = false; Array.prototype.forEach.call(host.querySelectorAll(".te-i-key, .te-e-key"), function (b) { if (b !== btn && (b.dataset.key || "") === k) dup = true; });
          if (dup) { setKey(btn, prev); self.setStatus("A tecla «" + k.toUpperCase() + "» já está em uso nesta dimensão.", "err"); return; }
          setKey(btn, k);
        }
        document.addEventListener("keydown", onK, true);
      }
      function addIdxRow(code, desc, key) {
        // Duas linhas: código + descrição em cima (descrição ocupa a largura), tecla + remover embaixo.
        var row = document.createElement("div"); row.className = "te-row"; row.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid var(--line)";
        var top = document.createElement("div"); top.style.cssText = "display:flex;gap:6px;align-items:center";
        top.innerHTML = '<input class="te-i-code" placeholder="código" value="' + P.escapeHtml(code || "") + '" style="flex:0 0 84px">' +
          '<input class="te-i-desc" placeholder="descrição" value="' + P.escapeHtml(desc || "") + '" style="flex:1 1 auto;min-width:0">';
        row.appendChild(top);
        var bot = document.createElement("div"); bot.style.cssText = "display:flex;gap:6px;align-items:center";
        var kb = document.createElement("button"); kb.type = "button"; kb.className = "btn sm te-i-key"; kb.style.cssText = "flex:0 0 auto;font-family:ui-monospace,monospace"; kb.title = "Clique e pressione a tecla do atalho";
        setKey(kb, (key || "").toLowerCase()); kb.addEventListener("click", function () { armKey(kb); }); bot.appendChild(kb);
        var rm = mkRemove(); rm.innerHTML = P.ICON.close + ' <span class="mini">remover</span>'; rm.addEventListener("click", function () { row.remove(); }); bot.appendChild(rm);
        row.appendChild(bot);
        idxRows.appendChild(row);
      }

      (t.vocab && t.vocab.length ? t.vocab : [{ code: "", label: "" }]).forEach(function (v) { addVocabRow(v.code, v.label); });
      renderEscRows(escala);
      (t.indices || []).forEach(function (ix) { addIdxRow(ix.code, ix.desc, ix.key); });
      document.getElementById("te-vocab-add").addEventListener("click", function () { addVocabRow("", ""); });
      document.getElementById("te-idx-add").addEventListener("click", function () { addIdxRow("", "", ""); });

      function toggleSections() {
        var k = kindSel.value, scored = (k === "controlled" || k === "practice");
        document.getElementById("te-vocab-wrap").style.display = scored ? "block" : "none";
        document.getElementById("te-dim-wrap").style.display = (k === "dimensao") ? "flex" : "none";
        document.getElementById("te-esc-wrap").style.display = (k === "dimensao") ? "block" : "none";
        document.getElementById("te-idx-wrap").style.display = (k === "dimensao") ? "block" : "none";
      }
      kindSel.addEventListener("change", function () { toggleSections(); if (kindSel.value === "dimensao") renderEscRows(Math.max(2, Math.min(30, parseInt(escalaInp.value, 10) || escala))); });
      escalaInp.addEventListener("change", function () { renderEscRows(Math.max(2, Math.min(30, parseInt(escalaInp.value, 10) || escala))); });
      toggleSections();
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);

      document.getElementById("te-cancel").addEventListener("click", function () { if (wrap) wrap.style.display = "none"; });
      document.getElementById("te-save").addEventListener("click", function () {
        t.name = document.getElementById("te-name").value.trim() || t.name;
        t.kind = kindSel.value;
        if (t.kind === "controlled" || t.kind === "practice") {
          var vocab = [];
          Array.prototype.forEach.call(vocabRows.querySelectorAll(".te-row"), function (row) {
            var code = (row.querySelector(".te-v-code").value || "").trim(), label = (row.querySelector(".te-v-label").value || "").trim();
            if (code && !vocab.some(function (v) { return v.code === code; })) vocab.push({ code: code, label: label });
          });
          if (!vocab.length) vocab = [{ code: "A", label: "" }];
          t.vocab = vocab;
          if (!t.vocab.some(function (v) { return v.code === t.activeCat; })) t.activeCat = t.vocab[0].code;
          delete t.escalaMax; delete t.cor; delete t.indices; delete t.marks; delete t.showIndices;
        } else if (t.kind === "dimensao") {
          var N = Math.max(2, Math.min(30, parseInt(escalaInp.value, 10) || escala));
          t.escalaMax = N; t.cor = document.getElementById("te-cor").value;
          var esc = {}, escKey = {}, usedKeys = {};
          Array.prototype.forEach.call(escRows.querySelectorAll(".te-e-desc"), function (inp) { esc[inp.dataset.score] = (inp.value || "").trim(); });
          Array.prototype.forEach.call(escRows.querySelectorAll(".te-e-key"), function (b) { escKey[b.dataset.score] = (b.dataset.key || "").toLowerCase(); });
          var dvocab = [];
          for (var i = 1; i <= N; i++) {
            var entry = { code: String(i), label: esc[i] || "" };
            if (i > 9) { var ek = escKey[i] || ""; if (ek && !usedKeys[ek] && !(ek >= "1" && ek <= "9")) { entry.key = ek; usedKeys[ek] = 1; } }   // escores 10+ têm tecla personalizada
            dvocab.push(entry);
          }
          t.vocab = dvocab;
          if (!t.vocab.some(function (v) { return v.code === t.activeCat; })) t.activeCat = t.vocab[0].code;
          var indices = [];
          Array.prototype.forEach.call(idxRows.querySelectorAll(".te-row"), function (row) {
            var code = (row.querySelector(".te-i-code").value || "").trim(), desc = (row.querySelector(".te-i-desc").value || "").trim();
            var key = (row.querySelector(".te-i-key").dataset.key || "").toLowerCase();
            if (!code) return;
            if (key && (usedKeys[key] || (key >= "1" && key <= "9"))) key = "";   // não colide com escores nem com 1–9
            if (key) usedKeys[key] = 1;
            indices.push({ code: code, desc: desc, key: key });
          });
          t.indices = indices;
          var showChk = document.getElementById("te-idx-show"); t.showIndices = showChk ? showChk.checked : true;
        } else { delete t.escalaMax; delete t.cor; delete t.indices; delete t.marks; delete t.showIndices; }
        var anchorSel = document.getElementById("te-anchor");
        if (anchorSel) t.anchor = anchorSel.value;
        if (wrap) wrap.style.display = "none";
        self.renderTiers(); self.renderPicker(); self.renderList(); self.renderTimeline(); self.updateActions();
        self.commit();   // renomear/trocar tipo/vocabulário da camada é um passo do desfazer
        if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
      });
    },
    renderTiers: function () {
      var self = this, host = this.refs.tiers; host.innerHTML = "";
      this.tiers.forEach(function (t, i) {
        var active = t.id === self.activeTierId;
        var kindLabel = (t.kind === "controlled" ? "vocab" : t.kind === "practice" ? "prática" : t.kind === "dimensao" ? "dimensão" : "livre");
        // Duas linhas: nome sozinho em cima (largura toda), controles embaixo - senão a barra estreita corta o nome.
        var row = document.createElement("div");
        row.style.cssText = "margin-bottom:6px;padding:6px 8px;border-radius:8px;border:1px solid " + (active ? "var(--accent)" : "var(--line)") + ";background:var(--panel-2)";
        row.innerHTML =
          '<div class="row" style="align-items:center;gap:6px">' +
            '<span class="mini" style="flex:0 0 16px;color:var(--txt-dim)">' + (i + 1) + '</span>' +
            '<b class="tier-name" style="flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Ativar «' + P.escapeHtml(t.name) + '»">' + P.escapeHtml(t.name) + '</b>' +
          '</div>' +
          '<div class="row" style="align-items:center;gap:6px;margin-top:5px">' +
            '<span class="pill" style="flex:0 0 auto' + (t.kind === "dimensao" && t.cor ? ";border-color:" + t.cor + "55" : "") + '">' + kindLabel + '</span>' +
            '<span style="flex:1"></span>' +
            '<button class="btn sm ghost" data-vis title="' + (t.visible === false ? "Camada oculta na timeline (clique para mostrar)" : "Ocultar na timeline") + '" style="flex:0 0 auto;opacity:' + (t.visible === false ? ".5" : "1") + '">' + (t.visible === false ? P.ICON.eyeOff : P.ICON.eye) + '</button>' +
            '<button class="btn sm ghost" data-edit title="Editar camada" style="flex:0 0 auto">' + P.ICON.edit + '</button>' +
            '<button class="btn sm ghost" data-del title="Remover camada" style="flex:0 0 auto">' + P.ICON.close + '</button>' +
          '</div>';
        row.querySelector(".tier-name").addEventListener("click", function () { self.activeTierId = t.id; self.renderTiers(); self.renderPicker(); self.renderList(); });
        row.querySelector("[data-vis]").addEventListener("click", function () { t.visible = (t.visible === false); self.renderTiers(); self.renderTimeline(); self.commit(); });
        row.querySelector("[data-edit]").addEventListener("click", function () { self.editTier(t.id); });
        row.querySelector("[data-del]").addEventListener("click", function () { self.removeTier(t.id); });
        host.appendChild(row);
      });
      // mantém o painel de Camadas replicado na aba Transcrever em sincronia (mesma fonte)
      if (P.Transcript && P.Transcript.onTiersChanged) P.Transcript.onTiersChanged();
    },
    renderPicker: function () {
      var self = this, host = this.refs.picker, t = this.activeTier();
      host.innerHTML = "";
      if (!t) return;
      if (!this.isScored(t)) { host.innerHTML = '<span class="hint">Camada de texto livre. O conteúdo é digitado ou preenchido pelo Whisper.</span>'; return; }
      if (t.kind === "dimensao") { var _nn = this.escalaMaxOf(t); host.innerHTML = '<div class="hint" style="margin-bottom:6px">Codificação por switch de «' + P.escapeHtml(t.name) + '» (escala 1–' + _nn + '). Reproduza a mídia e clique num escore, ou tecle 1–' + Math.min(9, _nn) + (_nn > 9 ? ' (escores 10+ usam a tecla definida na configuração)' : '') + ', para inserir uma troca no tempo da agulha. Edite as trocas na aba Multidimensional.</div>'; }
      var chips = document.createElement("div"); chips.className = "legend";
      t.vocab.forEach(function (v, i) {
        var color = t.kind === "dimensao" ? self.dimColor(t, v.code) : (v.color || P.GCP.colorFor.call(P.GCP, v.code, i));
        var chip = document.createElement("span");
        chip.className = "pill"; chip.style.cursor = "pointer";
        chip.style.borderColor = v.code === t.activeCat ? "var(--accent)" : "var(--line)";
        chip.innerHTML = '<span class="swatch" style="background:' + color + '"></span><b>' + P.escapeHtml(v.code) + '</b>' +
          (v.label ? ' <span class="mini">' + P.escapeHtml(v.label) + '</span>' : '') +
          (i < 9 ? ' <span class="mini" style="opacity:.5">' + (i + 1) + '</span>' : (v.key ? ' <span class="mini" style="opacity:.5">' + P.escapeHtml(String(v.key).toUpperCase()) + '</span>' : '')) +
          ' <span data-edit="' + i + '" title="Editar" style="opacity:.55;padding:0 2px">' + P.ICON.edit + '</span>' +
          '<span data-rm="' + i + '" title="Remover" style="opacity:.55;padding:0 2px">' + P.ICON.close + '</span>';
        chip.addEventListener("click", function (e) {
          var editEl = e.target.closest("[data-edit]"), rmEl = e.target.closest("[data-rm]");
          if (editEl) { self._editIdx = +editEl.dataset.edit; self.renderPicker(); return; }
          if (rmEl) { self.removeCode(+rmEl.dataset.rm); return; }
          if (t.kind === "dimensao") { self.dimSwitchAt(t, self.now(), v.code); return; }
          t.activeCat = v.code; self.renderPicker();
        });
        chips.appendChild(chip);
      });
      host.appendChild(chips);
      // Índices do modelo (só em dimensões): legenda tecla → índice; clicar marca a ocorrência no tempo da agulha.
      if (t.kind === "dimensao" && t.indices && t.indices.length) {
        var ihead = document.createElement("div"); ihead.className = "hint"; ihead.style.cssText = "margin:8px 0 4px";
        ihead.textContent = "Índices (tecla lança a ocorrência no tempo da agulha):";
        host.appendChild(ihead);
        var ichips = document.createElement("div"); ichips.className = "legend";
        t.indices.forEach(function (ix) {
          var chip = document.createElement("span"); chip.className = "pill"; chip.style.cursor = "pointer";
          chip.title = "Marcar ocorrência de " + ix.code + (ix.desc ? " - " + ix.desc : "");
          chip.innerHTML = (ix.key ? '<b style="font-family:ui-monospace,monospace;text-transform:uppercase">' + P.escapeHtml(ix.key) + '</b> ' : '') +
            '<span class="mini">' + P.escapeHtml(ix.code) + '</span>' + (ix.desc ? ' <span class="mini" style="opacity:.6">' + P.escapeHtml(ix.desc) + '</span>' : '');
          chip.addEventListener("click", function () { self.addIndexMark(t, ix.code); });
          ichips.appendChild(chip);
        });
        host.appendChild(ichips);
      }
      var editing = this._editIdx != null && this._editIdx >= 0 && t.vocab[this._editIdx];
      var cur = editing ? t.vocab[this._editIdx] : { code: "", label: "" };
      var ed = document.createElement("div"); ed.className = "row"; ed.style.marginTop = "8px";
      ed.innerHTML =
        '<input id="pc-code" placeholder="código" value="' + P.escapeHtml(cur.code) + '" style="flex:0 0 56px">' +
        '<input id="pc-label" placeholder="rótulo (ex.: Execução)" value="' + P.escapeHtml(cur.label || "") + '" style="flex:1">' +
        '<button class="btn sm" id="pc-save" title="' + (editing ? "Salvar código" : "Incluir código") + '" style="flex:0 0 auto">' + (editing ? "Salvar" : P.ICON.plus) + '</button>' +
        (editing ? '<button class="btn sm ghost" id="pc-cancel" title="Cancelar" style="flex:0 0 auto">' + P.ICON.close + '</button>' : '');
      host.appendChild(ed);
      host.querySelector("#pc-save").addEventListener("click", function () { self.saveCode(); });
      ["pc-code", "pc-label"].forEach(function (id) { host.querySelector("#" + id).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); self.saveCode(); } }); });
      var cx = host.querySelector("#pc-cancel"); if (cx) cx.addEventListener("click", function () { self._editIdx = -1; self.renderPicker(); });
    },

    saveCode: function () {
      var t = this.activeTier(); if (!t) return;
      var code = (document.getElementById("pc-code").value || "").trim();
      var label = (document.getElementById("pc-label").value || "").trim();
      if (!code) { this.setStatus("Informe um código de comportamento.", "err"); return; }
      if (this._editIdx != null && this._editIdx >= 0 && t.vocab[this._editIdx]) {
        var old = t.vocab[this._editIdx].code;
        if (code !== old && t.vocab.some(function (v) { return v.code === code; })) { this.setStatus("Código já existe.", "err"); return; }
        var vobj = t.vocab[this._editIdx];
        vobj.code = code; vobj.label = label;   // muta no lugar (preserva a cor customizada)
        // recodifica só as camadas que usam ESTE código (a própria e as que compartilham o objeto); antes valia p/ todas,
        // e uma camada de texto livre ou outra prática com o mesmo código "EX" era recodificada sem aviso
        if (old !== code) this.tiers.forEach(function (tt) { if (tt === t || (tt.vocab || []).indexOf(vobj) >= 0) tt.segments.forEach(function (s) { if (s.value === old) s.value = code; }); });
        if (t.activeCat === old) t.activeCat = code;
        this._editIdx = -1;
        this.setStatus("Código atualizado.", "ok");
      } else {
        if (t.vocab.some(function (v) { return v.code === code; })) { this.setStatus("Código já existe.", "err"); return; }
        t.vocab.push({ code: code, label: label }); t.activeCat = code;
        this.setStatus("Código «" + code + "» adicionado.", "ok");
      }
      this.renderPicker(); this.renderList(); this.renderTimeline(); this.commit();
    },

    removeCode: function (i) {
      var t = this.activeTier(); if (!t || !t.vocab[i]) return;
      if (t.vocab.length <= 1) { this.setStatus("Mantenha ao menos 1 código.", "err"); return; }
      var removed = t.vocab[i].code;
      t.vocab.splice(i, 1);
      if (t.activeCat === removed) t.activeCat = t.vocab[0].code;
      this._editIdx = -1;
      this.renderPicker(); this.renderList(); this.renderTimeline(); this.commit();
      this.setStatus("Código «" + removed + "» removido.", "");
    },
    // P1: cobertura do tempo por segmentos e número de lacunas na camada ativa.
    _setCoverage: function (t) {
      var cov = document.getElementById("seg-coverage"); if (!cov) return;
      if (!t || !t.segments.length) { cov.textContent = ""; return; }
      var mediaDur = (this.media && isFinite(this.media.duration) && this.media.duration > 0) ? this.media.duration : this.maxTime();
      var iv = t.segments.map(function (s) { return [s.tStart, s.tEnd]; }).filter(function (a) { return isFinite(a[0]) && isFinite(a[1]) && a[1] > a[0]; }).sort(function (a, b) { return a[0] - b[0]; });
      var merged = [], covered = 0;
      iv.forEach(function (a) { var L = merged[merged.length - 1]; if (L && a[0] <= L[1]) L[1] = Math.max(L[1], a[1]); else merged.push(a.slice()); });
      merged.forEach(function (m) { covered += m[1] - m[0]; });
      var gaps = 0, EPS = 0.2, prev = 0;
      merged.forEach(function (m) { if (m[0] - prev > EPS) gaps++; prev = Math.max(prev, m[1]); });
      if (mediaDur - prev > EPS) gaps++;
      var pct = mediaDur > 0 ? Math.min(100, covered / mediaDur * 100) : 0;
      cov.textContent = "cobertura " + pct.toFixed(0) + "% · " + gaps + (gaps === 1 ? " lacuna · " : " lacunas · ");
    },
    renderList: function () {
      var __t = P._perf ? performance.now() : 0;
      var self = this, t = this.activeTier(), host = this.refs.listHost;
      this.refs.listTitle.textContent = "Segmentos · " + (t ? t.name : "");
      this._setCoverage(t);
      if (this.refs.resetWhisper) this.refs.resetWhisper.style.display = (t && t.kind === "free" && (this._wsRaw || []).length) ? "inline-block" : "none";
      if (!t) { host.innerHTML = ""; this.refs.segCount.textContent = "0"; return; }
      this.refs.segCount.textContent = t.segments.length;
      if (!t.segments.length) { host.innerHTML = '<div class="empty" style="padding:20px">Nenhum segmento nesta camada. Reproduza a gravação e pressione <kbd>Enter</kbd> no início e no fim de cada trecho. A codificação em compassos é feita na tela Transcrever.</div>'; return; }
      var activeIdx = (this.activeSeg && this.activeSeg.tierId === t.id) ? this.activeSeg.index : -1, rows = "";
      t.segments.forEach(function (s, i) {
        var valCell;
        if (self.isScored(t)) {
          var opts = t.vocab.map(function (v) { return '<option value="' + P.escapeHtml(v.code) + '"' + (v.code === s.value ? " selected" : "") + '>' + P.escapeHtml(v.code) + (v.label ? " · " + P.escapeHtml(v.label) : "") + '</option>'; }).join("");
          var color = t.kind === "dimensao" ? self.dimColor(t, s.value) : self.codeColor(t, s.value);
          valCell = '<select data-val="' + i + '" style="background:' + color + '18;border-color:' + color + '55">' + opts + '</select>';
        } else {
          valCell = '<input type="text" data-txt="' + i + '" value="' + P.escapeHtml(s.value) + '" placeholder="texto…">';
        }
        var dur = Math.max(0, (s.tEnd || 0) - (s.tStart || 0));
        rows += '<tr tabindex="0"' + (i === activeIdx ? ' class="sel" style="background:rgba(79,157,245,.12)"' : (self._isSelected(s) ? ' class="selms"' : '')) + '>' +
          '<td class="mini" data-sel="' + i + '" style="cursor:pointer">' + (i + 1) + (s.locked ? ' <span title="Editado manualmente">' + P.ICON.lock + '</span>' : "") + '</td>' +
          '<td><a href="#" data-seek="' + i + '">' + P.fmtTime(s.tStart, true) + '</a><span class="mini"> → ' + P.fmtTime(s.tEnd, true) + '</span></td>' +
          '<td class="mini" title="Duração">' + P.fmtTime(dur, true) + '</td>' +
          '<td>' + valCell + '</td>' +
          '<td><button class="btn sm ghost" data-del="' + i + '" title="Remover">' + P.ICON.close + '</button></td></tr>';
      });
      host.innerHTML = '<table class="segs"><thead><tr><th style="width:26px">#</th><th style="width:118px">Tempo</th><th style="width:64px">Duração</th><th>Código</th><th style="width:36px"></th></tr></thead><tbody>' + rows + '</tbody></table>';
      host.querySelectorAll("[data-sel]").forEach(function (c) { c.addEventListener("click", function (e) { var i = +c.dataset.sel; self._onSegClick({ id: t.id, name: t.name, segments: t.segments }, i, t.segments[i], { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }); }); });
      host.querySelectorAll("[data-seek]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); var i = +a.dataset.seek; self.activeSeg = { tierId: t.id, index: i }; if (self.media) self.seekTo(t.segments[i].tStart); self.renderList(); }); });
      host.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { t.segments.splice(+b.dataset.del, 1); self.activeSeg = null; self.renderList(); self.renderTimeline(); self.updateActions(); self.commit(); }); });
      host.querySelectorAll("[data-val]").forEach(function (sel) { sel.addEventListener("change", function () { t.segments[+sel.dataset.val].value = sel.value; self.renderList(); self.renderTimeline(); self.commit(); }); });
      host.querySelectorAll("[data-txt]").forEach(function (inp) { inp.addEventListener("change", function () { var s = t.segments[+inp.dataset.txt]; s.value = inp.value; s.locked = true; self.renderList(); self.renderTimeline(); self.commit(); }); });
      this._nowRow = null; this._nowIdx = -2; this._updateNowHighlight();   // reaplica o realce da agulha na tabela nova
      if (__t) { var d = performance.now() - __t; if (d > 18) console.log("[praxis SLOW] renderList " + d.toFixed(0) + "ms · " + (t ? t.segments.length : 0) + " linhas"); }
    },

    // --- Timeline (delegada ao componente com waveform) -------------------------
    renderTimeline: function () { if (P.Timeline.host) P.Timeline.render(); },
    renderPlayhead: function () {
      if (!this.media) return;
      if (P.Timeline.host) P.Timeline.setPlayheadTime(this.annNow(), !this.media.paused);
      if (P.Score && P.Score.syncToTime) P.Score.syncToTime(this.annNow());
      if (P.SegGCP && P.SegGCP.syncToTime) P.SegGCP.syncToTime(this.annNow());
      this._updateAnnRange();
      this._updateNowHighlight();
    },
    // Realça na lista a anotação sob a agulha (segue a playhead). Respeita o toggle "vincular" (P.Timeline.linkPlayer):
    // desligado = rolagem/realce livres. Só toca o DOM quando o segmento sob a agulha muda (barato por frame).
    _updateNowHighlight: function () {
      var host = this.refs.listHost; if (!host) return;
      if (!P.Timeline || !P.Timeline.linkPlayer) {   // "acompanhar" desligado: limpa e sai
        if (this._nowRow) { this._nowRow.classList.remove("now"); this._nowRow = null; }
        this._nowIdx = -2; return;
      }
      var t = this.activeTier(), T = this.annNow(), idx = -1;
      if (t) for (var i = 0; i < t.segments.length; i++) { var s = t.segments[i]; if (isFinite(s.tStart) && isFinite(s.tEnd) && T >= s.tStart && T <= s.tEnd) { idx = i; break; } }
      if (idx === this._nowIdx) return;   // sem mudança → sem DOM
      this._nowIdx = idx;
      if (this._nowRow) { this._nowRow.classList.remove("now"); this._nowRow = null; }
      if (idx < 0) return;
      var tbody = host.querySelector("table.segs tbody"); if (!tbody) return;
      var row = tbody.children[idx]; if (!row) return;
      row.classList.add("now"); this._nowRow = row;
      // Rola SÓ o painel da lista (#seg-listhost), nunca a página. `scrollIntoView` rolaria TODOS os
      // ancestrais scrolláveis (canvas-area/página) e tiraria o vídeo/partitura/gráfico de vista.
      var hr = host.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (rr.top < hr.top) host.scrollTop -= (hr.top - rr.top);
      else if (rr.bottom > hr.bottom) host.scrollTop += (rr.bottom - hr.bottom);
    },
    // Mostra o início → fim da anotação sob a agulha (na camada ativa), à direita do transporte.
    _updateAnnRange: function () {
      var el = document.getElementById("seg-annrange"); if (!el) return;
      var t = this.activeTier(), T = this.annNow(), seg = null;
      if (t) for (var i = 0; i < t.segments.length; i++) { var s = t.segments[i]; if (isFinite(s.tStart) && isFinite(s.tEnd) && T >= s.tStart && T <= s.tEnd) { seg = s; break; } }
      el.textContent = seg ? ("anotação " + P.fmtTime(seg.tStart, true) + " → " + P.fmtTime(seg.tEnd, true)) : "";
    },
    maxTime: function () { var m = 1; this.tiers.forEach(function (t) { t.segments.forEach(function (s) { if (s.tEnd > m) m = s.tEnd; }); }); return m; },

    // --- Histórico: desfazer / refazer ------------------------------------------
    // Modelo por snapshots (clone das camadas). "commit depois de cada ação":
    // _hist[_hi] é sempre o estado atual; desfazer restaura o anterior, refazer avança.
    _hist: null, _hi: -1, _HIST_MAX: 80,
    // Tipos de prática entram no histórico: removeTier apaga os intervalos deles, e o desfazer precisa trazê-los de volta.
    _snapshot: function () { return JSON.stringify({ tiers: this.tiers, activeTierId: this.activeTierId, categories: this.categories || [] }); },
    resetHistory: function () { this._hist = [this._snapshot()]; this._hi = 0; this._updateUndoButtons(); },
    commit: function () {
      if (!this._hist) { this.resetHistory(); return; }
      var snap = this._snapshot();
      if (snap === this._hist[this._hi]) return;              // nada mudou: não duplica
      this._hist = this._hist.slice(0, this._hi + 1);         // descarta o ramo de "refazer"
      this._hist.push(snap);
      if (this._hist.length > this._HIST_MAX) this._hist.shift(); else this._hi++;
      this._updateUndoButtons();
    },
    _applyIndex: function (i) {
      var snap = this._hist[i]; if (!snap) return;
      var data = JSON.parse(snap);
      this.tiers = data.tiers;
      if (data.categories) this.categories = data.categories;
      this.selection = []; this._selSet = null; this._selAnchor = null;   // a seleção apontava para objetos do estado anterior
      var ok = data.activeTierId && this.tiers.some(function (t) { return t.id === data.activeTierId; });
      this.activeTierId = ok ? data.activeTierId : (this.tiers[0] ? this.tiers[0].id : null);
      if (this.activeSeg) { var at = this.activeTier(); if (!at || !at.segments[this.activeSeg.index]) this.activeSeg = null; }
      this._editIdx = -1;
      this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.updateActions();
      if (this.media) this.renderPlayhead();
      if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
    },
    undo: function () { if (!this._hist || this._hi <= 0) return; this._hi--; this._applyIndex(this._hi); this._updateUndoButtons(); this.setStatus("Desfeito.", ""); },
    redo: function () { if (!this._hist || this._hi >= this._hist.length - 1) return; this._hi++; this._applyIndex(this._hi); this._updateUndoButtons(); this.setStatus("Refeito.", ""); },
    _updateUndoButtons: function () {
      var canU = !(this._hist && this._hi > 0), canR = !(this._hist && this._hi < this._hist.length - 1);
      var ids = ["seg-undo", "tr-undo"], rds = ["seg-redo", "tr-redo"];   // botões nas duas telas (histórico é compartilhado)
      ids.forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = canU; });
      rds.forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = canR; });
    },

    updateActions: function () {
      var anyPrac = this.tiers.some(function (t) { return t.kind === "practice" && t.segments.length; });
      if (this.refs.genGcp) this.refs.genGcp.disabled = !anyPrac;
      this.refreshExportUI();
    },

    // --- Integração com GCP -----------------------------------------------------
    generateGCP: function (cb) {
      var prac = this.tiers.filter(function (t) { return t.kind === "practice" && t.segments.length; });
      if (!prac.length) { this.setStatus("Nenhuma camada de comportamento de prática com segmentos.", "err"); return; }
      var t = prac.filter(function (x) { return x.id === this.activeTierId; }, this)[0] || prac[0];
      var legend = {}; t.vocab.forEach(function (v) { legend[v.code] = v.label; });
      var coded = t.segments.slice().filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); }).sort(function (a, b) { return (a.tStart || 0) - (b.tStart || 0); });
      if (!coded.length) { alert("Codifique o compasso dos segmentos na tela Transcrever antes de gerar o gráfico."); return; }
      // demais camadas (verbalização, objetivos, estratégias…) para estatística cruzada e co-ocorrência
      var others = this.tiers.filter(function (x) { return x.id !== t.id; }).map(function (x) {
        return { name: x.name, kind: x.kind, segments: x.segments.filter(function (s) { return isFinite(s.tStart) && isFinite(s.tEnd); }).map(function (s) { return { tStart: s.tStart, tEnd: s.tEnd, value: s.value }; }) };
      });
      // estágios (objetivos de médio prazo) a partir da camada cujo nome casa "médio prazo": cada objetivo vira uma
      // fase cobrindo os segmentos de comportamento cujo início cai no seu intervalo (mesma lógica do parser de EAF).
      var phases = [];
      var mid = others.filter(function (o) { return /m[eé]dio\s*prazo/i.test(o.name || ""); })[0];
      if (mid && coded.length) {
        mid.segments.forEach(function (o) {
          var from = 0, to = -1;
          coded.forEach(function (s, gi) { if (s.tStart >= o.tStart - 0.001 && s.tStart < o.tEnd) { if (to < 0) from = gi + 1; to = gi + 1; } });
          if (to >= from && to > 0) phases.push({ name: (o.value || "").split(",")[0].trim() || "Estágio", segFrom: from, segTo: to });
        });
      }
      var data = {
        meta: { participant: (this.file ? this.file.name : "Sessão") + " · " + t.name },
        behaviors: t.vocab.map(function (v) { return v.code; }),
        legend: legend, sections: [], phases: phases, layers: others,
        // X = tempo real do áudio (tStart→tEnd); Y = compasso (mStart→mEnd)
        segments: coded.map(function (s) { return { tStart: s.tStart, tEnd: s.tEnd, mStart: s.mStart, mEnd: s.mEnd, behavior: s.value, note: s.note }; })
      };
      (cb || this.onGenGCP)(data);
    },
    // Caminho inverso: converte os ESTÁGIOS do gráfico ativo (divididos no módulo Gráfico) na camada
    // «Objetivos de Médio Prazo» da segmentação (um segmento por estágio, no tempo). Cria ou atualiza a camada.
    stagesToObjectives: function () {
      var G = P.GCP;
      if (!G || !G.data || !(G.data.stages && G.data.stages.length)) { alert("Nenhum estágio definido no gráfico ativo. Divida os estágios no módulo Gráfico primeiro."); return; }
      var segs = (G.data.segments || []).filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); })
        .slice().sort(function (a, b) { if (isFinite(a.tStart) && isFinite(b.tStart)) return a.tStart - b.tStart; return (a.mStart || 0) - (b.mStart || 0); });
      if (!segs.length) { alert("O gráfico ativo não tem segmentos com tempo para converter os estágios."); return; }
      var out = [];
      G.data.stages.forEach(function (st) {
        var a = segs[(st.from || 1) - 1], b = segs[(st.to || segs.length) - 1];
        if (!a || !b) return;
        var t0 = isFinite(a.tStart) ? a.tStart : null, t1 = isFinite(b.tEnd) ? b.tEnd : null;
        if (t0 == null || t1 == null || t1 <= t0) return;
        out.push({ tStart: t0, tEnd: t1, value: st.name || "Estágio", note: "" });
      });
      if (!out.length) { alert("Os estágios não puderam ser convertidos (segmentos sem tempo associado)."); return; }
      out.sort(function (a, b) { return a.tStart - b.tStart; });
      var tier = this.tiers.filter(function (t) { return /m[eé]dio\s*prazo/i.test(t.name || ""); })[0], created = false;
      if (!tier) { tier = { id: nid(), name: "Objetivos de Médio Prazo", kind: "free", vocab: [], activeCat: null, segments: [] }; this.tiers.push(tier); created = true; }
      tier.segments = out;
      this.renderTiers(); this.renderTimeline(); this.renderPicker(); this.updateActions(); this.commit();
      if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
      this.setStatus((created ? "Camada «Objetivos de Médio Prazo» criada" : "Camada «Objetivos de Médio Prazo» atualizada") + " com " + out.length + " estágio(s) do gráfico.", "ok");
    },

    // --- Exportação parametrizada (Segmentar + Transcrever) ---------------------
    // Colunas disponíveis: [chave, rótulo do cabeçalho]. A UI deixa escolher quais entram.
    EXPORT_COLS: [
      ["layer",  "Camada"],
      ["kind",   "Tipo de camada"],
      ["code",   "Código / valor"],
      ["label",  "Rótulo do código"],
      ["tStart", "Início (tempo)"],
      ["tEnd",   "Fim (tempo)"],
      ["dur",    "Duração (tempo)"],
      ["mStart", "Compasso início"],
      ["mEnd",   "Compasso fim"],
      ["note",   "Observação"]
    ],
    _kindLabel: function (k) {
      return k === "controlled" ? "vocabulário" : k === "practice" ? "prática" : k === "dimensao" ? "dimensão" : "livre";
    },
    _defExportCfg: function () {
      return {
        fmt: "mmss", delim: ";", headers: true, includeIndices: true,
        tiers: {},   // id -> false esconde a camada (ausente = incluída)
        cols: { layer: true, kind: true, code: true, label: true, tStart: true, tEnd: true, dur: true, mStart: true, mEnd: true, note: true }
      };
    },
    _exportCfg: function () {
      if (!this._expCfg) {
        var c = this._defExportCfg();
        try { var s = JSON.parse(localStorage.getItem("praxis.exportCfg") || "null"); if (s) { for (var k in s) if (s[k] != null) c[k] = s[k]; } } catch (e) {}
        this._expCfg = c;
      }
      return this._expCfg;
    },
    _saveExportCfg: function () { try { localStorage.setItem("praxis.exportCfg", JSON.stringify(this._expCfg)); } catch (e) {} },

    exportCSV: function (statusEl) {
      var cfg = this._exportCfg(), fmt = cfg.fmt, cols = cfg.cols, self = this;
      function ft(sec) {
        sec = +sec || 0;
        if (fmt === "sec") return sec.toFixed(3);
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = (sec % 60);
        function p(n, d) { n = n.toFixed(d || 0); return (parseFloat(n) < 10 ? "0" : "") + n; }
        return fmt === "hhmmss" ? (p(h) + ":" + p(m) + ":" + p(s, 3)) : (p(m) + ":" + p(s, 3));
      }
      function labelFor(t, code) {
        var v = (t.vocab || []).filter(function (x) { return String(x.code) === String(code); })[0];
        return v ? (v.label || "") : "";
      }
      var order = this.EXPORT_COLS.filter(function (c) { return cols[c[0]]; });
      if (!order.length) { this._exportStatus(statusEl, "Selecione ao menos uma coluna.", "warn"); return; }
      var rows = [];
      if (cfg.headers) rows.push(order.map(function (c) { return c[1]; }));
      var count = 0;
      this.tiers.forEach(function (t) {
        if (cfg.tiers[t.id] === false) return;
        var isPrac = t.kind === "practice";
        t.segments.forEach(function (s) {
          var rec = {
            layer: t.name, kind: self._kindLabel(t.kind), code: s.value,
            label: (t.kind === "free" ? "" : labelFor(t, s.value)),
            tStart: ft(s.tStart), tEnd: ft(s.tEnd), dur: ft((s.tEnd || 0) - (s.tStart || 0)),
            mStart: isPrac ? s.mStart : "", mEnd: isPrac ? s.mEnd : "", note: s.note || ""
          };
          rows.push(order.map(function (c) { return rec[c[0]]; })); count++;
        });
        if (cfg.includeIndices && t.kind === "dimensao" && t.marks && t.marks.length) {
          var desc = {}; (t.indices || []).forEach(function (ix) { desc[ix.code] = ix.desc || ""; });
          t.marks.forEach(function (mk) {
            var rec = {
              layer: t.name, kind: "índice", code: mk.code, label: desc[mk.code] || "",
              tStart: ft(mk.t), tEnd: ft(mk.t), dur: ft(0), mStart: "", mEnd: "", note: ""
            };
            rows.push(order.map(function (c) { return rec[c[0]]; })); count++;
          });
        }
      });
      if (!count) { this._exportStatus(statusEl, "Nenhuma linha para exportar com os filtros atuais.", "warn"); return; }
      var delim = cfg.delim === "tab" ? "\t" : cfg.delim, ext = delim === "\t" ? "tsv" : "csv";
      P.download((this.file ? this.file.name.replace(/\.[^.]+$/, "") : "sessao") + "_praxis." + ext, "﻿" + P.toCSV(rows, delim), "text/csv;charset=utf-8");
      this._exportStatus(statusEl, "Exportado: " + count + " linha" + (count === 1 ? "" : "s") + " (tempo: " + fmt + ").", "ok");
    },
    _exportStatus: function (el, msg, kind) {
      if (el) { el.textContent = msg; el.className = "status " + (kind || ""); el.style.display = "block"; }
      else this.setStatus(msg, kind);
    },

    // Monta a UI de exportação (camadas, colunas, formato) dentro de `host`. Usada
    // pelas abas Segmentar e Transcrever; o estado é compartilhado e persistido.
    renderExportUI: function (host) {
      if (!host) return;
      var self = this, cfg = this._exportCfg();
      var anySeg = this.tiers.some(function (t) { return t.segments.length; });
      function esc(s) { return P.escapeHtml(String(s == null ? "" : s)); }
      var h = "";
      // Camadas
      h += '<div class="field"><label>Camadas a incluir</label><div class="px-scroll" style="max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">';
      if (!this.tiers.length) h += '<p class="hint" style="margin:2px 4px">Nenhuma camada.</p>';
      this.tiers.forEach(function (t) {
        var on = cfg.tiers[t.id] !== false, n = t.segments.length;
        var extra = (t.kind === "dimensao" && t.marks && t.marks.length) ? (" + " + t.marks.length + " índ.") : "";
        h += '<label class="row" style="align-items:center;gap:6px;margin:2px 0">' +
          '<input type="checkbox" data-exp-tier="' + t.id + '" style="flex:0 0 auto"' + (on ? " checked" : "") + '>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.name) + '</span>' +
          '<span class="pill" style="flex:0 0 auto">' + self._kindLabel(t.kind) + '</span>' +
          '<span class="mini" style="flex:0 0 auto;color:var(--txt-dim)">' + n + extra + '</span></label>';
      });
      h += '<div class="row" style="gap:6px;margin-top:6px"><button class="btn ghost sm" data-exp-allt="1" style="flex:1">Todas</button><button class="btn ghost sm" data-exp-nonet="1" style="flex:1">Nenhuma</button></div>';
      h += '</div></div>';
      // Colunas
      h += '<div class="field"><label>Colunas</label><div style="display:flex;flex-wrap:wrap;gap:4px 12px">';
      this.EXPORT_COLS.forEach(function (c) {
        h += '<label class="row" style="align-items:center;gap:5px;flex:0 0 auto;margin:1px 0">' +
          '<input type="checkbox" data-exp-col="' + c[0] + '" style="flex:0 0 auto"' + (cfg.cols[c[0]] ? " checked" : "") + '>' +
          '<span class="mini">' + esc(c[1]) + '</span></label>';
      });
      h += '</div></div>';
      // Índices, formato de tempo, delimitador, cabeçalho
      h += '<label class="row" style="align-items:center;gap:6px;margin:4px 0"><input type="checkbox" data-exp-flag="includeIndices" style="flex:0 0 auto"' + (cfg.includeIndices ? " checked" : "") + '> <span style="flex:1">Incluir marcadores de índice (dimensões)</span></label>';
      h += '<label class="row" style="align-items:center;gap:6px;margin:4px 0"><input type="checkbox" data-exp-flag="headers" style="flex:0 0 auto"' + (cfg.headers ? " checked" : "") + '> <span style="flex:1">Linha de cabeçalho</span></label>';
      h += '<div class="field"><label>Formato de tempo</label><select data-exp-sel="fmt">' +
        '<option value="hhmmss"' + (cfg.fmt === "hhmmss" ? " selected" : "") + '>hh:mm:ss.ms</option>' +
        '<option value="mmss"' + (cfg.fmt === "mmss" ? " selected" : "") + '>mm:ss.ms</option>' +
        '<option value="sec"' + (cfg.fmt === "sec" ? " selected" : "") + '>segundos</option></select></div>';
      h += '<div class="field"><label>Separador</label><select data-exp-sel="delim">' +
        '<option value=";"' + (cfg.delim === ";" ? " selected" : "") + '>Ponto e vírgula (;)</option>' +
        '<option value=","' + (cfg.delim === "," ? " selected" : "") + '>Vírgula (,)</option>' +
        '<option value="tab"' + (cfg.delim === "tab" ? " selected" : "") + '>Tabulação (.tsv)</option></select></div>';
      h += '<button class="btn secondary wide" data-exp-run="1"' + (anySeg ? "" : " disabled") + '>Exportar tabela</button>';
      h += '<div class="status" data-exp-status style="display:none;margin-top:8px"></div>';
      host.innerHTML = h;

      var statusEl = host.querySelector("[data-exp-status]");
      function rerender() { self.renderExportUI(host); }
      host.querySelectorAll("[data-exp-tier]").forEach(function (cb) {
        cb.addEventListener("change", function () { cfg.tiers[cb.dataset.expTier] = cb.checked; self._saveExportCfg(); });
      });
      host.querySelectorAll("[data-exp-col]").forEach(function (cb) {
        cb.addEventListener("change", function () { cfg.cols[cb.dataset.expCol] = cb.checked; self._saveExportCfg(); });
      });
      host.querySelectorAll("[data-exp-flag]").forEach(function (cb) {
        cb.addEventListener("change", function () { cfg[cb.dataset.expFlag] = cb.checked; self._saveExportCfg(); });
      });
      host.querySelectorAll("[data-exp-sel]").forEach(function (sel) {
        sel.addEventListener("change", function () { cfg[sel.dataset.expSel] = sel.value; self._saveExportCfg(); });
      });
      var allt = host.querySelector("[data-exp-allt]"); if (allt) allt.addEventListener("click", function () { self.tiers.forEach(function (t) { cfg.tiers[t.id] = true; }); self._saveExportCfg(); rerender(); });
      var nonet = host.querySelector("[data-exp-nonet]"); if (nonet) nonet.addEventListener("click", function () { self.tiers.forEach(function (t) { cfg.tiers[t.id] = false; }); self._saveExportCfg(); rerender(); });
      var run = host.querySelector("[data-exp-run]"); if (run) run.addEventListener("click", function () { self.exportCSV(statusEl); });
    },
    // Reconstrói a UI de exportação nas duas abas (mantém o estado atual dos filtros).
    refreshExportUI: function () {
      var s = document.getElementById("seg-export-host"); if (s) this.renderExportUI(s);
      var tr = document.getElementById("tr-export-host"); if (tr) this.renderExportUI(tr);
    },

    // --- Projeto: salvar / abrir (.praxis) --------------------------------------
    // Container: "PRAXIS01"(8) + [uint32 LE tamanho do JSON] + JSON(utf-8) + bytes da mídia.
    _ensureProjectId: function () { if (!this._projectId) this._projectId = P.uid(); return this._projectId; },
    // Objeto do projeto SEM bytes (reusado por salvar e pela assinatura de mudança do autosave).
    _projectObject: function () {
      var EMBED_MAX = 60 * 1024 * 1024;   // acima disso, guarda por referência (evita .praxis gigante e travamento)
      var primary = this.file ? { name: this.file.name, type: this.file.type, size: this.file.size, offset: this.mediaOffset || 0, isVideo: this._isVideoFile(this.file), embedded: this.file.size <= EMBED_MAX, path: this._primaryPath || "" } : null;
      var video = this.videoFile ? { name: this.videoFile.name, type: this.videoFile.type, size: this.videoFile.size, offset: this.videoOffset || 0, isVideo: true, embedded: false, path: this._companionPath || "" } : null;
      return {
        version: 3, app: "Praxis", projectId: this._ensureProjectId(), savedAt: new Date().toISOString(),
        media: primary, video: video, elanMedia: this.elanMedia || [],
        settings: { segMode: this.segMode, delayMs: this.delayMs, mergeGap: this.mergeGap, activeTierId: this.activeTierId, mediaOffset: this.mediaOffset || 0, videoOffset: this.videoOffset || 0 },
        wsRaw: this._wsRaw || [],
        tiers: this.tiers,
        categories: this.categories || [],
        score: (P.Score && P.Score.serialize) ? P.Score.serialize() : null,  // partitura embutida (reabre com o projeto)
        gcp: (P.GCP && P.GCP.serialize) ? P.GCP.serialize() : null,           // estado do gráfico (formatação, seções, estágios, legenda)
        stage: (P.StageLayout && P.StageLayout.serialize) ? P.StageLayout.serialize() : null,  // layout dos módulos (quais ligados, colunas, tamanhos) - por PROJETO
        mdim: (P.Mdim && P.Mdim.serialize) ? P.Mdim.serialize() : null                          // gráficos do modo de formatação (abas/elementos/colunas)
      };
    },
    // Assinatura barata do estado (sem bytes, sem o carimbo de tempo) para detectar mudança.
    _projectSig: function () { var o = this._projectObject(); o.savedAt = ""; return JSON.stringify(o); },
    _buildProjectBlob: async function (proj) {
      var json = new TextEncoder().encode(JSON.stringify(proj));
      var magic = new TextEncoder().encode("PRAXIS01");
      var len = new ArrayBuffer(4); new DataView(len).setUint32(0, json.length, true);
      var parts = [magic, len, json];
      if (proj.media && proj.media.embedded && this.file) parts.push(await this.file.arrayBuffer());
      return new Blob(parts, { type: "application/octet-stream" });
    },
    _writeHandle: async function (handle, blob) { var w = await handle.createWritable(); await w.write(blob); await w.close(); },
    exportProject: async function () {
      var proj = this._projectObject();
      this.setStatus("Salvando projeto…", "work");
      var blob = await this._buildProjectBlob(proj);
      var base = this.file ? this.file.name.replace(/\.[^.]+$/, "") : (this.tiers.length ? "praxis" : "projeto");
      var byRef = (proj.media && !proj.media.embedded) || proj.video;
      var via = "download";
      if (P.hasFSA) {
        try {
          if (!this._projHandle) this._projHandle = await window.showSaveFilePicker({ suggestedName: base + ".praxis", types: [{ description: "Projeto Praxis", accept: { "application/octet-stream": [".praxis"] } }] });
          await this._writeHandle(this._projHandle, blob);
          via = "fsa";
        } catch (e) {
          if (e && e.name === "AbortError") { this.setStatus("Salvamento cancelado.", ""); return; }
          P.download(base + ".praxis", blob);
        }
      } else { P.download(base + ".praxis", blob); }
      this._lastSig = this._projectSig();
      this._markSaved();
      this._startAutosave();
      this.setStatus(via === "fsa"
        ? "Projeto salvo em «" + this._projHandle.name + "». Salvamento automático por minuto ligado." + (byRef ? " A mídia é reencontrada pelo nome nas pastas de mídia." : "")
        : "Projeto salvo (" + (blob.size / 1e6).toFixed(1) + " MB)" + (byRef ? ". Mídia grande por referência - recarregue ao abrir." : "."), "ok");
    },
    // Autosave por minuto (item 3): só grava se houve mudança e se há um .praxis com handle.
    _startAutosave: function () {
      if (this._autosaveTimer || !this._projHandle) return;
      var self = this;
      this._autosaveTimer = setInterval(function () { self._autosaveTick(); }, 60000);
    },
    _autosaveTick: async function () {
      if (!this._projHandle) return;
      try {
        var sig = this._projectSig();
        if (sig === this._lastSig) return;   // nada mudou desde o último salvamento
        var blob = await this._buildProjectBlob(this._projectObject());
        await this._writeHandle(this._projHandle, blob);
        this._lastSig = sig;
        this._markSaved();
        var d = new Date(), hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
        this.setStatus("Salvo automaticamente às " + hh + ":" + mm + ".", "");
      } catch (e) { /* handle pode ter perdido a permissão (ex.: recarregou a página): ignora */ }
    },
    // Atualiza o indicador de último salvamento (rail esquerdo).
    _markSaved: function () {
      var d = new Date(), hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
      this._lastSavedAt = d;
      var el = document.getElementById("proj-lastsaved");
      if (el) el.textContent = "salvo " + hh + ":" + mm;
    },
    // --- Carregamento de mídia pelo SERVIDOR LOCAL (Opção 1: sem cópia, sem File System Access, cross-platform) ----
    // O serve.py resolve o arquivo por NOME nas pastas do media-roots.txt (tamanho desempata) e entrega com HTTP Range.
    // Vídeo transmite direto (src, com seek); áudio primário é buscado (bytes) p/ a forma de onda.
    mediaUrl: function (entry) {
      var u = "/__media__?name=" + encodeURIComponent(entry.name || "");
      if (entry.size) u += "&size=" + entry.size;
      if (entry.path) u += "&path=" + encodeURIComponent(entry.path);   // caminho exato do arquivo escolhido (sem ambiguidade por nome)
      return u;
    },
    // HEAD no servidor: a mídia (por nome) está achável? Não carrega, só verifica.
    _headMedia: function (name, size, path) {
      if (!name && !path) return Promise.resolve(false);
      return fetch(this.mediaUrl({ name: name, size: size, path: path }), { method: "HEAD" })
        .then(function (r) { return !!r && r.ok; }).catch(function () { return false; });
    },
    // Ao ABRIR um projeto: resolve a mídia pelo servidor. Tudo achado → carrega em silêncio. Faltou algo (ou não há
    // referência de mídia) → abre o modal BLOQUEANTE. `relink` = [{name,mime,size,offset,isVideo}] (do .praxis).
    _resolveMediaOnOpen: async function (relink) {
      var self = this;
      this._relink = (relink && relink.length) ? relink : null;
      if (this._relink) {
        var oks = await Promise.all(this._relink.map(function (e) { return self._headMedia(e.name, e.size, e.path); }));
        if (oks.every(Boolean)) { await this._loadSlots(this._relinkToSlots(this._relink)); this.setStatus("Projeto aberto: mídia carregada.", "ok"); return; }
      }
      this.openMediaModal({ blocking: true });
    },
    _relinkToSlots: function (relink) {
      return (relink || []).map(function (e) { return { role: e.isVideo ? "video" : "audio", name: e.name, size: e.size || 0, offset: e.offset || 0, mime: e.mime || "", path: e.path || "", found: true, loaded: false }; });
    },
    // Carrega os slots achados (principal primeiro: áudio; sem áudio, o 1º vídeo vira principal). Aplica o offset salvo.
    _loadSlots: async function (slots) {
      var todo = (slots || []).filter(function (s) { return s.found && s.name && !s.loaded; });
      var audio = todo.filter(function (s) { return s.role === "audio"; });
      var video = todo.filter(function (s) { return s.role === "video"; });
      var ordered = audio.concat(video);
      for (var i = 0; i < ordered.length; i++) {
        var s = ordered[i];
        try { await this._tryServerLoad({ name: s.name, mime: s.mime || "", size: s.size, offset: s.offset || 0, isVideo: s.role === "video", path: s.path }); s.loaded = true; } catch (e) {}
      }
    },
    // --- Modal de mídia (importar / localizar / trocar) --------------------------------------------------------------
    // Uma tela só: bloqueante (abre ao faltar mídia; só sai localizando ou por "abrir sem mídia") ou dispensável (o
    // usuário abre para trocar/corrigir). Linhas no padrão do app: [pill tipo] nome status. Localizar usa o diálogo
    // NATIVO (serve.py), registra a pasta e reprocura todos por nome (o irmão na mesma pasta resolve sozinho).
    openMediaModal: function (opts) {
      opts = opts || {};
      var self = this, blocking = !!opts.blocking;
      this._closeMediaModal();
      var sub = blocking
        ? "Localize os arquivos abaixo para abrir o projeto. Aponte um arquivo e os que estiverem na mesma pasta aparecem sozinhos."
        : "Localize ou troque a mídia deste projeto.";
      var ov = document.createElement("div");
      ov.id = "media-modal"; ov.className = blocking ? "" : "has-x";
      ov.innerHTML =
        '<div class="mm-card" role="dialog" aria-modal="true">' +
          '<div class="mm-head">' +
            '<div class="mm-title">' + (blocking ? "Mídia do projeto não encontrada" : "Mídia do projeto") + '</div>' +
            (blocking ? '' : '<button class="mm-btn mm-x" data-mm-close title="Fechar" aria-label="Fechar"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l10 10M14 4L4 14"/></svg></button>') +
            '<div class="mm-sub">' + sub + '</div>' +
          '</div>' +
          '<div class="mm-body px-scroll"><div class="mm-rows" id="media-modal-rows"></div></div>' +
          '<div class="mm-foot" id="media-modal-foot"></div>' +
        '</div>';
      document.body.appendChild(ov);
      ov.addEventListener("mousedown", function (e) { if (e.target === ov && !blocking) self._closeMediaModal(); });   // clicar no fundo fecha (só dispensável)
      this._mmEsc = function (e) { if (e.key === "Escape") { if (blocking) { e.stopPropagation(); e.preventDefault(); } else self._closeMediaModal(); } };
      document.addEventListener("keydown", this._mmEsc, true);
      var cb = ov.querySelector("[data-mm-close]"); if (cb) cb.addEventListener("click", function () { self._closeMediaModal(); });
      this._mmState = { blocking: blocking, slots: this._mediaSlots(), sub: sub };
      this._renderMediaModal();
    },
    _closeMediaModal: function () {
      var ov = document.getElementById("media-modal"); if (ov) ov.remove();
      if (this._mmEsc) { document.removeEventListener("keydown", this._mmEsc, true); this._mmEsc = null; }
      this._mmState = null;
    },
    // Monta os slots do modal: referência do projeto (this._relink) + mídia já carregada (para trocar) + genérico.
    _mediaSlots: function () {
      var slots = [], byRole = {}, self = this;
      function add(role, name, size, offset, mime, loaded) {
        var s = { role: role, name: name || "", size: size || 0, offset: offset || 0, mime: mime || "", found: !!loaded, loaded: !!loaded };
        slots.push(s); byRole[role] = s; return s;
      }
      (this._relink || []).forEach(function (e) { add(e.isVideo ? "video" : "audio", e.name, e.size, e.offset, e.mime, false); });
      if (this.file) { var r = this._isVideoFile(this.file) ? "video" : "audio"; if (byRole[r]) { byRole[r].name = this.file.name; byRole[r].loaded = byRole[r].found = true; byRole[r].offset = this.mediaOffset || 0; } else add(r, this.file.name, this.file.size, this.mediaOffset, this.file.type, true); }
      if (this.videoFile) { if (byRole["video"]) { byRole["video"].name = this.videoFile.name; byRole["video"].loaded = byRole["video"].found = true; byRole["video"].offset = this.videoOffset || 0; } else add("video", this.videoFile.name, this.videoFile.size, this.videoOffset, this.videoFile.type, true); }
      if (!slots.length) { add("audio", "", 0, 0, "", false); add("video", "", 0, 0, "", false); }
      return slots;
    },
    _renderMediaModal: async function () {
      var st = this._mmState; if (!st) return;
      var self = this;
      await Promise.all(st.slots.map(function (s) {
        if (s.loaded) { s.found = true; return Promise.resolve(); }
        if (!s.name) { s.found = false; return Promise.resolve(); }
        return self._headMedia(s.name, s.size, s.path).then(function (ok) { s.found = ok; });
      }));
      if (!this._mmState) return;   // fechou durante o await
      var rowsEl = document.getElementById("media-modal-rows"); if (!rowsEl) return;
      var roleLabel = { audio: "Áudio", video: "Vídeo" };
      var check = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5l3 3 8-8.5"/></svg>';
      rowsEl.innerHTML = st.slots.map(function (s, i) {
        var state;
        if (s.loaded) state = '<span class="mm-ok">' + check + 'carregado</span><button class="mm-btn mm-swap" data-mm-locate="' + i + '">Trocar</button>';
        else if (s.found) state = '<span class="mm-ok">' + check + 'encontrado</span><button class="mm-btn mm-swap" data-mm-locate="' + i + '">Trocar</button>';
        else state = '<button class="mm-btn mm-find" data-mm-locate="' + i + '">Localizar</button>';
        var nm = s.name
          ? '<span class="mm-name" title="' + P.escapeHtml(s.name) + '">' + P.escapeHtml(s.name) + '</span>'
          : '<span class="mm-name empty">(nenhum arquivo)</span>';
        return '<div class="mm-row"><span class="mm-pill">' + roleLabel[s.role] + '</span>' + nm + '<span class="mm-state">' + state + '</span></div>';
      }).join("");
      var namedMissing = st.slots.some(function (s) { return s.name && !s.found && !s.loaded; });
      var anyReady = st.slots.some(function (s) { return (s.found || s.loaded) && s.name; });
      var ready = anyReady && !namedMissing;
      var footEl = document.getElementById("media-modal-foot");
      footEl.innerHTML =
        (st.blocking ? '<button class="mm-btn mm-ghost" data-mm-skip>Abrir sem mídia por enquanto</button>' : '<span></span>') +
        '<button class="mm-btn mm-primary" data-mm-confirm' + (ready ? '' : ' disabled') + '>' + (st.blocking ? "Abrir projeto" : "Concluir") + '</button>';
      Array.prototype.forEach.call(rowsEl.querySelectorAll("[data-mm-locate]"), function (b) {
        b.addEventListener("click", function () { self._modalLocate(parseInt(b.getAttribute("data-mm-locate"), 10)); });
      });
      var cf = footEl.querySelector("[data-mm-confirm]"); if (cf) cf.addEventListener("click", function () { self._modalConfirm(); });
      var sk = footEl.querySelector("[data-mm-skip]"); if (sk) sk.addEventListener("click", function () { self._modalSkip(); });
    },
    _mmSetSub: function (msg) { var s = document.querySelector("#media-modal .mm-sub"); if (s) s.textContent = msg; },
    // Localiza (diálogo nativo do sistema): o arquivo apontado vira o desta linha e a pasta é registrada; reprocura todos.
    _modalLocate: async function (i) {
      var st = this._mmState; if (!st || !st.slots[i]) return;
      var slot = st.slots[i];
      this._mmSetSub("Selecione o arquivo na janela do sistema.");
      var data = {};
      try { data = await (await fetch("/__pickmedia__")).json(); }
      catch (e) { this._mmSetSub("Não consegui abrir o seletor do sistema. Confira se o servidor está rodando (iniciar.bat)."); return; }
      if (!this._mmState) return;
      if (!data.ok) { if (data.cancelled) this._mmSetSub(st.sub); else this._mmSetSub("Seletor do sistema indisponível: " + (data.error || "?")); return; }
      this._mmSetSub(st.sub);   // restaura o texto de apoio
      // Fixa o arquivo EXATO escolhido (caminho + tamanho reais) - senão o serve.py resolveria por nome e poderia
      // pegar outro vídeo de mesmo nome numa pasta já registrada (bug do "vídeo errado" ao vincular).
      slot.name = data.file; slot.path = data.path || ""; if (data.size != null) slot.size = data.size;
      slot.loaded = false;
      this._renderMediaModal();
    },
    _modalConfirm: async function () {
      var st = this._mmState; if (!st) return;
      var changed = st.slots.some(function (s) { return s.found && s.name && !s.loaded; });
      if (changed) {
        // Recarrega o CONJUNTO todo em ordem: carregar a principal (áudio) reinicia/descarta o vídeo, então o
        // acompanhante precisa ser reanexado em seguida. Marca tudo como "a carregar" e o _loadSlots faz na ordem certa.
        st.slots.forEach(function (s) { if (s.found && s.name) s.loaded = false; });
        await this._loadSlots(st.slots);
        this._closeMediaModal();
        this.setStatus("Mídia carregada. Salve o projeto para lembrar dela nas próximas vezes.", "ok");
      } else {
        this._closeMediaModal();
      }
    },
    _modalSkip: function () {
      this._closeMediaModal();
      this._renderMediaPrompt((this._relink || []).map(function (e) { return e.name; }));   // deixa o aviso no player p/ tentar depois
    },
    // Aviso NO player quando não há mídia (projeto novo/vazio ou após "abrir sem mídia"). O botão abre o modal.
    // Estado vazio do player (sem botão: carregar mídia é feito pelo modal ou pela zona de importação da lateral).
    _renderMediaPrompt: function (missingNames) {
      var host = this.refs.player; if (!host || this.media) return;
      var names = missingNames || ((this._relink || []).map(function (e) { return e.name; }));
      var hasRef = !!(names && names.length);
      host.innerHTML =
        '<div class="media-missing" style="margin:auto;max-width:460px;text-align:center;padding:18px;display:flex;flex-direction:column;gap:8px;align-items:center">' +
          '<div style="font-weight:700;font-size:14px">Mídia não carregada</div>' +
          (hasRef ? '<div class="mini">Este projeto usa: <b>' + names.map(P.escapeHtml).join("</b>, <b>") + '</b></div>' : '') +
        '</div>';
    },
    _tryServerLoad: async function (entry) {
      var headUrl = this.mediaUrl(entry);
      var head;
      try { head = await fetch(headUrl, { method: "HEAD" }); } catch (e) { return false; }
      if (!head.ok) return false;
      var realSize = parseInt(head.headers.get("Content-Length") || "", 10);   // tamanho real (o .praxis pode ter vindo com 0)
      if (isFinite(realSize) && realSize > 0) entry.size = realSize;
      // Cache-buster: cada carga vira uma URL única, então o navegador nunca reusa um vídeo antigo em cache
      // (dentro da mesma carga o seek reaproveita o range; só entre cargas diferentes que muda).
      var url = headUrl + "&_ts=" + Date.now();
      if (entry.isVideo && this.media) {
        this._companionPath = entry.path || null;   // guarda o caminho exato p/ reabrir determinístico
        this.attachVideo({ name: entry.name, type: entry.mime, size: entry.size }, entry.offset || 0, url);   // acompanhante: streaming
      } else if (entry.isVideo) {
        this._primaryPath = entry.path || null;
        this.loadMedia({ name: entry.name, type: entry.mime, size: entry.size }, { offset: entry.offset || 0, srcUrl: url });   // vídeo primário: streaming
      } else {
        var resp = await fetch(url); if (!resp.ok) return false;   // áudio primário: precisa dos bytes p/ a onda
        var blob = await resp.blob();
        this._primaryPath = entry.path || null;
        this.loadMedia(new File([blob], entry.name, { type: entry.mime || blob.type }), { offset: entry.offset || 0 });
      }
      return true;
    },
    // Abre um .praxis via File System Access (guarda o handle p/ o autosave gravar de volta).
    openProjectPicker: async function () {
      if (!P.hasFSA) { this.refs.openProjectFile.click(); return; }
      try {
        var handles = await window.showOpenFilePicker({ types: [{ description: "Projeto Praxis", accept: { "application/octet-stream": [".praxis"] } }] });
        var handle = handles[0], file = await handle.getFile();
        this._projHandle = handle;
        await this.importProject(file);
      } catch (e) { if (e && e.name === "AbortError") return; this.refs.openProjectFile.click(); }
    },
    // Abre o seletor de mídia (com handles quando há FSA; senão o input comum).
    pickMedia: async function () {
      if (!P.hasFSA) { this.refs.fileInput.click(); return; }
      try {
        var handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: "Áudio ou vídeo", accept: { "audio/*": [".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"], "video/*": [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"] } }] });
        var files = [], byName = {};
        for (var i = 0; i < handles.length; i++) { var f = await handles[i].getFile(); files.push(f); byName[f.name] = handles[i]; }
        this.loadFiles(files, byName);
      } catch (e) { if (e && e.name === "AbortError") return; this.refs.fileInput.click(); }
    },

    importProject: async function (file) {
      try {
        this.setStatus("Abrindo projeto…", "work");
        var buf = await file.arrayBuffer(), bytes = new Uint8Array(buf);
        if (new TextDecoder().decode(bytes.slice(0, 8)) !== "PRAXIS01") { this.setStatus("Arquivo de projeto inválido (.praxis esperado).", "err"); return; }
        var jsonLen = new DataView(buf).getUint32(8, true);
        var proj = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + jsonLen)));
        var mediaBytes = bytes.slice(12 + jsonLen);
        this._clearMedia();   // abrir projeto = lousa limpa: descarrega a mídia do projeto anterior (senão o novo herdaria a antiga)
        // remapeia ids das camadas para não colidir com o contador
        var idMap = {};
        (proj.tiers || []).forEach(function (t) { var old = t.id; t.id = nid(); idMap[old] = t.id; });
        this.tiers = proj.tiers || [];
        // categorias (tipos de prática): remapeia as chaves de dimensão pelos novos ids
        this.categories = (proj.categories || []).map(function (c) {
          var iv = {}; Object.keys(c.intervalos || {}).forEach(function (k) { if (idMap[k]) iv[idMap[k]] = c.intervalos[k]; });
          return { id: c.id, nome: c.nome, cor: c.cor, pattern: c.pattern, dash: c.dash, intervalos: iv };
        });
        var st = proj.settings || {};
        this.segMode = st.segMode || "two"; this.delayMs = st.delayMs != null ? st.delayMs : 40; this.mergeGap = st.mergeGap != null ? st.mergeGap : 1.0;
        this.activeTierId = idMap[st.activeTierId] || (this.tiers[0] && this.tiers[0].id);
        this._editIdx = -1; this.activeSeg = null;
        // sincroniza controles da UI
        if (this.refs.segMode) this.refs.segMode.value = this.segMode;
        if (this.refs.delay) { this.refs.delay.value = this.delayMs; if (this.refs.delayVal) this.refs.delayVal.textContent = this.delayMs + " ms"; }
        if (this.refs.merge) { this.refs.merge.value = this.mergeGap; if (this.refs.mergeVal) this.refs.mergeVal.textContent = this.mergeGap.toFixed(1).replace(".", ",") + " s"; }
        this.mediaOffset = st.mediaOffset || 0; this.videoOffset = st.videoOffset || 0;
        // mídia embutida (só quando pequena); grande vem por referência
        var relink = [];
        if (proj.media && proj.media.embedded && mediaBytes.length) {
          this.loadMedia(new File([mediaBytes], proj.media.name, { type: proj.media.type }), { offset: proj.media.offset || 0 });
        } else if (proj.media) {
          relink.push({ name: proj.media.name, mime: proj.media.type, size: proj.media.size, offset: proj.media.offset || 0, isVideo: !!proj.media.isVideo, path: proj.media.path || "" });
        }
        if (proj.video) relink.push({ name: proj.video.name, mime: proj.video.type, size: proj.video.size, offset: proj.video.offset || 0, isVideo: true, path: proj.video.path || "" });
        this._wsRaw = proj.wsRaw || [];   // restaura após o reset do loadMedia
        this.updateWhisperUI();
        this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.updateActions();
        this.resetHistory();   // projeto aberto = nova linha de base do desfazer/refazer
        if (proj.score && P.Score && P.Score.restore) P.Score.restore(proj.score);   // partitura reabre junto (item 3)
        if (P.GCP && P.GCP.restore) P.GCP.restore(proj.gcp || null);   // gráficos do projeto reabrem junto (existem sem regerar)
        if (P._refreshGcp) P._refreshGcp();   // atualiza as abas/gráfico ativo com o que veio do arquivo
        if (P.StageLayout && P.StageLayout.restore) P.StageLayout.restore(proj.stage || null);   // layout dos módulos vem do projeto (gráfico visível só se o projeto o ligou; já renderiza sem precisar abrir a aba)
        if (P.Transcript && P.Transcript.buildLayerOptions) P.Transcript.buildLayerOptions();
        if (P.Mdim && P.Mdim.restore) P.Mdim.restore(proj.mdim || null, idMap);   // gráficos do modo de formatação reabrem com o projeto (dims remapeadas)
        if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
        // identidade do projeto + autosave
        this._projectId = proj.projectId || P.uid();
        this._primaryHandle = null; this._companionHandle = null;
        this._lastSig = this._projectSig();
        if (this._projHandle) this._startAutosave();
        var hadEmbedded = proj.media && proj.media.embedded && mediaBytes.length;
        // Mídia pelo SERVIDOR LOCAL (resolve por nome nas pastas do media-roots.txt; sem cópia, sem storage do navegador).
        // Tudo achado → carrega em silêncio. Faltou algo (ou projeto sem referência de mídia) → modal bloqueante de mídia.
        if (!hadEmbedded) this._resolveMediaOnOpen(relink);
        this.setStatus("Projeto aberto: " + this.tiers.length + " camada(s)" +
          (hadEmbedded ? ", mídia embutida «" + proj.media.name + "»" : "") +
          (this._projHandle ? " · autosave ligado" : "") + ".", "ok");
      } catch (e) {
        console.error(e);
        this.setStatus("Falha ao abrir projeto: " + (e && e.message ? e.message : e), "err");
      }
    },

    // Carrega camadas vindas de uma importação (ex.: ELAN). Substitui as camadas
    // atuais e atualiza todas as telas. Não altera a mídia carregada.
    loadTiers: function (tiers, sourceName) {
      if (!tiers || !tiers.length) { this.setStatus("Nenhuma camada para importar.", "err"); return; }
      this.tiers = tiers; this.categories = [];   // dataset novo: categorias antigas referiam dimensões que já não existem
      var prac = tiers.filter(function (t) { return t.kind === "practice" && t.segments.length; })[0];
      this.activeTierId = (prac || tiers[0]).id;
      this._editIdx = -1; this.activeSeg = null;
      this.renderTiers(); this.renderPicker(); this.renderList(); this.renderTimeline(); this.updateActions(); this.commit();
      if (P.Transcript && P.Transcript.buildLayerOptions) P.Transcript.buildLayerOptions();
      if (P.Mdim && P.Mdim.refresh) P.Mdim.refresh();
      this.setStatus("ELAN importado" + (sourceName ? " · " + sourceName : "") + ": " + tiers.length + " camada(s), camada ativa «" + (prac || tiers[0]).name + "».", "ok");
    },

    // A barra de estado do HUD foi removida (decisão de design). Mantido como
    // no-op seguro; erros realmente bloqueantes usam diálogo no ponto de uso.
    setStatus: function (msg, kind) {
      var s = this.refs.status;
      if (s) { s.textContent = msg; s.className = "status " + (kind || ""); return; }
      // A barra de status saiu do layout no redesenho; só os ERROS continuam visíveis, num aviso flutuante
      // (senão falhas como "Whisper indisponível" ou "carregue uma mídia" sumiriam em silêncio).
      if (kind === "err" && msg) P.toastError(msg);
    },

    // --- Whisper (por janelas, com pausar / continuar / retomar) ----------------
    _wsAudio: null, _wsFile: null, _wsRunning: false, _wsPaused: false, _wsCursor: 0, _wsTotal: 0, WIN: 30,
    _wsRaw: [], mergeGap: 1.0, maxSegDur: 40,   // agrupamento por pausa (segundos)

    // Reconstrói os segmentos da tier livre a partir dos trechos crus do Whisper,
    // juntando trechos cuja pausa entre eles seja <= mergeGap (costura entre janelas também).
    regroupFromRaw: function (free) {
      free = free || this.tiers.filter(function (t) { return t.kind === "free"; })[0];
      if (!free) return;
      var raw = (this._wsRaw || []).slice().sort(function (a, b) { return a.start - b.start; });
      var locked = (free.segments || []).filter(function (s) { return s.locked; });
      function inLocked(c) { return locked.some(function (L) { return c.start < L.tEnd && c.end > L.tStart; }); }
      var auto = [], open = null, gap = this.mergeGap, maxD = this.maxSegDur;
      raw.forEach(function (c) {
        if (!c.text) return;
        if (inLocked(c)) { open = null; return; }         // regiões travadas ficam intactas
        if (open && (c.start - open.tEnd) <= gap && (c.end - open.tStart) <= maxD) {
          open.value += " " + c.text; open.tEnd = c.end;
        } else {
          open = { tStart: c.start, tEnd: c.end, value: c.text, note: "", locked: false };
          auto.push(open);
        }
      });
      free.segments = auto.concat(locked).sort(function (a, b) { return a.tStart - b.tStart; });
      this.renderList(); this.renderTimeline();
    },

    updateWhisperUI: function () {
      var r = this.refs; if (!r || !r.whisperBtn) return;
      r.whisperBtn.disabled = this._wsRunning || !this.file;
      r.whisperBtn.textContent = (this._wsCursor > 0 && !this._wsRunning) ? "Continuar transcrição" : "Transcrever a fala";
      if (r.whisperPause) r.whisperPause.disabled = !this._wsRunning;
      if (r.whisperHere) r.whisperHere.disabled = this._wsRunning || !this.file;
    },

    // --- Seleção de modelo Whisper ---------------------------------------------
    loadWhisperPrefs: function () {
      try {
        var m = localStorage.getItem("praxis.whisper.model");
        if (m && whisperModelById(m)) this.whisperModel = m;
        this._wsInstalled = JSON.parse(localStorage.getItem("praxis.whisper.installed") || "[]");
      } catch (e) { this._wsInstalled = []; }
      if (!this._wsInstalled) this._wsInstalled = [];
    },
    _saveWhisperPrefs: function () {
      try {
        localStorage.setItem("praxis.whisper.model", this.whisperModel);
        localStorage.setItem("praxis.whisper.installed", JSON.stringify(this._wsInstalled || []));
      } catch (e) {}
    },
    // O modelo «vendorizado» (Base) vem no pacote de release, mas NÃO no repositório git (passa do limite de 100 MB do
    // GitHub). Se os arquivos não estiverem em vendor/models/, ele vira um modelo comum: baixa do HuggingFace no 1º uso.
    _vendoredOk: function (m) { return !!(m && m.vendored && this._vendorMissing !== true); },
    _checkVendoredModel: function () {
      var self = this, url = new URL("vendor/models/Xenova/whisper-base/onnx/encoder_model.onnx", document.baseURI).href;
      fetch(url, { method: "HEAD", cache: "no-store" }).then(function (r) { return r.ok; }, function () { return false; })
        .then(function (ok) { var miss = !ok; if (miss !== self._vendorMissing) { self._vendorMissing = miss; self.renderWhisperModelUI(); } });
    },
    isModelInstalled: function (id) {
      var m = whisperModelById(id);
      return !!(m && (this._vendoredOk(m) || (this._wsInstalled || []).indexOf(id) >= 0));
    },
    _markInstalled: function (id) {
      if (!this._wsInstalled) this._wsInstalled = [];
      if (this._wsInstalled.indexOf(id) < 0) { this._wsInstalled.push(id); this._saveWhisperPrefs(); this.renderWhisperModelUI(); }
    },
    setWhisperModel: function (id) {
      if (!whisperModelById(id)) return;
      if (id !== this.whisperModel) { this.whisperModel = id; this._pipe = null; }   // troca de modelo recarrega o pipeline
      this._saveWhisperPrefs();
      this.renderWhisperModelUI();
    },
    renderWhisperModelUI: function () {
      var sel = document.getElementById("seg-wmodel"), info = document.getElementById("seg-wmodel-info"), get = document.getElementById("seg-wmodel-get");
      if (!sel) return;
      var self = this;
      sel.innerHTML = WHISPER_MODELS.map(function (m) {
        var inst = self.isModelInstalled(m.id);
        return '<option value="' + m.id + '"' + (m.id === self.whisperModel ? " selected" : "") + '>' + P.escapeHtml(m.label) + ": " + m.size + ". " + (inst ? "Instalado" : "Baixar") + "</option>";
      }).join("");
      var cur = whisperModelById(this.whisperModel), installed = this.isModelInstalled(this.whisperModel);
      if (info) {
        var prec = cur.prec || "fp32";
        var precNota = prec === "fp16" ? " " + prec + " (leve, qualidade quase igual à fp32)" : " " + prec;
        info.textContent = installed
          ? (this._vendoredOk(cur) ? "Disponível offline (vem com o Praxis)." : "Baixado e disponível offline neste navegador." + precNota + ".")
          : "Não baixado. Precisa de internet na 1ª vez (" + cur.size + "); depois fica offline no navegador." + precNota + ".";
      }
      if (get) {
        get.style.display = installed ? "none" : "block";
        get.textContent = "Baixar e usar (" + cur.size + ")";
        get.disabled = this._wsRunning;
      }
    },
    downloadWhisperModel: async function () {
      var cur = whisperModelById(this.whisperModel); if (!cur) return;
      if (this.isModelInstalled(this.whisperModel)) { this.setStatus("Modelo já disponível offline.", "ok"); return; }
      var get = document.getElementById("seg-wmodel-get"); if (get) { get.disabled = true; get.textContent = "Baixando…"; }
      this.setStatus("Baixando o modelo " + cur.label + " (" + cur.size + ")… mantenha a internet ligada.", "work");
      try {
        var vbase = new URL("vendor/", document.baseURI).href;
        var mod = await import(vbase + "transformers/transformers.min.js");
        this._configEnv(mod);
        this._pipe = null;
        await this.buildPipeline(mod);   // baixa + cacheia + marca instalado
        this.setStatus("Modelo " + cur.label + " baixado. Agora fica offline neste navegador.", "ok");
      } catch (e) {
        this.setStatus("Falha ao baixar o modelo (" + (e && e.message ? e.message : e) + "). Verifique a internet e tente de novo.", "err");
      } finally { if (get) get.disabled = false; this.renderWhisperModelUI(); }
    },
    // Barra de progresso do download/carregamento do modelo (agrega loaded/total de todos os arquivos).
    _showModelProgress: function (show) {
      var box = document.getElementById("seg-wmodel-prog"), bar = document.getElementById("seg-wmodel-prog-bar"), lab = document.getElementById("seg-wmodel-prog-lab");
      clearTimeout(this._dlIdle); clearInterval(this._compileTimer); this._compileStart = null;
      if (!box) return;
      box.style.display = show ? "block" : "none";
      if (bar) bar.classList.remove("prog-pulse", "prog-indet");
      if (show) { this._dlFiles = {}; if (bar) bar.style.width = "0%"; if (lab) lab.textContent = "0%"; }
    },
    _onModelProgress: function (p) {
      if (!p || p.status !== "progress" || !p.file || !p.total) return;
      var bar = document.getElementById("seg-wmodel-prog-bar"), lab = document.getElementById("seg-wmodel-prog-lab"), self = this;
      // voltou a chegar dado → fase de download (encerra a de compilação, se estava nela)
      clearInterval(this._compileTimer); this._compileStart = null;
      if (bar) bar.classList.remove("prog-pulse", "prog-indet");
      this._dlFiles = this._dlFiles || {};
      this._dlFiles[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      var L = 0, T = 0; for (var k in this._dlFiles) { L += this._dlFiles[k].loaded; T += this._dlFiles[k].total; }
      var pct = T ? Math.min(99.9, L / T * 100) : 0;   // 100% fica reservado para "pronto"
      if (bar) bar.style.width = pct.toFixed(1) + "%";
      if (lab) lab.textContent = "Baixando: " + pct.toFixed(0) + "%" + (T ? " · " + (L / 1048576).toFixed(0) + "/" + (T / 1048576).toFixed(0) + " MB" : "");
      // Sem novas mensagens por ~2,5 s = provavelmente compilando o modelo (fase sem progresso).
      clearTimeout(this._dlIdle);
      this._dlIdle = setTimeout(function () { self._modelCompiling(); }, 2500);
    },
    // Fase de compilação/carregamento na GPU (o runtime NÃO dá progresso): barra animada
    // de "trabalhando" + cronômetro do tempo decorrido, para não parecer travado.
    _modelCompiling: function () {
      var self = this, bar = document.getElementById("seg-wmodel-prog-bar"), lab = document.getElementById("seg-wmodel-prog-lab");
      if (bar) { bar.style.width = "100%"; bar.classList.add("prog-indet"); }
      if (this._compileStart == null) this._compileStart = Date.now();
      var tick = function () {
        var s = Math.floor((Date.now() - self._compileStart) / 1000), mm = Math.floor(s / 60), ss = ("0" + (s % 60)).slice(-2);
        var el = document.getElementById("seg-wmodel-prog-lab");
        if (el) el.textContent = "Preparando o modelo (compilando na GPU)… " + mm + ":" + ss;
      };
      tick();
      clearInterval(this._compileTimer);
      this._compileTimer = setInterval(tick, 1000);
    },
    // Configura o ambiente do transformers.js conforme o modelo selecionado ser local (vendorizado) ou remoto.
    _configEnv: function (mod) {
      var vbase = new URL("vendor/", document.baseURI).href;
      var cur = whisperModelById(this.whisperModel);
      var local = this._vendoredOk(cur);
      mod.env.allowLocalModels = local;
      mod.env.localModelPath = vbase + "models/";
      mod.env.allowRemoteModels = !local;   // só o vendorizado presente é 100% offline; os demais (ou ele ausente) baixam do HF
      mod.env.useBrowserCache = true;                       // guarda no cache do navegador (offline depois)
      if (mod.env.backends && mod.env.backends.onnx && mod.env.backends.onnx.wasm) mod.env.backends.onnx.wasm.wasmPaths = vbase + "ort/";
    },

    ensureAudio: async function () {
      if (this._wsAudio && this._wsFile === this.file) return this._wsAudio;
      this.setStatus("Decodificando áudio (arquivo longo pode levar alguns segundos)…", "work");
      this._wsAudio = await this.decodeAudio16k(this.file);
      this._wsFile = this.file; this._wsTotal = this._wsAudio.length / 16000;
      return this._wsAudio;
    },

    pauseTranscription: function () {
      if (this._wsRunning) { this._wsPaused = true; this.setStatus("Pausando após o trecho atual…", "work"); }
    },

    startTranscription: async function (fromSec) {
      if (this._wsRunning) return;
      if (!this.file) { this.setStatus("Carregue uma mídia primeiro.", "err"); return; }
      var free = this.tiers.filter(function (t) { return t.kind === "free"; })[0];
      if (!free) { free = { id: nid(), name: "Verbalização (Whisper)", kind: "free", vocab: [], activeCat: null, segments: [] }; this.tiers.push(free); this.renderTiers(); }
      var self = this, sr = 16000, W = this.WIN;
      this._wsRunning = true; this._wsPaused = false; this.updateWhisperUI();
      try {
        await this.ensureAudio();
        var curM = whisperModelById(this.whisperModel);
        this.setStatus(curM && !this.isModelInstalled(this.whisperModel)
          ? "Baixando o modelo " + curM.label + " (" + curM.size + ", 1ª vez)…"
          : "Carregando o modelo Whisper (offline)…", "work");
        var vbase = new URL("vendor/", document.baseURI).href;
        var mod = await import(vbase + "transformers/transformers.min.js");
        this._configEnv(mod);
        var tr = await this.buildPipeline(mod);
        var total = this._wsTotal;
        if (fromSec == null) fromSec = this._wsCursor || 0;
        if (fromSec <= 0.001) this._wsRaw = [];   // começo do zero => limpa os trechos crus
        this._wsCursor = fromSec;
        for (var i = Math.floor(fromSec / W); i * W < total; i++) {
          if (this._wsPaused) break;
          var a = i * W, b = Math.min(total, (i + 1) * W);
          var slice = this._wsAudio.subarray(Math.floor(a * sr), Math.floor(b * sr));
          var out = await tr(slice, {
            return_timestamps: true, chunk_length_s: 30, language: "portuguese", task: "transcribe",
            no_repeat_ngram_size: 3,      // evita loops de repetição em trechos sem fala
            max_new_tokens: 200,          // limita a geração por janela (não trava em alucinação)
            temperature: 0
          });
          var chunks = (out.chunks || []).filter(function (c) { return c.timestamp && c.text && c.text.trim(); });
          if (!chunks.length && out.text && out.text.trim()) chunks = [{ timestamp: [0, b - a], text: out.text }];
          chunks.forEach(function (c) {
            // a/b são tempo do ARQUIVO (o áudio decodificado começa no 0 do arquivo); os segmentos vivem no tempo de anotação
            var off = self.mediaOffset || 0;
            self._wsRaw.push({ start: a + (c.timestamp[0] || 0) - off, end: a + (c.timestamp[1] != null ? c.timestamp[1] : (b - a)) - off, text: c.text.trim() });
          });
          this._wsCursor = b;
          this.activeTierId = free.id;
          this.regroupFromRaw(free);              // agrupa por pausa (ao vivo)
          this.renderTiers(); this.renderPicker(); this.updateActions();
          this.setStatus("Transcrevendo… " + P.fmtTime(b) + " / " + P.fmtTime(total) + " (" + (total ? (b / total * 100).toFixed(0) : 0) + "%)", "work");
        }
        this._wsRunning = false;
        this.commit();   // checkpoint único ao pausar/concluir (não por chunk)
        if (this._wsCursor >= total - 0.01) { this.setStatus("Transcrição concluída (" + P.fmtTime(total) + ") na camada «" + free.name + "».", "ok"); this._wsCursor = 0; }
        else { this.setStatus("Pausado em " + P.fmtTime(this._wsCursor) + ". «Continuar» retoma daqui; «Do tempo atual» retoma da posição do player.", ""); }
        this.updateWhisperUI();
      } catch (err) {
        console.error(err);
        this._wsRunning = false;
        this.setStatus("Whisper indisponível aqui (" + (err && err.message ? err.message : err) + "). A segmentação manual continua funcionando.", "err");
        this.updateWhisperUI();
      }
    },
    _pipe: null, _pipeModel: null,
    buildPipeline: async function (mod) {
      if (this._pipe && this._pipeModel === this.whisperModel) return this._pipe;   // reutiliza na sessão
      var model = this.whisperModel, self = this;
      // dtype por modelo: fp32 nos menores; fp16 nos grandes (fp32 no large é inviável).
      // O q8/int8 NÃO é usado (corrompe o texto neste ORT/WebGPU).
      var mInfo = whisperModelById(model);
      var dtype = (mInfo && mInfo.dtype) || { encoder_model: "fp32", decoder_model_merged: "fp32" };
      var prog = function (p) { self._onModelProgress(p); if (p && p.status === "progress" && p.file && /\.onnx|\.bin/.test(p.file)) self.setStatus("Carregando o modelo: " + (p.progress ? p.progress.toFixed(0) : 0) + "%", "work"); };
      // WebGPU quando dá; senão WASM. E, se o modelo não tiver arquivos fp32, tenta o padrão da biblioteca.
      async function make(opts) {
        try { return await mod.pipeline("automatic-speech-recognition", model, Object.assign({ device: "webgpu", progress_callback: prog }, opts)); }
        catch (e) { return await mod.pipeline("automatic-speech-recognition", model, Object.assign({ progress_callback: prog }, opts)); }
      }
      this._showModelProgress(true);
      try {
        try { this._pipe = await make({ dtype: dtype }); }
        catch (e) { this._pipe = await make({}); }        // fallback: deixa a biblioteca escolher os arquivos disponíveis
        this._pipeModel = model;
        this._markInstalled(model);
        return this._pipe;
      } finally { this._showModelProgress(false); }
    },
    decodeAudio16k: async function (file) {
      var buf = await file.arrayBuffer(), AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
      var dec = await ac.decodeAudioData(buf), ch = dec.numberOfChannels, len = dec.length, tmp = new Float32Array(len);
      for (var c = 0; c < ch; c++) { var d = dec.getChannelData(c); for (var i = 0; i < len; i++) tmp[i] += d[i] / ch; }
      var target = 16000;
      if (dec.sampleRate === target) { ac.close(); return tmp; }
      var off = new OfflineAudioContext(1, Math.ceil(len * target / dec.sampleRate), target);
      var src = off.createBufferSource(), b = off.createBuffer(1, len, dec.sampleRate);
      b.copyToChannel(tmp, 0); src.buffer = b; src.connect(off.destination); src.start(0);
      var r = await off.startRendering(); ac.close(); return r.getChannelData(0);
    }
  };

  P.Segmenter = S;
})(window.Praxis = window.Praxis || {});
