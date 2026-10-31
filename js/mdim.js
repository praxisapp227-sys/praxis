/* mdim.js - Módulo C (aba ④ Multidimensional): análise da prática como
   trajetória num espaço de dimensões, à la Miklaszewski (1989).

   M1: lê as camadas kind==='dimensao' de P.Segmenter.tiers e desenha, para cada
   dimensão, um gráfico de LINHAS EM DEGRAUS (X=tempo, Y=escore) - a codificação
   por switch temporal digitalizada. Estáticos, empilhados, compartilhando o eixo
   do tempo. Uma agulha (somente leitura) segue a mídia compartilhada.

   Próximo (M2+): codificar por switch ao vivo; radar integrador; categorias. */
(function (P) {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";

  var M = {
    refs: {}, _raf: null, _shown: false,
    _activeDimId: null,          // dimensão sendo codificada na ④
    _view: null,                 // janela de zoom dos gráficos de linha {start, span} (null = tudo)
    _codingMode: false,          // modo foco de codificação: só o eixo ativo (grande) + lista de dimensões
    _formatMode: false,          // modo de formatação gráfica: editor de gráficos com abas/colunas/export
    _viewMode: "resumo",         // "resumo" | "coding" | "format" (o toggle de 3 modos da aba)
    setViewMode: function (m) {
      this._viewMode = (m === "coding" || m === "format" || m === "matrix") ? m : "resumo";
      this._codingMode = this._viewMode === "coding";
      this._formatMode = this._viewMode === "format";
      try { localStorage.setItem("praxis.mdim.viewmode", this._viewMode); } catch (e) {}
      this._syncModeBtns();
      if (this._viewMode === "matrix") this.renderMatrixPanel();   // ao entrar: painel com os valores atuais (radar/tipos podem ter mudado)
      this.render();
    },
    _syncModeBtns: function () {
      var self = this, host = document.getElementById("mdim-modes");
      if (host) Array.prototype.forEach.call(host.querySelectorAll("[data-mode]"), function (b) {
        var on = b.dataset.mode === self._viewMode;
        b.classList.toggle("active", on); b.classList.toggle("secondary", !on);
      });
      // inspetor contextual: formatação mostra os painéis de formatação (+ export); matriz mostra só o painel da matriz;
      // resumo/codificação mostram os grupos de codificação.
      var isFmt = this._viewMode === "format", isMx = this._viewMode === "matrix";
      Array.prototype.forEach.call(document.querySelectorAll(".mdim-export-group"), function (g) { g.style.display = isFmt ? "" : "none"; });
      Array.prototype.forEach.call(document.querySelectorAll(".mdim-coding-group"), function (g) { g.style.display = (isFmt || isMx) ? "none" : ""; });
      Array.prototype.forEach.call(document.querySelectorAll(".mdim-matrix-group"), function (g) { g.style.display = isMx ? "" : "none"; });
      var fp = document.getElementById("mdim-format-panels"); if (fp) fp.style.display = isFmt ? "" : "none";
      var mp = document.getElementById("mdim-matrix-panel"); if (isMx && mp && !mp.children.length) this.renderMatrixPanel();   // 1ª entrada no modo: monta o painel
    },
    _showIndexLabels: false,     // rótulo do código do índice junto de cada keyframe
    setIndexLabels: function (on) { this._showIndexLabels = !!on; try { localStorage.setItem("praxis.mdim.idxlabels", on ? "1" : "0"); } catch (e) {} this.render(); },
    _showStageBands: false,      // bandas de fundo por estágio (reusa os estágios do módulo Gráfico)
    setStageBands: function (on) { this._showStageBands = !!on; try { localStorage.setItem("praxis.mdim.stagebands", on ? "1" : "0"); } catch (e) {} this.render(); },
    _showTypeBands: false,       // bandas de fundo mostrando ONDE cada tipo de prática acontece no tempo
    setTypeBands: function (on) { this._showTypeBands = !!on; try { localStorage.setItem("praxis.mdim.typebands", on ? "1" : "0"); } catch (e) {} this.renderTypeAppearance(); this.render(); },
    // Editor de aparência das faixas de tipo (modo de sobreposição, opacidade, cor por tipo). Aparece quando as faixas estão ligadas.
    renderTypeAppearance: function () {
      var self = this, host = this.refs.typeappear; if (!host) return;
      if (!this._showTypeBands) { host.innerHTML = ""; return; }
      var cats = P.Segmenter.categories || [];
      var modes = [["hatch", "Rachura com as cores dos tipos"], ["highlight", "Realce (rachura vermelha)"], ["neutral", "Rachura neutra"], ["split", "Sub-faixas empilhadas"]];
      var h = '<div class="field" style="margin-top:4px"><label>Sobreposição de tipos</label><select data-ov>' +
        modes.map(function (m) { return '<option value="' + m[0] + '"' + (self.cfg.typeOverlapMode === m[0] ? " selected" : "") + '>' + m[1] + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>Opacidade das faixas · <span data-ovop>' + Math.round((self.cfg.typeBandOpacity || 0.18) * 100) + '%</span></label><input type="range" data-op min="0.05" max="0.6" step="0.02" value="' + (self.cfg.typeBandOpacity || 0.18) + '"></div>';
      if (cats.length) {
        h += '<div class="mini" style="color:var(--txt-dim);margin:6px 0 3px">Cor de cada tipo no gráfico</div>';
        cats.forEach(function (c) { h += '<div class="row" style="align-items:center;gap:6px;margin-bottom:3px"><input type="color" data-cc="' + c.id + '" value="' + self._catColor(c) + '" style="flex:0 0 34px"><span class="mini" style="flex:1">' + P.escapeHtml(c.nome) + '</span></div>'; });
      }
      host.innerHTML = h;
      host.querySelector("[data-ov]").addEventListener("change", function () { self.cfg.typeOverlapMode = this.value; self._saveCfg(); self.render(); });
      host.querySelector("[data-op]").addEventListener("input", function () { self.cfg.typeBandOpacity = parseFloat(this.value); var v = host.querySelector("[data-ovop]"); if (v) v.textContent = Math.round(this.value * 100) + "%"; self._saveCfg(); self.render(); });
      Array.prototype.forEach.call(host.querySelectorAll("[data-cc]"), function (inp) { inp.addEventListener("input", function () { self.cfg.typeColors[inp.dataset.cc] = this.value; self._saveCfg(); self.render(); }); });
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);
    },
    // Cor de um tipo nos gráficos (override em cfg.typeColors, senão a cor do tipo).
    _catColor: function (cat) { if (this.cfg.figMono) return "#8a8a8a"; return (cat && this.cfg.typeColors && this.cfg.typeColors[cat.id]) || (cat && cat.cor) || "#8899aa"; },
    // Cor e tracejado de uma dimensão nas figuras (respeita P&B, paleta daltônico e tracejado).
    _dimColorFig: function (d, di) { if (this.cfg.figMono) return "#2a2a2a"; if (this.cfg.figCbPalette) return this.CB_PALETTE[di % this.CB_PALETTE.length]; return this._bw(d.cor || "#4f9df5"); },
    _dimDashFig: function (di) { return (this.cfg.figMono || this.cfg.figLineDash) ? this.DIM_DASHES[di % this.DIM_DASHES.length] : ""; },
    // Recolore TODAS as dimensões e tipos com a paleta segura para daltônicos (Okabe-Ito), por índice.
    applyCbPalette: function () {
      var pal = this.CB_PALETTE;
      this.dims().forEach(function (d, i) { d.cor = pal[(i + 1) % pal.length]; });   // pula o preto (0) nas dimensões
      (P.Segmenter.categories || []).forEach(function (c, i) { c.cor = pal[i % pal.length]; });
      this.cfg.typeColors = {}; this._saveCfg();   // limpa overrides para a cor do tipo valer
      if (P.Segmenter.commit) P.Segmenter.commit();
      this.refresh();
      if (P.Segmenter.setStatus) P.Segmenter.setStatus("Paleta para daltônicos aplicada às dimensões e tipos.", "ok");
    },
    // Linha de swatches da paleta daltônico; cada botão tem data-cbset="kind:id:hex" (kind = dim | type).
    _cbSwatchRow: function (kind, id) {
      return '<div class="row" style="gap:3px;flex-wrap:wrap;margin:1px 0 6px">' + this.CB_PALETTE.map(function (hex) { return '<button class="cbsw" data-cbset="' + kind + ':' + id + ':' + hex + '" title="' + hex + ' (daltônico)" style="width:15px;height:15px;border-radius:3px;border:1px solid rgba(0,0,0,.25);background:' + hex + ';cursor:pointer;flex:0 0 auto;padding:0"></button>'; }).join("") + '</div>';
    },
    // Trechos de tempo com os tipos de prática ATIVOS em cada um: [{t0, t1, cats:[cat,...], key}].
    // Vários tipos podem estar ativos ao mesmo tempo (sobreposição). Runs contíguos com o mesmo conjunto são fundidos.
    _typeRuns: function () {
      var cats = P.Segmenter.categories || []; if (!cats.length) return [];
      var dims = this.dims(); if (!dims.length) return [];
      var bset = {};
      dims.forEach(function (d) { (d.segments || []).forEach(function (s) { if (isFinite(s.tStart)) bset[+s.tStart.toFixed(4)] = 1; if (isFinite(s.tEnd)) bset[+s.tEnd.toFixed(4)] = 1; }); });
      var ts = Object.keys(bset).map(Number).sort(function (a, b) { return a - b; });
      var runs = [], cur = null;
      for (var i = 0; i < ts.length - 1; i++) {
        var a = ts[i], b = ts[i + 1]; if (b - a <= 1e-6) continue;
        var m = (a + b) / 2, active = [];
        for (var c = 0; c < cats.length; c++) if (P.Segmenter.categoryActiveAt(cats[c], m)) active.push(cats[c]);
        if (!active.length) { cur = null; continue; }   // "sem tipo": não pinta
        var key = active.map(function (c) { return c.id; }).join("|");
        if (cur && cur.key === key && Math.abs(cur.t1 - a) < 1e-6) cur.t1 = b;   // estende o run contíguo (mesmo conjunto de tipos)
        else { cur = { key: key, t0: a, t1: b, cats: active }; runs.push(cur); }
      }
      return runs;
    },
    // Cria um <pattern> de rachura diagonal (listras finas com vãos) com as cores dadas no <defs> do svg; devolve url(#id).
    _hatchPattern: function (svg, id, colors) {
      var defs = svg.querySelector("defs"); if (!defs) { defs = document.createElementNS(SVGNS, "defs"); svg.insertBefore(defs, svg.firstChild); }
      if (svg.querySelector("#" + id)) return "url(#" + id + ")";
      var n = Math.max(1, colors.length), lineW = 3, gap = 4, cell = lineW + gap, w = cell * n;
      var pat = document.createElementNS(SVGNS, "pattern");
      pat.setAttribute("id", id); pat.setAttribute("patternUnits", "userSpaceOnUse");
      pat.setAttribute("width", w); pat.setAttribute("height", w); pat.setAttribute("patternTransform", "rotate(45)");
      colors.forEach(function (c, i) {
        var line = document.createElementNS(SVGNS, "rect");
        line.setAttribute("x", i * cell); line.setAttribute("y", 0); line.setAttribute("width", lineW); line.setAttribute("height", w); line.setAttribute("fill", c);
        pat.appendChild(line);
      });
      defs.appendChild(pat);
      return "url(#" + id + ")";
    },
    // Step-plot INTEGRADO: todas as dimensões numa única linha do tempo (trajetórias sobrepostas, 1 cor por eixo).
    // Parametrizado pelo cfg.sp* / cfg.figSz* (altura, linha, lane, pontos, grade, índices, normalização, legenda).
    _integratedStepPlot: function (maxT, W, dimsArr) {
      var self = this, c = this.cfg, dims = dimsArr || this.dims(); if (!dims.length) return null;
      W = W || 720;
      function escOf(d) { return P.Segmenter.escalaMaxOf(d); }
      var gmax = 1; dims.forEach(function (d) { gmax = Math.max(gmax, escOf(d)); });
      var rowPx = Math.max(8, +c.spRowPx || 22), lineW = +c.spLineW || 2.2, laneGap = +c.spLaneGap || 0, ptR = +c.spPointR || 0;
      var legPos = (c.spLegend === false) ? "none" : (c.spLegendPos || "right");
      var szAxis = +c.figSzAxis || 11, szTick = +c.figSzTick || 9, szLeg = +c.spLegendSize || 10, szIdx = +c.spIndexSize || 8;
      var padL = 44, padR = legPos === "right" ? Math.max(90, 30 + Math.max.apply(null, dims.map(function (d) { return (d.name || "").length; })) * szLeg * 0.55) : 14;
      var padT = 12, padB = 26, legTop = legPos === "top" ? szLeg + 12 : 0, legBot = legPos === "bottom" ? szLeg + 12 : 0;
      var H = 34 + gmax * rowPx + legTop + legBot, plotTop = padT + legTop;
      var plotW = W - padL - padR, plotH = H - plotTop - padB - legBot, vSpan = maxT || 1, vEnd = vSpan;
      var x = function (t) { return padL + (vSpan > 0 ? t / vSpan : 0) * plotW; };
      function fracOf(d, sc) { var e = escOf(d); return c.spNormalize ? (e > 1 ? (sc - 1) / (e - 1) : 0.5) : (gmax > 1 ? (sc - 1) / (gmax - 1) : 0.5); }
      function yFor(d, sc) { return plotTop + (1 - fracOf(d, sc)) * plotH; }
      function yAbs(lvl) { return plotTop + (gmax > 1 ? (gmax - lvl) / (gmax - 1) : 0.5) * plotH; }
      var svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", "100%"); svg.setAttribute("height", H); svg.style.display = "block";
      function line(x1, y1, x2, y2, stroke, w, dash, op) { var l = document.createElementNS(SVGNS, "line"); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); l.setAttribute("stroke", stroke); l.setAttribute("stroke-width", w || 1); if (dash) l.setAttribute("stroke-dasharray", dash); if (op != null) l.setAttribute("opacity", op); svg.appendChild(l); return l; }
      function txt(xx, yy, s, anchor, size, fill) { var e = document.createElementNS(SVGNS, "text"); e.setAttribute("x", xx); e.setAttribute("y", yy); e.setAttribute("font-size", size || 10); e.setAttribute("fill", fill || "var(--txt-dim)"); if (anchor) e.setAttribute("text-anchor", anchor); e.textContent = s; svg.appendChild(e); return e; }
      // faixas de tipo (compartilhadas) ao fundo
      if (this._showTypeBands) {
        var opTB = isFinite(c.typeBandOpacity) ? c.typeBandOpacity : 0.18, ovMode = c.typeOverlapMode || "hatch";
        this._typeRuns().forEach(function (run) {
          var bx0 = Math.max(padL, x(run.t0)), bx1 = Math.min(W - padR, x(run.t1)); if (bx1 - bx0 < 0.5) return;
          var bw = bx1 - bx0, names = run.cats.map(function (k) { return k.nome; }).join(" + ");
          function rect(y0, hh, fill, op) { var r = document.createElementNS(SVGNS, "rect"); r.setAttribute("x", bx0); r.setAttribute("y", y0); r.setAttribute("width", bw); r.setAttribute("height", Math.max(0, hh)); r.setAttribute("fill", fill); r.setAttribute("opacity", op); r.setAttribute("pointer-events", "none"); var tl = document.createElementNS(SVGNS, "title"); tl.textContent = names; r.appendChild(tl); svg.appendChild(r); }
          if (run.cats.length === 1) { rect(plotTop, plotH, self._catColor(run.cats[0]), opTB); return; }
          if (ovMode === "split") { var hh = plotH / run.cats.length; run.cats.forEach(function (k, i) { rect(plotTop + i * hh, hh, self._catColor(k), opTB); }); }
          else if (ovMode === "highlight") rect(plotTop, plotH, self._hatchPattern(svg, "hl", ["#e8636b"]), Math.min(1, opTB + 0.28));
          else if (ovMode === "neutral") rect(plotTop, plotH, self._hatchPattern(svg, "hn", ["#8899aa"]), Math.min(1, opTB + 0.14));
          else rect(plotTop, plotH, self._hatchPattern(svg, "hm_" + run.cats.map(function (k) { return k.id; }).join("_"), run.cats.map(function (k) { return self._catColor(k); })), Math.min(1, opTB + 0.18));
        });
      }
      // grade horizontal + rótulos de nível (só na escala compartilhada; normalizada não tem nível único)
      if (c.spGrid !== false) {
        for (var lvl = 1; lvl <= gmax; lvl++) { var yy = yAbs(lvl); line(padL, yy, W - padR, yy, "var(--line)", lvl === 1 ? 1 : 0.5, lvl === 1 ? null : "2 3", lvl === 1 ? 1 : c.spGridOpacity); if (!c.spNormalize) txt(padL - 6, yy + 3, String(lvl), "end", szTick); }
      }
      if (c.spNormalize) { txt(padL - 6, plotTop + 3, "máx", "end", szTick); txt(padL - 6, plotTop + plotH + 3, "mín", "end", szTick); }
      var baseY = yAbs(1), step = this._niceStep(vSpan, plotW);
      for (var tk = 0; tk <= vEnd + 1e-6; tk += step) { var xx = x(tk); line(xx, baseY, xx, baseY + 3, "var(--txt-dim)", 1); txt(xx, baseY + 16, P.fmtTime(tk, step < 1), "middle", szTick); }
      // uma linha em degraus por dimensão, com faixa (lane) para não sobrepor no mesmo escore
      var Nd = dims.length;
      dims.forEach(function (d, di) {
        var off = (di - (Nd - 1) / 2) * laneGap;
        var cor = self._dimColorFig(d, di), dash = self._dimDashFig(di);
        var segs = (d.segments || []).slice().filter(function (s) { return isFinite(s.tStart) && isFinite(s.tEnd) && s.value !== "" && isFinite(parseFloat(s.value)); }).sort(function (a, b) { return a.tStart - b.tStart; });
        var prev = null;
        segs.forEach(function (s) {
          var sc = parseFloat(s.value), yy = yFor(d, sc) + off, x0 = x(s.tStart), x1 = x(s.tEnd);
          if (prev && Math.abs(s.tStart - prev.tEnd) < 0.02) line(x0, prev.y, x0, yy, cor, Math.max(0.6, lineW * 0.7));
          var seg = line(x0, yy, x1, yy, cor, lineW, dash); seg.setAttribute("stroke-linecap", dash ? "butt" : "round");
          if (ptR > 0) { var pc = document.createElementNS(SVGNS, "circle"); pc.setAttribute("cx", x0); pc.setAttribute("cy", yy); pc.setAttribute("r", ptR); pc.setAttribute("fill", cor); svg.appendChild(pc); }
          prev = { tEnd: s.tEnd, y: yy };
        });
      });
      // índices (ocorrências) DENTRO da faixa do gráfico: tracejado + diamante na base, rótulos EMPILHADOS para cima (como no modo de codificação)
      if (c.spIndices) {
        var marks = [];
        dims.forEach(function (d, di) { (d.marks || []).forEach(function (mk) { if (mk && isFinite(mk.t)) marks.push({ x: x(mk.t), code: mk.code || "", cor: self._dimColorFig(d, di) }); }); });
        if (marks.length) {
          marks.sort(function (a, b) { return a.x - b.x; });
          var lh = szIdx + (isFinite(c.spIndexStackGap) ? +c.spIndexStackGap : 4), hgap = isFinite(c.spIndexHGap) ? +c.spIndexHGap : 3;
          var rowsRight = [], showLab = c.spIndexLabels, tick = c.spIndexTick !== false;
          var dsz = Math.max(0.5, +c.spIndexDiamond || 3.5), tkW = +c.spIndexTickW || 1, tkDash = (c.spIndexTickDash != null) ? c.spIndexTickDash : "2 3", tkOp = isFinite(c.spIndexTickOpacity) ? +c.spIndexTickOpacity : 0.45;
          marks.forEach(function (m) {
            if (tick) line(m.x, plotTop, m.x, baseY, m.cor, tkW, tkDash || null, tkOp);
            var dm = document.createElementNS(SVGNS, "path"); dm.setAttribute("d", "M" + m.x + " " + (baseY - dsz) + " l" + dsz + " " + dsz + " l" + (-dsz) + " " + dsz + " l" + (-dsz) + " " + (-dsz) + " z"); dm.setAttribute("fill", m.cor); dm.setAttribute("stroke", "#fff"); dm.setAttribute("stroke-width", 0.6); svg.appendChild(dm);
            if (showLab && m.code) {
              var w = Math.max(12, m.code.length * szIdx * 0.62), left = m.x - w / 2, lvl = 0;
              while (rowsRight[lvl] != null && left < rowsRight[lvl] + hgap) lvl++;
              rowsRight[lvl] = m.x + w / 2;
              txt(m.x, baseY - 9 - lvl * lh, m.code, "middle", szIdx, m.cor);
            }
          });
        }
      }
      // legenda (traço com a cor/tracejado de cada dimensão)
      if (legPos !== "none") {
        function swatch(sx, sy, di) { var l = document.createElementNS(SVGNS, "line"); l.setAttribute("x1", sx); l.setAttribute("y1", sy); l.setAttribute("x2", sx + 16); l.setAttribute("y2", sy); l.setAttribute("stroke", self._dimColorFig(dims[di], di)); l.setAttribute("stroke-width", Math.max(2, lineW)); var dd = self._dimDashFig(di); if (dd) l.setAttribute("stroke-dasharray", dd); svg.appendChild(l); }
        if (legPos === "right") {
          var ly = plotTop + 8;
          dims.forEach(function (d, di) { swatch(W - padR + 10, ly - 2, di); txt(W - padR + 32, ly, d.name, "start", szLeg, "var(--txt)"); ly += szLeg + 6; });
        } else {
          var lx = padL, lyH = legPos === "top" ? padT + szLeg : H - 6;
          dims.forEach(function (d, di) { swatch(lx, lyH - 3, di); txt(lx + 20, lyH, d.name, "start", szLeg, "var(--txt)"); lx += 20 + (d.name || "").length * szLeg * 0.55 + 14; });
        }
      }
      return svg;
    },
    _followPlay: true,           // com zoom, a vista dos step-plots acompanha a agulha (como o "vincular" da timeline); desacoplar deixa rolar livre
    setFollowPlay: function (on) { this._followPlay = !!on; try { localStorage.setItem("praxis.mdim.followplay", on ? "1" : "0"); } catch (e) {} if (on) { var t = P.Segmenter.media ? Math.max(0, P.Segmenter.annNow ? P.Segmenter.annNow() : 0) : this._t; this._followNeedle(t); } this.render(); },
    // Desloca a janela de zoom (_view) para manter a agulha visível. Retorna true se moveu.
    _followNeedle: function (t) {
      var v = this._view; if (!v || !v.span) return false;   // sem zoom: tudo já visível
      if (!isFinite(t)) return false;
      var maxT = this.maxTime(), span = v.span, start = v.start || 0, lead = span * 0.12;
      if (t >= start + lead && t <= start + span - lead) return false;   // confortavelmente dentro
      var ns = Math.max(0, Math.min(t - span * 0.15, Math.max(0, maxT - span)));
      if (Math.abs(ns - start) < 1e-3) return false;
      v.start = ns; return true;
    },
    // Botão-ícone (corrente, padrão do Praxis: mesmo do «vincular» da timeline) para acoplar/desacoplar o acompanhamento, no cabeçalho do eixo de codificação.
    _followBtn: function () {
      var self = this, b = document.createElement("button");
      b.className = "icon-btn" + (this._followPlay ? " active" : "");
      b.style.cssText = "flex:0 0 auto";
      b.title = "Acompanhar a reprodução: com zoom, a vista segue a agulha. Desative para rolar livre.";
      b.innerHTML = '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><path d="M7 11a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M11 7a3 3 0 0 0-4.2 0L4.5 9.3a3 3 0 0 0 4.2 4.2l1-1"/></svg>';
      b.addEventListener("click", function () { self.setFollowPlay(!self._followPlay); });
      return b;
    },
    // Estágios do Gráfico convertidos para faixas de tempo: [{t0, t1, tint, name}].
    // Fonte: doc ativo do Gráfico; se não houver, o primeiro conjunto que tenha estágios.
    _stageBands: function () {
      var G = P.GCP; if (!G) return [];
      var stages = null, segs = null;
      if (G.data && G.data.stages && G.data.stages.length && G.data.segments && G.data.segments.length) { stages = G.data.stages; segs = G.data.segments; }
      else if (G.conjuntos && G.datasets) {
        for (var cid in G.conjuntos) {
          var cj = G.conjuntos[cid];
          if (cj && cj.stages && cj.stages.length) { var ds = G.datasets[cj.datasetId]; if (ds && ds.segments && ds.segments.length) { stages = cj.stages; segs = ds.segments; break; } }
        }
      }
      if (!stages || !segs) return [];
      // mesma base de índice que o GCP: segmentos com compasso finito, na ordem do dataset (já ordenado por tStart).
      // from/to dos estágios são 1-based nesse array (segNums = gi+1), então subtrai 1.
      var all = segs.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); });
      var bands = [];
      stages.forEach(function (st, k) {
        var a = all[(st.from || 1) - 1], b = all[(st.to || all.length) - 1];
        if (!a || !b) return;
        var t0 = isFinite(a.tStart) ? a.tStart : null, t1 = isFinite(b.tEnd) ? b.tEnd : null;
        if (t0 == null || t1 == null || t1 <= t0) return;   // estágio sem tempo (dataset só por compasso) não pinta
        bands.push({ t0: t0, t1: t1, tint: st.tint || "#8899aa", name: st.name || ("Estágio " + (k + 1)) });
      });
      return bands;
    },
    _sel: null,                  // troca de escore selecionada {tierId, index}
    _selMark: null,              // marcador de índice selecionado {tierId, t, code} (clique seleciona; «×»/Delete remove)
    _deleteSelMark: function () {
      var sm = this._selMark; if (!sm) return;
      var t = this._tierById(sm.tierId); this._selMark = null;
      if (!t || !t.marks) { this.render(); return; }
      var mk = t.marks.filter(function (m) { return Math.abs(m.t - sm.t) < 1e-6 && m.code === sm.code; })[0];
      if (mk) P.Segmenter.removeIndexMark(t.id, mk); else this.render();
    },
    _svgs: [],
    _radar: null,                // {svg, poly, dots[], axes[], cx, cy, R, ...}
    _speed: 1, _playing: false,  // transporte da ④ (relógio virtual quando não há mídia)
    _t: 0, _lastTs: 0,           // tempo de análise (s) do relógio virtual
    _editCatId: null,            // categoria em edição
    _focusCatId: null,           // categoria com faixas em prévia (mesmo inativa)
    // Customização persistente do radar (M5). Cores dos traços são concretas
    // (defaults neutros que leem em claro e escuro); os textos seguem o tema.
    cfg: {
      bw: false,
      axisColor: "#8aa0b4", axisWidth: 0.8,
      ringColor: "#9aacbd", ringWidth: 0.6, showRings: true,
      gridStyle: "teia-vanish",   // grade interna: teia-prop | teia-exata | teia-vanish | circulos | marcas | nenhuma
      outerContour: "poligono",   // contorno externo: poligono (liga as pontas) | exata | circulo | nenhum
      outerColor: "#7a8a99", outerWidth: 1.6,
      showScaleNumbers: true,     // rótulo "1–N" por eixo
      polyOpacity: 0.33, outlineWidth: 2, showPoints: true,
      scalePos: "tip",            // faixa da escala 1–N: "tip" (sob o nome, na ponta do eixo) | "inside" (dentro do radar, junto à ponta)
      tipTypeRange: true,
      tickAxes: "auto",
      tickAngle: 90,              // um valor por linha: ângulo (graus, 0 = direita, 90 = topo) onde os valores ficam, sobre a linha
      tickOffset: 0,              // deslocamento radial dos valores em px (+ acima/fora da linha, − abaixo/dentro)           // valores da grade dentro do radar: "auto" (1 eixo se escalas iguais, todos se assimétricas) | "first" | "all"         // com um tipo em foco, a ponta do eixo mostra o INTERVALO do tipo (a escala 1–N vai para dentro)
      radarCenter: "min",         // centro do radar: "min" (nível 1 no centro) | "zero" (centro = 0, o 1 no 1º anel)
      normalize: true,            // true: raio por escala própria; false: raio por escala global (escores no mesmo raio)
      neutralCor: "#8899aa", neutralPattern: "solid", neutralDash: "",   // estilo do polígono quando NENHUM tipo está ativo ("sem tipo")
      outlineCustom: false, outlineColor: "#111111",   // cor própria do contorno (senão segue o preenchimento)
      bandCustom: false, bandColor: "#888888",         // cor própria da faixa do tipo (range) (senão segue a cor do tipo)
      bandOpacity: 0.4,           // opacidade da faixa (range) do tipo de prática
      bandWidth: 9, bandRound: true,                   // grossura e arredondamento das pontas da faixa (range)
      labelCurve: false,          // rótulo do eixo curvado ao longo de um arco (acompanha o círculo)
      labelSize: 11, labelGap: 18, labelBold: true,     // tamanho, distância (além da ponta do eixo) e negrito do rótulo do eixo
      bandStyle: "lines",         // faixa do tipo: "lines" (barra por eixo) | "ring" (anel entre o polígono do mín e do máx, miolo vazado)
      showTypeMean: false,        // linha do nível médio de cada dimensão DURANTE o tipo (polígono + pontos)
      meanColor: "#000000", meanWidth: 2.5,
      meanSource: "sessions",     // "sessions" = sessões carregadas em Figuras (se houver), senão a sessão atual | "current" = só a atual
      statePoly: true,            // figura de tipos: mostra o polígono do NÍVEL MÉDIO do tipo (modo barra); desligue p/ ficar só faixa
      figLegend: true,            // figura de tipos: legenda (faixa / média) no rodapé
      legBandText: "Faixa de níveis que define o tipo", legMeanText: "Nível médio observado",
      figW: 440, figH: 340,       // tamanho da figura (radar) em px - usado no export e, se vinculado, na visualização
      linkExport: true,           // true: o que se vê é o que se exporta; false: vê confortável, exporta parametrizado
      // --- formatação da figura de tipos (small multiples) ---
      figOrder: [],               // ordem dos tipos por id (vazio = ordem das categorias); ids ausentes anexados
      figSel: null,               // ids marcados p/ aparecer (null = todos)
      figFont: "Arial, Helvetica, sans-serif",
      figMargin: 14,              // margem ao redor e entre as células (px)
      figCols: 0,                 // colunas por linha (0 = automático, até 4)
      figScale: 1,                // escala do tamanho da figura (1 = 440×340 por célula)
      figDpi: 300,                // DPI do PNG/JPG (SVG é vetorial, ignora) - padrão de publicação
      figInclude: { title: true, pct: true, uses: true, before: true, after: true },
      // --- aparência das faixas de tipo de prática nos step-plots ---
      typeBandOpacity: 0.18,      // opacidade das faixas de tipo ao fundo dos step-plots
      typeOverlapMode: "hatch",   // sobreposição de tipos: hatch (rachura c/ as cores) | highlight (realce vermelho) | neutral (rachura neutra) | split (sub-faixas)
      typeColors: {},             // cor própria por tipo nos gráficos {catId: "#rrggbb"} (ausente = cor do tipo)
      // --- parâmetros do modo de FORMATAÇÃO (figura para publicação) ---
      figUnit: "px",              // unidade do tamanho de export: px | cm | mm | in
      figSizeVal: 720,            // LARGURA da figura no unit atual (px=720; cm/mm/in = medida física)
      figBg: "#ffffff",           // fundo da figura
      figGutter: 18,              // espaço entre elementos (px)
      figPad: 14,                 // margem externa da figura (px)
      figElemBorder: false, figElemBorderColor: "#c8d2db", figElemBorderW: 1,   // borda por elemento
      figFrame: false, figFrameColor: "#c8d2db", figFrameW: 1,                  // moldura da figura toda
      figPanelLetters: false,     // letras de painel (A, B, C)
      // tipografia (tamanhos independentes)
      figSzTitle: 12, figSzAxis: 11, figSzTick: 9, figSzLegend: 10, figSzStats: 12, figSzPanel: 13,
      // step-plots (por eixo e integrado)
      spRowPx: 22,                // altura de linha do plot (px por nível)
      spLineW: 2.2,               // espessura da linha em degraus
      spLaneGap: 3.5,             // distância entre faixas de dimensões no mesmo escore (empilhamento)
      spPointR: 0,                // raio dos pontos de troca (0 = sem pontos)
      spGrid: true, spGridOpacity: 1,   // grade horizontal
      spIndices: false, spIndexLabels: false, spIndexSize: 8,   // índices no step-plot integrado
      spIndexStackGap: 4,         // espaçamento vertical entre níveis empilhados dos índices
      spIndexHGap: 3,             // folga horizontal para considerar que dois índices NÃO se sobrepõem (empilhar)
      spIndexDiamond: 3.5,        // meia-diagonal do diamante do índice (tamanho do símbolo)
      spIndexTick: true,          // linha vertical no índice (como no modo de codificação)
      spIndexTickW: 1,            // espessura do traço do índice
      spIndexTickDash: "2 3",     // padrão do traço ("" = sólido)
      spIndexTickOpacity: 0.45,   // opacidade do traço do índice
      spNormalize: false,         // integrado: normalizar cada eixo à própria escala (senão escala compartilhada)
      spLegend: true, spLegendPos: "right", spLegendSize: 10,   // legenda do integrado: pos = right|top|bottom|none
      figMono: false,             // P&B: linhas em cinza escuro, distintas por tracejado
      figLineDash: false,         // tracejado por dimensão mesmo em cor
      figCbPalette: false         // paleta categórica segura para daltônicos (Okabe-Ito) nas dimensões
    },
    CB_PALETTE: ["#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"],   // Okabe-Ito
    DIM_DASHES: ["", "6 3", "2 2", "8 3 2 3", "1 3", "10 4 2 4"],
    _compares: [],                // camadas comparativas {id,nome,cor,dims,t,playing,speed,lastTs}
    _mode: "overlay",             // "overlay" | "side"
    _catDots: [],                // indicadores "acende/apaga" na lista
    SPEEDS: [1, 2, 5, 10, 20],
    MEDIA_MAX_RATE: 16,          // navegador limita playbackRate (~16); acima disso só o relógio virtual chega

    init: function (refs) {
      this.refs = refs || {};
      var self = this;
      this._loadCfg();
      if (refs.exemplo) refs.exemplo.addEventListener("click", function () { self.loadExample(); });
      if (refs.didatico) refs.didatico.addEventListener("click", function () { self.loadDidactic(); });
      if (refs.addDim) refs.addDim.addEventListener("click", function () { P.Segmenter.addDimension("mdim-tier-editor", "mdim-tier-editor-wrap"); self.refresh(); });   // cria e edita a dimensão aqui mesmo (sem trocar de aba)
      if (refs.activedim) refs.activedim.addEventListener("change", function () { self._activeDimId = this.value; self._sel = null; self._selMark = null; self.renderCoder(); });
      document.addEventListener("keydown", function (ev) { self._onKey(ev); });
    },

    // Camadas-dimensão do projeto (fonte única em P.Segmenter.tiers).
    dims: function () { return (P.Segmenter.tiers || []).filter(function (t) { return t.kind === "dimensao"; }); },
    activeDim: function () { var self = this, ds = this.dims(); return ds.filter(function (t) { return t.id === self._activeDimId; })[0] || ds[0] || null; },
    _tierById: function (id) { return (P.Segmenter.tiers || []).filter(function (t) { return t.id === id; })[0]; },

    // Teclado da ④: Espaço toca/pausa, setas navegam, 1..N inserem troca na
    // dimensão ativa, Delete remove a troca selecionada. (Não dispara em ①: lá o
    // teclado é do Segmenter, que checa a aba ativa.)
    _onKey: function (ev) {
      if (!this._shown) return;
      var tag = (ev.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (ev.ctrlKey || ev.metaKey) {   // desfazer/refazer também valem na aba Multidim (histórico é compartilhado com o Segmenter)
        var _a = P.Keys && P.Keys.actionFor(ev);
        if (_a === "undo") { ev.preventDefault(); P.Segmenter.undo(); this.refresh(); return; }
        if (_a === "redo") { ev.preventDefault(); P.Segmenter.redo(); this.refresh(); return; }
        return;
      }
      if (ev.altKey) return;
      var S = P.Segmenter;
      if (ev.code === "Space") { ev.preventDefault(); this.togglePlay(); return; }
      if (ev.code === "ArrowLeft") { ev.preventDefault(); this.nudge(ev.shiftKey ? -1 : -S.frameStep); return; }
      if (ev.code === "ArrowRight") { ev.preventDefault(); this.nudge(ev.shiftKey ? 1 : S.frameStep); return; }
      if (ev.code === "ArrowUp") { ev.preventDefault(); this._cycleActiveDim(-1); return; }     // troca o eixo ativo (útil no modo de codificação)
      if (ev.code === "ArrowDown") { ev.preventDefault(); this._cycleActiveDim(1); return; }
      if (ev.code === "Delete" || ev.code === "Backspace") {
        if (this._selMark) { ev.preventDefault(); this._deleteSelMark(); return; }
        if (this._sel) { ev.preventDefault(); var t = this._tierById(this._sel.tierId); if (t) S.dimDeleteSwitch(t, this._sel.index); this._sel = null; }
        return;
      }
      if (ev.key >= "1" && ev.key <= "9") {
        var d = this.activeDim(); if (!d) return;
        var i = +ev.key - 1; if (d.vocab[i]) { ev.preventDefault(); S.dimSwitchAt(d, this._codeT(), d.vocab[i].code); }
        return;
      }
      if (ev.key && ev.key.length === 1) {   // teclas personalizadas da dimensão ativa: escores 10+ E índices
        var dd = this.activeDim(); if (!dd) return;
        var kk = ev.key.toLowerCase();
        if (dd.vocab) for (var j = 0; j < dd.vocab.length; j++) { if (dd.vocab[j].key && String(dd.vocab[j].key).toLowerCase() === kk) { ev.preventDefault(); S.dimSwitchAt(dd, this._codeT(), dd.vocab[j].code); return; } }
        if (dd.indices && S.addIndexMark) for (var mm = 0; mm < dd.indices.length; mm++) { if (dd.indices[mm].key && String(dd.indices[mm].key).toLowerCase() === kk) { ev.preventDefault(); S.addIndexMark(dd, dd.indices[mm].code, this._codeT()); return; } }
      }
    },

    // Fim do tempo analisado: mídia carregada ou o maior tEnd das dimensões.
    maxTime: function () {
      var m = 0;
      this.dims().forEach(function (t) { t.segments.forEach(function (s) { if (s.tEnd > m) m = s.tEnd; }); });
      var md = P.Segmenter.media;
      if (md && isFinite(md.duration) && md.duration > 0) m = Math.max(m, md.duration - (P.Segmenter.mediaOffset || 0));
      return m > 0 ? m : 1;
    },

    onShow: function () { this._shown = true; this.refresh(); this._loop(); },
    onHide: function () { this._shown = false; this._playing = false; cancelAnimationFrame(this._raf); },

    // --- Transporte da ④ (radar + linhas juntos) --------------------------------
    // Tempo de análise corrente (s): a mídia manda quando existe; senão, o relógio
    // virtual (permite revisar a trajetória codificada mesmo sem mídia).
    currentT: function () {
      var md = P.Segmenter.media;
      if (md) return Math.max(0, P.Segmenter.annNow ? P.Segmenter.annNow() : md.currentTime);
      return Math.max(0, Math.min(this.maxTime(), this._t || 0));
    },
    // Tempo em que codificar na aba ④: relógio bruto da própria aba (mídia OU virtual) menos o delay de reação.
    // NÃO usa currentT() porque ele clampa o relógio virtual ao maxTime (pequeno com poucos segmentos), o que jogava
    // as trocas pro mesmo tempo. (E S.now() retornava 0 sem mídia, fazendo um escore apagar o outro.)
    _codeT: function () {
      var md = P.Segmenter.media;
      var t = md ? Math.max(0, P.Segmenter.annNow ? P.Segmenter.annNow() : md.currentTime) : Math.max(0, this._t || 0);
      return Math.max(0, t - (P.Segmenter.delayMs || 0) / 1000);
    },
    // Posiciona a agulha (scrub): move a mídia, ou o relógio virtual.
    seekT: function (t) {
      t = Math.max(0, Math.min(this.maxTime(), t));
      if (P.Segmenter.media) P.Segmenter.seekTo(t); else this._t = t;
      this._updateNeedle(); this._updateRadar();
    },
    nudge: function (dt) { this.seekT(this.currentT() + dt); },
    togglePlay: function () {
      var md = P.Segmenter.media;
      // com mídia, só alterna play/pause: NÃO reimpõe this._speed (senão o Espaço zerava a velocidade
      // ajustada pela barra do Segmentar). A velocidade corrente da mídia é a fonte da verdade.
      if (md) { P.Segmenter.togglePlay(); }
      else { this._playing = !this._playing; this._lastTs = 0; if (this._t >= this.maxTime() - 0.01) this._t = 0; }
      this._syncTransportUI();
    },
    setSpeed: function (v) {
      this._speed = v;
      var md = P.Segmenter.media;
      if (md && !md.paused) P.Segmenter.setSpeed(Math.min(v, this.MEDIA_MAX_RATE));
      else if (md) { try { md.playbackRate = Math.min(v, this.MEDIA_MAX_RATE); } catch (e) {} }
      this._syncTransportUI();
    },
    _isPlaying: function () { var md = P.Segmenter.media; return md ? !md.paused : this._playing; },
    _syncTransportUI: function () {
      var r = this._radar; if (!r || !r.playBtn) return;
      var md = P.Segmenter.media;
      if (md && isFinite(md.playbackRate) && md.playbackRate > 0) this._speed = md.playbackRate;   // com mídia, espelha a velocidade real (inclui a ajustada no Segmentar)
      r.playBtn.innerHTML = this._isPlaying() ? P.ICON.pause : P.ICON.play;
      var self = this;
      (r.speedBtns || []).forEach(function (b) { b.classList.toggle("active", parseFloat(b.dataset.sp) === self._speed); });
    },

    // Redesenha a lista lateral, o codificador, as categorias e os gráficos.
    refresh: function () {
      if (!this.refs.canvas) return;
      this.renderSidebar();
      this.renderCoder();
      this.renderCategories();
      this.renderCompares();
      this.renderPresets();
      this.renderAppearance();
      this.renderExport();
      this.renderGif();
      this.renderTypeAppearance();
      this.render();
    },

    // --- Tipos de prática (categorias) ------------------------------------------
    // Para diferenciar tipos (útil em P&B): cada categoria tem cor + padrão de
    // preenchimento + traço (dash) do contorno/faixa, com defaults que já variam.
    CAT_PATTERNS: ["solid", "diag", "cross", "dots", "diag2", "horiz", "vert"],
    CAT_DASHES: ["", "5 4", "2 3", "8 3 2 3", "1 3"],
    _newCatId: function () { var ids = (P.Segmenter.categories || []).map(function (c) { return c.id; }), i = 1; while (ids.indexOf("cat" + i) >= 0) i++; return "cat" + i; },
    // Um parâmetro de TIPO mudou (nome, cor, padrão, traço, intervalos, estilo "sem tipo"): o radar ao vivo
    // atualiza na hora; o que é montado no render (figuras das Figuras/Formatação, faixas de tipo nos step-plots,
    // prévia da figura de tipos no inspetor, estatísticas) é refeito logo depois (debounce p/ digitação).
    _typesChanged: function () {
      var self = this;
      this._tmCache = null;            // médias por tipo dependem dos intervalos
      this._updateRadar();
      clearTimeout(this._tcTimer);
      this._tcTimer = setTimeout(function () {
        if (P.Segmenter.commit) P.Segmenter.commit();   // edição de tipo vira um passo do desfazer (os tipos estão no histórico)
        self.render();
        if (self._renderFigPreview) self._renderFigPreview();
        var mp = document.getElementById("mdim-matrix-panel");   // lista de tipos da figura (nomes/cores), se não estiver sendo editada
        if (self._viewMode === "matrix" && mp && mp.children.length && !mp.contains(document.activeElement)) self.renderMatrixPanel();
      }, 150);
    },
    addCategory: function () {
      var dims = this.dims();
      if (!dims.length) { alert("Crie ao menos uma dimensão antes de definir tipos de prática."); return; }
      var iv = {}; dims.forEach(function (d) { iv[d.id] = [1, P.Segmenter.escalaMaxOf(d)]; });   // começa restringindo tudo à faixa cheia
      var n = (P.Segmenter.categories || []).length;
      var c = { id: this._newCatId(), nome: "Tipo " + (n + 1), cor: P.PALETTE_COLOR[n % P.PALETTE_COLOR.length], pattern: this.CAT_PATTERNS[n % this.CAT_PATTERNS.length], dash: this.CAT_DASHES[n % this.CAT_DASHES.length], intervalos: iv };
      P.Segmenter.categories.push(c);
      this._editCatId = c.id;
      this.renderCategories(); this._typesChanged();
    },
    removeCategory: function (id) {
      P.Segmenter.categories = (P.Segmenter.categories || []).filter(function (c) { return c.id !== id; });
      if (this._editCatId === id) this._editCatId = null;
      if (this._focusCatId === id) this._focusCatId = null;
      this.renderCategories(); this._typesChanged();
    },

    renderCategories: function () {
      var self = this, host = this.refs.cats; if (!host) return;
      var cats = P.Segmenter.categories || [], dims = this.dims();
      host.innerHTML = ""; this._catDots = [];
      if (!cats.length) host.innerHTML = '<div class="hint" style="margin-bottom:6px">Nenhum tipo de prática. Um tipo «acende» quando o escore de todas as dimensões que ele restringe cai nos intervalos.</div>';
      cats.forEach(function (c) {
        var row = document.createElement("div");
        row.className = "row"; row.style.cssText = "margin-bottom:5px;align-items:center;gap:6px";
        var focused = self._focusCatId === c.id;
        row.innerHTML =
          '<span data-dot style="flex:0 0 10px;height:10px;border-radius:50%;background:transparent;border:1px solid ' + c.cor + '" title="acende quando o tipo está ativo"></span>' +
          '<b style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + P.escapeHtml(c.nome) + '">' + P.escapeHtml(c.nome) + '</b>' +
          '<button class="btn sm ghost" data-prev title="Prévia das faixas no radar" style="flex:0 0 auto;' + (focused ? 'border-color:var(--accent)' : '') + '">' + (focused ? P.ICON.eye : P.ICON.eyeOff) + '</button>' +
          '<button class="btn sm ghost" data-edit title="Editar intervalos" style="flex:0 0 auto">' + P.ICON.edit + '</button>' +
          '<button class="btn sm ghost" data-del title="Remover" style="flex:0 0 auto">' + P.ICON.close + '</button>';
        row.querySelector("[data-prev]").addEventListener("click", function () { self._focusCatId = focused ? null : c.id; self.renderCategories(); self._updateRadar(); });
        row.querySelector("[data-edit]").addEventListener("click", function () { self._editCatId = self._editCatId === c.id ? null : c.id; self.renderCategories(); });
        row.querySelector("[data-del]").addEventListener("click", function () { self.removeCategory(c.id); });
        host.appendChild(row);
        self._catDots.push({ id: c.id, el: row.querySelector("[data-dot]"), cor: c.cor });
        if (self._editCatId === c.id) host.appendChild(self._catEditor(c, dims));
      });
      // "Sem tipo" - o estado quando nenhum tipo de prática está ativo (não conta como tipo,
      // mas é colorizável/customizável para o pesquisador que não quer tratá-lo como categoria).
      host.appendChild(this._neutralRow());
      var add = document.createElement("button");
      add.className = "btn ghost wide"; add.style.marginTop = "4px"; add.textContent = "Novo tipo de prática";
      add.addEventListener("click", function () { self.addCategory(); });
      host.appendChild(add);
      if (this.renderGif) this.renderGif();   // mantém o painel «Estados dos tipos» em sincronia com os tipos (criar/remover/renomear)
      if (this.renderTypeAppearance) this.renderTypeAppearance();   // e o editor de cor por tipo das faixas
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);
    },
    // Linha + editor do estado "sem tipo" (cor/preenchimento/contorno próprios, em cfg.neutral*).
    _neutralRow: function () {
      var self = this, cfg = this.cfg, wrap = document.createElement("div");
      var open = this._editCatId === "__neutral__";
      var row = document.createElement("div"); row.className = "row"; row.style.cssText = "margin-bottom:5px;align-items:center;gap:6px;opacity:.9";
      row.innerHTML =
        '<span style="flex:0 0 10px;height:10px;border-radius:50%;background:' + cfg.neutralCor + ';border:1px solid ' + cfg.neutralCor + '" title="cor quando nenhum tipo está ativo"></span>' +
        '<b style="flex:1"><span class="mini" style="color:var(--txt-dim)">Sem tipo</span> <span class="mini" style="color:var(--txt-dim)">(quando não é nada)</span></b>' +
        '<button class="btn sm ghost" data-edit title="Editar aparência do «sem tipo»" style="flex:0 0 auto">' + P.ICON.edit + '</button>';
      row.querySelector("[data-edit]").addEventListener("click", function () { self._editCatId = open ? null : "__neutral__"; self.renderCategories(); });
      wrap.appendChild(row);
      if (open) {
        var patOpts = [["solid", "sólido"], ["diag", "hachura /"], ["diag2", "hachura \\"], ["cross", "grade"], ["horiz", "horizontal"], ["vert", "vertical"], ["dots", "pontos"]];
        var dashOpts = [["", "sólido"], ["5 4", "tracejado"], ["2 3", "pontilhado"], ["8 3 2 3", "traço-ponto"], ["1 3", "denso"]];
        var box = document.createElement("div");
        box.style.cssText = "margin:2px 0 8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)";
        box.innerHTML =
          '<div class="row" style="margin-bottom:6px;gap:6px;align-items:center"><input type="color" data-ncor value="' + cfg.neutralCor + '" style="flex:0 0 34px;height:30px;padding:2px"><span class="mini" style="flex:1">cor do «sem tipo»</span></div>' +
          '<div class="row" style="gap:6px"><label class="mini" style="flex:1">preenchimento<select data-npat style="width:100%">' + patOpts.map(function (p) { return '<option value="' + p[0] + '"' + (cfg.neutralPattern === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></label>' +
          '<label class="mini" style="flex:1">contorno<select data-ndash style="width:100%">' + dashOpts.map(function (p) { return '<option value="' + p[0] + '"' + (cfg.neutralDash === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></label></div>' +
          '<div class="row" style="margin-top:6px"><button class="btn sm ghost" data-close style="flex:1">Fechar</button></div>';
        box.querySelector("[data-ncor]").addEventListener("input", function () { cfg.neutralCor = this.value; self._saveCfg(); self._typesChanged(); });
        box.querySelector("[data-ncor]").addEventListener("change", function () { self.renderCategories(); });
        box.querySelector("[data-npat]").addEventListener("change", function () { cfg.neutralPattern = this.value; self._saveCfg(); self._typesChanged(); });
        box.querySelector("[data-ndash]").addEventListener("change", function () { cfg.neutralDash = this.value; self._saveCfg(); self._typesChanged(); });
        box.querySelector("[data-close]").addEventListener("click", function () { self._editCatId = null; self.renderCategories(); });
        wrap.appendChild(box);
      }
      return wrap;
    },

    // Editor inline de uma categoria: nome, cor e, por dimensão, considerar? + [min..max].
    _catEditor: function (c, dims) {
      var self = this, box = document.createElement("div");
      box.style.cssText = "margin:2px 0 8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)";
      var nameRow = document.createElement("div"); nameRow.className = "row"; nameRow.style.marginBottom = "6px";
      nameRow.innerHTML = '<input type="text" data-name value="' + P.escapeHtml(c.nome) + '" placeholder="nome do tipo" style="flex:1"><input type="color" data-color value="' + P.escapeHtml(c.cor) + '" style="flex:0 0 34px;height:30px;padding:2px">';
      box.appendChild(nameRow);
      nameRow.querySelector("[data-name]").addEventListener("input", function () { c.nome = this.value; self._typesChanged(); });
      var colInp = nameRow.querySelector("[data-color]");
      // input: só atualiza a cor + o radar ao vivo (NÃO reconstrói o painel, senão o seletor de cor fecha).
      colInp.addEventListener("input", function () { c.cor = this.value; self._typesChanged(); });
      // change (quando o seletor fecha): reconstrói para sincronizar swatches/indicadores da lista.
      colInp.addEventListener("change", function () { self.renderCategories(); });
      // padrão de preenchimento + traço (contorno e faixa) próprios do tipo - diferenciam os tipos
      var patOpts = [["solid", "sólido"], ["diag", "hachura /"], ["diag2", "hachura \\"], ["cross", "grade"], ["horiz", "horizontal"], ["vert", "vertical"], ["dots", "pontos"]];
      var dashOpts = [["", "sólido"], ["5 4", "tracejado"], ["2 3", "pontilhado"], ["8 3 2 3", "traço-ponto"], ["1 3", "denso"]];
      var styleRow = document.createElement("div"); styleRow.className = "row"; styleRow.style.cssText = "margin-bottom:6px;gap:6px";
      styleRow.innerHTML =
        '<label class="mini" style="flex:1">preenchimento<select data-pat style="width:100%">' + patOpts.map(function (p) { return '<option value="' + p[0] + '"' + ((c.pattern || "solid") === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></label>' +
        '<label class="mini" style="flex:1">contorno e faixa<select data-dash style="width:100%">' + dashOpts.map(function (p) { return '<option value="' + p[0] + '"' + ((c.dash || "") === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></label>';
      styleRow.querySelector("[data-pat]").addEventListener("change", function () { c.pattern = this.value; self._typesChanged(); });
      styleRow.querySelector("[data-dash]").addEventListener("change", function () { c.dash = this.value; self._typesChanged(); });
      box.appendChild(styleRow);
      dims.forEach(function (d) {
        var n = P.Segmenter.escalaMaxOf(d), on = !!c.intervalos[d.id], iv = c.intervalos[d.id] || [1, n];
        var r = document.createElement("div"); r.className = "row"; r.style.cssText = "margin-bottom:4px;align-items:center;gap:6px";
        function opts(sel) { var o = ""; for (var k = 1; k <= n; k++) o += '<option value="' + k + '"' + (k === sel ? " selected" : "") + '>' + k + '</option>'; return o; }
        r.innerHTML =
          '<label class="row" style="flex:1;gap:4px;align-items:center"><input type="checkbox" data-on' + (on ? " checked" : "") + ' style="flex:0 0 auto"><span class="mini" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + P.escapeHtml(d.name) + '">' + P.escapeHtml(d.name) + '</span></label>' +
          '<select data-min' + (on ? "" : " disabled") + ' style="flex:0 0 52px">' + opts(iv[0]) + '</select>' +
          '<span class="mini">a</span>' +
          '<select data-max' + (on ? "" : " disabled") + ' style="flex:0 0 52px">' + opts(iv[1]) + '</select>';
        var cb = r.querySelector("[data-on]"), mn = r.querySelector("[data-min]"), mx = r.querySelector("[data-max]");
        cb.addEventListener("change", function () { if (this.checked) c.intervalos[d.id] = [1, n]; else delete c.intervalos[d.id]; self.renderCategories(); self._typesChanged(); });
        function upd() { var a = +mn.value, b = +mx.value; if (a > b) { if (this === mn) b = a; else a = b; mn.value = a; mx.value = b; } c.intervalos[d.id] = [a, b]; self._typesChanged(); }
        mn.addEventListener("change", upd); mx.addEventListener("change", upd);
        box.appendChild(r);
      });
      var foot = document.createElement("div"); foot.className = "row"; foot.style.marginTop = "6px";
      foot.innerHTML = '<button class="btn sm ghost" data-close style="flex:1">Fechar</button>';
      foot.querySelector("[data-close]").addEventListener("click", function () { self._editCatId = null; self.renderCategories(); });
      box.appendChild(foot);
      return box;
    },

    // --- Customização persistente (localStorage) --------------------------------
    _loadCfg: function () {
      try { var s = localStorage.getItem("praxis.mdim.cfg"); if (s) { var o = JSON.parse(s); for (var k in o) if (this.cfg.hasOwnProperty(k)) this.cfg[k] = o[k]; } } catch (e) {}
      // migração única: quem tinha o antigo default de DPI (200) sobe para 300 (padrão de publicação); depois disso, 200 escolhido à mão persiste
      try { if (!localStorage.getItem("praxis.mdim.dpi300")) { if (this.cfg.figDpi === 200) this.cfg.figDpi = 300; localStorage.setItem("praxis.mdim.dpi300", "1"); this._saveCfg(); } } catch (e) {}
    },
    _saveCfg: function () { try { localStorage.setItem("praxis.mdim.cfg", JSON.stringify(this.cfg)); } catch (e) {} },

    // --- Presets de aparência nomeados (cor / P&B), persistentes ----------------
    // Um preset = instantâneo nomeado das chaves de aparência do cfg (não inclui
    // formatação da figura nem tamanhos de export).
    PRESET_KEYS: ["bw", "axisColor", "axisWidth", "ringColor", "ringWidth", "showRings", "gridStyle", "outerContour", "outerColor", "outerWidth", "showScaleNumbers", "polyOpacity", "outlineWidth", "showPoints", "normalize", "radarCenter", "scalePos", "tipTypeRange", "tickAxes", "tickAngle", "tickOffset", "neutralCor", "neutralPattern", "neutralDash", "outlineCustom", "outlineColor", "bandCustom", "bandColor", "bandOpacity", "bandWidth", "bandRound", "bandStyle", "showTypeMean", "meanColor", "meanWidth", "statePoly", "labelCurve", "labelSize", "labelGap", "labelBold"],
    _presets: null, _activePreset: null,
    _snapshotAppearance: function () { var o = {}, self = this; this.PRESET_KEYS.forEach(function (k) { o[k] = self.cfg[k]; }); return o; },
    ensurePresets: function () {
      if (this._presets) return;
      var saved = null; try { saved = JSON.parse(localStorage.getItem("praxis.mdim.presets") || "null"); } catch (e) {}
      if (saved && saved.list && saved.list.length) { this._presets = saved.list; this._activePreset = saved.active; }
      else {
        var cor = this._snapshotAppearance(), pb = this._snapshotAppearance(); cor.bw = false; pb.bw = true;
        this._presets = [{ id: "cor", name: "Colorido", cfg: cor }, { id: "pb", name: "Preto e branco", cfg: pb }];
        this._activePreset = "cor";
      }
      if (!this._presets.some(function (p) { return p.id === this._activePreset; }, this)) this._activePreset = this._presets[0].id;
    },
    savePresetsStore: function () { try { localStorage.setItem("praxis.mdim.presets", JSON.stringify({ list: this._presets, active: this._activePreset })); } catch (e) {} },
    applyPreset: function (id) {
      this.ensurePresets();
      var p = this._presets.filter(function (x) { return x.id === id; })[0]; if (!p) return;
      var self = this; this.PRESET_KEYS.forEach(function (k) { if (p.cfg.hasOwnProperty(k)) self.cfg[k] = p.cfg[k]; });
      this._activePreset = id; this._saveCfg(); this.savePresetsStore();
      this.renderAppearance(); this.render(); this.renderPresets();
    },
    addPreset: function (name) {
      this.ensurePresets();
      var id = "p" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
      this._presets.push({ id: id, name: name || ("Preset " + (this._presets.length + 1)), cfg: this._snapshotAppearance() });
      this._activePreset = id; this.savePresetsStore(); this.renderPresets();
    },
    updatePreset: function () {
      this.ensurePresets();
      var self = this, p = this._presets.filter(function (x) { return x.id === self._activePreset; })[0]; if (!p) return;
      p.cfg = this._snapshotAppearance(); this.savePresetsStore(); this.renderPresets();
    },
    renamePreset: function (id, name) { var p = this._presets.filter(function (x) { return x.id === id; })[0]; if (p && name) { p.name = name; this.savePresetsStore(); this.renderPresets(); } },
    removePreset: function (id) {
      this.ensurePresets();
      if (this._presets.length <= 1) return;
      this._presets = this._presets.filter(function (x) { return x.id !== id; });
      if (this._activePreset === id) this._activePreset = this._presets[0].id;
      this.savePresetsStore();
    },
    renderPresets: function (hostArg) {
      var self = this, host = hostArg || this.refs.presets; if (!host) return;
      if (!hostArg && this._figPresetsHost && document.body.contains(this._figPresetsHost)) this.renderPresets(this._figPresetsHost);   // espelho no painel Figuras
      this.ensurePresets();
      var opts = this._presets.map(function (p) { return '<option value="' + p.id + '"' + (p.id === self._activePreset ? " selected" : "") + '>' + P.escapeHtml(p.name) + '</option>'; }).join("");
      host.innerHTML =
        '<div class="field"><label>Preset de aparência</label><select data-preset>' + opts + '</select></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
          '<button class="btn sm ghost" data-p="new" style="flex:1 1 auto">Novo (do atual)</button>' +
          '<button class="btn sm ghost" data-p="save" style="flex:1 1 auto" title="Salvar o estado atual no preset selecionado">Atualizar</button>' +
          '<button class="btn sm ghost" data-p="ren" title="Renomear">Renomear</button>' +
          '<button class="btn sm ghost" data-p="del" title="Remover">Remover</button>' +
        '</div>';
      host.querySelector("[data-preset]").addEventListener("change", function () { self.applyPreset(this.value); });
      host.querySelector('[data-p="new"]').addEventListener("click", function () { var n = prompt("Nome do preset:", "Meu preset"); if (n && n.trim()) self.addPreset(n.trim()); });
      host.querySelector('[data-p="save"]').addEventListener("click", function () { self.updatePreset(); });
      host.querySelector('[data-p="ren"]').addEventListener("click", function () { var p = self._presets.filter(function (x) { return x.id === self._activePreset; })[0]; var n = prompt("Novo nome:", p ? p.name : ""); if (n && n.trim()) self.renamePreset(self._activePreset, n.trim()); });
      host.querySelector('[data-p="del"]').addEventListener("click", function () { if (self._presets.length <= 1) { alert("Mantenha ao menos um preset."); return; } self.removePreset(self._activePreset); self.applyPreset(self._activePreset); });
    },
    // Converte uma cor para tom de cinza (modo P&B), preservando a luminância.
    _bw: function (hex) {
      if (!this.cfg.bw) return hex;
      var m = String(hex).replace("#", ""); if (m.length === 3) m = m.split("").map(function (c) { return c + c; }).join("");
      var r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
      if (!isFinite(r)) return hex;
      var y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      function hx(x) { return ("0" + x.toString(16)).slice(-2); }
      return "#" + hx(y) + hx(y) + hx(y);
    },
    _alpha: function (op) { return ("0" + Math.round(Math.max(0, Math.min(1, op)) * 255).toString(16)).slice(-2); },
    // Garante um <pattern> de hachura no <defs> do radar com a cor atual; devolve url(#id).
    // Reaproveita o gerador de padrões do GCP (diag/diag2/cross/horiz/vert/dots).
    _ensurePolyPattern: function (r, type, color) {
      var id = "mdim-poly-pat";
      if (r._patColor !== color || r._patType !== type) {
        var old = r.defs.querySelector("#" + id); if (old) r.defs.removeChild(old);
        var pat = P.GCP._patternEl(id, type, color);
        r.defs.appendChild(pat); r._patColor = color; r._patType = type;
      }
      return "url(#" + id + ")";
    },

    // --- Estatística por tipo de prática ----------------------------------------
    // Duração ativa exata de cada categoria: entre trocas consecutivas (de todas
    // as dimensões) o estado é constante, então integra por intervalos.
    categoryStats: function () {
      var cats = P.Segmenter.categories || [], dims = this.dims(), maxT = this.maxTime();
      var bs = [0, maxT];
      dims.forEach(function (d) { d.segments.forEach(function (s) { if (s.tStart > 0 && s.tStart < maxT) bs.push(s.tStart); if (s.tEnd > 0 && s.tEnd < maxT) bs.push(s.tEnd); }); });
      bs = bs.filter(function (v, i, a) { return isFinite(v) && a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
      var totals = {}; cats.forEach(function (c) { totals[c.id] = 0; }); var none = 0, coded = 0;
      for (var i = 0; i < bs.length - 1; i++) {
        var a = bs[i], b = bs[i + 1], dur = b - a; if (dur <= 0) continue;
        var mid = (a + b) / 2, hit = false;
        cats.forEach(function (c) { if (P.Segmenter.categoryActiveAt(c, mid)) { totals[c.id] += dur; hit = true; } });
        if (hit) coded += dur; else none += dur;
      }
      var rows = cats.map(function (c) { return { id: c.id, nome: c.nome, cor: c.cor, seconds: totals[c.id], pct: maxT > 0 ? totals[c.id] / maxT * 100 : 0 }; });
      rows.sort(function (a, b) { return b.seconds - a.seconds; });
      return { total: maxT, rows: rows, none: none, coded: coded };
    },
    renderStats: function (host) {
      var S = this.categoryStats(), cats = P.Segmenter.categories || [];
      if (!cats.length) { host.style.display = "none"; return; }
      host.style.display = "";
      function bar(pct, color) { return '<div style="height:8px;border-radius:999px;background:' + color + ';width:' + Math.max(2, pct) + '%"></div>'; }
      var self = this;
      var h = '<b class="t-strong">Tempo por tipo de prática</b> <span class="hint">% e duração, do mais observado ao menos</span>';
      h += '<div class="mini" style="margin:4px 0 8px;color:var(--txt-dim)">tempo total <b style="color:var(--txt)">' + P.fmtTime(S.total) + '</b> · codificado <b style="color:var(--txt)">' + (S.total ? (S.coded / S.total * 100).toFixed(0) : 0) + '%</b></div>';
      h += '<table class="stat-table" style="width:100%">' + S.rows.map(function (x) {
        var col = self._bw(x.cor);
        return '<tr><td style="width:34%"><span class="tag-b" style="background:' + col + '22;color:' + col + '">' + P.escapeHtml(x.nome) + '</span></td>' +
          '<td style="width:40%">' + bar(x.pct, col) + '</td>' +
          '<td style="width:26%;text-align:right;font-variant-numeric:tabular-nums">' + x.pct.toFixed(1) + '% · ' + P.fmtTime(x.seconds) + '</td></tr>';
      }).join("") + '</table>';
      host.innerHTML = h;
    },

    // --- Exportação (reaproveita o fundo branco + DPI do GCP) --------------------
    // Clona um SVG e substitui var(--...) por cores computadas (o SVG exportado
    // roda fora do documento, onde as variáveis CSS não resolveriam).
    _inlineColors: function (svgEl) {
      // getComputedStyle num SVG FORA da página devolve vazio (as var(--…) sumiam: grade/marcas das figuras não saíam).
      // Se não estiver no documento, anexa num contêiner invisível só durante a leitura.
      var tmpHost = null, parent0 = svgEl.parentNode, next0 = svgEl.nextSibling;
      if (!svgEl.isConnected) {
        tmpHost = document.createElement("div");
        tmpHost.style.cssText = "position:absolute;left:-99999px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden";
        document.body.appendChild(tmpHost); tmpHost.appendChild(svgEl);
      }
      try { return this._inlineColorsAttached(svgEl); }
      finally {
        if (tmpHost) { if (parent0) parent0.insertBefore(svgEl, next0); else tmpHost.removeChild(svgEl); document.body.removeChild(tmpHost); }
      }
    },
    _inlineColorsAttached: function (svgEl) {
      var clone = svgEl.cloneNode(true);
      var o = svgEl.querySelectorAll("*"), c = clone.querySelectorAll("*");
      for (var i = 0; i < o.length; i++) {
        var cs = getComputedStyle(o[i]);
        var sk = o[i].getAttribute("stroke"), fl = o[i].getAttribute("fill");
        // só resolve var(--...) (fora do documento as variáveis não valem); cores concretas e url(#pat) passam
        if (sk && sk.indexOf("var(") >= 0) c[i].setAttribute("stroke", cs.stroke);
        if (fl && fl.indexOf("var(") >= 0) c[i].setAttribute("fill", cs.fill);
      }
      return clone;
    },
    // Roda fn com o tema CLARO forçado no root (síncrono) e restaura. Usado ao "assar" as
    // cores do export: como o fundo é branco, o texto precisa da tinta escura do tema claro.
    _exportLight: function (fn) {
      var root = document.documentElement, prev = root.getAttribute("data-theme");
      root.setAttribute("data-theme", "light");
      try { return fn(); } finally { if (prev) root.setAttribute("data-theme", prev); else root.removeAttribute("data-theme"); }
    },
    // Exporta um SVG (radar ou linhas) num tamanho W×H px, fundo branco, proporção
    // preservada (fit centralizado). Corrige o export raster: define width/height
    // explícitos (sem eles, o SVG width="100%" rasteriza em branco) e desenha no tamanho pedido.
    _exportGraphic: function (svgEl, baseName, kind, W, H) {
      if (!svgEl) { alert("Nada para exportar ainda."); return; }
      W = Math.max(50, Math.round(W || 440)); H = Math.max(50, Math.round(H || 340));
      var self = this;
      var el = this._exportLight(function () { return P.GCP._withWhiteBg(self._inlineColors(svgEl)); });
      el.setAttribute("width", W); el.setAttribute("height", H);
      el.setAttribute("preserveAspectRatio", "xMidYMid meet");
      var svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(el);
      if (kind === "svg") { P.download(baseName + ".svg", svgStr, "image/svg+xml;charset=utf-8"); return; }
      var mime = kind === "jpg" ? "image/jpeg" : "image/png";
      var url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);           // branco também nas margens (letterbox)
        ctx.drawImage(img, 0, 0, W, H);
        cv.toBlob(function (blob) { P.download(baseName + "." + kind, blob, mime); URL.revokeObjectURL(url); }, mime, 0.95);
      };
      img.onerror = function () { URL.revokeObjectURL(url); alert("Não consegui rasterizar a imagem. Tente exportar em SVG."); };
      img.src = url;
    },
    _exportRadar: function (kind, W, H) { if (this._radar) this._exportGraphic(this._radar.svg, "radar_praxis", kind, W, H); },
    _exportLines: function (kind, W, H) { this._exportGraphic(this._buildLinesSvg(), "linhas_praxis", kind, W, H); },
    // Compõe os step-plots num único SVG empilhado (com o nome de cada dimensão).
    // figura de publicação: sempre resolvida no tema claro (no escuro os nomes saíam em tinta clara sobre fundo branco)
    _buildLinesSvg: function () { var self = this; return this._exportLight(function () { return self._buildLinesSvgRaw(); }); },
    _buildLinesSvgRaw: function () {
      var svgs = this._svgs || []; if (!svgs.length) return null;
      var dims = this.dims(), W = svgs[0]._W || 700, gap = 20, y = 0, total = 0, self = this;
      svgs.forEach(function (s) { total += (+s.getAttribute("viewBox").split(/\s+/)[3]) + gap; });
      var out = document.createElementNS(SVGNS, "svg");
      out.setAttribute("viewBox", "0 0 " + W + " " + total);
      var txtCol = getComputedStyle(document.documentElement).getPropertyValue("--txt").trim() || "#222";
      svgs.forEach(function (s, i) {
        var H = +s.getAttribute("viewBox").split(/\s+/)[3];
        var name = document.createElementNS(SVGNS, "text");
        name.setAttribute("x", 6); name.setAttribute("y", y + 10); name.setAttribute("font-size", 11); name.setAttribute("font-weight", 600); name.setAttribute("fill", txtCol);
        name.textContent = dims[i] ? dims[i].name : ("Dimensão " + (i + 1));
        out.appendChild(name);
        var g = document.createElementNS(SVGNS, "g"); g.setAttribute("transform", "translate(0," + (y + 14) + ")");
        var inl = self._inlineColors(s);
        while (inl.firstChild) g.appendChild(inl.firstChild);
        out.appendChild(g);
        y += H + gap;
      });
      return out;
    },

    // --- GIF animado de uma sequência de estados (tipos de prática) --------------
    // Codificador GIF89a próprio (offline, sem worker/lib), com PALETA ADAPTATIVA
    // (median-cut a partir das cores reais dos quadros → sem banding) + LZW.
    // Frames = arrays de índices de paleta (W×H, topo→baixo).
    _medianCut: function (hist, maxColors) {
      // hist: Map(packedRGB → contagem). Devolve até maxColors cores [r,g,b].
      var cols = [];
      hist.forEach(function (c, key) { cols.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, c: c }); });
      if (!cols.length) return [[255, 255, 255]];
      function mkbox(a) {
        var rmn = 255, rmx = 0, gmn = 255, gmx = 0, bmn = 255, bmx = 0, n = 0;
        for (var i = 0; i < a.length; i++) {
          var x = a[i];
          if (x.r < rmn) rmn = x.r; if (x.r > rmx) rmx = x.r;
          if (x.g < gmn) gmn = x.g; if (x.g > gmx) gmx = x.g;
          if (x.b < bmn) bmn = x.b; if (x.b > bmx) bmx = x.b; n += x.c;
        }
        return { a: a, rr: rmx - rmn, gr: gmx - gmn, br: bmx - bmn, n: n };
      }
      var boxes = [mkbox(cols)];
      while (boxes.length < maxColors) {
        var bi = -1, best = -1;                        // caixa com maior faixa×população
        for (var i = 0; i < boxes.length; i++) {
          var bx = boxes[i]; if (bx.a.length < 2) continue;
          var score = Math.max(bx.rr, bx.gr, bx.br) * bx.n;
          if (score > best) { best = score; bi = i; }
        }
        if (bi < 0) break;
        var box = boxes[bi];
        var ch = box.rr >= box.gr && box.rr >= box.br ? "r" : (box.gr >= box.br ? "g" : "b");
        box.a.sort(function (x, y) { return x[ch] - y[ch]; });
        var half = box.n / 2, acc = 0, si = 0;         // corta na mediana ponderada pela contagem
        for (si = 0; si < box.a.length - 1; si++) { acc += box.a[si].c; if (acc >= half) break; }
        if (si > box.a.length - 2) si = box.a.length - 2;   // garante os dois lados não-vazios (cor dominante)
        boxes.splice(bi, 1, mkbox(box.a.slice(0, si + 1)), mkbox(box.a.slice(si + 1)));
      }
      return boxes.map(function (bx) {
        var r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < bx.a.length; i++) { var x = bx.a[i]; r += x.r * x.c; g += x.g * x.c; b += x.b * x.c; n += x.c; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      });
    },
    _lzwEncode: function (idx, out) {
      var minCode = 8, clear = 1 << minCode, eoi = clear + 1, size, dict, next;
      // reset também restaura o tamanho do código (min+1) e a próxima entrada livre.
      function reset() { dict = {}; for (var i = 0; i < clear; i++) dict[String.fromCharCode(i)] = i; next = eoi + 1; size = minCode + 1; }
      var buf = 0, bits = 0, bytes = [];
      function emit(code) { buf |= code << bits; bits += size; while (bits >= 8) { bytes.push(buf & 0xff); buf >>= 8; bits -= 8; } }
      out.push(minCode); reset(); emit(clear);
      var w = String.fromCharCode(idx[0]);
      for (var i = 1; i < idx.length; i++) {
        var c = String.fromCharCode(idx[i]);
        if (dict.hasOwnProperty(w + c)) { w += c; }
        else {
          emit(dict[w]);
          // Ordem crítica p/ o decodificador: emite com o tamanho atual, depois trata a
          // tabela cheia (clear) OU aumenta o tamanho ANTES de atribuir o novo código.
          if (next === 4096) { emit(clear); reset(); }
          else { if (next === (1 << size) && size < 12) size++; dict[w + c] = next++; }
          w = c;
        }
      }
      emit(dict[w]); emit(eoi);
      if (bits > 0) bytes.push(buf & 0xff);
      for (var q = 0; q < bytes.length; q += 255) { var n = Math.min(255, bytes.length - q); out.push(n); for (var k = 0; k < n; k++) out.push(bytes[q + k]); }
      out.push(0);
    },
    _encodeGif: function (frames, W, H, delayCs, pal) {
      var out = [], self = this, p = pal.slice();
      while (p.length < 256) p.push([0, 0, 0]);                                       // tabela global = 256
      function b(x) { out.push(x & 0xff); } function w(x) { out.push(x & 0xff); out.push((x >> 8) & 0xff); }
      function s(x) { for (var i = 0; i < x.length; i++) out.push(x.charCodeAt(i)); }
      s("GIF89a"); w(W); w(H); b(0xF7); b(0); b(0);
      for (var i = 0; i < 256; i++) { b(p[i][0]); b(p[i][1]); b(p[i][2]); }
      b(0x21); b(0xFF); b(0x0B); s("NETSCAPE2.0"); b(0x03); b(0x01); w(0); b(0x00);   // loop infinito
      frames.forEach(function (idx) {
        b(0x21); b(0xF9); b(0x04); b(0x00); w(delayCs); b(0x00); b(0x00);           // controle gráfico (delay)
        b(0x2C); w(0); w(0); w(W); w(H); b(0x00);                                    // descritor de imagem
        self._lzwEncode(idx, out);
      });
      b(0x3B);
      return new Uint8Array(out);
    },
    // Rasteriza um SVG num canvas W×H (fundo branco) e devolve os pixels RGBA crus.
    _svgToRGBA: function (svgEl, W, H) {
      return new Promise(function (res, rej) {
        var str = '<?xml version="1.0"?>\n' + new XMLSerializer().serializeToString(svgEl);
        var url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
        var img = new Image();
        img.onload = function () {
          var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
          var ctx = cv.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
          URL.revokeObjectURL(url); res(ctx.getImageData(0, 0, W, H).data);
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("render")); };
        img.src = url;
      });
    },
    // Valor da escala que fica no CENTRO do radar: 1 (mínimo da escala, padrão) ou 0 (cfg.radarCenter = "zero").
    _rBase: function () { return this.cfg.radarCenter === "zero" ? 0 : 1; },
    // Escores representativos de um tipo = NÍVEL MÉDIO REAL de cada dimensão durante o tipo (média ponderada
    // pela duração, nas sessões da fonte da média; ver _typeMeans), com 1 casa decimal. Sem dado → null.
    _catStateScores: function (cat) {
      var means = (this._typeMeansCached() || {})[cat.id] || {};
      return this.dims().map(function (d) {
        var f = means[d.name]; if (f == null) return null;
        var n = P.Segmenter.escalaMaxOf(d); return Math.round((1 + f * (n - 1)) * 10) / 10;
      });
    },
    // SVG do radar num estado congelado (reaproveita toda a grade/eixos do radar vivo).
    _stateSvg: function (scores, cat) {
      if (!this._radar) return null;
      var self = this;
      this._frozen = { scores: scores, cat: cat || null };
      this._updateRadar();
      // "assa" as cores no tema claro (fundo branco no export) → texto em tinta escura, visível
      var el = this._exportLight(function () { return P.GCP._withWhiteBg(self._inlineColors(self._radar.svg)); });
      this._frozen = null; this._updateRadar();
      return el;
    },
    exportGif: async function (cats, durSec, W, H) {
      if (!cats.length) { alert("Selecione ao menos um tipo de prática para animar."); return; }
      if (!this._radar) { alert("Gere o radar primeiro."); return; }
      W = Math.max(60, Math.round(W || 360)); H = Math.max(60, Math.round(H || 300));
      try {
        var rgbas = [];                                          // pixels crus de cada quadro
        for (var i = 0; i < cats.length; i++) {
          var el = this._stateSvg(this._catStateScores(cats[i]), cats[i]);
          el.setAttribute("width", W); el.setAttribute("height", H); el.setAttribute("preserveAspectRatio", "xMidYMid meet");
          rgbas.push(await this._svgToRGBA(el, W, H));
        }
        var hist = new Map();                                    // histograma global de cores
        rgbas.forEach(function (d) { for (var i = 0; i < d.length; i += 4) { var k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; hist.set(k, (hist.get(k) || 0) + 1); } });
        var pal = this._medianCut(hist, 256);                    // paleta adaptativa
        var memo = new Map();
        function idxFor(r, g, b) {
          var k = (r << 16) | (g << 8) | b, m = memo.get(k); if (m !== undefined) return m;
          var bi = 0, bd = 1e12;
          for (var pp = 0; pp < pal.length; pp++) { var dr = r - pal[pp][0], dg = g - pal[pp][1], db = b - pal[pp][2], dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; bi = pp; } }
          memo.set(k, bi); return bi;
        }
        var frames = rgbas.map(function (d) { var idx = new Uint8Array(W * H); for (var i = 0, j = 0; i < d.length; i += 4, j++) idx[j] = idxFor(d[i], d[i + 1], d[i + 2]); return idx; });
        var gif = this._encodeGif(frames, W, H, Math.max(2, Math.round((durSec || 1.5) * 100)), pal);
        P.download("estados_praxis.gif", new Blob([gif], { type: "image/gif" }), "image/gif");
      } catch (e) { alert("Falha ao gerar o GIF: " + (e && e.message ? e.message : e)); }
    },

    // Renomeia todos os ids (e as referências url(#...)) de uma subárvore SVG, p/ evitar
    // colisão quando vários radares (com patterns próprios) entram numa mesma figura.
    _uniquifyIds: function (el, sfx) {
      var ids = [], withId = el.querySelectorAll("[id]");
      for (var i = 0; i < withId.length; i++) { ids.push(withId[i].getAttribute("id")); withId[i].setAttribute("id", withId[i].getAttribute("id") + sfx); }
      if (!ids.length) return;
      var all = el.querySelectorAll("*");
      for (var j = 0; j < all.length; j++) {
        var n = all[j];
        for (var a = 0; a < n.attributes.length; a++) {
          var at = n.attributes[a], v = at.value;
          if (/href$/i.test(at.name) && v.charAt(0) === "#" && ids.indexOf(v.slice(1)) >= 0) {   // textPath / use (href="#id")
            if (at.namespaceURI) n.setAttributeNS(at.namespaceURI, at.name, v + sfx); else n.setAttribute(at.name, v + sfx);
            continue;
          }
          if (v.indexOf("url(#") < 0) continue;
          var nv = v;
          for (var k = 0; k < ids.length; k++) nv = nv.split("url(#" + ids[k] + ")").join("url(#" + ids[k] + sfx + ")");
          if (nv !== v) n.setAttribute(at.name, nv);
        }
      }
    },
    // Partição da linha do tempo pelo tipo ATIVO (primeiro da lista) entre as trocas.
    _typePartition: function () {
      var dims = this.dims(), cats = P.Segmenter.categories || [];
      if (!dims.length) return { segs: [], total: 0 };
      var bset = {};
      dims.forEach(function (d) { (d.segments || []).forEach(function (s) { bset[+s.tStart.toFixed(4)] = 1; bset[+s.tEnd.toFixed(4)] = 1; }); });
      var ts = Object.keys(bset).map(Number).sort(function (a, b) { return a - b; });
      var segs = [], total = 0;
      for (var i = 0; i < ts.length - 1; i++) {
        var a = ts[i], b = ts[i + 1]; if (b - a <= 1e-6) continue;
        var m = (a + b) / 2, act = null;
        for (var c = 0; c < cats.length; c++) { if (P.Segmenter.categoryActiveAt(cats[c], m)) { act = cats[c].id; break; } }
        segs.push({ dur: b - a, cat: act }); total += b - a;
      }
      return { segs: segs, total: total };
    },
    // Estatística descritiva de um tipo: % de duração, usos isolados, antecedentes, sucessores.
    _typeStats: function (catId) {
      var pt = this._typePartition(), segs = pt.segs, seconds = 0, runs = 0, prec = {}, succ = {}, inRun = false;
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (s.cat === catId) {
          seconds += s.dur;
          if (!inRun) { runs++; inRun = true; var pv = i > 0 ? segs[i - 1].cat : null, pk = pv || "-"; prec[pk] = (prec[pk] || 0) + 1; }
        } else {
          if (inRun) { var sk = s.cat || "-"; succ[sk] = (succ[sk] || 0) + 1; }
          inRun = false;
        }
      }
      if (inRun) succ["-"] = (succ["-"] || 0) + 1;
      function nameOf(id) { if (id === "-" || id == null) return "nada"; var c = (P.Segmenter.categories || []).filter(function (x) { return x.id === id; })[0]; return c ? c.nome : id; }
      function top(o) { return Object.keys(o).map(function (k) { return { name: nameOf(k), n: o[k] }; }).sort(function (a, b) { return b.n - a.n; }); }
      return { seconds: seconds, pct: pt.total ? seconds / pt.total * 100 : 0, runs: runs, precedes: top(prec), succeeds: top(succ) };
    },

    _statLines: function (cat) {
      var inc = this.cfg.figInclude || {}, st = this._typeStats(cat.id), lines = [];
      function j(arr) { return arr.length ? arr.slice(0, 2).map(function (x) { return x.name + " (" + x.n + ")"; }).join(", ") : "-"; }
      var first = [];
      if (inc.pct) first.push(st.pct.toFixed(1) + "% do tempo");
      if (inc.uses) first.push(st.runs + (st.runs === 1 ? " uso isolado" : " usos isolados"));
      if (first.length) lines.push(first.join(" · "));
      if (inc.before) lines.push("Antes: " + j(st.precedes));
      if (inc.after) lines.push("Depois: " + j(st.succeeds));
      return lines;
    },
    // Ids das categorias na ordem escolhida (figOrder + novas anexadas, filtrando removidas).
    _figOrderIds: function () {
      var cats = P.Segmenter.categories || [], order = (this.cfg.figOrder || []).slice();
      cats.forEach(function (c) { if (order.indexOf(c.id) < 0) order.push(c.id); });
      return order.filter(function (id) { return cats.some(function (c) { return c.id === id; }); });
    },
    // Categorias que entram na figura: ordem escolhida + filtro de seleção (figSel null = todas).
    _figCats: function () {
      var cats = P.Segmenter.categories || [], sel = this.cfg.figSel, out = [];
      this._figOrderIds().forEach(function (id) {
        if (sel && sel.indexOf(id) < 0) return;
        var c = cats.filter(function (x) { return x.id === id; })[0]; if (c) out.push(c);
      });
      return out;
    },
    // Small multiples: cada tipo escolhido como um radar estático, lado a lado (SVG vetorial).
    // Formatação (fonte, margem, colunas, quais infos) vem do cfg.fig*.
    _buildStatesSvg: function (cats) {
      var self = this, cfg = this.cfg, vw = 440, vh = 340, pad = Math.max(0, +cfg.figMargin || 0);
      var showTitle = !!cfg.figInclude.title, titleH = showTitle ? 24 : 6;
      var allLines = cats.map(function (c) { return self._statLines(c); });
      var maxLines = allLines.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
      var statsH = maxLines > 0 ? maxLines * 15 + 10 : 0;
      var cellW = vw, cellH = titleH + vh + statsH;
      var n = cats.length, cols = (+cfg.figCols > 0) ? +cfg.figCols : (n <= 3 ? n : Math.min(4, n));
      cols = Math.max(1, Math.min(cols, n || 1)); var rows = Math.ceil(n / cols);
      // legenda (faixa / nível médio) só quando o anel ou a média estão ligados — a figura antiga fica igual
      var withLeg = cfg.figLegend !== false && (cfg.bandStyle === "ring" || cfg.showTypeMean), legH = withLeg ? 36 : 0;
      var W = cols * cellW + (cols + 1) * pad, H = rows * cellH + (rows + 1) * pad + legH;
      var txt = "#14181d", dim = "#586b7b";                    // tinta escura fixa (figura sempre em fundo branco)
      function mk(tag, at) { var e = document.createElementNS(SVGNS, tag); for (var k in at) e.setAttribute(k, at[k]); return e; }
      var out = mk("svg", { viewBox: "0 0 " + W + " " + H });
      if (cfg.figFont) out.setAttribute("style", "font-family:" + cfg.figFont);   // cascateia p/ todos os textos
      out.appendChild(mk("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));
      cats.forEach(function (cat, i) {
        var cxi = i % cols, cyi = Math.floor(i / cols);
        var x = pad + cxi * (cellW + pad), y = pad + cyi * (cellH + pad);
        if (showTitle) {
          var t = mk("text", { x: x + cellW / 2, y: y + 16, "font-size": 15, "font-weight": 700, fill: txt, "text-anchor": "middle" });
          t.textContent = cat.nome; out.appendChild(t);
        }
        var g = mk("g", { transform: "translate(" + x + "," + (y + titleH) + ")" });
        var rsvg = self._stateSvg(self._catStateScores(cat), cat);
        self._uniquifyIds(rsvg, "_c" + i);                    // patterns/ids únicos por célula
        while (rsvg.firstChild) g.appendChild(rsvg.firstChild);
        out.appendChild(g);
        allLines[i].forEach(function (ln, li) {
          var s = mk("text", { x: x + 10, y: y + titleH + vh + 14 + li * 15, "font-size": 12, fill: li === 0 ? txt : dim });
          s.textContent = ln; out.appendChild(s);
        });
      });
      if (withLeg) {
        var fs = 13, ly = H - legH / 2 + 2, items = [];
        items.push({ kind: "band", label: cfg.legBandText || "Faixa de níveis que define o tipo" });
        if (cfg.showTypeMean) { var nS = this._meanSessions().length; items.push({ kind: "mean", label: (cfg.legMeanText || "Nível médio observado") + (nS > 1 ? " nas " + nS + " sessões" : " na sessão") }); }
        var tw = 0; items.forEach(function (it) { it.w = 40 + 8 + it.label.length * fs * 0.55 + 36; tw += it.w; });
        var lx = (W - tw) / 2, mcol = this._bw(cfg.meanColor || "#000000"), mw = +cfg.meanWidth || 2.5;
        items.forEach(function (it) {
          if (it.kind === "band") out.appendChild(mk("rect", { x: lx + 4, y: ly - 8, width: 32, height: 14, fill: "#b8b8b8", opacity: 0.7 }));
          else { out.appendChild(mk("line", { x1: lx, y1: ly - 1, x2: lx + 40, y2: ly - 1, stroke: mcol, "stroke-width": mw })); out.appendChild(mk("circle", { cx: lx + 20, cy: ly - 1, r: mw * 1.7, fill: mcol })); }
          var t2 = mk("text", { x: lx + 48, y: ly + 4, "font-size": fs, fill: txt }); t2.textContent = it.label; out.appendChild(t2);
          lx += it.w;
        });
      }
      return out;
    },
    exportStatesFigure: function (cats, kind) {
      if (!cats.length) { alert("Selecione ao menos um tipo de prática (marque na lista)."); return; }
      if (!this._radar) { alert("Gere o radar primeiro."); return; }
      var cfg = this.cfg, svg = this._buildStatesSvg(cats);
      var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      var scale = Math.max(0.2, +cfg.figScale || 1);
      var mult = kind === "svg" ? scale : scale * (Math.max(72, +cfg.figDpi || 96) / 96);   // DPI só no raster
      var base = cats.length === 1 ? ("tipo_" + cats[0].nome.replace(/\s+/g, "_")) : "tipos_praxis";
      this._exportGraphic(svg, base, kind, vb[2] * mult, vb[3] * mult);
    },

    // ===== Modo de Formatação gráfica: várias abas (gráficos), cada uma compõe elementos exportáveis =====
    _figs: null, _activeFigId: null,
    _loadFigs: function () {
      if (!this._figs) { try { var s = localStorage.getItem("praxis.mdim.figs"); this._figs = s ? JSON.parse(s) : null; } catch (e) { this._figs = null; } }
      if (!this._figs || !this._figs.length) this._figs = [this._newFig("Gráfico 1")];
      if (!this._activeFigId || !this._figs.some(function (f) { return f.id === this._activeFigId; }, this)) this._activeFigId = this._figs[0].id;
    },
    _saveFigs: function () { try { localStorage.setItem("praxis.mdim.figs", JSON.stringify(this._figs)); } catch (e) {} },
    // Persistência no .praxis (portátil): os gráficos do modo de formatação viajam com o projeto.
    serialize: function () { this._loadFigs(); return { figs: this._figs, activeFigId: this._activeFigId, appearSets: this._appearSets || null }; },
    restore: function (state, idMap) {
      state = state || {};
      if (state.appearSets) this._appearSets = state.appearSets;
      if (state.figs && state.figs.length) {
        this._figs = state.figs.map(function (f) {
          var nf = {}; for (var k in f) nf[k] = f[k];
          if (idMap) nf.dims = (f.dims || []).map(function (id) { return idMap[id] || id; }).filter(Boolean);
          return nf;
        });
        this._activeFigId = (state.activeFigId && this._figs.some(function (f) { return f.id === state.activeFigId; })) ? state.activeFigId : this._figs[0].id;
      } else { this._figs = null; this._activeFigId = null; }   // projeto sem gráficos: recomeça (lazy cria "Gráfico 1")
      this._saveFigs();
    },
    _newFig: function (name) { this._loadAppear(); return { id: "fig" + Date.now().toString(36) + Math.floor(Math.random() * 1e3), name: name || "Gráfico", showRadar: false, dims: this.dims().map(function (d) { return d.id; }), showStates: false, cols: 1, appearId: this._appearSets[0].id }; },
    _activeFig: function () { var self = this; return (this._figs || []).filter(function (f) { return f.id === self._activeFigId; })[0]; },
    // ---- Conjuntos de aparência (associar/dissociar grupos); escopo: sobreposição, opacidade, cores por tipo, fonte ----
    APPEAR_KEYS: ["typeOverlapMode", "typeBandOpacity", "typeColors", "figFont"],
    _appearSets: null,
    _loadAppear: function () {
      if (!this._appearSets) { try { var s = localStorage.getItem("praxis.mdim.appearsets"); this._appearSets = s ? JSON.parse(s) : null; } catch (e) { this._appearSets = null; } }
      if (!this._appearSets || !this._appearSets.length) this._appearSets = [{ id: "ap_default", name: "Padrão", over: this._appearFromCfg() }];
    },
    _saveAppear: function () { try { localStorage.setItem("praxis.mdim.appearsets", JSON.stringify(this._appearSets)); } catch (e) {} },
    _appearFromCfg: function () { var self = this, o = {}; this.APPEAR_KEYS.forEach(function (k) { o[k] = (k === "typeColors") ? JSON.parse(JSON.stringify(self.cfg[k] || {})) : self.cfg[k]; }); return o; },
    _figAppear: function (fig) { this._loadAppear(); var id = fig && fig.appearId; return this._appearSets.filter(function (x) { return x.id === id; })[0] || this._appearSets[0]; },
    // Aplica a aparência do conjunto do gráfico durante fn (troca as chaves em cfg e restaura).
    _withAppear: function (fig, fn) {
      var set = this._figAppear(fig); if (!set) return fn();
      var self = this, saved = {};
      this.APPEAR_KEYS.forEach(function (k) { saved[k] = self.cfg[k]; if (set.over && set.over[k] !== undefined) self.cfg[k] = set.over[k]; });
      try { return fn(); } finally { this.APPEAR_KEYS.forEach(function (k) { self.cfg[k] = saved[k]; }); }
    },
    _currentScores: function () { var t = this.currentT(); return this.dims().map(function (d) { return P.Segmenter.dimScoreAt(d, t); }); },
    // Compõe os elementos escolhidos do gráfico num único SVG, aplicando o conjunto de aparência do gráfico.
    _buildFigureSvg: function (fig, maxT, W) { var self = this; return this._withAppear(fig, function () { return self._buildFigureSvgInner(fig, maxT, W); }); },
    _buildFigureSvgInner: function (fig, maxT, W) {
      var self = this, c = this.cfg; W = W || 720; if (!fig) return null;
      var cols = Math.max(1, Math.min(+fig.cols || 1, 4));
      var gap = Math.max(0, +c.figGutter || 18), pad = Math.max(0, +c.figPad || 14);
      var colW = (W - pad * 2 - (cols - 1) * gap) / cols;
      var szTitle = +c.figSzTitle || 12, szPanel = +c.figSzPanel || 13, labH = szTitle + 5;
      var parts = [];   // {svg, label}
      if (fig.showRadar && this._radar) { var r = this._stateSvg(this._currentScores(), null); if (r) parts.push({ svg: r, label: "Estado atual" }); }
      if (fig.showIntegrated) { var ig = this._integratedStepPlot(maxT, colW); if (ig) parts.push({ svg: ig, label: "Todos os eixos (integrado)" }); }
      var savedView = this._view; this._view = null;   // a figura sempre no tempo cheio
      (fig.dims || []).forEach(function (id) {
        var t = self.dims().filter(function (d) { return d.id === id; })[0]; if (!t) return;
        parts.push({ svg: self._integratedStepPlot(maxT, colW, [t]), label: t.name });   // reusa o mesmo motor param. (1 eixo)
      });
      this._view = savedView;
      if (fig.showStates && this._radar) { var cats = this._figCats(); if (cats.length) parts.push({ svg: this._buildStatesSvg(cats), label: null }); }
      if (!parts.length) return null;
      parts.forEach(function (p) { var vb = p.svg.getAttribute("viewBox").split(/\s+/).map(Number); p._sh = colW * (vb[3] / vb[2]); p._labH = p.label ? labH : 0; });
      var out = document.createElementNS(SVGNS, "svg");
      if (c.figFont) out.setAttribute("style", "font-family:" + c.figFont);
      var y = pad, i = 0, letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", pi = 0;
      while (i < parts.length) {
        var row = parts.slice(i, i + cols);
        var rowH = Math.max.apply(null, row.map(function (p) { return p._labH + p._sh; }));
        row.forEach(function (p, cc) {
          var x = pad + cc * (colW + gap), ey = y + p._labH, tx = x + 2;
          self._uniquifyIds(p.svg, "_fg" + i + "_" + cc);
          if (c.figPanelLetters) { var pl = document.createElementNS(SVGNS, "text"); pl.setAttribute("x", tx); pl.setAttribute("y", y + szPanel); pl.setAttribute("font-size", szPanel); pl.setAttribute("font-weight", 700); pl.setAttribute("fill", "var(--txt)"); pl.textContent = letters[pi % 26]; out.appendChild(pl); tx += szPanel * 0.85 + 4; }
          if (p.label) { var name = document.createElementNS(SVGNS, "text"); name.setAttribute("x", tx); name.setAttribute("y", y + szTitle); name.setAttribute("font-size", szTitle); name.setAttribute("font-weight", 700); name.setAttribute("fill", "var(--txt)"); name.textContent = p.label; out.appendChild(name); }
          p.svg.setAttribute("x", x); p.svg.setAttribute("y", ey); p.svg.setAttribute("width", colW); p.svg.setAttribute("height", p._sh); p.svg.removeAttribute("style");
          out.appendChild(p.svg);
          if (c.figElemBorder) { var bd = document.createElementNS(SVGNS, "rect"); bd.setAttribute("x", x); bd.setAttribute("y", ey); bd.setAttribute("width", colW); bd.setAttribute("height", p._sh); bd.setAttribute("fill", "none"); bd.setAttribute("stroke", c.figElemBorderColor || "#c8d2db"); bd.setAttribute("stroke-width", +c.figElemBorderW || 1); out.appendChild(bd); }
          pi++;
        });
        y += rowH + gap; i += cols;
      }
      var Htot = Math.max(1, y - gap + pad);
      out.setAttribute("viewBox", "0 0 " + W + " " + Htot);
      if (c.figBg && String(c.figBg).toLowerCase() !== "#ffffff") { var bg = document.createElementNS(SVGNS, "rect"); bg.setAttribute("x", 0); bg.setAttribute("y", 0); bg.setAttribute("width", W); bg.setAttribute("height", Htot); bg.setAttribute("fill", c.figBg); out.insertBefore(bg, out.firstChild); }
      if (c.figFrame) { var fr = document.createElementNS(SVGNS, "rect"); fr.setAttribute("x", 1); fr.setAttribute("y", 1); fr.setAttribute("width", W - 2); fr.setAttribute("height", Htot - 2); fr.setAttribute("fill", "none"); fr.setAttribute("stroke", c.figFrameColor || "#c8d2db"); fr.setAttribute("stroke-width", +c.figFrameW || 1); out.appendChild(fr); }
      return out;
    },
    // Largura de export em PIXELS a partir do unit/valor/DPI do cfg (px direto, ou medida física × DPI).
    _figPxWidth: function () {
      var c = this.cfg, u = c.figUnit || "px", v = +c.figSizeVal || 720, dpi = Math.max(72, +c.figDpi || 96);
      if (u === "px") return v;
      var inch = u === "cm" ? v / 2.54 : u === "mm" ? v / 25.4 : v;   // in
      return Math.max(50, Math.round(inch * dpi));
    },
    exportFigure: function (kind) {
      var fig = this._activeFig(); if (!fig) return;
      var svg = this._buildFigureSvg(fig, this.maxTime(), 720);
      if (!svg) { alert("Escolha ao menos um elemento (um eixo, o radar ou a figura de estados)."); return; }
      var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number), pxW = this._figPxWidth();
      this._exportGraphic(svg, "grafico_" + (fig.name || "praxis").replace(/\s+/g, "_"), kind, pxW, pxW * (vb[3] / vb[2]));
    },
    // Export em LOTE: cada elemento do gráfico ativo como um arquivo próprio (mesma largura física).
    exportFigurePanels: function (kind) {
      var self = this, fig = this._activeFig(); if (!fig) return;
      var maxT = this.maxTime(), pxW = this._figPxWidth(), colsBak = fig.cols, n = 0;
      var flags = { showRadar: fig.showRadar, showIntegrated: fig.showIntegrated, showStates: fig.showStates, dims: (fig.dims || []).slice() };
      function one(patch, base) {
        var tmp = { id: fig.id, name: fig.name, cols: 1, appearId: fig.appearId, showRadar: false, showIntegrated: false, showStates: false, dims: [] };
        for (var k in patch) tmp[k] = patch[k];
        var svg = self._buildFigureSvg(tmp, maxT, 720); if (!svg) return;
        var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
        self._exportGraphic(svg, base, kind, pxW, pxW * (vb[3] / vb[2])); n++;
      }
      if (flags.showRadar) one({ showRadar: true }, "painel_radar");
      if (flags.showIntegrated) one({ showIntegrated: true }, "painel_integrado");
      flags.dims.forEach(function (id) { var t = self.dims().filter(function (d) { return d.id === id; })[0]; one({ dims: [id] }, "painel_" + ((t && t.name) || id).replace(/\s+/g, "_")); });
      if (flags.showStates) one({ showStates: true }, "painel_estados");
      if (P.Segmenter.setStatus) P.Segmenter.setStatus(n ? (n + " painel(is) exportado(s).") : "Nenhum painel para exportar.", n ? "ok" : "err");
    },
    _renderFigCanvas: function (fig, maxT) {
      var self = this, host = document.getElementById("mdim-figcanvas"); if (!host) return;
      var raw = this._buildFigureSvg(fig, maxT, 720);
      host.innerHTML = "";
      if (!raw) { host.innerHTML = '<div class="hint">Escolha ao menos um elemento (um eixo, o radar ou a figura de estados) para ver a prévia.</div>'; return; }
      // prévia idêntica ao export: tema claro + fundo branco (mesmo pipeline do _exportGraphic)
      var svg = this._exportLight(function () { return P.GCP._withWhiteBg(self._inlineColors(raw)); });
      svg.setAttribute("width", "100%"); svg.removeAttribute("height"); svg.style.cssText = "display:block;width:100%;height:auto;border-radius:4px";
      host.appendChild(svg);
    },
    _renderFormatMode: function (host, dims, maxT) {
      var self = this; this._loadFigs(); var fig = this._activeFig();
      // ---- canvas: barra de abas (um gráfico por aba) + prévia grande ----
      var barCard = document.createElement("div"); barCard.className = "card"; barCard.style.cssText = "padding:8px 10px;margin-bottom:12px";
      var tabs = document.createElement("div"); tabs.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center";
      this._figs.forEach(function (f) {
        var b = document.createElement("button"); b.className = "btn sm" + (f.id === self._activeFigId ? " active" : " secondary"); b.textContent = f.name;
        b.title = "Clique para abrir · 2 cliques para renomear";
        b.addEventListener("click", function () { self._activeFigId = f.id; self._saveFigs(); self.render(); });
        b.addEventListener("dblclick", function () { var n = prompt("Nome do gráfico:", f.name); if (n) { f.name = n.trim() || f.name; self._saveFigs(); self.render(); } });
        tabs.appendChild(b);
      });
      var add = document.createElement("button"); add.className = "btn sm ghost"; add.textContent = "+ Novo gráfico";
      add.addEventListener("click", function () { var f = self._newFig("Gráfico " + (self._figs.length + 1)); self._figs.push(f); self._activeFigId = f.id; self._saveFigs(); self.render(); });
      tabs.appendChild(add);
      if (fig && this._figs.length > 1) { var del = document.createElement("button"); del.className = "btn sm ghost"; del.textContent = "Remover"; del.title = "Remover este gráfico"; del.addEventListener("click", function () { if (!confirm("Remover o gráfico «" + fig.name + "»?")) return; self._figs = self._figs.filter(function (x) { return x.id !== fig.id; }); self._activeFigId = self._figs[0].id; self._saveFigs(); self.render(); }); tabs.appendChild(del); }
      barCard.appendChild(tabs); host.appendChild(barCard);
      if (!fig) { this._renderFormatPanels(null, maxT); return; }
      var prevLab = document.createElement("div"); prevLab.className = "mini"; prevLab.style.cssText = "color:var(--txt-dim);margin-bottom:4px"; prevLab.textContent = "Prévia (parâmetros no painel à direita)"; host.appendChild(prevLab);
      var prev = document.createElement("div"); prev.id = "mdim-figcanvas"; prev.className = "card"; prev.style.cssText = "padding:12px"; host.appendChild(prev);
      // ---- inspetor: todos os parâmetros ----
      this._renderFormatPanels(fig, maxT);
      this._renderFigCanvas(fig, maxT);
    },
    // Inspetor do modo de formatação: TODOS os parâmetros (elementos, composição, step-plots, tipografia, cor, exportar).
    _renderFormatPanels: function (fig, maxT) {
      var self = this, c = this.cfg, host = document.getElementById("mdim-format-panels"); if (!host) return;
      if (!fig) { host.innerHTML = ""; return; }
      var FONTS = [["Arial, Helvetica, sans-serif", "Sans (Arial)"], ["'Helvetica Neue', Helvetica, Arial, sans-serif", "Helvetica"], ["'Segoe UI', system-ui, sans-serif", "Segoe UI"], ["Calibri, sans-serif", "Calibri"], ["'Times New Roman', Times, serif", "Serif (Times)"], ["Georgia, serif", "Georgia"], ["Verdana, Geneva, sans-serif", "Verdana"]];
      function grp(t, body, open) { return '<details class="group"' + (open ? " open" : "") + '><summary>' + t + '<span class="chev" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3L8 6l-3.5 3"/></svg></span></summary><div class="group-body">' + body + '</div></details>'; }
      function num(k, lbl, mn, mx, st) { return '<div class="field" style="flex:1"><label>' + lbl + '</label><input type="number" data-cfg="' + k + '" value="' + (c[k]) + '" min="' + mn + '" max="' + mx + '" step="' + st + '"></div>'; }
      function rng(k, lbl, mn, mx, st) { return '<div class="field"><label>' + lbl + ' · <span data-v="' + k + '">' + c[k] + '</span></label><input type="range" data-cfg="' + k + '" value="' + c[k] + '" min="' + mn + '" max="' + mx + '" step="' + st + '"></div>'; }
      function chk(k, lbl) { return '<label class="row" style="align-items:center;gap:6px;margin-bottom:3px"><input type="checkbox" data-cfg="' + k + '"' + (c[k] ? " checked" : "") + ' style="flex:0 0 auto"><span class="mini" style="flex:1">' + lbl + '</span></label>'; }
      function color(k, lbl) { return '<div class="row" style="align-items:center;gap:6px;margin-bottom:3px"><input type="color" data-cfg="' + k + '" value="' + c[k] + '" style="flex:0 0 34px"><span class="mini" style="flex:1">' + lbl + '</span></div>'; }
      function sel(k, lbl, opts) { return '<div class="field"><label>' + lbl + '</label><select data-cfg="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(c[k]) === String(o[0]) ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select></div>'; }
      function row(a, b) { return '<div style="display:flex;gap:6px">' + a + b + '</div>'; }
      // Elementos
      var dimChecks = this.dims().map(function (d) { var on = (fig.dims || []).indexOf(d.id) >= 0; return '<label class="row" style="align-items:center;gap:6px;margin-bottom:2px"><input type="checkbox" data-dim="' + d.id + '"' + (on ? " checked" : "") + ' style="flex:0 0 auto"><span class="swatch" style="background:' + (d.cor || "#8899aa") + ';flex:0 0 12px;height:12px;border-radius:3px"></span><span class="mini" style="flex:1">' + P.escapeHtml(d.name) + '</span></label>'; }).join("");
      var elements = '<label class="row" style="align-items:center;gap:6px;margin-bottom:2px"><input type="checkbox" data-el="radar"' + (fig.showRadar ? " checked" : "") + ' style="flex:0 0 auto"><span class="mini" style="flex:1">Radar integrador (estado atual)</span></label>' +
        '<label class="row" style="align-items:center;gap:6px;margin-bottom:2px"><input type="checkbox" data-el="integrated"' + (fig.showIntegrated ? " checked" : "") + ' style="flex:0 0 auto"><span class="mini" style="flex:1">Step-plot integrado</span></label>' +
        '<div class="mini" style="color:var(--txt-dim);margin:6px 0 2px">Step-plots por eixo</div>' + dimChecks +
        '<label class="row" style="align-items:center;gap:6px;margin:6px 0 2px"><input type="checkbox" data-el="states"' + (fig.showStates ? " checked" : "") + ' style="flex:0 0 auto"><span class="mini" style="flex:1">Figura de estados + estatística</span></label>' +
        '<div class="field"><label>Colunas</label><input type="number" data-fig-cols value="' + (fig.cols || 1) + '" min="1" max="4" step="1"></div>' +
        '<div id="mdim-figappear"></div>';
      // Composição
      var comp = row(sel("figUnit", "Unidade", [["px", "px"], ["cm", "cm"], ["mm", "mm"], ["in", "polegada"]]), num("figSizeVal", "Largura", 1, 20000, c.figUnit === "px" ? 10 : 0.1)) +
        row(num("figDpi", "DPI (raster)", 72, 600, 1), num("figGutter", "Espaçamento", 0, 80, 1)) +
        row(num("figPad", "Margem", 0, 80, 1), '<div class="field" style="flex:1"></div>') +
        chk("figPanelLetters", "Letras de painel (A, B, C)") +
        chk("figElemBorder", "Borda em cada painel") + color("figElemBorderColor", "Cor da borda") + num("figElemBorderW", "Espessura da borda", 0.2, 5, 0.1) +
        chk("figFrame", "Moldura da figura") + color("figFrameColor", "Cor da moldura") +
        color("figBg", "Fundo da figura");
      // Step-plots
      var stepp = row(num("spRowPx", "Altura/nível", 8, 60, 1), num("spLineW", "Linha", 0.5, 6, 0.1)) +
        rng("spLaneGap", "Distância entre faixas no mesmo escore", 0, 10, 0.5) +
        row(num("spPointR", "Pontos de troca (0=sem)", 0, 6, 0.5), '<div class="field" style="flex:1"></div>') +
        chk("spGrid", "Grade horizontal") + rng("spGridOpacity", "Opacidade da grade", 0.1, 1, 0.05) +
        chk("spNormalize", "Normalizar cada eixo (integrado)") +
        chk("spIndices", "Mostrar índices (dentro do gráfico)") + chk("spIndexLabels", "Rótulos dos índices") +
        row(num("spIndexSize", "Tamanho do rótulo", 5, 16, 1), num("spIndexDiamond", "Tamanho do símbolo", 0.5, 12, 0.5)) +
        row(num("spIndexStackGap", "Empilhamento vertical", 0, 24, 1), num("spIndexHGap", "Folga horizontal", 0, 24, 1)) +
        chk("spIndexTick", "Traço vertical no índice") +
        row(num("spIndexTickW", "Espessura do traço", 0.3, 4, 0.1), num("spIndexTickOpacity", "Opacidade do traço", 0.1, 1, 0.05)) +
        sel("spIndexTickDash", "Padrão do traço", [["", "sólido"], ["2 3", "tracejado"], ["1 3", "pontilhado"], ["6 3 1 3", "traço-ponto"], ["3 2", "denso"]]) +
        chk("spLegend", "Legenda") + sel("spLegendPos", "Posição da legenda", [["right", "direita"], ["top", "topo"], ["bottom", "base"]]) + num("spLegendSize", "Tamanho da legenda", 6, 20, 1);
      // Tipografia
      var typo = sel("figFont", "Fonte", FONTS) +
        row(num("figSzTitle", "Título", 6, 30, 1), num("figSzPanel", "Letra de painel", 6, 30, 1)) +
        row(num("figSzAxis", "Rótulos de eixo", 6, 24, 1), num("figSzTick", "Ticks", 5, 20, 1)) +
        row(num("figSzStats", "Estatística", 6, 24, 1), '<div class="field" style="flex:1"></div>');
      // Cor e faixas de tipo
      var dimColors = this.dims().map(function (d) { return '<div class="row" style="align-items:center;gap:6px;margin-bottom:1px"><input type="color" data-dimcolor="' + d.id + '" value="' + (d.cor || "#4f9df5") + '" style="flex:0 0 34px"><span class="mini" style="flex:1">' + P.escapeHtml(d.name) + '</span></div>' + self._cbSwatchRow("dim", d.id); }).join("");
      var colorSec = '<button class="btn secondary wide" id="mdim-cb-apply" style="margin-bottom:8px" title="Recolore todas as dimensões e tipos com a paleta segura para daltônicos (Okabe-Ito)">Aplicar paleta para daltônicos (tudo)</button>' +
        chk("figMono", "Preto e branco (linhas em cinza, distintas por tracejado)") +
        chk("figCbPalette", "Paleta daltônico nas dimensões (só na figura)") +
        chk("figLineDash", "Tracejado por dimensão (mesmo em cor)") +
        '<div class="mini" style="color:var(--txt-dim);margin:6px 0 3px">Cor de cada dimensão (clique num swatch = paleta daltônico)</div>' + dimColors +
        '<label class="row" style="align-items:center;gap:6px;margin:6px 0"><input type="checkbox" id="mdim-fmt-typebands"' + (this._showTypeBands ? " checked" : "") + ' style="flex:0 0 auto"><span class="mini" style="flex:1">Faixas de tipo ao fundo dos step-plots</span></label>';
      // Exportar
      var exp = '<div class="mini" style="color:var(--txt-dim);margin-bottom:3px">Figura combinada</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-exp="svg">SVG</button><button class="btn secondary" data-exp="png">PNG</button><button class="btn secondary" data-exp="jpg">JPG</button></div>' +
        '<div class="mini" style="color:var(--txt-dim);margin:8px 0 3px">Cada painel separado (lote)</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost" data-expp="svg">SVG</button><button class="btn ghost" data-expp="png">PNG</button><button class="btn ghost" data-expp="jpg">JPG</button></div>' +
        '<p class="hint" style="margin-top:6px">SVG é vetorial (DPI não se aplica). Largura em px, ou em cm/mm/pol × DPI.</p>';
      host.innerHTML = grp("Elementos", elements, true) + grp("Composição e tamanho", comp) + grp("Step-plots", stepp) + grp("Tipografia", typo) + grp("Cor e faixas de tipo", colorSec) + grp("Exportar", exp, true);
      // wiring genérico dos parâmetros do cfg
      Array.prototype.forEach.call(host.querySelectorAll("[data-cfg]"), function (el) {
        var k = el.dataset.cfg, evt = (el.type === "color" || el.type === "range") ? "input" : "change";
        el.addEventListener(evt, function () {
          var v = (el.type === "checkbox") ? el.checked : (el.type === "number" || el.type === "range") ? parseFloat(el.value) : el.value;
          self.cfg[k] = v; self._saveCfg();
          var vs = host.querySelector('[data-v="' + k + '"]'); if (vs) vs.textContent = v;
          if (k === "figUnit") self._renderFormatPanels(fig, maxT);
          self._renderFigCanvas(fig, maxT);
        });
      });
      // elementos (por figura)
      Array.prototype.forEach.call(host.querySelectorAll("[data-dim]"), function (cb) { cb.addEventListener("change", function () { fig.dims = Array.prototype.slice.call(host.querySelectorAll("[data-dim]:checked")).map(function (x) { return x.dataset.dim; }); self._saveFigs(); self._renderFigCanvas(fig, maxT); }); });
      host.querySelector('[data-el="radar"]').addEventListener("change", function () { fig.showRadar = this.checked; self._saveFigs(); self._renderFigCanvas(fig, maxT); });
      host.querySelector('[data-el="integrated"]').addEventListener("change", function () { fig.showIntegrated = this.checked; self._saveFigs(); self._renderFigCanvas(fig, maxT); });
      host.querySelector('[data-el="states"]').addEventListener("change", function () { fig.showStates = this.checked; self._saveFigs(); self._renderFigCanvas(fig, maxT); });
      host.querySelector("[data-fig-cols]").addEventListener("change", function () { fig.cols = Math.max(1, Math.min(4, +this.value || 1)); self._saveFigs(); self._renderFigCanvas(fig, maxT); });
      // faixas de tipo
      host.querySelector("#mdim-fmt-typebands").addEventListener("change", function () { self._showTypeBands = this.checked; try { localStorage.setItem("praxis.mdim.typebands", this.checked ? "1" : "0"); } catch (e) {} self._renderFigCanvas(fig, maxT); });
      host.querySelector("#mdim-cb-apply").addEventListener("click", function () { self.applyCbPalette(); self._renderFormatPanels(fig, maxT); self._renderFigCanvas(fig, maxT); });
      Array.prototype.forEach.call(host.querySelectorAll("[data-dimcolor]"), function (inp) { inp.addEventListener("input", function () { var d = self.dims().filter(function (x) { return x.id === inp.dataset.dimcolor; })[0]; if (d) { d.cor = this.value; if (P.Segmenter.commit) P.Segmenter.commit(); } self._renderFigCanvas(fig, maxT); }); });
      Array.prototype.forEach.call(host.querySelectorAll("[data-cbset]"), function (b) { b.addEventListener("click", function () { var p = b.dataset.cbset.split(":"), kind = p[0], id = p[1], hex = p[2]; if (kind === "dim") { var d = self.dims().filter(function (x) { return x.id === id; })[0]; if (d) { d.cor = hex; if (P.Segmenter.commit) P.Segmenter.commit(); } } else if (kind === "type") { self.cfg.typeColors[id] = hex; self._saveCfg(); } self._renderFormatPanels(fig, maxT); self._renderFigCanvas(fig, maxT); }); });
      // aparência (conjunto) e cor por tipo, reusando o editor existente num container do painel
      this._renderFigAppear(fig);
      // export
      Array.prototype.forEach.call(host.querySelectorAll("[data-exp]"), function (b) { b.addEventListener("click", function () { self.exportFigure(b.dataset.exp); }); });
      Array.prototype.forEach.call(host.querySelectorAll("[data-expp]"), function (b) { b.addEventListener("click", function () { self.exportFigurePanels(b.dataset.expp); }); });
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);
    },
    // Editor do conjunto de aparência do gráfico ativo (associar/dissociar, cores/opacidade/sobreposição/fonte por conjunto).
    _renderFigAppear: function (fig) {
      var self = this, host = document.getElementById("mdim-figappear"); if (!host || !fig) return;
      this._loadAppear(); var set = this._figAppear(fig); if (!set.over) set.over = this._appearFromCfg();
      var over = set.over, cats = P.Segmenter.categories || [];
      var FONTS = [["Arial, Helvetica, sans-serif", "Sans (Arial)"], ["'Helvetica Neue', Helvetica, Arial, sans-serif", "Helvetica"], ["'Segoe UI', system-ui, sans-serif", "Segoe UI"], ["Calibri, sans-serif", "Calibri"], ["'Times New Roman', Times, serif", "Serif (Times)"], ["Georgia, serif", "Georgia"], ["Verdana, Geneva, sans-serif", "Verdana"]];
      var modes = [["hatch", "Rachura com as cores"], ["highlight", "Realce (vermelho)"], ["neutral", "Rachura neutra"], ["split", "Sub-faixas"]];
      var h = '<div class="mini" style="color:var(--txt-dim);margin:8px 0 3px">Aparência (conjunto)</div>' +
        '<div class="row" style="gap:6px;margin-bottom:4px"><select data-set style="flex:1">' + this._appearSets.map(function (s) { return '<option value="' + s.id + '"' + (s.id === set.id ? " selected" : "") + '>' + P.escapeHtml(s.name) + '</option>'; }).join("") + '</select><button class="btn sm ghost" data-newset title="Criar um conjunto novo">+ Novo</button><button class="btn sm ghost" data-dissoc title="Cópia própria só deste gráfico">Dissociar</button></div>' +
        '<div class="field"><label>Nome do conjunto</label><input data-setname value="' + P.escapeHtml(set.name) + '"></div>' +
        '<div class="field"><label>Fonte</label><select data-font>' + FONTS.map(function (f) { return '<option value="' + f[0] + '"' + ((over.figFont || self.cfg.figFont) === f[0] ? " selected" : "") + '>' + f[1] + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>Sobreposição de tipos</label><select data-ov>' + modes.map(function (m) { return '<option value="' + m[0] + '"' + ((over.typeOverlapMode || "hatch") === m[0] ? " selected" : "") + '>' + m[1] + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>Opacidade das faixas · <span data-opv>' + Math.round((over.typeBandOpacity || 0.18) * 100) + '%</span></label><input type="range" data-op min="0.05" max="0.6" step="0.02" value="' + (over.typeBandOpacity || 0.18) + '"></div>';
      if (cats.length) { h += '<div class="mini" style="color:var(--txt-dim);margin:4px 0 3px">Cor de cada tipo (clique num swatch = paleta daltônico)</div>'; cats.forEach(function (c) { var col = (over.typeColors && over.typeColors[c.id]) || c.cor || "#8899aa"; h += '<div class="row" style="align-items:center;gap:6px;margin-bottom:1px"><input type="color" data-cc="' + c.id + '" value="' + col + '" style="flex:0 0 34px"><span class="mini" style="flex:1">' + P.escapeHtml(c.nome) + '</span></div>' + self._cbSwatchRow("type", c.id); }); }
      host.innerHTML = h;
      function commit() { self._saveAppear(); self._renderFigCanvas(fig, self.maxTime()); }
      host.querySelector("[data-set]").addEventListener("change", function () { fig.appearId = this.value; self._saveFigs(); self.render(); });
      host.querySelector("[data-newset]").addEventListener("click", function () { var ns = { id: "ap" + Date.now().toString(36), name: "Aparência " + (self._appearSets.length + 1), over: self._appearFromCfg() }; self._appearSets.push(ns); fig.appearId = ns.id; self._saveAppear(); self._saveFigs(); self.render(); });
      host.querySelector("[data-dissoc]").addEventListener("click", function () { var copy = { id: "ap" + Date.now().toString(36), name: set.name + " (cópia)", over: JSON.parse(JSON.stringify(over)) }; self._appearSets.push(copy); fig.appearId = copy.id; self._saveAppear(); self._saveFigs(); self.render(); });
      host.querySelector("[data-setname]").addEventListener("change", function () { set.name = this.value.trim() || set.name; self._saveAppear(); self.render(); });
      host.querySelector("[data-font]").addEventListener("change", function () { over.figFont = this.value; commit(); });
      host.querySelector("[data-ov]").addEventListener("change", function () { over.typeOverlapMode = this.value; commit(); });
      host.querySelector("[data-op]").addEventListener("input", function () { over.typeBandOpacity = parseFloat(this.value); var v = host.querySelector("[data-opv]"); if (v) v.textContent = Math.round(this.value * 100) + "%"; commit(); });
      Array.prototype.forEach.call(host.querySelectorAll("[data-cc]"), function (inp) { inp.addEventListener("input", function () { if (!over.typeColors) over.typeColors = {}; over.typeColors[inp.dataset.cc] = this.value; commit(); }); });
      Array.prototype.forEach.call(host.querySelectorAll('[data-cbset^="type:"]'), function (b) { b.addEventListener("click", function () { var p = b.dataset.cbset.split(":"); if (!over.typeColors) over.typeColors = {}; over.typeColors[p[1]] = p[2]; self._saveAppear(); self._renderFigAppear(fig); self._renderFigCanvas(fig, self.maxTime()); }); });
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);
    },

    // --- Dataset didático (exemplo realista, não é fixture aleatório) --------
    loadDidactic: function () {
      var S = P.Segmenter;
      var nDim = S.tiers.filter(function (t) { return t.kind === "dimensao"; }).length, nCat = (S.categories || []).length;
      if ((nDim || nCat) && !confirm("Carregar o exemplo didático SUBSTITUI as " + nDim + " dimensão(ões) e os " + nCat + " tipo(s) de prática deste projeto (dá para desfazer com " + (P.modKey || "Ctrl") + "+Z).\n\nContinuar?")) return;
      S.tiers = S.tiers.filter(function (t) { return t.kind !== "dimensao"; });
      S.categories = [];
      var dur = this.maxTime(); if (!(dur > 5)) dur = 90;
      function segs(scores) { var a = [], w = dur / scores.length; for (var i = 0; i < scores.length; i++) a.push({ tStart: i * w, tEnd: (i + 1) * w, value: String(scores[i]), note: "" }); return a; }
      function voc(n, labels) { var v = []; for (var k = 1; k <= n; k++) v.push({ code: String(k), label: (labels && labels[k - 1]) || "" }); return v; }
      var ex = [
        { id: "did_react", name: "Reatividade", escalaMax: 5, cor: P.PALETTE_COLOR[0], vocab: voc(5, ["inerte", "baixa", "média", "alta", "imediata"]), segments: segs([2, 3, 4, 5, 4, 3, 4]) },
        { id: "did_resol", name: "Resolutividade", escalaMax: 5, cor: P.PALETTE_COLOR[1], vocab: voc(5, ["nenhuma", "parcial", "média", "boa", "completa"]), segments: segs([1, 2, 3, 4, 5, 4, 5]) },
        { id: "did_desaf", name: "Desafiabilidade", escalaMax: 4, cor: P.PALETTE_COLOR[3], vocab: voc(4, ["trivial", "moderada", "difícil", "no limite"]), segments: segs([1, 2, 3, 4, 3, 2, 3]) }
      ];
      ex.forEach(function (d) { d.kind = "dimensao"; d.activeCat = "1"; S.tiers.push(d); });
      var iv = function (a, b, c) { var o = {}; o[ex[0].id] = a; o[ex[1].id] = b; o[ex[2].id] = c; return o; };
      S.categories = [
        { id: "did_c1", nome: "Exploratória", cor: P.PALETTE_COLOR[4], pattern: "diag", dash: "5 4", intervalos: iv([2, 4], [1, 3], [3, 4]) },
        { id: "did_c2", nome: "Consolidação", cor: P.PALETTE_COLOR[1], pattern: "cross", dash: "", intervalos: iv([3, 5], [4, 5], [1, 2]) },
        { id: "did_c3", nome: "Fluida", cor: P.PALETTE_COLOR[0], pattern: "dots", dash: "2 3", intervalos: iv([4, 5], [4, 5], [2, 3]) }
      ];
      this._activeDimId = ex[0].id;
      if (S.renderTiers) S.renderTiers();
      if (S.updateActions) S.updateActions();
      if (S.commit) S.commit();   // um passo do desfazer (dimensões e tipos estão no histórico)
      this.refresh();
    },

    // --- Interoperabilidade CSV (formato ELAN) ----------------------------------
    _fmtHMS: function (sec) {
      sec = Math.max(0, sec || 0);
      var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
      function p2(n) { return (n < 10 ? "0" : "") + n; }
      return p2(h) + ":" + p2(m) + ":" + (s < 10 ? "0" : "") + s.toFixed(3);
    },
    exportCSV: function () {
      var self = this, dims = this.dims();
      if (!dims.length) { alert("Nenhuma dimensão para exportar. Crie dimensões ou carregue o exemplo."); return; }
      var rows = [["Dimensão", "Tempo inicial", "Tempo final", "Duração", "Escore", "Descrição do escore"]];
      dims.forEach(function (d) {
        var labels = {}; (d.vocab || []).forEach(function (v) { labels[v.code] = v.label; });
        d.segments.slice().sort(function (a, b) { return a.tStart - b.tStart; }).forEach(function (s) {
          rows.push([d.name, self._fmtHMS(s.tStart), self._fmtHMS(s.tEnd), self._fmtHMS(s.tEnd - s.tStart), s.value, labels[s.value] || ""]);
        });
      });
      P.download("dimensoes_praxis.csv", "﻿" + P.toCSV(rows, ";"), "text/csv;charset=utf-8");
    },
    // Converte linhas de CSV em camadas-dimensão (agrupa por nome de dimensão).
    _csvToDims: function (rows, idBase) {
      if (!rows || !rows.length) return [];
      var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
      var hasHeader = header.some(function (h) { return /dimens|in[íi]cio|inicial|start|escore|score|tempo/.test(h); });
      var body = hasHeader ? rows.slice(1) : rows;
      function col(re) { for (var i = 0; i < header.length; i++) if (re.test(header[i])) return i; return -1; }
      var ci = hasHeader
        ? { dim: col(/dimens|camada|tier/), start: col(/in[íi]cio|inicial|\bstart\b/), end: col(/final|\bfim\b|\bend\b/), score: col(/escore|score|valor/), desc: col(/descri/) }
        : { dim: 0, start: 1, end: 2, score: 4, desc: 5 };   // ordem ELAN: dim, ini, fim, dur, escore, descrição
      if (ci.dim < 0 || ci.start < 0 || ci.end < 0) return [];
      var groups = {}, order = [];
      body.forEach(function (r) {
        if (!r.length) return;
        var name = (r[ci.dim] || "").trim(); if (!name) return;
        var a = P.parseTime(r[ci.start]), b = P.parseTime(r[ci.end]);
        if (!isFinite(a) || !isFinite(b)) return;
        var val = ci.score >= 0 && r[ci.score] != null ? String(r[ci.score]).trim() : "";
        var desc = ci.desc >= 0 ? (r[ci.desc] || "").trim() : "";
        if (!groups[name]) { groups[name] = []; order.push(name); }
        groups[name].push({ tStart: a, tEnd: b, value: val, desc: desc });
      });
      var tiers = [], base = (idBase || "csvdim") + (P.Segmenter.tiers.length) + "_";
      order.forEach(function (name, gi) {
        var segs = groups[name].sort(function (x, y) { return x.tStart - y.tStart; });
        var scores = {}; segs.forEach(function (s) { if (s.value !== "" && isFinite(parseFloat(s.value))) scores[s.value] = s.desc || scores[s.value] || ""; });
        var codes = Object.keys(scores).map(Number).filter(isFinite);
        var escalaMax = codes.length ? Math.max.apply(null, codes) : 5;
        var vocab = []; for (var k = 1; k <= escalaMax; k++) vocab.push({ code: String(k), label: scores[String(k)] || "" });
        tiers.push({ id: base + gi, name: name, kind: "dimensao", escalaMax: escalaMax, cor: P.PALETTE_COLOR[(P.Segmenter.tiers.length + gi) % P.PALETTE_COLOR.length], vocab: vocab, activeCat: "1", segments: segs.map(function (s) { return { tStart: s.tStart, tEnd: s.tEnd, value: s.value, note: "" }; }) });
      });
      return tiers;
    },
    importCSV: function (file) {
      var self = this, reader = new FileReader();
      reader.onload = function () {
        try {
          var dec = P.decodeBuffer(reader.result), rows = P.parseCSV(dec.text);
          var tiers = self._csvToDims(rows);
          if (!tiers.length) { alert("Não consegui interpretar o CSV. Preciso de colunas de Dimensão, Tempo inicial, Tempo final e Escore (formato ELAN)."); return; }
          tiers.forEach(function (t) { P.Segmenter.tiers.push(t); });
          self._activeDimId = tiers[0].id;
          if (P.Segmenter.renderTiers) P.Segmenter.renderTiers();
          if (P.Segmenter.updateActions) P.Segmenter.updateActions();
          self.refresh();
          if (P._activate) P._activate("multidim");
        } catch (e) { alert("Falha ao importar CSV: " + (e && e.message ? e.message : e)); }
      };
      reader.readAsArrayBuffer(file);
    },

    // --- Camadas comparativas ---------------------------------------------------
    _newCompareId: function () { var ids = this._compares.map(function (c) { return c.id; }), i = 1; while (ids.indexOf("cmp" + i) >= 0) i++; return "cmp" + i; },
    _addCompare: function (nome, dims) {
      var nBase = this.dims().length;
      if (!dims.length) { alert("Nenhuma dimensão encontrada no arquivo."); return; }
      if (nBase && dims.length !== nBase) {
        if (!confirm("A camada tem " + dims.length + " dimensão(ões), diferente da sessão atual (" + nBase + "). O radar alinha por posição do eixo. Adicionar mesmo assim?")) return;
      }
      var c = { id: this._newCompareId(), nome: nome || ("Camada " + (this._compares.length + 1)), cor: P.PALETTE_COLOR[(this._compares.length + 3) % P.PALETTE_COLOR.length], dims: dims, t: 0, playing: false, speed: 1, lastTs: 0 };
      this._compares.push(c);
      this.refresh();
    },
    removeCompare: function (id) { this._compares = this._compares.filter(function (c) { return c.id !== id; }); this.refresh(); },
    addCompareFromCSV: function (file) {
      var self = this, reader = new FileReader();
      reader.onload = function () {
        try { var dec = P.decodeBuffer(reader.result); var tiers = self._csvToDims(P.parseCSV(dec.text), "cmpdim"); self._addCompare(file.name.replace(/\.csv$/i, ""), tiers); }
        catch (e) { alert("Falha ao ler CSV: " + (e && e.message ? e.message : e)); }
      };
      reader.readAsArrayBuffer(file);
    },
    // Lê um .praxis (só para extrair as dimensões, sem alterar o projeto atual).
    addCompareFromPraxis: function (file) {
      var self = this, reader = new FileReader();
      reader.onload = function () {
        try {
          var buf = reader.result, bytes = new Uint8Array(buf);
          if (new TextDecoder().decode(bytes.slice(0, 8)) !== "PRAXIS01") { alert("Arquivo .praxis inválido."); return; }
          var jsonLen = new DataView(buf).getUint32(8, true);
          var proj = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + jsonLen)));
          var dims = (proj.tiers || []).filter(function (t) { return t.kind === "dimensao"; });
          if (!dims.length) { alert("Este .praxis não tem camadas de dimensão."); return; }
          self._addCompare(file.name.replace(/\.praxis$/i, ""), dims);
        } catch (e) { alert("Falha ao ler .praxis: " + (e && e.message ? e.message : e)); }
      };
      reader.readAsArrayBuffer(file);
    },
    _compareMax: function (cl) { var m = 0; (cl.dims || []).forEach(function (d) { (d.segments || []).forEach(function (s) { if (s.tEnd > m) m = s.tEnd; }); }); return m > 0 ? m : 1; },

    renderCompares: function () {
      var self = this, host = this.refs.compares; if (!host) return;
      host.innerHTML = "";
      // modo overlay / lado a lado
      var modeRow = document.createElement("div"); modeRow.className = "field";
      modeRow.innerHTML = '<label>Disposição</label><select data-mode><option value="overlay"' + (this._mode === "overlay" ? " selected" : "") + '>Sobrepostas (overlay)</option><option value="side"' + (this._mode === "side" ? " selected" : "") + '>Lado a lado</option></select>';
      modeRow.querySelector("[data-mode]").addEventListener("change", function () { self._mode = this.value; self.render(); });
      host.appendChild(modeRow);
      // lista de camadas comparativas
      this._compares.forEach(function (c) {
        var box = document.createElement("div");
        box.style.cssText = "margin-bottom:6px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)";
        var head = document.createElement("div"); head.className = "row"; head.style.cssText = "align-items:center;gap:6px;margin-bottom:4px";
        head.innerHTML = '<input type="color" data-col value="' + c.cor + '" style="flex:0 0 26px;height:24px;padding:1px">' +
          '<b style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + P.escapeHtml(c.nome) + '">' + P.escapeHtml(c.nome) + '</b>' +
          '<span class="mini" style="color:var(--txt-dim)">' + c.dims.length + ' dim</span>' +
          '<button class="btn sm ghost" data-del title="Remover" style="flex:0 0 auto">' + P.ICON.close + '</button>';
        head.querySelector("[data-col]").addEventListener("input", function () { c.cor = this.value; self._updateRadar(); });
        head.querySelector("[data-col]").addEventListener("change", function () { if (self._mode === "side") self.render(); });
        head.querySelector("[data-del]").addEventListener("click", function () { self.removeCompare(c.id); });
        box.appendChild(head);
        // transporte independente: play/pause + velocidade + scrub
        var tr = document.createElement("div"); tr.className = "row"; tr.style.cssText = "align-items:center;gap:6px";
        var maxc = self._compareMax(c);
        tr.innerHTML = '<button class="btn sm secondary" data-play style="flex:0 0 auto">' + (c.playing ? P.ICON.pause : P.ICON.play) + '</button>' +
          '<select data-sp class="mini" style="flex:0 0 auto">' + self.SPEEDS.map(function (v) { return '<option value="' + v + '"' + (v === c.speed ? " selected" : "") + '>' + v + '×</option>'; }).join("") + '</select>' +
          '<input type="range" data-scrub min="0" max="' + maxc + '" step="0.05" value="' + c.t + '" style="flex:1">' +
          '<span class="mini" data-clk style="flex:0 0 auto;font-variant-numeric:tabular-nums">' + P.fmtTime(c.t, true) + '</span>';
        tr.querySelector("[data-play]").addEventListener("click", function () { c.playing = !c.playing; c.lastTs = 0; if (c.t >= maxc - 0.01) c.t = 0; this.innerHTML = c.playing ? P.ICON.pause : P.ICON.play; });
        tr.querySelector("[data-sp]").addEventListener("change", function () { c.speed = parseFloat(this.value); });
        tr.querySelector("[data-scrub]").addEventListener("input", function () { c.t = parseFloat(this.value); tr.querySelector("[data-clk]").textContent = P.fmtTime(c.t, true); self._updateRadar(); if (self._mode === "side") self._updateMinis(); });
        c._scrub = tr.querySelector("[data-scrub]"); c._clk = tr.querySelector("[data-clk]"); c._playBtn = tr.querySelector("[data-play]");
        box.appendChild(tr);
        host.appendChild(box);
      });
      // adicionar camada
      var add = document.createElement("div"); add.className = "row"; add.style.cssText = "gap:6px;margin-top:4px";
      add.innerHTML = '<button class="btn ghost" data-csv style="flex:1">Adicionar de CSV</button><button class="btn ghost" data-prx style="flex:1">Adicionar de .praxis</button>' +
        '<input type="file" data-csvf accept=".csv,text/csv" hidden><input type="file" data-prxf accept=".praxis" hidden>';
      var csvf = add.querySelector("[data-csvf]"), prxf = add.querySelector("[data-prxf]");
      add.querySelector("[data-csv]").addEventListener("click", function () { csvf.click(); });
      add.querySelector("[data-prx]").addEventListener("click", function () { prxf.click(); });
      csvf.addEventListener("change", function () { if (this.files[0]) self.addCompareFromCSV(this.files[0]); this.value = ""; });
      prxf.addEventListener("change", function () { if (this.files[0]) self.addCompareFromPraxis(this.files[0]); this.value = ""; });
      host.appendChild(add);
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);
    },

    // Radar compacto (small multiple) para uma camada. Retorna refs p/ atualizar.
    _buildMini: function (dims, cor, gmax, title) {
      var self = this, cfg = this.cfg;
      var W = 220, H = 210, cx = 110, cy = 98, R = 64;
      function mk(tag, at) { var e = document.createElementNS(SVGNS, tag); for (var k in at) e.setAttribute(k, at[k]); return e; }
      var N = dims.length, ccol = this._bw(cor);
      function ang(i) { return -Math.PI / 2 + i * 2 * Math.PI / N; }
      function pt(i, f) { var a = ang(i); return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f]; }
      var B = this._rBase();   // centro do radar = mínimo da escala (1) ou zero
      function fracFor(escMax, sc) { if (sc == null) return null; var dd = (cfg.normalize ? escMax : gmax) - B; return dd > 0 ? (sc - B) / dd : 0; }
      function axisMaxFrac(esc) { return cfg.normalize ? 1 : (gmax - B > 0 ? (esc - B) / (gmax - B) : 1); }
      var escs = dims.map(function (d) { return P.Segmenter.escalaMaxOf(d); }), uniform = escs.every(function (e) { return e === escs[0]; });
      var wrap = document.createElement("div"); wrap.style.cssText = "text-align:center";
      var cap = document.createElement("div"); cap.className = "mini"; cap.style.cssText = "font-weight:600;color:" + ccol; cap.textContent = title; wrap.appendChild(cap);
      var svg = mk("svg", { viewBox: "0 0 " + W + " " + H, width: W }); svg.style.display = "block";
      function webPoly(f, col, sw) { var pp = []; for (var i = 0; i < N; i++) { var p = pt(i, f * axisMaxFrac(P.Segmenter.escalaMaxOf(dims[i]))); pp.push(p[0] + "," + p[1]); } return mk("polygon", { points: pp.join(" "), fill: "none", stroke: col || cfg.ringColor, "stroke-width": sw || cfg.ringWidth, "stroke-linejoin": "round" }); }
      var minEsc = Math.min.apply(null, escs);
      function mvtx(i, f) { var p = pt(i, f); return p[0] + "," + p[1]; }
      function mpath(coords, closed) { svg.appendChild(mk(closed ? "polygon" : "polyline", { points: coords.join(" "), fill: "none", stroke: cfg.ringColor, "stroke-width": cfg.ringWidth, "stroke-linejoin": "round" })); }
      function mpos(i, k) { return fracFor(escs[i], k); }
      if (cfg.showRings && cfg.gridStyle !== "nenhuma") {
        var gs = cfg.gridStyle, i, k, j, coords;
        if (gs === "circulos") { var lev = (cfg.normalize && uniform) ? escs[0] : gmax; for (k = B + 1; k <= lev; k++) svg.appendChild(mk("circle", { cx: cx, cy: cy, r: (k - B) / (lev - B) * R, fill: "none", stroke: cfg.ringColor, "stroke-width": cfg.ringWidth })); }
        else if (gs === "teia-exata") { for (k = B + 1; k <= gmax; k++) { coords = []; for (i = 0; i < N; i++) if (escs[i] >= k) coords.push(mvtx(i, mpos(i, k))); if (coords.length >= 2) mpath(coords, coords.length === N); } }
        else if (gs === "teia-vanish") { for (k = B + 1; k <= gmax; k++) { coords = []; for (i = 0; i < N; i++) coords.push(mvtx(i, mpos(i, Math.min(k, escs[i])))); mpath(coords, true); } }
        else { for (j = 1; j <= minEsc - B; j++) { coords = []; for (i = 0; i < N; i++) coords.push(mvtx(i, (j / (minEsc - B)) * axisMaxFrac(escs[i]))); mpath(coords, true); } }   // teia-prop e marcas → teia proporcional no mini
      }
      if (cfg.outerContour === "poligono") svg.appendChild(webPoly(1, self._bw(cfg.outerColor), cfg.outerWidth));
      else if (cfg.outerContour === "circulo") svg.appendChild(mk("circle", { cx: cx, cy: cy, r: R, fill: "none", stroke: self._bw(cfg.outerColor), "stroke-width": cfg.outerWidth }));
      else if (cfg.outerContour === "exata") {
        var ec = [];
        for (i = 0; i < N; i++) { var pv = (i - 1 + N) % N, nx = (i + 1) % N; ec.push(mvtx(i, mpos(i, Math.min(escs[i], escs[pv])))); ec.push(mvtx(i, mpos(i, Math.min(escs[i], escs[nx])))); }
        svg.appendChild(mk("polygon", { points: ec.join(" "), fill: "none", stroke: self._bw(cfg.outerColor), "stroke-width": cfg.outerWidth, "stroke-linejoin": "round" }));
      }
      dims.forEach(function (t, i) {
        var amf = axisMaxFrac(P.Segmenter.escalaMaxOf(t)), p = pt(i, amf); svg.appendChild(mk("line", { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: cfg.axisColor, "stroke-width": cfg.axisWidth }));
        var a = ang(i), lr = amf * R + 12, lp = [cx + Math.cos(a) * lr, cy + Math.sin(a) * lr];
        var anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
        var lb = mk("text", { x: lp[0], y: lp[1] + 3, "font-size": 8, fill: "var(--txt-dim)", "text-anchor": anchor }); lb.textContent = String(t.name).slice(0, 8); svg.appendChild(lb);
      });
      var poly = mk("polygon", { points: "", fill: ccol + this._alpha(cfg.polyOpacity), stroke: ccol, "stroke-width": cfg.outlineWidth, "stroke-linejoin": "round" });
      svg.appendChild(poly);
      wrap.appendChild(svg);
      return { el: wrap, poly: poly, dims: dims, pt: pt, fracFor: fracFor };
    },
    _renderSide: function (host) {
      var self = this; this._minis = [];
      var gmax = this._radar ? this._radar.gmax : 5;
      var card = document.createElement("div"); card.className = "card"; card.style.cssText = "margin-bottom:14px;padding:10px 12px";
      card.innerHTML = '<b class="t-strong">Camadas lado a lado</b> <span class="hint">cada uma no seu próprio cursor</span>';
      var wrap = document.createElement("div"); wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:6px";
      // base + comparativas como small multiples
      var layers = [{ dims: this.dims(), cor: this._radar ? this._radar.accent : "#4f9df5", nome: "Sessão atual", getT: function () { return self.currentT(); } }]
        .concat(this._compares.map(function (c) { return { dims: c.dims, cor: c.cor, nome: c.nome, getT: function () { return c.t; } }; }));
      layers.forEach(function (L) {
        var m = self._buildMini(L.dims, L.cor, gmax, L.nome);
        wrap.appendChild(m.el);
        self._minis.push({ poly: m.poly, dims: m.dims, pt: m.pt, fracFor: m.fracFor, getT: L.getT });
      });
      card.appendChild(wrap); host.appendChild(card);
      this._updateMinis();
    },
    _updateMinis: function () {
      var self = this;
      (this._minis || []).forEach(function (m) {
        var t = m.getT(), skip = self._rBase() === 1, pts = m.dims.map(function (d, i) {
          var sc = P.Segmenter.dimScoreAt(d, t); if (sc == null && skip) return null;   // centro = 1 → sem dado não vai ao centro
          var f = (sc == null) ? 0 : Math.max(0, Math.min(1, m.fracFor(P.Segmenter.escalaMaxOf(d), sc)));
          var p = m.pt(i, f); return p[0] + "," + p[1];
        }).filter(function (x) { return x != null; }).join(" ");
        m.poly.setAttribute("points", pts);
      });
    },

    // Painel do GIF: escolher os tipos de prática (estados), a duração e exportar.
    renderGif: function () {
      var self = this, host = this.refs.gif, cfg = this.cfg; if (!host) return;
      var cats = P.Segmenter.categories || [];
      if (!cats.length) { host.innerHTML = '<div class="hint">Defina tipos de prática para exportar seus estados.</div>'; return; }
      var orderIds = this._figOrderIds();
      var selSet = cfg.figSel ? cfg.figSel : orderIds.slice();     // null = todos
      var inc = cfg.figInclude;
      var FONTS = [["Arial, Helvetica, sans-serif", "Sans (Arial)"], ["'Helvetica Neue', Helvetica, Arial, sans-serif", "Helvetica"], ["'Segoe UI', system-ui, sans-serif", "Segoe UI"], ["Calibri, sans-serif", "Calibri"], ["'Times New Roman', Times, serif", "Serif (Times)"], ["Georgia, serif", "Georgia"], ["Verdana, Geneva, sans-serif", "Verdana"]];
      function esc(s) { return P.escapeHtml(s); }
      // --- lista de tipos: marcar (aparecer) + reordenar (▲▼) ---
      var list = orderIds.map(function (id, i) {
        var c = cats.filter(function (x) { return x.id === id; })[0]; if (!c) return "";
        var on = selSet.indexOf(id) >= 0;
        return '<div class="row" style="align-items:center;gap:6px;margin-bottom:3px">' +
          '<input type="checkbox" data-cat="' + id + '"' + (on ? " checked" : "") + ' style="flex:0 0 auto">' +
          '<span class="swatch" style="background:' + c.cor + ';flex:0 0 12px;height:12px;border-radius:3px"></span>' +
          '<span style="flex:1">' + esc(c.nome) + '</span>' +
          '<button class="icon-btn sm" data-up="' + id + '"' + (i === 0 ? " disabled" : "") + ' title="Subir">▲</button>' +
          '<button class="icon-btn sm" data-down="' + id + '"' + (i === orderIds.length - 1 ? " disabled" : "") + ' title="Descer">▼</button>' +
          '</div>';
      }).join("");
      function chk(k, lbl) { return '<label class="row" style="align-items:center;gap:6px;margin-bottom:2px"><input type="checkbox" data-inc="' + k + '"' + (inc[k] ? " checked" : "") + ' style="flex:0 0 auto"><span class="mini" style="flex:1">' + lbl + '</span></label>'; }
      var fontOpts = FONTS.map(function (f) { return '<option value="' + f[0] + '"' + (cfg.figFont === f[0] ? " selected" : "") + '>' + f[1] + '</option>'; }).join("");
      host.innerHTML =
        '<div class="mini" style="color:var(--txt-dim);margin-bottom:4px">Tipos na figura (ordem e seleção)</div>' + list +
        '<div class="mini" style="color:var(--txt-dim);margin:8px 0 3px">Informações na figura</div>' +
        chk("title", "Título do tipo") + chk("pct", "% de duração") + chk("uses", "Usos isolados") + chk("before", "Antecedentes (antes)") + chk("after", "Sucessores (depois)") +
        '<div class="field" style="margin-top:8px"><label>Fonte</label><select data-font>' + fontOpts + '</select></div>' +
        '<div style="display:flex;gap:6px">' +
          '<div class="field" style="flex:1"><label>Margem (px)</label><input type="number" data-k="figMargin" value="' + cfg.figMargin + '" min="0" max="80" step="1"></div>' +
          '<div class="field" style="flex:1"><label>Colunas (0=auto)</label><input type="number" data-k="figCols" value="' + cfg.figCols + '" min="0" max="8" step="1"></div>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<div class="field" style="flex:1"><label>Tamanho (%)</label><input type="number" data-scale value="' + Math.round(cfg.figScale * 100) + '" min="20" max="400" step="10"></div>' +
          '<div class="field" style="flex:1"><label>DPI (PNG/JPG)</label><input type="number" data-k="figDpi" value="' + cfg.figDpi + '" min="72" max="600" step="1"></div>' +
        '</div>' +
        '<div class="mini" style="color:var(--txt-dim);margin:10px 0 3px">Prévia</div>' +
        '<div id="mdim-figprev" class="px-scroll" style="max-height:440px;overflow:auto"></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
          '<button class="btn" data-fig="svg">Figura SVG</button>' +
          '<button class="btn secondary" data-fig="png">Figura PNG</button>' +
          '<button class="btn secondary" data-fig="jpg">Figura JPG</button>' +
        '</div>' +
        '<div class="field" style="margin-top:10px"><label>Duração por estado no GIF (s)</label><input type="number" data-dur value="1.5" min="0.2" max="10" step="0.1"></div>' +
        '<button class="btn secondary wide" data-go>GIF animado</button>' +
        '<p class="hint" style="margin-top:6px">Marque só um tipo para exportá-lo sozinho. SVG é vetorial (nitidez total; DPI não se aplica). A estatística entra na figura, não no GIF.</p>';
      // seleção → cfg.figSel
      Array.prototype.forEach.call(host.querySelectorAll("[data-cat]"), function (cb) {
        cb.addEventListener("change", function () {
          self.cfg.figSel = Array.prototype.slice.call(host.querySelectorAll("[data-cat]:checked")).map(function (x) { return x.dataset.cat; });
          self._saveCfg(); self._renderFigPreview();
        });
      });
      // reordenar
      function move(id, dir) { var o = self._figOrderIds(), i = o.indexOf(id), j = i + dir; if (j < 0 || j >= o.length) return; var t = o[i]; o[i] = o[j]; o[j] = t; self.cfg.figOrder = o; self._saveCfg(); self.renderGif(); }
      Array.prototype.forEach.call(host.querySelectorAll("[data-up]"), function (b) { b.addEventListener("click", function () { move(b.dataset.up, -1); }); });
      Array.prototype.forEach.call(host.querySelectorAll("[data-down]"), function (b) { b.addEventListener("click", function () { move(b.dataset.down, 1); }); });
      // infos
      Array.prototype.forEach.call(host.querySelectorAll("[data-inc]"), function (cb) {
        cb.addEventListener("change", function () { self.cfg.figInclude[cb.dataset.inc] = cb.checked; self._saveCfg(); self._renderFigPreview(); });
      });
      // fonte
      host.querySelector("[data-font]").addEventListener("change", function () { self.cfg.figFont = this.value; self._saveCfg(); self._renderFigPreview(); });
      // números diretos
      Array.prototype.forEach.call(host.querySelectorAll("[data-k]"), function (inp) {
        inp.addEventListener("change", function () { self.cfg[inp.dataset.k] = +inp.value; self._saveCfg(); self._renderFigPreview(); });
      });
      host.querySelector("[data-scale]").addEventListener("change", function () { self.cfg.figScale = Math.max(0.2, (+this.value || 100) / 100); self._saveCfg(); });
      // exportar
      Array.prototype.forEach.call(host.querySelectorAll("[data-fig]"), function (btn) {
        btn.addEventListener("click", function () { self.exportStatesFigure(self._figCats(), btn.dataset.fig); });
      });
      host.querySelector("[data-go]").addEventListener("click", function () {
        self.exportGif(self._figCats(), +host.querySelector("[data-dur]").value || 1.5, self.cfg.figW, self.cfg.figH);
      });
      this._renderFigPreview();
    },
    // Prévia ao vivo da figura de estados (mesmo SVG do export, escalado à largura do painel).
    _renderFigPreview: function () {
      var host = document.getElementById("mdim-figprev"); if (!host) return;
      if (!this._radar) { host.innerHTML = '<div class="hint">A prévia aparece com o radar visível (saia do modo de codificação para ver).</div>'; return; }
      var cats = this._figCats ? this._figCats() : [];
      if (!cats.length) { host.innerHTML = '<div class="hint">Marque ao menos um tipo para pré-visualizar.</div>'; return; }
      var svg = this._buildStatesSvg(cats);
      svg.removeAttribute("width"); svg.removeAttribute("height");
      svg.style.cssText = "display:block;width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:6px";
      host.innerHTML = ""; host.appendChild(svg);
    },

    // Painel de aparência do radar (persistente). Qualquer mudança re-renderiza.
    renderAppearance: function (hostArg) {
      var self = this, host = hostArg || this.refs.appear, cfg = this.cfg; if (!host) return;
      if (!hostArg && this._figAppearHost && this._figAppearHost !== host && document.body.contains(this._figAppearHost)) this.renderAppearance(this._figAppearHost);   // preset aplicado → espelha no painel Figuras
      host.innerHTML =
        '<div class="subgroup-title" style="margin-top:0">Rótulos dos eixos</div>' +
        '<label class="row" style="margin-bottom:6px"><input type="checkbox" data-k="labelCurve"' + (cfg.labelCurve ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">Rótulo curvado (acompanha o círculo)</span></label>' +
        '<label class="row" style="margin-bottom:6px"><input type="checkbox" data-k="labelBold"' + (cfg.labelBold !== false ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">Rótulo em negrito</span></label>' +
        '<div class="field"><label>Tamanho do rótulo · <span data-v="labelSize">' + (cfg.labelSize || 11) + '</span></label><input type="range" data-k="labelSize" min="7" max="24" step="0.5" value="' + (cfg.labelSize || 11) + '"></div>' +
        '<div class="field"><label>Distância do rótulo · <span data-v="labelGap">' + (cfg.labelGap != null ? cfg.labelGap : 18) + '</span></label><input type="range" data-k="labelGap" min="2" max="60" step="1" value="' + (cfg.labelGap != null ? cfg.labelGap : 18) + '"></div>' +
        '<div class="subgroup-title">Radar</div>' +
        '<label class="row" style="margin-bottom:8px"><input type="checkbox" data-k="bw"' + (cfg.bw ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">Preto e branco</span></label>' +
        '<label class="row" style="margin-bottom:6px"><input type="checkbox" data-k="normalize"' + (cfg.normalize ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1" title="Ligado: cada eixo vai até a própria escala máxima. Desligado: o mesmo escore fica no mesmo raio em todos os eixos.">Normalizar escalas dos eixos</span></label>' +
        '<div class="field"><label>Centro do radar</label><select data-k="radarCenter" style="width:100%" title="Mínimo: o nível 1 fica no centro (distâncias proporcionais na escala 1–N; sem dado, o vértice sai do polígono). Zero: o centro é 0 e o nível 1 fica no primeiro anel.">' + [["min", "Mínimo da escala (1 no centro)"], ["zero", "Zero (1 no primeiro anel)"]].map(function (p) { return '<option value="' + p[0] + '"' + ((cfg.radarCenter || "min") === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></div>' +
        '<label class="row" style="margin-bottom:6px"><input type="checkbox" data-k="showPoints"' + (cfg.showPoints ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">Pontos de escore</span></label>' +
        '<label class="row" style="margin-bottom:6px"><input type="checkbox" data-k="showScaleNumbers"' + (cfg.showScaleNumbers ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">Números da escala (1–N)</span></label>' +
        '<div class="field"><label>Posição da escala (1–N)</label><select data-k="scalePos" style="width:100%">' + [["tip", "Na ponta do eixo (1–N sob o nome)"], ["inside", "Dentro do radar (valor em cada linha)"]].map(function (p) { return '<option value="' + p[0] + '"' + ((cfg.scalePos || "tip") === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>Valores das linhas (dentro do radar) em</label><select data-k="tickAxes" style="width:100%">' + [["auto", "Automático (1 eixo se as escalas são iguais)"], ["first", "Só no 1º eixo"], ["all", "Todos os eixos"]].map(function (p) { return '<option value="' + p[0] + '"' + ((cfg.tickAxes || "auto") === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>Ângulo dos valores (um por linha) · <span data-v="tickAngle">' + (cfg.tickAngle != null ? cfg.tickAngle : 90) + '</span>°</label><input type="range" data-k="tickAngle" min="0" max="359" step="1" value="' + (cfg.tickAngle != null ? cfg.tickAngle : 90) + '"></div>' +
        '<div class="field"><label>Deslocamento da linha (+ acima, − abaixo) · <span data-v="tickOffset">' + (+cfg.tickOffset || 0) + '</span> px</label><input type="range" data-k="tickOffset" min="-24" max="24" step="1" value="' + (+cfg.tickOffset || 0) + '"></div>' +
        '<label class="row" style="margin-bottom:6px"><input type="checkbox" data-k="tipTypeRange"' + (cfg.tipTypeRange !== false ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1" title="Com um tipo de prática ativo/em foco (e nas figuras de tipos), a ponta de cada eixo mostra o intervalo do tipo (ex.: 2–4) na cor do tipo; a escala 1–N passa para dentro do radar.">Ponta do eixo mostra o intervalo do tipo</span></label>' +
        '<div class="field"><label>Opacidade do preenchimento · <span data-v="polyOpacity">' + Math.round(cfg.polyOpacity * 100) + '%</span></label><input type="range" data-k="polyOpacity" min="0" max="1" step="0.02" value="' + cfg.polyOpacity + '"></div>' +
        '<div class="field"><label>Espessura do contorno · <span data-v="outlineWidth">' + cfg.outlineWidth + '</span></label><input type="range" data-k="outlineWidth" min="0" max="5" step="0.5" value="' + cfg.outlineWidth + '"></div>' +
        '<div class="row" style="margin-bottom:6px"><input type="color" data-k="outlineColor" value="' + cfg.outlineColor + '" style="flex:0 0 34px"><label class="mini" style="flex:1"><input type="checkbox" data-k="outlineCustom"' + (cfg.outlineCustom ? " checked" : "") + ' style="flex:0 0 auto"> cor própria do contorno</label></div>' +
        '<div class="row" style="margin-bottom:4px"><input type="color" data-k="bandColor" value="' + cfg.bandColor + '" style="flex:0 0 34px"><label class="mini" style="flex:1"><input type="checkbox" data-k="bandCustom"' + (cfg.bandCustom ? " checked" : "") + ' style="flex:0 0 auto"> cor própria da faixa (range)</label></div>' +
        '<div class="field"><label>Opacidade da faixa (range) · <span data-v="bandOpacity">' + Math.round(cfg.bandOpacity * 100) + '%</span></label><input type="range" data-k="bandOpacity" min="0.05" max="1" step="0.02" value="' + cfg.bandOpacity + '"></div>' +
        '<div class="field"><label>Grossura da faixa (range) · <span data-v="bandWidth">' + cfg.bandWidth + '</span></label><input type="range" data-k="bandWidth" min="1" max="20" step="0.5" value="' + cfg.bandWidth + '"></div>' +
        '<label class="row" style="margin-bottom:6px"><input type="checkbox" data-k="bandRound"' + (cfg.bandRound ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">Pontas arredondadas na faixa (range)</span></label>' +
        '<label class="row" style="margin:6px 0"><input type="checkbox" data-k="showRings"' + (cfg.showRings ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">Grade interna</span></label>' +
        '<div class="row" style="gap:8px;margin-bottom:6px">' +
          '<label class="mini" style="flex:1">grade interna<select data-k="gridStyle" style="width:100%">' + [["teia-prop", "teia proporcional"], ["teia-exata", "teia exata (corta no menor)"], ["teia-vanish", "teia convergente"], ["circulos", "círculos exatos"], ["marcas", "marcas por eixo"], ["nenhuma", "nenhuma"]].map(function (p) { return '<option value="' + p[0] + '"' + (cfg.gridStyle === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></label>' +
          '<label class="mini" style="flex:1">contorno externo<select data-k="outerContour" style="width:100%">' + [["poligono", "polígono"], ["exata", "polígono exato (segue a teia)"], ["circulo", "círculo"], ["nenhum", "nenhum"]].map(function (p) { return '<option value="' + p[0] + '"' + (cfg.outerContour === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("") + '</select></label>' +
        '</div>' +
        '<div class="row" style="margin-bottom:6px"><input type="color" data-k="ringColor" value="' + cfg.ringColor + '" style="flex:0 0 34px"><label class="mini" style="flex:1">grade · largura <input type="range" data-k="ringWidth" min="0.3" max="3" step="0.1" value="' + cfg.ringWidth + '" style="width:100%"></label></div>' +
        '<div class="row" style="margin-bottom:6px"><input type="color" data-k="outerColor" value="' + cfg.outerColor + '" style="flex:0 0 34px"><label class="mini" style="flex:1">contorno · largura <input type="range" data-k="outerWidth" min="0.5" max="5" step="0.1" value="' + cfg.outerWidth + '" style="width:100%"></label></div>' +
        '<div class="row" style="margin-bottom:6px"><input type="color" data-k="axisColor" value="' + cfg.axisColor + '" style="flex:0 0 34px"><label class="mini" style="flex:1">eixos · largura <input type="range" data-k="axisWidth" min="0.3" max="3" step="0.1" value="' + cfg.axisWidth + '" style="width:100%"></label></div>';
      function apply(k, val) {
        cfg[k] = val; self._saveCfg(); var v = host.querySelector('[data-v="' + k + '"]'); if (v) v.textContent = (k === "polyOpacity" || k === "bandOpacity") ? Math.round(val * 100) + "%" : val;
        self.render();
        if (hostArg && hostArg !== self.refs.appear && self.refs.appear) self.renderAppearance(self.refs.appear);   // cópia da figura → atualiza a canônica
      }
      host.querySelectorAll("[data-k]").forEach(function (el) {
        var k = el.dataset.k, tag = el.tagName.toLowerCase();
        if (el.type === "checkbox") el.addEventListener("change", function () { apply(k, el.checked); });
        else if (el.type === "color") el.addEventListener("input", function () { apply(k, el.value); });
        else if (tag === "select") el.addEventListener("change", function () { apply(k, el.value); });
        else el.addEventListener("input", function () { apply(k, parseFloat(el.value)); });
      });
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);
      // faixa em anel + nível médio por tipo (mesmos controles do painel Figuras)
      var tsub = document.createElement("div"); tsub.className = "subgroup"; tsub.style.marginTop = "8px";
      tsub.innerHTML = '<div class="subgroup-title">Faixa do tipo e nível médio</div>' + this._radarTypeCtlsHtml();
      host.appendChild(tsub); this._wireRadarTypeCtls(tsub);
    },

    // Painel de exportação (radar e linhas, PNG/JPG/SVG, com DPI e fundo branco).
    renderExport: function () {
      var self = this, host = this.refs.exportPanel, cfg = this.cfg; if (!host) return;
      host.innerHTML =
        '<label class="row" style="margin-bottom:8px"><input type="checkbox" data-lk' + (cfg.linkExport ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1" title="Ligado: o radar na tela usa exatamente estas dimensões (o que você vê é o que exporta). Desligado: a tela mostra num tamanho confortável e só a exportação usa estas dimensões.">Vincular visualização e exportação</span></label>' +
        '<div class="row" style="gap:8px">' +
          '<div class="field" style="flex:1"><label>Largura (px)</label><input type="number" data-w value="' + cfg.figW + '" min="100" max="4000" step="10"></div>' +
          '<div class="field" style="flex:1"><label>Altura (px)</label><input type="number" data-h value="' + cfg.figH + '" min="100" max="4000" step="10"></div>' +
        '</div>' +
        '<div class="mini" style="margin:2px 0 3px;color:var(--txt-dim)">Radar</div>' +
        '<div class="row" data-grp="radar"><button class="btn secondary" data-k="png">PNG</button><button class="btn secondary" data-k="jpg">JPG</button><button class="btn secondary" data-k="svg">SVG</button></div>' +
        '<div class="mini" style="margin:8px 0 3px;color:var(--txt-dim)">Linhas em degraus</div>' +
        '<div class="row" data-grp="linhas"><button class="btn secondary" data-k="png">PNG</button><button class="btn secondary" data-k="jpg">JPG</button><button class="btn secondary" data-k="svg">SVG</button></div>';
      function W() { return +host.querySelector("[data-w]").value || 440; }
      function H() { return +host.querySelector("[data-h]").value || 340; }
      host.querySelector("[data-lk]").addEventListener("change", function () { cfg.linkExport = this.checked; self._saveCfg(); self.render(); });
      host.querySelector("[data-w]").addEventListener("input", function () { cfg.figW = W(); self._saveCfg(); if (cfg.linkExport) self.render(); });
      host.querySelector("[data-h]").addEventListener("input", function () { cfg.figH = H(); self._saveCfg(); if (cfg.linkExport) self.render(); });
      host.querySelectorAll("[data-grp] button").forEach(function (b) {
        var grp = b.parentNode.dataset.grp, kind = b.dataset.k;
        b.addEventListener("click", function () { if (grp === "radar") self._exportRadar(kind, W(), H()); else self._exportLines(kind, W(), H()); });
      });
    },

    // Codificador por switch da ④: seletor de dimensão ativa + botões de escore
    // que inserem uma troca no tempo da agulha. Mesma fonte única da aba ①.
    renderCoder: function () {
      var self = this, dims = this.dims(), sel = this.refs.activedim, host = this.refs.coder;
      if (sel) {
        var cur = this._activeDimId;
        sel.innerHTML = dims.map(function (d) { return '<option value="' + d.id + '">' + P.escapeHtml(d.name) + '</option>'; }).join("");
        if (!dims.some(function (d) { return d.id === cur; })) this._activeDimId = dims[0] ? dims[0].id : null;
        if (this._activeDimId) sel.value = this._activeDimId;
      }
      if (!host) return;
      var t = this.activeDim();
      if (!t) { host.innerHTML = '<div class="hint">Crie uma dimensão (botão abaixo) para codificar.</div>'; return; }
      host.innerHTML = "";
      var chips = document.createElement("div"); chips.className = "legend";
      t.vocab.forEach(function (v, i) {
        var cor = P.Segmenter.dimColor(t, v.code);
        var b = document.createElement("button");
        b.className = "btn sm"; b.style.cssText = "flex:0 0 auto;background:" + cor + "22;border-color:" + cor + "66";
        var keyHint = i < 9 ? String(i + 1) : (v.key ? String(v.key).toUpperCase() : "");
        b.innerHTML = '<b>' + P.escapeHtml(v.code) + '</b>' + (v.label ? ' <span class="mini">' + P.escapeHtml(v.label) + '</span>' : '') + (keyHint ? ' <span class="mini" style="opacity:.5">' + P.escapeHtml(keyHint) + '</span>' : '');
        b.title = "Inserir troca para o escore " + v.code + (v.label ? " (" + v.label + ")" : "") + " no tempo da agulha" + (keyHint ? " (tecla " + keyHint + ")" : " (defina uma tecla na configuração)");
        b.addEventListener("click", function () { P.Segmenter.dimSwitchAt(t, P.Mdim._codeT(), v.code); });
        chips.appendChild(b);
      });
      host.appendChild(chips);
    },

    // Painel de dimensões: espelha o painel «Camadas» da aba Segmentar - lista numerada,
    // clique no nome codifica a dimensão (ativa), engrenagem configura, × remove, olho oculta os índices.
    renderSidebar: function () {
      var host = this.refs.dimlist; if (!host) return;
      var dims = this.dims();
      host.innerHTML = "";
      if (!dims.length) {
        host.innerHTML = '<div class="hint">Nenhuma dimensão ainda. Crie uma dimensão, importe um modelo (.praxmod) ou use «Carregar exemplo».</div>';
        return;
      }
      var self = this;
      if (!dims.some(function (d) { return d.id === self._activeDimId; })) self._activeDimId = dims[0].id;
      dims.forEach(function (t, i) {
        var active = t.id === self._activeDimId;
        // Duas linhas: nome sozinho em cima, controles embaixo (a barra é estreita e cortava o nome).
        var row = document.createElement("div");
        row.style.cssText = "margin-bottom:6px;padding:6px 8px;border-radius:8px;border:1px solid " + (active ? "var(--accent)" : "var(--line)") + ";background:var(--panel-2)";
        var cor = t.cor || "#8899aa", n = P.Segmenter.escalaMaxOf(t);
        var hasIdx = t.indices && t.indices.length, shown = t.showIndices !== false, nMarks = (t.marks || []).length;
        row.innerHTML =
          '<div class="row" style="align-items:center;gap:6px">' +
            '<span class="mini" style="flex:0 0 14px;color:var(--txt-dim)">' + (i + 1) + '</span>' +
            '<span class="swatch" style="background:' + cor + ';flex:0 0 12px;height:12px;border-radius:3px"></span>' +
            '<b class="mdimdim-name" style="flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Codificar «' + P.escapeHtml(t.name) + '»">' + P.escapeHtml(t.name) + '</b>' +
          '</div>' +
          '<div class="row" style="align-items:center;gap:6px;margin-top:5px">' +
            '<span class="mini" style="flex:0 0 auto;color:var(--txt-dim)">escala 1–' + n + (hasIdx ? ' · ' + t.indices.length + ' índ.' : '') + '</span>' +
            '<span style="flex:1"></span>' +
            (hasIdx ? '<button class="btn sm ghost" data-idxvis title="' + (shown ? "Ocultar" : "Mostrar") + ' os ' + nMarks + ' índice(s) desta dimensão" style="flex:0 0 auto;opacity:' + (shown ? "1" : ".5") + '">' + (shown ? P.ICON.eye : P.ICON.eyeOff) + '</button>' : '') +
            '<button class="btn sm ghost" data-edit title="Configurar dimensão (escala, escores, índices)" style="flex:0 0 auto">' + P.ICON.edit + '</button>' +
            '<button class="btn sm ghost" data-del title="Remover dimensão" style="flex:0 0 auto">' + P.ICON.close + '</button>' +
          '</div>';
        row.querySelector(".mdimdim-name").addEventListener("click", function () { self._activeDimId = t.id; self._sel = null; self._selMark = null; self.refresh(); });
        if (hasIdx) row.querySelector("[data-idxvis]").addEventListener("click", function () {
          t.showIndices = !(t.showIndices !== false);   // alterna (padrão visível)
          P.Segmenter.renderTimeline();
          if (P.Segmenter.commit) P.Segmenter.commit();
          self.refresh();
        });
        row.querySelector("[data-edit]").addEventListener("click", function () { P.Segmenter.editTier(t.id, "mdim-tier-editor", "mdim-tier-editor-wrap"); });
        row.querySelector("[data-del]").addEventListener("click", function () { if (confirm("Remover a dimensão «" + t.name + "»? As trocas e índices dela serão apagados.")) { P.Segmenter.removeTier(t.id); self.refresh(); } });
        host.appendChild(row);
      });
    },

    // --- Modelo (dimensões + índices + tipos) reutilizável entre projetos (.praxmod) ---------
    // Um modelo é um TEMPLATE: guarda as definições (nome, escala, cor, descrição por escore,
    // índices) e os tipos de prática que as combinam - NÃO os dados codificados (trocas/ocorrências).
    exportModel: function () {
      var dims = this.dims();
      if (!dims.length) { alert("Nenhuma dimensão para salvar como modelo. Crie ou importe dimensões primeiro."); return; }
      var idToLocal = {}; dims.forEach(function (t, i) { idToLocal[t.id] = "d" + i; });
      var model = {
        format: "praxis-model", version: 1, app: "Praxis", savedAt: new Date().toISOString(),
        dimensions: dims.map(function (t) {
          return { localId: idToLocal[t.id], name: t.name, escalaMax: P.Segmenter.escalaMaxOf(t), cor: t.cor || "#8899aa",
            vocab: (t.vocab || []).map(function (v) { var o = { code: String(v.code), label: v.label || "" }; if (v.key) o.key = v.key; return o; }),   // key = tecla personalizada de escores 10+
            indices: (t.indices || []).map(function (x) { return { code: String(x.code), desc: x.desc || "", key: x.key || "" }; }),
            showIndices: t.showIndices !== false };
        }),
        categories: (P.Segmenter.categories || []).map(function (c) {
          var iv = {}; Object.keys(c.intervalos || {}).forEach(function (k) { if (idToLocal[k]) iv[idToLocal[k]] = (c.intervalos[k] || []).slice(); });
          return { nome: c.nome, cor: c.cor, pattern: c.pattern, dash: c.dash, intervalos: iv };
        }).filter(function (c) { return Object.keys(c.intervalos).length; })   // só tipos que restringem dimensões exportadas
      };
      P.download("modelo_praxis.praxmod", JSON.stringify(model, null, 2), "application/json");
      if (P.Segmenter.setStatus) P.Segmenter.setStatus("Modelo salvo: " + model.dimensions.length + " dimensão(ões)" + (model.categories.length ? " + " + model.categories.length + " tipo(s)" : "") + " (arquivo .praxmod).", "ok");
    },
    importModel: function (file) {
      var self = this, reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(reader.result);
          if (!obj || obj.format !== "praxis-model" || !Array.isArray(obj.dimensions)) { alert("Arquivo de modelo inválido. Esperado um .praxmod exportado pelo Praxis."); return; }
          var localToNew = {}, added = 0, base = "mod" + Date.now().toString(36) + "_";
          obj.dimensions.forEach(function (d, i) {
            var N = Math.max(2, Math.min(30, parseInt(d.escalaMax, 10) || (d.vocab ? d.vocab.length : 5)));
            var vocab = (d.vocab && d.vocab.length) ? d.vocab.map(function (v) { var o = { code: String(v.code), label: v.label || "" }; if (v.key) o.key = String(v.key).toLowerCase(); return o; }) : [];
            if (!vocab.length) { for (var k = 1; k <= N; k++) vocab.push({ code: String(k), label: "" }); }
            var id = base + i;
            P.Segmenter.tiers.push({ id: id, name: d.name || ("Dimensão " + (P.Segmenter.tiers.length + 1)), kind: "dimensao",
              escalaMax: N, cor: d.cor || P.PALETTE_COLOR[P.Segmenter.tiers.length % P.PALETTE_COLOR.length],
              vocab: vocab, activeCat: vocab[0] ? vocab[0].code : "1",
              indices: (d.indices || []).map(function (x) { return { code: String(x.code), desc: x.desc || "", key: (x.key || "").toString().toLowerCase() }; }),
              showIndices: d.showIndices !== false, segments: [] });
            localToNew[d.localId != null ? d.localId : ("d" + i)] = id; added++;
          });
          (obj.categories || []).forEach(function (c) {
            var iv = {}; Object.keys(c.intervalos || {}).forEach(function (k) { if (localToNew[k]) iv[localToNew[k]] = (c.intervalos[k] || []).slice(); });
            if (!Object.keys(iv).length) return;
            P.Segmenter.categories = P.Segmenter.categories || [];
            P.Segmenter.categories.push({ id: self._newCatId(), nome: c.nome || "Tipo", cor: c.cor || "#8899aa", pattern: c.pattern || "solid", dash: c.dash || "", intervalos: iv });
          });
          if (added && obj.dimensions[0]) self._activeDimId = localToNew[obj.dimensions[0].localId != null ? obj.dimensions[0].localId : "d0"] || self._activeDimId;
          if (P.Segmenter.renderTiers) P.Segmenter.renderTiers();
          if (P.Segmenter.renderPicker) P.Segmenter.renderPicker();
          if (P.Segmenter.renderTimeline) P.Segmenter.renderTimeline();
          if (P.Segmenter.updateActions) P.Segmenter.updateActions();
          if (P.Segmenter.commit) P.Segmenter.commit();
          self.refresh();
          var msg = "Modelo importado: " + added + " dimensão(ões)" + ((obj.categories || []).length ? " + tipos" : "") + ".";
          if (P.Segmenter.setStatus) P.Segmenter.setStatus(msg, "ok");
          if (!added) alert("Nenhuma dimensão no modelo.");
        } catch (e) { alert("Falha ao importar modelo: " + (e && e.message ? e.message : e)); }
      };
      reader.readAsText(file);
    },
    // Aplica SÓ os tipos de prática de um modelo às dimensões ATUAIS (casadas pelo nome), sem criar dimensões
    // nem tocar na codificação. Útil para propagar tipos refinados entre projetos (cada um com sua codificação).
    updateCategoriesFromModel: function (file) {
      var self = this, reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(reader.result);
          if (!obj || obj.format !== "praxis-model" || !Array.isArray(obj.dimensions)) { alert("Arquivo de modelo inválido (.praxmod esperado)."); return; }
          var dims = self.dims();
          if (!dims.length) { alert("Este projeto ainda não tem dimensões. Use «Importar modelo» primeiro para criar as dimensões, depois codifique."); return; }
          function norm(s) { return String(s || "").trim().toLowerCase(); }
          var byName = {}; dims.forEach(function (d) { byName[norm(d.name)] = d.id; });
          // equivalências já definidas nas Figuras (nome antigo no projeto → nome novo no modelo)
          var al = (self._matrixLoad().dimAlias) || {};
          dims.forEach(function (d) { if (al[d.name] && !byName[norm(al[d.name])]) byName[norm(al[d.name])] = d.id; });
          var localToExisting = {}, matched = [], unmatched = [], renamed = "";
          (obj.dimensions || []).forEach(function (d, i) {
            var lid = d.localId != null ? d.localId : ("d" + i), eid = byName[norm(d.name)];
            if (eid) { localToExisting[lid] = eid; matched.push(d.name); } else unmatched.push({ lid: lid, name: d.name });
          });
          // dimensão RENOMEADA (ex.: Reatividade → Proatividade): sobrou exatamente 1 de cada lado → pareia
          var usedIds = {}; Object.keys(localToExisting).forEach(function (k) { usedIds[localToExisting[k]] = 1; });
          var freeDims = dims.filter(function (d) { return !usedIds[d.id]; });
          if (unmatched.length === 1 && freeDims.length === 1) {
            localToExisting[unmatched[0].lid] = freeDims[0].id; matched.push(unmatched[0].name);
            renamed = "\n\nDimensão pareada por eliminação: «" + freeDims[0].name + "» (projeto) = «" + unmatched[0].name + "» (modelo).";
            unmatched = [];
          }
          unmatched = unmatched.map(function (u) { return u.name; });
          var newCats = (obj.categories || []).map(function (c) {
            var iv = {}; Object.keys(c.intervalos || {}).forEach(function (k) { if (localToExisting[k]) iv[localToExisting[k]] = (c.intervalos[k] || []).slice(); });
            return { nome: c.nome || "Tipo", cor: c.cor || "#8899aa", pattern: c.pattern || "solid", dash: c.dash || "", intervalos: iv };
          }).filter(function (c) { return Object.keys(c.intervalos).length; });
          if (!newCats.length) { alert("Nenhum tipo do modelo pôde ser associado às dimensões atuais.\n\nConfira se os NOMES das dimensões batem entre o modelo e este projeto." + (unmatched.length ? "\nSem correspondência: " + unmatched.join(", ") : "")); return; }
          var cur = (P.Segmenter.categories || []).length;
          var warn = unmatched.length ? "\n\nDimensões do modelo SEM correspondência (ignoradas): " + unmatched.join(", ") + "." : "";
          var replace = confirm("Aplicar " + newCats.length + " tipo(s) do modelo às " + matched.length + " dimensão(ões) casada(s) por nome? A codificação (segmentos e marcadores) NÃO é alterada." + warn + renamed + "\n\nOK = SUBSTITUIR os " + cur + " tipo(s) atuais.\nCancelar = ADICIONAR aos atuais.");
          P.Segmenter.categories = P.Segmenter.categories || [];
          if (replace) P.Segmenter.categories = [];
          newCats.forEach(function (c) { P.Segmenter.categories.push({ id: self._newCatId(), nome: c.nome, cor: c.cor, pattern: c.pattern, dash: c.dash, intervalos: c.intervalos }); });
          if (P.Segmenter.commit) P.Segmenter.commit();
          self.refresh();
          if (P.Segmenter.setStatus) P.Segmenter.setStatus((replace ? "Tipos substituídos" : "Tipos adicionados") + " pelo modelo: " + newCats.length + " (codificação mantida).", "ok");
        } catch (e) { alert("Falha ao ler o modelo: " + (e && e.message ? e.message : e)); }
      };
      reader.readAsText(file);
    },

    // Contêiner rolável em torno do canvas do multidim (para preservar a posição de rolagem entre renders).
    _scrollHost: function () {
      var el = this.refs.canvas; if (!el) return null;
      var p = el.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        var s = window.getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
        p = p.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    },
    render: function () {
      var host = this.refs.canvas; if (!host) return;
      // preserva a rolagem: zoom (Ctrl+scroll), pan (Shift+scroll) e o acoplador re-renderizam o canvas
      // inteiro; sem isso, esvaziar/reconstruir o host zera o scrollTop e a vista pula pro topo.
      var _sp = this._scrollHost(), _st = _sp ? _sp.scrollTop : 0;
      var dims = this.dims();
      host.innerHTML = "";
      // MODO MATRIZ: figura de várias sessões (.praxis) numa grade; não depende das dimensões do projeto atual
      if (this._viewMode === "matrix") { this._renderMatrixMode(host); if (_sp) _sp.scrollTop = _st; return; }
      if (!dims.length) {
        host.innerHTML = '<div class="empty">Marque camadas como «Dimensão» na aba Segmentar e clique em «Gerar linhas». Ou use «Carregar exemplo» na barra lateral para ver um caso de teste (fixture de desenvolvimento).</div>';
        if (_sp) _sp.scrollTop = _st;
        return;
      }
      var maxT = this.maxTime();
      var self = this;
      var _md = P.Segmenter.media; if (_md && isFinite(_md.playbackRate) && _md.playbackRate > 0) this._speed = _md.playbackRate;   // botões de velocidade refletem o rate real da mídia (inclui o ajustado no Segmentar)
      this._svgs = [];
      this._minis = [];
      // MODO DE CODIFICAÇÃO: só o eixo ativo (grande + contornado, com escores/índices) no topo, e uma lista clicável
      // das dimensões abaixo. Radar/estatísticas/outros eixos ficam de fora (foco em codificar vendo os módulos).
      if (this._formatMode) {
        var hiddenR = document.createElement("div"); hiddenR.style.display = "none"; host.appendChild(hiddenR);
        this.renderRadar(hiddenR, dims);   // radar offscreen: _stateSvg/_buildStatesSvg reusam a geometria do radar vivo
        this._renderFormatMode(host, dims, maxT);
        if (_sp) _sp.scrollTop = _st; return;
      }
      if (this._codingMode) { this._radar = null; this._renderCodingMode(host, dims, maxT); this._updateNeedle(); if (_sp) _sp.scrollTop = _st; return; }
      // radar integrador (no topo) + transporte da ④
      this.renderRadar(host, dims);
      // camadas comparativas lado a lado (small multiples), quando no modo "side"
      if (this._mode === "side" && this._compares.length) this._renderSide(host);
      // linhas em degraus por dimensão (embaixo, mesma agulha)
      dims.forEach(function (t) {
        var card = document.createElement("div");
        card.className = "card"; card.style.cssText = "margin-bottom:14px;padding:10px 12px";
        var head = document.createElement("div");
        head.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px";
        head.innerHTML = '<span class="swatch" style="background:' + (t.cor || "#8899aa") + ';flex:0 0 12px;height:12px;border-radius:3px"></span>' +
          '<b>' + P.escapeHtml(t.name) + '</b>' +
          '<span class="mini" style="color:var(--txt-dim)">escala 1–' + P.Segmenter.escalaMaxOf(t) + '</span>' +
          '<span class="mini" style="margin-left:auto;color:var(--txt-dim);opacity:.7">' + (P.modKey || "Ctrl") + '+scroll: zoom · Shift+scroll: deslocar · 2 cliques: reset</span>';
        head.insertBefore(self._followBtn(), head.lastElementChild);
        card.appendChild(head);
        var wrap = document.createElement("div");
        card.appendChild(wrap);
        host.appendChild(card);
        var svg = self._stepPlot(t, maxT, Math.max(320, wrap.clientWidth || host.clientWidth - 24));
        wrap.appendChild(svg);
        self._svgs.push(svg);
      });
      // estatística por tipo de prática (card no fim)
      var statCard = document.createElement("div");
      statCard.className = "card"; statCard.style.cssText = "padding:14px";
      host.appendChild(statCard);
      this.renderStats(statCard);
      this._updateNeedle();
      this._updateRadar();
      this._syncTransportUI();
      if (_sp) _sp.scrollTop = _st;
    },

    _cycleActiveDim: function (dir) {
      var dims = this.dims(); if (!dims.length) return;
      var i = 0; for (var k = 0; k < dims.length; k++) if (dims[k].id === this._activeDimId) { i = k; break; }
      this._activeDimId = dims[(i + dir + dims.length) % dims.length].id; this._sel = null; this._selMark = null;
      this.renderCoder(); this.render();
    },
    // Chips de escore (clicáveis, inserem troca) + legenda de índices (referência) da dimensão ativa.
    _buildInlineCoder: function (t) {
      var wrap = document.createElement("div"); wrap.style.cssText = "margin-bottom:8px";
      var chips = document.createElement("div"); chips.className = "legend";
      t.vocab.forEach(function (v, i) {
        var cor = P.Segmenter.dimColor(t, v.code);
        var b = document.createElement("button"); b.className = "btn sm"; b.style.cssText = "flex:0 0 auto;background:" + cor + "22;border-color:" + cor + "66";
        var keyHint = i < 9 ? String(i + 1) : (v.key ? String(v.key).toUpperCase() : "");
        b.innerHTML = '<b>' + P.escapeHtml(v.code) + '</b>' + (v.label ? ' <span class="mini">' + P.escapeHtml(v.label) + '</span>' : '') + (keyHint ? ' <span class="mini" style="opacity:.5">' + P.escapeHtml(keyHint) + '</span>' : '');
        b.addEventListener("click", function () { P.Segmenter.dimSwitchAt(t, P.Mdim._codeT(), v.code); });
        chips.appendChild(b);
      });
      wrap.appendChild(chips);
      if (t.indices && t.indices.length) {
        var ih = document.createElement("div"); ih.className = "legend"; ih.style.marginTop = "6px";
        var lab = document.createElement("span"); lab.className = "mini"; lab.style.cssText = "align-self:center;color:var(--txt-dim);margin-right:4px"; lab.textContent = "Índices:"; ih.appendChild(lab);
        t.indices.forEach(function (ix) {
          var chip = document.createElement("span"); chip.className = "pill"; chip.title = (ix.code || "") + (ix.desc ? " - " + ix.desc : "");
          chip.innerHTML = (ix.key ? '<b style="font-family:ui-monospace,monospace;text-transform:uppercase">' + P.escapeHtml(ix.key) + '</b> ' : '') + '<span class="mini">' + P.escapeHtml(ix.code) + '</span>';
          ih.appendChild(chip);
        });
        wrap.appendChild(ih);
      }
      return wrap;
    },
    // Card (FORA do realce) com os índices da dimensão: código + tecla + DESCRIÇÃO. Fica abaixo do eixo em foco.
    _buildIndexDescriptions: function (t) {
      if (!t.indices || !t.indices.length) return null;
      var box = document.createElement("div"); box.className = "card"; box.style.cssText = "margin-bottom:14px;padding:10px 12px";
      var h = document.createElement("div"); h.className = "mini"; h.style.cssText = "color:var(--txt-dim);margin-bottom:6px"; h.textContent = "Índices desta dimensão"; box.appendChild(h);
      t.indices.forEach(function (ix) {
        var row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;align-items:baseline;margin-bottom:5px";
        row.innerHTML =
          (ix.key ? '<b style="flex:0 0 auto;font-family:ui-monospace,monospace;text-transform:uppercase;background:var(--panel-2);border:1px solid var(--line);border-radius:4px;padding:1px 6px;font-size:11px">' + P.escapeHtml(ix.key) + '</b>'
                  : '<span class="mini" style="flex:0 0 auto;opacity:.5">sem tecla</span>') +
          '<b style="flex:0 0 auto">' + P.escapeHtml(ix.code) + '</b>' +
          '<span style="flex:1;min-width:0;color:var(--txt-dim)">' + P.escapeHtml(ix.desc || "") + '</span>';
        box.appendChild(row);
      });
      return box;
    },
    _renderCodingMode: function (host, dims, maxT) {
      var self = this, t = this.activeDim() || dims[0]; if (!t) return;
      this._activeDimId = t.id;
      // eixo ativo: card contornado, escores/índices inline, gráfico grande
      var card = document.createElement("div"); card.className = "card";
      card.style.cssText = "margin-bottom:14px;padding:10px 12px;border:2px solid var(--accent);box-shadow:0 0 0 3px var(--accent-soft, rgba(79,157,245,.15))";
      var head = document.createElement("div"); head.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap";
      head.innerHTML = '<span class="swatch" style="background:' + (t.cor || "#8899aa") + ';flex:0 0 12px;height:12px;border-radius:3px"></span>' +
        '<b style="font-size:14px">' + P.escapeHtml(t.name) + '</b>' +
        '<span class="mini" style="color:var(--txt-dim)">escala 1–' + P.Segmenter.escalaMaxOf(t) + '</span>' +
        '<span class="mini" style="margin-left:auto;color:var(--txt-dim);opacity:.7">↑/↓ troca o eixo · ' + (P.modKey || "Ctrl") + '+scroll: zoom</span>';
      head.insertBefore(this._followBtn(), head.lastElementChild);
      card.appendChild(head);
      card.appendChild(this._buildInlineCoder(t));
      var wrap = document.createElement("div"); card.appendChild(wrap);
      host.appendChild(card);
      var svg = this._stepPlot(t, maxT, Math.max(320, wrap.clientWidth || host.clientWidth - 28), { rowPx: 34 });
      wrap.appendChild(svg); this._svgs.push(svg);
      var idesc = this._buildIndexDescriptions(t); if (idesc) host.appendChild(idesc);   // descrições dos índices FORA do realce, abaixo do eixo
      // lista clicável das dimensões (troca a ativa)
      var listCard = document.createElement("div"); listCard.className = "card"; listCard.style.cssText = "padding:8px 10px";
      var lh = document.createElement("div"); lh.className = "mini"; lh.style.cssText = "color:var(--txt-dim);margin-bottom:6px"; lh.textContent = "Dimensões (clique para tornar ativa · ↑/↓)"; listCard.appendChild(lh);
      dims.forEach(function (d, i) {
        var active = d.id === t.id;
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer;margin-bottom:2px;" + (active ? "background:var(--accent-soft, rgba(79,157,245,.15));outline:1px solid var(--accent)" : "");
        row.innerHTML = '<span class="mini" style="flex:0 0 14px;color:var(--txt-dim)">' + (i + 1) + '</span>' +
          '<span class="swatch" style="background:' + (d.cor || "#8899aa") + ';flex:0 0 12px;height:12px;border-radius:3px"></span>' +
          '<b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + P.escapeHtml(d.name) + '</b>' +
          '<span class="mini" style="flex:0 0 auto;color:var(--txt-dim)">1–' + P.Segmenter.escalaMaxOf(d) + '</span>';
        row.addEventListener("click", function () { self._activeDimId = d.id; self._sel = null; self._selMark = null; self.renderCoder(); self.render(); });
        listCard.appendChild(row);
      });
      host.appendChild(listCard);
    },

    // Radar/spider integrando o escore corrente de cada dimensão no instante da
    // agulha. N eixos (uma dimensão cada), escala normalizada por escalaMax.
    renderRadar: function (host, dims) {
      var self = this;
      var card = document.createElement("div");
      card.className = "card"; card.style.cssText = "margin-bottom:14px;padding:10px 12px";

      // ---- barra de transporte (play/pause + velocidades + tempo) ----
      var bar = document.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap";
      var playBtn = document.createElement("button");
      playBtn.className = "btn secondary"; playBtn.title = "Reproduzir ou pausar (Espaço)"; playBtn.innerHTML = P.ICON.play;
      playBtn.addEventListener("click", function () { self.togglePlay(); });
      bar.appendChild(playBtn);
      var speedWrap = document.createElement("div"); speedWrap.className = "speedbtns";
      var speedBtns = [];
      this.SPEEDS.forEach(function (v) {
        var b = document.createElement("button");
        b.className = "speed-btn" + (v === self._speed ? " active" : ""); b.dataset.sp = v; b.textContent = v + "×";
        b.title = "Velocidade " + v + "×" + (v > self.MEDIA_MAX_RATE ? " (com mídia, o navegador limita a ~" + self.MEDIA_MAX_RATE + "×)" : "");
        b.addEventListener("click", function () { self.setSpeed(v); });
        speedWrap.appendChild(b); speedBtns.push(b);
      });
      bar.appendChild(speedWrap);
      var clock = document.createElement("span"); clock.className = "time";
      clock.innerHTML = '<b class="t-clock" id="mdim-tcur">0:00,0</b> / <span id="mdim-tdur">--:--</span>';
      bar.appendChild(clock);
      var spacer = document.createElement("div"); spacer.style.flex = "1"; bar.appendChild(spacer);
      var ptsLab = document.createElement("label"); ptsLab.className = "row"; ptsLab.style.cssText = "flex:0 0 auto;gap:4px";
      ptsLab.innerHTML = '<input type="checkbox"' + (this.cfg.showPoints ? " checked" : "") + ' style="flex:0 0 auto"> <span class="mini">Pontos de escore</span>';
      ptsLab.querySelector("input").addEventListener("change", function () { self.cfg.showPoints = this.checked; self._saveCfg(); self._updateRadar(); });
      bar.appendChild(ptsLab);
      card.appendChild(bar);

      // ---- geometria do radar ----
      var W = 440, H = 340, cx = 175, cy = 168, R = 118;
      var svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      // tamanho na tela: vinculado à exportação (figW×figH, WYSIWYG) ou confortável (responsivo)
      if (this.cfg.linkExport) svg.style.cssText = "display:block;margin:0 auto;width:" + this.cfg.figW + "px;height:" + this.cfg.figH + "px;max-width:100%";
      else svg.style.cssText = "display:block;margin:0 auto;width:100%;max-width:520px";
      var defs = document.createElementNS(SVGNS, "defs"); svg.appendChild(defs);
      var N = dims.length;
      function ang(i) { return -Math.PI / 2 + i * 2 * Math.PI / N; }
      function pt(i, frac) { var a = ang(i); return [cx + Math.cos(a) * R * frac, cy + Math.sin(a) * R * frac]; }
      function poly(fracs, i0) { return fracs.map(function (f, i) { var p = pt(i, f); return p[0] + "," + p[1]; }).join(" "); }
      function mk(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }

      var cfg = this.cfg;
      // escala global (máximo escalaMax entre a base e as camadas comparativas)
      var gmax = 1; dims.forEach(function (d) { gmax = Math.max(gmax, P.Segmenter.escalaMaxOf(d)); });
      this._compares.forEach(function (cl) { (cl.dims || []).forEach(function (d) { gmax = Math.max(gmax, P.Segmenter.escalaMaxOf(d)); }); });
      // fração do raio para um escore: normalizado (escala própria) ou por escala global
      // centro do radar = mínimo da escala (B=1, padrão: o 1 fica no centro) ou zero (B=0: o 1 fica no 1º anel)
      var B = this._rBase();
      function fracFor(escMax, sc) { if (sc == null) return null; var dd = (cfg.normalize ? escMax : gmax) - B; return dd > 0 ? (sc - B) / dd : 0; }
      var escs = dims.map(function (d) { return P.Segmenter.escalaMaxOf(d); });
      var uniform = escs.every(function (e) { return e === escs[0]; });
      // comprimento do eixo: normalizado → sempre cheio (R); não normalizado → proporcional à
      // escala do eixo (uma dimensão de escala menor fica com o eixo mais curto).
      function axisMaxFrac(esc) { return cfg.normalize ? 1 : (gmax - B > 0 ? (esc - B) / (gmax - B) : 1); }
      function tickFrac(esc, k) { return fracFor(esc, k); }
      function axisMaxFracOf(i) { return axisMaxFrac(P.Segmenter.escalaMaxOf(dims[i])); }
      // polígono da "teia" no nível f (0..1): cada vértice em f × (comprimento próprio do eixo)
      function webPoly(f, strong, col) { var pts = []; for (var i = 0; i < N; i++) { var p = pt(i, f * axisMaxFracOf(i)); pts.push(p[0] + "," + p[1]); } return mk("polygon", { points: pts.join(" "), fill: "none", stroke: col || cfg.ringColor, "stroke-width": strong ? cfg.outerWidth : cfg.ringWidth, "stroke-linejoin": "round" }); }
      // --- grade interna (variantes escolhíveis) ---
      // posFrac(i,k) = fração do raio onde o escore k cai no eixo i (não normalizado:
      // k/gmax, igual em todos os eixos → níveis inteiros concêntricos; normalizado: k/esc próprio).
      var minEsc = Math.min.apply(null, escs);
      function posFrac(i, k) { return fracFor(escs[i], k); }
      function vtx(i, f) { var p = pt(i, f); return p[0] + "," + p[1]; }
      function strokePath(coords, closed) { svg.appendChild(mk(closed ? "polygon" : "polyline", { points: coords.join(" "), fill: "none", stroke: cfg.ringColor, "stroke-width": cfg.ringWidth, "stroke-linejoin": "round", "stroke-linecap": "round" })); }
      if (cfg.showRings && cfg.gridStyle !== "nenhuma") {
        var gs = cfg.gridStyle, i, k, j, coords;
        if (gs === "marcas") {
          dims.forEach(function (d, di) {
            var esc = P.Segmenter.escalaMaxOf(d), a = ang(di), perp = a + Math.PI / 2, tl = 4.5;
            for (var kk = B + 1; kk <= esc; kk++) { var p = pt(di, posFrac(di, kk)), dx = Math.cos(perp) * tl, dy = Math.sin(perp) * tl; svg.appendChild(mk("line", { x1: p[0] - dx, y1: p[1] - dy, x2: p[0] + dx, y2: p[1] + dy, stroke: cfg.ringColor, "stroke-width": cfg.ringWidth })); }
          });
        } else if (gs === "circulos") {
          // círculos radiais EXATOS: cruzam cada nível inteiro (o nível B fica no centro)
          var lev = (cfg.normalize && uniform) ? escs[0] : gmax;
          for (k = B + 1; k <= lev; k++) { var rr = (k - B) / (lev - B) * R; svg.appendChild(mk("circle", { cx: cx, cy: cy, r: rr, fill: "none", stroke: cfg.ringColor, "stroke-width": cfg.ringWidth })); }
        } else if (gs === "teia-exata") {
          // linhas internas EXATAS: anel k liga só os eixos que alcançam o escore k (os menores são cortados)
          for (k = B + 1; k <= gmax; k++) { coords = []; for (i = 0; i < N; i++) if (escs[i] >= k) coords.push(vtx(i, posFrac(i, k))); if (coords.length >= 2) strokePath(coords, coords.length === N); }
        } else if (gs === "teia-vanish") {
          // convergente: anel k liga TODOS os eixos, mas quem não tem o escore k entra no seu MÁXIMO (converge na ponta)
          for (k = B + 1; k <= gmax; k++) { coords = []; for (i = 0; i < N; i++) coords.push(vtx(i, posFrac(i, Math.min(k, escs[i])))); strokePath(coords, true); }
        } else {
          // teia proporcional (padrão): nº de anéis = menor eixo; cada anel a j/minEsc do comprimento próprio de cada eixo
          for (j = 1; j <= minEsc - B; j++) { coords = []; for (i = 0; i < N; i++) coords.push(vtx(i, (j / (minEsc - B)) * axisMaxFrac(escs[i]))); strokePath(coords, true); }
        }
      }
      // --- contorno externo (moldura que dá "sensação de polígono") ---
      if (cfg.outerContour === "poligono") svg.appendChild(webPoly(1, true, self._bw(cfg.outerColor)));
      else if (cfg.outerContour === "circulo") svg.appendChild(mk("circle", { cx: cx, cy: cy, r: R, fill: "none", stroke: self._bw(cfg.outerColor), "stroke-width": cfg.outerWidth }));
      else if (cfg.outerContour === "exata") {
        // contorno que ACOMPANHA A TEIA EXATA: cada aresta liga dois eixos no nível do MENOR deles
        // (min das escalas), com um degrau radial no eixo mais alto - mesmo "vazado" da grade exata.
        var ecoords = [];
        for (i = 0; i < N; i++) {
          var prev = (i - 1 + N) % N, next = (i + 1) % N;
          ecoords.push(vtx(i, posFrac(i, Math.min(escs[i], escs[prev]))));   // chegada da aresta anterior
          ecoords.push(vtx(i, posFrac(i, Math.min(escs[i], escs[next]))));   // saída para a próxima aresta (degrau)
        }
        svg.appendChild(mk("polygon", { points: ecoords.join(" "), fill: "none", stroke: self._bw(cfg.outerColor), "stroke-width": cfg.outerWidth, "stroke-linejoin": "round" }));
      }
      // eixos + rótulos (nome da dimensão + faixa), cada eixo até o próprio comprimento
      var lfs = +cfg.labelSize || 11, lgap = (cfg.labelGap != null ? +cfg.labelGap : 18), lfw = cfg.labelBold !== false ? 600 : 400, sfs = Math.max(7, lfs * 0.82);
      // Arco (centro cx,cy; raio r) centrado no ângulo a, longo o bastante p/ o texto; na metade de BAIXO o arco
      // vai no sentido anti-horário para o texto ficar de pé (lendo da esquerda p/ a direita).
      function arcPath(id, a, r, len) {
        var span = Math.min(Math.PI * 1.6, (len * 1.6) / Math.max(1, r)), bottom = Math.sin(a) > 0.05;
        var a0 = bottom ? a + span / 2 : a - span / 2, a1 = bottom ? a - span / 2 : a + span / 2;
        var p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
        defs.appendChild(mk("path", { id: id, d: "M" + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A" + r + " " + r + " 0 " + (span > Math.PI ? 1 : 0) + " " + (bottom ? 0 : 1) + " " + p1[0].toFixed(2) + " " + p1[1].toFixed(2) }));
        return bottom;
      }
      function curvedText(id, s, size, weight, fill) {
        var tx = mk("text", { "font-size": size, "font-weight": weight, fill: fill });
        var tp = mk("textPath", { href: "#" + id, startOffset: "50%", "text-anchor": "middle" });
        tp.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#" + id);
        tp.textContent = s; tx.appendChild(tp); svg.appendChild(tx);
        return tp;
      }
      // textos da faixa por eixo, preenchidos em _updateRadar: na PONTA (sob o nome: escala 1–N ou o intervalo do
      // tipo em foco) e DENTRO do radar (escala 1–N junto à ponta do eixo, quando a ponta mostra o tipo ou scalePos="inside")
      var tipSubs = [], inSubs = [], tickEls = [];
      var labSeq = (this._labSeq = (this._labSeq || 0) + 1);
      dims.forEach(function (t, i) {
        var amf = axisMaxFrac(P.Segmenter.escalaMaxOf(t)), p = pt(i, amf);
        svg.appendChild(mk("line", { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: cfg.axisColor, "stroke-width": cfg.axisWidth }));
        var a = ang(i), lr = amf * R + lgap, scaleTxt = "1–" + P.Segmenter.escalaMaxOf(t);
        if (cfg.labelCurve) {
          // curvado: nome no arco de raio lr; a faixa 1–N numa linha a mais, para fora (embaixo) / para dentro (em cima)
          var idN = "mdim-lab" + labSeq + "-" + i, bottom = Math.sin(a) > 0.05;
          var rN = bottom ? lr + lfs * 0.75 : lr;   // embaixo os glifos crescem p/ o centro → afasta o arco
          arcPath(idN, a, rN, t.name.length * lfs * 0.6); curvedText(idN, t.name, lfs, lfw, "var(--txt)");
          var idS = idN + "s", rS = bottom ? rN + sfs * 1.25 : rN - lfs * 1.05;
          arcPath(idS, a, rS, 7 * sfs * 0.6); tipSubs.push(curvedText(idS, "", sfs, 400, "var(--txt-dim)"));
          inSubs.push(inside(i, amf, a));
          return;
        }
        var lp = [cx + Math.cos(a) * lr, cy + Math.sin(a) * lr];
        var anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
        // no topo, o nome vai acima e a faixa abaixo; nos demais eixos, ambos empilhados para fora
        var up = Math.sin(a) < -0.3;
        var lab = mk("text", { x: lp[0], y: lp[1] + (up ? -lfs * 0.36 : 0), "font-size": lfs, "font-weight": lfw, fill: "var(--txt)", "text-anchor": anchor });
        lab.textContent = t.name; svg.appendChild(lab);
        var sub = mk("text", { x: lp[0], y: lp[1] + (up ? sfs * 0.9 : lfs * 1.1), "font-size": sfs, fill: "var(--txt-dim)", "text-anchor": anchor });
        svg.appendChild(sub); tipSubs.push(sub);
        inSubs.push(inside(i, amf, a));
      });
      // escala DENTRO do radar: o VALOR de cada linha da grade junto ao eixo (1ª linha = 2 com centro no mínimo, ou 1
      // com centro zero; o centro ganha "1" quando é o mínimo). Eixos com valores: todos, só o 1º, ou auto (só o 1º
      // quando todas as escalas são iguais; todos quando são assimétricas). Texto ao LADO do eixo, com halo.
      function inside(i, amf, a) {
        var tickAll = cfg.tickAxes === "all" || (cfg.tickAxes !== "first" && !uniform);
        var out = []; if (i > 0 && !tickAll) return out;
        if (!tickAll) return singleTicks();
        var fs = sfs * 0.92, perp = a + Math.PI / 2, off = 3 + fs * 0.45, esc = escs[i];
        var anc = Math.cos(perp) > 0.3 ? "start" : (Math.cos(perp) < -0.3 ? "end" : "middle");
        for (var k = B; k <= esc; k++) {
          if (k === B && (B === 0 || i > 0)) continue;   // centro: só um "1" (no 1º eixo), e nada quando o centro é 0
          var q = pt(i, posFrac(i, k)), x = q[0] + Math.cos(perp) * off, y = q[1] + Math.sin(perp) * off + fs * 0.35;
          var el = mk("text", { x: x.toFixed(2), y: y.toFixed(2), "font-size": fs.toFixed(2), fill: "var(--txt-dim)", "text-anchor": anc, stroke: "var(--panel)", "stroke-width": 3, "stroke-linejoin": "round", "paint-order": "stroke", display: "none" });
          el.textContent = String(k); out.push(el); tickEls.push(el);
        }
        return out;
      }
      // UM valor por linha (modelo sem assimetria ou «só um eixo»): cada valor fica SOBRE a própria linha da grade, no
      // ângulo cfg.tickAngle (graus; 0 = direita, 90 = topo, anti-horário) → ao girar, acompanha a linha (círculo ou
      // teia). cfg.tickOffset desloca na direção radial: + acima/fora da linha, − abaixo/dentro.
      function singleTicks() {
        var out = [], fs = sfs * 0.92, th = (cfg.tickAngle != null ? +cfg.tickAngle : 90) * Math.PI / 180;
        var d = [Math.cos(th), -Math.sin(th)], off = +cfg.tickOffset || 0, kmax = uniform ? escs[0] : gmax;
        var circ = cfg.gridStyle === "circulos", lev = (cfg.normalize && uniform) ? escs[0] : gmax;
        function cr(u, v) { return u[0] * v[1] - u[1] * v[0]; }
        function onLine(k) {                                   // distância do centro até a linha do nível k, no ângulo th
          if (circ) return (k - B) / Math.max(1e-9, lev - B) * R;
          var best = null;
          for (var j = 0; j < N; j++) {
            var j2 = (j + 1) % N, pa = pt(j, posFrac(j, Math.min(k, escs[j]))), pb = pt(j2, posFrac(j2, Math.min(k, escs[j2])));
            var A = [pa[0] - cx, pa[1] - cy], Bv = [pb[0] - cx, pb[1] - cy], ca = cr(d, A), cb = cr(d, Bv);
            if (Math.abs(ca - cb) < 1e-9) continue;
            var t = ca / (ca - cb); if (t < -1e-6 || t > 1 + 1e-6) continue;
            var px = A[0] + t * (Bv[0] - A[0]), py = A[1] + t * (Bv[1] - A[1]), along = px * d[0] + py * d[1];
            if (along > 0 && (best == null || along < best)) best = along;
          }
          return best == null ? 0 : best;
        }
        for (var k = B; k <= kmax; k++) {
          if (k === B && B === 0) continue;                   // centro zero: sem rótulo
          var rr = k === B ? 0 : onLine(k), x = cx + d[0] * (rr + off), y = cy + d[1] * (rr + off) + fs * 0.35;
          var el = mk("text", { x: x.toFixed(2), y: y.toFixed(2), "font-size": fs.toFixed(2), fill: "var(--txt-dim)", "text-anchor": "middle", stroke: "var(--panel)", "stroke-width": 3, "stroke-linejoin": "round", "paint-order": "stroke", display: "none" });
          el.textContent = String(k); out.push(el); tickEls.push(el);
        }
        return out;
      }
      // faixas de intervalo dos tipos de prática (sob o polígono; preenchidas em _updateRadar)
      var bandLayer = mk("g", {}); svg.appendChild(bandLayer);
      // polígono do estado corrente + vértices (atualizados em _updateRadar)
      var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4f9df5";
      var polyEl = mk("polygon", { points: "", fill: this._bw(accent) + this._alpha(cfg.polyOpacity), stroke: this._bw(accent), "stroke-width": cfg.outlineWidth, "stroke-linejoin": "round" });
      svg.appendChild(polyEl);
      var dots = [], labels = [];
      dims.forEach(function (t, i) {
        var c = mk("circle", { r: 3, fill: accent, display: "none" }); svg.appendChild(c); dots.push(c);
        var lb = mk("text", { "font-size": 10, "font-weight": 600, fill: "var(--txt)", "text-anchor": "middle", display: "none", stroke: "var(--panel)", "stroke-width": 3, "stroke-linejoin": "round", "paint-order": "stroke" }); labels.push(lb);
      });
      // camada de polígonos comparativos (overlay), desenhados em _updateRadar
      var compareLayer = mk("g", {}); svg.appendChild(compareLayer);
      // nível médio do tipo (por cima de tudo; desenhado em _updateRadar quando cfg.showTypeMean)
      var meanLayer = mk("g", {}); svg.appendChild(meanLayer);
      tickEls.forEach(function (el) { svg.appendChild(el); });   // valores da grade (acima da faixa/polígono, abaixo dos escores)
      labels.forEach(function (lb) { svg.appendChild(lb); });   // rótulos dos escores por cima de tudo (com halo)
      card.appendChild(svg);
      // leitura do tipo de prática ativo (acende/apaga)
      var readout = document.createElement("div");
      readout.style.cssText = "text-align:center;margin-top:2px;font-size:12px;min-height:16px;color:var(--txt-dim)";
      card.appendChild(readout);
      // legenda das camadas (base + comparativas), quando houver comparação
      var legend = document.createElement("div");
      legend.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:4px";
      card.appendChild(legend);
      host.appendChild(card);
      this._radar = { svg: svg, defs: defs, poly: polyEl, dots: dots, labels: labels, bandLayer: bandLayer, compareLayer: compareLayer, meanLayer: meanLayer, tipSubs: tipSubs, inSubs: inSubs, legend: legend, cx: cx, cy: cy, R: R, N: N, dims: dims, pt: pt, mk: mk, accent: accent, gmax: gmax, fracFor: fracFor, playBtn: playBtn, speedBtns: speedBtns, clock: card.querySelector("#mdim-tcur"), dur: card.querySelector("#mdim-tdur"), readout: readout, _patColor: null };
    },

    // Rótulos dos escores FORA do polígono: cada um vai na direção externa do vértice (bissetriz do ângulo
    // externo: longe do ponto médio dos vizinhos no vértice convexo; em direção a ele no côncavo, testado por
    // ponto-no-polígono), com halo da cor do fundo p/ ler por cima de faixas/grade.
    _placeScoreLabels: function (r, fracs, nulls, skipNull) {
      var vs = [];
      fracs.forEach(function (f, i) { if (!(skipNull && nulls[i])) vs.push({ i: i, p: r.pt(i, f) }); });
      function inside(x, y) {
        var c = false;
        for (var a = 0, b = vs.length - 1; a < vs.length; b = a++) {
          var pa = vs[a].p, pb = vs[b].p;
          if ((pa[1] > y) !== (pb[1] > y) && x < (pb[0] - pa[0]) * (y - pa[1]) / (pb[1] - pa[1]) + pa[0]) c = !c;
        }
        return c;
      }
      var fs = 10, dist = 11;
      vs.forEach(function (v, k) {
        var lb = r.labels[v.i]; if (!lb || lb.getAttribute("display") === "none") return;
        var a = -Math.PI / 2 + v.i * 2 * Math.PI / r.N, dx = Math.cos(a), dy = Math.sin(a);   // padrão: para fora pelo eixo
        if (vs.length >= 3) {
          var pr = vs[(k - 1 + vs.length) % vs.length].p, nx = vs[(k + 1) % vs.length].p;
          var mx = v.p[0] - (pr[0] + nx[0]) / 2, my = v.p[1] - (pr[1] + nx[1]) / 2, L = Math.hypot(mx, my);
          if (L > 0.5) { dx = mx / L; dy = my / L; }
          if (inside(v.p[0] + dx * 4, v.p[1] + dy * 4)) { dx = -dx; dy = -dy; }   // vértice côncavo → o lado de fora é o outro
        }
        var x = v.p[0] + dx * dist, y = v.p[1] + dy * dist;
        // colide com a escala 1–N interna (vértice perto da ponta)? → vai para o LADO do eixo, ainda fora do polígono
        var ins = [].concat.apply([], r.inSubs || []).filter(function (el) { return el.getAttribute("display") !== "none"; });
        var near = null; ins.forEach(function (el) { var ex = +el.getAttribute("x"), ey = +el.getAttribute("y") - fs * 0.35, d = Math.hypot(x - ex, y - ey); if (d < fs * 1.6 && (!near || d < near.d)) near = { d: d, x: ex, y: ey }; });
        if (near) {
          var ix = near.x, iy = near.y;
          {
            var px = -Math.sin(a), py = Math.cos(a), best = null;
            [1, -1].forEach(function (sg) {
              var cxp = v.p[0] + px * sg * (dist + 3) + dx * 2, cyp = v.p[1] + py * sg * (dist + 3) + dy * 2;
              var sc = (inside(cxp, cyp) ? -1000 : 0) + Math.hypot(cxp - ix, cyp - iy);
              if (!best || sc > best.s) best = { s: sc, x: cxp, y: cyp };
            });
            x = best.x; y = best.y;
          }
        }
        lb.setAttribute("x", x.toFixed(2));
        lb.setAttribute("y", (y + fs * 0.35).toFixed(2));
      });
    },

    _updateRadar: function () {
      var r = this._radar; if (!r) return;
      var frozen = this._frozen;                    // estado congelado (frames do GIF) em vez do tempo
      var t = frozen ? 0 : this.currentT(), self = this;
      var fracs = [], nulls = [], any = false, skipNull = this._rBase() === 1;   // centro = 1 → vértice sem dado sai do polígono
      r.dims.forEach(function (dim, i) {
        var sc = frozen ? frozen.scores[i] : P.Segmenter.dimScoreAt(dim, t), n = P.Segmenter.escalaMaxOf(dim);
        var f = (sc == null) ? 0 : Math.max(0, Math.min(1, r.fracFor(n, sc)));
        fracs.push(f); nulls.push(sc == null);
        var p = r.pt(i, f);
        var dot = r.dots[i], lb = r.labels[i];
        if (sc == null || !self.cfg.showPoints) { dot.setAttribute("display", "none"); lb.setAttribute("display", "none"); }
        else {
          dot.setAttribute("cx", p[0]); dot.setAttribute("cy", p[1]); dot.setAttribute("display", "block");
          lb.textContent = String(sc).replace(".", ","); lb.setAttribute("display", "block");
        }
        if (sc != null) any = true;
      });
      var pts = fracs.map(function (f, i) { if (skipNull && nulls[i]) return null; var p = r.pt(i, f); return p[0] + "," + p[1]; }).filter(function (x) { return x != null; }).join(" ");
      r.poly.setAttribute("points", pts);
      r.poly.setAttribute("display", any ? "block" : "none");
      if (!frozen && r.clock) r.clock.textContent = P.fmtTime(t, true);
      if (!frozen && r.dur) r.dur.textContent = P.fmtTime(this.maxTime());

      // --- tipos de prática: acende/apaga, cor do polígono, faixas de intervalo ---
      var cats = P.Segmenter.categories || [];
      var active = frozen ? (frozen.cat ? [frozen.cat] : []) : cats.filter(function (c) { return P.Segmenter.categoryActiveAt(c, t); });
      var activeCat = active[0] || null, cfg = this.cfg;
      // cor + PADRÃO + traço do polígono conforme o tipo ativo (diferencia os tipos, útil em P&B).
      // Sem tipo ativo, usa o estilo "sem tipo" editável (cfg.neutral*).
      var pcol = this._bw(activeCat ? activeCat.cor : cfg.neutralCor);
      var patType = activeCat ? (activeCat.pattern || "solid") : (cfg.neutralPattern || "solid");
      if (patType !== "solid") {
        r.poly.setAttribute("fill", this._ensurePolyPattern(r, patType, pcol));
        r.poly.setAttribute("fill-opacity", cfg.polyOpacity);
      } else {
        r.poly.setAttribute("fill", pcol + this._alpha(cfg.polyOpacity));
        r.poly.removeAttribute("fill-opacity");
      }
      r.poly.setAttribute("stroke", cfg.outlineCustom ? this._bw(cfg.outlineColor) : pcol);
      r.poly.setAttribute("stroke-width", cfg.outlineWidth);
      var odash = activeCat ? (activeCat.dash || "") : (cfg.neutralDash || "");
      if (odash) r.poly.setAttribute("stroke-dasharray", odash); else r.poly.removeAttribute("stroke-dasharray");
      // faixas (range) do tipo ativo ou, se nenhum, do tipo em prévia - traço próprio do tipo
      var focus = activeCat || cats.filter(function (c) { return c.id === self._focusCatId; })[0] || null;
      // faixa por eixo: a PONTA mostra o intervalo do tipo em foco (cor do tipo); a escala 1–N vai para DENTRO
      var showTR = cfg.tipTypeRange !== false && !!focus, scIn = cfg.showScaleNumbers && (showTR || cfg.scalePos === "inside");
      r.dims.forEach(function (dim, i) {
        var n = P.Segmenter.escalaMaxOf(dim), scaleTxt = "1–" + n, tip = r.tipSubs && r.tipSubs[i], ins = r.inSubs && r.inSubs[i];
        if (tip) {
          var iv = focus && focus.intervalos[dim.id], txt = showTR ? (iv ? (iv[0] === iv[1] ? String(iv[0]) : iv[0] + "–" + iv[1]) : scaleTxt) : (cfg.showScaleNumbers && cfg.scalePos !== "inside" ? scaleTxt : "");
          tip.textContent = txt;
          var host = tip.tagName === "textPath" ? tip.parentNode : tip;
          host.setAttribute("fill", showTR ? self._bw(focus.cor) : "var(--txt-dim)"); host.setAttribute("font-weight", showTR ? 600 : 400);
        }
        if (ins) ins.forEach(function (el) { el.setAttribute("display", scIn ? "block" : "none"); });
      });
      this._placeScoreLabels(r, fracs, nulls, skipNull);   // depois da escala interna (evita colisão com ela)
      while (r.bandLayer.firstChild) r.bandLayer.removeChild(r.bandLayer.firstChild);
      if (focus) {
        var bcol = self._bw(cfg.bandCustom ? cfg.bandColor : focus.cor);
        var bop = activeCat ? cfg.bandOpacity : cfg.bandOpacity * 0.6;
        var bdash = focus.dash || "";
        if (cfg.bandStyle === "ring") {
          // ANEL: polígono do máx + polígono do mín (evenodd → miolo vazado). Eixo não restrito pelo tipo = faixa inteira (1..N).
          var outer = [], inner = [];
          r.dims.forEach(function (dim, i) {
            var n = P.Segmenter.escalaMaxOf(dim), iv = focus.intervalos[dim.id] || [1, n];
            var pMax = r.pt(i, r.fracFor(n, Math.min(n, iv[1]))), pMin = r.pt(i, r.fracFor(n, Math.max(1, iv[0])));
            outer.push(pMax[0].toFixed(2) + " " + pMax[1].toFixed(2)); inner.push(pMin[0].toFixed(2) + " " + pMin[1].toFixed(2));
          });
          var patB = focus.pattern || "solid";
          var at2 = { d: "M" + outer.join(" L") + " Z M" + inner.join(" L") + " Z", "fill-rule": "evenodd", stroke: bcol, "stroke-width": Math.max(0.5, cfg.outlineWidth), "stroke-linejoin": "round" };
          if (patB !== "solid") {   // pattern PRÓPRIO da faixa (não reusa o id do polígono)
            var bkey = patB + "|" + bcol;
            if (r._bandPatKey !== bkey) { var oldB = r.defs.querySelector("#mdim-band-pat"); if (oldB) r.defs.removeChild(oldB); r.defs.appendChild(P.GCP._patternEl("mdim-band-pat", patB, bcol)); r._bandPatKey = bkey; }
            at2.fill = "url(#mdim-band-pat)"; at2["fill-opacity"] = bop;
          }
          else { at2.fill = bcol; at2["fill-opacity"] = bop; }
          if (bdash) at2["stroke-dasharray"] = bdash;
          r.bandLayer.appendChild(r.mk("path", at2));
        } else {
          r.dims.forEach(function (dim, i) {
            var iv = focus.intervalos[dim.id]; if (!iv) return;
            var n = P.Segmenter.escalaMaxOf(dim);
            var pMin = r.pt(i, Math.max(0.001, r.fracFor(n, iv[0]))), pMax = r.pt(i, r.fracFor(n, iv[1]));
            var at = { x1: pMin[0], y1: pMin[1], x2: pMax[0], y2: pMax[1], stroke: bcol, "stroke-width": cfg.bandWidth, "stroke-linecap": cfg.bandRound ? "round" : "butt", opacity: bop };
            if (bdash) at["stroke-dasharray"] = bdash;
            r.bandLayer.appendChild(r.mk("line", at));
          });
        }
      }
      // figura de tipos (frames congelados): polígono do estado pode sumir (fica só faixa + média)
      // no modo ANEL a figura mostra só as extremidades (mín/máx) do tipo, nunca um estado específico
      if (frozen && (cfg.statePoly === false || (cfg.bandStyle === "ring" && focus))) { r.poly.setAttribute("display", "none"); r.dots.forEach(function (d) { d.setAttribute("display", "none"); }); r.labels.forEach(function (l) { l.setAttribute("display", "none"); }); }
      // nível médio de cada dimensão DURANTE o tipo em foco (ponderado pela duração, nas sessões da fonte)
      while (r.meanLayer.firstChild) r.meanLayer.removeChild(r.meanLayer.firstChild);
      if (cfg.showTypeMean && focus) {
        var means = (this._typeMeansCached() || {})[focus.id];
        if (means) {
          var mcol = self._bw(cfg.meanColor || "#000000"), mw = +cfg.meanWidth || 2.5, mpts = [], okM = true;
          r.dims.forEach(function (dim, i) { var f0 = means[dim.name]; if (f0 == null) { okM = false; return; } var n = P.Segmenter.escalaMaxOf(dim), v = 1 + f0 * (n - 1); mpts.push(r.pt(i, Math.max(0, Math.min(1, r.fracFor(n, v))))); });
          if (okM && mpts.length) {
            r.meanLayer.appendChild(r.mk("polygon", { points: mpts.map(function (p) { return p[0] + "," + p[1]; }).join(" "), fill: "none", stroke: mcol, "stroke-width": mw, "stroke-linejoin": "round" }));
            mpts.forEach(function (p) { r.meanLayer.appendChild(r.mk("circle", { cx: p[0], cy: p[1], r: mw * 1.7, fill: mcol })); });
          }
        }
      }

      // --- camadas comparativas: um polígono por camada, no cursor de cada uma ---
      while (r.compareLayer.firstChild) r.compareLayer.removeChild(r.compareLayer.firstChild);
      if (!frozen && this._compares.length && this._mode === "overlay") {
        this._compares.forEach(function (cl) {
          var col = self._bw(cl.cor), fp = [];
          r.dims.forEach(function (dim, i) {
            var cd = cl.dims[i]; if (!cd) { if (!skipNull) fp.push(r.pt(i, 0)); return; }
            var sc = P.Segmenter.dimScoreAt(cd, cl.t); if (sc == null && skipNull) return;
            var f = (sc == null) ? 0 : Math.max(0, Math.min(1, r.fracFor(P.Segmenter.escalaMaxOf(cd), sc)));
            fp.push(r.pt(i, f));
          });
          var pstr = fp.map(function (p) { return p[0] + "," + p[1]; }).join(" ");
          r.compareLayer.appendChild(r.mk("polygon", { points: pstr, fill: col + self._alpha(cfg.polyOpacity * 0.6), stroke: col, "stroke-width": cfg.outlineWidth, "stroke-dasharray": "4 3", "stroke-linejoin": "round" }));
        });
      }
      // legenda das camadas (base + comparativas)
      if (r.legend) {
        if (this._compares.length) {
          var items = [{ nome: "Sessão atual", cor: this._bw(r.accent), dash: false }].concat(this._compares.map(function (c) { return { nome: c.nome, cor: self._bw(c.cor), dash: true }; }));
          r.legend.innerHTML = items.map(function (it) { return '<span class="mini" style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:0;border-top:3px ' + (it.dash ? "dashed" : "solid") + ' ' + it.cor + '"></span>' + P.escapeHtml(it.nome) + '</span>'; }).join("");
        } else r.legend.innerHTML = "";
      }
      // indicadores acende/apaga na lista de categorias
      (this._catDots || []).forEach(function (d) {
        var on = active.some(function (c) { return c.id === d.id; });
        d.el.style.background = on ? d.cor : "transparent";
      });
      // leitura textual do tipo ativo
      if (r.readout) {
        if (active.length) { r.readout.textContent = "Tipo ativo: " + active.map(function (c) { return c.nome; }).join(", "); r.readout.style.color = this._bw(activeCat.cor); }
        else { r.readout.textContent = cats.length ? "Nenhum tipo ativo" : ""; r.readout.style.color = "var(--txt-dim)"; }
      }
    },

    // SVG de linhas em degraus para uma dimensão.
    // === MATRIZ DE STEP-PLOTS (figura de publicação): N sessões (.praxis) numa grade participante × sessão ===
    // Cada célula = as dimensões da sessão SOBREPOSTAS (normalizadas ao mesmo eixo 1..Nmax), sem faixas nem
    // índices; eixo X próprio por sessão (durações diferentes); título do eixo X só na última linha; UMA legenda.
    _matrix: null,
    _matrixLoad: function () {
      if (this._matrix) { this._applyDimAlias(); return this._matrix; }   // o modelo aberto pode ter mudado → reavalia equivalências
      var m = null; try { m = JSON.parse(localStorage.getItem("praxis.mdim.matrix") || "null"); } catch (e) {}
      if (!m || typeof m !== "object") m = {};
      m.cells = Array.isArray(m.cells) ? m.cells : [];
      if (!(m.cols > 0)) m.cols = 2; if (!(m.cellW > 0)) m.cellW = 420; if (!(m.cellH > 0)) m.cellH = 150;
      if (!(m.lineW > 0)) m.lineW = 2; if (!(m.fontSize > 0)) m.fontSize = 12; if (!m.font) m.font = "'Times New Roman', Times, serif";
      if (!(m.exportW > 0)) m.exportW = 2400; if (m.xTitle == null) m.xTitle = "Tempo (min)"; if (m.yTitle == null) m.yTitle = "Nível";
      if (!(m.gapX >= 0)) m.gapX = 34; if (!(m.gapY >= 0)) m.gapY = 18;   // margens entre células (0 = coladas)
      if (!(m.laneGap >= 0)) m.laneGap = 3.5;   // faixa (lane): afasta as linhas que caem no MESMO escore, como no step-plot (cfg.spLaneGap)
      // qual figura multi-sessão: "matrix" (step-plots) | "radar" (por tipo: faixa vazada + nível médio) | "bars" (% do tempo por tipo)
      if (m.figType !== "radar" && m.figType !== "bars") m.figType = "matrix";
      // radar por tipo em matriz: organização (ordem/seleção próprias desta figura) e sem estatísticas por padrão
      if (!(m.rCols > 0)) m.rCols = 2; if (!(m.rSize > 0)) m.rSize = 320; if (!(m.rGapX >= 0)) m.rGapX = 20; if (!(m.rGapY >= 0)) m.rGapY = 16;
      if (!(m.rMargin >= 0)) m.rMargin = 12; if (m.rTitles == null) m.rTitles = true; if (!(m.rTitleSize > 0)) m.rTitleSize = 16; if (m.rStats == null) m.rStats = false;
      if (!Array.isArray(m.rOrder)) m.rOrder = []; if (m.rSel !== null && !Array.isArray(m.rSel)) m.rSel = null;
      if (!(m.barsW > 0)) m.barsW = 900; if (!(m.barsRowH > 0)) m.barsRowH = 30; if (m.barsShowVals == null) m.barsShowVals = true;
      if (m.barsXTitle == null) m.barsXTitle = "Percentual do tempo da sessão"; if (m.barsIncludeNone == null) m.barsIncludeNone = true;
      if (m.barsLegendNone == null) m.barsLegendNone = true;   // «Sem tipo» na legenda (pode esconder quando é desprezível)
      if (!m.dimColors || typeof m.dimColors !== "object") m.dimColors = {};   // cor por dimensão (nome) escolhida p/ a figura
      if (!m.dimAlias || typeof m.dimAlias !== "object") m.dimAlias = {};     // nome no ARQUIVO → nome no modelo aberto ("" = manter)
      if (!m.dimAliasAuto || typeof m.dimAliasAuto !== "object") m.dimAliasAuto = {};
      this._matrix = m; this._applyDimAlias(); return m;
    },
    // EQUIVALÊNCIA DE NOMES entre as sessões carregadas e o modelo do projeto aberto (ex.: arquivos antigos com
    // «Reatividade» e modelo novo com «Proatividade»). As figuras casam dimensões pelo NOME; aqui cada dimensão do
    // arquivo guarda o nome original (origName) e passa a usar o nome equivalente do modelo. Pareamento AUTOMÁTICO
    // quando sobra exatamente 1 nome sem par de cada lado; o usuário pode trocar/desfazer no painel (m.dimAlias).
    _applyDimAlias: function () {
      var m = this._matrix; if (!m || !m.cells) return false;
      var alias = m.dimAlias, model = this.dims ? this.dims().map(function (d) { return d.name; }) : [];
      function norm(x) { return String(x || "").trim().toLowerCase(); }
      var inModel = {}; model.forEach(function (n) { inModel[norm(n)] = n; });
      var files = [], seenF = {};
      m.cells.forEach(function (c) { c.dims.forEach(function (d) { if (d.origName == null) d.origName = d.name; if (!seenF[d.origName]) { seenF[d.origName] = 1; files.push(d.origName); } }); });
      if (model.length) {
        var unmatched = files.filter(function (n) { return !inModel[norm(n)] && !(n in alias); });
        var used = {}; files.forEach(function (n) { var r = (n in alias && alias[n]) ? alias[n] : n; used[norm(r)] = 1; });
        var free = model.filter(function (n) { return !used[norm(n)]; });
        if (unmatched.length === 1 && free.length === 1) { alias[unmatched[0]] = free[0]; m.dimAliasAuto[unmatched[0]] = true; }
      }
      var changed = false;
      m.cells.forEach(function (c) { c.dims.forEach(function (d) {
        var tgt = (alias[d.origName] && inModel[norm(alias[d.origName])]) ? alias[d.origName] : (inModel[norm(d.origName)] || d.origName);
        if (d.name !== tgt) { d.name = tgt; changed = true; }
      }); });
      if (changed) { this._tmCache = null; try { localStorage.setItem("praxis.mdim.matrix", JSON.stringify(m)); } catch (e) {} }
      return changed;
    },
    _matrixSave: function () { try { localStorage.setItem("praxis.mdim.matrix", JSON.stringify(this._matrix)); } catch (e) {} },
    // Lê vários .praxis de uma vez (só as camadas de dimensão); cada arquivo vira uma célula.
    matrixAddFiles: function (files) {
      var self = this, m = this._matrixLoad(), list = Array.prototype.slice.call(files || []), pend = list.length;
      if (!pend) return;
      list.forEach(function (file, order) {
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var buf = rd.result, bytes = new Uint8Array(buf);
            if (new TextDecoder().decode(bytes.slice(0, 8)) !== "PRAXIS01") throw new Error("não é um .praxis");
            var jsonLen = new DataView(buf).getUint32(8, true);
            var proj = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + jsonLen)));
            var dims = (proj.tiers || []).filter(function (t) { return t.kind === "dimensao"; }).map(function (t) {
              var segs = (t.segments || []).filter(function (s) { return isFinite(s.tStart) && isFinite(s.tEnd) && s.value !== "" && isFinite(parseFloat(s.value)); })
                .map(function (s) { return { tStart: +s.tStart, tEnd: +s.tEnd, value: parseFloat(s.value) }; }).sort(function (a, b) { return a.tStart - b.tStart; });
              return { name: t.name || "Dimensão", cor: t.cor || "", escalaMax: P.Segmenter.escalaMaxOf(t) || 5, segments: segs };
            });
            if (!dims.length) throw new Error("sem camadas de dimensão");
            var maxT = 0; dims.forEach(function (d) { d.segments.forEach(function (s) { if (s.tEnd > maxT) maxT = s.tEnd; }); });
            m.cells.push({ id: "mx" + Date.now().toString(36) + order, title: file.name.replace(/\.praxis$/i, ""), dims: dims, maxT: maxT, _order: order });
          } catch (e) { alert("«" + file.name + "»: " + (e && e.message ? e.message : e)); }
          if (--pend === 0) {
            m.cells.sort(function (a, b) { return (a._order || 0) - (b._order || 0); });   // mantém a ordem em que os arquivos foram escolhidos
            m.cells.forEach(function (c) { delete c._order; });
            self._applyDimAlias(); self._matrixSave(); self.renderMatrixPanel(); self.render();
          }
        };
        rd.readAsArrayBuffer(file);
      });
    },
    // Dimensões da figura (união por NOME, na ordem de aparição) com cor consistente entre as células.
    // Cor de cada dimensão na figura: escolhida no painel (m.dimColors) → cor da dimensão de MESMO NOME no projeto
    // ABERTO (é a que o pesquisador usa hoje; os arquivos antigos podem trazer cores velhas) → cor gravada no arquivo → paleta.
    _matrixDimInfo: function () {
      var m = this._matrixLoad(), out = [], seen = {}, cur = {};
      (this.dims ? this.dims() : []).forEach(function (d) { if (d && d.name && d.cor) cur[d.name] = d.cor; });
      m.cells.forEach(function (c) { c.dims.forEach(function (d) {
        if (seen[d.name]) { if (!seen[d.name].fileCor && d.cor) seen[d.name].fileCor = d.cor; return; }
        var o = { name: d.name, fileCor: d.cor || "" }; seen[d.name] = o; out.push(o);
      }); });
      out.forEach(function (o, i) { o.cor = (m.dimColors && m.dimColors[o.name]) || cur[o.name] || o.fileCor || P.PALETTE_COLOR[i % P.PALETTE_COLOR.length]; });
      return out;
    },
    _buildMatrixSvg: function () {
      var m = this._matrixLoad(), cells = m.cells; if (!cells.length) return null;
      var info = this._matrixDimInfo(), colOf = {}; info.forEach(function (o) { colOf[o.name] = o.cor; });
      var Nmax = 1; cells.forEach(function (c) { c.dims.forEach(function (d) { if (d.escalaMax > Nmax) Nmax = d.escalaMax; }); });
      var cols = Math.max(1, Math.min(6, m.cols | 0)), rows = Math.ceil(cells.length / cols);
      var fs = m.fontSize || 12, cw = m.cellW, ch = m.cellH, lw = m.lineW || 2;
      var padL = 46, padR = 12, padT = 22, padB = 26;   // dentro da célula: título em cima, eixo X embaixo
      var gapX = (m.gapX >= 0 ? m.gapX : 34), gapY = (m.gapY >= 0 ? m.gapY : 18), mL = 10, mT = 8, legH = 34, xTitleH = 20;
      // faixa (lane) SÓ onde há sobreposição: dimensões no MESMO escore ao MESMO tempo se afastam naquele trecho
      // (ordem estável pela união); fora da sobreposição a linha fica exatamente no nível.
      var laneGap = (m.laneGap >= 0 ? m.laneGap : 3.5), rankOf = {}; info.forEach(function (o, i) { rankOf[o.name] = i; });
      var W = mL + cols * cw + (cols - 1) * gapX + 10, H = mT + rows * (ch + gapY) - gapY + xTitleH + legH + 8;
      var NS = SVGNS, svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", "100%"); svg.setAttribute("font-family", m.font);
      var TXT = "#222222", GRID = "#d9d9d9", AX = "#444444";   // cores concretas (figura de impressão, fundo branco)
      function mk(tag, at, parent) { var e = document.createElementNS(NS, tag); for (var k in at) e.setAttribute(k, at[k]); (parent || svg).appendChild(e); return e; }
      function text(x, y, s, at, parent) { var a = { x: x, y: y, fill: TXT, "font-size": fs }; for (var k in at) a[k] = at[k]; var e = mk("text", a, parent); e.textContent = s; return e; }
      function niceMin(span) { var c = [1, 2, 5, 10, 15, 20, 30, 60]; for (var i = 0; i < c.length; i++) if (span / c[i] <= 8) return c[i]; return 60; }
      cells.forEach(function (c, i) {
        var r = Math.floor(i / cols), k = i % cols;
        var g = mk("g", { transform: "translate(" + (mL + k * (cw + gapX)) + "," + (mT + r * (ch + gapY)) + ")" });
        var pw = cw - padL - padR, ph = ch - padT - padB, maxMin = Math.max(1, c.maxT / 60);
        var x = function (t) { return padL + (t / 60) / maxMin * pw; };
        var y = function (v) { return padT + (Nmax > 1 ? (Nmax - v) / (Nmax - 1) : 0.5) * ph; };
        text(padL, padT - 8, c.title || "", { "font-weight": 700, "font-size": fs + 1 }, g);   // título da célula
        for (var lv = 1; lv <= Nmax; lv++) {   // grade horizontal leve + rótulos de nível
          var yy = y(lv); mk("line", { x1: padL, y1: yy, x2: padL + pw, y2: yy, stroke: GRID, "stroke-width": 1 }, g);
          text(padL - 7, yy + fs * 0.35, String(lv), { "text-anchor": "end", "font-size": fs - 1 }, g);
        }
        mk("line", { x1: padL, y1: padT, x2: padL, y2: padT + ph, stroke: AX, "stroke-width": 1 }, g);            // espinha Y
        mk("line", { x1: padL, y1: padT + ph, x2: padL + pw, y2: padT + ph, stroke: AX, "stroke-width": 1 }, g);  // espinha X
        text(14, padT + ph / 2, m.yTitle, { "text-anchor": "middle", transform: "rotate(-90 14 " + (padT + ph / 2) + ")" }, g);
        var st = niceMin(maxMin);   // eixo X próprio (minutos)
        for (var tk = 0; tk <= maxMin + 1e-9; tk += st) {
          var xx = x(tk * 60); mk("line", { x1: xx, y1: padT + ph, x2: xx, y2: padT + ph + 4, stroke: AX, "stroke-width": 1 }, g);
          text(xx, padT + ph + 4 + fs, String(tk), { "text-anchor": "middle", "font-size": fs - 1 }, g);
        }
        if (r === rows - 1) text(padL + pw / 2, ch + xTitleH - 6, m.xTitle, { "text-anchor": "middle" }, g);   // só na última linha
        // Sobreposições: peças (dim, t0, t1) por nível normalizado; por nível, partição do tempo nos pontos de
        // início/fim e, em cada trecho elementar com 2+ dimensões, offsets simétricos (−g/2,+g/2 · −g,0,+g …).
        var byLevel = {};
        c.dims.forEach(function (d) {
          var nd = d.escalaMax || Nmax;
          d.segments.forEach(function (s) {
            var L = (nd > 1 ? 1 + (s.value - 1) / (nd - 1) * (Nmax - 1) : 1), key = L.toFixed(4);
            (byLevel[key] = byLevel[key] || []).push({ name: d.name, t0: s.tStart, t1: s.tEnd });
          });
        });
        var offAt = {};   // nome -> [{a, b, off}] só os trechos sobrepostos (fora deles o offset é 0)
        Object.keys(byLevel).forEach(function (key) {
          var pieces = byLevel[key], bps = {}; pieces.forEach(function (p) { bps[p.t0] = 1; bps[p.t1] = 1; });
          var ts = Object.keys(bps).map(Number).sort(function (a, b) { return a - b; });
          for (var i = 0; i < ts.length - 1; i++) {
            var a = ts[i], b = ts[i + 1]; if (!(b > a)) continue;
            var act = pieces.filter(function (p) { return p.t0 <= a + 1e-9 && p.t1 >= b - 1e-9; }).map(function (p) { return p.name; });
            act = act.filter(function (n, j) { return act.indexOf(n) === j; });   // peças adjacentes da mesma dim contam 1x
            if (act.length < 2) continue;
            act.sort(function (p, q) { return rankOf[p] - rankOf[q]; });
            act.forEach(function (n, k) { (offAt[n] = offAt[n] || []).push({ a: a, b: b, off: (k - (act.length - 1) / 2) * laneGap }); });
          }
        });
        function offFor(name, t) { var arr = offAt[name]; if (!arr) return 0; for (var i = 0; i < arr.length; i++) if (t >= arr[i].a - 1e-9 && t < arr[i].b - 1e-9) return arr[i].off; return 0; }
        function cutsFor(name, t0, t1) { var arr = offAt[name] || [], cs = {}; arr.forEach(function (r) { if (r.a > t0 && r.a < t1) cs[r.a] = 1; if (r.b > t0 && r.b < t1) cs[r.b] = 1; }); return Object.keys(cs).map(Number).sort(function (p, q) { return p - q; }); }
        c.dims.forEach(function (d) {   // linhas em degraus, normalizadas ao eixo comum 1..Nmax
          var cor = colOf[d.name] || "#4f9df5", nd = d.escalaMax || Nmax, prev = null, path = "";
          var norm = function (s) { return nd > 1 ? 1 + (s - 1) / (nd - 1) * (Nmax - 1) : 1; };
          d.segments.forEach(function (s) {
            var yL = y(norm(s.value)), pts = [s.tStart].concat(cutsFor(d.name, s.tStart, s.tEnd), [s.tEnd]);
            for (var i = 0; i < pts.length - 1; i++) {   // sub-trechos do degrau: offset só onde sobrepõe; degrauzinho vertical na borda
              var xa = x(pts[i]), xb = x(pts[i + 1]), yy = yL + offFor(d.name, pts[i]);
              if (i === 0) path += (prev && Math.abs(s.tStart - prev.tEnd) < 0.02) ? (" L" + xa.toFixed(2) + " " + yy.toFixed(2)) : (" M" + xa.toFixed(2) + " " + yy.toFixed(2));   // contíguo = conector vertical
              else path += " L" + xa.toFixed(2) + " " + yy.toFixed(2);
              path += " L" + xb.toFixed(2) + " " + yy.toFixed(2);
            }
            prev = { tEnd: s.tEnd };
          });
          if (path) mk("path", { d: path.trim(), fill: "none", stroke: cor, "stroke-width": lw, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
        });
      });
      // legenda compartilhada (rodapé, centrada)
      var ly = H - legH / 2 + 2, itemW = 0, items = info.map(function (o) { return { name: o.name, cor: o.cor, w: 36 + 8 + o.name.length * fs * 0.55 + 24 }; });
      items.forEach(function (it) { itemW += it.w; });
      var lx = (W - itemW) / 2;
      items.forEach(function (it) { mk("line", { x1: lx, y1: ly, x2: lx + 36, y2: ly, stroke: it.cor, "stroke-width": lw + 1 }); text(lx + 44, ly + fs * 0.35, it.name, {}); lx += it.w; });
      return svg;
    },
    _renderMatrixMode: function (host) {
      this._syncModeBtns();
      var m = this._matrixLoad(), nS = this._thesisSessions().length, nT = this._thesisTypes().length;
      var lab = document.createElement("div"); lab.className = "mini"; lab.style.cssText = "color:var(--txt-dim);margin-bottom:6px";
      var names = { matrix: "Matriz de step-plots", radar: "Radar por tipo (faixa + nível médio)", bars: "Barras de % do tempo por tipo" };
      var hint = "";
      if (m.figType === "matrix" && !m.cells.length) hint = "Carregue vários .praxis no painel «Figuras» da barra lateral.";
      else if (m.figType !== "matrix" && !nT) hint = "Esta figura usa os TIPOS DE PRÁTICA do projeto aberto: abra o projeto com as dimensões e os tipos definidos (as sessões carregadas entram pelo nome das dimensões).";
      else if (m.figType !== "matrix" && !nS) hint = "Sem sessões: carregue .praxis no painel, ou abra um projeto com dimensões.";
      lab.textContent = names[m.figType] + " · " + (hint || (nS + " sessão(ões)" + (m.figType !== "matrix" ? " · " + nT + " tipo(s)" : " · " + m.cols + " coluna(s)") + " · prévia em branco, como sai no export"));
      host.appendChild(lab);
      if (!hint && m.figType === "radar") {   // radar vivo oculto: a figura de tipos (_stateSvg) congela e copia ele
        var hr = document.createElement("div"); hr.style.display = "none"; host.appendChild(hr);
        this.renderRadar(hr, this.dims());
      }
      var svg = hint ? null : this._buildFigure2Svg(); if (!svg) return;
      var card = document.createElement("div"); card.className = "card"; card.style.cssText = "padding:12px;background:#fff;color:#222";
      card.appendChild(svg); host.appendChild(card);
    },
    exportMatrix: function (kind) {
      var m = this._matrixLoad(), svg = this._buildFigure2Svg();
      if (!svg) { alert(m.figType === "matrix" ? "Carregue ao menos um .praxis para a matriz." : "Abra o projeto com os tipos de prática definidos (e carregue as sessões) para esta figura."); return; }
      var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number), W = m.exportW || 2400;
      var base = { matrix: "matriz_stepplots", radar: "radar_por_tipo", bars: "barras_pct_por_tipo" }[m.figType] || "figura";
      this._exportGraphic(svg, base, kind, W, W * (vb[3] / vb[2]));
    },
    // Painel do inspetor: carregar arquivos, layout/estilo, lista de sessões (título editável + arrastar) e export.
    renderMatrixPanel: function () {
      var self = this, host = document.getElementById("mdim-matrix-panel"); if (!host) return;
      var m = this._matrixLoad();
      var FONTS = [["'Times New Roman', Times, serif", "Serif (Times)"], ["Georgia, serif", "Georgia"], ["Arial, Helvetica, sans-serif", "Sans (Arial)"], ["'Segoe UI', system-ui, sans-serif", "Segoe UI"], ["Calibri, sans-serif", "Calibri"]];
      function nk(label, k, min, max, step) { return '<div class="field" style="flex:1;margin:0"><label>' + label + '</label><input type="number" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + m[k] + '"></div>'; }
      function tk(label, k) { return '<div class="field" style="flex:1;margin:0"><label>' + label + '</label><input type="text" data-k="' + k + '" value="' + P.escapeHtml(m[k]) + '"></div>'; }
      function ck(label, k) { return '<label class="row" style="margin:4px 0"><input type="checkbox" data-b="' + k + '"' + (m[k] ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">' + label + '</span></label>'; }
      host.innerHTML =
        '<label style="display:block;margin-bottom:4px" class="mini">Figura</label>' +
        '<div class="seg3" data-figsel role="group" aria-label="Tipo de figura"><button type="button" data-fig="matrix"' + (m.figType === "matrix" ? ' class="active"' : '') + '>Matriz</button><button type="button" data-fig="radar"' + (m.figType === "radar" ? ' class="active"' : '') + '>Radar por tipo</button><button type="button" data-fig="bars"' + (m.figType === "bars" ? ' class="active"' : '') + '>Barras %</button></div>' +
        '<div class="row" style="gap:6px;margin:8px 0 6px"><button class="btn" data-add style="flex:1">Carregar .praxis (vários)</button><input type="file" data-files accept=".praxis" multiple hidden></div>' +
        '<p class="hint" style="margin:0 0 6px">Selecione os arquivos de uma vez (Ctrl/Shift). Cada sessão vira uma célula/barra; arraste ⠿ para reordenar e edite o título. Radar e barras usam os TIPOS DE PRÁTICA do projeto aberto (casando as dimensões pelo nome).</p>' +
        '<div class="row" style="gap:8px"><div class="field" style="flex:1;margin:0"><label>Fonte</label><select data-font>' + FONTS.map(function (f) { return '<option value="' + f[0].replace(/"/g, "&quot;") + '"' + (m.font === f[0] ? " selected" : "") + '>' + f[1] + '</option>'; }).join("") + '</select></div>' + nk("Tamanho da fonte", "fontSize", 7, 24, 1) + '</div>' +
        // --- opções: matriz ---
        '<div data-opts="matrix"' + (m.figType !== "matrix" ? ' hidden' : '') + '>' +
        '<div class="row" style="gap:8px">' + nk("Colunas", "cols", 1, 6, 1) + nk("Espessura da linha", "lineW", 0.5, 6, 0.5) + '</div>' +
        '<div class="row" style="gap:8px">' + nk("Largura da célula", "cellW", 200, 1200, 10) + nk("Altura da célula", "cellH", 80, 600, 10) + '</div>' +
        '<div class="row" style="gap:8px">' + tk("Título eixo X", "xTitle") + tk("Título eixo Y", "yTitle") + '</div>' +
        '<div class="row" style="gap:8px">' + nk("Margem entre colunas", "gapX", 0, 200, 2) + nk("Margem entre linhas", "gapY", 0, 200, 2) + '</div>' +
        '<div class="field"><label>Afastamento só nos trechos sobrepostos (px)</label><input type="number" data-k="laneGap" min="0" max="12" step="0.5" value="' + m.laneGap + '" title="Quando 2+ dimensões ficam no mesmo escore ao mesmo tempo, só esse trecho se afasta; fora dele a linha fica no nível exato"></div>' +
        '<div class="subgroup-title" style="margin-top:6px">Cores das dimensões</div>' +
        '<p class="hint" style="margin:0 0 4px">Padrão: a cor da dimensão de mesmo nome no projeto aberto; senão, a gravada no arquivo. «auto» volta ao padrão.</p>' +
        '<div data-dimcolors></div></div>' +
        // --- opções: radar por tipo ---
        '<div data-opts="radar"' + (m.figType !== "radar" ? ' hidden' : '') + '>' +
        '<div class="subgroup-title" style="margin-top:0">Organização da matriz</div>' +
        '<div class="row" style="gap:8px">' + nk("Colunas", "rCols", 1, 6, 1) + nk("Tamanho do radar (px)", "rSize", 120, 900, 10) + '</div>' +
        '<div class="row" style="gap:8px">' + nk("Espaço entre colunas", "rGapX", 0, 200, 2) + nk("Espaço entre linhas", "rGapY", 0, 200, 2) + '</div>' +
        '<div class="row" style="gap:8px">' + nk("Margem externa", "rMargin", 0, 120, 2) + nk("Tamanho do título", "rTitleSize", 8, 36, 1) + '</div>' +
        ck("Título de cada tipo", "rTitles") + ck("Dados embaixo de cada radar (% do tempo, usos, antes/depois)", "rStats") +
        '<div class="subgroup-title">Tipos (marque e arraste ⠿ p/ ordenar)</div><div data-rtypes></div>' +
        '<div class="subgroup-title">Aparência do radar (todos os parâmetros)</div>' +
        '<p class="hint" style="margin:0 0 4px">É o MESMO radar da aba: mudar aqui muda lá, e os presets valem para os dois.</p>' +
        '<div data-rpresets></div><div data-rappear></div></div>' +
        // --- opções: barras % ---
        '<div data-opts="bars"' + (m.figType !== "bars" ? ' hidden' : '') + '>' +
        '<div class="row" style="gap:8px">' + nk("Largura da figura", "barsW", 400, 2000, 20) + nk("Altura da linha", "barsRowH", 12, 80, 2) + '</div>' +
        tk("Título do eixo", "barsXTitle") + ck("Mostrar os valores (%)", "barsShowVals") + ck("Incluir «Sem tipo» (tempo sem tipo ativo)", "barsIncludeNone") + ck("Mostrar «Sem tipo» na legenda", "barsLegendNone") +
        '<p class="hint" style="margin:2px 0 4px">Tempo com 2+ tipos ativos ao mesmo tempo é dividido igualmente entre eles. Use «Nome | sessão 1» no título para quebrar o rótulo em 2 linhas.</p></div>' +
        '<div class="subgroup-title" style="margin-top:6px">Sessões (' + m.cells.length + ')</div><div data-cells></div>' +
        '<div data-alias></div>' +
        '<div class="field" style="margin-top:8px"><label>Largura do export (px)</label><input type="number" data-k="exportW" min="600" max="8000" step="100" value="' + m.exportW + '"></div>' +
        '<div class="row" style="gap:6px;margin-top:6px"><button class="btn secondary" data-exp="png" style="flex:1">PNG</button><button class="btn secondary" data-exp="jpg" style="flex:1">JPG</button><button class="btn secondary" data-exp="svg" style="flex:1">SVG</button></div>' +
        (m.cells.length ? '<button class="btn sm ghost wide" data-clear style="margin-top:6px">Limpar todas as sessões</button>' : '');
      var fin = host.querySelector("[data-files]");
      host.querySelector("[data-add]").addEventListener("click", function () { fin.click(); });
      fin.addEventListener("change", function () { if (this.files && this.files.length) self.matrixAddFiles(this.files); this.value = ""; });
      Array.prototype.forEach.call(host.querySelectorAll("[data-k]"), function (inp) {
        inp.addEventListener(inp.type === "text" ? "input" : "change", function () {
          var k = inp.dataset.k, v = inp.type === "text" ? inp.value : +inp.value;
          var zeroOk = (k === "gapX" || k === "gapY" || k === "laneGap" || k === "rGapX" || k === "rGapY" || k === "rMargin");   // margens/faixa podem ser 0
          if (inp.type !== "text" && !(zeroOk ? v >= 0 : v > 0)) return;
          m[k] = v; self._matrixSave(); self.render();
        });
      });
      host.querySelector("[data-font]").addEventListener("change", function () { m.font = this.value; self._matrixSave(); self.render(); });
      Array.prototype.forEach.call(host.querySelectorAll("[data-figsel] button"), function (b) {   // seletor da figura: mostra só as opções dela
        b.addEventListener("click", function () {
          m.figType = b.dataset.fig; self._matrixSave();
          Array.prototype.forEach.call(host.querySelectorAll("[data-figsel] button"), function (x) { x.classList.toggle("active", x === b); });
          Array.prototype.forEach.call(host.querySelectorAll("[data-opts]"), function (o) { o.hidden = (o.dataset.opts !== m.figType); });
          self.render();
        });
      });
      Array.prototype.forEach.call(host.querySelectorAll("[data-b]"), function (cb) { cb.addEventListener("change", function () { m[cb.dataset.b] = !!cb.checked; self._matrixSave(); self.render(); }); });
      // radar: aparência COMPLETA + presets (mesmo cfg do radar da aba) e lista de tipos (seleção + ordem por arraste)
      var rp = host.querySelector("[data-rpresets]"); if (rp) { this._figPresetsHost = rp; this.renderPresets(rp); }
      var ra = host.querySelector("[data-rappear]"); if (ra) { this._figAppearHost = ra; this.renderAppearance(ra); }
      var rt = host.querySelector("[data-rtypes]");
      if (rt) {
        var cats0 = P.Segmenter.categories || [], byId0 = {}; cats0.forEach(function (c) { byId0[c.id] = c; });
        var ord = (m.rOrder || []).filter(function (id) { return byId0[id]; }); cats0.forEach(function (c) { if (ord.indexOf(c.id) < 0) ord.push(c.id); });
        if (!cats0.length) rt.innerHTML = '<p class="hint" style="margin:0">Nenhum tipo de prática no projeto aberto.</p>';
        var dragT = null;
        ord.forEach(function (id, i) {
          var c = byId0[id], on = !m.rSel || m.rSel.indexOf(id) >= 0;
          var row = document.createElement("div"); row.className = "row"; row.style.cssText = "align-items:center;gap:6px;margin-bottom:3px";
          row.innerHTML = '<span draggable="true" title="Arraste para reordenar" style="flex:0 0 auto;cursor:grab;opacity:.55;user-select:none">⠿</span>' +
            '<input type="checkbox"' + (on ? " checked" : "") + ' style="flex:0 0 auto">' +
            '<span style="flex:0 0 10px;height:10px;border-radius:2px;background:' + self._catColor(c) + '"></span><span class="mini" style="flex:1">' + P.escapeHtml(c.nome) + '</span>';
          row.querySelector('input').addEventListener("change", function () {
            var sel = m.rSel ? m.rSel.slice() : ord.slice();
            if (this.checked) { if (sel.indexOf(id) < 0) sel.push(id); } else sel = sel.filter(function (x) { return x !== id; });
            m.rSel = sel.length === ord.length ? null : sel; self._matrixSave(); self.render();
          });
          var h = row.querySelector("[draggable]");
          h.addEventListener("dragstart", function (e) { dragT = i; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); } catch (_) {} });
          h.addEventListener("dragend", function () { dragT = null; Array.prototype.forEach.call(rt.children, function (r2) { r2.style.borderTop = ""; r2.style.borderBottom = ""; }); });
          row.addEventListener("dragover", function (e) { if (dragT == null) return; e.preventDefault(); row.style[(dragT < i) ? "borderBottom" : "borderTop"] = "2px solid var(--accent, #5ab7ff)"; });
          row.addEventListener("dragleave", function () { row.style.borderTop = ""; row.style.borderBottom = ""; });
          row.addEventListener("drop", function (e) {
            e.preventDefault(); var from = dragT; dragT = null; if (from == null || from === i) return;
            var o2 = ord.slice(), mv = o2.splice(from, 1)[0], ti = o2.indexOf(id); o2.splice(ti + (from < i ? 1 : 0), 0, mv);
            m.rOrder = o2; self._matrixSave(); self.renderMatrixPanel(); self.render();
          });
          rt.appendChild(row);
        });
      }
      Array.prototype.forEach.call(host.querySelectorAll("[data-exp]"), function (b) { b.addEventListener("click", function () { self.exportMatrix(b.dataset.exp); }); });
      var cl = host.querySelector("[data-clear]"); if (cl) cl.addEventListener("click", function () { if (confirm("Remover todas as sessões da matriz?")) { m.cells = []; self._matrixSave(); self.renderMatrixPanel(); self.render(); } });
      var list = host.querySelector("[data-cells]"), dragFrom = null;
      function clearInd() { Array.prototype.forEach.call(list.children, function (r) { r.style.borderTop = ""; r.style.borderBottom = ""; }); }
      m.cells.forEach(function (c, i) {
        var row = document.createElement("div"); row.className = "row"; row.style.cssText = "align-items:center;gap:6px;margin-bottom:4px";
        row.innerHTML = '<span draggable="true" title="Arraste para reordenar" style="flex:0 0 auto;cursor:grab;opacity:.55;user-select:none">⠿</span>' +
          '<input type="text" class="mini" value="' + P.escapeHtml(c.title || "") + '" placeholder="título da célula" style="flex:1;min-width:0;padding:1px 5px">' +
          '<button class="btn sm ghost" data-del title="Remover" style="flex:0 0 auto">' + P.ICON.close + '</button>';
        row.querySelector("input").addEventListener("input", function () { c.title = this.value; self._matrixSave(); self.render(); });
        row.querySelector("[data-del]").addEventListener("click", function () { m.cells.splice(i, 1); self._matrixSave(); self.renderMatrixPanel(); self.render(); });
        var h = row.querySelector("[draggable]");
        h.addEventListener("dragstart", function (e) { dragFrom = i; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); } catch (_) {} row.style.opacity = ".4"; });
        h.addEventListener("dragend", function () { row.style.opacity = ""; clearInd(); dragFrom = null; });
        row.addEventListener("dragover", function (e) { if (dragFrom == null) return; e.preventDefault(); clearInd(); row.style[(dragFrom < i) ? "borderBottom" : "borderTop"] = "2px solid var(--accent, #5ab7ff)"; });
        row.addEventListener("dragleave", function () { row.style.borderTop = ""; row.style.borderBottom = ""; });
        row.addEventListener("drop", function (e) {
          e.preventDefault(); clearInd(); var from = dragFrom; dragFrom = null; if (from == null || from === i) return;
          var mv = m.cells.splice(from, 1)[0], ti = m.cells.indexOf(c); m.cells.splice(ti + (from < i ? 1 : 0), 0, mv);
          self._matrixSave(); self.renderMatrixPanel(); self.render();
        });
        list.appendChild(row);
      });
      // equivalência de nomes: dimensões dos arquivos que NÃO existem com esse nome no modelo aberto
      var alh = host.querySelector("[data-alias]"), modelNames = this.dims().map(function (d) { return d.name; });
      if (alh && m.cells.length && modelNames.length) {
        var lower = {}; modelNames.forEach(function (n) { lower[n.trim().toLowerCase()] = 1; });
        var fnames = []; m.cells.forEach(function (c) { c.dims.forEach(function (d) { var o = d.origName || d.name; if (fnames.indexOf(o) < 0 && !lower[o.trim().toLowerCase()]) fnames.push(o); }); });
        if (fnames.length) {
          alh.innerHTML = '<div class="subgroup-title" style="margin-top:6px">Equivalência de dimensões</div><p class="hint" style="margin:0 0 4px">Nomes dos arquivos que não existem no modelo aberto (ex.: dimensão renomeada). Escolha a dimensão do modelo que corresponde a cada um.</p>';
          fnames.forEach(function (fn) {
            var cur = m.dimAlias[fn] || "", r = document.createElement("div"); r.className = "row"; r.style.cssText = "align-items:center;gap:6px;margin-bottom:4px";
            r.innerHTML = '<span class="mini" style="flex:1;min-width:0">' + P.escapeHtml(fn) + ' →</span><select class="mini" style="flex:1;min-width:0"><option value="">(manter «' + P.escapeHtml(fn) + '»)</option>' +
              modelNames.map(function (n) { return '<option value="' + P.escapeHtml(n) + '"' + (cur === n ? " selected" : "") + '>' + P.escapeHtml(n) + '</option>'; }).join("") + '</select>' +
              (m.dimAliasAuto[fn] && cur ? '<span class="hint" style="flex:0 0 auto" title="Pareado automaticamente (único nome sem par de cada lado)">auto</span>' : '');
            r.querySelector("select").addEventListener("change", function () {
              m.dimAlias[fn] = this.value; delete m.dimAliasAuto[fn];
              self._applyDimAlias(); self._tmCache = null; self._matrixSave(); self.renderMatrixPanel(); self.render();
            });
            alh.appendChild(r);
          });
        }
      }
      // cores por dimensão (nome): seletor + «auto» (volta ao padrão projeto aberto → arquivo → paleta)
      var dch = host.querySelector("[data-dimcolors]");
      this._matrixDimInfo().forEach(function (o) {
        var r = document.createElement("div"); r.className = "row"; r.style.cssText = "align-items:center;gap:6px;margin-bottom:4px";
        var cp = P.colorPicker(o.cor, function (hex) { m.dimColors[o.name] = hex; self._matrixSave(); self.render(); });
        r.appendChild(cp.el);
        var nm = document.createElement("span"); nm.className = "mini"; nm.style.flex = "1"; nm.textContent = o.name; r.appendChild(nm);
        var au = document.createElement("button"); au.className = "btn sm ghost"; au.textContent = "auto"; au.title = "Voltar à cor padrão desta dimensão"; au.style.flex = "0 0 auto";
        au.addEventListener("click", function () { delete m.dimColors[o.name]; self._matrixSave(); self.renderMatrixPanel(); self.render(); });
        r.appendChild(au); dch.appendChild(r);
      });
    },

    // === FIGURAS MULTI-SESSÃO 2 e 3 (mesmas sessões carregadas na matriz) =========================================
    // Tipos de prática do PROJETO ABERTO, com intervalos por NOME de dimensão (os arquivos têm ids próprios).
    _thesisTypes: function () {
      var self = this, dims = this.dims(), nameOf = {}; dims.forEach(function (d) { nameOf[d.id] = d.name; });
      return (P.Segmenter.categories || []).map(function (c) {
        var iv = {}; Object.keys(c.intervalos || {}).forEach(function (id) { if (nameOf[id]) iv[nameOf[id]] = (c.intervalos[id] || []).slice(); });
        return { id: c.id, nome: c.nome, cor: self._catColor(c), iv: iv };
      });
    },
    // Fonte das sessões: as carregadas na matriz; senão o projeto aberto (1 dataset). Cada uma: {title, dims:[{name,escalaMax,segments}], maxT}.
    _thesisSessions: function () {
      var m = this._matrixLoad(); if (m.cells.length) return m.cells;
      var dims = this.dims(); if (!dims.length) return [];
      var maxT = this.maxTime();
      return [{ title: "Sessão atual", maxT: maxT, dims: dims.map(function (d) { return { name: d.name, escalaMax: P.Segmenter.escalaMaxOf(d), segments: (d.segments || []).filter(function (s) { return isFinite(s.tStart) && isFinite(s.tEnd) && isFinite(parseFloat(s.value)); }).map(function (s) { return { tStart: +s.tStart, tEnd: +s.tEnd, value: parseFloat(s.value) }; }) }; }) }];
    },
    // Sessões usadas pela MÉDIA do radar: as carregadas em «Figuras» (cfg.meanSource "sessions") ou só a atual.
    _meanSessions: function () {
      var m = this._matrixLoad();
      if (this.cfg.meanSource !== "current" && m.cells.length) return m.cells;
      var save = m.cells; m.cells = []; var cur = this._thesisSessions(); m.cells = save; return cur;
    },
    // Nível médio de cada dimensão DURANTE cada tipo: no tempo em que o tipo está ativo (mesma regra de
    // categoryActiveAt), média ponderada pela duração, somando todas as sessões. Guardado como FRAÇÃO da escala
    // (0..1) p/ ser robusto a escalas diferentes entre arquivos. {tipoId: {nomeDim: frac}}
    _typeMeans: function (sessions, types) {
      var acc = {}; types.forEach(function (ty) { acc[ty.id] = {}; });
      sessions.forEach(function (cell) {
        var bs = {}; cell.dims.forEach(function (d) { d.segments.forEach(function (s) { bs[+s.tStart.toFixed(4)] = 1; bs[+s.tEnd.toFixed(4)] = 1; }); });
        var ts = Object.keys(bs).map(Number).sort(function (a, b) { return a - b; });
        var byName = {}; cell.dims.forEach(function (d) { byName[d.name] = d; });
        function scoreAt(d, t) { var segs = d.segments; for (var i = 0; i < segs.length; i++) if (t >= segs[i].tStart && t < segs[i].tEnd) return segs[i].value; return null; }
        for (var i = 0; i < ts.length - 1; i++) {
          var a = ts[i], b = ts[i + 1], dur = b - a; if (dur <= 1e-6) continue;
          var mid = (a + b) / 2;
          types.forEach(function (ty) {
            var names = Object.keys(ty.iv), any = false, ok = true;
            for (var k = 0; k < names.length; k++) { var d = byName[names[k]]; if (!d) continue; any = true; var sc = scoreAt(d, mid), iv = ty.iv[names[k]]; if (sc == null || sc < iv[0] || sc > iv[1]) { ok = false; break; } }
            if (!(any && ok)) return;
            cell.dims.forEach(function (d) {
              var sc2 = scoreAt(d, mid); if (sc2 == null) return;
              var nd = d.escalaMax || 5, f = nd > 1 ? (sc2 - 1) / (nd - 1) : 0;
              var A = acc[ty.id][d.name] = acc[ty.id][d.name] || { w: 0, s: 0 }; A.w += dur; A.s += dur * f;
            });
          });
        }
      });
      var out = {}; Object.keys(acc).forEach(function (id) { out[id] = {}; Object.keys(acc[id]).forEach(function (n) { if (acc[id][n].w > 0) out[id][n] = acc[id][n].s / acc[id][n].w; }); });
      return out;
    },
    // Cache das médias por tipo (o radar redesenha a cada quadro); a assinatura muda com sessões/tipos/dados.
    _typeMeansCached: function () {
      var sessions = this._meanSessions(), types = this._thesisTypes();
      var sig = this.cfg.meanSource + "#" + sessions.map(function (c) { var n = 0, ck = 0; c.dims.forEach(function (d) { n += d.segments.length; d.segments.forEach(function (sg, k) { ck = (ck * 31 + (+sg.value || 0) * 1009 + Math.round((+sg.tStart || 0) * 10) + k) % 1000000007; }); });   /* checksum dos escores/tempos: editar um valor invalida o cache */ return (c.id || "cur") + ":" + n + ":" + ck + ":" + Math.round(c.maxT || 0) + ":" + c.dims.map(function (d) { return d.name; }).join("/"); }).join(",") + "#" + JSON.stringify(types.map(function (t) { return [t.id, t.iv]; }));
      if (this._tmCache && this._tmCache.sig === sig) return this._tmCache.val;
      var val = this._typeMeans(sessions, types); this._tmCache = { sig: sig, val: val }; return val;
    },
    // Fração do tempo da sessão em cada tipo: partição do tempo pelas trocas de todas as dimensões; no ponto médio de
    // cada trecho, um tipo está ativo se TODAS as dimensões que ele restringe (e existem na sessão) estão no intervalo
    // (regra de Segmenter.categoryActiveAt). Tempo com 2+ tipos ativos é DIVIDIDO igualmente; sem tipo → "none".
    _cellTypeShares: function (cell, types) {
      var bs = {}; cell.dims.forEach(function (d) { d.segments.forEach(function (s) { bs[+s.tStart.toFixed(4)] = 1; bs[+s.tEnd.toFixed(4)] = 1; }); });
      var ts = Object.keys(bs).map(Number).sort(function (a, b) { return a - b; });
      var byName = {}; cell.dims.forEach(function (d) { byName[d.name] = d; });
      function scoreAt(d, t) { var segs = d.segments; for (var i = 0; i < segs.length; i++) if (t >= segs[i].tStart && t < segs[i].tEnd) return segs[i].value; return null; }
      var tot = {}, none = 0; types.forEach(function (ty) { tot[ty.id] = 0; });
      for (var i = 0; i < ts.length - 1; i++) {
        var a = ts[i], b = ts[i + 1], dur = b - a; if (dur <= 1e-6) continue;
        var mid = (a + b) / 2, act = [];
        types.forEach(function (ty) {
          var names = Object.keys(ty.iv), any = false, ok = true;
          for (var k = 0; k < names.length; k++) { var d = byName[names[k]]; if (!d) continue; any = true; var sc = scoreAt(d, mid), iv = ty.iv[names[k]]; if (sc == null || sc < iv[0] || sc > iv[1]) { ok = false; break; } }
          if (any && ok) act.push(ty.id);
        });
        if (!act.length) none += dur; else act.forEach(function (id) { tot[id] += dur / act.length; });
      }
      var total = Math.max(1e-9, cell.maxT || ts[ts.length - 1] || 0);
      return { total: total, none: none, shares: tot };
    },
    // Controles da faixa em anel / nível médio por tipo (cfg do RADAR; usados na Aparência e nas Figuras).
    _radarTypeCtlsHtml: function () {
      var c = this.cfg, nS = this._matrixLoad().cells.length;
      function sel(k, opts) { return '<select data-rk="' + k + '" style="width:100%">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (c[k] === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select>'; }
      function cb(k, label, on) { return '<label class="row" style="margin:4px 0"><input type="checkbox" data-rk="' + k + '"' + (on ? " checked" : "") + ' style="flex:0 0 auto"> <span style="flex:1">' + label + '</span></label>'; }
      return '<div class="field"><label>Faixa do tipo</label>' + sel("bandStyle", [["lines", "Barra em cada eixo"], ["ring", "Anel (miolo vazado)"]]) + '</div>' +
        cb("showTypeMean", "Linha do nível médio de cada tipo", !!c.showTypeMean) +
        '<div class="row" style="gap:8px;align-items:flex-end"><div class="field" style="flex:1;margin:0"><label>Média calculada em</label>' + sel("meanSource", [["sessions", "Sessões carregadas (Figuras" + (nS ? ": " + nS : ": nenhuma → atual") + ")"], ["current", "Só a sessão atual"]]) + '</div>' +
        '<div class="field" style="flex:0 0 74px;margin:0"><label>Espessura</label><input type="number" data-rk="meanWidth" min="0.5" max="6" step="0.5" value="' + (c.meanWidth || 2.5) + '"></div>' +
        '<span data-rk-color="meanColor" style="flex:0 0 auto;margin-bottom:4px" title="cor da linha média"></span></div>' +
        '<div data-rk-statepoly' + (c.bandStyle === "ring" ? ' style="opacity:.5;pointer-events:none" title="No modo anel a figura mostra só as extremidades do tipo"' : '') + '>' +
        cb("statePoly", "Figura de tipos: mostrar o polígono do nível médio do tipo (só no modo barra; no anel ficam só as extremidades)", c.statePoly !== false) + '</div>' +
        cb("figLegend", "Figura de tipos: legenda no rodapé (quando anel/média ligados)", c.figLegend !== false) +
        '<div class="field"><label>Legenda da faixa</label><input type="text" data-rk="legBandText" value="' + P.escapeHtml(c.legBandText || "") + '"></div>' +
        '<div class="field"><label>Legenda da média</label><input type="text" data-rk="legMeanText" value="' + P.escapeHtml(c.legMeanText || "") + '"></div>' +
        '<p class="hint" style="margin:2px 0 0">Média = nível de cada dimensão SÓ no tempo em que o tipo está ativo, ponderado pela duração, somando as sessões.</p>';
    },
    _wireRadarTypeCtls: function (host) {
      var self = this, c = this.cfg;
      function apply() { self._tmCache = null; self._saveCfg(); self.render(); }
      Array.prototype.forEach.call(host.querySelectorAll("[data-rk]"), function (el) {
        var k = el.dataset.rk;
        if (el.type === "checkbox") el.addEventListener("change", function () { c[k] = el.checked; apply(); });
        else if (el.tagName === "SELECT") el.addEventListener("change", function () {
          c[k] = el.value;
          if (k === "bandStyle") Array.prototype.forEach.call(document.querySelectorAll("[data-rk-statepoly]"), function (w) {
            var ring = el.value === "ring"; w.style.opacity = ring ? ".5" : ""; w.style.pointerEvents = ring ? "none" : ""; w.title = ring ? "No modo anel a figura mostra só as extremidades do tipo" : "";
          });
          apply();
        });
        else if (el.type === "number") el.addEventListener("change", function () { var v = +el.value; if (v > 0) { c[k] = v; apply(); } });
        else el.addEventListener("input", function () { c[k] = el.value; self._saveCfg(); self.render(); });
      });
      Array.prototype.forEach.call(host.querySelectorAll("[data-rk-color]"), function (span) {
        var k = span.dataset.rkColor, cp = P.colorPicker(c[k] || "#000000", function (hex) { c[k] = hex; self._saveCfg(); self.render(); });
        span.appendChild(cp.el);
      });
    },
    // «Radar por tipo» das Figuras = a FIGURA DE TIPOS existente (mesmo radar, mesma aparência/presets/formatação:
    // ordem, seleção, colunas, título, estatísticas), agora com faixa em anel e média por tipo se ligados.
    _buildRadarFigSvg: function () {
      if (!this._radar) return null;
      var m = this._matrixLoad(), all = P.Segmenter.categories || [], byId = {};
      all.forEach(function (c) { byId[c.id] = c; });
      var order = (m.rOrder || []).filter(function (id) { return byId[id]; });
      all.forEach(function (c) { if (order.indexOf(c.id) < 0) order.push(c.id); });   // tipos novos entram no fim
      var cats = order.filter(function (id) { return !m.rSel || m.rSel.indexOf(id) >= 0; }).map(function (id) { return byId[id]; });
      if (!cats.length) return null;
      return this._buildStatesGridSvg(cats, { cols: m.rCols, size: m.rSize, gapX: m.rGapX, gapY: m.rGapY, margin: m.rMargin, titles: m.rTitles, titleSize: m.rTitleSize, stats: m.rStats });
    },
    // Figura de tipos em GRADE (matriz): cada radar congelado no tipo é MEDIDO (bbox do conteúdo, sem o fundo
    // branco) e encaixado numa célula quadrada de `size` px — sem o espaço morto do viewBox 440×340 —, com
    // colunas, espaçamentos, margem, títulos e estatísticas opcionais.
    _buildStatesGridSvg: function (cats, o) {
      var self = this, cfg = this.cfg, NS = SVGNS;
      var cols = Math.max(1, Math.min(cats.length, o.cols | 0 || 2)), rows = Math.ceil(cats.length / cols);
      var size = +o.size || 320, gx = +o.gapX >= 0 ? +o.gapX : 20, gy = +o.gapY >= 0 ? +o.gapY : 16, mg = +o.margin >= 0 ? +o.margin : 12;
      var tfs = +o.titleSize || 16, titleH = o.titles !== false ? tfs + 12 : 0;
      var statLines = o.stats ? cats.map(function (c) { return self._statLines(c); }) : cats.map(function () { return []; });
      var statsH = statLines.reduce(function (mx, l) { return Math.max(mx, l.length); }, 0); statsH = statsH ? statsH * 15 + 8 : 0;
      var withLeg = cfg.figLegend !== false && (cfg.bandStyle === "ring" || cfg.showTypeMean), legH = withLeg ? 36 : 0;
      var W = 2 * mg + cols * size + (cols - 1) * gx, H = 2 * mg + rows * (titleH + size + statsH) + (rows - 1) * gy + legH;
      var txt = "#14181d", dim = "#586b7b";
      function mk(tag, at) { var e = document.createElementNS(NS, tag); for (var k in at) e.setAttribute(k, at[k]); return e; }
      var out = mk("svg", { viewBox: "0 0 " + W + " " + H });
      if (cfg.figFont) out.setAttribute("style", "font-family:" + cfg.figFont);
      out.appendChild(mk("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));
      var meas = document.createElement("div"); meas.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden"; document.body.appendChild(meas);
      try {
        cats.forEach(function (cat, i) {
          var r = Math.floor(i / cols), c = i % cols, x0 = mg + c * (size + gx), y0 = mg + r * (titleH + size + statsH + gy);
          if (titleH) { var t = mk("text", { x: x0 + size / 2, y: y0 + tfs, "font-size": tfs, "font-weight": 700, fill: txt, "text-anchor": "middle" }); t.textContent = cat.nome; out.appendChild(t); }
          var rsvg = self._stateSvg(self._catStateScores(cat), cat); self._uniquifyIds(rsvg, "_g" + i);
          meas.appendChild(rsvg);
          var vb = (rsvg.getAttribute("viewBox") || "0 0 440 340").split(/\s+/).map(Number), bx = Infinity, by = Infinity, bx2 = -Infinity, by2 = -Infinity;
          Array.prototype.forEach.call(rsvg.children, function (ch) {
            var tag = ch.tagName.toLowerCase(); if (tag === "defs" || tag === "style" || tag === "title") return;
            if (tag === "rect" && +ch.getAttribute("width") >= vb[2] * 0.98 && +ch.getAttribute("height") >= vb[3] * 0.98) return;   // fundo branco
            var b; try { b = ch.getBBox(); } catch (e) { return; }
            if (!b || (!b.width && !b.height)) return;
            bx = Math.min(bx, b.x); by = Math.min(by, b.y); bx2 = Math.max(bx2, b.x + b.width); by2 = Math.max(by2, b.y + b.height);
          });
          if (!isFinite(bx)) { bx = vb[0]; by = vb[1]; bx2 = vb[0] + vb[2]; by2 = vb[1] + vb[3]; }
          var bw = bx2 - bx, bh = by2 - by, s = size / Math.max(bw, bh);
          var ox = x0 + (size - bw * s) / 2, oy = y0 + titleH + (size - bh * s) / 2;
          var g = mk("g", { transform: "translate(" + ox.toFixed(2) + "," + oy.toFixed(2) + ") scale(" + s.toFixed(4) + ") translate(" + (-bx).toFixed(2) + "," + (-by).toFixed(2) + ")" });
          while (rsvg.firstChild) {
            var ch2 = rsvg.firstChild;
            if (ch2.tagName && ch2.tagName.toLowerCase() === "rect" && +ch2.getAttribute("width") >= vb[2] * 0.98 && +ch2.getAttribute("height") >= vb[3] * 0.98) { rsvg.removeChild(ch2); continue; }
            g.appendChild(ch2);
          }
          meas.removeChild(rsvg); out.appendChild(g);
          statLines[i].forEach(function (ln, li) { var s2 = mk("text", { x: x0 + 8, y: y0 + titleH + size + 14 + li * 15, "font-size": 12, fill: li === 0 ? txt : dim }); s2.textContent = ln; out.appendChild(s2); });
        });
      } finally { document.body.removeChild(meas); }
      if (withLeg) {
        var fs = 13, ly = H - legH / 2 + 2, items = [{ kind: "band", label: cfg.legBandText || "Faixa de níveis que define o tipo" }];
        if (cfg.showTypeMean) { var nS = this._meanSessions().length; items.push({ kind: "mean", label: (cfg.legMeanText || "Nível médio observado") + (nS > 1 ? " nas " + nS + " sessões" : " na sessão") }); }
        var tw = 0; items.forEach(function (it) { it.w = 40 + 8 + it.label.length * fs * 0.55 + 36; tw += it.w; });
        var lx = (W - tw) / 2, mcol = this._bw(cfg.meanColor || "#000000"), mw = +cfg.meanWidth || 2.5;
        items.forEach(function (it) {
          if (it.kind === "band") out.appendChild(mk("rect", { x: lx + 4, y: ly - 8, width: 32, height: 14, fill: "#b8b8b8", opacity: 0.7 }));
          else { out.appendChild(mk("line", { x1: lx, y1: ly - 1, x2: lx + 40, y2: ly - 1, stroke: mcol, "stroke-width": mw })); out.appendChild(mk("circle", { cx: lx + 20, cy: ly - 1, r: mw * 1.7, fill: mcol })); }
          var t2 = mk("text", { x: lx + 48, y: ly + 4, "font-size": fs, fill: txt }); t2.textContent = it.label; out.appendChild(t2);
          lx += it.w;
        });
      }
      return out;
    },
    _buildFigure2Svg: function () {
      var m = this._matrixLoad();
      return m.figType === "radar" ? this._buildRadarFigSvg() : m.figType === "bars" ? this._buildBarsSvg() : this._buildMatrixSvg();
    },
    // Barras horizontais empilhadas: % do tempo de cada sessão em cada tipo de prática (uma barra por sessão).
    _buildBarsSvg: function () {
      var self = this, m = this._matrixLoad(), types = this._thesisTypes(), sessions = this._thesisSessions();
      if (!types.length || !sessions.length) return null;
      var fs = m.fontSize || 12, rowH = m.barsRowH, W = m.barsW, labW = 170, padR = 20, padT = 12, axisH = 46, legH = 40, barH = Math.max(6, rowH * 0.72);
      var plotW = W - labW - padR, H = padT + sessions.length * rowH + axisH + legH;
      var NS = SVGNS, svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", "100%"); svg.setAttribute("font-family", m.font);
      var TXT = "#222222", AX = "#444444";
      function mk(tag, at, parent) { var e = document.createElementNS(NS, tag); for (var k in at) e.setAttribute(k, at[k]); (parent || svg).appendChild(e); return e; }
      function text(x, y, s, at, parent) { var a = { x: x, y: y, fill: TXT, "font-size": fs }; for (var k in at) a[k] = at[k]; var e = mk("text", a, parent); e.textContent = s; return e; }
      var x0 = labW, xOf = function (p) { return x0 + p / 100 * plotW; };
      var anyNone = false;
      sessions.forEach(function (c, i) {
        var sh = self._cellTypeShares(c, types), y = padT + i * rowH, yb = y + (rowH - barH) / 2, acc = 0;
        var lines = String(c.title || "").split(/\s*\|\s*|\n/);   // «Nome | sessão 1» → 2 linhas
        lines.forEach(function (ln, li) { text(x0 - 10, y + rowH / 2 + (li - (lines.length - 1) / 2) * (fs + 2) + fs * 0.35, ln, { "text-anchor": "end" }); });
        function seg(pct, cor, label) {
          if (pct <= 0) return; var xa = xOf(acc), xb = xOf(acc + pct); acc += pct;
          mk("rect", { x: xa, y: yb, width: Math.max(0, xb - xa), height: barH, fill: cor });
          if (m.barsShowVals && pct >= 4) text((xa + xb) / 2, yb + barH / 2 + fs * 0.35, String(Math.round(pct)), { "text-anchor": "middle", "font-size": fs });
        }
        types.forEach(function (ty) { seg(sh.shares[ty.id] / sh.total * 100, ty.cor); });
        if (m.barsIncludeNone && sh.none > 0) { anyNone = true; seg(sh.none / sh.total * 100, "#bbbbbb"); }
      });
      var yAx = padT + sessions.length * rowH + 4;
      mk("line", { x1: x0, y1: padT - 4, x2: x0, y2: yAx, stroke: AX, "stroke-width": 1 });
      mk("line", { x1: x0, y1: yAx, x2: x0 + plotW, y2: yAx, stroke: AX, "stroke-width": 1 });
      for (var p = 0; p <= 100; p += 20) { var xx = xOf(p); mk("line", { x1: xx, y1: yAx, x2: xx, y2: yAx + 5, stroke: AX, "stroke-width": 1 }); text(xx, yAx + 6 + fs, String(p), { "text-anchor": "middle", "font-size": fs - 1 }); }
      text(x0 + plotW / 2, yAx + axisH - 6, m.barsXTitle, { "text-anchor": "middle", "font-size": fs + 1 });
      var items = types.map(function (t) { return { name: t.nome, cor: t.cor }; }); if (anyNone && m.barsLegendNone !== false) items.push({ name: "Sem tipo", cor: "#bbbbbb" });
      var ly = H - legH / 2 + 4, tw = 0; items.forEach(function (it) { it.w = 26 + 8 + it.name.length * fs * 0.55 + 22; tw += it.w; });
      var lx = (W - tw) / 2; items.forEach(function (it) { mk("rect", { x: lx, y: ly - 9, width: 26, height: 14, fill: it.cor }); text(lx + 34, ly + fs * 0.35, it.name, {}); lx += it.w; });
      return svg;
    },

    _stepPlot: function (t, maxT, W, opts) {
      var n = P.Segmenter.escalaMaxOf(t);
      var padL = 44, padR = 14, padT = 10, padB = 24;
      var rowPx = (opts && opts.rowPx) || 20;
      var H = 34 + n * rowPx;                           // altura cresce com a escala (rowPx maior = eixo grande, ex.: modo de codificação)
      var cor = this._bw(t.cor || "#4f9df5");
      var plotW = W - padL - padR, plotH = H - padT - padB;
      // Janela de visualização (zoom por Ctrl+scroll, como na aba Segmentar): mostra [vStart, vStart+vSpan] de [0,maxT].
      var vSpan = (this._view && this._view.span) ? Math.min(this._view.span, maxT || 1) : (maxT || 1);
      var vStart = Math.max(0, Math.min((this._view && this._view.start) || 0, Math.max(0, (maxT || 1) - vSpan)));
      var vEnd = vStart + vSpan;
      var inV = function (px) { return px >= padL - 0.5 && px <= W - padR + 0.5; };
      var x = function (tt) { return padL + (vSpan > 0 ? (tt - vStart) / vSpan : 0) * plotW; };
      var y = function (sc) { return padT + (n > 1 ? (n - sc) / (n - 1) : 0.5) * plotH; };  // escore alto no topo
      var svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("width", "100%"); svg.setAttribute("height", H);
      svg.style.display = "block";

      function line(x1, y1, x2, y2, stroke, w, dash) {
        var l = document.createElementNS(SVGNS, "line");
        l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2);
        l.setAttribute("stroke", stroke); l.setAttribute("stroke-width", w || 1);
        if (dash) l.setAttribute("stroke-dasharray", dash);
        svg.appendChild(l); return l;
      }
      function txt(xx, yy, s, anchor, cls) {
        var e = document.createElementNS(SVGNS, "text");
        e.setAttribute("x", xx); e.setAttribute("y", yy); e.setAttribute("font-size", 10);
        e.setAttribute("fill", "var(--txt-dim)"); if (anchor) e.setAttribute("text-anchor", anchor);
        e.textContent = s; svg.appendChild(e); return e;
      }

      // bandas de estágio (reusa os estágios do módulo Gráfico), ao fundo, alinhadas no tempo
      if (this._showStageBands) {
        var _bands = this._stageBands(), _op = (P.GCP && P.GCP.cfg && isFinite(P.GCP.cfg.stageTintOpacity)) ? P.GCP.cfg.stageTintOpacity : 0.14;
        _bands.forEach(function (bd) {
          var bx0 = x(Math.max(vStart, bd.t0)), bx1 = x(Math.min(vEnd, bd.t1));
          bx0 = Math.max(padL, bx0); bx1 = Math.min(W - padR, bx1);
          if (bx1 - bx0 < 0.5) return;   // fora da janela ou largura desprezível
          var r = document.createElementNS(SVGNS, "rect");
          r.setAttribute("x", bx0); r.setAttribute("y", padT); r.setAttribute("width", bx1 - bx0); r.setAttribute("height", Math.max(0, plotH));
          r.setAttribute("fill", bd.tint); r.setAttribute("opacity", _op); r.setAttribute("pointer-events", "none");
          var tl = document.createElementNS(SVGNS, "title"); tl.textContent = bd.name || "Estágio"; r.appendChild(tl);
          svg.appendChild(r);
        });
      }

      // faixas por tipo de prática (onde cada tipo acontece); 2+ tipos no mesmo trecho viram rachura (modo configurável)
      if (this._showTypeBands) {
        var selfTB = this, opTB = isFinite(this.cfg.typeBandOpacity) ? this.cfg.typeBandOpacity : 0.18, ovMode = this.cfg.typeOverlapMode || "hatch";
        this._typeRuns().forEach(function (run) {
          var bx0 = x(Math.max(vStart, run.t0)), bx1 = x(Math.min(vEnd, run.t1));
          bx0 = Math.max(padL, bx0); bx1 = Math.min(W - padR, bx1);
          if (bx1 - bx0 < 0.5) return;
          var bw = bx1 - bx0, names = run.cats.map(function (c) { return c.nome; }).join(" + ");
          function rect(y0, hh, fill, op) {
            var r = document.createElementNS(SVGNS, "rect");
            r.setAttribute("x", bx0); r.setAttribute("y", y0); r.setAttribute("width", bw); r.setAttribute("height", Math.max(0, hh));
            r.setAttribute("fill", fill); r.setAttribute("opacity", op); r.setAttribute("pointer-events", "none");
            var tl = document.createElementNS(SVGNS, "title"); tl.textContent = names + (run.cats.length > 1 ? " (sobreposição)" : ""); r.appendChild(tl); svg.appendChild(r);
          }
          if (run.cats.length === 1) { rect(padT, plotH, selfTB._catColor(run.cats[0]), opTB); return; }
          if (ovMode === "split") {
            var hh = plotH / run.cats.length;
            run.cats.forEach(function (c, i) { rect(padT + i * hh, hh, selfTB._catColor(c), opTB); });
          } else if (ovMode === "highlight") {
            rect(padT, plotH, selfTB._hatchPattern(svg, "hl", ["#e8636b"]), Math.min(1, opTB + 0.28));
          } else if (ovMode === "neutral") {
            rect(padT, plotH, selfTB._hatchPattern(svg, "hn", ["#8899aa"]), Math.min(1, opTB + 0.14));
          } else {   // hatch (default): rachura com as cores dos tipos
            var cols = run.cats.map(function (c) { return selfTB._catColor(c); });
            rect(padT, plotH, selfTB._hatchPattern(svg, "hm_" + run.cats.map(function (c) { return c.id; }).join("_"), cols), Math.min(1, opTB + 0.18));
          }
        });
      }

      // grade horizontal + rótulos de escore
      for (var sc = 1; sc <= n; sc++) {
        var yy = y(sc);
        line(padL, yy, W - padR, yy, "var(--line)", sc === 1 ? 1 : 0.5, sc === 1 ? null : "2 3");
        var voc = (t.vocab || []).filter(function (v) { return v.code === String(sc); })[0];
        var lab = txt(padL - 6, yy + 3, String(sc), "end");
        if (voc && voc.label) { var tt2 = document.createElementNS(SVGNS, "title"); tt2.textContent = sc + ": " + voc.label; lab.appendChild(tt2); }
      }
      // eixo do tempo (ticks)
      var baseY = y(1);
      line(padL, baseY, W - padR, baseY, "var(--txt-dim)", 1);
      var step = this._niceStep(vSpan, plotW);
      for (var tk = Math.ceil(vStart / step) * step; tk <= vEnd + 1e-6; tk += step) {
        var xx = x(tk);
        line(xx, baseY, xx, baseY + 3, "var(--txt-dim)", 1);
        txt(xx, H - 8, P.fmtTime(tk, step < 1), "middle");
      }

      var self = this;
      var xInv = function (px) { return Math.max(0, Math.min(maxT, vStart + Math.max(0, Math.min(1, (px - padL) / plotW)) * vSpan)); };

      // fundo clicável: clicar posiciona a mídia (agulha) e desmarca a troca
      var bg = document.createElementNS(SVGNS, "rect");
      bg.setAttribute("x", padL); bg.setAttribute("y", padT); bg.setAttribute("width", Math.max(0, plotW)); bg.setAttribute("height", Math.max(0, plotH));
      bg.setAttribute("fill", "transparent"); bg.style.cursor = "col-resize";
      // clicar ou arrastar no fundo posiciona a agulha (scrub) - move linhas e radar juntos
      bg.addEventListener("mousedown", function (ev) {
        var rect = svg.getBoundingClientRect();
        self._sel = null; self._selMark = null;
        function seek(clientX) { self.seekT(xInv((clientX - rect.left) / rect.width * W)); }
        seek(ev.clientX);
        function mm(e) { seek(e.clientX); }
        function mu() { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); self.render(); }
        window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
      });
      svg.appendChild(bg);

      // linha em degraus a partir dos segmentos contíguos (value = escore)
      var segs = (t.segments || []).slice().filter(function (s) {
        return isFinite(s.tStart) && isFinite(s.tEnd) && s.value !== "" && isFinite(parseFloat(s.value));
      }).sort(function (a, b) { return a.tStart - b.tStart; });
      var prev = null;   // {tEnd, y, sc}
      segs.forEach(function (s, si) {
        var sc = parseFloat(s.value), x0 = x(s.tStart), x1 = x(s.tEnd), yy = y(sc);
        var atSwitch = inV(x0);   // o degrau começa dentro da janela visível
        // conector vertical se contíguo com o trecho anterior (mesmo instante, escore diferente)
        if (prev && Math.abs(s.tStart - prev.tEnd) < 0.02 && atSwitch) line(x0, prev.y, x0, yy, cor, 2);
        // linha do degrau, recortada à janela (não vaza para as margens)
        var lx0 = Math.max(padL, Math.min(x0, W - padR)), lx1 = Math.max(padL, Math.min(x1, W - padR));
        if (lx1 > lx0 + 0.01) { var seg = line(lx0, yy, lx1, yy, cor, 2.4); seg.setAttribute("stroke-linecap", "round"); }
        prev = { tEnd: s.tEnd, y: yy, sc: sc };
        if (!atSwitch) return;   // fora da janela: sem ponto/alça de arraste
        var selected = self._sel && self._sel.tierId === t.id && self._sel.index === si;
        // alvo de arraste (invisível, maior) + ponto visível no início do degrau
        var hit = document.createElementNS(SVGNS, "circle");
        hit.setAttribute("cx", x0); hit.setAttribute("cy", yy); hit.setAttribute("r", 8);
        hit.setAttribute("fill", "transparent"); hit.style.cursor = "ew-resize";
        hit.addEventListener("mousedown", function (ev) { ev.stopPropagation(); self._startDrag(t, si, svg, x, xInv, ev); });
        svg.appendChild(hit);
        var c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("cx", x0); c.setAttribute("cy", yy); c.setAttribute("r", selected ? 4 : 2.6); c.setAttribute("fill", cor);
        c.setAttribute("pointer-events", "none");
        svg.appendChild(c);
        if (selected) {
          var ring = document.createElementNS(SVGNS, "circle");
          ring.setAttribute("cx", x0); ring.setAttribute("cy", yy); ring.setAttribute("r", 6.5);
          ring.setAttribute("fill", "none"); ring.setAttribute("stroke", "var(--accent, #4f9df5)"); ring.setAttribute("stroke-width", 1.4);
          ring.setAttribute("pointer-events", "none"); svg.appendChild(ring);
          // botão de remover a troca
          var by = Math.max(9, yy - 13), del = document.createElementNS(SVGNS, "g");
          del.style.cursor = "pointer";
          var db = document.createElementNS(SVGNS, "circle");
          db.setAttribute("cx", x0); db.setAttribute("cy", by); db.setAttribute("r", 6); db.setAttribute("fill", "var(--accent-2, #e8636b)");
          del.appendChild(db);
          var dx = document.createElementNS(SVGNS, "path");
          dx.setAttribute("d", "M" + (x0 - 2.4) + " " + (by - 2.4) + " l4.8 4.8 M" + (x0 + 2.4) + " " + (by - 2.4) + " l-4.8 4.8");
          dx.setAttribute("stroke", "#fff"); dx.setAttribute("stroke-width", 1.4); dx.setAttribute("stroke-linecap", "round");
          del.appendChild(dx);
          var tit = document.createElementNS(SVGNS, "title"); tit.textContent = "Remover esta troca (Delete)"; del.appendChild(tit);
          del.addEventListener("mousedown", function (ev) { ev.stopPropagation(); P.Segmenter.dimDeleteSwitch(t, si); self._sel = null; });
          svg.appendChild(del);
        }
      });
      if (!segs.length) txt(padL + 6, padT + plotH / 2, "Sem trocas ainda. Reproduza a mídia e tecle um escore (ou use os botões ao lado).", "start");

      // marcadores de índice (ocorrências pontuais) - diamante sobre o eixo do tempo; tooltip com código + descrição
      if (t.showIndices !== false && t.marks && t.marks.length) {
        var byi = y(1), imap = {}, labelCands = []; (t.indices || []).forEach(function (ix) { imap[ix.code] = ix; });
        t.marks.forEach(function (mk) {
          if (!mk || !isFinite(mk.t) || mk.t < vStart - 1e-6 || mk.t > vEnd + 1e-6) return;
          var mxx = x(mk.t);
          var tick = line(mxx, padT, mxx, byi, cor, 1, "2 3"); tick.setAttribute("opacity", "0.5"); tick.setAttribute("pointer-events", "none");
          var selm = self._selMark && self._selMark.tierId === t.id && Math.abs(self._selMark.t - mk.t) < 1e-6 && self._selMark.code === mk.code;
          var dm = document.createElementNS(SVGNS, "path");
          dm.setAttribute("d", "M" + mxx + " " + (byi - 4) + " l4 4 l-4 4 l-4 -4 z");
          dm.setAttribute("fill", cor); dm.setAttribute("stroke", "var(--panel, #0f1216)"); dm.setAttribute("stroke-width", 0.8);
          dm.setAttribute("pointer-events", "none");
          var ix = imap[mk.code], tt = document.createElementNS(SVGNS, "title");
          tt.textContent = mk.code + (ix && ix.desc ? " - " + ix.desc : "") + " · " + P.fmtTime(mk.t, true) + " · clique para selecionar"; dm.appendChild(tt);
          // alvo de clique (maior que o diamante): SELECIONA (como os escores); o «×» ou Delete remove
          var mhit = document.createElementNS(SVGNS, "circle");
          mhit.setAttribute("cx", mxx); mhit.setAttribute("cy", byi); mhit.setAttribute("r", 7);
          mhit.setAttribute("fill", "transparent"); mhit.style.cursor = "pointer";
          (function (mm) { mhit.addEventListener("mousedown", function (ev) { ev.stopPropagation(); self._sel = null; self._selMark = { tierId: t.id, t: mm.t, code: mm.code }; self.render(); }); })(mk);
          var mtt = document.createElementNS(SVGNS, "title"); mtt.textContent = tt.textContent; mhit.appendChild(mtt);
          svg.appendChild(mhit); svg.appendChild(dm);
          if (selm) {
            var mring = document.createElementNS(SVGNS, "circle");
            mring.setAttribute("cx", mxx); mring.setAttribute("cy", byi); mring.setAttribute("r", 7);
            mring.setAttribute("fill", "none"); mring.setAttribute("stroke", "var(--accent, #4f9df5)"); mring.setAttribute("stroke-width", 1.4);
            mring.setAttribute("pointer-events", "none"); svg.appendChild(mring);
            var mby = Math.max(9, byi - 15), mdel = document.createElementNS(SVGNS, "g"); mdel.style.cursor = "pointer";
            var mdb = document.createElementNS(SVGNS, "circle");
            mdb.setAttribute("cx", mxx); mdb.setAttribute("cy", mby); mdb.setAttribute("r", 6); mdb.setAttribute("fill", "var(--accent-2, #e8636b)");
            mdel.appendChild(mdb);
            var mdx = document.createElementNS(SVGNS, "path");
            mdx.setAttribute("d", "M" + (mxx - 2.4) + " " + (mby - 2.4) + " l4.8 4.8 M" + (mxx + 2.4) + " " + (mby - 2.4) + " l-4.8 4.8");
            mdx.setAttribute("stroke", "#fff"); mdx.setAttribute("stroke-width", 1.4); mdx.setAttribute("stroke-linecap", "round");
            mdel.appendChild(mdx);
            var mtit = document.createElementNS(SVGNS, "title"); mtit.textContent = "Remover este índice (Delete)"; mdel.appendChild(mtit);
            mdel.addEventListener("mousedown", function (ev) { ev.stopPropagation(); self._deleteSelMark(); });
            svg.appendChild(mdel);
          }
          if (self._showIndexLabels && mk.code) labelCands.push({ x: mxx, code: mk.code });
        });
        // rótulos dos índices (opção do usuário): empilham verticalmente quando se sobrepõem no eixo x
        if (self._showIndexLabels && labelCands.length) {
          labelCands.sort(function (a, b) { return a.x - b.x; });
          var rowsRight = [], lh = 9, baseY = byi - 9;
          labelCands.forEach(function (lc) {
            var w = Math.max(10, lc.code.length * 5 + 4), left = lc.x - w / 2, lvl = 0;
            while (rowsRight[lvl] != null && left < rowsRight[lvl] + 2) lvl++;
            rowsRight[lvl] = lc.x + w / 2;
            var lt = document.createElementNS(SVGNS, "text");
            lt.setAttribute("x", lc.x); lt.setAttribute("y", baseY - lvl * lh); lt.setAttribute("text-anchor", "middle");
            lt.setAttribute("font-size", 8); lt.setAttribute("fill", cor); lt.setAttribute("pointer-events", "none");
            lt.textContent = lc.code; svg.appendChild(lt);
          });
        }
      }

      // agulha (somente leitura) - posicionada em _updateNeedle
      var needle = document.createElementNS(SVGNS, "line");
      needle.setAttribute("y1", padT); needle.setAttribute("y2", H - padB);
      needle.setAttribute("stroke", "var(--accent-2, #e8636b)"); needle.setAttribute("stroke-width", 1.5);
      needle.setAttribute("display", "none"); needle.setAttribute("pointer-events", "none");
      svg.appendChild(needle);
      svg._needle = needle; svg._x = x; svg._xInv = xInv; svg._maxT = maxT; svg._padL = padL; svg._W = W; svg._padR = padR;
      svg._viewStart = vStart; svg._viewSpan = vSpan;
      // Zoom/pan como na aba Segmentar: Ctrl+scroll = zoom no cursor, Shift+scroll = deslocar, duplo clique = resetar.
      svg.addEventListener("wheel", function (e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          var rect = svg.getBoundingClientRect(), pxv = (e.clientX - rect.left) / rect.width * W;
          self._zoomView(xInv(pxv), e.deltaY < 0 ? 1 / 1.25 : 1.25, maxT);
        } else if (e.shiftKey) {
          e.preventDefault();
          self._panView((e.deltaY || e.deltaX) * 0.6 * (vSpan / Math.max(1, plotW)), maxT);
        }
      }, { passive: false });
      svg.addEventListener("dblclick", function (e) { e.preventDefault(); self._view = { start: 0, span: null }; self.render(); });
      return svg;
    },
    // Zoom da janela dos gráficos de linha, centrado no tempo tAt; span limitado a [~0.5s, maxT] (fora = reset).
    _zoomView: function (tAt, factor, maxT) {
      maxT = maxT || 1;
      var v = this._view || (this._view = { start: 0, span: null });
      var span = v.span || maxT;
      var newSpan = Math.max(Math.min(maxT, 0.5), Math.min(maxT, span * factor));
      var frac = span > 0 ? (tAt - (v.start || 0)) / span : 0;
      var newStart = tAt - frac * newSpan;
      v.span = (newSpan >= maxT - 1e-6) ? null : newSpan;
      v.start = Math.max(0, Math.min(newStart, Math.max(0, maxT - newSpan)));
      this.render();
    },
    _panView: function (dsec, maxT) {
      maxT = maxT || 1;
      var v = this._view; if (!v || !v.span) return;   // sem zoom não há para onde deslocar
      v.start = Math.max(0, Math.min((v.start || 0) + dsec, Math.max(0, maxT - v.span)));
      this.render();
    },

    // Arrasta uma troca no tempo. rect/W ficam fixos no início (o SVG é
    // reconstruído a cada movimento, mas a geometria do quadro é a mesma).
    _startDrag: function (tier, index, svg, x, xInv, ev) {
      var self = this, rect = svg.getBoundingClientRect(), W = svg._W, moved = false, startX = ev.clientX;
      function toTime(clientX) { var vbX = (clientX - rect.left) / rect.width * W; return xInv(vbX); }
      function mm(e) { if (Math.abs(e.clientX - startX) > 3) moved = true; if (moved) P.Segmenter.dimMoveSwitch(tier, index, toTime(e.clientX)); }
      function mu() {
        window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu);
        if (!moved) { self._sel = { tierId: tier.id, index: index }; self._selMark = null; self.render(); }   // clique = selecionar
        else if (P.Segmenter.commit) P.Segmenter.commit();   // fim do arrasto: um único registro no histórico
      }
      window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
    },

    _niceStep: function (maxT, plotW) {
      var target = maxT * (80 / Math.max(1, plotW));   // ~80px entre marcas
      var steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
      for (var i = 0; i < steps.length; i++) if (steps[i] >= target) return steps[i];
      return steps[steps.length - 1];
    },

    _updateNeedle: function () {
      if (!this._svgs) return;
      var md = P.Segmenter.media;
      // com mídia, a agulha só aparece após carregar; sem mídia, segue o relógio virtual
      var t = md ? Math.max(0, (P.Segmenter.annNow ? P.Segmenter.annNow() : md.currentTime)) : this._t;
      var show = md ? isFinite(md.duration) : (this._t > 0 || this._playing);
      this._svgs.forEach(function (svg) {
        var nd = svg._needle; if (!nd) return;
        var vs = svg._viewStart || 0, vp = svg._viewSpan || svg._maxT || 1;
        if (!show || t == null || t < vs - 1e-6 || t > vs + vp + 1e-6) { nd.setAttribute("display", "none"); return; }
        var xx = svg._x(t);
        nd.setAttribute("x1", xx); nd.setAttribute("x2", xx); nd.setAttribute("display", "block");
      });
    },

    _loop: function () {
      var self = this;
      cancelAnimationFrame(this._raf);
      (function tick(ts) {
        if (!self._shown) return;
        // relógio virtual (só quando não há mídia): avança _t por velocidade × dt
        if (!P.Segmenter.media && self._playing) {
          if (self._lastTs) {
            self._t += (ts - self._lastTs) / 1000 * self._speed;
            if (self._t >= self.maxTime()) { self._t = self.maxTime(); self._playing = false; }
          }
          self._lastTs = ts;
        } else { self._lastTs = ts; }
        // camadas comparativas: cada uma tem seu próprio relógio virtual independente
        var moved = false;
        self._compares.forEach(function (c) {
          if (!c.playing) { c.lastTs = ts; return; }
          var maxc = self._compareMax(c);
          if (c.lastTs) { c.t += (ts - c.lastTs) / 1000 * c.speed; if (c.t >= maxc) { c.t = maxc; c.playing = false; if (c._playBtn) c._playBtn.innerHTML = P.ICON.play; } }
          c.lastTs = ts; moved = true;
          if (c._scrub) c._scrub.value = c.t; if (c._clk) c._clk.textContent = P.fmtTime(c.t, true);
        });
        // acompanhar a reprodução: com zoom, rola a janela dos step-plots para a agulha não sumir (só quando tocando)
        if (self._followPlay && self._isPlaying()) {
          var tt = P.Segmenter.media ? Math.max(0, (P.Segmenter.annNow ? P.Segmenter.annNow() : P.Segmenter.media.currentTime)) : self._t;
          if (self._followNeedle(tt)) self.render();
        }
        self._updateNeedle();
        self._updateRadar();
        if (self._mode === "side" && self._minis && self._minis.length) self._updateMinis();
        self._syncTransportUI();
        self._raf = requestAnimationFrame(tick);
      })(performance.now());
    },

    // --- Fixture de desenvolvimento (NÃO é default; só para testar M1) ----------
    // As 3 dimensões da pesquisa do usuário, com alguns switches sintéticos.
    loadExample: function () {
      var base = this.maxTime();
      var dur = (base > 5 ? base : 60);                 // usa a mídia se houver; senão 60 s
      function switches(scores) {
        // distribui os escores em degraus contíguos ao longo de dur
        var segs = [], k = scores.length, w = dur / k;
        for (var i = 0; i < k; i++) segs.push({ tStart: i * w, tEnd: (i + 1) * w, value: String(scores[i]), note: "" });
        return segs;
      }
      var uid = "mdimx" + Math.floor(this.dims().length + 1);
      var ex = [
        { name: "Reatividade", escalaMax: 5, cor: P.PALETTE_COLOR[0], scores: [1, 3, 2, 4, 5, 3] },
        { name: "Resolutividade", escalaMax: 5, cor: P.PALETTE_COLOR[1], scores: [2, 2, 4, 3, 5, 4] },
        { name: "Desafiabilidade", escalaMax: 4, cor: P.PALETTE_COLOR[3], scores: [1, 2, 3, 3, 2, 4] }
      ];
      var tiers = P.Segmenter.tiers;
      ex.forEach(function (d, di) {
        var vocab = []; for (var i = 1; i <= d.escalaMax; i++) vocab.push({ code: String(i), label: "" });
        tiers.push({
          id: uid + "_" + di, name: d.name, kind: "dimensao",
          escalaMax: d.escalaMax, cor: d.cor, vocab: vocab, activeCat: "1",
          segments: switches(d.scores)
        });
      });
      P.Segmenter.renderTiers && P.Segmenter.renderTiers();
      this.refresh();
    }
  };

  P.Mdim = M;
})(window.Praxis = window.Praxis || {});

