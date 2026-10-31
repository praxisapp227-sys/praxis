/* gcp.js - Módulo B: Gráfico de Comportamento de Prática (GCP)
   Eixos (corrigidos): X = compasso da música; Y = segmento de prática (numerado
   pelas anotações), invertível (cresce pra cima ou pra baixo). Cada segmento é uma
   barra horizontal do compasso inicial ao final, colorida pelo comportamento.
   SVG puro, exportável (SVG/PNG/JPG com DPI). */
(function (P) {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if ((k === "width" || k === "height") && typeof v === "number" && v < 0) v = 0; e.setAttribute(k, v); }   // largura/altura nunca negativas (evita o aviso do SVG em estados transitórios)
    return e;
  }
  function niceStep(range, target) {
    var raw = range / target, pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var f = raw / pow, nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return Math.max(1, nf * pow);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hex2rgb(h) { h = String(h).replace("#", ""); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  // Rampa de cor por paradas [ [pos0..1, [r,g,b]], ... ]; devolve "rgb(...)".
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], u = (b[0] - a[0]) ? (t - a[0]) / (b[0] - a[0]) : 0;
        return "rgb(" + Math.round(lerp(a[1][0], b[1][0], u)) + "," + Math.round(lerp(a[1][1], b[1][1], u)) + "," + Math.round(lerp(a[1][2], b[1][2], u)) + ")";
      }
    }
    var last = stops[stops.length - 1][1];
    return "rgb(" + last[0] + "," + last[1] + "," + last[2] + ")";
  }

  var GCP = {
    data: null, host: null, tooltip: null, svg: null, _dims: null,
    cfg: {
      chartStyle: "gcp",          // "gcp" | "heatmap" (estilo de gráfico da aba)
      heatGroupBy: "stage",       // heatmap: eixo Y = "stage" | "behavior" | "time"
      heatMetric: "duration",     // heatmap: dado = "duration" | "coverage" | "onset" | "offset" | "repeat"
      splitByStage: false,        // dividir em GCPs menores (estágios)
      invertY: false,             // false (padrão) = segmento 1 EMBAIXO (canto inferior esquerdo); true = seg. 1 no topo
      xToBottom: false,           // quando invertido, força o eixo X a ficar embaixo (senão vai p/ o topo)
      rowStep: 9,                 // distância entre segmentos (espaçamento)
      barHeight: 7,               // espessura da barra (barHeight>rowStep => sobreposição)
      opacity: 0.92,
      outline: { show: false, color: "#111111", width: 1 },
      showLegend: false,          // legenda dos comportamentos no gráfico
      legendPos: "right",         // "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
      legendSize: 10,             // tamanho da fonte da legenda
      legendSwatch: 12,           // tamanho do quadradinho de cor da legenda
      legendLabels: {},           // rótulo customizado por comportamento (código -> texto); vazio = "código · nome"
      showScore: false,           // faixa de partitura alinhada ao compasso (acima/abaixo do GCP)
      scorePos: "above",          // "above" | "below"
      scoreHeight: 90,            // altura da faixa em px
      scoreScale: 40,             // escala do Verovio (tamanho das notas)
      scoreStaff: "all",          // "all" | "top" (só a pauta de cima)
      scoreMnum: false,           // números de compasso na faixa
      scoreGap: 8,                // espaço entre a faixa e o gráfico
      showGrid: true,
      axisMMin: null, axisMMax: null,   // eixo de compasso: sobrescreve mín/máx (null = automático)
      axisTickStep: null,               // intervalo da grade em compassos (null/0 = automático = 1)
      axisLabelStep: null,              // intervalo dos rótulos numéricos do eixo X, em compassos (null/0 = automático, afinado p/ não colidir)
      gridTarget: 10,                   // fallback interno da grade (trava anti-excesso)
      showXLabels: true,                // rótulos numéricos do eixo de compasso
      colView: false,                   // ver em colunas (reflui os segmentos em várias colunas)
      colCount: 3,                      // nº de colunas quando colView está ligado
      colGap: 10,                       // espaçamento entre as colunas (px)
      colFit: true,                     // caber na altura (padrão): encolhe a altura por segmento p/ a coluna caber na tela
      colAxisMode: "proportional",      // eixo das colunas: "proportional" (mesmo eixo) | "own" (eixo próprio) | "efficient" (corta compassos não usados, mesma escala)
      colAuto: true,                    // enquanto true, sugere o nº de colunas ao ligar (some quando o usuário mexe)
      colSingleAxis: false,             // em colunas: um único título de eixo X e Y (não repete em cada coluna)
      colEffScale: 1,                   // escala horizontal do modo "eficiente" (multiplica px/compasso p/ aproveitar o espaço)
      showSegLabels: true,              // numeração dos segmentos no eixo Y
      showSegTitle: true,               // título do eixo Y ("Segmento de prática")
      xTitle: "Compasso",               // texto do título do eixo X (editável)
      yTitle: "Segmento de prática",    // texto do título do eixo Y (editável)
      axisTitleSize: 11,                // tamanho da fonte dos títulos dos eixos
      axisTitleTrack: 0,                // tracking (letter-spacing, px) dos títulos
      axisTitleBold: false,             // negrito nos títulos
      axisTitleCase: "none",            // "none" | "upper" (MAIÚSCULAS) | "lower" (minúsculas)
      axisTitleColor: "",               // "" = cor de contraste automática (fg)
      axisTitleGap: 15,                 // distância (px) entre os rótulos do eixo (grade) e o título do eixo
      axisYLabelStep: 0,                // intervalo (em segmentos) dos rótulos do eixo Y; 0 = automático
      showStageLabels: false,           // rótulos dos estágios no gráfico ("Estágio N" ou o nome)
      stageLabelColor: "",              // "" = fg
      stageLabelSize: 11,
      stageLabelInside: true,           // dentro da área do gráfico (true) ou fora, na margem esquerda (false)
      stageLabelVertical: false,        // rótulo na vertical (rotacionado -90, como o título do eixo Y)
      stageLabelSide: "left",           // "left" | "right" (lado horizontal do rótulo)
      stageLabelAlign: "center",        // "center" (centrado na faixa) | "boundary" (no começo/1º segmento do estágio)
      stageLabelTrack: 0,               // tracking (letter-spacing, px)
      stageLabelCase: "none",           // "none" | "upper" | "lower"
      stageLabelBold: true,             // negrito
      stageLabelItalic: false,          // itálico
      stageLabelOffset: 0,              // deslocamento horizontal (px; + direita, - esquerda)
      stageLabelHalo: true,             // halo/contorno na cor do fundo atrás do texto (legível sobre as barras)
      showSectionLabels: true,
      sectionLabelColor: "",            // "" = cor do traço da seção (sectionColor) ou fg
      sectionLabelSize: 11,
      sectionColor: "",           // "" = automático (cor do texto)
      sectionWidth: 1.4,
      sectionLinesBehind: false,  // desenhar o traço das seções ATRÁS das barras de segmento
      sectionDash: "5 4",
      showSectionTints: false,    // bandas de fundo por seção (vertical, compasso)
      sectionTintOpacity: 0.12,
      showStageTints: false,      // bandas de fundo por estágio (horizontal, segmentos)
      stageTintOpacity: 0.12,
      showStageLines: false,      // linhas tracejadas nas fronteiras entre estágios (alternativa às tintas)
      stageLineColor: "",         // "" = cor de contraste automática (fg)
      stageLineWidth: 1.4,
      stageLineDash: "5 4",       // "5 4" tracejado · "" sólido · "2 3" pontilhado
      legendOutline: false,       // contorno preto nos quadradinhos da legenda
      legendOnlyUsed: false,      // legenda mostra só comportamentos presentes nos segmentos visíveis (por estágio no split)
      legendOffX: 0,              // ajuste fino da posição da legenda (px, horizontal)
      legendOffY: 0,              // ajuste fino da posição da legenda (px, vertical)
      exportDpi: 300,
      font: "'Segoe UI', system-ui, sans-serif",   // fallback de fonte (a fonte real vem da predefinição ativa)
      presets: null,              // [{id,name,kind,builtin,colors,patterns,opacity,outline,font}] - persistente
      activePreset: null
    },

    PATTERNS: ["solid", "diag", "diag2", "cross", "horiz", "vert", "dots"],

    // --- Presets (cor / P&B) independentes e persistentes (localStorage) --------
    // Preenche os campos de aparência ausentes (predefinições antigas / embutidas).
    _ensurePresetLook: function (p) {
      if (p.colors == null) p.colors = {};
      if (p.patterns == null) p.patterns = {};
      if (p.patternFg == null) p.patternFg = {};   // cor principal (marca) por comportamento
      if (p.patternBg == null) p.patternBg = {};   // cor secundária (fundo) por comportamento
      if (p.opacity == null) p.opacity = 0.92;
      if (p.radius == null) p.radius = 1.5;
      if (!p.outline) p.outline = { show: false, color: "#111111", width: 1 };
      if (!p.font) p.font = "'Segoe UI', system-ui, sans-serif";
      return p;
    },
    ensurePresets: function () {
      if (!this.cfg.presets) {
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem("praxis.gcp.presets") || "null"); } catch (e) {}
        this.cfg.presets = (saved && saved.length) ? saved : [
          { id: "c1", name: "Colorido", kind: "color", builtin: true, colors: {}, patterns: {} },
          { id: "bw1", name: "Preto & branco", kind: "bw", builtin: true, colors: {}, patterns: {} },
          { id: "cb1", name: "Daltônicos (Okabe-Ito)", kind: "cb", builtin: true, colors: {}, patterns: {} }
        ];
      }
      // Garante a predefinição embutida de daltônicos em listas salvas antigas.
      if (!this.cfg.presets.some(function (p) { return p.kind === "cb"; }))
        this.cfg.presets.push({ id: "cb1", name: "Daltônicos (Okabe-Ito)", kind: "cb", builtin: true, colors: {}, patterns: {} });
      var self = this; this.cfg.presets.forEach(function (p) { self._ensurePresetLook(p); });
      if (!this.cfg.activePreset || !this.cfg.presets.some(function (p) { return p.id === this.cfg.activePreset; }, this))
        this.cfg.activePreset = this.cfg.presets[0].id;
    },
    // Predefinição editável: se a ativa for embutida (padrão do Praxis), cria automaticamente uma cópia
    // "<nome> modificada" e passa a editá-la (o usuário nunca altera as predefinições padrão sem querer).
    _editablePreset: function () {
      var pr = this.activePreset();
      if (!pr.builtin) return pr;
      var copy = JSON.parse(JSON.stringify(pr));
      copy.id = P.uid(); copy.builtin = false; copy.name = pr.name + " modificada";
      this.cfg.presets.push(copy); this.cfg.activePreset = copy.id; this.savePresets();
      return copy;
    },
    savePresets: function () { try { localStorage.setItem("praxis.gcp.presets", JSON.stringify(this.cfg.presets)); } catch (e) {} },
    // fonte do gráfico, persistida à parte (o resto do cfg é por sessão)
    loadFont: function () { if (this._fontLoaded) return; this._fontLoaded = true; try { var f = localStorage.getItem("praxis.gcp.font"); if (f) this.cfg.font = f; } catch (e) {} },
    // Reordena os comportamentos (ordem da legenda + agrupamento no gráfico). Trava as cores atuais
    // na predefinição ativa antes de reordenar, p/ a nova ordem NÃO recolorir (cores automáticas são por índice).
    // Muta o array em si (== dataset.behaviors por referência), então persiste no .praxis.
    reorderBehaviors: function (newOrder) {
      var d = this.data; if (!d || !d.behaviors || !newOrder) return false;
      var pr = this._editablePreset(), self = this, arr = d.behaviors;
      arr.forEach(function (b, i) { if (pr.colors[b] == null || pr.colors[b] === "") pr.colors[b] = self.behColor(b, i, pr); });
      var seen = {}, clean = [];
      newOrder.forEach(function (b) { if (!seen[b] && arr.indexOf(b) >= 0) { seen[b] = 1; clean.push(b); } });
      arr.forEach(function (b) { if (!seen[b]) { seen[b] = 1; clean.push(b); } });   // segura os que ficaram de fora
      arr.length = 0; clean.forEach(function (b) { arr.push(b); });
      this.savePresets();
      return true;
    },
    activePreset: function () { this.ensurePresets(); var id = this.cfg.activePreset, ps = this.cfg.presets; return ps.filter(function (p) { return p.id === id; })[0] || ps[0]; },
    presetById: function (id) { this.ensurePresets(); return this.cfg.presets.filter(function (p) { return p.id === id; })[0]; },
    // Formatação dos títulos dos eixos (tamanho/tracking/negrito/caixa), aplicada a X, Y e ao heatmap.
    _axCase: function (s, mode) { s = String(s == null ? "" : s); return mode === "upper" ? s.toUpperCase() : mode === "lower" ? s.toLowerCase() : s; },
    _axTitleAttrs: function (C) {
      var a = { "font-size": (C.axisTitleSize || 11), opacity: .85 };
      if (C.axisTitleBold) a["font-weight"] = 700;
      if (C.axisTitleTrack) a["letter-spacing"] = C.axisTitleTrack + "px";
      return a;
    },
    behColor: function (b, idx, pr) {
      pr = pr || this.activePreset();
      if (pr.colors[b]) return pr.colors[b];
      var pal = pr.kind === "bw" ? P.PALETTE_GRAY : pr.kind === "cb" ? P.PALETTE_CB : P.PALETTE_COLOR;
      return pal[idx % pal.length];
    },
    patternFor: function (b, pr) { return (pr || this.activePreset()).patterns[b] || "solid"; },
    // Cor da marca do padrão (principal). Default = cor do comportamento.
    patternFgFor: function (b, bi, pr) { pr = pr || this.activePreset(); var m = pr.patternFg || {}; return (m[b] != null && m[b] !== "") ? m[b] : this.behColor(b, bi, pr); },
    // Cor de fundo do padrão (secundária). Default = null (transparente, como era).
    patternBgFor: function (b, pr) { pr = pr || this.activePreset(); var m = pr.patternBg || {}; return (m[b] != null && m[b] !== "") ? m[b] : null; },
    setBehColor: function (b, color) { this._editablePreset().colors[b] = color; this.savePresets(); },
    setBehPattern: function (b, pat) { var pr = this._editablePreset(); if (pat === "solid") delete pr.patterns[b]; else pr.patterns[b] = pat; this.savePresets(); },
    setBehPatternFg: function (b, hex) { var pr = this._editablePreset(); if (!pr.patternFg) pr.patternFg = {}; if (hex == null || hex === "") delete pr.patternFg[b]; else pr.patternFg[b] = hex; this.savePresets(); },
    setBehPatternBg: function (b, hex) { var pr = this._editablePreset(); if (!pr.patternBg) pr.patternBg = {}; if (hex == null || hex === "") delete pr.patternBg[b]; else pr.patternBg[b] = hex; this.savePresets(); },
    setOpacity: function (v) { this._editablePreset().opacity = v; this.savePresets(); },
    setRadius: function (v) { this._editablePreset().radius = v; this.savePresets(); },
    setOutline: function (patch) { var o = this._editablePreset().outline; for (var k in patch) o[k] = patch[k]; this.savePresets(); },
    setFont: function (f) { this._editablePreset().font = f; this.savePresets(); },
    // "Nova": duplica a predefinição ativa (herda cor/P&B + aparência), pronta para editar.
    addPreset: function () {
      this.ensurePresets();
      var copy = JSON.parse(JSON.stringify(this.activePreset()));
      copy.id = P.uid(); copy.builtin = false; copy.name = "Predefinição " + (this.cfg.presets.length + 1);
      this.cfg.presets.push(copy); this.cfg.activePreset = copy.id; this.savePresets(); return copy.id;
    },
    removePreset: function (id) {
      if (this.cfg.presets.length <= 1) return;
      this.cfg.presets = this.cfg.presets.filter(function (p) { return p.id !== id; });
      if (this.cfg.activePreset === id) this.cfg.activePreset = this.cfg.presets[0].id;
      this.savePresets();
    },
    renamePreset: function (id, name) { var p = this.cfg.presets.filter(function (x) { return x.id === id; })[0]; if (p) { p.name = name; this.savePresets(); } },
    // Exporta uma predefinição (aparência: kind/cores/padrões/opacidade/contorno/arredondamento/fonte) como .praxpreset,
    // para reaproveitar o MESMO visual em todos os outros projetos .praxis.
    // Monta o objeto .praxpreset (aparência) de uma predefinição, sem baixar. Usado pelo export e pelo "Salvar".
    presetPayload: function (id) {
      var p = this.presetById(id) || this.activePreset(); if (!p) return null;
      return { praxpreset: 1, name: p.name, kind: p.kind, colors: p.colors || {}, patterns: p.patterns || {},
        patternFg: p.patternFg || {}, patternBg: p.patternBg || {},
        opacity: p.opacity, radius: p.radius, outline: p.outline ? { show: p.outline.show, color: p.outline.color, width: p.outline.width } : undefined, font: p.font };
    },
    presetFileName: function (id) { var p = this.presetById(id) || this.activePreset(); return (String(p && p.name || "predefinicao").replace(/[^\w\- ]+/g, "").trim() || "predefinicao") + ".praxpreset"; },
    exportPreset: function (id) {
      var out = this.presetPayload(id); if (!out) return false;
      P.download(this.presetFileName(id), JSON.stringify(out, null, 2), "application/json;charset=utf-8");
      return true;
    },
    // Importa uma predefinição de um objeto .praxpreset: adiciona ao projeto atual (id novo), ativa e salva. Devolve o id.
    importPreset: function (obj) {
      if (!obj || typeof obj !== "object") return null;
      this.ensurePresets();
      var name = (obj.name || "Importada").toString();
      // Se já existir uma com o MESMO nome, sobrescreve a aparência dela (mantém o id); senão cria nova.
      var existing = this.cfg.presets.filter(function (x) { return x.name === name; })[0];
      var target = existing || { id: P.uid(), name: name, builtin: false };
      target.kind = obj.kind === "bw" || obj.kind === "cb" ? obj.kind : "color";
      target.colors = obj.colors && typeof obj.colors === "object" ? JSON.parse(JSON.stringify(obj.colors)) : {};
      target.patterns = obj.patterns && typeof obj.patterns === "object" ? JSON.parse(JSON.stringify(obj.patterns)) : {};
      target.patternFg = obj.patternFg && typeof obj.patternFg === "object" ? JSON.parse(JSON.stringify(obj.patternFg)) : {};
      target.patternBg = obj.patternBg && typeof obj.patternBg === "object" ? JSON.parse(JSON.stringify(obj.patternBg)) : {};
      target.builtin = false;
      if (obj.opacity != null) target.opacity = obj.opacity;
      if (obj.radius != null) target.radius = obj.radius;
      if (obj.outline) target.outline = { show: !!obj.outline.show, color: obj.outline.color || "#111111", width: obj.outline.width != null ? obj.outline.width : 1 };
      if (obj.font) target.font = obj.font;
      this._ensurePresetLook(target);
      if (!existing) this.cfg.presets.push(target);
      this.cfg.activePreset = target.id; this.savePresets();
      return target.id;
    },

    // Estilo por estágio (independente): fotografa os parâmetros de formatação atuais.
    // Estilo POR ESTÁGIO (snapshot em stg.style). NÃO inclui o estilo de rótulos/labels dos estágios e das
    // seções, que é GLOBAL (lido de cfg no render) p/ o painel atualizar todos os cards no modo dividido.
    STYLE_KEYS: ["barHeight", "rowStep", "invertY", "showGrid", "showSegLabels", "showSegTitle", "sectionColor", "sectionWidth", "sectionDash", "showSectionLabels", "showSectionTints", "sectionTintOpacity", "showStageTints", "stageTintOpacity", "showStageLines", "stageLineColor", "stageLineWidth", "stageLineDash"],
    snapshotStyle: function () {
      var s = {}, cfg = this.cfg;
      this.STYLE_KEYS.forEach(function (k) { s[k] = cfg[k]; });
      return s;   // opacidade/contorno/fonte agora vêm da predefinição, não do estilo por estágio
    },

    // Cor base (paleta colorida) - usada pelo segmentador (estável, não segue preset do GCP)
    colorFor: function (b, idx) { return P.PALETTE_COLOR[idx % P.PALETTE_COLOR.length]; },

    _patternEl: function (id, type, color, bg) {
      var p = el("pattern", { id: id, patternUnits: "userSpaceOnUse", width: 6, height: 6 });
      if (bg != null && bg !== "") p.appendChild(el("rect", { x: 0, y: 0, width: 6, height: 6, fill: bg }));   // cor secundária (fundo) do padrão
      if (type === "dots") { p.appendChild(el("circle", { cx: 3, cy: 3, r: 1.1, fill: color })); return p; }
      var dd = { diag: "M0,6 L6,0 M-1,1 L1,-1 M5,7 L7,5", diag2: "M0,0 L6,6 M-1,5 L1,7 M5,-1 L7,1", horiz: "M0,3 L6,3", vert: "M3,0 L3,6", cross: "M0,3 L6,3 M3,0 L3,6" };
      p.appendChild(el("path", { d: dd[type] || dd.diag, stroke: color, "stroke-width": 1.1, fill: "none" }));
      return p;
    },

    // === Modelo: DATASET (dado bruto) → CONJUNTO (estágios/seções compartilhados) → GRÁFICO (aba/visão) ===
    // Um dataset pode ter vários conjuntos; um conjunto agrupa gráficos que compartilham estágios/seções.
    // this.data (que o render lê) é COMPOSTO na seleção: segmentos do dataset + estágios/seções do conjunto,
    // POR REFERÊNCIA - então mexer em this.data.stages/sections mexe no conjunto e propaga p/ as abas dele.
    datasets: {}, conjuntos: {}, docs: [], activeId: null,
    _freshCfg: function () {
      var c = clone(PRISTINE_CFG);
      try { var f = localStorage.getItem("praxis.gcp.font"); if (f) c.font = f; } catch (e) {}
      return c;
    },
    // --- Construção das três camadas ---
    _buildDataset: function (data) {
      var segs = data.segments.map(function (s) { return Object.assign({}, s); });
      segs.sort(function (a, b) { if (isFinite(a.tStart) && isFinite(b.tStart)) return a.tStart - b.tStart; return (a.mStart || 0) - (b.mStart || 0); });
      var behaviors = data.behaviors && data.behaviors.length ? data.behaviors.slice() : Array.from(new Set(segs.map(function (s) { return s.behavior; }).filter(Boolean)));
      return { id: P.uid(), meta: data.meta || {}, behaviors: behaviors, legend: data.legend || {}, layers: data.layers || [], segments: segs, hasMeasures: segs.some(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); }) };
    },
    _buildConjunto: function (data, datasetId, name) {
      return {
        id: P.uid(), datasetId: datasetId, name: name || "Conjunto",
        sections: (data.sections || []).map(function (x, i) { return Object.assign({ tint: P.PALETTE_COLOR[i % P.PALETTE_COLOR.length] }, x); }),
        stages: (data.stages || (data.phases || []).map(function (p) { return { name: p.name, from: p.segFrom, to: p.segTo }; })).map(function (x, i) { return Object.assign({ tint: P.PALETTE_COLOR[i % P.PALETTE_COLOR.length] }, x); })
      };
    },
    addDataset: function (data) { var ds = this._buildDataset(data); this.datasets[ds.id] = ds; return ds.id; },
    addConjunto: function (datasetId, data, name) { var cj = this._buildConjunto(data || {}, datasetId, name); this.conjuntos[cj.id] = cj; return cj.id; },
    addGraph: function (conjuntoId, name, style) {
      var g = { id: P.uid(), name: name || "Gráfico", conjuntoId: conjuntoId, cfg: this._freshCfg() };
      if (style) g.cfg.chartStyle = style;
      this.docs.push(g); this.selectDoc(g.id); return g;
    },
    // Duplica um gráfico: mesma camada de dados/conjunto (compartilha estágios e seções, editar num reflete
    // no outro) com uma CÓPIA da cfg (visão própria - ex.: uma aba "GCP grande" e outra "estágios divididos").
    // A aba nova entra logo depois da original e fica ativa.
    duplicateGraph: function (id) {
      var src = id ? this._docById(id) : this.activeDoc(); if (!src) return null;
      var g = { id: P.uid(), name: (src.name || "Gráfico") + " (cópia)", conjuntoId: src.conjuntoId, cfg: clone(src.cfg) };
      var i = this.docs.indexOf(src);
      this.docs.splice(i < 0 ? this.docs.length : i + 1, 0, g);
      this.selectDoc(g.id);
      return g;
    },
    // Fonte nova: cria dataset + conjunto + gráfico de uma vez.
    createGraph: function (data, opts) {
      opts = opts || {};
      var dsId = this.addDataset(data);
      var cjId = this.addConjunto(dsId, data, opts.conjuntoName || "Conjunto " + (Object.keys(this.conjuntos).length));
      return this.addGraph(cjId, opts.name || (data.meta && data.meta.participant) || "Gráfico", opts.style);
    },
    activeDoc: function () { for (var i = 0; i < this.docs.length; i++) if (this.docs[i].id === this.activeId) return this.docs[i]; return null; },
    _docById: function (id) { for (var i = 0; i < this.docs.length; i++) if (this.docs[i].id === id) return this.docs[i]; return null; },
    conjuntoOf: function (g) { return g ? this.conjuntos[g.conjuntoId] : null; },
    datasetOf: function (g) { var cj = this.conjuntoOf(g); return cj ? this.datasets[cj.datasetId] : null; },
    // Compõe o objeto de dados do gráfico g (segmentos do dataset + estágios/seções do conjunto, por referência).
    _compose: function (g) {
      var cj = this.conjuntos[g.conjuntoId]; if (!cj) return null;
      var ds = this.datasets[cj.datasetId]; if (!ds) return null;
      return { meta: ds.meta, behaviors: ds.behaviors, legend: ds.legend, layers: ds.layers, segments: ds.segments, hasMeasures: ds.hasMeasures, stages: cj.stages, sections: cj.sections };
    },
    selectDoc: function (id) { var g = this._docById(id); if (!g) return null; this.activeId = id; this.cfg = g.cfg; this.data = this._compose(g); return g; },
    renameDoc: function (id, name) { var g = this._docById(id); if (g) g.name = name || g.name; },
    removeDoc: function (id) {
      var i = -1; for (var k = 0; k < this.docs.length; k++) if (this.docs[k].id === id) i = k;
      if (i < 0) return this.activeId;
      this.docs.splice(i, 1); this._gc();
      if (this.activeId === id) {
        var nxt = this.docs[i] || this.docs[i - 1] || null;
        if (nxt) this.selectDoc(nxt.id); else { this.activeId = null; this.data = null; this.cfg = this._freshCfg(); }
      }
      return this.activeId;
    },
    _gc: function () {   // remove conjuntos/datasets sem gráficos
      var self = this, useCj = {}, useDs = {};
      this.docs.forEach(function (g) { useCj[g.conjuntoId] = 1; });
      Object.keys(this.conjuntos).forEach(function (id) { if (!useCj[id]) delete self.conjuntos[id]; else useDs[self.conjuntos[id].datasetId] = 1; });
      Object.keys(this.datasets).forEach(function (id) { if (!useDs[id]) delete self.datasets[id]; });
    },
    // Atualiza os estágios/seções do conjunto ATIVO (mantém a referência compartilhada com this.data).
    setStages: function (arr) { var cj = this.conjuntoOf(this.activeDoc()); if (cj) { cj.stages = arr; if (this.data) this.data.stages = arr; } },
    setSections: function (arr) { var cj = this.conjuntoOf(this.activeDoc()); if (cj) { cj.sections = arr; if (this.data) this.data.sections = arr; } },
    // --- Vínculo entre gráficos e conjuntos ---
    unlinkGraph: function (id) {   // gráfico ganha uma CÓPIA privada do conjunto (mesmo dataset)
      var g = this._docById(id); if (!g) return; var cj = this.conjuntos[g.conjuntoId]; if (!cj) return;
      var copy = JSON.parse(JSON.stringify(cj)); copy.id = P.uid(); copy.name = (cj.name || "Conjunto") + " (cópia)";
      this.conjuntos[copy.id] = copy; g.conjuntoId = copy.id; this._gc();
      if (id === this.activeId) this.data = this._compose(g);
    },
    linkGraph: function (id, conjuntoId) {   // passa a compartilhar um conjunto existente
      var g = this._docById(id); if (!g || !this.conjuntos[conjuntoId]) return;
      g.conjuntoId = conjuntoId; this._gc();
      if (id === this.activeId) this.data = this._compose(g);
    },
    conjuntosForDataset: function (datasetId) { var self = this; return Object.keys(this.conjuntos).filter(function (id) { return self.conjuntos[id].datasetId === datasetId; }).map(function (id) { return self.conjuntos[id]; }); },
    graphsInConjunto: function (cjId) { return this.docs.filter(function (g) { return g.conjuntoId === cjId; }); },

    // Chaves de cfg persistidas no .praxis (formatação + eixos + toggles + fonte).
    PERSIST_CFG: ["chartStyle", "heatGroupBy", "heatMetric", "splitByStage", "invertY", "xToBottom", "rowStep", "barHeight", "opacity", "showGrid",
      "showLegend", "legendPos", "legendSize", "legendSwatch", "legendLabels", "legendOnlyUsed", "legendOffX", "legendOffY",
      "showScore", "scorePos", "scoreHeight", "scoreScale", "scoreStaff", "scoreMnum", "scoreGap",
      "axisMMin", "axisMMax", "axisTickStep", "axisLabelStep", "gridTarget", "showXLabels", "showSegLabels",
      "showSectionLabels", "sectionColor", "sectionWidth", "sectionDash", "showSectionTints",
      "sectionTintOpacity", "showStageTints", "stageTintOpacity", "showStageLines", "stageLineColor", "stageLineWidth", "stageLineDash", "legendOutline", "exportDpi", "font", "activePreset",
      "colView", "colCount", "colGap", "colAuto", "colFit", "colAxisMode", "colSingleAxis", "colEffScale", "showSegTitle",
      "xTitle", "yTitle", "axisTitleSize", "axisTitleTrack", "axisTitleBold", "axisTitleCase", "axisTitleColor", "axisTitleGap", "axisYLabelStep", "showStageLabels", "stageLabelColor", "stageLabelSize", "stageLabelInside", "stageLabelVertical", "stageLabelSide", "stageLabelAlign", "stageLabelTrack", "stageLabelCase", "stageLabelBold", "stageLabelItalic", "stageLabelOffset", "stageLabelHalo", "sectionLinesBehind", "sectionLabelColor", "sectionLabelSize"],
    _applyCfg: function (cf) {
      if (!cf) return;
      var cfg = this.cfg;
      this.PERSIST_CFG.forEach(function (k) { if (cf[k] !== undefined) cfg[k] = cf[k]; });
      if (cf.colAxisMode === undefined && cf.colPerAxis !== undefined) cfg.colAxisMode = cf.colPerAxis ? "own" : "proportional";   // compat
      if (cf.outline) cfg.outline = { show: cf.outline.show, color: cf.outline.color, width: cf.outline.width };
      if (cf.presets && cf.presets.length) cfg.presets = cf.presets;
    },
    // --- Persistência no .praxis (v3: datasets + conjuntos + gráficos) --------------------
    _pickCfg: function (cfg) {
      var pick = {};
      this.PERSIST_CFG.forEach(function (k) { pick[k] = cfg[k]; });
      pick.outline = { show: cfg.outline.show, color: cfg.outline.color, width: cfg.outline.width };
      if (cfg.presets) pick.presets = cfg.presets;
      return pick;
    },
    serialize: function () {
      if (!this.docs.length) return null;
      var self = this;
      return {
        v: 3, activeId: this.activeId,
        datasets: Object.keys(this.datasets).map(function (id) { var d = self.datasets[id]; return { id: id, meta: d.meta, behaviors: d.behaviors, legend: d.legend, layers: d.layers, segments: d.segments }; }),
        conjuntos: Object.keys(this.conjuntos).map(function (id) { var c = self.conjuntos[id]; return { id: id, datasetId: c.datasetId, name: c.name, stages: c.stages, sections: c.sections }; }),
        graphs: this.docs.map(function (g) { return { id: g.id, name: g.name, conjuntoId: g.conjuntoId, cfg: self._pickCfg(g.cfg) }; })
      };
    },
    // Reabre o estado salvo (v3). Versões antigas são ignoradas (regerar do zero).
    restore: function (state) {
      this.datasets = {}; this.conjuntos = {}; this.docs = []; this.activeId = null; this.data = null; this.cfg = this._freshCfg();
      if (!state || state.v !== 3 || !state.graphs) return;
      var self = this;
      (state.datasets || []).forEach(function (d) { var ds = self._buildDataset(d); ds.id = d.id; self.datasets[d.id] = ds; });
      (state.conjuntos || []).forEach(function (c) { var cj = self._buildConjunto(c, c.datasetId, c.name); cj.id = c.id; self.conjuntos[c.id] = cj; });
      (state.graphs || []).forEach(function (g) { var gr = { id: g.id, name: g.name, conjuntoId: g.conjuntoId, cfg: self._freshCfg() }; if (g.cfg) { self.cfg = gr.cfg; self._applyCfg(g.cfg); } self.docs.push(gr); });
      this.selectDoc(state.activeId || (this.docs[0] && this.docs[0].id));
    },
    // Importa UM gráfico (dataset + conjunto + visão) do gcp de OUTRO projeto (state v3) para este projeto.
    importFromProject: function (gcp) {
      if (!gcp || gcp.v !== 3 || !gcp.graphs || !gcp.graphs.length) return false;
      var src = gcp.graphs.filter(function (g) { return g.id === gcp.activeId; })[0] || gcp.graphs[0];
      var srcCj = (gcp.conjuntos || []).filter(function (c) { return c.id === src.conjuntoId; })[0];
      if (!srcCj) return false;
      var srcDs = (gcp.datasets || []).filter(function (d) { return d.id === srcCj.datasetId; })[0];
      if (!srcDs || !srcDs.segments || !srcDs.segments.length) return false;
      var dsId = this.addDataset(srcDs);
      var cjId = this.addConjunto(dsId, srcCj, srcCj.name);
      var g = this.addGraph(cjId, src.name || "Importado");
      if (src.cfg) { this.cfg = g.cfg; this._applyCfg(src.cfg); }
      return true;
    },

    render: function (host, opts) {
      opts = opts || {};
      var target = host || this.host;
      if (!opts.isSub && host) this.host = host;
      if (!target || !this.data) return;
      this.loadFont();
      var d = this.data, cfg = this.cfg, self = this;
      if (cfg.chartStyle === "heatmap") return this._renderHeatmap(target, opts);
      var C = opts.style || cfg;   // estilo por estágio (ou global)
      var pr = opts.preset || this.activePreset();
      var behIdx = {}; d.behaviors.forEach(function (b, i) { behIdx[b] = i; });
      var all = d.segments.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); });
      var segNums = [], segs = [];   // segNums[i] = número GLOBAL do segmento (segue o GCP maior)
      all.forEach(function (s, gi) {
        if (opts.range && !((gi + 1) >= opts.range.from && (gi + 1) <= opts.range.to)) return;
        segs.push(s); segNums.push(gi + 1);
      });
      var N = segs.length;

      var W = opts.width || Math.max(680, target.clientWidth - 4);   // colunas passam largura fixa
      // Margem direita: só reserva espaço quando a legenda fica NA MARGEM (à direita); senão fica justa
      // (sem margem sobrando, p/ o gráfico sair direto pro Word). Largura da legenda estimada pelos rótulos.
      var legOnRight = cfg.showLegend && (cfg.legendPos || "right") === "right" && !opts.compact && d.behaviors.length;
      var legMarginW = 0;
      if (legOnRight) {
        var _lfs = cfg.legendSize || 10, _lsw = cfg.legendSwatch || 12, _custom = cfg.legendLabels || {}, _maxC = 0;
        d.behaviors.forEach(function (b) { var nm = (d.legend && d.legend[b]) ? d.legend[b] : ""; var lbl = (_custom[b] != null && String(_custom[b]).trim() !== "") ? _custom[b] : (b + (nm ? " · " + nm : "")); _maxC = Math.max(_maxC, String(lbl).length); });
        legMarginW = _lsw + 6 + Math.ceil(_maxC * _lfs * 0.56) + 24;
      }
      // Margens dos eixos. A distância título↔rótulos (grade) é configurável (cfg.axisTitleGap),
      // então a margem inferior (eixo X embaixo) e a esquerda (título Y) encolhem/crescem com ela.
      var _ats = cfg.axisTitleSize || 11;
      var _atGap = cfg.axisTitleGap != null ? cfg.axisTitleGap : 15;
      var _willXTop = C.invertY && !cfg.xToBottom;
      var _yTitleX = (C.showSegLabels && C.showSegTitle) ? Math.round(_ats * 0.55 + 3) : 13;   // x do título vertical (Y)
      var M = {
        l: !C.showSegLabels ? 16 : (C.showSegTitle ? (_ats + _atGap + 28) : 36),
        r: opts.compact ? 8 : (legOnRight ? legMarginW : 16),
        t: 44,
        b: _willXTop ? 24 : (16 + _atGap + _ats + 4)
      };
      // "Caber na altura" (colunas): a altura por segmento se adapta p/ a coluna preencher a tela (opts.rowStep).
      var rowStep = opts.rowStep || C.rowStep;
      var barH = opts.rowStep ? Math.min(C.barHeight, Math.max(1, rowStep)) : C.barHeight;   // não deixa a barra maior que a linha
      var plotH = Math.max(opts.rowStep ? 80 : 120, N * rowStep);
      var H = M.t + plotH + M.b, pw = Math.max(1, W - M.l - M.r);

      // Faixa de compassos AUTOMÁTICA. No gráfico inteiro, usa TODO o conjunto (+ fronteiras de seção)
      // para o eixo ir do 1º ao último compasso das transcrições. Num sub-GCP de ESTÁGIO (opts.range),
      // recalcula min/máx só dos segmentos DAQUELE estágio, para o eixo abraçar a extensão do estágio
      // (ignora ocultos p/ não reescalar ao esconder um comportamento).
      // sharedAxis (modo colunas) mantém a mesma escala de compasso em todas as colunas.
      // Eixo: sub-GCP com eixo próprio → só os segmentos do range; colunas proporcionais de um ESTÁGIO
      // (sharedAxisRange) → compartilham o eixo do estágio; senão (proporcional do todo) → peça inteira.
      var axisSrc;
      if (opts.range && !opts.sharedAxis) axisSrc = all.filter(function (s, gi) { return (gi + 1) >= opts.range.from && (gi + 1) <= opts.range.to; });
      else if (opts.sharedAxis && opts.sharedAxisRange) axisSrc = all.filter(function (s, gi) { return (gi + 1) >= opts.sharedAxisRange.from && (gi + 1) <= opts.sharedAxisRange.to; });
      else axisSrc = d.segments;
      var gMin = Infinity, gMax = -Infinity;
      axisSrc.forEach(function (s) {
        if (isFinite(s.mStart)) { gMin = Math.min(gMin, s.mStart); gMax = Math.max(gMax, s.mStart); }
        if (isFinite(s.mEnd)) { gMin = Math.min(gMin, s.mEnd); gMax = Math.max(gMax, s.mEnd); }
      });
      if (!opts.range) (d.sections || []).forEach(function (sec) { if (isFinite(sec.measure)) { gMin = Math.min(gMin, sec.measure); gMax = Math.max(gMax, sec.measure); } });
      if (!isFinite(gMin)) { gMin = 0; gMax = 1; }
      // Eixo de compasso. Cada ponta pode ser FIXADA pelo usuário (painel Eixos); a que não for fica AUTOMÁTICA.
      // Passo dos ticks: 1 por padrão (uma marca por compasso); o campo "Passo dos ticks" sobrescreve.
      // OBS: isFinite(null) é true (null→0), então checar != null antes (senão o "auto" vira 0).
      var manMin = cfg.axisMMin != null && isFinite(cfg.axisMMin), manMax = cfg.axisMMax != null && isFinite(cfg.axisMMax);
      var stepM = (cfg.axisTickStep > 0) ? cfg.axisTickStep : 1;
      var mMin = manMin ? cfg.axisMMin : Math.floor(gMin / stepM) * stepM;   // encaixa a borda no passo (só no automático)
      var mMax = manMax ? cfg.axisMMax : Math.ceil(gMax / stepM) * stepM;
      if (!(mMax > mMin)) mMax = mMin + stepM;                                // evita divisão por zero / eixo invertido
      if ((mMax - mMin) / stepM > 500) stepM = niceStep(mMax - mMin, cfg.gridTarget || 10);  // trava: passo minúsculo p/ faixa enorme
      // Modo "colunas eficientes": largura proporcional à faixa usada (mesma escala px/compasso p/ todas).
      if (opts.pxPerUnit) { pw = Math.max(24, (mMax - mMin) * opts.pxPerUnit); W = M.l + pw + M.r; }
      var xOf = function (m) { return M.l + (m - mMin) / (mMax - mMin) * pw; };
      // Rótulos numéricos do eixo X afinados p/ não colidir (a grade e as marcas seguem o passo).
      var xTicks = Math.max(1, Math.round((mMax - mMin) / stepM));
      var xLabelEvery = Math.max(1, Math.ceil(34 / (pw / xTicks)));
      // Orientação: por padrão o segmento 1 fica EMBAIXO (Y cresce p/ cima) e o eixo X fica embaixo - os dois
      // partem do canto inferior esquerdo. "Inverter" (C.invertY) traz o Y de cima p/ baixo (seg. 1 no topo);
      // aí o eixo X sobe p/ o topo, salvo "Mover eixo X para baixo" (cfg.xToBottom).
      var invY = C.invertY, xTop = invY && !cfg.xToBottom;
      var yOf = function (i) { return M.t + (invY ? i : (N - 1 - i)) * rowStep + rowStep / 2; };

      var isBW = pr.kind === "bw";
      var light = document.documentElement.getAttribute("data-theme") === "light";
      var bg = isBW ? "#ffffff" : (light ? "#ffffff" : "#12161c");
      var fg = isBW ? "#111111" : (light ? "#16202b" : "#e7edf3");
      var gridc = isBW ? "#dddddd" : "rgba(140,160,180,.18)";

      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, xmlns: SVGNS, "font-family": pr.font || cfg.font });
      svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: bg, rx: 8 }));

      // defs: padrões (hachuras) dos comportamentos que usam padrão no preset ativo.
      // Ids de padrão têm namespace ÚNICO por render: no SVG a referência fill="url(#id)" é
      // global no documento, então vários GCPs na página (estágios/comparar/export/SegGCP)
      // colidiriam nos ids "pat-N" e uma barra pegaria o padrão do svg errado (ou vazio = branca).
      var patNS = "pat-" + (self._patSeq = (self._patSeq || 0) + 1) + "-";
      var defs = el("defs");
      d.behaviors.forEach(function (b, bi) {
        var pt = self.patternFor(b, pr);
        if (pt !== "solid") defs.appendChild(self._patternEl(patNS + bi, pt, self.patternFgFor(b, bi, pr), self.patternBgFor(b, pr)));
      });
      svg.appendChild(defs);

      // tintas de seção (bandas de fundo entre fronteiras)
      if (C.showSectionTints && d.sections && d.sections.length) {
        var secsSorted = d.sections.slice().sort(function (a, b) { return a.measure - b.measure; });
        secsSorted.forEach(function (sec, si) {
          if (!isFinite(sec.measure)) return;
          var lo = M.l, hi = M.l + pw;
          var bx0 = Math.max(lo, Math.min(hi, xOf(sec.measure))), nxt = secsSorted[si + 1];
          var bx1 = nxt && isFinite(nxt.measure) ? Math.max(lo, Math.min(hi, xOf(nxt.measure))) : hi;   // recorta ao plot (estágio estreito)
          if (bx1 <= bx0) return;
          svg.appendChild(el("rect", { x: bx0, y: M.t, width: bx1 - bx0, height: plotH, fill: sec.tint || "#8899aa", opacity: C.sectionTintOpacity }));
        });
      }

      // tintas de estágio (bandas horizontais por faixa de segmentos; no sub-GCP, fundo inteiro)
      if (C.showStageTints && d.stages && d.stages.length) {
        if (opts.range && opts.stageTint) {
          // sub-GCP de UM estágio (split): fundo inteiro com o tom do estágio
          svg.appendChild(el("rect", { x: M.l, y: M.t, width: pw, height: plotH, fill: opts.stageTint, opacity: C.stageTintOpacity }));
        } else {
          // bandas por faixa de segmentos. Em coluna (opts.range) mapeia p/ os índices LOCAIS desta coluna.
          var stFirst = opts.range ? opts.range.from : 1;
          d.stages.forEach(function (stg) {
            var loL = (stg.from || 1) - stFirst, hiL = (stg.to || N) - stFirst;
            loL = Math.max(0, loL); hiL = Math.min(N - 1, hiL);
            if (hiL < 0 || loL > N - 1 || hiL < loL) return;   // estágio fora desta coluna
            var a = yOf(loL), b = yOf(hiL);
            var y0 = Math.max(M.t, Math.min(a, b) - rowStep / 2), hh = Math.abs(b - a) + rowStep;
            if (hh <= 0) return;
            svg.appendChild(el("rect", { x: M.l, y: y0, width: pw, height: Math.min(M.t + plotH - y0, hh), fill: stg.tint || "#8899aa", opacity: C.stageTintOpacity }));
          });
        }
      }
      // linhas tracejadas nas fronteiras entre estágios (independente das tintas; não no sub-GCP de 1 estágio)
      if (C.showStageLines && d.stages && d.stages.length > 1 && !(opts.range && opts.stageTint) && N > 1) {
        var stFirstL = opts.range ? opts.range.from : 1;
        d.stages.forEach(function (stg) {
          var hiL = (stg.to || N) - stFirstL;   // índice LOCAL 0-based do último segmento do estágio
          if (hiL < 0 || hiL >= N - 1) return;   // sem fronteira (último segmento ou fora desta coluna)
          var yb = (yOf(hiL) + yOf(hiL + 1)) / 2;
          svg.appendChild(el("line", { x1: M.l, y1: yb, x2: M.l + pw, y2: yb, stroke: C.stageLineColor || fg, "stroke-width": (C.stageLineWidth != null ? C.stageLineWidth : 1.4), "stroke-dasharray": (C.stageLineDash != null ? C.stageLineDash : "5 4"), opacity: 0.85 }));
        });
      }

      // grade vertical (compassos): o passo (stepM) e as bordas já foram resolvidos acima (auto encaixado no passo).
      if (C.showGrid) {
        for (var m = Math.ceil(mMin / stepM) * stepM; m <= mMax; m += stepM) {
          svg.appendChild(el("line", { x1: xOf(m), y1: M.t, x2: xOf(m), y2: M.t + plotH, stroke: gridc }));
        }
      }

      // traço das seções ATRÁS das barras (opcional): grupo inserido antes das barras p/ ficar por baixo na pintura SVG
      var secLinesHost = cfg.sectionLinesBehind ? svg.appendChild(el("g", { "class": "gcp-seclines-behind" })) : null;

      // barras dos segmentos
      segs.forEach(function (s, i) {
        var bi = behIdx[s.behavior] || 0;
        var color = self.behColor(s.behavior, bi, pr), pat = self.patternFor(s.behavior, pr);
        var x0 = xOf(Math.min(s.mStart, s.mEnd)), x1 = xOf(Math.max(s.mStart, s.mEnd));
        var y = yOf(i) - barH / 2;
        var barOp = (pr.opacity != null) ? pr.opacity : C.opacity;
        var ol = pr.outline || C.outline;
        var brad = (pr.radius != null) ? pr.radius : 1.5;
        var r = el("rect", { x: x0, y: y, width: Math.max(1.5, x1 - x0), height: barH, fill: pat === "solid" ? color : "url(#" + patNS + bi + ")", opacity: barOp, rx: brad, ry: brad, "data-seg": segNums[i] });
        if (ol && ol.show) { r.setAttribute("stroke", ol.color || fg); r.setAttribute("stroke-width", ol.width); }
        else if (pat !== "solid") { r.setAttribute("stroke", fg); r.setAttribute("stroke-width", 0.6); }  // contorno de contraste p/ a barra com padrão sempre ler
        r.style.cursor = "pointer";
        r.addEventListener("mousemove", function (ev) { self.showTip(ev, s, segNums[i]); });
        r.addEventListener("mouseleave", function () { self.hideTip(); });
        // clicar num segmento leva a reprodução para o início dele (fora do modo blade, que usa o clique para dividir)
        if (!self.bladeMode && isFinite(s.tStart)) {
          r.addEventListener("click", function () { if (P.Segmenter.media) { P.Segmenter.seekTo(s.tStart); self.hideTip(); } });
        }
        svg.appendChild(r);
      });

      // rótulos dos estágios (nome ou "Estágio N"), por cima das barras. ESTILO é GLOBAL (cfg), não por-estágio,
      // p/ o painel Estágios atualizar todos os cards no modo dividido (o texto/label continua por-estágio).
      if (cfg.showStageLabels && d.stages && d.stages.length && N) {
        var stFirstLab = opts.range ? opts.range.from : 1;
        var slCol = cfg.stageLabelColor || fg, slSize = cfg.stageLabelSize || 11;
        var slVert = !!cfg.stageLabelVertical, slInside = cfg.stageLabelInside !== false;
        var slOff = cfg.stageLabelOffset || 0;
        d.stages.forEach(function (stg, si) {
          var loL = (stg.from || 1) - stFirstLab, hiL = (stg.to || N) - stFirstLab;
          loL = Math.max(0, loL); hiL = Math.min(N - 1, hiL);
          if (hiL < 0 || loL > N - 1 || hiL < loL) return;   // estágio fora desta coluna/faixa
          var yA = yOf(loL), yB = yOf(hiL), yMid = (yA + yB) / 2;
          // rótulo do GRÁFICO: label (se personalizado) → nome → "Estágio N". O nome (dado) fica intacto p/ o resumo.
          var txt = self._axCase((stg.label != null && stg.label !== "") ? stg.label : (stg.name || ("Estágio " + (si + 1))), cfg.stageLabelCase);
          var att = { fill: slCol, "font-size": slSize, "font-weight": (cfg.stageLabelBold !== false ? 700 : 400), "class": "gcp-stagelab" };
          if (cfg.stageLabelItalic) att["font-style"] = "italic";
          if (cfg.stageLabelTrack) att["letter-spacing"] = cfg.stageLabelTrack + "px";
          if (cfg.stageLabelHalo !== false) { att.stroke = bg; att["stroke-width"] = Math.max(2, slSize * 0.3); att["stroke-linejoin"] = "round"; att["paint-order"] = "stroke"; }   // halo p/ ler sobre as barras
          var right = (cfg.stageLabelSide === "right"), alignB = (cfg.stageLabelAlign === "boundary");
          // "boundary" = COMEÇO do estágio (1º segmento = loL), sempre dentro do gráfico; "center" = meio da faixa
          var refY = alignB ? yOf(loL) : yMid;
          if (slVert) {
            var vx = (right ? (slInside ? (M.l + pw - 2) : (M.l + pw + slSize)) : (slInside ? (M.l + slSize + 2) : Math.max(slSize, 10))) + slOff;
            att.x = vx; att.y = refY; att["text-anchor"] = "middle";
            att.transform = "rotate(-90 " + vx + " " + refY + ")";
          } else {
            att.x = (right ? (slInside ? (M.l + pw - 5) : (M.l + pw + 6)) : (slInside ? (M.l + 5) : (M.l - 6))) + slOff;
            att["text-anchor"] = right ? (slInside ? "end" : "start") : (slInside ? "start" : "end");
            att.y = refY + slSize / 3;
          }
          var lab = el("text", att); lab.textContent = txt; svg.appendChild(lab);
        });
      }

      // eixo Y - numeração dos segmentos (intervalo manual em segmentos, ou automático p/ não colidir)
      if (C.showSegLabels && N) {
        var every = (cfg.axisYLabelStep > 0) ? Math.max(1, Math.round(cfg.axisYLabelStep)) : Math.max(1, Math.ceil(N / 26));
        for (var i2 = 0; i2 < N; i2 += every) {
          var t = el("text", { x: M.l - 8, y: yOf(i2) + 3, fill: fg, "font-size": 10, "text-anchor": "end", opacity: .7, "class": "gcp-ylab" });
          t.textContent = segNums[i2];   // numeração global (do GCP maior)
          svg.appendChild(t);
        }
      }
      // eixo X - compassos (marcas + rótulos numéricos, alternáveis). Topo ou base conforme a orientação.
      var xTickY1 = xTop ? M.t : (M.t + plotH), xTickY2 = xTop ? (M.t - 4) : (M.t + plotH + 4), xLabY = xTop ? (M.t - 8) : (M.t + plotH + 16);
      if (cfg.showXLabels) {
        // Intervalo dos rótulos: manual (em compassos) ou automático (afinado p/ não colidir).
        // Sempre ANCORADO no início do eixo (mMin), então o "1" aparece independentemente do intervalo.
        var labStep = (cfg.axisLabelStep > 0) ? cfg.axisLabelStep : stepM * xLabelEvery;
        if (!(labStep > 0)) labStep = stepM;
        // Âncora dos rótulos: no mMin (assim o "1" aparece) quando o eixo começa num compasso INTEIRO;
        // se mMin for fracionário (fitX do módulo cola o eixo no meio de um compasso), ancora no próximo inteiro p/ os rótulos ficarem em compassos cheios, alinhados à grade.
        var mmStart = (Math.abs(mMin - Math.round(mMin)) < 1e-6) ? mMin : Math.ceil(mMin - 1e-6);
        for (var mm = mmStart; mm <= mMax + 1e-9; mm += labStep) {
          svg.appendChild(el("line", { x1: xOf(mm), y1: xTickY1, x2: xOf(mm), y2: xTickY2, stroke: fg, opacity: .5, "class": "gcp-xlab" }));
          var anch = (mm <= mMin + 1e-6) ? "start" : (mm >= mMax - 1e-6 ? "end" : "middle");   // pontas ancoradas p/ não vazar (colunas coladas)
          var lt = el("text", { x: xOf(mm), y: xLabY, fill: fg, "font-size": 10, "text-anchor": anch, opacity: .7, "class": "gcp-xlab" });
          lt.textContent = Math.round(mm);
          svg.appendChild(lt);
        }
      }
      // títulos dos eixos: formatação/texto são GLOBAIS (cfg); opts.noAxisTitles suprime (colunas c/ título único)
      var _atCol = cfg.axisTitleColor || fg, _ta = self._axTitleAttrs(cfg), _k;
      if (!opts.noAxisTitles) {
        var _xatt = { x: M.l + pw / 2, y: xTop ? 12 : (H - 4), fill: _atCol, "text-anchor": "middle" };
        for (_k in _ta) _xatt[_k] = _ta[_k];
        var xl = el("text", _xatt);
        xl.textContent = self._axCase(cfg.xTitle != null ? cfg.xTitle : "Compasso", cfg.axisTitleCase); svg.appendChild(xl);
      }
      if (C.showSegTitle && C.showSegLabels && !opts.noAxisTitles) {
        var _yatt = { x: _yTitleX, y: M.t + plotH / 2, fill: _atCol, "text-anchor": "middle", transform: "rotate(-90 " + _yTitleX + " " + (M.t + plotH / 2) + ")" };
        for (_k in _ta) _yatt[_k] = _ta[_k];
        var yl = el("text", _yatt);
        yl.textContent = self._axCase(cfg.yTitle != null ? cfg.yTitle : "Segmento de prática", cfg.axisTitleCase); svg.appendChild(yl);
      }

      // fronteiras de seção (linhas verticais em compassos)
      (d.sections || []).forEach(function (sec) {
        if (!isFinite(sec.measure) || sec.measure < mMin || sec.measure > mMax) return;   // fora do eixo (ex.: estágio estreito)
        var x = xOf(sec.measure);
        (secLinesHost || svg).appendChild(el("line", { x1: x, y1: M.t, x2: x, y2: M.t + plotH, stroke: C.sectionColor || fg, "stroke-width": C.sectionWidth, "stroke-dasharray": C.sectionDash, opacity: .8 }));
        if (C.showSectionLabels && sec.name) {
          var st = el("text", { x: x, y: xTop ? (M.t + plotH + 16) : (M.t - 6), fill: cfg.sectionLabelColor || C.sectionColor || fg, "font-size": (cfg.sectionLabelSize || 11), "text-anchor": "middle", "font-weight": 600, "class": "gcp-xlab gcp-seclab" });
          st.textContent = sec.name; svg.appendChild(st);
        }
      });

      svg.appendChild(el("rect", { x: M.l, y: M.t, width: pw, height: plotH, fill: "none", stroke: gridc }));

      // Modo blade: clicar no gráfico devolve o nº do segmento clicado (divide estágios por clique).
      if (this.bladeMode && N) {
        svg.style.cursor = "crosshair";
        svg.addEventListener("click", function (ev) {
          var ctm = svg.getScreenCTM(); if (!ctm) return;
          var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
          var loc = pt.matrixTransform(ctm.inverse());
          var p = Math.round((loc.y - M.t - rowStep / 2) / rowStep);
          var i = C.invertY ? p : (N - 1 - p);   // p = linha visual do topo; yOf mapeia (invY? i : N-1-i), então inverte-se assim (mesma fórmula do arrasto de fronteira). Estava trocado → clicar no seg 23 caía no N-23.
          i = Math.max(0, Math.min(N - 1, i));
          if (self._onBladeSplit) self._onBladeSplit(segNums[i]);
        });
      }

      // Alças de arrasto das fronteiras de estágio (aparecem quando as tintas de estágio estão visíveis = editando).
      if (opts.editable && C.showStageTints && d.stages && d.stages.length > 1 && N) {
        var hFirst = opts.range ? opts.range.from : 1;   // nº GLOBAL do 1º segmento desta coluna
        var stgs = d.stages.slice().sort(function (a, b) { return a.from - b.from; });
        for (var sbi = 0; sbi < stgs.length - 1; sbi++) {
          (function (upper, lower) {
            var seg = lower.from, i1 = (seg - 1) - hFirst, i2 = seg - hFirst;   // linhas LOCAIS desta coluna
            if (i1 < 0 || i2 > N - 1) return;   // fronteira não cai nesta coluna
            var yE = (yOf(i1) + yOf(i2)) / 2;
            svg.appendChild(el("line", { x1: M.l, y1: yE, x2: M.l + pw, y2: yE, stroke: "#5ab7ff", "stroke-width": 1.6, "stroke-dasharray": "2 3", opacity: .9 }));
            var hit = el("rect", { x: M.l, y: yE - 5, width: pw, height: 10, fill: "transparent" });
            hit.style.cursor = "row-resize";
            hit.addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation(); self._dragBoundary(svg, ev, upper, lower, { N: N, Mt: M.t, Ml: M.l, pw: pw, rowStep: rowStep, invY: invY, yOf: yOf, first: hFirst }); });
            svg.appendChild(hit);
          })(stgs[sbi], stgs[sbi + 1]);
        }
      }

      // Legenda dos comportamentos (opcional): quadradinho de cor/padrão + código · nome.
      // Em colunas (compact) a legenda é desenhada UMA vez, só na coluna marcada com opts.forceLegend.
      if (cfg.showLegend && d.behaviors.length && (!opts.compact || opts.forceLegend)) {
        var lfs = cfg.legendSize || 10, lsw = cfg.legendSwatch || 12, lrad = (pr.radius != null ? pr.radius : 1.5);
        var rowH = Math.max(lsw, lfs) + 5;
        var custom = cfg.legendLabels || {};
        var items = d.behaviors.map(function (b, bi) {
          var nm = (d.legend && d.legend[b]) ? d.legend[b] : "";
          var lbl = (custom[b] != null && String(custom[b]).trim() !== "") ? custom[b] : (b + (nm ? " · " + nm : ""));
          return { label: lbl, color: self.behColor(b, bi, pr), pat: self.patternFor(b, pr), bi: bi, b: b };
        });
        // "só comportamentos usados": mostra apenas os que aparecem nos segmentos VISÍVEIS. Em colunas, a legenda
        // fica numa coluna só, mas o filtro considera TODAS as colunas (opts.legendUsedAll), não só a coluna anfitriã.
        if (cfg.legendOnlyUsed) {
          var used = {}, usedSrc = opts.legendUsedAll || segs;
          usedSrc.forEach(function (s) { used[s.behavior] = 1; });
          items = items.filter(function (it) { return used[it.b]; });
        }
        if (items.length) {   // só desenha se sobrou algum item (evita caixa vazia com o filtro "só usados")
        var maxChars = items.reduce(function (m, it) { return Math.max(m, it.label.length); }, 0);
        var boxW = lsw + 6 + Math.ceil(maxChars * lfs * 0.56) + 12, boxH = items.length * rowH + 8;
        var pos = cfg.legendPos || "right", lx, ly, drawBg = true;
        if (opts.compact && pos === "right") pos = "top-right";   // coluna estreita não reserva margem à direita → canto sobreposto
        if (pos === "right") { lx = M.l + pw + 12; ly = M.t; drawBg = false; }
        else if (pos === "top-left") { lx = M.l + 8; ly = M.t + 8; }
        else if (pos === "top-right") { lx = M.l + pw - boxW - 8; ly = M.t + 8; }
        else if (pos === "bottom-left") { lx = M.l + 8; ly = M.t + plotH - boxH - 8; }
        else { lx = M.l + pw - boxW - 8; ly = M.t + plotH - boxH - 8; }
        lx += (cfg.legendOffX || 0); ly += (cfg.legendOffY || 0);   // ajuste fino da posição do bloco da legenda
        var lg = el("g", {});
        if (drawBg) lg.appendChild(el("rect", { x: lx - 8, y: ly - 6, width: boxW, height: boxH, fill: bg, opacity: 0.86, stroke: gridc, rx: 6 }));
        items.forEach(function (it, k) {
          var yy = ly + k * rowH;
          var sw = el("rect", { x: lx, y: yy, width: lsw, height: lsw, fill: it.pat === "solid" ? it.color : "url(#" + patNS + it.bi + ")", rx: Math.min(lrad, lsw / 2), ry: Math.min(lrad, lsw / 2) });
          if (cfg.legendOutline) { sw.setAttribute("stroke", "#000000"); sw.setAttribute("stroke-width", 1.4); sw.setAttribute("stroke-opacity", 1); }
          else if (it.pat !== "solid") { sw.setAttribute("stroke", it.color); sw.setAttribute("stroke-width", 0.6); }
          lg.appendChild(sw);
          var tx = el("text", { x: lx + lsw + 6, y: yy + lsw - 2, fill: fg, "font-size": lfs });
          tx.textContent = it.label; lg.appendChild(tx);
        });
        svg.appendChild(lg);
        }
      }

      // Geometria do eixo de compasso, para alinhar a faixa de partitura (scorestrip.js) ao GCP.
      svg.__geom = { Ml: M.l, pw: pw, mMin: mMin, mMax: mMax, top: M.t, plotH: plotH, W: W, H: H, bg: bg, fg: fg, xTop: xTop };

      target.innerHTML = ""; target.appendChild(svg);
      if (!opts.isSub) { this.svg = svg; this._dims = { W: W, H: H, bg: bg }; }
      return svg;
    },

    // Arrasto de uma fronteira de estágio: move o fim do estágio de cima e o início do de baixo juntos.
    _dragBoundary: function (svg, ev0, upper, lower, ctx) {
      var self = this;
      var prev = el("line", { x1: ctx.Ml, x2: ctx.Ml + ctx.pw, y1: 0, y2: 0, stroke: "#5ab7ff", "stroke-width": 2, opacity: .95 });
      svg.appendChild(prev);
      var curSeg = lower.from;
      function segAt(clientY) {
        var ctm = svg.getScreenCTM(); if (!ctm) return curSeg;
        var pt = svg.createSVGPoint(); pt.x = 0; pt.y = clientY;
        var loc = pt.matrixTransform(ctm.inverse());
        var p = Math.round((loc.y - ctx.Mt - ctx.rowStep / 2) / ctx.rowStep);
        var i = ctx.invY ? p : (ctx.N - 1 - p);
        return Math.max(0, Math.min(ctx.N - 1, i)) + (ctx.first || 1);   // segNum GLOBAL = local + 1º da coluna
      }
      function yEdge(seg) { var f = ctx.first || 1; return (ctx.yOf(seg - 1 - f) + ctx.yOf(seg - f)) / 2; }
      function onMove(e) {
        var seg = Math.max(upper.from + 1, Math.min(lower.to, segAt(e.clientY)));
        curSeg = seg; var y = yEdge(seg); prev.setAttribute("y1", y); prev.setAttribute("y2", y);
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        upper.to = curSeg - 1; lower.from = curSeg;
        if (self._onStagesChange) self._onStagesChange();
      }
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      onMove(ev0);
    },

    // --- HEATMAP (estilo alternativo): densidade de prática por compasso × grupo ------------
    // Monta as linhas do heatmap conforme o agrupamento do eixo Y.
    _heatRows: function (groupBy, all, d) {
      var self = this, rows = [];
      if (groupBy === "behavior") {
        d.behaviors.forEach(function (b, i) {
          var segs = all.filter(function (s) { return s.behavior === b; });
          if (!segs.length) return;
          var nm = d.legend && d.legend[b] ? d.legend[b] : "";
          rows.push({ label: b + (nm ? " · " + nm : ""), segs: segs, color: self.behColor(b, i) });
        });
      } else if (groupBy === "time") {
        var N = all.length, nb = Math.min(8, Math.max(1, N));
        var per = Math.ceil(N / nb);
        for (var c = 0; c < nb; c++) {
          var slice = all.slice(c * per, (c + 1) * per);
          if (!slice.length) break;
          var t0 = slice[0].tStart, t1 = slice[slice.length - 1].tEnd;
          var lab = (isFinite(t0) && isFinite(t1)) ? (P.fmtTime(t0) + "–" + P.fmtTime(t1)) : ("seg " + (c * per + 1) + "–" + (c * per + slice.length));
          rows.push({ label: lab, segs: slice });
        }
      } else {   // stage (padrão)
        var stages = (d.stages || []).slice().sort(function (a, b) { return a.from - b.from; });
        if (stages.length) {
          stages.forEach(function (st) {
            var segs = all.filter(function (s, gi) { return (gi + 1) >= st.from && (gi + 1) <= st.to; });
            rows.push({ label: st.name || ("seg " + st.from + "–" + st.to), segs: segs, tint: st.tint });
          });
        } else {
          rows.push({ label: "Todos os segmentos", segs: all });
        }
      }
      if (!rows.length) rows.push({ label: "Todos os segmentos", segs: all });
      return rows;
    },
    _renderHeatmap: function (target, opts) {
      opts = opts || {};
      var d = this.data, cfg = this.cfg, self = this;
      var pr = opts.preset || this.activePreset();
      var all = d.segments.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); });
      var rows = this._heatRows(cfg.heatGroupBy || "stage", all, d);
      var nRows = rows.length;

      var light = document.documentElement.getAttribute("data-theme") === "light";
      var isBW = pr.kind === "bw";
      var bg = isBW ? "#ffffff" : (light ? "#ffffff" : "#12161c");
      var fg = isBW ? "#111111" : (light ? "#16202b" : "#e7edf3");
      var gridc = isBW ? "#dddddd" : "rgba(140,160,180,.18)";
      var bgRGB = hex2rgb(bg);

      var W = opts.width || Math.max(680, target.clientWidth - 4);
      var M = { l: 132, r: 20, t: 44, b: 44 };
      var rowGap = 4;
      var rowH = opts.rowH ? Math.max(6, opts.rowH) : (opts.fitHeight ? Math.max(14, (opts.fitHeight - M.t - M.b) / Math.max(1, nRows)) : 30);   // rowH direto (padronizar) > fitHeight > 30. altura das faixas.
      var plotH = Math.max(80, nRows * rowH);
      var H = M.t + plotH + M.b, pw = Math.max(1, W - M.l - M.r);

      // eixo X (compasso) global, mesma lógica do GCP
      var gMin = Infinity, gMax = -Infinity;
      all.forEach(function (s) { gMin = Math.min(gMin, s.mStart, s.mEnd); gMax = Math.max(gMax, s.mStart, s.mEnd); });
      (d.sections || []).forEach(function (sec) { if (isFinite(sec.measure)) { gMin = Math.min(gMin, sec.measure); gMax = Math.max(gMax, sec.measure); } });
      if (!isFinite(gMin)) { gMin = 0; gMax = 1; }
      var stepM = (cfg.axisTickStep > 0) ? cfg.axisTickStep : 1;
      var manMin = cfg.axisMMin != null && isFinite(cfg.axisMMin), manMax = cfg.axisMMax != null && isFinite(cfg.axisMMax);
      var mMin = manMin ? cfg.axisMMin : Math.floor(gMin / stepM) * stepM;
      var mMax = manMax ? cfg.axisMMax : Math.ceil(gMax / stepM) * stepM;
      if (!(mMax > mMin)) mMax = mMin + stepM;
      var xOf = function (m) { return M.l + (m - mMin) / (mMax - mMin) * pw; };

      // densidade contínua por linha, conforme a métrica escolhida.
      var nb = Math.max(60, Math.round(pw));   // ~1px por bin (gradiente suave)
      var binW = (mMax - mMin) / nb;
      var metric = cfg.heatMetric || "duration";
      // Deposita um "ponto" (início/parada/repetição) como um blob triangular de ~±0.8 compasso.
      function deposit(arr, comp, w) {
        var kw = Math.max(binW, 0.8);
        var i0 = Math.max(0, Math.floor((comp - kw - mMin) / binW)), i1 = Math.min(nb - 1, Math.ceil((comp + kw - mMin) / binW));
        for (var i = i0; i <= i1; i++) { var c = mMin + (i + 0.5) * binW, t = 1 - Math.abs(c - comp) / kw; if (t > 0) arr[i] += w * t; }
      }
      var dens = rows.map(function (row) {
        var arr = new Float64Array(nb);
        if (metric === "duration" || metric === "coverage") {
          row.segs.forEach(function (s) {   // toda a REGIÃO do segmento; peso = duração (ou 1 = cobertura)
            var a = Math.min(s.mStart, s.mEnd), b = Math.max(s.mStart, s.mEnd);
            var w = (metric === "duration") ? ((isFinite(s.tStart) && isFinite(s.tEnd)) ? Math.max(0.001, s.tEnd - s.tStart) : 1) : 1;
            var i0 = Math.max(0, Math.floor((a - mMin) / binW)), i1 = Math.min(nb - 1, Math.floor((b - mMin) / binW));
            for (var i = i0; i <= i1; i++) arr[i] += w;
          });
        } else if (metric === "onset") {
          row.segs.forEach(function (s) { deposit(arr, s.mStart, 1); });          // pontos de início
        } else if (metric === "offset") {
          row.segs.forEach(function (s) { deposit(arr, s.mEnd, 1); });            // pontos de parada
        } else if (metric === "repeat") {                                         // reinícios no mesmo lugar
          var ord = row.segs.slice().sort(function (a, b) { return (a.tStart || 0) - (b.tStart || 0); });
          for (var k = 1; k < ord.length; k++) if (Math.abs(ord[k].mStart - ord[k - 1].mStart) <= 1.0) deposit(arr, ord[k].mStart, 1);
        }
        return arr;
      });
      // suavização leve (média móvel 3) p/ o gradiente ficar contínuo
      dens = dens.map(function (a) {
        var o = new Float64Array(nb);
        for (var i = 0; i < nb; i++) { var s = a[i], n = 1; if (i > 0) { s += a[i - 1]; n++; } if (i < nb - 1) { s += a[i + 1]; n++; } o[i] = s / n; }
        return o;
      });
      var gmax = 0; dens.forEach(function (a) { for (var i = 0; i < nb; i++) if (a[i] > gmax) gmax = a[i]; });
      if (gmax <= 0) gmax = 1;

      // rampa de cor: por hue do comportamento (agrupando por comportamento) ou heat global
      var heatStops = light
        ? [[0, bgRGB], [0.25, [180, 205, 235]], [0.55, [80, 150, 220]], [0.8, [230, 170, 70]], [1, [200, 60, 50]]]
        : [[0, bgRGB], [0.2, [32, 60, 110]], [0.5, [40, 130, 210]], [0.75, [95, 205, 180]], [0.9, [240, 200, 90]], [1, [255, 110, 80]]];
      function rowStops(row) {
        if (isBW) return [[0, bgRGB], [1, light ? [20, 20, 20] : [235, 235, 235]]];
        if (row.color) return [[0, bgRGB], [1, hex2rgb(row.color)]];
        return heatStops;
      }

      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, xmlns: SVGNS, "font-family": pr.font || cfg.font });
      svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: bg, rx: 8 }));

      var binPx = pw / nb;
      rows.forEach(function (row, r) {
        var y = M.t + r * rowH + rowGap / 2, hh = rowH - rowGap;
        var stops = rowStops(row);
        // faixa de densidade (retângulos finos = gradiente contínuo)
        for (var i = 0; i < nb; i++) {
          var t = dens[r][i] / gmax;
          if (t <= 0.001) continue;
          svg.appendChild(el("rect", { x: M.l + i * binPx, y: y, width: binPx + 0.6, height: hh, fill: ramp(stops, t) }));
        }
        // moldura da linha + rótulo do grupo
        svg.appendChild(el("rect", { x: M.l, y: y, width: pw, height: hh, fill: "none", stroke: gridc }));
        var lt = el("text", { x: M.l - 8, y: y + hh / 2 + 3, fill: fg, "font-size": 11, "text-anchor": "end", opacity: .85 });
        lt.textContent = row.label.length > 22 ? row.label.slice(0, 21) + "…" : row.label;
        var tt = el("title"); tt.textContent = row.label; lt.appendChild(tt);
        svg.appendChild(lt);
      });

      // fronteiras de seção (linhas verticais)
      (d.sections || []).forEach(function (sec) {
        if (!isFinite(sec.measure) || sec.measure < mMin || sec.measure > mMax) return;
        var x = xOf(sec.measure);
        svg.appendChild(el("line", { x1: x, y1: M.t, x2: x, y2: M.t + plotH, stroke: fg, "stroke-width": 1.2, "stroke-dasharray": "4 4", opacity: .5 }));
        if (cfg.showSectionLabels && sec.name) {
          var st = el("text", { x: x, y: M.t - 6, fill: fg, "font-size": 11, "text-anchor": "middle", "font-weight": 600 });
          st.textContent = sec.name; svg.appendChild(st);
        }
      });

      // eixo X (rótulos de compasso, começando no mínimo)
      if (cfg.showXLabels) {
        var xTicks = Math.max(1, Math.round((mMax - mMin) / stepM));
        var xLabelEvery = Math.max(1, Math.ceil(34 / (pw / xTicks)));
        var labStep = (cfg.axisLabelStep > 0) ? cfg.axisLabelStep : stepM * xLabelEvery;
        if (!(labStep > 0)) labStep = stepM;
        for (var mm = mMin; mm <= mMax + 1e-9; mm += labStep) {
          svg.appendChild(el("line", { x1: xOf(mm), y1: M.t + plotH, x2: xOf(mm), y2: M.t + plotH + 4, stroke: fg, opacity: .5 }));
          var anch = (mm <= mMin + 1e-6) ? "start" : (mm >= mMax - 1e-6 ? "end" : "middle");
          var xl2 = el("text", { x: xOf(mm), y: M.t + plotH + 16, fill: fg, "font-size": 10, "text-anchor": anch, opacity: .7 });
          xl2.textContent = Math.round(mm); svg.appendChild(xl2);
        }
      }
      var _hxatt = { x: M.l + pw / 2, y: H - 4, fill: fg, "text-anchor": "middle" }, _hta = self._axTitleAttrs(cfg), _hk;
      for (_hk in _hta) _hxatt[_hk] = _hta[_hk];
      var xTitle = el("text", _hxatt);
      xTitle.textContent = self._axCase(cfg.xTitle != null ? cfg.xTitle : "Compasso", cfg.axisTitleCase); svg.appendChild(xTitle);

      target.innerHTML = ""; target.appendChild(svg);
      if (!opts.isSub) { this.svg = svg; this._dims = { W: W, H: H, bg: bg }; }
      return svg;
    },

    showTip: function (ev, s, num) {
      if (!this.tooltip) {
        this.tooltip = document.createElement("div");
        this.tooltip.style.cssText = "position:fixed;z-index:99;pointer-events:none;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;box-shadow:var(--shadow);font-size:12px;max-width:260px";
        document.body.appendChild(this.tooltip);
      }
      var name = (this.data.legend && this.data.legend[s.behavior]) || s.behavior;
      // estágio (objetivo de médio prazo) a que este segmento pertence: from/to são 1-based, igual a num
      var stageName = null, stages = this.data.stages || [];
      for (var k = 0; k < stages.length; k++) { var st = stages[k]; if (num >= (st.from || 1) && num <= (st.to || num)) { stageName = st.name || ("Estágio " + (k + 1)); break; } }
      this.tooltip.innerHTML =
        '<b>Segmento ' + num + '</b> · ' + P.escapeHtml(s.behavior) + ': ' + P.escapeHtml(name) + '<br>' +
        '<span style="color:var(--txt-dim)">Compassos ' + s.mStart + ' a ' + s.mEnd + '</span>' +
        (isFinite(s.tStart) ? '<br><span style="color:var(--txt-dim)">' + P.fmtTime(s.tStart, true) + ' → ' + P.fmtTime(s.tEnd, true) + '</span>' : '') +
        (stageName ? '<br><span style="color:var(--txt-dim)">Objetivo de médio prazo: </span>' + P.escapeHtml(stageName) : '') +
        (s.note ? '<br><i>' + P.escapeHtml(s.note) + '</i>' : '') +
        ((P.Segmenter && P.Segmenter.media && isFinite(s.tStart)) ? '<br><span style="color:var(--accent, #4f9df5)">Clique para reproduzir daqui</span>' : '');
      this.tooltip.style.display = "block";
      this.tooltip.style.left = Math.min(window.innerWidth - 270, ev.clientX + 14) + "px";
      this.tooltip.style.top = (ev.clientY + 14) + "px";
    },
    hideTip: function () { if (this.tooltip) this.tooltip.style.display = "none"; },

    stats: function () {
      var by = {}, total = 0;
      this.data.segments.forEach(function (s) {
        var dur = isFinite(s.tEnd) && isFinite(s.tStart) ? (s.tEnd - s.tStart) : ((s.mEnd - s.mStart) || 0);
        if (dur <= 0) return;
        by[s.behavior] = (by[s.behavior] || 0) + dur; total += dur;
      });
      var self = this, idx = {}; this.data.behaviors.forEach(function (b, i) { idx[b] = i; });
      return Object.keys(by).map(function (b) {
        return { behavior: b, name: (self.data.legend[b] || b), amount: by[b], pct: total ? by[b] / total * 100 : 0, color: self.behColor(b, idx[b] || 0) };
      }).sort(function (a, b) { return b.amount - a.amount; });
    },

    // Estatística descritiva expandida (item 9): comportamento, seções, estágios, camadas, co-ocorrência.
    statsFull: function () {
      var d = this.data, self = this, segs = d.segments || [];
      function dur(s) { return Math.max(0, (s.tEnd || 0) - (s.tStart || 0)); }
      function overlap(a, b) { return a.tStart < b.tEnd && b.tStart < a.tEnd; }
      var total = segs.reduce(function (a, s) { return a + dur(s); }, 0);
      var idx = {}; d.behaviors.forEach(function (b, i) { idx[b] = i; });
      var byBeh = {};
      segs.forEach(function (s) { var b = s.behavior || "?"; if (!byBeh[b]) byBeh[b] = { count: 0, seconds: 0 }; byBeh[b].count++; byBeh[b].seconds += dur(s); });
      var behaviors = Object.keys(byBeh).map(function (b) { return { code: b, name: d.legend[b] || b, count: byBeh[b].count, seconds: byBeh[b].seconds, pct: total ? byBeh[b].seconds / total * 100 : 0, color: self.behColor(b, idx[b] || 0) }; }).sort(function (a, b) { return b.seconds - a.seconds; });
      var secs = (d.sections || []).slice().sort(function (a, b) { return a.measure - b.measure; });
      var perSection = secs.map(function (sec, si) {
        var m0 = sec.measure, m1 = secs[si + 1] ? secs[si + 1].measure : Infinity, count = 0, seconds = 0;
        segs.forEach(function (s) { var c = (s.mStart + s.mEnd) / 2; if (c >= m0 && c < m1) { count++; seconds += dur(s); } });
        return { name: sec.name || ("c." + sec.measure), count: count, seconds: seconds };
      });
      var perStage = (d.stages || []).map(function (stg) {
        var count = 0, seconds = 0;
        segs.forEach(function (s, gi) { if ((gi + 1) >= stg.from && (gi + 1) <= stg.to) { count++; seconds += dur(s); } });
        return { name: stg.name || "", count: count, seconds: seconds };
      });
      var layers = (d.layers || []).map(function (L) {
        var lt = (L.segments || []).reduce(function (a, s) { return a + dur(s); }, 0), byv = {};
        (L.segments || []).forEach(function (s) { var v = (s.value || "").toString().trim() || "(vazio)"; if (!byv[v]) byv[v] = { count: 0, seconds: 0 }; byv[v].count++; byv[v].seconds += dur(s); });
        var isDiscrete = L.kind === "practice" || L.kind === "controlled";
        var values = isDiscrete ? Object.keys(byv).map(function (v) { return { value: v, count: byv[v].count, seconds: byv[v].seconds, pct: lt ? byv[v].seconds / lt * 100 : 0 }; }).sort(function (a, b) { return b.seconds - a.seconds; }) : [];
        return { name: L.name, kind: L.kind, count: (L.segments || []).length, total: lt, discrete: isDiscrete, values: values };
      });
      var cooc = {};
      segs.forEach(function (s) {
        var b = s.behavior || "?";
        (d.layers || []).forEach(function (L) {
          if (L.kind !== "practice" && L.kind !== "controlled") return;
          (L.segments || []).forEach(function (o) { if (overlap(s, o)) { var v = (o.value || "").toString().trim() || "(vazio)"; var k = b + "␟" + L.name + "␟" + v; cooc[k] = (cooc[k] || 0) + 1; } });
        });
      });
      var cooccurrence = Object.keys(cooc).map(function (k) { var p = k.split("␟"); return { behavior: p[0], layer: p[1], value: p[2], count: cooc[k] }; }).sort(function (a, b) { return b.count - a.count; });
      return { total: total, totalSegments: segs.length, behaviors: behaviors, perSection: perSection, perStage: perStage, layers: layers, cooccurrence: cooccurrence };
    },

    // P6: devolve uma cópia do SVG com um retângulo branco de fundo, para que o
    // arquivo exportado tenha fundo branco explícito nos dois temas (o branco da
    // tela vem do CSS da folha e não viaja no arquivo).
    _withWhiteBg: function (svgEl) {
      var clone = svgEl.cloneNode(true);
      var vb = (svgEl.getAttribute("viewBox") || "0 0 680 400").split(/\s+/).map(Number);
      var NS = "http://www.w3.org/2000/svg";
      var rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", vb[0]); rect.setAttribute("y", vb[1]);
      rect.setAttribute("width", vb[2]); rect.setAttribute("height", vb[3]);
      rect.setAttribute("fill", "#ffffff");
      clone.insertBefore(rect, clone.firstChild);
      return clone;
    },
    exportSVG: function (filename, svgEl) {
      var s = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(this._withWhiteBg(svgEl || this.svg));
      P.download(filename || "gcp.svg", s, "image/svg+xml;charset=utf-8");
    },
    exportRaster: function (filename, mime, dpi, svgEl) {
      svgEl = svgEl || this.svg;
      var vb = (svgEl.getAttribute("viewBox") || "0 0 680 400").split(/\s+/).map(Number);
      var W = vb[2], H = vb[3], scale = (dpi || this.cfg.exportDpi || 300) / 96;
      // Limites de canvas dos navegadores (Chrome/Firefox ~32767 px por lado; Safari bem menos em área). Acima disso o
      // toBlob devolve null e saía um arquivo "null": reduz a resolução até caber e avisa.
      var MAX_SIDE = 16384, MAX_AREA = 16384 * 16384 / 2, s0 = scale;
      scale = Math.min(scale, MAX_SIDE / W, MAX_SIDE / H, Math.sqrt(MAX_AREA / (W * H)));
      if (scale < s0 * 0.999) alert("A figura é grande demais para " + Math.round(s0 * 96) + " dpi neste navegador; exportando a " + Math.floor(scale * 96) + " dpi. Para resolução máxima use SVG.");
      var clone = this._withWhiteBg(svgEl);
      clone.setAttribute("width", W); clone.setAttribute("height", H);   // tamanho explícito (com width="100%" a imagem pode rasterizar em branco)
      var svgStr = new XMLSerializer().serializeToString(clone);
      var url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas");
        cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
        var ctx = cv.getContext("2d");
        if (mime === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); }
        ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, W, H);
        cv.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { alert("Não foi possível gerar a imagem (memória do navegador). Tente um DPI menor ou exporte em SVG."); return; }
          P.download(filename, blob, mime);
        }, mime, 0.95);
      };
      img.onerror = function () { URL.revokeObjectURL(url); alert("Não foi possível rasterizar a figura. Exporte em SVG."); };
      img.src = url;
    },
    exportPNG: function (dpi, svgEl) { this.exportRaster("gcp_praxis.png", "image/png", dpi, svgEl); },

    // --- Resumo dos estágios (tabela para publicação: CSV + tabela p/ Word) ---------
    // Estágio = objetivo de médio prazo (from/to = índices de segmento 1-based).
    // Duração = tempo decorrido do estágio (início do 1º segmento ao fim do último);
    // se não houver tempo real (GCP só por compasso), soma as durações dos segmentos.
    _mmss: function (sec) {
      if (sec == null || !isFinite(sec)) return "";
      sec = Math.max(0, Math.round(sec));
      var m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    },
    stageSummary: function () {
      var d = this.data; if (!d) return [];
      var segs = d.segments || [];
      function dur(s) { return Math.max(0, (s && isFinite(s.tEnd) && isFinite(s.tStart)) ? (s.tEnd - s.tStart) : 0); }
      var stages = (d.stages || []).slice().sort(function (a, b) { return (a.from || 0) - (b.from || 0); });
      return stages.map(function (stg, i) {
        var from = stg.from || 1, to = stg.to || from;
        var segCount = Math.max(0, to - from + 1);
        var s0 = segs[from - 1], s1 = segs[to - 1];
        var span = (s0 && s1 && isFinite(s0.tStart) && isFinite(s1.tEnd)) ? (s1.tEnd - s0.tStart) : null;
        var sum = 0; for (var k = from - 1; k <= to - 1; k++) { if (segs[k]) sum += dur(segs[k]); }
        var seconds = (span != null && span > 0) ? span : sum;
        return { index: i + 1, name: stg.name || "", from: from, to: to, segCount: segCount, seconds: seconds };
      });
    },
    stageSummaryCSV: function (session) {
      var self = this, hasSes = !!String(session == null ? "" : session).trim();
      var head = hasSes ? ["Sessão", "Estágio", "Objetivo", "Início", "Fim", "Segmento", "Duração"]
                        : ["Estágio", "Objetivo", "Início", "Fim", "Segmento", "Duração"];
      var rows = [head];
      this.stageSummary().forEach(function (r) {
        var base = [r.index, r.name, r.from, r.to, r.segCount, self._mmss(r.seconds)];
        rows.push(hasSes ? [session].concat(base) : base);
      });
      return rows;
    },
    exportStageCSV: function (session, filename) {
      var rows = this.stageSummaryCSV(session);
      if (rows.length <= 1) return false;
      P.download(filename || "estagios_praxis.csv", "﻿" + P.toCSV(rows, ";"), "text/csv;charset=utf-8");
      return true;
    },
    // Tabela HTML dos estágios; cola no Word como tabela editável (estilos inline).
    // opts.format: "grid" (grade completa, estilo dos exemplos), "abnt" (só linhas
    // horizontais, título e Fonte à esquerda) ou "apa" (só linhas horizontais,
    // «Tabela N» em negrito + título em itálico, «Nota.» abaixo). opts.number = nº da tabela.
    stageTableHTML: function (opts) {
      opts = opts || {};
      var rows = this.stageSummary(); if (!rows.length) return "";
      var esc = P.escapeHtml, self = this;
      var session = String(opts.session == null ? "" : opts.session).trim();
      var hasSes = !!session, n = rows.length;
      var fmt = opts.format || "grid", grid = (fmt === "grid");
      var num = String(opts.number == null ? "" : opts.number).trim();
      var cap = String(opts.caption == null ? "" : opts.caption).trim();
      var fonte = String(opts.fonte == null ? "" : opts.fonte).trim();
      var align = grid ? "center" : "left";
      var th = 'style="' + (grid ? "border:1px solid #000;" : "border-bottom:1px solid #000;") + 'padding:3px 10px;text-align:center;font-weight:bold"';
      var td = 'style="' + (grid ? "border:1px solid #000;" : "") + 'padding:3px 10px"';
      var tc = 'style="' + (grid ? "border:1px solid #000;" : "") + 'padding:3px 10px;text-align:center;vertical-align:middle"';
      var tblStyle = "border-collapse:collapse;font-family:sans-serif;font-size:11pt" +
        (grid ? "" : ";border-top:1.5px solid #000;border-bottom:1.5px solid #000");
      var h = "";
      // Título acima da tabela.
      if (fmt === "apa") {
        if (num) h += '<p style="text-align:left;margin:0"><b>Tabela ' + esc(num) + '</b></p>';
        if (cap) h += '<p style="text-align:left;margin:0 0 4px;font-style:italic">' + esc(cap) + '</p>';
      } else {
        var line = (num ? "Tabela " + esc(num) + ". " : "") + esc(cap);
        if (line.trim()) h += '<p style="text-align:' + align + ';margin:0 0 4px"><b>' + line + '</b></p>';
      }
      h += '<table style="' + tblStyle + '"><thead><tr>';
      var cols = (hasSes ? ["Sessão"] : []).concat(["Estágio", "Objetivo", "Início", "Fim", "Segmento", "Duração"]);
      cols.forEach(function (c) { h += '<th ' + th + '>' + c + '</th>'; });
      h += '</tr></thead><tbody>';
      rows.forEach(function (r, i) {
        h += '<tr>';
        if (hasSes && i === 0) h += '<td ' + tc + ' rowspan="' + n + '">' + esc(session) + '</td>';
        h += '<td ' + tc + '>' + r.index + '</td>' +
             '<td ' + td + '>' + esc(r.name) + '</td>' +
             '<td ' + tc + '>' + r.from + '</td>' +
             '<td ' + tc + '>' + r.to + '</td>' +
             '<td ' + tc + '>' + r.segCount + '</td>' +
             '<td ' + tc + '>' + self._mmss(r.seconds) + '</td></tr>';
      });
      h += '</tbody></table>';
      // Fonte (grade/ABNT) ou Nota (APA) abaixo da tabela.
      if (fonte) {
        if (fmt === "apa") h += '<p style="text-align:left;margin:4px 0 0;font-size:10pt"><i>Nota.</i> ' + esc(fonte) + '</p>';
        else h += '<p style="text-align:' + align + ';margin:4px 0 0' + (grid ? "" : ";font-size:10pt") + '">Fonte: ' + esc(fonte) + '</p>';
      }
      return h;
    },
    // Exporta o resumo dos estágios como planilha .xlsx (gerada localmente, sem lib).
    exportStageXLSX: function (session, filename) {
      var rows = this.stageSummaryCSV(session);
      if (rows.length <= 1 || !P.toXLSX) return false;
      var blob = P.toXLSX(rows, "Estágios");
      P.download(filename || "estagios_praxis.xlsx", blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return true;
    },

    // Atualiza os NOMES dos estágios pelos objetivos de médio prazo (camada cujo nome
    // casa "médio prazo"), casando cada estágio ao objetivo de maior sobreposição no
    // tempo. Mantém fronteiras/tinta/estilo; só troca o nome. {ok, updated, total, reason}.
    updateStageNamesFromObjectives: function () {
      var d = this.data;
      if (!d || !(d.stages && d.stages.length)) return { ok: false, reason: "no-stages" };
      var segs = d.segments || [];
      var mid = (d.layers || []).filter(function (L) { return /m[eé]dio\s*prazo/i.test(L.name || ""); })[0];
      var midSegs = mid ? (mid.segments || []) : null;
      if ((!midSegs || !midSegs.length) && P.Segmenter && P.Segmenter.tiers) {
        var tr = P.Segmenter.tiers.filter(function (t) { return /m[eé]dio\s*prazo/i.test(t.name || ""); })[0];
        if (tr) midSegs = tr.segments || [];
      }
      if (!midSegs || !midSegs.length) return { ok: false, reason: "no-objectives" };
      var updated = 0;
      this.data.stages.forEach(function (stg) {
        var from = stg.from || 1, to = stg.to || from;
        var s0 = segs[from - 1], s1 = segs[to - 1];
        if (!s0 || !s1 || !isFinite(s0.tStart) || !isFinite(s1.tEnd)) return;
        var a0 = s0.tStart, a1 = s1.tEnd, best = null, bestOv = 0;
        midSegs.forEach(function (o) {
          if (!isFinite(o.tStart) || !isFinite(o.tEnd)) return;
          var ov = Math.min(a1, o.tEnd) - Math.max(a0, o.tStart);
          if (ov > bestOv) { bestOv = ov; best = o; }
        });
        if (best && bestOv > 0) {
          var name = String(best.value == null ? "" : best.value).trim();
          if (name && name !== stg.name) { stg.name = name; updated++; }
        }
      });
      return { ok: true, updated: updated, total: this.data.stages.length };
    },
    // Localiza a camada de objetivos de médio prazo (nas layers do gráfico ou nos tiers da Segmentar).
    _midTermSegs: function () {
      var d = this.data;
      var mid = (d && d.layers || []).filter(function (L) { return /m[eé]dio\s*prazo/i.test(L.name || ""); })[0];
      var midSegs = mid ? (mid.segments || []) : null;
      if ((!midSegs || !midSegs.length) && P.Segmenter && P.Segmenter.tiers) {
        var tr = P.Segmenter.tiers.filter(function (t) { return /m[eé]dio\s*prazo/i.test(t.name || ""); })[0];
        if (tr) midSegs = tr.segments || [];
      }
      return midSegs && midSegs.length ? midSegs : null;
    },
    // CRIA os estágios a partir dos objetivos de médio prazo: cada segmento é atribuído ao
    // objetivo de maior sobreposição no tempo; segmentos sem sobreposição herdam o objetivo
    // anterior (preenche lacunas). Faixas contíguas de mesmo objetivo viram um estágio
    // (from/to = índices de segmento 1-based, nome = rótulo do objetivo, tinta pela ordem).
    // SUBSTITUI os estágios atuais. {ok, created, total} ou {ok:false, reason}.
    buildStagesFromObjectives: function () {
      var d = this.data;
      if (!d) return { ok: false, reason: "no-data" };
      var segs = d.segments || [];
      if (!segs.length) return { ok: false, reason: "no-segments" };
      var midSegs = this._midTermSegs();
      if (!midSegs) return { ok: false, reason: "no-objectives" };
      var objs = midSegs.filter(function (o) { return isFinite(o.tStart) && isFinite(o.tEnd) && o.tEnd > o.tStart; })
        .slice().sort(function (a, b) { return a.tStart - b.tStart; });
      if (!objs.length) return { ok: false, reason: "no-objectives" };
      // atribui cada segmento ao objetivo de maior sobreposição no tempo (-1 = nenhuma)
      var assign = segs.map(function (s) {
        var a0 = s.tStart, a1 = s.tEnd;
        if (!isFinite(a0) || !isFinite(a1)) return -1;
        var best = -1, bestOv = 0;
        objs.forEach(function (o, oi) { var ov = Math.min(a1, o.tEnd) - Math.max(a0, o.tStart); if (ov > bestOv) { bestOv = ov; best = oi; } });
        return best;
      });
      // preenche lacunas: -1 herda o objetivo anterior; -1 iniciais herdam o 1º objetivo real
      var lastReal = -1, i, firstReal = -1;
      for (i = 0; i < assign.length; i++) { if (assign[i] >= 0) { if (firstReal < 0) firstReal = i; lastReal = assign[i]; } else if (lastReal >= 0) assign[i] = lastReal; }
      if (firstReal < 0) return { ok: false, reason: "no-overlap" };
      for (i = 0; i < firstReal; i++) assign[i] = assign[firstReal];
      // agrupa em faixas contíguas de mesmo objetivo
      var pal = P.PALETTE_COLOR || ["#8899aa"], stages = [], run = null;
      assign.forEach(function (oi, idx) {
        if (run && run.oi === oi) { run.to = idx + 1; return; }
        if (run) stages.push(run);
        run = { oi: oi, from: idx + 1, to: idx + 1 };
      });
      if (run) stages.push(run);
      var out = stages.map(function (r, k) {
        var nm = String(objs[r.oi] && objs[r.oi].value == null ? "" : objs[r.oi].value).trim();
        return { from: r.from, to: r.to, name: nm || ("Estágio " + (k + 1)), tint: pal[k % pal.length] };
      });
      this.setStages(out);
      return { ok: true, created: out.length, total: segs.length };
    }
  };

  // Defaults imutáveis do cfg (capturados antes de qualquer edição), base p/ cada gráfico novo.
  var PRISTINE_CFG = clone(GCP.cfg);

  P.GCP = GCP;
})(window.Praxis = window.Praxis || {});
