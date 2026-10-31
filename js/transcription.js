/* transcription.js - Tela de Transcrição (②).
   Lista editável por camada; clicar num trecho toca só ele (loop ou uma vez).
   Atalhos (padrão ELAN): Tab toca/pausa · Shift+Tab repete · Alt+↑/↓ navega · L liga/desliga o loop · Esc para.
   Codificação por teclado:
     - camada de prática: Enter caminha início→fim→comportamento; 1–9 no campo «comp.» escolhe o código e pula
       para a próxima linha (a observação fica de fora, editada só ao clicar). Shift+Enter volta um campo.
     - camada de vocabulário: 1–9 codifica a linha em foco e avança.
     - camada livre: Enter salva e vai ao próximo, tocando.
   Usa o MESMO elemento de mídia do módulo A (P.Segmenter.media). */
(function (P) {
  "use strict";

  var T = {
    refs: {}, layerId: null, cursor: -1, loop: false, speed: 1, _raf: null, _range: null, _codeEdit: -1,
    _clickMode: false, _clickStep: "start",   // codificação por clique na partitura: alterna início → fim; 1–9 grava o código e avança.
    _endPick: null, _endPickSeg: -1, _endFig: 0, _endDot: false,   // aparar o fim por figura (nota do fim tocada só parcialmente).

    init: function (refs) {
      this.refs = refs; var self = this;
      refs.layer.addEventListener("change", function () { self.layerId = this.value; self.cursor = -1; self._codeEdit = -1; self.render(); self.renderCodes(); });
      refs.loop.addEventListener("change", function () { self.loop = this.checked; });
      refs.speed.addEventListener("change", function () { self.setSpeed(parseFloat(this.value)); });
      document.addEventListener("keydown", function (e) { self.onKey(e); });
      document.addEventListener("keyup", function (e) { self.onKeyUp(e); });
      var un = document.getElementById("tr-undo"), rd = document.getElementById("tr-redo");
      if (un) un.addEventListener("click", function () { self._undo(); });
      if (rd) rd.addEventListener("click", function () { self._redo(); });
      var cm = document.getElementById("tr-clickmode");
      if (cm) cm.addEventListener("click", function () { self.toggleClickCode(); });
      var cp = document.getElementById("tr-copyprev");
      if (cp) cp.addEventListener("click", function () { self._copyPrevSegment(); });
      var vp = document.getElementById("tr-vpool");
      if (vp) {
        try { var sv = localStorage.getItem("praxis.video.pool"); vp.value = (sv === "1" || sv === "2" || sv === "3") ? sv : "auto"; } catch (e) {}
        vp.addEventListener("change", function () {
          try { if (this.value === "auto") localStorage.removeItem("praxis.video.pool"); else localStorage.setItem("praxis.video.pool", this.value); } catch (e) {}
          if (P.Segmenter.reattachVideoPool) P.Segmenter.reattachVideoPool();   // recria o pool com o novo tamanho
        });
      }
      var fg = document.getElementById("tr-ficha-group");
      if (fg) fg.addEventListener("toggle", function () { if (this.open) self.renderFicha(); });   // ficha visual só ao abrir (precisa estar visível)
      var wv = document.getElementById("hud-wave");
      if (wv) wv.addEventListener("click", function (e) { self._seekWave(e); });
      // Botões de velocidade do HUD (min-toolbar): quando clicados na aba ②, adotam a velocidade na transcrição
      // (o P.Segmenter já aplicou à mídia/pool; aqui só espelhamos no estado e no seletor).
      Array.prototype.forEach.call(document.querySelectorAll(".speed-btn"), function (b) {
        b.addEventListener("click", function () {
          var v = document.getElementById("view-transcricao");
          if (!v || !v.classList.contains("active")) return;
          self.speed = parseFloat(b.dataset.speed);
          if (self.refs.speed) self.refs.speed.value = String(self.speed);
        });
      });
      window.addEventListener("resize", function () { var v = document.getElementById("view-transcricao"); if (v && v.classList.contains("active")) self._refreshWave(); });
      // Camadas são geridas na aba Segmentar (evita redundância). Aqui só se edita o vocabulário de códigos da
      // camada selecionada, pelo menu "Códigos de comportamento" (renderCodes).
    },

    media: function () { return P.Segmenter.media; },
    // Tempo de ANOTAÇÃO (o dos segmentos) ↔ tempo do ARQUIVO: difere pelo offset da mídia primária (TIME_ORIGIN do
    // ELAN / "Alinhar pelo áudio"). Toda leitura/escrita de currentTime nesta aba passa por aqui, como no Segmenter.
    _off: function () { return (P.Segmenter && P.Segmenter.mediaOffset) || 0; },
    _now: function () { var m = this.media(); return m ? m.currentTime - this._off() : 0; },
    _seek: function (T) { var m = this.media(); if (m) m.currentTime = Math.max(0, T + this._off()); },
    tiers: function () { return P.Segmenter.tiers; },
    activeLayer: function () { var id = this.layerId, ts = this.tiers(); return ts.filter(function (x) { return x.id === id; })[0] || ts[0]; },

    onShow: function () {
      this.buildLayerOptions();
      var ts = this.tiers();
      var fromSeg = ts.filter(function (x) { return x.id === P.Segmenter.activeTierId; })[0];
      this.layerId = fromSeg ? fromSeg.id : (ts[0] ? ts[0].id : null);
      if (this.refs.layer && this.layerId) this.refs.layer.value = this.layerId;
      this._codeEdit = -1;
      this.render();
      this.renderCodes();
      this.renderFicha();
      this._syncScore();   // estado inicial da partitura conforme o segmento em foco
      this._startWaveLoop();
    },
    // Lista de camadas replicada na aba Transcrever (fonte única P.Segmenter.tiers).
    // Menu de códigos de comportamento da camada selecionada. Edita o MESMO vocabulário da aba ① (fonte única
    // P.Segmenter.tiers): chips coloridos por código (com editar/remover) + formulário de inclusão/edição.
    renderCodes: function () {
      var host = document.getElementById("tr-codes"); if (!host) return;
      var self = this, t = this.activeLayer();
      host.innerHTML = "";
      if (!t) { host.innerHTML = '<span class="hint">Nenhuma camada.</span>'; return; }
      if (t.kind === "free") { host.innerHTML = '<span class="hint">Camada de texto livre: não usa códigos.</span>'; return; }
      if (t.kind === "dimensao") { host.innerHTML = '<span class="hint">Dimensão usa a escala 1–' + (t.escalaMax || (t.vocab ? t.vocab.length : 0)) + '. Edite os rótulos na aba Segmentar.</span>'; return; }
      var chips = document.createElement("div"); chips.className = "legend"; var last = (t.vocab ? t.vocab.length : 0) - 1;
      (t.vocab || []).forEach(function (v, i) {
        var color = v.color || P.GCP.colorFor.call(P.GCP, v.code, i);
        var chip = document.createElement("span");
        chip.className = "pill";
        chip.innerHTML =
          '<input type="color" data-color="' + i + '" value="' + color + '" title="Cor do código (clique para mudar)" style="width:13px;height:13px;padding:0;border:none;border-radius:3px;background:none;cursor:pointer;vertical-align:middle">' +
          '<b>' + P.escapeHtml(v.code) + '</b>' +
          (v.label ? ' <span class="mini">' + P.escapeHtml(v.label) + '</span>' : '') +
          (i < 9 ? ' <span class="mini" style="opacity:.5">' + (i + 1) + '</span>' : '') +
          ' <span data-up="' + i + '" title="Subir (muda o número)" style="cursor:pointer;opacity:' + (i === 0 ? '.2' : '.55') + ';padding:0 1px">▲</span>' +
          '<span data-down="' + i + '" title="Descer (muda o número)" style="cursor:pointer;opacity:' + (i === last ? '.2' : '.55') + ';padding:0 1px">▼</span>' +
          ' <span data-cedit="' + i + '" title="Editar código e rótulo" style="cursor:pointer;opacity:.55;padding:0 2px">' + P.ICON.edit + '</span>' +
          '<span data-crm="' + i + '" title="Remover" style="cursor:pointer;opacity:.55;padding:0 2px">' + P.ICON.close + '</span>';
        chip.querySelector("[data-color]").addEventListener("change", function () { self._setCodeColor(i, this.value); });
        if (i > 0) chip.querySelector("[data-up]").addEventListener("click", function () { self._moveCode(i, -1); });
        if (i < last) chip.querySelector("[data-down]").addEventListener("click", function () { self._moveCode(i, 1); });
        chip.querySelector("[data-cedit]").addEventListener("click", function () { self._codeEdit = i; self.renderCodes(); });
        chip.querySelector("[data-crm]").addEventListener("click", function () { self._removeCode(i); });
        chips.appendChild(chip);
      });
      host.appendChild(chips);
      var editing = this._codeEdit != null && this._codeEdit >= 0 && t.vocab[this._codeEdit];
      var cur = editing ? t.vocab[this._codeEdit] : { code: "", label: "" };
      var ed = document.createElement("div"); ed.className = "row"; ed.style.marginTop = "8px";
      ed.innerHTML =
        '<input id="tr-pc-code" placeholder="código" value="' + P.escapeHtml(cur.code) + '" style="flex:0 0 56px">' +
        '<input id="tr-pc-label" placeholder="rótulo (ex.: Execução)" value="' + P.escapeHtml(cur.label || "") + '" style="flex:1">' +
        (editing && cur.color ? '<button class="btn sm ghost" id="tr-pc-autocolor" title="Voltar à cor automática" style="flex:0 0 auto">cor auto</button>' : '') +
        '<button class="btn sm" id="tr-pc-save" title="' + (editing ? "Salvar código" : "Incluir código") + '" style="flex:0 0 auto">' + (editing ? "Salvar" : P.ICON.plus) + '</button>' +
        (editing ? '<button class="btn sm ghost" id="tr-pc-cancel" title="Cancelar" style="flex:0 0 auto">' + P.ICON.close + '</button>' : '');
      host.appendChild(ed);
      var hint = document.createElement("div"); hint.className = "hint"; hint.style.cssText = "margin-top:6px;font-size:11px";
      hint.innerHTML = "Setas ▲▼ mudam o número do código (a tecla <kbd>1</kbd>–<kbd>9</kbd>). Clique no quadradinho para a cor.";
      host.appendChild(hint);
      var msg = document.createElement("div"); msg.id = "tr-code-msg"; msg.className = "hint"; msg.style.cssText = "color:var(--danger,#e5484d);margin-top:6px";
      host.appendChild(msg);
      host.querySelector("#tr-pc-save").addEventListener("click", function () { self._saveCode(); });
      ["tr-pc-code", "tr-pc-label"].forEach(function (id) { host.querySelector("#" + id).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); self._saveCode(); } }); });
      var cx = host.querySelector("#tr-pc-cancel"); if (cx) cx.addEventListener("click", function () { self._codeEdit = -1; self.renderCodes(); });
      var ac = host.querySelector("#tr-pc-autocolor"); if (ac) ac.addEventListener("click", function () { self._setCodeColor(self._codeEdit, null); });
      if (P.upgradeColorInputs) P.upgradeColorInputs(host);
    },
    // Cor customizada de um código (null = volta à automática por posição). Reflete na aba ① também.
    _setCodeColor: function (i, val) {
      var t = this.activeLayer(); if (!t || !t.vocab[i]) return;
      if (val) t.vocab[i].color = val; else delete t.vocab[i].color;
      this._afterCodesChanged();
    },
    // Reordena um código (muda qual número 1–9 o aciona). Mantém o foco de edição no código movido.
    _moveCode: function (i, dir) {
      var t = this.activeLayer(); if (!t || !t.vocab) return;
      var j = i + dir; if (j < 0 || j >= t.vocab.length) return;
      var tmp = t.vocab[i]; t.vocab[i] = t.vocab[j]; t.vocab[j] = tmp;
      if (this._codeEdit === i) this._codeEdit = j; else if (this._codeEdit === j) this._codeEdit = i;
      this._afterCodesChanged();
    },
    _codeMsg: function (text) { var m = document.getElementById("tr-code-msg"); if (m) m.textContent = text || ""; },
    _saveCode: function () {
      var t = this.activeLayer(); if (!t) return;
      var code = ((document.getElementById("tr-pc-code") || {}).value || "").trim();
      var label = ((document.getElementById("tr-pc-label") || {}).value || "").trim();
      if (!code) { this._codeMsg("Informe um código de comportamento."); return; }
      var i = this._codeEdit;
      if (i != null && i >= 0 && t.vocab[i]) {
        var old = t.vocab[i].code;
        if (code !== old && t.vocab.some(function (v) { return v.code === code; })) { this._codeMsg("Já existe um código «" + code + "»."); return; }
        var vobj = t.vocab[i];
        vobj.code = code; vobj.label = label;   // muta no lugar (preserva a cor customizada)
        // sem órfãos ao renomear, mas só nas camadas que usam ESTE código (não recodifica texto livre nem outras práticas)
        if (old !== code) this.tiers().forEach(function (tt) { if (tt === t || (tt.vocab || []).indexOf(vobj) >= 0) tt.segments.forEach(function (s) { if (s.value === old) s.value = code; }); });
        if (t.activeCat === old) t.activeCat = code;
      } else {
        if (t.vocab.some(function (v) { return v.code === code; })) { this._codeMsg("Já existe um código «" + code + "»."); return; }
        t.vocab.push({ code: code, label: label }); t.activeCat = code;
      }
      this._codeEdit = -1;
      this._afterCodesChanged();
    },
    _removeCode: function (i) {
      var t = this.activeLayer(); if (!t || !t.vocab[i]) return;
      if (t.vocab.length <= 1) { this._codeMsg("Mantenha ao menos 1 código."); return; }
      var removed = t.vocab[i].code;
      t.vocab.splice(i, 1);
      if (t.activeCat === removed) t.activeCat = t.vocab[0].code;
      if (this._codeEdit === i) this._codeEdit = -1;
      this._afterCodesChanged();
    },
    // Depois de mexer no vocabulário: registra no histórico e re-renderiza aqui E na aba ① (mesma fonte).
    _afterCodesChanged: function () {
      this._commit();
      this.renderCodes();
      this.render();
      this.renderShortcuts(this.activeLayer());
      var S = P.Segmenter;
      if (S.renderPicker) S.renderPicker();
      if (S.renderList) S.renderList();
      if (S.renderTimeline) S.renderTimeline();
    },
    // Compat: chamadas antigas ao painel de camadas agora só atualizam o menu de códigos.
    renderTiersPanel: function () { this.renderCodes(); },
    // Chamado por P.Segmenter.renderTiers a cada mudança nas camadas (add/editar/remover).
    onTiersChanged: function () {
      var S = P.Segmenter;
      if (this.layerId && !S.tiers.some(function (t) { return t.id === this.layerId; }, this)) this.layerId = S.tiers[0] ? S.tiers[0].id : null;
      this.buildLayerOptions();
      if (this.refs.layer && this.layerId) this.refs.layer.value = this.layerId;
      this.renderTiersPanel();
      var trv = document.getElementById("view-transcricao");
      if (trv && trv.classList.contains("active")) this.render();
    },
    buildLayerOptions: function () {
      var sel = this.refs.layer; if (!sel) return;
      sel.innerHTML = "";
      this.tiers().forEach(function (t) {
        var o = document.createElement("option");
        var badge = t.kind === "practice" ? "prática" : t.kind === "controlled" ? "vocab" : "livre";
        o.value = t.id; o.textContent = t.name + " (" + badge + ")";
        sel.appendChild(o);
      });
    },

    // P2: progresso de codificação. Para camada de prática, conta segmentos com
    // início e fim em compasso finitos; para as demais, conta os que têm valor.
    _setProgress: function (t) {
      var bar = document.getElementById("tr-progress-bar"), num = document.getElementById("tr-progress-num"), lab = document.getElementById("tr-progress-label");
      if (!bar || !num) return;
      var total = t ? t.segments.length : 0, done = 0;
      if (t) {
        var practice = t.kind === "practice";
        t.segments.forEach(function (s) {
          if (practice) { if (isFinite(s.mStart) && isFinite(s.mEnd)) done++; }
          else if ((s.value || "").toString().trim()) done++;
        });
      }
      var pct = total ? done / total * 100 : 0;
      bar.style.width = pct.toFixed(1) + "%";
      num.textContent = done + " / " + total;
      if (lab) lab.textContent = (t && t.kind === "practice") ? "Compassos codificados" : "Trechos codificados";
    },
    render: function () {
      var t = this.activeLayer(), host = this.refs.list, self = this;
      if (!host) return;
      this._setProgress(t);
      this.renderShortcuts(t);
      if (!t) { host.innerHTML = '<div class="empty" style="padding:40px">Sem camadas.</div>'; return; }
      if (!t.segments.length) { host.innerHTML = '<div class="empty" style="padding:40px">Nenhum trecho nesta camada. Segmente a gravação na tela Segmentar primeiro.</div>'; return; }
      var isPractice = t.kind === "practice";
      host.innerHTML = isPractice ? '<datalist id="tr-vocab">' + t.vocab.map(function (v) { return '<option value="' + P.escapeHtml(v.code) + '">' + P.escapeHtml(v.label || "") + '</option>'; }).join("") + '</datalist>' : "";
      var head = document.createElement("div");
      head.className = "tr-head";
      head.style.cssText = "position:sticky;top:0;z-index:2;display:flex;gap:10px;align-items:center;padding:7px 14px;border-bottom:1px solid var(--line);background:var(--panel);font-size:10.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--txt-dim)";
      head.innerHTML = isPractice
        ? '<span style="flex:0 0 150px">Trecho</span><span style="flex:1">Início · fim · duração em compasso, código e observação</span>'
        : '<span style="flex:0 0 150px">Trecho</span><span style="flex:1">Transcrição</span>';
      host.appendChild(head);
      t.segments.forEach(function (s, i) {
        var row = document.createElement("div");
        row.className = "tr-row" + (i === self.cursor ? " active" : "");
        row.tabIndex = 0;
        row.style.cssText = "display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-bottom:1px solid var(--line)";
        var body;
        if (isPractice) {
          body = '<div style="flex:1;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
            '<span class="mini">compasso</span>' +
            '<input data-pi="ini" data-i="' + i + '" value="' + (s.mStart != null ? s.mStart : "") + '" placeholder="início" style="width:58px">' +
            '<input data-pi="fim" data-i="' + i + '" value="' + (s.mEnd != null ? s.mEnd : "") + '" placeholder="fim" style="width:58px">' +
            '<span class="mini" data-dur="' + i + '">' + self._durText(s) + '</span>' +
            '<input data-pi="comp" data-i="' + i + '" list="tr-vocab" value="' + P.escapeHtml(s.value || "") + '" placeholder="comp." style="width:64px">' +
            '<input data-pi="obs" data-i="' + i + '" value="' + P.escapeHtml(s.note || "") + '" placeholder="obs…" style="flex:1;min-width:90px">' +
            '</div>';
        } else if (t.kind === "controlled") {
          var blank = '<option value=""' + (s.value ? "" : " selected") + '>-</option>';   // sem código: mostra vazio (e o undo fica visível)
          var opts = t.vocab.map(function (v) { return '<option value="' + P.escapeHtml(v.code) + '"' + (v.code === s.value ? " selected" : "") + '>' + P.escapeHtml(v.code) + (v.label ? " · " + P.escapeHtml(v.label) : "") + '</option>'; }).join("");
          body = '<div style="flex:1"><select data-v="' + i + '" style="width:100%">' + blank + opts + '</select></div>';
        } else {
          body = '<div style="flex:1"><textarea data-t="' + i + '" rows="2" style="width:100%;resize:vertical" placeholder="transcreva…">' + P.escapeHtml(s.value) + '</textarea></div>';
        }
        row.innerHTML =
          '<div class="tr-lead" data-play="' + i + '" title="Ouvir este trecho (Tab)">' +
            '<span class="tr-lead-ico">' + P.ICON.play + '</span>' +
            '<span class="tr-lead-txt">' +
              '<span class="tr-num">' + (i + 1) + (s.locked ? '<span class="tr-lock" title="Editado manualmente">' + P.ICON.lock + '</span>' : "") + '</span>' +
              '<span class="tr-range"><a class="tr-start" href="#" data-seek="' + i + '" title="Levar a agulha até aqui, sem tocar">' + P.fmtTime(s.tStart, true) + '</a><span class="tr-sep">›</span><span class="tr-end">' + P.fmtTime(s.tEnd, true) + '</span></span>' +
            '</span>' +
          '</div>' +
          body;
        host.appendChild(row);
      });
      host.querySelectorAll(".tr-lead").forEach(function (b) { b.addEventListener("click", function () { self.playSegment(+b.dataset.play); }); });
      host.querySelectorAll("[data-seek]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); var i = +a.dataset.seek; self._seek(t.segments[i].tStart); self.setCursor(i); }); });
      host.querySelectorAll("[data-t]").forEach(function (x) { x.addEventListener("change", function () { var s = t.segments[+x.dataset.t]; s.value = x.value; s.locked = true; self._commit(); }); });
      host.querySelectorAll("[data-v]").forEach(function (x) { x.addEventListener("change", function () { t.segments[+x.dataset.v].value = x.value; self._commit(); }); });
      host.querySelectorAll("[data-pi]").forEach(function (x) {
        x.addEventListener("change", function () { self._savePractice(t, x); self._refreshDur(t, +x.dataset.i); self._setProgress(t); self._commit(); });
        if (x.dataset.pi === "ini" || x.dataset.pi === "fim") x.addEventListener("input", function () { self._savePractice(t, x); self._refreshDur(t, +x.dataset.i); self._syncScore(+x.dataset.i); });
      });
    },
    // Texto da duração calculada (fim menos início, em compassos). Mostra "?" enquanto faltar um dos dois.
    _durText: function (s) {
      if (s && isFinite(s.mStart) && isFinite(s.mEnd)) { var d = s.mEnd - s.mStart; return "= " + (+d.toFixed(2)) + (Math.abs(d) === 1 ? " compasso" : " compassos"); }
      return "= ? compassos";
    },
    // Atualiza só o "= duração" da linha i, sem reconstruir a lista (preserva o foco durante a digitação).
    _refreshDur: function (t, i) {
      var span = this.refs.list && this.refs.list.querySelector('[data-dur="' + i + '"]');
      if (span) span.textContent = this._durText(t.segments[i]);
    },
    // Move o cursor/realce para a linha i sem re-render completo. Toca só as duas linhas que mudam
    // (antiga e nova), não a lista toda: com centenas de segmentos isso é a diferença entre travar e fluir.
    setCursor: function (i) {
      var rows = this.refs.list ? this.refs.list.querySelectorAll(".tr-row") : [];
      if (this.cursor >= 0 && this.cursor !== i && rows[this.cursor]) rows[this.cursor].classList.remove("active");
      this.cursor = i;
      if (rows[i]) { rows[i].classList.add("active"); if (this._clickMode) this._scrollRowToTop(rows[i]); else this._scrollRowIntoList(rows[i]); }
      this._refreshWave();
      if (this._clickMode) { this._clickStep = "start"; this._endPick = null; this._endFig = 0; this._endDot = false; if (P.Score && P.Score.clearPicks) P.Score.clearPicks(); this._updateClickUI(); }
      else this._syncScore();
      this._prefetchAdjacent();   // buffer triplo: pré-busca os vídeos dos trechos vizinhos
    },
    // Estado da partitura conforme o segmento em foco (idx opcional = trecho editado; senão o do cursor).
    // REGRA: na camada de prática, enquanto início E fim não estiverem completos, a partitura NÃO sabe onde está →
    // suprime tudo (sem realce, sem rolagem, com ou sem acoplamento, mesmo tocando). Completos → destaca o compasso.
    // Camadas temporais (controlada/livre) não têm início/fim próprios: seguem o mapeamento estrito pelo tempo.
    _syncScore: function (idx) {
      if (!P.Score || !P.Score.ready || !P.Score.measureCount) return;
      var t = this.activeLayer();
      var s = (idx != null && t && t.segments) ? t.segments[idx] : this._curSeg();
      // número real de verdade (exclui undefined/null/NaN - atenção: isFinite(null) é true, e NaN vira null no .praxis salvo).
      function num(x) { return typeof x === "number" && isFinite(x); }
      if (t && t.kind === "practice") {
        if (!(s && num(s.mStart) && num(s.mEnd))) { if (P.Score.setSuppressed) P.Score.setSuppressed(true); return; }   // dados incompletos → partitura em branco
        if (P.Score.setSuppressed) P.Score.setSuppressed(false);
        P.Score.highlightMeasure(Math.max(0, Math.min(P.Score.measureCount - 1, (s.mStart | 0) - 1)), true);
        return;
      }
      if (P.Score.setSuppressed) P.Score.setSuppressed(false);
      if (s && isFinite(s.tStart) && P.Score.measureAtTime) {
        var mi = P.Score.measureAtTime(s.tStart, true);   // estrito: -1 se não há cobertura real (sem chutes)
        if (mi >= 0 && mi < P.Score.measureCount) P.Score.highlightMeasure(mi, true);
      }
    },

    // --- Codificação por clique na partitura (o "modo interativo") -----------------------------------------
    // Liga/desliga. Só para camada de prática e com partitura carregada. Ao ligar, a partitura entra em estado
    // de "mira": 1º clique numa nota/pausa = início, 2º = fim; 1–9 grava o código no trecho atual e avança.
    toggleClickCode: function () {
      if (this._clickMode) { this.exitClickCode(); return; }
      var t = this.activeLayer();
      if (!t || t.kind !== "practice") { this._clickMsg("O modo de clique é para camadas de prática (início e fim em compasso)."); return; }
      if (!P.Score || !P.Score.ready || !P.Score.measureCount) { this._clickMsg("Abra a partitura primeiro (aba Segmentar → Abrir partitura)."); return; }
      if (this.cursor < 0) this.setCursor(0);
      this._clickMode = true; this._clickStep = "start";
      var self = this;
      P.Score.setPickMode(true, function (id, d) { self._onScorePick(id, d); });
      this._updateClickUI();
    },
    exitClickCode: function () {
      this._clickMode = false;
      if (P.Score && P.Score.setPickMode) P.Score.setPickMode(false);
      this._updateClickUI();
      this._syncScore();   // volta ao realce normal do trecho atual
    },
    // Recebe um clique da partitura: alterna início/fim no trecho atual.
    _onScorePick: function (id, d) {
      var t = this.activeLayer(); if (!t || t.kind !== "practice") return;
      var i = this.cursor >= 0 ? this.cursor : 0, s = t.segments[i]; if (!s) return;
      if (this._clickStep === "start") { s.mStart = d.mStart; if (P.Score.markPick) P.Score.markPick(id, "start"); this._clickStep = "end"; this._endPick = null; this._endFig = 0; this._endDot = false; }
      else { s.mEnd = d.mEnd; if (P.Score.markPick) P.Score.markPick(id, "end"); this._clickStep = "start"; this._endPick = d; this._endPickSeg = i; this._endFig = 0; this._endDot = false; }   // guarda a nota do fim p/ aparar por figura
      if (isFinite(s.mStart) && isFinite(s.mEnd)) s.duration = s.mEnd - s.mStart;
      this._updatePracticeRow(i); this._setProgress(t); this._commit();
      this._updateClickUI();
    },
    // 1–9 no modo de clique: grava o código no trecho atual e avança para o próximo (novo par de cliques).
    _clickAssignCode: function (n) {
      var t = this.activeLayer(); if (!t || t.kind !== "practice") return false;
      var v = t.vocab && t.vocab[n - 1]; if (!v) return false;
      var i = this.cursor >= 0 ? this.cursor : 0, s = t.segments[i]; if (!s) return false;
      s.value = v.code; this._updatePracticeRow(i); this._setProgress(t); this._commit();
      if (P.Score.clearPicks) P.Score.clearPicks();
      // Avança e JÁ TOCA o próximo trecho (o usuário ouve enquanto decide os cliques). O pedal não interfere:
      // ele só age se for apertado/solto (aí manda parar+rebobinar). Sem mídia, só avança.
      if (i < t.segments.length - 1) { if (this.media()) this.playSegment(i + 1); else this.setCursor(i + 1); }
      else { this._clickStep = "start"; this._updateClickUI(); }
      return true;
    },
    // Atualiza os campos visíveis da linha i (início/fim/comp/duração) sem reconstruir a lista.
    _updatePracticeRow: function (i) {
      var host = this.refs.list, t = this.activeLayer(); if (!host || !t) return;
      var s = t.segments[i]; if (!s) return;
      var ini = host.querySelector('[data-pi="ini"][data-i="' + i + '"]'); if (ini) ini.value = (typeof s.mStart === "number" && isFinite(s.mStart)) ? s.mStart : "";
      var fim = host.querySelector('[data-pi="fim"][data-i="' + i + '"]'); if (fim) fim.value = (typeof s.mEnd === "number" && isFinite(s.mEnd)) ? s.mEnd : "";
      var comp = host.querySelector('[data-pi="comp"][data-i="' + i + '"]'); if (comp) comp.value = s.value || "";
      this._refreshDur(t, i);
    },
    // Atualiza o campo/valor visível da linha i em qualquer tipo de camada, sem reconstruir a lista.
    _updateRow: function (i) {
      var t = this.activeLayer(), host = this.refs.list; if (!t || !host) return;
      var s = t.segments[i]; if (!s) return;
      if (t.kind === "practice") { this._updatePracticeRow(i); return; }
      if (t.kind === "controlled") { var sel = host.querySelector('[data-v="' + i + '"]'); if (sel) sel.value = s.value || ""; }
      else { var ta = host.querySelector('[data-t="' + i + '"]'); if (ta) ta.value = s.value || ""; }
    },
    // Repete o trecho anterior no atual (início/fim/código na prática; valor nas demais) e avança. Participantes
    // costumam repetir o mesmo trecho várias vezes seguidas - isto preenche uma sequência com toques repetidos.
    _copyPrevSegment: function () {
      var t = this.activeLayer(); if (!t || !t.segments) return;
      var i = this.cursor >= 0 ? this.cursor : 0;
      if (i < 1) { this._status("Não há trecho anterior para repetir.", "err"); return; }
      var prev = t.segments[i - 1], s = t.segments[i]; if (!prev || !s) return;
      if (t.kind === "practice") { s.mStart = prev.mStart; s.mEnd = prev.mEnd; s.value = prev.value; s.note = prev.note; if (typeof s.mStart === "number" && typeof s.mEnd === "number") s.duration = s.mEnd - s.mStart; }
      else { s.value = prev.value; s.note = prev.note; }
      this._updateRow(i); this._setProgress(t); this._commit();
      if (i < t.segments.length - 1) this.setCursor(i + 1);   // avança para o próximo (mais um Alt+C repete de novo)
      else this._updateClickUI();
    },
    // Apara o fim do trecho pela figura tocada na nota do fim (semínima=1, colcheia=0,5, semicolcheia=0,25 semínima;
    // pontuada = ×1,5). Usa a nota do fim guardada em _endPick. Recalcula fim = início da nota + duração da figura − 0,01.
    _setEndFigure: function (figQuarters, dotted) {
      if (!this._clickMode || !this._endPick) { this._clickMsg("Clique o FIM primeiro para depois aparar pela figura."); return; }
      var t = this.activeLayer(); if (!t || t.kind !== "practice") return;
      var i = this._endPickSeg, s = t.segments[i], ep = this._endPick; if (!s || !ep) return;
      var measDur = (P.Score && P.Score.measureDurQuarters) ? P.Score.measureDurQuarters(ep.ord) : 4;
      var q = figQuarters * (dotted ? 1.5 : 1), onsetFrac = ep.mStart - ep.ord;
      s.mEnd = Math.round((ep.ord + onsetFrac + q / measDur) * 100) / 100 - 0.01;
      s.mEnd = Math.round(s.mEnd * 100) / 100;
      if (typeof s.mStart === "number" && typeof s.mEnd === "number") s.duration = s.mEnd - s.mStart;
      this._updatePracticeRow(i); this._setProgress(t); this._commit();
      var nm = figQuarters === 1 ? "semínima" : figQuarters === 0.5 ? "colcheia" : "semicolcheia";
      this._clickMsg("Fim aparado: " + nm + (dotted ? " pontuada" : "") + " → " + s.mEnd);
    },
    // Aplica a figura corrente (com o estado de ponto). Chamado por uma tecla de figura ou pela tecla de ponto.
    _applyEndFig: function () { if (this._endFig) this._setEndFigure(this._endFig, this._endDot); },
    _clickMsg: function (text) { var el = document.getElementById("tr-click-hint"); if (el) el.textContent = text || ""; },
    // Atualiza o botão + a dica de passo do modo de clique.
    _updateClickUI: function () {
      var btn = document.getElementById("tr-clickmode");
      if (btn) { btn.classList.toggle("active", this._clickMode); btn.textContent = this._clickMode ? "Sair do modo clique" : "Codificar clicando na partitura"; }
      var hint = document.getElementById("tr-click-hint"); if (!hint) return;
      if (!this._clickMode) { hint.textContent = ""; return; }
      var n = (this.cursor >= 0 ? this.cursor : 0) + 1;
      hint.textContent = this._clickStep === "start"
        ? "Trecho " + n + ": clique o INÍCIO na partitura."
        : "Trecho " + n + ": clique o FIM. Depois tecle 1–9 para o código.";
    },
    // Ficha digital (modo manual): início/fim decimais por subdivisão, filtrada pela(s) fórmula(s) da peça.
    renderFicha: function () {
      var host = document.getElementById("tr-ficha"); if (!host) return;
      var sigs = (P.Score && P.Score.timeSigs) ? P.Score.timeSigs() : [], note = "";
      if (!sigs.length) { sigs = [{ beats: 2, beatType: 4 }, { beats: 3, beatType: 4 }, { beats: 4, beatType: 4 }]; note = '<p class="hint" style="margin-top:0">Sem partitura aberta: mostrando 2/4, 3/4 e 4/4. Abra a partitura para filtrar pela peça.</p>'; }
      function f(x) { x = Math.round(x * 100) / 100; return x === 0 ? ".0" : String(x).replace(/^0\./, ".").replace(/^-0\./, "-."); }
      var html = note + '<p class="hint" style="margin-top:0">Início e fim (fim = próximo ataque − 0,01) por subdivisão. O modo de clique calcula isso sozinho.</p>';
      sigs.forEach(function (ts) {
        html += '<div style="margin-top:8px;font-weight:700">' + ts.beats + '/' + ts.beatType + '</div>';
        (P.Score.fichaFor(ts.beats, ts.beatType) || []).forEach(function (g) {
          html += '<div style="margin-top:4px;font-size:11px;word-break:break-word"><b>' + P.escapeHtml(g.label) + '</b>' +
            '<div style="color:var(--txt-dim)">iníc: ' + g.starts.map(f).join(" ") + '</div>' +
            '<div style="color:var(--txt-dim)">fim: ' + g.ends.map(f).join(" ") + '</div></div>';
        });
      });
      host.innerHTML = html;   // texto instantâneo (fallback); a versão visual substitui quando o Verovio estiver pronto
      var grp = document.getElementById("tr-ficha-group");
      if (P.Score && P.Score.renderFichaVisual && grp && grp.open) P.Score.renderFichaVisual(host);   // visual só com o painel aberto (o overlay precisa de layout)
    },
    // Rola SÓ o painel da lista (#tr-list) para deixar a linha visível - sem arrastar a página. `scrollIntoView`
    // rolaria TODOS os ancestrais scrolláveis (canvas-area/página) e tiraria o vídeo/partitura de vista.
    _scrollRowIntoList: function (row) {
      var host = this.refs.list; if (!host || !row) return;
      var h = host.getBoundingClientRect(), r = row.getBoundingClientRect();
      if (r.top < h.top) host.scrollTop -= (h.top - r.top);
      else if (r.bottom > h.bottom) host.scrollTop += (r.bottom - h.bottom);
    },
    // Modo de clique: a linha ativa vira a PRIMEIRA visível do painel, logo ABAIXO do cabeçalho fixo (`.tr-head` é
    // sticky top:0, então precisa descontar a altura dele; senão o topo da linha fica coberto). O navegador limita no fim.
    _scrollRowToTop: function (row) {
      var host = this.refs.list; if (!host || !row) return;
      var head = host.querySelector(".tr-head");
      var headH = head ? head.getBoundingClientRect().height : 0;
      var h = host.getBoundingClientRect(), r = row.getBoundingClientRect();
      host.scrollTop += (r.top - h.top) - headH;
    },
    // Foca um campo específico (ini|fim|comp|obs) da linha i, na camada de prática.
    focusField: function (i, field) {
      var host = this.refs.list; if (!host) return false;
      var el = host.querySelector('[data-pi="' + field + '"][data-i="' + i + '"]');
      if (!el) return false;
      this.setCursor(i);
      el.focus(); if (el.select) el.select();
      return true;
    },
    // Avança para o início da próxima linha de prática (pula a observação).
    _practiceNextRow: function (i) {
      var t = this.activeLayer(); if (!t) return;
      if (i + 1 >= t.segments.length) { this._status("Última linha desta camada.", ""); this.setCursor(i); return; }
      this.focusField(i + 1, "ini");
    },
    // Codifica o comportamento da linha i com o n-ésimo código do vocabulário e pula para a próxima linha.
    assignPracticeCode: function (i, n) {
      var t = this.activeLayer(); if (!t || t.kind !== "practice") return false;
      var v = t.vocab && t.vocab[n - 1]; if (!v) return false;
      var s = t.segments[i]; if (!s) return false;
      s.value = v.code;
      var el = this.refs.list && this.refs.list.querySelector('[data-pi="comp"][data-i="' + i + '"]');
      if (el) el.value = v.code;
      this._setProgress(t);
      this._commit();
      this._status("Trecho " + (i + 1) + ": " + v.code + (v.label ? " (" + v.label + ")" : ""), "ok");
      this._practiceNextRow(i);
      return true;
    },
    _savePractice: function (t, el) {
      var s = t.segments[+el.dataset.i], k = el.dataset.pi; if (!s) return;
      if (k === "ini") s.mStart = parseFloat(el.value);
      else if (k === "fim") s.mEnd = parseFloat(el.value);
      else if (k === "comp") s.value = el.value.trim();
      else if (k === "obs") s.note = el.value.trim();
      if (isFinite(s.mStart) && isFinite(s.mEnd)) s.duration = s.mEnd - s.mStart;   // duração agora é derivada de início+fim
    },

    // Chips de status removidos da aba ② (a pedido do usuário: passavam impressão de "IA falante"). No-op.
    _status: function () { var el = this.refs.status; if (el) { el.style.display = "none"; el.textContent = ""; } },
    playSegment: function (i) {
      var t = this.activeLayer(), m = this.media();
      if (!t || !m || !t.segments[i]) { this._status("Carregue a mídia na tela Segmentar primeiro.", "err"); return; }
      var s = t.segments[i];
      this._range = { start: s.tStart, end: s.tEnd };
      m.playbackRate = this.speed; if ("preservesPitch" in m) m.preservesPitch = true;
      if (P.Segmenter.videoActivateAt) P.Segmenter.videoActivateAt(s.tStart);   // usa o vídeo já pré-buscado (buffer triplo)
      if (P.Segmenter.videoEl) P.Segmenter.videoEl.playbackRate = this.speed;   // garante a velocidade no vídeo ativo (mesmo sem ratechange)
      this._seek(s.tStart); m.play();
      this._watch(); this.setCursor(i);   // realce incremental (não reconstrói a lista): onda/playhead aparecem na hora
      this._status("Tocando trecho " + (i + 1) + " (" + P.fmtTime(s.tStart, true) + " " + P.fmtTime(s.tEnd, true) + ")" + (this.loop ? " em loop" : ""), "work");
    },
    // Triple-buffering: pré-busca os vídeos do trecho anterior, atual e próximo (inícios), para trocar/replay sem atraso.
    _prefetchAdjacent: function () {
      if (!P.Segmenter.videoPrefetch) return;
      var t = this.activeLayer(); if (!t || !t.segments) return;
      var i = this.cursor >= 0 ? this.cursor : 0, segs = t.segments, times = [];
      [i, i + 1, i - 1].forEach(function (k) { var s = segs[k]; if (s && isFinite(s.tStart)) times.push(s.tStart); });
      P.Segmenter.videoPrefetch(times);
    },
    _watch: function () {
      var self = this, m = this.media();
      cancelAnimationFrame(this._raf);
      (function tick() {
        if (!self._range || !m) return;
        if (self._now() >= self._range.end) {
          if (self.loop) { self._loopBack(self._range.start); }
          else { m.pause(); self._range = null; self._status(""); return; }
        }
        self._raf = requestAnimationFrame(tick);
      })();
    },
    // Volta do loop SEM re-buscar o vídeo visível. Re-buscar o ativo a cada volta empilha seeks e trava o decoder
    // (readyState cai p/ 1). Em vez disso troca para um vídeo do pool já pré-posicionado no início (não busca o
    // visível) e re-estoca o buffer para a próxima volta. Só age uma vez por volta: reposicionar a mídia p/ tStart
    // faz as duas cercas (_watch e _enforceBound) pararem de disparar até a próxima passagem.
    _loopBack: function (start) {
      var m = this.media(); if (!m) return;
      this._seek(start);
      if (P.Segmenter.videoActivateAt) {
        P.Segmenter.videoActivateAt(start);   // hit no buffer pré-posicionado → visível não busca
        var v = P.Segmenter.videoEl;
        if (v) {
          // O buffer entra "frio" (só o quadro inicial). Dá play e ABRE carência p/ ele decodificar TOCANDO - senão a
          // correção de deriva o seeka em bloco e ele "pula todos os frames" entre o início e o fim.
          P.Segmenter._vSeekAt = Date.now();
          if (v.paused) { try { v.play().catch(function () {}); } catch (e) {} }
        }
      }
      var self = this; setTimeout(function () { self._prefetchAdjacent(); }, 30);   // re-estoca o início p/ a próxima volta
    },
    stop: function () { this._range = null; cancelAnimationFrame(this._raf); var m = this.media(); if (m && m.pause) m.pause(); },
    // --- Desfazer/refazer (histórico compartilhado com o segmenter, pois editam as mesmas tiers) ---
    _commit: function () { if (P.Segmenter && P.Segmenter.commit) P.Segmenter.commit(); },
    _undo: function () { if (P.Segmenter && P.Segmenter.undo) { P.Segmenter.undo(); this._afterHistory(); } },
    _redo: function () { if (P.Segmenter && P.Segmenter.redo) { P.Segmenter.redo(); this._afterHistory(); } },
    // O segmenter troca o array `tiers` ao aplicar um índice do histórico; re-lê tudo do zero e re-renderiza a aba ②.
    _afterHistory: function () {
      var self = this, ts = this.tiers();
      if (!ts.some(function (x) { return x.id === self.layerId; })) this.layerId = ts[0] ? ts[0].id : null;
      this.buildLayerOptions();
      if (this.refs.layer && this.layerId) this.refs.layer.value = this.layerId;
      this.render(); this.renderTiersPanel(); this._refreshWave();
    },

    // --- Mini-onda do trecho atual (ao lado do HUD, como no ELAN): onda do segmento + playhead. WAV apenas. ---
    _drawWave: function () {
      var cv = document.getElementById("hud-wave"); if (!cv) return;
      // TETO da resolução INTERNA do canvas. Sem isso, no full screen `#hud-wave` (flex:1) ficava largo e virava uma
      // textura GPU GIGANTE re-enviada a CADA QUADRO durante o play → afogava o decoder de vídeo (seek do loop/play
      // não completava, readyState caía p/ 1 → congelava). A onda é aproximada: 1000px internos esticados por CSS
      // ficam ótimos, e a textura fica pequena/barata por quadro. dpr também limitado (não precisa de retina cheia).
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var cssW = cv.clientWidth || 600, cssH = cv.clientHeight || 60;
      var drawW = Math.min(cssW, 1000);
      var bw = Math.round(drawW * dpr), bh = Math.round(cssH * dpr);
      if (cv.width !== bw) cv.width = bw;
      if (cv.height !== bh) cv.height = bh;
      var ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var W = drawW, H = cssH, mid = H / 2, amp = (H / 2) * 0.9;
      ctx.clearRect(0, 0, W, H);
      var dark = document.documentElement.getAttribute("data-theme") !== "light";
      ctx.strokeStyle = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(W, mid + 0.5); ctx.stroke();   // linha de base
      var t = this.activeLayer(), s = t && t.segments && t.segments[this.cursor >= 0 ? this.cursor : 0];
      if (!s || !isFinite(s.tStart) || !isFinite(s.tEnd) || s.tEnd <= s.tStart) return;
      var a = s.tStart, b = s.tEnd, wp = P.Segmenter._wavPeaks;
      if (wp && wp.peaks) {
        var peaks = wp.peaks, hz = wp.bucketHz;
        ctx.strokeStyle = dark ? "#4f9df5" : "#2b6fb8"; ctx.beginPath();
        for (var x = 0; x < W; x++) {
          var ta = a + (b - a) * (x / W), tb = a + (b - a) * ((x + 1) / W);
          var ba = Math.floor(ta * hz), bb = Math.max(ba + 1, Math.floor(tb * hz)), mn = 1, mx = -1;
          for (var k = ba; k < bb; k++) { if (k < 0 || k * 2 + 1 >= peaks.length) continue; var lo = peaks[k * 2], hi = peaks[k * 2 + 1]; if (lo < mn) mn = lo; if (hi > mx) mx = hi; }
          if (mx < mn) continue;
          ctx.moveTo(x + 0.5, mid - Math.max(-1, Math.min(1, mx)) * amp);
          ctx.lineTo(x + 0.5, mid - Math.max(-1, Math.min(1, mn)) * amp + 0.5);
        }
        ctx.stroke();
      }
      var m = this.media();
      var curA = m ? this._now() : NaN;
      if (m && isFinite(curA) && curA >= a && curA <= b) {
        var px = (curA - a) / (b - a) * W;
        ctx.strokeStyle = dark ? "#3ddc97" : "#0e7a4f"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); ctx.lineWidth = 1;
      }
    },
    // Loop leve: confina a reprodução ao trecho (cerca) e redesenha quando o tempo muda ou quando forço.
    _startWaveLoop: function () {
      var self = this; cancelAnimationFrame(this._waveRaf); this._lastWaveCur = null;
      (function tick() {
        var v = document.getElementById("view-transcricao");
        if (!v || !v.classList.contains("active")) return;
        var m = self.media();
        self._enforceBound(m);
        var cur = m ? m.currentTime : -1;
        if (cur !== self._lastWaveCur) { self._drawWave(); self._lastWaveCur = cur; }
        self._waveRaf = requestAnimationFrame(tick);
      })();
    },
    // Cerca da aba ②: a reprodução NUNCA sai do trecho atual (nem pelo pedal/transporte/teclado). Tocando, confina em
    // [tStart, tEnd]. Ao chegar no fim: com loop ligado (e um trecho tocando), volta ao início; senão pausa.
    _enforceBound: function (m) {
      if (!m) return;
      var t = this.activeLayer(), s = t && t.segments && t.segments[this.cursor >= 0 ? this.cursor : 0];
      if (!s || !isFinite(s.tStart) || !isFinite(s.tEnd) || s.tEnd <= s.tStart) return;
      if (this._now() > s.tEnd) {
        if (this.loop && this._range) { this._loopBack(s.tStart); }   // loop: reinicia o trecho (troca de vídeo, sem re-buscar o visível)
        else {
          var wasPlaying = !m.paused;
          if (wasPlaying) { try { m.pause(); } catch (e) {} }
          this._seek(s.tEnd);
          // trecho acabou: re-pré-busca (o vídeo que tocou vira buffer e volta pro início) → replay instantâneo.
          if (wasPlaying) { var self2 = this; setTimeout(function () { if (P.Segmenter.media && P.Segmenter.media.paused) self2._prefetchAdjacent(); }, 60); }
        }
      } else if (!m.paused && this._now() < s.tStart) { this._seek(s.tStart); }
    },
    _refreshWave: function () { this._lastWaveCur = null; this._drawWave(); },
    // Clique na onda: leva a agulha ao ponto clicado DENTRO do trecho (busca fina, sem alterar tocar/pausar).
    _seekWave: function (e) {
      var cv = document.getElementById("hud-wave"), t = this.activeLayer(), m = this.media();
      var s = t && t.segments && t.segments[this.cursor >= 0 ? this.cursor : 0];
      if (!cv || !s || !m || !isFinite(s.tStart) || !isFinite(s.tEnd) || s.tEnd <= s.tStart) return;
      var r = cv.getBoundingClientRect(); if (!r.width) return;
      var frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this._seek(s.tStart + frac * (s.tEnd - s.tStart));
      this._refreshWave();
    },
    togglePlayCurrent: function () {
      var m = this.media(); if (!m) return;
      if (this._range && !m.paused) { m.pause(); }
      else if (this._range && m.paused) { m.playbackRate = this.speed; if (P.Segmenter.videoEl) P.Segmenter.videoEl.playbackRate = this.speed; m.play(); this._watch(); }
      else { this.playSegment(this.cursor >= 0 ? this.cursor : 0); }
    },
    moveCursor: function (d, play) {
      var t = this.activeLayer(); if (!t || !t.segments.length) return;
      var ni = Math.max(0, Math.min(t.segments.length - 1, (this.cursor < 0 ? -d : this.cursor) + d));
      this.setCursor(ni);   // realce incremental + rola pra linha + redesenha onda, sem reconstruir a lista
      var row = this.refs.list.querySelectorAll(".tr-row")[ni];
      if (row) { var ed = row.querySelector("textarea,select,input"); if (ed) ed.focus(); }
      if (play) this.playSegment(ni);
    },
    _saveFocused: function () {
      var el = document.activeElement, t = this.activeLayer(); if (!el || !el.dataset || !t) return;
      if (el.dataset.t != null) { var s = t.segments[+el.dataset.t]; if (s) { s.value = el.value; s.locked = true; } }
      else if (el.dataset.v != null) { var s2 = t.segments[+el.dataset.v]; if (s2) s2.value = el.value; }
      else if (el.dataset.pi != null) { this._savePractice(t, el); }
    },
    // Está o foco num campo de texto (livre/prática)? Aí dígitos e L são digitados, não atalhos.
    _inTextField: function () {
      var el = document.activeElement; if (!el) return false;
      return el.tagName === "TEXTAREA" || el.tagName === "INPUT";
    },
    toggleLoop: function () {
      this.loop = !this.loop;
      if (this.refs.loop) this.refs.loop.checked = this.loop;
      this._status(this.loop ? "Loop ligado: o trecho repete." : "Loop desligado.", this.loop ? "work" : "");
    },
    // --- Transporte da aba ② (velocidade, meio segundo, pedal de teclado) ---
    _curSeg: function () { var t = this.activeLayer(); return t && t.segments ? t.segments[this.cursor >= 0 ? this.cursor : 0] : null; },
    // Avança/recua sem sair do trecho atual (regra da aba ②: nunca exceder [tStart,tEnd]). Sincroniza vídeo e onda.
    _nudge: function (dt) {
      var m = this.media(); if (!m) return;
      var s = this._curSeg(), lo = s && isFinite(s.tStart) ? s.tStart : 0, hi = s && isFinite(s.tEnd) ? s.tEnd : (isFinite(m.duration) ? m.duration - this._off() : 1e9);
      this._seek(Math.max(lo, Math.min(hi, this._now() + dt)));
      if (P.Segmenter && P.Segmenter.syncVideo) P.Segmenter.syncVideo(true);
      this._refreshWave();
    },
    // Atalho de velocidade (Shift+↑/↓): anda SÓ nas velocidades da minitoolbar (0,5/1/1,5/2). A lista #tr-speed mantém
    // os passos finos (0,75/1,25) para escolha manual; o atalho ignora esses e salta pro degrau vizinho da minitoolbar
    // (partindo de 0,75/1,25 também). Assim o botão do HUD sempre acende no atalho.
    _nudgeSpeed: function (dir) {
      var steps = [0.5, 1, 1.5, 2], cur = this.speed, next = null, i;
      if (dir > 0) { for (i = 0; i < steps.length; i++) { if (steps[i] > cur + 1e-6) { next = steps[i]; break; } } if (next == null) next = steps[steps.length - 1]; }
      else { for (i = steps.length - 1; i >= 0; i--) { if (steps[i] < cur - 1e-6) { next = steps[i]; break; } } if (next == null) next = steps[0]; }
      this.setSpeed(next);
      this._status("Velocidade " + String(this.speed).replace(".", ",") + "×", "");
    },
    // Fonte única de velocidade da aba ②: aplica à mídia + pool de vídeo E reflete no seletor #tr-speed e nos
    // botões de velocidade do HUD/min-toolbar (P.Segmenter.setSpeed realça o .speed-btn que casa e propaga ao pool).
    setSpeed: function (v) {
      this.speed = v;
      if (this.refs.speed) this.refs.speed.value = String(v);
      if (P.Segmenter && P.Segmenter.setSpeed) P.Segmenter.setSpeed(v);
      else if (this.media()) this.media().playbackRate = v;
    },
    // Pedal de transcrição no teclado: reusa as ações do P.Pedal (segurar = tocar; soltar = pausar + retroceder).
    _pedalKey: function () { var b = (P.Keys && P.Keys.binding) ? P.Keys.binding().trPedal : ""; if (!b) return ""; var p = b.split("+"); return p[p.length - 1]; },
    _pedalDown: function () { if (this._pdown) return; this._pdown = true; if (P.Pedal && P.Pedal.press) P.Pedal.press(); },
    _pedalUp: function () { if (!this._pdown) return; this._pdown = false; if (P.Pedal && P.Pedal.release) P.Pedal.release(); },
    onKeyUp: function (e) {
      if (!document.getElementById("view-transcricao").classList.contains("active")) return;
      var pk = this._pedalKey();
      if (pk && e.code === pk && this._pdown) { e.preventDefault(); this._pedalUp(); }
    },
    // Codifica a linha focada com o n-ésimo código do vocabulário (só camada de vocabulário) e avança sem tocar.
    assignCode: function (n) {
      var t = this.activeLayer();
      if (!t || t.kind !== "controlled") return false;
      var v = t.vocab && t.vocab[n - 1];
      if (!v) return false;
      if (this.cursor < 0) this.cursor = 0;
      var s = t.segments[this.cursor];
      if (!s) return false;
      s.value = v.code;
      this._commit();
      this._status("Trecho " + (this.cursor + 1) + ": " + v.code + (v.label ? " (" + v.label + ")" : ""), "ok");
      this.moveCursor(1, false);
      return true;
    },
    renderShortcuts: function (t) {
      var host = document.getElementById("tr-shortcuts"); if (!host) return;
      var isPractice = t && t.kind === "practice";
      // Lê a tecla atual do P.Keys (reflete remapeamentos feitos em Configurações).
      function k(id, fb) { var b = (P.Keys && P.Keys.binding) ? P.Keys.binding()[id] : null; return b ? P.Keys.pretty(b) : fb; }
      var rows = [
        [k("trPlay", "Tab"), "Reproduz e pausa o trecho"],
        [k("trRepeat", "Shift + Tab"), "Repete do início"],
        isPractice ? ["Enter", "Avança: início, fim, comportamento"] : ["Enter", "Salva e vai ao próximo, tocando"],
        isPractice ? ["Shift + Enter", "Volta um campo"] : ["Shift + Enter", "Volta um trecho"],
        [k("trPrevSeg", "Alt + ↑") + " / " + k("trNextSeg", "Alt + ↓"), "Navega entre trechos"],
        [k("trSpeedDown", "Shift + ↓") + " / " + k("trSpeedUp", "Shift + ↑"), "Desacelera e acelera"],
        [k("trHalfBack", "Alt + ←") + " / " + k("trHalfFwd", "Alt + →"), "Meio segundo (dentro do trecho)"],
        [k("trLoop", "L"), "Liga e desliga o loop"],
        [k("trPedal", "Espaço"), "Pedal: segure para tocar, solte para pausar"],
        [k("trUndo", "Ctrl + Z") + " / " + k("trRedo", "Ctrl + Shift + Z"), "Desfazer e refazer"],
        [k("trCopyPrev", "Alt + C"), "Repetir o trecho anterior"],
        [k("trStop", "Esc"), "Para a reprodução"]
      ];
      var html = '<div class="hint" style="line-height:2.1">' + rows.map(function (r) {
        return '<kbd>' + P.escapeHtml(r[0]) + '</kbd> ' + P.escapeHtml(r[1]);
      }).join("<br>") + '</div>';
      var hasVocab = t && (t.kind === "controlled" || isPractice) && t.vocab && t.vocab.length;
      if (hasVocab) {
        html += '<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">' +
          '<div class="hint" style="margin-bottom:6px">' + (isPractice ? "No campo «comp.», teclas de código:" : "Códigos rápidos, na linha em foco:") + '</div>';
        t.vocab.slice(0, 9).forEach(function (v, i) {
          var color = v.color || P.GCP.colorFor.call(P.GCP, v.code, i);
          html += '<div class="tr-shortcut-code"><kbd>' + (i + 1) + '</kbd>' +
            '<span class="swatch" style="background:' + color + '"></span>' +
            '<span>' + P.escapeHtml(v.code) + (v.label ? ' · ' + P.escapeHtml(v.label) : '') + '</span></div>';
        });
        if (t.vocab.length > 9) html += '<div class="hint" style="margin-top:4px">Demais códigos: use o campo na linha.</div>';
        html += '</div>';
      }
      if (isPractice) {
        html += '<div class="hint" style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">Digite o <b>início</b> e o <b>fim</b> em compasso (Enter passa de um ao outro; a duração é calculada); no comportamento, <kbd>1</kbd>–<kbd>9</kbd> escolhe o código e pula para a próxima linha. A observação fica de fora: clique nela quando precisar.</div>';
      } else if (t && t.kind === "free") {
        html += '<div class="hint" style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">Camada de texto livre: digite a transcrição e use <kbd>Enter</kbd> para salvar e seguir.</div>';
      }
      host.innerHTML = html;
    },

    // Enter na camada de prática: caminha início → fim → comportamento; depois pula para a próxima linha (sem a observação).
    _onEnterPractice: function (t) {
      var el = document.activeElement;
      if (el && el.dataset && el.dataset.pi != null && el.dataset.i != null) {
        this._savePractice(t, el);
        var i = +el.dataset.i, f = el.dataset.pi;
        this._refreshDur(t, i); this._setProgress(t);
        if (f === "ini") this.focusField(i, "fim");
        else if (f === "fim") this.focusField(i, "comp");
        else this._practiceNextRow(i);
      } else {
        this.focusField(this.cursor < 0 ? 0 : this.cursor, "ini");
      }
    },
    // Shift+Enter na prática: volta um campo (observação → comportamento → fim → início) e, no início, sobe para o comportamento da linha anterior.
    _onShiftEnterPractice: function (t) {
      var el = document.activeElement;
      if (el && el.dataset && el.dataset.pi != null && el.dataset.i != null) {
        this._savePractice(t, el);
        var i = +el.dataset.i, f = el.dataset.pi;
        this._refreshDur(t, i); this._setProgress(t);
        if (f === "obs") this.focusField(i, "comp");
        else if (f === "comp") this.focusField(i, "fim");
        else if (f === "fim") this.focusField(i, "ini");
        else this._practicePrevRow(i);
      } else {
        this.focusField(this.cursor < 0 ? 0 : this.cursor, "comp");
      }
    },
    // Sobe para o comportamento da linha anterior (par do _practiceNextRow).
    _practicePrevRow: function (i) {
      var t = this.activeLayer(); if (!t) return;
      if (i - 1 < 0) { this._status("Primeira linha desta camada.", ""); this.focusField(i, "ini"); return; }
      this.focusField(i - 1, "comp");
    },

    onKey: function (e) {
      if (!document.getElementById("view-transcricao").classList.contains("active")) return;
      // 0) Teclas do numérico (mão no numpad) OU letras Q/W/E/R/T (para quem não tem numérico). Nunca em campo de
      //    texto (deixa digitar) nem com Ctrl/Alt/Meta.
      var inText0 = this._inTextField(), plain0 = !e.ctrlKey && !e.altKey && !e.metaKey;
      if (plain0 && !inText0) {
        if (e.code === "Numpad0") {   // copiar/repetir o trecho anterior (numérico, em qualquer modo de prática)
          var tl0 = this.activeLayer(); if (tl0 && tl0.kind === "practice") { e.preventDefault(); this._copyPrevSegment(); return; }
        }
        if (this._clickMode) {   // no modo de clique: apara o fim pela figura tocada; T repete o anterior (alt. sem numpad)
          if (e.code === "NumpadDivide" || e.code === "KeyQ") { e.preventDefault(); this._endFig = 1; this._applyEndFig(); return; }        // semínima
          if (e.code === "NumpadMultiply" || e.code === "KeyW") { e.preventDefault(); this._endFig = 0.5; this._applyEndFig(); return; }    // colcheia
          if (e.code === "NumpadSubtract" || e.code === "KeyE") { e.preventDefault(); this._endFig = 0.25; this._applyEndFig(); return; }   // semicolcheia
          if (e.code === "NumpadAdd" || e.code === "KeyR") { e.preventDefault(); this._endDot = !this._endDot; this._applyEndFig(); return; }   // ponto (antes ou depois)
          if (e.code === "KeyT") { e.preventDefault(); this._copyPrevSegment(); return; }                              // copiar (só no modo interativo)
        }
      }
      // 1) Semântica de edição (não remapeável): Enter caminha campos/linhas; 1–9 codifica a linha em foco.
      var isEnter = (e.code === "Enter" || e.code === "NumpadEnter");   // Enter do teclado numérico faz o mesmo
      // Enter num botão/caixa/lista focado aciona o próprio controle (não avança nem toca o próximo trecho)
      var tgE = e.target, tagE = tgE && tgE.tagName;
      if (isEnter && (tagE === "BUTTON" || tagE === "SELECT" || (tagE === "INPUT" && /^(checkbox|radio|button|submit|color|range|file)$/i.test(tgE.type)))) return;
      if (isEnter && !e.shiftKey) {
        e.preventDefault();
        var te = this.activeLayer();
        if (te && te.kind === "practice") { this._onEnterPractice(te); return; }
        this._saveFocused(); this.moveCursor(1, true); return;
      }
      if (isEnter && e.shiftKey) {
        e.preventDefault();
        var tse = this.activeLayer();
        if (tse && tse.kind === "practice") { this._onShiftEnterPractice(tse); return; }
        this._saveFocused(); this.moveCursor(-1, true); return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && /^(Digit|Numpad)[1-9]$/.test(e.code)) {
        var t = this.activeLayer(), el = document.activeElement, n = +e.code.slice(-1);
        if (this._clickMode && t && t.kind === "practice") { e.preventDefault(); this._clickAssignCode(n); return; }   // modo de clique: grava e avança
        if (t && t.kind === "controlled" && !this._inTextField()) { e.preventDefault(); this.assignCode(n); return; }
        if (t && t.kind === "practice" && el && el.dataset && el.dataset.pi === "comp") { e.preventDefault(); this.assignPracticeCode(+el.dataset.i, n); return; }
      }
      // 2) Transporte remapeável (escopo "tr" do P.Keys): play/repete/navega/velocidade/meio-segundo/loop/parar/pedal.
      var act = (P.Keys && P.Keys.actionFor) ? P.Keys.actionFor(e, "tr") : null;
      if (!act) return;
      // Tecla "nua" do pedal (Espaço) não dispara enquanto se digita num campo, para não engolir a digitação.
      if (act === "trPedal" && this._inTextField()) return;
      switch (act) {
        case "trPlay": e.preventDefault(); this.togglePlayCurrent(); break;
        case "trRepeat": e.preventDefault(); if (this.cursor >= 0) this.playSegment(this.cursor); break;
        case "trPrevSeg": e.preventDefault(); this._saveFocused(); this.moveCursor(-1, true); break;   // Alt+↑/↓ navega E toca o trecho
        case "trNextSeg": e.preventDefault(); this._saveFocused(); this.moveCursor(1, true); break;
        case "trSpeedUp": e.preventDefault(); this._nudgeSpeed(1); break;
        case "trSpeedDown": e.preventDefault(); this._nudgeSpeed(-1); break;
        case "trHalfBack": e.preventDefault(); this._nudge(-0.5); break;
        case "trHalfFwd": e.preventDefault(); this._nudge(0.5); break;
        case "trLoop": e.preventDefault(); this.toggleLoop(); break;
        case "trStop": this.stop(); break;
        case "trPedal": e.preventDefault(); this._pedalDown(); break;
        case "trUndo": e.preventDefault(); this._undo(); break;
        case "trRedo": e.preventDefault(); this._redo(); break;
        case "trCopyPrev": e.preventDefault(); this._copyPrevSegment(); break;
      }
    }
  };

  P.Transcript = T;
})(window.Praxis = window.Praxis || {});
