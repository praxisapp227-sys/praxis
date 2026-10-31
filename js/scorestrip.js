/* scorestrip.js - Faixa de partitura alinhada ao eixo de compasso do GCP.
   Renderiza a peça carregada (P.Score) em UM sistema (Verovio), mede cada compasso
   (getBBox) e remapeia cada compasso para o slot [xOf(m), xOf(m+1)] do GCP. O cache
   é por (peça + escala + pauta); compose() é SÍNCRONO (usa o cache), então a faixa
   entra na figura do GCP e sai junto na exportação (PNG/JPG/SVG).
   Verovio usa <use> apontando p/ glifos no <defs>: ao clonar compassos, levamos
   o <defs> e os <style> juntos, senão as notas não pintam (nem na tela nem no export). */
(function (P) {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";

  var ST = {
    _cache: null,   // { sig, measures:{ord:{node,x,w}}, staffTop, staffH, heads:[nodes], ok }
    _busy: false,
    _tk: null,

    available: function () { return !!(P.Score && P.Score.ready && P.Score._raw); },
    ready: function () { return !!(this._cache && this._cache.ok); },

    _sig: function (opts) {
      var s = P.Score, raw = s && s._raw;
      return [s ? s.name : "", raw ? (raw.kind + ":" + ((raw.data || "").length || 0)) : "", opts.scale, opts.staff, opts.mnum ? 1 : 0].join("|");
    },

    // Assíncrono: renderiza a peça num sistema e mede cada compasso. cb(ok).
    prepare: function (opts, cb) {
      var self = this; opts = opts || {};
      if (!this.available()) { this._cache = null; if (cb) cb(false); return; }
      var sig = this._sig(opts);
      if (this._cache && this._cache.sig === sig && this._cache.ok) { if (cb) cb(true); return; }
      if (this._busy) { if (cb) cb(false); return; }
      this._busy = true;
      Promise.resolve().then(function () { return P.Score.ensureVerovio ? P.Score.ensureVerovio() : null; }).then(function () {
        try {
          if (!self._tk) self._tk = new verovio.toolkit();
          var tk = self._tk, scale = opts.scale || 40;
          tk.setOptions({
            font: "Leland", scale: scale, breaks: "none",
            pageWidth: 60000, pageHeight: 60000, adjustPageHeight: true,
            pageMarginTop: 6, pageMarginBottom: 6, pageMarginLeft: 10, pageMarginRight: 10,
            header: "none", footer: "none", svgViewBox: true,
            mnumInterval: opts.mnum ? 1 : 0
          });
          var raw = P.Score._raw;
          if (raw.kind === "zip") tk.loadZipDataBase64(raw.data);
          else tk.loadData(P.Score._dataForRender ? P.Score._dataForRender() : raw.data);
          var svgStr = tk.renderToSVG(1).replace(/font-family="Times, serif"/g, 'font-family="Edwin, Times, serif"');
          var holder = document.createElement("div");
          holder.style.cssText = "position:absolute;left:-99999px;top:0;width:6000px;height:1200px;overflow:hidden";
          holder.innerHTML = svgStr;
          document.body.appendChild(holder);
          var svg = holder.querySelector("svg");
          // cabeçalhos que os <use> precisam (defs + styles com @font-face)
          var heads = [];
          Array.prototype.forEach.call(svg.querySelectorAll(":scope > defs, :scope > style, defs"), function (n) { heads.push(n.cloneNode(true)); });
          var measures = {}, staffTop = Infinity, staffBot = -Infinity, count = 0, staffLineYs = [];
          var clefs = {}, keySigs = {}, meterSigs = {};   // clave/armadura/fórmula POR compasso (topo) p/ a abertura EFETIVA de cada estágio (trata mudança de clave/armadura/fórmula no meio)
          var firstM = svg.querySelector("g.measure");
          if (firstM) {   // Ys das linhas do pentagrama (do 1º compasso), p/ o pentagrama contínuo
            Array.prototype.forEach.call(firstM.querySelectorAll("g.staff"), function (stv, si) {
              if (opts.staff === "top" && si > 0) return;
              Array.prototype.forEach.call(stv.children, function (ch) {
                if (ch.tagName && ch.tagName.toLowerCase() === "path") {
                  var mm = (ch.getAttribute("d") || "").match(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s+L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/);
                  if (mm && Math.abs(+mm[2] - +mm[4]) < 1 && Math.abs(+mm[3] - +mm[1]) > 50) staffLineYs.push(+mm[2]);
                }
              });
            });
          }
          Array.prototype.forEach.call(svg.querySelectorAll("g.measure"), function (g, i) {
            if (opts.staff === "top") {
              var staves = g.querySelectorAll("g.staff");
              Array.prototype.forEach.call(staves, function (stv, si) { if (si > 0 && stv.parentNode) stv.parentNode.removeChild(stv); });
            }
            var stv0 = g.querySelector("g.staff");
            if (stv0) {
              function cap(cls, map) { var el = stv0.querySelector("g." + cls); if (!el) return; var b; try { b = el.getBBox(); } catch (e) { return; } if (b && b.width > 0) map[i + 1] = { node: el.cloneNode(true), x: b.x, w: b.width }; }
              cap("clef", clefs); cap("keySig", keySigs); cap("meterSig", meterSigs);   // capturados ANTES de clonar (o 1º compasso visível é limpo em buildG)
            }
            var bb; try { bb = g.getBBox(); } catch (e) { return; }
            if (!bb || !(bb.width > 0)) return;
            measures[i + 1] = { node: g.cloneNode(true), x: bb.x, w: bb.width };
            if (bb.y < staffTop) staffTop = bb.y;
            if (bb.y + bb.height > staffBot) staffBot = bb.y + bb.height;
            count++;
          });
          document.body.removeChild(holder);
          if (!count || !isFinite(staffTop)) { self._cache = { sig: sig, ok: false }; self._busy = false; if (cb) cb(false); return; }
          // Barras/repetições/voltas de cada compasso, do MusicXML (só kind xml).
          var barStyles = {}, repeats = {}, voltas = [], _open = {};
          try {
            if (raw.kind === "xml") {
              var xdoc = new DOMParser().parseFromString(raw.data, "application/xml"), part = xdoc.querySelector("part");
              if (part) Array.prototype.forEach.call(part.querySelectorAll("measure"), function (me, i) {
                var ord = i + 1;
                Array.prototype.forEach.call(me.querySelectorAll("barline"), function (bl) {
                  var loc = bl.getAttribute("location") || "right";
                  var bs = bl.querySelector("bar-style"); if (loc === "right" && bs) barStyles[ord] = (bs.textContent || "").trim();
                  var rep = bl.querySelector("repeat");
                  if (rep) { if (!repeats[ord]) repeats[ord] = {}; var dir = rep.getAttribute("direction"); if (dir === "forward") repeats[ord].fwd = true; if (dir === "backward") repeats[ord].bwd = true; }
                  var end = bl.querySelector("ending");
                  if (end) {
                    var num = end.getAttribute("number") || "", ty2 = end.getAttribute("type") || "";
                    if (ty2 === "start") _open[num] = { number: num, from: ord };
                    else if ((ty2 === "stop" || ty2 === "discontinue") && _open[num]) { _open[num].to = ord; _open[num].closed = (ty2 === "stop"); voltas.push(_open[num]); delete _open[num]; }
                  }
                });
              });
              Object.keys(_open).forEach(function (k) { _open[k].to = _open[k].from; voltas.push(_open[k]); });   // volta sem fim explícito
            }
          } catch (e) {}
          self._cache = { sig: sig, measures: measures, staffTop: staffTop, staffH: Math.max(1, staffBot - staffTop), staffLineYs: staffLineYs,
            clefs: clefs, keySigs: keySigs, meterSigs: meterSigs,
            barStyles: barStyles, repeats: repeats, voltas: voltas, heads: heads, ok: true };
          self._busy = false; if (cb) cb(true);
        } catch (e) { self._cache = { sig: sig, ok: false }; self._busy = false; if (cb) cb(false); }
      }, function () { self._busy = false; if (cb) cb(false); });
    },

    // Constrói o <g> da faixa no espaço de coordenadas do GCP (geom), compassos mMin..mMax.
    // Escala UNIFORME (sx=sy) → notas com tamanho constante, sem distorção; as notas ficam
    // alinhadas à esquerda de cada slot e NÓS desenhamos o pentagrama contínuo + as barras
    // de compasso exatamente na grade do GCP (a "largura do compasso" vira o slot).
    // Escala UNIFORME p/ a faixa: cabe na altura pedida, mas limitada p/ o compasso mais largo
    // não vazar do slot (mantém tamanho constante das notas). 0 se não houver cache.
    _scaleFor: function (geom, reqHeight) {
      var c = this._cache; if (!c || !c.ok || !geom) return 0;
      function xOf(m) { return geom.Ml + (m - geom.mMin) / (geom.mMax - geom.mMin) * geom.pw; }
      var slotW = xOf(2) - xOf(1);
      var fromM = Math.max(1, Math.floor(geom.mMin + 1e-6)), toM = Math.ceil(geom.mMax - 1e-6) - 1, maxW = 0, m;
      for (m = fromM; m <= toM; m++) { if (c.measures[m] && c.measures[m].w > maxW) maxW = c.measures[m].w; }
      var sFit = (reqHeight || 90) / c.staffH;
      return maxW > 0 ? Math.min(sFit, (slotW - 6) / maxW) : sFit;
    },
    buildG: function (geom, o) {
      if (!this.ready() || !geom) return null;
      var c = this._cache, ms = c.measures, INK = "#111111";
      function xOf(m) { return geom.Ml + (m - geom.mMin) / (geom.mMax - geom.mMin) * geom.pw; }
      var fromM = Math.max(1, Math.floor(geom.mMin + 1e-6)), toM = Math.ceil(geom.mMax - 1e-6) - 1, m;
      var s = o.s || this._scaleFor(geom, o.height || 90);
      var ty = o.targetY - c.staffTop * s;
      var g = document.createElementNS(SVGNS, "g"); g.setAttribute("class", "gcp-scorestrip");
      g.setAttribute("style", "color:" + INK + ";fill:" + INK);
      // regra que o Verovio aplica via id (#... path{stroke:currentColor}); reescopada p/ a faixa, senão some.
      var stl = document.createElementNS(SVGNS, "style");
      stl.textContent = ".gcp-scorestrip path,.gcp-scorestrip rect,.gcp-scorestrip polygon,.gcp-scorestrip polyline,.gcp-scorestrip ellipse{stroke:currentColor}";
      g.appendChild(stl);
      c.heads.forEach(function (h) { g.appendChild(h.cloneNode(true)); });
      // pentagrama contínuo (atrás das notas) + barras de compasso na grade do GCP
      var ys = (c.staffLineYs && c.staffLineYs.length) ? c.staffLineYs : [];
      var xL = xOf(fromM), xR = xOf(toM + 1);
      ys.forEach(function (Y) {
        var yy = (ty + Y * s).toFixed(2);
        var ln = document.createElementNS(SVGNS, "line");
        ln.setAttribute("x1", xL.toFixed(2)); ln.setAttribute("x2", xR.toFixed(2)); ln.setAttribute("y1", yy); ln.setAttribute("y2", yy);
        ln.setAttribute("stroke", INK); ln.setAttribute("stroke-width", "0.8"); g.appendChild(ln);
      });
      // Abertura EFETIVA (clave + armadura + fórmula em vigor no compasso inicial) — trata mudança de clave
      // no meio da peça: um estágio que começa depois de uma troca mostra a clave certa.
      function effAt(map) { var best = null, bo = -1; if (map) for (var k in map) { var o = +k; if (o <= fromM && o > bo) { bo = o; best = map[k]; } } return best; }
      var openingPx = 0, cx = xOf(fromM) + 2;
      [effAt(c.clefs), effAt(c.keySigs), effAt(c.meterSigs)].forEach(function (part) {
        if (!part) return;
        var wg = document.createElementNS(SVGNS, "g");
        wg.setAttribute("transform", "translate(" + (cx - part.x * s).toFixed(2) + "," + ty.toFixed(2) + ") scale(" + s.toFixed(5) + ")");
        wg.appendChild(part.node.cloneNode(true));
        g.appendChild(wg);
        cx += part.w * s + 2;
      });
      var start0 = xOf(fromM) + 2; openingPx = (cx > start0) ? (cx - start0 + 2) : 0;
      // Barras de compasso na grade: dupla/final + REPETIÇÃO (retornelo, com pontos) + VOLTAS (casas 1/2).
      if (ys.length) {
        var yTop = ty + Math.min.apply(null, ys) * s, yBot = ty + Math.max.apply(null, ys) * s;
        var midY = (yTop + yBot) / 2, spc = (yBot - yTop) / 4;   // espaçamento entre linhas (para os pontos do retornelo)
        function seg(xx, w) { var l = document.createElementNS(SVGNS, "line"); l.setAttribute("x1", xx.toFixed(2)); l.setAttribute("x2", xx.toFixed(2)); l.setAttribute("y1", yTop.toFixed(2)); l.setAttribute("y2", yBot.toFixed(2)); l.setAttribute("stroke", INK); l.setAttribute("stroke-width", w); g.appendChild(l); }
        function dots(xx) { [midY - spc / 2, midY + spc / 2].forEach(function (dy) { var c2 = document.createElementNS(SVGNS, "circle"); c2.setAttribute("cx", xx.toFixed(2)); c2.setAttribute("cy", dy.toFixed(2)); c2.setAttribute("r", "1.1"); c2.setAttribute("fill", INK); c2.setAttribute("stroke", "none"); g.appendChild(c2); }); }
        var barAt = function (x, style, endRep, startRep) {
          if (endRep && startRep) { dots(x - 3.4); seg(x - 1.9, "2.2"); seg(x + 0.2, "0.9"); dots(x + 3.0); }
          else if (endRep) { dots(x - 3.4); seg(x - 1.0, "0.9"); seg(x + 0.9, "2.2"); }
          else if (startRep) { seg(x - 0.9, "2.2"); seg(x + 1.0, "0.9"); dots(x + 3.4); }
          else if (style === "light-light") { seg(x - 1.6, "0.9"); seg(x + 0.6, "0.9"); }
          else if (style === "light-heavy" || style === "final") { seg(x - 2.0, "0.9"); seg(x + 0.4, "2.4"); }
          else seg(x, "0.9");
        };
        var R = c.repeats || {};
        for (m = fromM; m <= toM + 1; m++) {
          barAt(xOf(m), (c.barStyles && c.barStyles[m - 1]) || null, !!(R[m - 1] && R[m - 1].bwd), !!(R[m] && R[m].fwd));
        }
        // Voltas (casas 1ª/2ª): colchete acima do pentagrama, do início ao fim da casa, com rótulo do número.
        (c.voltas || []).forEach(function (v) {
          var vf = Math.max(fromM, v.from), vt = Math.min(toM, (v.to || v.from));   // recorta ao trecho visível
          if (vt < vf) return;
          var x1 = xOf(vf), x2 = xOf(vt + 1), yv = yTop - Math.max(6, spc * 1.1);
          function ln(x1b, y1b, x2b, y2b) { var l = document.createElementNS(SVGNS, "line"); l.setAttribute("x1", x1b.toFixed(2)); l.setAttribute("y1", y1b.toFixed(2)); l.setAttribute("x2", x2b.toFixed(2)); l.setAttribute("y2", y2b.toFixed(2)); l.setAttribute("stroke", INK); l.setAttribute("stroke-width", "0.8"); g.appendChild(l); }
          ln(x1, yv, x2, yv);                                     // horizontal
          if (v.from >= fromM) ln(x1, yv, x1, yTop - 1);          // gancho inicial
          if (v.closed && v.to <= toM) ln(x2, yv, x2, yTop - 1);  // gancho final (casa fechada)
          if (v.number) { var t = document.createElementNS(SVGNS, "text"); t.setAttribute("x", (x1 + 3).toFixed(2)); t.setAttribute("y", (yv + 8).toFixed(2)); t.setAttribute("font-size", "8"); t.setAttribute("font-style", "italic"); t.setAttribute("fill", INK); t.textContent = v.number.split(/[,\s]+/)[0] + "."; g.appendChild(t); }
        });
      }
      // Notas por compasso (escala uniforme, alinhadas à esquerda do slot); sem linhas/barras do Verovio.
      var any = false;
      for (m = fromM; m <= toM; m++) {
        var mm = ms[m]; if (!mm) continue;
        var pad = (m === fromM) ? openingPx : 0;
        var tx = xOf(m) + 2 + pad - mm.x * s;
        var wrap = document.createElementNS(SVGNS, "g");
        wrap.setAttribute("transform", "translate(" + tx.toFixed(2) + "," + ty.toFixed(2) + ") scale(" + s.toFixed(5) + ")");
        var node = mm.node.cloneNode(true);
        if (m === fromM) Array.prototype.forEach.call(node.querySelectorAll("g.clef, g.keySig, g.meterSig"), function (el) { if (el.parentNode) el.parentNode.removeChild(el); });   // a abertura já foi desenhada
        Array.prototype.forEach.call(node.querySelectorAll("g.staff"), function (st) {
          Array.prototype.forEach.call(Array.prototype.slice.call(st.children), function (ch) { if (ch.tagName && ch.tagName.toLowerCase() === "path") st.removeChild(ch); });
        });
        Array.prototype.forEach.call(node.querySelectorAll("g.barLine,g.barLineAttr"), function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
        wrap.appendChild(node); g.appendChild(wrap); any = true;
      }
      return any ? g : null;
    },

    // Insere a faixa no SVG do GCP (expande viewBox/altura; desloca o conteúdo se for acima). Síncrono.
    compose: function (svg, o) {
      try {
        if (!svg || !svg.__geom || !this.ready()) return svg;
        if (svg.querySelector(".gcp-scorestrip")) return svg;   // já composto
        o = o || {};
        var geom = svg.__geom, reqH = o.height || 90, gap = (o.gap != null ? o.gap : 8), pos = o.pos || "above";
        // altura EFETIVA = altura da partitura na escala usada (evita banda com vão vazio quando o slot limita a escala)
        var s = this._scaleFor(geom, reqH); if (!(s > 0)) return svg;
        var stripH = Math.min(reqH, this._cache.staffH * s), band = stripH + gap;
        var vb = (svg.getAttribute("viewBox") || ("0 0 " + geom.W + " " + geom.H)).split(/\s+/).map(Number);
        var gStrip;
        if (pos === "above") {
          var moved = document.createElementNS(SVGNS, "g"); moved.setAttribute("transform", "translate(0," + band + ")");
          while (svg.firstChild) moved.appendChild(svg.firstChild);
          svg.appendChild(moved);
          var bg1 = document.createElementNS(SVGNS, "rect");
          bg1.setAttribute("x", vb[0]); bg1.setAttribute("y", vb[1]); bg1.setAttribute("width", vb[2]); bg1.setAttribute("height", band); bg1.setAttribute("fill", "#ffffff");
          svg.insertBefore(bg1, svg.firstChild);
          gStrip = this.buildG(geom, { s: s, height: stripH, targetY: vb[1] + 3 });
        } else {
          var bg2 = document.createElementNS(SVGNS, "rect");
          bg2.setAttribute("x", vb[0]); bg2.setAttribute("y", vb[1] + vb[3]); bg2.setAttribute("width", vb[2]); bg2.setAttribute("height", band); bg2.setAttribute("fill", "#ffffff");
          svg.appendChild(bg2);
          gStrip = this.buildG(geom, { s: s, height: stripH, targetY: vb[1] + vb[3] + gap + 3 });
        }
        if (gStrip) svg.appendChild(gStrip);
        var newH = vb[3] + band;
        svg.setAttribute("viewBox", vb[0] + " " + vb[1] + " " + vb[2] + " " + newH);
        svg.setAttribute("height", newH);
        return svg;
      } catch (e) { return svg; }
    }
  };

  P.ScoreStrip = ST;
})(window.Praxis = window.Praxis || {});
