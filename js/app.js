/* app.js - bootstrap: abas, tema, controles do GCP, importação CSV, integração A→B. */
(function (P) {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var gcpLoaded = false;
  var _conjColors = {};   // conjuntoId → cor (agrupamento visual das abas)
  var _dragTabId = null;  // aba sendo arrastada (para associar a outro conjunto)
  var outlinePicker = null, secStrokePicker = null, stageLinePicker = null;   // color pickers dos inputs estáticos (contorno / traço de seção / linha de estágio)
  var axisTitleColorPicker = null, secLabelColorPicker = null, stageLabelColorPicker = null;   // color pickers dos rótulos/títulos

  document.addEventListener("DOMContentLoaded", function () {
    // ---- Abas ----
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () { activate(t.dataset.view); });
    });
    function activate(view) {
      try { localStorage.setItem("praxis.ui.view", view); } catch (e) {}
      tabs.forEach(function (t) { t.classList.toggle("active", t.dataset.view === view); });
      document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + view); });
      var ss = $("seg-status"), ts = $("tr-status");
      if (ss) ss.classList.toggle("on", view === "segmentar");
      if (ts) ts.classList.toggle("on", view === "transcricao");
      // HUD flutuante (player) só nas abas sem timeline própria; a Segmentar usa o transporte da timeline.
      var hud = $("hud-transport");
      if (hud) hud.style.display = (view === "segmentar") ? "none" : "flex";
      var hw = $("hud-wave"); if (hw) hw.style.display = (view === "transcricao") ? "block" : "none";   // onda do trecho só na Transcrever
      relocateStage(view);
      if (view !== "transcricao") { if (P.Transcript && P.Transcript.stop) P.Transcript.stop(); if (P.Score && P.Score.setSuppressed) P.Score.setSuppressed(false); }   // fora da aba ②, a partitura segue normal
      if (view !== "multidim" && P.Mdim && P.Mdim.onHide) P.Mdim.onHide();
      if (view === "gcp") refreshGcpView();
      else if (view === "transcricao") P.Transcript.onShow();
      else if (view === "multidim") { if (P.Mdim && P.Mdim.onShow) P.Mdim.onShow(); }
      else if (view === "segmentar" && P.Timeline.host) P.Timeline.render();
    }
    P._activate = activate;
    P._refreshGcp = function () {   // hook p/ o Segmenter atualizar as abas do gráfico ao abrir projeto
      var v = $("view-gcp");
      if (v && v.classList.contains("active")) refreshGcpView();
      else { renderGcpTabs(); gcpLoaded = P.GCP.docs.length > 0; }   // aba oculta: só as abas (o gráfico renderiza ao entrar)
    };

    // Módulo de mídia visual (vídeo + partitura) é ÚNICO: realocamos o mesmo card vivo entre Segmentar e
    // Transcrever em vez de duplicar. Não dá para tocar a mesma mídia em dois <video>, e mover nós no DOM
    // (appendChild/insertBefore, sem mexer no src) preserva a reprodução. A sincronia da partitura com a
    // agulha já é global (renderPlayhead no timeupdate/rAF), e o ResizeObserver da partitura refaz o layout
    // sozinho quando a largura do container muda.
    var _stageHome = null, _stageAnchor = null, _modHome = null, _modAnchor = null;
    (function () {
      var card = document.querySelector(".seg-stage-card");
      if (card) { _stageHome = card.parentNode; _stageAnchor = card.nextSibling; }
      var mp = document.getElementById("mod-panel");   // painel "Módulos de visualização" no inspetor do Segmentar
      if (mp) { _modHome = mp.parentNode; _modAnchor = mp.nextSibling; }
    })();
    function relocateStage(view) {
      var card = document.querySelector(".seg-stage-card"); if (!card) return;
      // Multidim tem LAYOUT próprio (independente); Segmentar/Transcrever compartilham o "main".
      if (P.StageLayout && P.StageLayout.useContext) P.StageLayout.useContext(view === "multidim" ? "mdim" : "main");
      var trHost = $("tr-stage-host"), mdHost = $("mdim-stage-host");
      if (view === "transcricao") { if (trHost && card.parentNode !== trHost) trHost.appendChild(card); }
      else if (view === "multidim") { if (mdHost && card.parentNode !== mdHost) mdHost.appendChild(card); }
      else if (_stageHome && card.parentNode !== _stageHome) { _stageHome.insertBefore(card, _stageAnchor); }
      // o menu de módulos acompanha a aba que tem layout PRÓPRIO (Multidim); nas demais volta ao inspetor do Segmentar
      var mp = document.getElementById("mod-panel"), mdSlot = $("mdim-mod-slot");
      if (mp) {
        if (view === "multidim") { if (mdSlot && mp.parentNode !== mdSlot) mdSlot.appendChild(mp); }
        else if (_modHome && mp.parentNode !== _modHome) { _modHome.insertBefore(mp, _modAnchor); }
      }
      // largura do container mudou → repõe o layout da partitura (Display quebra compassos por linha).
      if (P.Score && P.Score._raw && P.Score.render && P.Score.viewMode !== "page") setTimeout(function () { P.Score.render(); }, 60);
    }

    // ---- Tema ----
    $("theme-toggle").addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme");
      var next = cur === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("praxis.ui.theme", next); } catch (e) {}
      if (gcpLoaded && $("view-gcp").classList.contains("active")) renderGcp();
      if (P.SegGCP && P.SegGCP.render) P.SegGCP.render();   // o gráfico da Segmentar re-renderiza p/ acompanhar o tema (o SVG carrega o fundo no render)
      if ($("view-segmentar").classList.contains("active") && P.Timeline.host) P.Timeline.render();
      if ($("view-multidim").classList.contains("active") && P.Mdim && P.Mdim.render) P.Mdim.render();
    });

    // ---- Configurações (modal) + editor de atalhos ----
    (function () {
      var modal = $("settings-modal"); if (!modal || !P.Keys) return;
      function pretty(c) { return P.Keys.pretty(c); }
      function renderShortcuts() {
        var panel = $("settings-shortcuts"); if (!panel) return;
        var acts = P.Keys.actions(), bind = P.Keys.binding(), cats = [], byCat = {};
        acts.forEach(function (a) { if (!byCat[a.cat]) { byCat[a.cat] = []; cats.push(a.cat); } byCat[a.cat].push(a); });
        var html = '<div class="sc-hint">Clique numa tecla e pressione a nova combinação. Esc cancela a captura.</div>';
        cats.forEach(function (cat) {
          html += '<div class="sc-cat">' + cat + '</div>';
          byCat[cat].forEach(function (a) {
            html += '<div class="sc-row"><span class="sc-label">' + a.label + '</span><button class="sc-key" data-bind="' + a.id + '">' + pretty(bind[a.id]) + '</button></div>';
          });
        });
        html += '<div class="sc-foot"><button class="btn sm secondary" id="sc-reset">Restaurar padrões</button></div>';
        panel.innerHTML = html;
        panel.querySelectorAll("[data-bind]").forEach(function (b) { b.addEventListener("click", function () { capture(b.dataset.bind, b); }); });
        var rst = $("sc-reset"); if (rst) rst.addEventListener("click", function () { P.Keys.reset(); renderShortcuts(); });
      }
      var capturing = null;
      function capture(id, btn) {
        if (capturing) return;
        capturing = btn; btn.classList.add("capturing"); btn.textContent = "Pressione…";
        function onCap(ev) {
          ev.preventDefault(); ev.stopPropagation();
          if (ev.code === "Escape") { done(); renderShortcuts(); return; }   // cancela
          var c = P.Keys.combo(ev); if (!c) return;   // só modificador: espera a tecla
          P.Keys.set(id, c); done(); renderShortcuts();
        }
        function done() { document.removeEventListener("keydown", onCap, true); btn.classList.remove("capturing"); capturing = null; }
        document.addEventListener("keydown", onCap, true);
      }
      // Painel de Cifragem: escolhe a grafia das cifras da partitura (padrão global, via P.Score + Grafia).
      function renderCifragem() {
        var panel = $("settings-cifragem"); if (!panel) return;
        var G = window.Grafia;
        if (!G || !P.Score) { panel.innerHTML = '<div class="sc-hint">Cifragem indisponível.</div>'; return; }
        var cur = P.Score.notation;
        var opts = [
          { id: "original",     name: "Original",         desc: "Mostra a cifra exatamente como veio no arquivo, o que o participante viu. Padrão (fidelidade)." },
          { id: "chediak",      name: "Chediak",          desc: "Cifragem brasileira (Almir Chediak)." },
          { id: "chediak-sign", name: "Chediak (sinais)",  desc: "Chediak com alterações como sinal (9-, 11+)." },
          { id: "jazz",         name: "Jazz",              desc: "Convenção anglófona corrente." },
          { id: "realbook",     name: "Real Book",         desc: "Símbolos do Real Book." },
          { id: "compacta",     name: "Compacta",          desc: "Maj7, tensões entre parênteses, 6/9 empilhado (atípica)." }
        ];
        var samples = ["maj7", "7b9", "m7b5", "69"];
        var html = '<div class="sc-hint">Como as cifras aparecem na partitura. Vale para todas as partituras (padrão global). Reescrever a grafia muda só a forma, não as notas; para análise fiel ao que o participante viu, use <b>Original</b>.</div><div class="notation-list">';
        opts.forEach(function (o) {
          var ex = o.id === "original"
            ? '<span class="nt-note">como no arquivo</span>'
            : samples.map(function (t) { return G.html({ root: "C", type: t, notation: o.id }) || ""; }).join(' <span class="nt-sep">·</span> ');
          html += '<label class="notation-opt' + (o.id === cur ? " sel" : "") + '">' +
            '<input type="radio" name="notation" value="' + o.id + '"' + (o.id === cur ? " checked" : "") + '>' +
            '<span class="nt-body"><span class="nt-head"><span class="nt-name">' + o.name + '</span><span class="nt-sample">' + ex + '</span></span>' +
            '<span class="nt-desc">' + o.desc + '</span></span></label>';
        });
        html += '</div>';
        panel.innerHTML = html;
        panel.querySelectorAll('input[name="notation"]').forEach(function (r) {
          r.addEventListener("change", function () { if (P.Score.setNotation) P.Score.setNotation(this.value); renderCifragem(); });
        });
      }
      // Painel de Pedal: pedal de transcrição hands-free via Web MIDI (pedal de sustain do piano digital).
      var pedLearning = false;
      function renderPedal() {
        var panel = $("settings-pedal"); if (!panel) return;
        var Pedal = P.Pedal;
        if (!Pedal) { panel.innerHTML = '<div class="sc-hint">Pedal indisponível.</div>'; return; }
        var intro = '<div class="sc-hint">Controle a mídia com o pé usando o pedal de sustain do seu piano digital (MIDI): pisar toca, soltar pausa e rebobina um pouco para você reouvir. Vale nas duas telas.</div>';
        if (!Pedal.available()) {
          panel.innerHTML = intro + '<div class="field"><label style="color:var(--danger)">Web MIDI indisponível</label><div class="hint">Este navegador não tem Web MIDI. Use Chrome ou Edge para o pedal do piano.</div></div>';
          return;
        }
        var devs = Pedal.inputList();
        var html = intro;
        html += '<div class="field"><div class="ped-row">'
          + '<button class="btn sm' + (Pedal.connected ? ' secondary' : '') + '" id="ped-connect">' + (Pedal.connected ? 'Reconectar' : 'Conectar pedal MIDI') + '</button>'
          + '<span class="ped-status' + (Pedal.connected ? ' on' : '') + '" id="ped-status">' + (Pedal.connected ? (devs.length + ' dispositivo(s)') : 'desconectado') + '</span></div></div>';
        if (Pedal.connected) {
          html += '<div class="field"><label>Dispositivo de entrada</label><select id="ped-device"><option value="">Todos</option>'
            + devs.map(function (d) { return '<option value="' + P.escapeHtml(d.id) + '"' + (d.id === Pedal.deviceId ? ' selected' : '') + '>' + P.escapeHtml(d.name || d.id) + '</option>'; }).join('')
            + '</select>' + (devs.length ? '' : '<div class="hint">Nenhum dispositivo detectado. Confira se o piano está ligado e com a saída MIDI ativa.</div>') + '</div>';
          html += '<div class="field"><label>Sinal MIDI (controlador atual do pedal: ' + Pedal.cc + ')</label>'
            + '<div class="ped-row"><span class="ped-monitor" id="ped-monitor">aguardando o pedal</span>'
            + '<button class="btn sm ghost" id="ped-learn">Aprender pedal</button></div>'
            + '<div class="hint">Se o pedal não responde, clique em Aprender e pise. O Praxis captura o controlador que o seu piano envia.</div></div>';
        }
        html += '<div class="field"><label>Modo</label>'
          + '<label class="ped-opt"><input type="radio" name="ped-mode" value="momentary"' + (Pedal.mode === "momentary" ? " checked" : "") + '><span><b>Momentâneo.</b> Segura para tocar, solta para pausar.</span></label>'
          + '<label class="ped-opt"><input type="radio" name="ped-mode" value="toggle"' + (Pedal.mode === "toggle" ? " checked" : "") + '><span><b>Alterna.</b> Pisa para tocar, pisa de novo para pausar.</span></label></div>';
        html += '<div class="field"><label>Auto-retrocesso ao pausar <span class="ped-val" id="ped-rewval">' + (Pedal.rewindMs / 1000).toFixed(1) + ' s</span></label><input type="range" id="ped-rewind" min="0" max="4000" step="100" value="' + Pedal.rewindMs + '"></div>';
        html += '<label class="ped-opt"><input type="checkbox" id="ped-extra"' + (Pedal.extra ? " checked" : "") + '><span>Pedais sostenuto e una corda rebobinam e avançam ' + (Pedal.shuttleMs / 1000).toFixed(0) + ' s.</span></label>';
        panel.innerHTML = html;

        var cbtn = $("ped-connect");
        if (cbtn) cbtn.addEventListener("click", function () {
          cbtn.disabled = true; cbtn.textContent = "Conectando";
          Pedal.connect().then(function (res) { if (!res.ok) alert(res.msg); renderPedal(); });
        });
        Pedal.onDevices = function () { var p = $("settings-pedal"); if (p && !p.hidden) renderPedal(); };
        Pedal.onSignal = function (kind) {
          var mon = $("ped-monitor"); if (!mon) return;
          mon.textContent = kind === "down" ? "tocando" : kind === "up" ? "pausou e rebobinou" : kind === "rew" ? "rebobinou" : "avançou";
          mon.classList.add("hit"); clearTimeout(mon._t); mon._t = setTimeout(function () { mon.classList.remove("hit"); }, 500);
        };
        Pedal.onRaw = function (d) {
          var mon = $("ped-monitor"), st = d[0] & 0xF0, v = d.length > 2 ? d[2] : 0;
          if (mon) mon.textContent = st === 0xB0 ? ("controlador " + d[1] + " = " + v) : (st === 0x90 || st === 0x80) ? ("nota " + d[1]) : ("status 0x" + d[0].toString(16));
          if (pedLearning && st === 0xB0 && v >= 64) { Pedal.cc = d[1]; Pedal.save(); pedLearning = false; renderPedal(); }
        };
        var dev = $("ped-device"); if (dev) dev.addEventListener("change", function () { Pedal.deviceId = this.value; Pedal.save(); Pedal._bindInputs(); });
        var lb = $("ped-learn"); if (lb) lb.addEventListener("click", function () { pedLearning = true; lb.textContent = "Pise o pedal"; lb.classList.add("capturing"); });
        panel.querySelectorAll('input[name="ped-mode"]').forEach(function (r) { r.addEventListener("change", function () { Pedal.mode = this.value; Pedal.save(); }); });
        var rew = $("ped-rewind"); if (rew) rew.addEventListener("input", function () { Pedal.rewindMs = +this.value; var vv = $("ped-rewval"); if (vv) vv.textContent = (Pedal.rewindMs / 1000).toFixed(1) + " s"; Pedal.save(); });
        var ex = $("ped-extra"); if (ex) ex.addEventListener("change", function () { Pedal.extra = this.checked; Pedal.save(); });
      }
      function showPanel(name) {
        modal.querySelectorAll(".settings-tab").forEach(function (x) { x.classList.toggle("active", x.dataset.panel === name); });
        var sh = $("settings-shortcuts"), cf = $("settings-cifragem"), pd = $("settings-pedal");
        if (sh) sh.hidden = name !== "shortcuts";
        if (cf) cf.hidden = name !== "cifragem";
        if (pd) pd.hidden = name !== "pedal";
        if (name === "shortcuts") renderShortcuts(); else if (name === "cifragem") renderCifragem(); else if (name === "pedal") renderPedal();
      }
      modal.querySelectorAll(".settings-tab").forEach(function (tb) { tb.addEventListener("click", function () { showPanel(tb.dataset.panel); }); });

      function open() { modal.hidden = false; showPanel("shortcuts"); }
      function close() { modal.hidden = true; }
      var btn = $("settings-btn"); if (btn) btn.addEventListener("click", open);
      var cls = $("settings-close"); if (cls) cls.addEventListener("click", close);
      modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
      document.addEventListener("keydown", function (e) { if (!modal.hidden && e.code === "Escape" && !capturing) close(); });
    })();

    // ---- Módulo A ----
    P.Segmenter.init({
      drop: $("seg-drop"), fileInput: $("seg-file"), player: $("seg-player-content"), status: $("seg-status"),
      playBtn: $("seg-play"), toStart: $("seg-tostart"),
      nav: Array.prototype.slice.call(document.querySelectorAll(".seg-nav")),
      speed: Array.prototype.slice.call(document.querySelectorAll(".speed-btn")),
      timeCur: $("seg-tcur"), timeDur: $("seg-tdur"),
      segMode: $("seg-mode"), delay: $("seg-delay"), delayVal: $("seg-delayval"),
      tiers: $("seg-tiers"), addTier: $("seg-addtier"),
      picker: $("seg-picker"), whisperBtn: $("seg-whisper"),
      whisperPause: $("seg-whisper-pause"), whisperHere: $("seg-whisper-here"),
      merge: $("seg-merge"), mergeVal: $("seg-mergeval"),
      timeline: $("seg-timeline"), listTitle: $("seg-listtitle"),
      listHost: $("seg-listhost"), segCount: $("seg-count"),
      split: $("seg-split"), blade: $("seg-blade"), mergePrev: $("seg-mergeprev"), mergeNext: $("seg-mergenext"), resetWhisper: $("seg-resetwhisper"),
      saveProject: $("proj-save"), openProject: $("proj-open"), openProjectFile: $("proj-file")
    }, function (data) {
      // "Gerar gráfico a partir dos dados transcritos": preenche a aba atual (cria uma se não houver).
      openGcpData(data, {});
    });

    // ---- Timeline: barra de ferramentas ----
    P.Timeline.onRender = function () { var z = $("tl-zoompct"); if (z) z.textContent = P.Timeline.zoomPct() + "%"; };
    $("tl-zoomin").addEventListener("click", function () { P.Timeline.zoomBy(1.3); });
    $("tl-zoomout").addEventListener("click", function () { P.Timeline.zoomBy(1 / 1.3); });
    $("tl-zoomreset").addEventListener("click", function () { P.Timeline.zoomReset(); });
    $("tl-fit").addEventListener("click", function () { P.Timeline.zoomFit(); });
    $("tl-prev").addEventListener("click", function () { P.Timeline.pagePrev(); });
    $("tl-next").addEventListener("click", function () { P.Timeline.pageNext(); });
    $("tl-link").addEventListener("click", function () { var on = !P.Timeline.linkPlayer; P.Timeline.setLinkPlayer(on); this.classList.toggle("active", on); this.title = on ? "Vincular a rolagem ao player (a vista segue a agulha). Desative para rolar livre." : "Rolagem livre. Ative para a vista seguir a agulha do player."; });
    $("tl-amp").addEventListener("input", function () { P.Timeline.setAmplitude(parseFloat(this.value)); });
    $("tl-lh").addEventListener("input", function () { P.Timeline.setLayerH(parseInt(this.value, 10)); });
    // HUD (player das outras abas): play/início; navegação e velocidade já vêm pelas classes .seg-nav/.speed-btn
    if ($("hud-play")) $("hud-play").addEventListener("click", function () { P.Segmenter.togglePlay(); });
    if ($("hud-tostart")) $("hud-tostart").addEventListener("click", function () { if (P.Segmenter.media) P.Segmenter.seekTo(0); });
    // (O resizer de largura antigo foi substituído pelos resizers de coluna do engine de blocos abaixo.)
    // Splitter vertical (altura de todo o palco de módulos, persistente)
    (function () {
      var rz = $("stage-vresizer"), stage = document.querySelector(".seg-stage"); if (!rz || !stage) return;
      function curH() { var v = parseInt(getComputedStyle(stage).getPropertyValue("--stage-h"), 10); return isNaN(v) ? 320 : v; }
      function setH(h) { stage.style.setProperty("--stage-h", h + "px"); }
      try { var sh = localStorage.getItem("praxis.stage.h"); if (sh) setH(parseInt(sh, 10)); } catch (e) {}
      var drag = null;
      rz.addEventListener("mousedown", function (e) { e.preventDefault(); drag = { y0: e.clientY, h0: curH() }; document.body.style.cursor = "row-resize"; });
      window.addEventListener("mousemove", function (e) { if (!drag) return; setH(Math.max(120, Math.min(900, drag.h0 + (e.clientY - drag.y0)))); });
      window.addEventListener("mouseup", function () { if (!drag) return; drag = null; document.body.style.cursor = ""; try { localStorage.setItem("praxis.stage.h", curH()); } catch (e) {} });
    })();
    // Palco de módulos (vídeo/partitura/gráfico) como BLOCOS: colunas com módulos empilháveis; resizer entre
    // colunas (largura) e entre módulos empilhados (altura); arrastar o cabeçalho move/empilha/cria coluna;
    // menu do inspetor habilita/desabilita; olho recolhe (barrinha). Recolhidos vão p/ um holder oculto
    // (fica no DOM → o áudio do vídeo continua mesmo com o vídeo oculto).
    (function () {
      var stage = document.querySelector(".seg-stage"), list = $("seg-collapsed-list"); if (!stage || !list) return;
      var holder = document.createElement("div"); holder.style.display = "none"; stage.parentNode.appendChild(holder);
      P._graphHolder = holder;   // o gerente de gráficos parqueia painéis novos aqui até o palco posicioná-los
      // Vídeo e partitura são fixos; os módulos de GRÁFICO entram/saem dinamicamente (registerGraphMod).
      var MODS = [
        { id: "video", title: "Vídeo", chk: "mod-video", el: stage.querySelector(".player-wrap"), body: $("seg-player-content"), collapseBtn: "video-hide",
          isCollapsed: function () { return !!this.el && this.el.classList.contains("media-hidden"); },
          expand: function () { if (P.Segmenter && P.Segmenter.toggleVideoHidden) P.Segmenter.toggleVideoHidden(); } },
        { id: "score", title: "Partitura", chk: "mod-score", el: stage.querySelector(".score-pane"), body: $("seg-score"), collapseBtn: "score-collapse",
          isCollapsed: function () { return stage.classList.contains("score-collapsed"); },
          expand: function () { if (P.Score && P.Score.toggleCollapsed) P.Score.toggleCollapsed(); } }
      ];
      function isGraph(id) { return /^gcp/.test(id); }
      function byId(id) { for (var i = 0; i < MODS.length; i++) if (MODS[i].id === id) return MODS[i]; return null; }
      var IDS = MODS.map(function (m) { return m.id; });
      function syncIds() { IDS = MODS.map(function (m) { return m.id; }); }
      MODS.forEach(function (m) { if (m.el) m.el.classList.add("stage-pane"); if (m.body) m.body.classList.add("pane-body"); });

      // estado DO PROJETO (salvo no .praxis, não no programa): habilitados (menu), colunas de blocos,
      // larguras de coluna e alturas por módulo. Sem projeto = padrão (gráfico DESLIGADO).
      function defaults() { return { enabled: { video: true, score: true, gcp: false }, cols: [["video"], ["score"], ["gcp"]], colW: {}, paneH: {}, rowW: {} }; }
      var enabled, cols, colW, paneH, rowW;
      function colsHave(id) { return cols.some(function (c) { return c.some(function (it) { return (typeof it === "string") ? it === id : it.indexOf(id) >= 0; }); }); }
      function setState(st) {
        st = st || defaults();
        enabled = {};
        IDS.forEach(function (k) { enabled[k] = (k === "video" || k === "score"); });   // base: vídeo/partitura ligados, gráficos desligados
        IDS.forEach(function (k) { if (st.enabled && typeof st.enabled[k] === "boolean") enabled[k] = st.enabled[k]; });
        cols = (st.cols && st.cols.length) ? st.cols.map(function (c) {   // itens: painel (string) OU sub-linha (array); filtra ids inexistentes, colapsa sub-linha de 1
          return c.map(function (it) {
            if (typeof it === "string") return byId(it) ? it : null;
            var f = (it || []).filter(byId); return f.length ? (f.length === 1 ? f[0] : f) : null;
          }).filter(function (it) { return it != null; });
        }).filter(function (c) { return c.length; }) : [];
        IDS.forEach(function (id) { if (!colsHave(id)) cols.push([id]); });
        colW = st.colW || {}; paneH = st.paneH || {}; rowW = st.rowW || {};
      }
      setState(null);   // começa nos padrões; o projeto sobrescreve ao abrir
      function save() { }   // estado vive no projeto (serialize/restore abaixo); nada de localStorage
      function visible(id) { return enabled[id] && !byId(id).isCollapsed(); }

      function colSizer(leftCi, rightCi) {
        var rz = document.createElement("div"); rz.className = "stage-colsizer";
        rz.addEventListener("mousedown", function (e) {
          e.preventDefault();
          var cs = Array.prototype.slice.call(stage.querySelectorAll(".stage-col"));
          var L = cs.filter(function (c) { return +c.dataset.ci === leftCi; })[0], R = cs.filter(function (c) { return +c.dataset.ci === rightCi; })[0]; if (!L || !R) return;
          var x0 = e.clientX, lw = L.getBoundingClientRect().width, rw = R.getBoundingClientRect().width; rz.classList.add("dragging"); document.body.style.cursor = "col-resize";
          function mm(ev) { var d = ev.clientX - x0, nl = Math.max(40, lw + d), nr = Math.max(40, rw - d); colW[leftCi] = nl; colW[rightCi] = nr; L.style.flex = nl + " 1 0"; R.style.flex = nr + " 1 0"; }
          function mu() { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); rz.classList.remove("dragging"); document.body.style.cursor = ""; save(); if (P.SegGCP && P.SegGCP.render) P.SegGCP.render(true); }
          window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
        });
        return rz;
      }
      // Sizer VERTICAL entre dois itens de uma coluna (item = painel OU sub-linha). Chaveado pelo 1º pane do item (paneH).
      function vItemSizer(aEl, bEl, aKey, bKey) {
        var rz = document.createElement("div"); rz.className = "stage-panesizer";
        rz.addEventListener("mousedown", function (e) {
          e.preventDefault();
          var y0 = e.clientY, ah = aEl.getBoundingClientRect().height, bh = bEl.getBoundingClientRect().height; rz.classList.add("dragging"); document.body.style.cursor = "row-resize";
          function mm(ev) { var d = ev.clientY - y0, na = Math.max(40, ah + d), nb = Math.max(40, bh - d); paneH[aKey] = na; paneH[bKey] = nb; aEl.style.flex = na + " 1 0"; bEl.style.flex = nb + " 1 0"; }
          function mu() { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); rz.classList.remove("dragging"); document.body.style.cursor = ""; save(); if (P.SegGCP && P.SegGCP.render) P.SegGCP.render(true); }
          window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
        });
        return rz;
      }
      // Sizer HORIZONTAL entre dois painéis DENTRO de uma sub-linha (largura, chaveado por pane id em rowW).
      function subColSizer(leftEl, rightEl, leftId, rightId) {
        var rz = document.createElement("div"); rz.className = "stage-colsizer";
        rz.addEventListener("mousedown", function (e) {
          e.preventDefault();
          var x0 = e.clientX, lw = leftEl.getBoundingClientRect().width, rw = rightEl.getBoundingClientRect().width; rz.classList.add("dragging"); document.body.style.cursor = "col-resize";
          function mm(ev) { var d = ev.clientX - x0, nl = Math.max(40, lw + d), nr = Math.max(40, rw - d); rowW[leftId] = nl; rowW[rightId] = nr; leftEl.style.flex = nl + " 1 0"; rightEl.style.flex = nr + " 1 0"; }
          function mu() { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); rz.classList.remove("dragging"); document.body.style.cursor = ""; save(); if (P.SegGCP && P.SegGCP.render) P.SegGCP.render(true); }
          window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
        });
        return rz;
      }

      function itemPanes(it) { return (typeof it === "string") ? [it] : it; }   // painéis de um item (string OU sub-linha)
      function itemVisPanes(it) { return itemPanes(it).filter(visible); }
      function buildStage() {
        MODS.forEach(function (m) { if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el); });
        stage.innerHTML = "";
        var visCols = [];
        cols.forEach(function (items, ci) {   // cada coluna é uma lista de ITENS; um item é um painel OU uma sub-linha [a,b] (lado a lado)
          var vitems = [];
          items.forEach(function (it) { var vp = itemVisPanes(it); if (vp.length) vitems.push(vp.length === 1 ? vp[0] : vp); });
          if (vitems.length) visCols.push({ ci: ci, items: vitems });
        });
        visCols.forEach(function (col, vi) {
          var colDiv = document.createElement("div"); colDiv.className = "stage-col"; colDiv.dataset.ci = col.ci;
          colDiv.__panes = []; col.items.forEach(function (it) { itemPanes(it).forEach(function (id) { colDiv.__panes.push(id); }); });
          colDiv.style.flex = (colW[col.ci] || 1) + " 1 0";
          var built = col.items.map(function (it) {
            if (typeof it === "string") {
              var m = byId(it); m.el.style.flex = (paneH[it] || 1) + " 1 0"; m.el.style.maxWidth = "none"; m.el.style.order = "";
              return { el: m.el, key: it };
            }
            var row = document.createElement("div"); row.className = "stage-subrow"; row.style.flex = (paneH[it[0]] || 1) + " 1 0";
            it.forEach(function (id, si) {
              var mm = byId(id); mm.el.style.flex = (rowW[id] || 1) + " 1 0"; mm.el.style.maxWidth = "none"; mm.el.style.order = "";
              row.appendChild(mm.el);
              if (si < it.length - 1) row.appendChild(subColSizer(mm.el, byId(it[si + 1]).el, id, it[si + 1]));
            });
            return { el: row, key: it[0] };
          });
          built.forEach(function (b, pi) {
            colDiv.appendChild(b.el);
            if (pi < built.length - 1) colDiv.appendChild(vItemSizer(b.el, built[pi + 1].el, b.key, built[pi + 1].key));
          });
          stage.appendChild(colDiv);
          if (vi < visCols.length - 1) stage.appendChild(colSizer(col.ci, visCols[vi + 1].ci));
        });
        // todo pane que não está no palco (desabilitado ou recolhido) fica no holder OCULTO - segue no DOM,
        // então os listeners dos botões continuam válidos e o áudio do vídeo toca mesmo oculto.
        MODS.forEach(function (m) { if (m.el && !stage.contains(m.el)) holder.appendChild(m.el); });
        var card = stage.closest ? stage.closest(".seg-stage-card") : null;   // sem nenhum painel visível → esconde o card (ex.: Multidim sem módulos ligados)
        if (card) card.style.display = stage.querySelector(".stage-col") ? "" : "none";
        refresh();
      }
      P._rebuildStage = buildStage;

      var EYE = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 9S4 4 9 4s7.5 5 7.5 5-2.5 5-7.5 5S1.5 9 1.5 9z"/><circle cx="9" cy="9" r="2"/></svg>';
      function refresh() {
        list.innerHTML = "";
        MODS.forEach(function (m) {
          if (!m.el || !enabled[m.id] || !m.isCollapsed()) return;
          var bar = document.createElement("div"); bar.className = "collapsed-bar"; bar.title = "Mostrar " + m.title;
          bar.innerHTML = '<span class="cb-title">' + m.title + '</span><span class="cb-eye">' + EYE + '</span>';
          bar.addEventListener("click", function () { m.expand(); buildStage(); });
          list.appendChild(bar);
        });
      }
      P._refreshPanels = refresh;

      // recolher pelo olho → rebuild (o handler próprio de cada módulo alterna o estado antes)
      function wireCollapse(m) { var b = $(m.collapseBtn); if (b) b.addEventListener("click", function () { setTimeout(buildStage, 0); }); }
      MODS.forEach(wireCollapse);

      // menu do inspetor: habilitar/desabilitar
      function setEnabled(id, on) { enabled[id] = !!on; save(); if (isGraph(id) && P.SegGCP) P.SegGCP.setActive(id, !!on && !byId(id).isCollapsed()); buildStage(); }
      MODS.forEach(function (m) { var c = $(m.chk); if (!c) return; c.checked = enabled[m.id]; c.addEventListener("change", function () { setEnabled(m.id, this.checked); }); });   // vídeo/partitura (checkboxes fixos no HTML); os de gráfico entram por renderMenuGraphs

      // arrastar o cabeçalho: empilhar acima/abaixo de um módulo, ou soltar nas bordas p/ nova coluna
      var ghost = null;
      function clearDrop() { if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost); ghost = null; }
      // Zonas GENEROSAS: dentro de uma coluna (quase toda a área) = EMPILHAR (topo/baixo pela metade); os vãos
      // entre colunas e as bordas externas do palco = NOVA COLUNA. Não precisa mirar a borda exata.
      function computeDrop(x, y) {
        var colDivs = Array.prototype.slice.call(stage.querySelectorAll(".stage-col")); if (!colDivs.length) return null;
        if (x < colDivs[0].getBoundingClientRect().left) return { mode: "newcol", beforeId: colDivs[0].__panes[0] };
        for (var i = 0; i < colDivs.length; i++) {
          var r = colDivs[i].getBoundingClientRect(), next = colDivs[i + 1];
          if (x <= r.right) {
            // acha o painel sob o cursor (por x E y, p/ funcionar dentro de sub-linhas), com fallback pelo y
            var ids = colDivs[i].__panes, tgt = null, pr = null, e;
            for (var p = 0; p < ids.length; p++) { e = byId(ids[p]).el.getBoundingClientRect(); if (x >= e.left && x <= e.right && y >= e.top && y <= e.bottom) { tgt = ids[p]; pr = e; break; } }
            if (!tgt) { for (var p2 = 0; p2 < ids.length; p2++) { e = byId(ids[p2]).el.getBoundingClientRect(); if (y <= e.bottom) { tgt = ids[p2]; pr = e; break; } } if (!tgt) { tgt = ids[ids.length - 1]; pr = byId(tgt).el.getBoundingClientRect(); } }
            var relX = (x - pr.left) / Math.max(1, pr.width);
            if (relX < 0.25) return { mode: "side", targetId: tgt, side: "before" };   // borda esquerda → lado a lado (banda)
            if (relX > 0.75) return { mode: "side", targetId: tgt, side: "after" };     // borda direita → lado a lado (banda)
            return { mode: "stack", targetId: tgt, side: (y <= pr.top + pr.height / 2) ? "above" : "below" };   // meio → empilhar
          }
          if (next && x < next.getBoundingClientRect().left) return { mode: "newcol", beforeId: next.__panes[0] };
        }
        return { mode: "newcol", beforeId: null };
      }
      function showDrop(d) {
        clearDrop(); if (!d) return;
        var sr = stage.getBoundingClientRect();
        ghost = document.createElement("div"); ghost.className = "stage-dropghost";
        if (d.mode === "stack") {
          var pr = byId(d.targetId).el.getBoundingClientRect(), h = Math.max(24, Math.min(64, pr.height * 0.5));
          ghost.style.left = (pr.left - sr.left) + "px"; ghost.style.width = pr.width + "px";
          ghost.style.top = ((d.side === "above" ? pr.top : pr.bottom - h) - sr.top) + "px"; ghost.style.height = h + "px";
        } else if (d.mode === "side") {
          var ps = byId(d.targetId).el.getBoundingClientRect(), wd = Math.max(24, Math.min(90, ps.width * 0.45));
          ghost.style.top = (ps.top - sr.top) + "px"; ghost.style.height = ps.height + "px";
          ghost.style.left = ((d.side === "before" ? ps.left : ps.right - wd) - sr.left) + "px"; ghost.style.width = wd + "px";
        } else {
          var w = 56, leftPx = d.beforeId ? (byId(d.beforeId).el.getBoundingClientRect().left - sr.left - w / 2) : (sr.width - w);
          ghost.style.left = Math.max(0, leftPx) + "px"; ghost.style.width = w + "px"; ghost.style.top = "0px"; ghost.style.height = sr.height + "px";
        }
        stage.appendChild(ghost);
      }
      function locItem(id) {   // {ci, ii} do item (top-level) que contém o pane id (dentro de sub-linha inclusive)
        for (var ci = 0; ci < cols.length; ci++) for (var ii = 0; ii < cols[ci].length; ii++) {
          var it = cols[ci][ii]; if ((typeof it === "string") ? it === id : it.indexOf(id) >= 0) return { ci: ci, ii: ii };
        }
        return null;
      }
      function removeId(id) {   // remove o pane de onde estiver, colapsando sub-linha de 1 e removendo item/coluna vazios
        for (var ci = cols.length - 1; ci >= 0; ci--) {
          for (var ii = cols[ci].length - 1; ii >= 0; ii--) {
            var it = cols[ci][ii];
            if (typeof it === "string") { if (it === id) cols[ci].splice(ii, 1); }
            else { var k = it.indexOf(id); if (k >= 0) { it.splice(k, 1); if (it.length === 1) cols[ci][ii] = it[0]; else if (!it.length) cols[ci].splice(ii, 1); } }
          }
          if (!cols[ci].length) cols.splice(ci, 1);
        }
      }
      function applyDrop(dragId, d) {
        if ((d.mode === "stack" || d.mode === "side") && d.targetId === dragId) return;   // soltou sobre si mesmo → nada muda
        var snap = JSON.stringify(cols);
        removeId(dragId);
        var placed = false;
        if (d.mode === "stack") { var loc = locItem(d.targetId); if (loc) { cols[loc.ci].splice(d.side === "below" ? loc.ii + 1 : loc.ii, 0, dragId); placed = true; } }
        else if (d.mode === "side") {   // lado a lado: vira/entra numa SUB-LINHA no lugar do item-alvo
          var ls = locItem(d.targetId);
          if (ls) {
            var it = cols[ls.ci][ls.ii];
            if (typeof it === "string") { cols[ls.ci][ls.ii] = (d.side === "before") ? [dragId, it] : [it, dragId]; placed = true; }
            else { var ti = it.indexOf(d.targetId); if (ti < 0) ti = it.length - 1; it.splice(d.side === "before" ? ti : ti + 1, 0, dragId); placed = true; }
          }
        }
        else { var at = cols.length; if (d.beforeId) { var l2 = locItem(d.beforeId); if (l2) at = l2.ci; } cols.splice(at, 0, [dragId]); placed = true; }
        if (!placed || !colsHave(dragId)) cols = JSON.parse(snap);   // segurança: nunca perde o módulo
        colW = {}; save(); buildStage();   // larguras resetam ao reorganizar (estrutura mudou)
      }
      function wireDrag(m) {
        var head = m.el ? m.el.querySelector(".score-toolbar") : null; if (!head) return;
        head.addEventListener("mousedown", function (e) {
          if (e.button !== 0 || e.target.closest("button, input, select, a")) return;
          e.preventDefault(); var x0 = e.clientX, y0 = e.clientY, moved = false;
          function mm(ev) {
            if (!moved && (Math.abs(ev.clientX - x0) > 5 || Math.abs(ev.clientY - y0) > 5)) { moved = true; m.el.classList.add("pane-dragging"); document.body.style.cursor = "grabbing"; }
            if (moved) showDrop(computeDrop(ev.clientX, ev.clientY));
          }
          function mu(ev) {
            window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu);
            m.el.classList.remove("pane-dragging"); document.body.style.cursor = "";
            var d = moved ? computeDrop(ev.clientX, ev.clientY) : null; clearDrop(); if (d) applyDrop(m.id, d);
          }
          window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
        });
      }
      MODS.forEach(wireDrag);

      // ---- registro dinâmico de módulos de GRÁFICO (o gerente P.SegGCP chama estes) ----
      function renderMenuGraphs() {
        var box = $("mod-graphs"); if (!box) return;
        var gm = MODS.filter(function (m) { return isGraph(m.id); });
        box.innerHTML = "";
        gm.forEach(function (m, i) {
          var title = gm.length > 1 ? ("Gráfico " + (i + 1)) : "Gráfico de prática";
          m.title = title;
          var lab = m.el && m.el.querySelector(".gcpseg-label"); if (lab) lab.textContent = title;   // rótulo no cabeçalho do painel
          var row = document.createElement("label"); row.className = "row"; row.style.marginBottom = "6px";
          var cb = document.createElement("input"); cb.type = "checkbox"; cb.id = m.chk; cb.style.flex = "0 0 auto"; cb.checked = !!enabled[m.id];
          cb.addEventListener("change", function () { setEnabled(m.id, this.checked); });
          var nm = document.createElement("span"); nm.style.flex = "1"; nm.textContent = title;
          row.appendChild(cb); row.appendChild(nm);
          if (gm.length > 1) {
            var rm = document.createElement("button"); rm.type = "button"; rm.textContent = "Remover"; rm.style.cssText = "flex:0 0 auto;font-size:11px;background:none;border:none;color:var(--txt-faint);cursor:pointer;text-decoration:underline;padding:0 4px";
            rm.addEventListener("click", function (e) { e.preventDefault(); if (P.SegGCP) P.SegGCP.remove(m.id); });
            row.appendChild(rm);
          }
          box.appendChild(row);
        });
        var add = document.createElement("button"); add.type = "button"; add.className = "btn sm ghost"; add.style.marginTop = "2px"; add.textContent = "+ Adicionar gráfico";
        add.addEventListener("click", function () { if (P.SegGCP) P.SegGCP.add(); });
        box.appendChild(add);
      }
      P._renderGraphMenu = renderMenuGraphs;
      P._registerGraphMod = function (m) {
        if (byId(m.id)) return;
        if (m.el) m.el.classList.add("stage-pane"); if (m.body) m.body.classList.add("pane-body");   // mesmas classes dos mods fixos (layout do palco)
        MODS.push(m); syncIds();
        if (typeof enabled[m.id] !== "boolean") enabled[m.id] = false;
        if (!colsHave(m.id)) cols.push([m.id]);
        wireCollapse(m); wireDrag(m);
        renderMenuGraphs(); buildStage();
      };
      P._unregisterGraphMod = function (id) {
        var i = -1; for (var k = 0; k < MODS.length; k++) if (MODS[k].id === id) { i = k; break; }
        if (i < 0) return;
        MODS.splice(i, 1); syncIds(); delete enabled[id];
        removeId(id);   // tira o pane de coluna OU sub-linha, colapsando/limpando vazios
        renderMenuGraphs(); buildStage();
      };
      P._enableGraphMod = function (id) {   // "Adicionar gráfico": liga + coluna nova + ativa
        enabled[id] = true;
        if (!colsHave(id)) cols.push([id]);
        if (P.SegGCP) P.SegGCP.setActive(id, true);
        renderMenuGraphs(); buildStage();
      };

      // ---- o estado do palco viaja com o PROJETO (.praxis), não com o programa ----
      function applyState() {
        MODS.forEach(function (m) { var c = $(m.chk); if (c) c.checked = enabled[m.id]; });
        renderMenuGraphs();
        MODS.forEach(function (m) { if (isGraph(m.id) && P.SegGCP) P.SegGCP.setActive(m.id, enabled[m.id] && !byId(m.id).isCollapsed()); });
        buildStage();
      }
      function getLayout() { return { enabled: JSON.parse(JSON.stringify(enabled)), cols: JSON.parse(JSON.stringify(cols)), colW: JSON.parse(JSON.stringify(colW)), paneH: JSON.parse(JSON.stringify(paneH)), rowW: JSON.parse(JSON.stringify(rowW)) }; }
      function setLayout(st) { setState(st || null); applyState(); }
      function mdimDefault() { return { enabled: { video: false, score: false, gcp: false }, cols: [["video"], ["score"], ["gcp"]], colW: {}, paneH: {}, rowW: {} }; }
      // Duas telas com LAYOUT independente compartilhando os MESMOS módulos: "main" (Segmentar/Transcrever) e "mdim" (Multidimensional).
      var ctxLayouts = { main: null, mdim: mdimDefault() }, stageCtx = "main";
      P.StageLayout = {
        serialize: function () { ctxLayouts[stageCtx] = getLayout(); var m = ctxLayouts.main || getLayout(); return { enabled: m.enabled, cols: m.cols, colW: m.colW, paneH: m.paneH, rowW: m.rowW, graphs: (P.SegGCP && P.SegGCP.serialize) ? P.SegGCP.serialize() : null, mdim: ctxLayouts.mdim }; },
        restore: function (st) { st = st || {}; if (P.SegGCP && P.SegGCP.restore) P.SegGCP.restore(st.graphs || null); ctxLayouts.main = { enabled: st.enabled, cols: st.cols, colW: st.colW, paneH: st.paneH, rowW: st.rowW }; ctxLayouts.mdim = st.mdim || mdimDefault(); stageCtx = "main"; setState(ctxLayouts.main); applyState(); if (P.SegGCP && P.SegGCP.refresh) P.SegGCP.refresh(); },
        reset: function () { if (P.SegGCP && P.SegGCP.restore) P.SegGCP.restore(null); ctxLayouts = { main: null, mdim: mdimDefault() }; stageCtx = "main"; setState(null); applyState(); },
        // Troca o CONTEXTO de layout: salva o atual e aplica o do destino. Módulos são os mesmos; só o arranjo muda.
        useContext: function (name) { name = (name === "mdim") ? "mdim" : "main"; if (name === stageCtx) return; ctxLayouts[stageCtx] = getLayout(); stageCtx = name; setLayout(ctxLayouts[name] || (name === "mdim" ? mdimDefault() : defaults())); }
      };
      if (!ctxLayouts.main) ctxLayouts.main = getLayout();

      // ---- presets de layout (prévia SVG + ciclo) ----
      // cols aqui aceita ITENS aninhados: uma string é um painel; um array [a,b] é uma SUB-LINHA (lado a lado).
      var PRESETS = [
        { name: "Vídeo | Partitura", en: { video: 1, score: 1, gcp: 0 }, cols: [["video"], ["score"]] },
        { name: "Partitura | Vídeo", en: { video: 1, score: 1, gcp: 0 }, cols: [["score"], ["video"]] },
        { name: "Vídeo+Partitura | Gráfico", en: { video: 1, score: 1, gcp: 1 }, cols: [["video", "score"], ["gcp"]] },
        { name: "Vídeo+Gráfico | Partitura", en: { video: 1, score: 1, gcp: 1 }, cols: [["video", "gcp"], ["score"]] },
        { name: "Partitura em cima, Vídeo+Gráfico embaixo", en: { video: 1, score: 1, gcp: 1 }, cols: [["score", ["video", "gcp"]]] },
        { name: "Vídeo+Gráfico em cima, Partitura embaixo", en: { video: 1, score: 1, gcp: 1 }, cols: [[["video", "gcp"], "score"]] }
      ];
      function presetSVG(p) {
        var cw = 84, ch = 50, gp = 3, n = p.cols.length, w = (cw - gp * (n - 1)) / n, s = "", lab = { video: "V", score: "P", gcp: "G" };
        function cell(x, y, ww, hh, id) {
          s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + ww.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="3" fill="var(--line-2)" stroke="var(--accent)" stroke-width="1"/>';
          s += '<text x="' + (x + ww / 2).toFixed(1) + '" y="' + (y + hh / 2 + 3.5).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">' + (lab[id] || "G") + '</text>';
        }
        p.cols.forEach(function (items, ci) {
          var x = ci * (w + gp), m = items.length, rh = (ch - gp * (m - 1)) / m;
          items.forEach(function (it, pi) {
            var y = pi * (rh + gp), ids = (typeof it === "string") ? [it] : it, k = ids.length, sw = (w - gp * (k - 1)) / k;
            ids.forEach(function (id, si) { cell(x + si * (sw + gp), y, sw, rh, id); });
          });
        });
        return '<svg viewBox="0 0 ' + cw + ' ' + ch + '" width="' + cw + '" height="' + ch + '">' + s + '</svg>';
      }
      function applyPreset(i) { var p = PRESETS[i]; setState({ enabled: { video: !!p.en.video, score: !!p.en.score, gcp: !!p.en.gcp }, cols: JSON.parse(JSON.stringify(p.cols)), colW: {}, paneH: {}, rowW: {} }); applyState(); }
      (function () {
        var host = $("mod-preset"); if (!host) return;
        var idx = 0;
        function render() {
          host.innerHTML = '<button class="icon-btn" id="mod-preset-prev" title="Layout anterior">‹</button>' +
            '<div class="mod-preset-view" title="Clique para aplicar este layout">' + presetSVG(PRESETS[idx]) + '<span class="mini">' + PRESETS[idx].name + '</span></div>' +
            '<button class="icon-btn" id="mod-preset-next" title="Próximo layout">›</button>';
          $("mod-preset-prev").addEventListener("click", function () { idx = (idx + PRESETS.length - 1) % PRESETS.length; render(); });
          $("mod-preset-next").addEventListener("click", function () { idx = (idx + 1) % PRESETS.length; render(); });
          host.querySelector(".mod-preset-view").addEventListener("click", function () { applyPreset(idx); });
        }
        render();
      })();

      buildStage();
      MODS.forEach(function (m) { if (isGraph(m.id) && P.SegGCP) P.SegGCP.setActive(m.id, enabled[m.id] && !byId(m.id).isCollapsed()); });
    })();
    // Toggle iniciante/avançado da toolbar (persistente)
    (function () {
      var card = $("tl-card"), chk = $("tl-advanced"); if (!card || !chk) return;
      var adv = false; try { adv = localStorage.getItem("praxis.tl.advanced") === "1"; } catch (e) {}
      chk.checked = adv; card.classList.toggle("advanced", adv);
      chk.addEventListener("change", function () {
        card.classList.toggle("advanced", this.checked);
        try { localStorage.setItem("praxis.tl.advanced", this.checked ? "1" : "0"); } catch (e) {}
        if (P.Timeline && P.Timeline.render) P.Timeline.render();
      });
    })();

    // ---- Transcrição (③) ----
    P.Transcript.init({ layer: $("tr-layer"), loop: $("tr-loop"), speed: $("tr-speed"), list: $("tr-list"), status: $("tr-status") });
    if (P.Score && P.Score.init) P.Score.init();

    // ---- Barras de rolagem internas: marca as áreas roláveis (polegar sempre visível, trilho transparente) ----
    ["#seg-listhost", "#tr-list", ".player-content", ".score-render", ".gcpseg-render", ".modal-body", ".sidebar", ".canvas-area"]
      .forEach(function (sel) { Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) { el.classList.add("px-scroll"); }); });

    // ---- Painel direito (inspetor) colapsável, por tela, lembrado em localStorage; atalho Alt+I ----
    var INSP_COLLAPSE = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11.6 4.4L6.6 9l5 4.6M15 3.8v10.4"/></svg>';
    Array.prototype.forEach.call(document.querySelectorAll(".sidebar.inspector"), function (aside) {
      var view = aside.closest(".view"), key = "praxis.insp." + (view ? view.id : "v");
      var head = document.createElement("div"); head.className = "insp-head";
      head.innerHTML = '<span class="insp-title">Inspetor</span>' +
        '<button class="icon-btn insp-collapse" title="Recolher painel (Alt+I)" aria-expanded="true" aria-label="Recolher painel">' + INSP_COLLAPSE + '</button>';
      aside.insertBefore(head, aside.firstChild);
      var strip = document.createElement("button"); strip.type = "button"; strip.className = "insp-strip";
      strip.title = "Mostrar painel (Alt+I)"; strip.setAttribute("aria-expanded", "false"); strip.setAttribute("aria-label", "Mostrar painel");
      strip.innerHTML = '<span class="insp-handle"></span>';
      aside.appendChild(strip);
      function setCollapsed(c) {
        aside.classList.toggle("collapsed", c);
        head.querySelector(".insp-collapse").setAttribute("aria-expanded", String(!c));
        strip.setAttribute("aria-expanded", String(!c));
        try { localStorage.setItem(key, c ? "collapsed" : "open"); } catch (e) {}
      }
      head.querySelector(".insp-collapse").addEventListener("click", function () { setCollapsed(true); });
      strip.addEventListener("click", function () { setCollapsed(false); });
      aside._setCollapsed = setCollapsed;
      try { if (localStorage.getItem(key) === "collapsed") aside.classList.add("collapsed"); } catch (e) {}
    });
    document.addEventListener("keydown", function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== "KeyI") return;
      var view = document.querySelector(".view.active"); if (!view) return;
      var aside = view.querySelector(".sidebar.inspector"); if (!aside || !aside._setCollapsed) return;
      e.preventDefault(); aside._setCollapsed(!aside.classList.contains("collapsed"));
    });

    // ---- Módulo C: Multidimensional (④) ----
    if (P.Mdim) P.Mdim.init({
      canvas: $("mdim-canvas"), dimlist: $("mdim-dimlist"),
      exemplo: $("mdim-exemplo"), addDim: $("mdim-adddim"),
      activedim: $("mdim-activedim"), coder: $("mdim-coder"), cats: $("mdim-cats"),
      appear: $("mdim-appear"), exportPanel: $("mdim-export"), compares: $("mdim-compares"),
      gif: $("mdim-gif"), didatico: $("mdim-didatico"), presets: $("mdim-presets"),
      typeappear: $("mdim-typeappear")
    });
    $("mdim-csvexport").addEventListener("click", function () { P.Mdim.exportCSV(); });
    $("mdim-csvimport").addEventListener("click", function () { $("mdim-csvfile").click(); });
    $("mdim-csvfile").addEventListener("change", function () { if (this.files[0]) P.Mdim.importCSV(this.files[0]); this.value = ""; });
    var _mm = $("mdim-modes");
    if (_mm) Array.prototype.forEach.call(_mm.querySelectorAll("[data-mode]"), function (b) { b.addEventListener("click", function () { P.Mdim.setViewMode(b.dataset.mode); }); });
    try { var _vm = localStorage.getItem("praxis.mdim.viewmode"); if (!_vm) _vm = (localStorage.getItem("praxis.mdim.coding") === "1") ? "coding" : "resumo"; P.Mdim._viewMode = _vm; P.Mdim._codingMode = (_vm === "coding"); P.Mdim._formatMode = (_vm === "format"); } catch (e) {}
    if (P.Mdim._syncModeBtns) P.Mdim._syncModeBtns();
    $("mdim-idx-labels").addEventListener("change", function () { P.Mdim.setIndexLabels(this.checked); });
    try { var _il = localStorage.getItem("praxis.mdim.idxlabels") === "1"; P.Mdim._showIndexLabels = _il; var _ilc = $("mdim-idx-labels"); if (_ilc) _ilc.checked = _il; } catch (e) {}
    $("mdim-stage-bands").addEventListener("change", function () { P.Mdim.setStageBands(this.checked); });
    try { var _sb = localStorage.getItem("praxis.mdim.stagebands") === "1"; P.Mdim._showStageBands = _sb; var _sbc = $("mdim-stage-bands"); if (_sbc) _sbc.checked = _sb; } catch (e) {}
    $("mdim-type-bands").addEventListener("change", function () { P.Mdim.setTypeBands(this.checked); });
    try { var _tb = localStorage.getItem("praxis.mdim.typebands") === "1"; P.Mdim._showTypeBands = _tb; var _tbc = $("mdim-type-bands"); if (_tbc) _tbc.checked = _tb; } catch (e) {}
    try { var _fp = localStorage.getItem("praxis.mdim.followplay"); P.Mdim._followPlay = (_fp === null) ? true : (_fp === "1"); } catch (e) {}   // toggle vive no cabeçalho do eixo (botão de corrente), não mais no painel
    $("mdim-modexport").addEventListener("click", function () { P.Mdim.exportModel(); });
    $("mdim-modimport").addEventListener("click", function () { $("mdim-modfile").click(); });
    $("mdim-modfile").addEventListener("change", function () { if (this.files[0]) P.Mdim.importModel(this.files[0]); this.value = ""; });
    $("mdim-modcats").addEventListener("click", function () { $("mdim-modcatsfile").click(); });
    $("mdim-modcatsfile").addEventListener("change", function () { if (this.files[0]) P.Mdim.updateCategoriesFromModel(this.files[0]); this.value = ""; });
    $("seg-adddim").addEventListener("click", function () { P.Segmenter.addDimension(); });

    // ---- Módulo B: controles ----
    // Fonte de dados (ordem do inspetor): transcritos (azul), gráfico de outro projeto, CSV, ELAN, exemplo.
    $("gcp-from-transcribed").addEventListener("click", function () { P.Segmenter.generateGCP(); });
    if ($("seg-stages2obj")) $("seg-stages2obj").addEventListener("click", function () { P.Segmenter.stagesToObjectives(); });
    $("gcp-package").addEventListener("click", generateGraphPackage);
    $("gcp-from-project").addEventListener("click", function () { $("gcp-projfile").click(); });
    $("gcp-projfile").addEventListener("change", function () { if (this.files[0]) importGraphFromProject(this.files[0]); this.value = ""; });
    $("gcp-import").addEventListener("click", function () { $("gcp-importfile").click(); });
    $("gcp-importfile").addEventListener("change", function () { if (this.files[0]) importCSV(this.files[0]); this.value = ""; });
    $("gcp-example").addEventListener("click", function () { openExampleGcp(); });
    $("seg-elan").addEventListener("click", function () { $("seg-elanfile").click(); });
    $("seg-elanfile").addEventListener("change", function () { if (this.files[0]) importELAN(this.files[0]); this.value = ""; });

    $("gcp-preset").addEventListener("change", function () { P.GCP.cfg.activePreset = this.value; P.GCP.savePresets(); syncPresetControls(); reRender(); renderLegend(); });
    $("gcp-preset-new").addEventListener("click", function () { P.GCP.addPreset(); renderPresets(); syncPresetControls(); reRender(); renderLegend(); });
    $("gcp-preset-ren").addEventListener("click", function () { var p = P.GCP.activePreset(); var n = prompt("Nome da predefinição:", p.name); if (n && n.trim()) { P.GCP.renamePreset(p.id, n.trim()); renderPresets(); } });
    $("gcp-preset-del").addEventListener("click", function () { P.GCP.removePreset(P.GCP.cfg.activePreset); renderPresets(); syncPresetControls(); reRender(); renderLegend(); });
    // Handle do último arquivo .praxpreset exportado/importado (File System Access) + a predefinição vinculada,
    // para o botão "Salvar" gravar por cima do mesmo arquivo com o estado atual da predefinição.
    var presetFileHandle = null, presetFileId = null;
    function writePresetToHandle(handle, id) {
      var payload = P.GCP.presetPayload(id); if (!payload) return Promise.reject();
      var perm = handle.requestPermission ? handle.requestPermission({ mode: "readwrite" }) : Promise.resolve("granted");
      return Promise.resolve(perm).then(function (p) {
        if (p && p !== "granted") throw new Error("perm");
        return handle.createWritable();
      }).then(function (w) { return w.write(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })).then(function () { return w.close(); }); });
    }
    function bindPresetFile(handle, id, name) {
      presetFileHandle = handle; presetFileId = id;
      var sv = $("gcp-preset-save");
      if (sv) sv.title = "Grava por cima de «" + (name || "arquivo") + "» com a predefinição atual";
    }
    if ($("gcp-preset-export")) $("gcp-preset-export").addEventListener("click", function () {
      var id = P.GCP.cfg.activePreset;
      if (P.hasFSA && window.showSaveFilePicker) {
        window.showSaveFilePicker({ suggestedName: P.GCP.presetFileName(id), types: [{ description: "Predefinição Praxis", accept: { "application/json": [".praxpreset"] } }] })
          .then(function (h) { return writePresetToHandle(h, id).then(function () { bindPresetFile(h, id, h.name); }); })
          .catch(function (e) { if (e && e.name !== "AbortError") { P.GCP.exportPreset(id); } });   // negou/sem suporte → baixa como fallback
      } else { P.GCP.exportPreset(id); }
    });
    if ($("gcp-preset-import")) $("gcp-preset-import").addEventListener("click", function () {
      if (P.hasFSA && window.showOpenFilePicker) {
        window.showOpenFilePicker({ multiple: false, types: [{ description: "Predefinição Praxis", accept: { "application/json": [".praxpreset", ".json"] } }] })
          .then(function (hs) {
            var h = hs[0]; return h.getFile().then(function (f) { return f.text(); }).then(function (txt) {
              var obj = null; try { obj = JSON.parse(txt); } catch (e) {}
              if (!obj || (!obj.praxpreset && !obj.colors && !obj.kind)) { alert("Arquivo de predefinição inválido."); return; }
              var id = P.GCP.importPreset(obj);
              if (id) { renderPresets(); syncPresetControls(); reRender(); renderLegend(); bindPresetFile(h, id, h.name); }
            });
          })
          .catch(function (e) { if (e && e.name !== "AbortError") $("gcp-preset-importfile").click(); });
      } else { $("gcp-preset-importfile").click(); }
    });
    if ($("gcp-preset-save")) $("gcp-preset-save").addEventListener("click", function () {
      var btn = this, id = P.GCP.cfg.activePreset;
      function ok() { var old = btn.textContent; btn.textContent = "Salvo"; btn.disabled = true; setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1400); }
      function fail() { alert("Não consegui gravar no arquivo (permissão negada ou arquivo movido). Use «Exportar» para salvar de novo."); }
      // Com arquivo já vinculado (export/import desta sessão): grava por cima direto.
      if (presetFileHandle && presetFileId === id) { writePresetToHandle(presetFileHandle, presetFileId).then(ok).catch(fail); return; }
      // Sem vínculo (ou trocou de predefinição): escolhe o arquivo a atualizar e passa a gravar nele.
      if (P.hasFSA && window.showSaveFilePicker) {
        window.showSaveFilePicker({ suggestedName: P.GCP.presetFileName(id), types: [{ description: "Predefinição Praxis", accept: { "application/json": [".praxpreset"] } }] })
          .then(function (h) { return writePresetToHandle(h, id).then(function () { bindPresetFile(h, id, h.name); ok(); }); })
          .catch(function (e) { if (e && e.name !== "AbortError") fail(); });
      } else { P.GCP.exportPreset(id); ok(); }   // sem FSA: baixa o arquivo (não dá p/ gravar por cima)
    });
    if ($("gcp-preset-importfile")) $("gcp-preset-importfile").addEventListener("change", function () {
      var f = this.files[0]; this.value = ""; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var obj = null; try { obj = JSON.parse(rd.result); } catch (e) {}
        if (!obj || (!obj.praxpreset && !obj.colors && !obj.kind)) { alert("Arquivo de predefinição inválido."); return; }
        var id = P.GCP.importPreset(obj);
        if (id) { renderPresets(); syncPresetControls(); reRender(); renderLegend(); }
      };
      rd.readAsText(f);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-style button"), function (b) {
      b.addEventListener("click", function () { P.GCP.cfg.chartStyle = b.getAttribute("data-style"); updateStyleUI(); reRender(); });
    });
    $("gcp-heatgroup").addEventListener("change", function () { P.GCP.cfg.heatGroupBy = this.value; reRender(); });
    $("gcp-heatmetric").addEventListener("change", function () { P.GCP.cfg.heatMetric = this.value; reRender(); });
    $("gcp-cj-name").addEventListener("input", function () { var cj = P.GCP.conjuntoOf(P.GCP.activeDoc()); if (cj) { cj.name = this.value; renderConjuntoPanel(); } });
    $("gcp-cj-unlink").addEventListener("click", function () { P.GCP.unlinkGraph(P.GCP.activeId); refreshGcpView(); });
    $("gcp-cj-link").addEventListener("change", function () { if (this.value) { P.GCP.linkGraph(P.GCP.activeId, this.value); refreshGcpView(); } });
    $("gcp-invert").addEventListener("change", function () { P.GCP.cfg.invertY = this.checked; $("gcp-xbottom-row").hidden = !this.checked; reRender(); });
    $("gcp-xbottom").addEventListener("change", function () { P.GCP.cfg.xToBottom = this.checked; reRender(); });
    $("gcp-bh").addEventListener("input", function () { P.GCP.cfg.barHeight = +this.value; $("gcp-bhval").textContent = this.value; reRender(); });
    $("gcp-rs").addEventListener("input", function () { P.GCP.cfg.rowStep = +this.value; $("gcp-rsval").textContent = this.value; reRender(); });
    if ($("gcp-legend-show")) $("gcp-legend-show").addEventListener("change", function () { P.GCP.cfg.showLegend = this.checked; $("gcp-legend-opts").hidden = !this.checked; reRender(); });
    if ($("gcp-legend-pos")) $("gcp-legend-pos").addEventListener("change", function () { P.GCP.cfg.legendPos = this.value; reRender(); });
    if ($("gcp-legend-size")) $("gcp-legend-size").addEventListener("input", function () { P.GCP.cfg.legendSize = +this.value; $("gcp-legend-sizeval").textContent = this.value; reRender(); });
    if ($("gcp-legend-swatch")) $("gcp-legend-swatch").addEventListener("input", function () { P.GCP.cfg.legendSwatch = +this.value; $("gcp-legend-swval").textContent = this.value; reRender(); });
    if ($("gcp-legend-outline")) $("gcp-legend-outline").addEventListener("change", function () { P.GCP.cfg.legendOutline = this.checked; reRender(); });
    if ($("gcp-legend-onlyused")) $("gcp-legend-onlyused").addEventListener("change", function () { P.GCP.cfg.legendOnlyUsed = this.checked; reRender(); });
    if ($("gcp-legend-offx")) $("gcp-legend-offx").addEventListener("input", function () { P.GCP.cfg.legendOffX = +this.value; $("gcp-legend-offxval").textContent = this.value; reRender(); });
    if ($("gcp-legend-offy")) $("gcp-legend-offy").addEventListener("input", function () { P.GCP.cfg.legendOffY = +this.value; $("gcp-legend-offyval").textContent = this.value; reRender(); });
    // Faixa de partitura alinhada ao compasso (scorestrip.js).
    function scoreStatus(msg, kind) { var el = $("gcp-score-status"); if (!el) return; if (!msg) { el.style.display = "none"; return; } el.textContent = msg; el.className = "status " + (kind || ""); el.style.display = "block"; }
    function prepareStrip(then) {
      if (!P.GCP.cfg.showScore || !P.ScoreStrip) { if (then) then(); return; }
      if (!P.ScoreStrip.available()) { scoreStatus("Nenhuma partitura carregada (aba Segmentar).", "warn"); if (then) then(); return; }
      scoreStatus("Preparando a partitura…", "");
      P.ScoreStrip.prepare({ scale: P.GCP.cfg.scoreScale, staff: P.GCP.cfg.scoreStaff, mnum: P.GCP.cfg.scoreMnum }, function (ok) { scoreStatus(ok ? "" : "Não foi possível preparar a partitura.", ok ? "" : "warn"); if (then) then(); });
    }
    if ($("gcp-score-show")) $("gcp-score-show").addEventListener("change", function () { P.GCP.cfg.showScore = this.checked; $("gcp-score-opts").hidden = !this.checked; if (this.checked) prepareStrip(reRender); else reRender(); });
    if ($("gcp-score-pos")) $("gcp-score-pos").addEventListener("change", function () { P.GCP.cfg.scorePos = this.value; reRender(); });
    if ($("gcp-score-height")) $("gcp-score-height").addEventListener("input", function () { P.GCP.cfg.scoreHeight = +this.value; $("gcp-score-hval").textContent = this.value; reRender(); });
    if ($("gcp-score-gap")) $("gcp-score-gap").addEventListener("input", function () { P.GCP.cfg.scoreGap = +this.value; $("gcp-score-gval").textContent = this.value; reRender(); });
    if ($("gcp-score-scale")) { $("gcp-score-scale").addEventListener("input", function () { $("gcp-score-sval").textContent = this.value; }); $("gcp-score-scale").addEventListener("change", function () { P.GCP.cfg.scoreScale = +this.value; prepareStrip(reRender); }); }
    if ($("gcp-score-staff")) $("gcp-score-staff").addEventListener("change", function () { P.GCP.cfg.scoreStaff = this.value; prepareStrip(reRender); });
    if ($("gcp-score-mnum")) $("gcp-score-mnum").addEventListener("change", function () { P.GCP.cfg.scoreMnum = this.checked; prepareStrip(reRender); });
    $("gcp-opacity").addEventListener("input", function () { $("gcp-opval").textContent = Math.round(this.value * 100) + "%"; P.GCP.setOpacity(parseFloat(this.value)); renderPresets(); reRender(); });
    if ($("gcp-brad")) $("gcp-brad").addEventListener("input", function () { $("gcp-bradval").textContent = this.value; P.GCP.setRadius(+this.value); renderPresets(); reRender(); });
    $("gcp-outline").addEventListener("change", function () { P.GCP.setOutline({ show: this.checked }); renderPresets(); reRender(); });
    outlinePicker = colorPicker("#111111", function (hex) { P.GCP.setOutline({ color: hex }); renderPresets(); reRender(); });
    if ($("gcp-outcolor-host")) $("gcp-outcolor-host").appendChild(outlinePicker.el);
    $("gcp-outwidth").addEventListener("input", function () { P.GCP.setOutline({ width: +this.value }); renderPresets(); reRender(); });
    $("gcp-grid").addEventListener("change", function () { P.GCP.cfg.showGrid = this.checked; reRender(); });
    $("gcp-colview").addEventListener("change", function () {
      P.GCP.cfg.colView = this.checked;
      if (this.checked && P.GCP.cfg.colAuto) { P.GCP.cfg.colCount = suggestColumns(); $("gcp-colcount").value = P.GCP.cfg.colCount; }
      $("gcp-col-opts").hidden = !this.checked;
      updateVsizeDim();
      reRender();
    });
    $("gcp-colcount").addEventListener("input", function () { P.GCP.cfg.colCount = Math.max(2, Math.min(12, +this.value || 2)); P.GCP.cfg.colAuto = false; reRender(); });
    $("gcp-colgap").addEventListener("input", function () { P.GCP.cfg.colGap = +this.value; $("gcp-colgapval").textContent = this.value + "px"; reRender(); });
    $("gcp-colfit").addEventListener("change", function () { P.GCP.cfg.colFit = this.checked; updateVsizeDim(); reRender(); });
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-colaxis button"), function (b) {
      b.addEventListener("click", function () { P.GCP.cfg.colAxisMode = b.getAttribute("data-mode"); updateColAxisUI(); reRender(); });
    });
    if ($("gcp-coleffscale")) $("gcp-coleffscale").addEventListener("input", function () { P.GCP.cfg.colEffScale = +this.value; $("gcp-coleffscaleval").textContent = Math.round(this.value * 100) + "%"; reRender(); });
    if ($("gcp-colsingleaxis")) $("gcp-colsingleaxis").addEventListener("change", function () { P.GCP.cfg.colSingleAxis = this.checked; reRender(); });
    $("gcp-segtitle").addEventListener("change", function () { P.GCP.cfg.showSegTitle = this.checked; reRender(); });
    // Títulos dos eixos: texto + formatação (tamanho/tracking/negrito/caixa)
    $("gcp-xtitle").addEventListener("input", function () { P.GCP.cfg.xTitle = this.value; reRender(); });
    $("gcp-ytitle").addEventListener("input", function () { P.GCP.cfg.yTitle = this.value; reRender(); });
    $("gcp-axtsize").addEventListener("input", function () { P.GCP.cfg.axisTitleSize = +this.value; $("gcp-axtsizeval").textContent = this.value; reRender(); });
    $("gcp-axttrack").addEventListener("input", function () { P.GCP.cfg.axisTitleTrack = +this.value; $("gcp-axttrackval").textContent = this.value; reRender(); });
    if ($("gcp-axtgap")) $("gcp-axtgap").addEventListener("input", function () { P.GCP.cfg.axisTitleGap = +this.value; $("gcp-axtgapval").textContent = this.value; reRender(); });
    axisTitleColorPicker = colorPicker(P.GCP.cfg.axisTitleColor || "#888888", function (hex) { P.GCP.cfg.axisTitleColor = hex; reRender(); });
    if ($("gcp-axtcolor-host")) $("gcp-axtcolor-host").appendChild(axisTitleColorPicker.el);
    if ($("gcp-ylabelstep")) $("gcp-ylabelstep").addEventListener("input", function () { var v = +this.value; P.GCP.cfg.axisYLabelStep = (this.value === "" || !(v > 0)) ? 0 : v; reRender(); });
    $("gcp-axtbold").addEventListener("change", function () { P.GCP.cfg.axisTitleBold = this.checked; reRender(); });
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-axtcase button"), function (b) {
      b.addEventListener("click", function () { P.GCP.cfg.axisTitleCase = b.getAttribute("data-case"); Array.prototype.forEach.call(document.querySelectorAll("#gcp-axtcase button"), function (x) { x.classList.toggle("active", x === b); }); reRender(); });
    });
    $("gcp-mmin").addEventListener("input", function () { P.GCP.cfg.axisMMin = this.value === "" ? null : +this.value; reRender(); });
    $("gcp-mmax").addEventListener("input", function () { P.GCP.cfg.axisMMax = this.value === "" ? null : +this.value; reRender(); });
    $("gcp-tickstep").addEventListener("input", function () { var v = +this.value; P.GCP.cfg.axisTickStep = (this.value === "" || !(v > 0)) ? null : v; reRender(); });
    $("gcp-labelstep").addEventListener("input", function () { var v = +this.value; P.GCP.cfg.axisLabelStep = (this.value === "" || !(v > 0)) ? null : v; reRender(); });
    $("gcp-xlabels").addEventListener("change", function () { P.GCP.cfg.showXLabels = this.checked; reRender(); });
    $("gcp-font").addEventListener("change", function () { P.GCP.setFont(this.value); renderPresets(); reRender(); });
    // seções
    $("gcp-sec-add").addEventListener("click", addSection);
    $("gcp-sec-fromscore").addEventListener("click", pullSectionsFromScore);
    $("gcp-sec-measure").addEventListener("keydown", function (e) { if (e.key === "Enter") addSection(); });
    $("gcp-sec-name").addEventListener("keydown", function (e) { if (e.key === "Enter") addSection(); });
    secStrokePicker = colorPicker(P.GCP.cfg.sectionColor || "#888888", function (hex) { P.GCP.cfg.sectionColor = hex; reRender(); });
    if ($("gcp-sec-color-host")) $("gcp-sec-color-host").appendChild(secStrokePicker.el);
    $("gcp-sec-dash").addEventListener("change", function () { P.GCP.cfg.sectionDash = this.value; reRender(); });
    $("gcp-sec-width").addEventListener("input", function () { P.GCP.cfg.sectionWidth = +this.value; reRender(); });
    if ($("gcp-sec-behind")) $("gcp-sec-behind").addEventListener("change", function () { P.GCP.cfg.sectionLinesBehind = this.checked; reRender(); });
    $("gcp-sec-labels").addEventListener("change", function () { P.GCP.cfg.showSectionLabels = this.checked; reRender(); });
    secLabelColorPicker = colorPicker(P.GCP.cfg.sectionLabelColor || "#888888", function (hex) { P.GCP.cfg.sectionLabelColor = hex; reRender(); });
    if ($("gcp-sec-labelcolor-host")) $("gcp-sec-labelcolor-host").appendChild(secLabelColorPicker.el);
    if ($("gcp-sec-labelsize")) $("gcp-sec-labelsize").addEventListener("input", function () { P.GCP.cfg.sectionLabelSize = +this.value; reRender(); });
    $("gcp-sectint").addEventListener("change", function () { P.GCP.cfg.showSectionTints = this.checked; reRender(); });
    $("gcp-sectint-op").addEventListener("input", function () { P.GCP.cfg.sectionTintOpacity = +this.value; $("gcp-sectint-opval").textContent = Math.round(this.value * 100) + "%"; reRender(); });
    // estágios (GCPs menores)
    $("gcp-split").addEventListener("change", function () { P.GCP.cfg.splitByStage = this.checked; renderGcp(); });
    if ($("gcp-stagelabel")) $("gcp-stagelabel").addEventListener("change", function () { P.GCP.cfg.showStageLabels = this.checked; if ($("gcp-stagelabel-opts")) $("gcp-stagelabel-opts").hidden = !this.checked; reRender(); });
    stageLabelColorPicker = colorPicker(P.GCP.cfg.stageLabelColor || "#888888", function (hex) { P.GCP.cfg.stageLabelColor = hex; reRender(); });
    if ($("gcp-stagelabel-color-host")) $("gcp-stagelabel-color-host").appendChild(stageLabelColorPicker.el);
    if ($("gcp-stagelabel-size")) $("gcp-stagelabel-size").addEventListener("input", function () { P.GCP.cfg.stageLabelSize = +this.value; reRender(); });
    if ($("gcp-stagelabel-inside")) $("gcp-stagelabel-inside").addEventListener("change", function () { P.GCP.cfg.stageLabelInside = this.checked; reRender(); });
    if ($("gcp-stagelabel-vertical")) $("gcp-stagelabel-vertical").addEventListener("change", function () { P.GCP.cfg.stageLabelVertical = this.checked; reRender(); });
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-side button"), function (b) {
      b.addEventListener("click", function () { P.GCP.cfg.stageLabelSide = b.getAttribute("data-side"); Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-side button"), function (x) { x.classList.toggle("active", x === b); }); reRender(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-align button"), function (b) {
      b.addEventListener("click", function () { P.GCP.cfg.stageLabelAlign = b.getAttribute("data-align"); Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-align button"), function (x) { x.classList.toggle("active", x === b); }); reRender(); });
    });
    if ($("gcp-stagelabel-track")) $("gcp-stagelabel-track").addEventListener("input", function () { P.GCP.cfg.stageLabelTrack = +this.value; $("gcp-stagelabel-trackval").textContent = this.value; reRender(); });
    if ($("gcp-stagelabel-off")) $("gcp-stagelabel-off").addEventListener("input", function () { P.GCP.cfg.stageLabelOffset = +this.value; $("gcp-stagelabel-offval").textContent = this.value; reRender(); });
    if ($("gcp-stagelabel-bold")) $("gcp-stagelabel-bold").addEventListener("change", function () { P.GCP.cfg.stageLabelBold = this.checked; reRender(); });
    if ($("gcp-stagelabel-italic")) $("gcp-stagelabel-italic").addEventListener("change", function () { P.GCP.cfg.stageLabelItalic = this.checked; reRender(); });
    if ($("gcp-stagelabel-halo")) $("gcp-stagelabel-halo").addEventListener("change", function () { P.GCP.cfg.stageLabelHalo = this.checked; reRender(); });
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-case button"), function (b) {
      b.addEventListener("click", function () { P.GCP.cfg.stageLabelCase = b.getAttribute("data-case"); Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-case button"), function (x) { x.classList.toggle("active", x === b); }); reRender(); });
    });
    $("gcp-stagetint").addEventListener("change", function () { P.GCP.cfg.showStageTints = this.checked; reRender(); });
    $("gcp-stagetint-op").addEventListener("input", function () { P.GCP.cfg.stageTintOpacity = +this.value; $("gcp-stagetint-opval").textContent = Math.round(this.value * 100) + "%"; reRender(); });
    if ($("gcp-stageline")) $("gcp-stageline").addEventListener("change", function () { P.GCP.cfg.showStageLines = this.checked; if ($("gcp-stageline-opts")) $("gcp-stageline-opts").hidden = !this.checked; reRender(); });
    stageLinePicker = colorPicker(P.GCP.cfg.stageLineColor || "#888888", function (hex) { P.GCP.cfg.stageLineColor = hex; reRender(); });
    if ($("gcp-stageline-color-host")) $("gcp-stageline-color-host").appendChild(stageLinePicker.el);
    if ($("gcp-stageline-dash")) $("gcp-stageline-dash").addEventListener("change", function () { P.GCP.cfg.stageLineDash = this.value; reRender(); });
    if ($("gcp-stageline-width")) $("gcp-stageline-width").addEventListener("input", function () { P.GCP.cfg.stageLineWidth = +this.value; reRender(); });
    P.GCP._onBladeSplit = bladeSplitAt;
    P.GCP._onStagesChange = function () { renderStagesManager(); renderGcp(); };   // após arrastar uma fronteira
    $("gcp-stage-blade").addEventListener("click", function () {
      P.GCP.bladeMode = !P.GCP.bladeMode;
      this.classList.toggle("active", P.GCP.bladeMode);
      $("gcp-stage-blade-hint").hidden = !P.GCP.bladeMode;
      reRender();
    });
    $("gcp-stage-add").addEventListener("click", addStage);
    if ($("gcp-stage-fromobj")) $("gcp-stage-fromobj").addEventListener("click", function () {
      var btn = this;
      if (!P.GCP.data) { alert("Nenhum gráfico ativo. Gere o gráfico primeiro."); return; }
      if (P.GCP.data.stages && P.GCP.data.stages.length && !confirm("Isso substitui os estágios atuais deste gráfico pelos objetivos de médio prazo. Continuar?")) return;
      var r = P.GCP.buildStagesFromObjectives();
      if (!r.ok) {
        alert(r.reason === "no-objectives" || r.reason === "no-overlap"
          ? "Não encontrei a camada «Objetivos de Médio Prazo» com segmentos que casem no tempo. Transcreva os objetivos na aba Segmentar/Transcrever e gere o gráfico a partir dela."
          : "Não há segmentos no gráfico para montar os estágios.");
        return;
      }
      renderStagesManager(); renderGcp();
      if (P.GCP._refreshStagePreview) P.GCP._refreshStagePreview();
      var old0 = btn.textContent;
      btn.textContent = r.created + " estágio(s) gerado(s)";
      btn.disabled = true;
      setTimeout(function () { btn.textContent = old0; btn.disabled = false; }, 1600);
    });
    if ($("gcp-stage-syncnames")) $("gcp-stage-syncnames").addEventListener("click", function () {
      var btn = this;
      if (!P.GCP.data || !(P.GCP.data.stages && P.GCP.data.stages.length)) { alert("Nenhum estágio no gráfico ativo. Gere o gráfico ou divida os estágios primeiro."); return; }
      var r = P.GCP.updateStageNamesFromObjectives();
      if (!r.ok) {
        alert(r.reason === "no-objectives"
          ? "Não encontrei a camada «Objetivos de Médio Prazo» com segmentos. Transcreva os objetivos na aba Segmentar/Transcrever e gere o gráfico a partir dela."
          : "Nenhum estágio para atualizar.");
        return;
      }
      renderStagesManager(); renderGcp();
      if (P.GCP._refreshStagePreview) P.GCP._refreshStagePreview();
      var old = btn.textContent;
      btn.textContent = r.updated ? (r.updated + " nome(s) atualizado(s)") : "Nomes já sincronizados";
      btn.disabled = true;
      setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1600);
    });
    if ($("gcp-cmp-enter")) $("gcp-cmp-enter").addEventListener("click", function () {
      if (P.GCP.docs.length < 2) { alert("Precisa de pelo menos 2 gráficos para comparar."); return; }
      compare.on = true; compare.manual = false;
      if (!compare.aId || !P.GCP._docById(compare.aId)) compare.aId = P.GCP.activeId || P.GCP.docs[0].id;
      if (!compare.bId || compare.bId === compare.aId || !P.GCP._docById(compare.bId)) compare.bId = firstOtherDoc(compare.aId);
      syncCompareMode(); syncCompareUI(); renderGcp();
    });
    if ($("gcp-cmp-exit")) $("gcp-cmp-exit").addEventListener("click", function () { compare.on = false; syncCompareMode(); renderGcp(); });
    if ($("gcp-compare-a")) $("gcp-compare-a").addEventListener("change", function () { compare.aId = this.value; if (compare.bId === compare.aId) compare.bId = firstOtherDoc(compare.aId); syncCompareUI(); renderGcp(); });
    if ($("gcp-compare-b")) $("gcp-compare-b").addEventListener("change", function () { compare.bId = this.value; if (compare.aId === compare.bId) compare.aId = firstOtherDoc(compare.bId); syncCompareUI(); renderGcp(); });
    if ($("gcp-compare-prop")) $("gcp-compare-prop").addEventListener("change", function () { compare.propLink = this.checked; if (this.checked) { compare.propMulX = 1; compare.propMulY = 1; } syncCompareUI(); renderGcp(); });
    if ($("gcp-cmp-export")) $("gcp-cmp-export").addEventListener("click", function () { exportComparePNG(); });
    window.addEventListener("resize", function () { if (!compare.on) return; clearTimeout(compare._wr); compare._wr = setTimeout(function () { if (compare.on) renderGcp(); }, 160); });   // comparar re-cabe quando a janela muda de tamanho
    // módulos de gráfico na aba Segmentar: garante o painel padrão (id "gcp"); os demais entram pelo botão
    // "Adicionar gráfico" (menu Módulos de visualização). A fiação de cada painel vive na fábrica makeGcpInst.
    if (P.SegGCP && P.SegGCP.list && !P.SegGCP.list().length) P.SegGCP.restore(null);
    if (P._renderGraphMenu) P._renderGraphMenu();
    if (P.SegGCP && P.SegGCP.refresh) P.SegGCP.refresh();
    ["gcp-stage-from", "gcp-stage-to", "gcp-stage-name"].forEach(function (id) { $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") addStage(); }); });
    // exportar
    // Exportação com seleção: abre um diálogo com as abas (docs) e, dentro de cada uma,
    // os gráficos exportáveis (o inteiro e cada estágio quando dividido). Default = 1º gráfico da aba ativa.
    function sanFile(s) { return String(s || "grafico").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "grafico"; }
    // Lista o que dá para exportar em cada aba.
    function collectExportTargets() {
      return P.GCP.docs.map(function (doc) {
        var cj = P.GCP.conjuntoOf(doc), stages = (cj && cj.stages) || [];
        var heat = doc.cfg.chartStyle === "heatmap";
        var split = !heat && doc.cfg.splitByStage && stages.length;
        var cols = !heat && !split && doc.cfg.colView && doc.cfg.colCount > 1;
        var graphics = [];
        if (heat) graphics.push({ label: "Heatmap", kind: "full" });
        else if (split) {
          graphics.push({ label: "Gráfico inteiro", kind: "full" });
          stages.slice().sort(function (a, b) { return (a.from || 0) - (b.from || 0); }).forEach(function (stg, i) {
            graphics.push({ label: "Estágio " + (i + 1) + (stg.name ? " · " + stg.name : ""), kind: "stage", stage: stg });
          });
        }
        else if (cols) graphics.push({ label: "Gráfico (colunas)", kind: "columns" });
        else graphics.push({ label: "Gráfico", kind: "full" });
        return { doc: doc, graphics: graphics };
      });
    }
    // Renderiza um gráfico específico de um doc num SVG destacado (troca o estado ativo temporariamente).
    function renderTargetSVG(doc, g) {
      var sd = P.GCP.data, sc = P.GCP.cfg;
      P.GCP.cfg = doc.cfg; P.GCP.data = P.GCP._compose(doc);
      var svg = null;
      // figura de publicação: SEMPRE no tema claro (fundo branco, tinta escura), qualquer que seja o tema da tela
      var root = document.documentElement, prevTheme = root.getAttribute("data-theme");
      root.setAttribute("data-theme", "light");
      try {
        if (!P.GCP.data) return null;
        var cols = P.GCP.cfg.colView && P.GCP.cfg.colCount > 1;
        if (g.kind === "columns" || (g.kind === "full" && cols)) { svg = buildColumnsExportSVG(); }
        else if (g.kind === "stage" && g.stage && cols) {
          // estágio dividido + modo coluna: exporta em colunas limitadas ao intervalo do estágio
          var stg0 = g.stage;
          if (!stg0.style) stg0.style = P.GCP.snapshotStyle();
          if (!stg0.presetId) stg0.presetId = P.GCP.cfg.activePreset;
          svg = buildColumnsExportSVG({ from: stg0.from, to: stg0.to, preset: P.GCP.presetById(stg0.presetId), style: stg0.style, stageTint: stg0.tint });
        }
        else {
          var tmp = document.createElement("div");
          tmp.style.cssText = "position:absolute;left:-99999px;top:0;width:1000px";
          document.body.appendChild(tmp);
          var ropts = { isSub: true, editable: false };
          if (g.kind === "stage" && g.stage) {
            var stg = g.stage;
            if (!stg.style) stg.style = P.GCP.snapshotStyle();
            if (!stg.presetId) stg.presetId = P.GCP.cfg.activePreset;
            ropts.range = { from: stg.from, to: stg.to };
            ropts.preset = P.GCP.presetById(stg.presetId);
            ropts.style = stg.style; ropts.stageTint = stg.tint;
          }
          P.GCP.render(tmp, ropts);
          svg = tmp.querySelector("svg");
          composeStrip(svg);
          document.body.removeChild(tmp);
        }
      } finally {
        P.GCP.data = sd; P.GCP.cfg = sc;
        if (prevTheme) root.setAttribute("data-theme", prevTheme); else root.removeAttribute("data-theme");
      }
      return svg;
    }
    P._gcpRenderTarget = renderTargetSVG;
    function openExportDialog() {
      if (!P.GCP.docs.length) { alert("Nenhum gráfico para exportar."); return; }
      var modal = $("gcp-export-modal"), tree = $("gcp-export-tree");
      var targets = collectExportTargets(), activeId = P.GCP.activeId, html = "";
      targets.forEach(function (t, ti) {
        var isActive = t.doc.id === activeId;
        html += '<div class="card" style="padding:8px 10px;margin-bottom:8px">' +
          '<label class="row" style="align-items:center;gap:8px;margin-bottom:6px"><input type="checkbox" data-exp-doc="' + ti + '" style="flex:0 0 auto"><b style="flex:1">' + P.escapeHtml(t.doc.name) + '</b>' + (isActive ? '<span class="pill" style="flex:0 0 auto">ativa</span>' : '') + '</label>';
        t.graphics.forEach(function (g, gi) {
          var def = isActive && gi === 0;   // default: 1º gráfico da aba ativa
          html += '<label class="row" style="align-items:center;gap:8px;margin:2px 0 2px 18px"><input type="checkbox" data-exp-item="' + ti + ':' + gi + '"' + (def ? " checked" : "") + ' style="flex:0 0 auto"><span style="flex:1">' + P.escapeHtml(g.label) + '</span></label>';
        });
        html += '</div>';
      });
      tree.innerHTML = html;
      function updateCount() {
        var n = tree.querySelectorAll("[data-exp-item]:checked").length;
        $("gcp-export-count").textContent = n ? (n + " selecionado" + (n === 1 ? "" : "s")) : "nada selecionado";
      }
      tree.querySelectorAll("[data-exp-doc]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          tree.querySelectorAll('[data-exp-item^="' + cb.getAttribute("data-exp-doc") + ':"]').forEach(function (it) { it.checked = cb.checked; });
          updateCount();
        });
      });
      tree.querySelectorAll("[data-exp-item]").forEach(function (cb) { cb.addEventListener("change", updateCount); });
      if ($("gcp-dpi")) $("gcp-export-dpi").value = $("gcp-dpi").value;
      updateCount();
      modal._targets = targets; modal.hidden = false;
    }
    function runExport() {
      var modal = $("gcp-export-modal"), tree = $("gcp-export-tree"), targets = modal._targets || [];
      var fmt = $("gcp-export-fmt").value, dpi = +$("gcp-export-dpi").value || 300, jobs = [];
      tree.querySelectorAll("[data-exp-item]:checked").forEach(function (cb) {
        var p = cb.getAttribute("data-exp-item").split(":"), t = targets[+p[0]]; if (!t) return;
        jobs.push({ doc: t.doc, g: t.graphics[+p[1]] });
      });
      if (!jobs.length) { alert("Selecione ao menos um gráfico."); return; }
      jobs.forEach(function (job, i) {
        setTimeout(function () {
          var svg = renderTargetSVG(job.doc, job.g); if (!svg) return;
          var base = "gcp_" + sanFile(job.doc.name) + (job.g.kind === "stage" ? "_" + sanFile(job.g.label) : "");
          if (fmt === "svg") P.GCP.exportSVG(base + ".svg", svg);
          else P.GCP.exportRaster(base + "." + (fmt === "jpg" ? "jpg" : "png"), fmt === "jpg" ? "image/jpeg" : "image/png", dpi, svg);
        }, i * 350);
      });
      $("gcp-export-count").textContent = "Exportando " + jobs.length + "…";
      setTimeout(function () { modal.hidden = true; }, jobs.length * 350 + 500);
    }
    if ($("gcp-export-open")) $("gcp-export-open").addEventListener("click", openExportDialog);
    if ($("gcp-export-close")) $("gcp-export-close").addEventListener("click", function () { $("gcp-export-modal").hidden = true; });
    if ($("gcp-export-cancel")) $("gcp-export-cancel").addEventListener("click", function () { $("gcp-export-modal").hidden = true; });
    if ($("gcp-export-modal")) $("gcp-export-modal").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
    if ($("gcp-export-run")) $("gcp-export-run").addEventListener("click", runExport);

    // Resumo dos estágios: opções da UI + fluxo de exportação (CSV / .html / copiar).
    function stageOpts() {
      return {
        format: $("gcp-st-format") ? $("gcp-st-format").value : "grid",
        number: $("gcp-st-number") ? $("gcp-st-number").value.trim() : "",
        session: $("gcp-st-session") ? $("gcp-st-session").value : "",
        caption: $("gcp-st-caption") ? $("gcp-st-caption").value.trim() : "",
        fonte: $("gcp-st-fonte") ? $("gcp-st-fonte").value.trim() : ""
      };
    }
    function stageStatus(msg, kind) {
      var el = $("gcp-st-status"); if (!el) return;
      el.textContent = msg; el.className = "status " + (kind || ""); el.style.display = "block";
    }
    function baseName() { return (P.Segmenter && P.Segmenter.file ? P.Segmenter.file.name.replace(/\.[^.]+$/, "") : "sessao") + "_estagios"; }
    function refreshStagePreview() {
      var host = $("gcp-st-preview"); if (!host) return;
      if (!P.GCP.data || !(P.GCP.data.stages || []).length) { host.innerHTML = '<span style="color:#666;font-family:sans-serif;font-size:12px">Nenhum estágio (objetivo de médio prazo) neste gráfico.</span>'; return; }
      host.innerHTML = P.GCP.stageTableHTML(stageOpts());
    }
    P.GCP._refreshStagePreview = refreshStagePreview;   // chamado pelo renderStats quando o gráfico muda
    ["gcp-st-session", "gcp-st-caption", "gcp-st-fonte", "gcp-st-number"].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener("input", refreshStagePreview);
    });
    if ($("gcp-st-format")) $("gcp-st-format").addEventListener("change", refreshStagePreview);
    if ($("gcp-st-csv")) $("gcp-st-csv").addEventListener("click", function () {
      if (!P.GCP.data || !(P.GCP.data.stages || []).length) { stageStatus("Nenhum estágio para exportar.", "warn"); return; }
      P.GCP.exportStageCSV(stageOpts().session, baseName() + ".csv");
      stageStatus("CSV dos estágios exportado.", "ok");
    });
    if ($("gcp-st-xlsx")) $("gcp-st-xlsx").addEventListener("click", function () {
      if (!P.GCP.data || !(P.GCP.data.stages || []).length) { stageStatus("Nenhum estágio para exportar.", "warn"); return; }
      P.GCP.exportStageXLSX(stageOpts().session, baseName() + ".xlsx");
      stageStatus("Planilha Excel (.xlsx) dos estágios exportada.", "ok");
    });
    if ($("gcp-st-copy")) $("gcp-st-copy").addEventListener("click", function () {
      if (!P.GCP.data || !(P.GCP.data.stages || []).length) { stageStatus("Nenhum estágio para copiar.", "warn"); return; }
      var html = P.GCP.stageTableHTML(stageOpts());
      var text = P.GCP.stageSummaryCSV(stageOpts().session).map(function (r) { return r.join("\t"); }).join("\n");
      function fallback() {
        try {
          var ta = document.createElement("textarea"); ta.value = text;
          ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta);
          ta.select(); var okCp = document.execCommand("copy"); document.body.removeChild(ta);
          if (okCp) stageStatus("Tabela copiada como texto (sem formatação). Para a tabela formatada, use «Excel».", "ok");
          else stageStatus("Não foi possível copiar. Use «Excel» ou «CSV».", "warn");
        } catch (e) { stageStatus("Não foi possível copiar. Use «Excel» ou «CSV».", "warn"); }
      }
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          navigator.clipboard.write([new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" })
          })]).then(function () { stageStatus("Tabela copiada. Cole no Word (" + (P.modKey || "Ctrl") + "+V).", "ok"); }, fallback);
        } catch (e) { fallback(); }
      } else fallback();
    });

    // resize
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (gcpLoaded && $("view-gcp").classList.contains("active")) renderGcp();
        if ($("view-segmentar").classList.contains("active") && P.Timeline.host) P.Timeline.render();
        if ($("view-multidim").classList.contains("active") && P.Mdim && P.Mdim.render) P.Mdim.render();
      }, 120);
    });

    // ---- P3: estado da interface lembrado (tema, tela e grupos abertos) ----
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    var savedTheme = lsGet("praxis.ui.theme");
    if (savedTheme === "light" || savedTheme === "dark") document.documentElement.setAttribute("data-theme", savedTheme);
    var savedGroups = {};
    try { savedGroups = JSON.parse(lsGet("praxis.ui.groups") || "{}"); } catch (e) { savedGroups = {}; }
    function groupKey(d) {
      var s = d.querySelector("summary"), sec = d.closest(".view");
      return (sec ? sec.id : "") + "::" + (s && s.firstChild ? s.firstChild.textContent.trim() : "");
    }
    document.querySelectorAll("details.group:not(#tier-editor-wrap)").forEach(function (d) {
      var k = groupKey(d);
      if (savedGroups.hasOwnProperty(k)) d.open = !!savedGroups[k];
      d.addEventListener("toggle", function () { savedGroups[k] = d.open; lsSet("praxis.ui.groups", JSON.stringify(savedGroups)); });
    });

    // ---- P5: Ctrl/Cmd + 1, 2, 3 alterna a tela ----
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (e.key === "1") { e.preventDefault(); activate("segmentar"); }
        else if (e.key === "2") { e.preventDefault(); activate("transcricao"); }
        else if (e.key === "3") { e.preventDefault(); activate("gcp"); }
        else if (e.key === "4") { e.preventDefault(); activate("multidim"); }
      }
    });

    var savedView = lsGet("praxis.ui.view");
    activate(["transcricao", "gcp", "multidim"].indexOf(savedView) >= 0 ? savedView : "segmentar");
  });

  function reRender() {
    if (!gcpLoaded) return;
    // preserva a rolagem do canvas (reconstruir o gráfico zerava o scroll ao mexer nos sliders)
    var ca = document.querySelector("#view-gcp .canvas-area");
    var st = ca ? ca.scrollTop : 0, sl = ca ? ca.scrollLeft : 0;
    renderGcp();
    if (ca && (ca.scrollTop !== st || ca.scrollLeft !== sl)) { ca.scrollTop = st; ca.scrollLeft = sl; }
  }

  // Estado do modo "comparar lado a lado" (item 3 do roadmap). otherId = 2º gráfico (direita).
  var compare = { on: false, aId: null, bId: null, dims: { a: null, b: null }, propLink: false, propMulX: 1, propMulY: 1, manual: false, _panels: null, _wr: null };   // propMulX/Y = escala horizontal/vertical do padronizar (arrasta a borda; aplica aos DOIS, mantendo proporção)   // comparar = tela dedicada (sem abas); aId/bId por 2 listas; dims = tamanho de cada card (alças de resize); manual=true após o usuário arrastar (senão os cards re-cabem à janela); propLink linka os dois (só mesmo tipo)

  // Desenha o gráfico ATIVO (P.GCP.data/cfg) dentro de host: colunas quando ligadas, senão único.
  // editable=false e isSub=true nos painéis de comparação (leitura, sem tocar this.svg/host).
  function renderGraphInto(host, opts) {
    opts = opts || {};
    var heat = P.GCP.cfg.chartStyle === "heatmap";
    var cols = !heat && P.GCP.cfg.colView && P.GCP.cfg.colCount > 1;
    if (cols) renderColumns(host, opts.editable !== false);
    else P.GCP.render(host, { editable: opts.editable !== false, isSub: !!opts.isSub, width: opts.width, fitHeight: opts.fitHeight, pxPerUnit: opts.pxPerUnit, rowStep: opts.rowStep, rowH: opts.rowH });   // width/fitHeight/pxPerUnit/rowStep/rowH: usados na comparação p/ o gráfico RE-RENDERIZAR cabendo no card e na escala padronizada (nítido, sem esticar)
  }

  // Renderiza um doc arbitrário dentro de host SEM trocar o gráfico ativo (troca temporária de estado).
  function renderDocInto(id, host, size) {
    var g = P.GCP._docById(id); if (!g) return;
    var data = P.GCP._compose(g); if (!data) return;
    var heat = g.cfg.chartStyle === "heatmap";
    var opts = { editable: false, isSub: true };
    if (size && size.stdPx != null) {   // PADRONIZAR: escala compartilhada (px/compasso e altura de linha iguais nos dois; calcula pelo maior). X e Y são independentes (arrasta a borda direita = X, a inferior = Y).
      var range = docRange(id);
      if (heat) { opts.width = Math.round(range * size.stdPx + 152); opts.rowH = Math.max(10, 30 * (size.stdMulY || 1)); }   // 152 = M.l(132)+M.r(20) do heatmap
      else { opts.pxPerUnit = size.stdPx; opts.rowStep = Math.max(1, 9 * (size.stdMulY || 1)); }
    } else if (size && size.w) {
      var sw = Math.round(size.w);
      if (heat) { opts.width = Math.max(200, sw); if (size.h && !size.noFit) opts.fitHeight = Math.max(120, Math.round(size.h)); }   // heatmap: cabe nos dois
      else opts.width = Math.max(200, sw - 14);   // GCP: cabe na LARGURA e rola na vertical
    }
    var sd = P.GCP.data, sc = P.GCP.cfg;
    P.GCP.data = data; P.GCP.cfg = g.cfg;
    try { renderGraphInto(host, opts); }
    finally { P.GCP.data = sd; P.GCP.cfg = sc; }
  }

  function firstOtherDoc(id) {
    for (var i = 0; i < P.GCP.docs.length; i++) if (P.GCP.docs[i].id !== id) return P.GCP.docs[i].id;
    return null;
  }
  function sameChartType(a, b) { var ga = P.GCP._docById(a), gb = P.GCP._docById(b); return !!(ga && gb && (ga.cfg.chartStyle || "blocks") === (gb.cfg.chartStyle || "blocks")); }

  // Popula as duas listas + o "padronizar" (só mesmo tipo) + a config de eixo de cada lado.
  function syncCompareUI() {
    var sa = $("gcp-compare-a"), sb = $("gcp-compare-b"), propLbl = $("gcp-compare-prop-lbl"), propChk = $("gcp-compare-prop");
    if (!sa || !sb) return;
    if (!compare.aId || !P.GCP._docById(compare.aId)) compare.aId = P.GCP.activeId || (P.GCP.docs[0] && P.GCP.docs[0].id);
    if (!compare.bId || compare.bId === compare.aId || !P.GCP._docById(compare.bId)) compare.bId = firstOtherDoc(compare.aId);
    function fill(sel, chosen) { sel.innerHTML = ""; P.GCP.docs.forEach(function (g) { var o = document.createElement("option"); o.value = g.id; o.textContent = g.name || "Gráfico"; if (g.id === chosen) o.selected = true; sel.appendChild(o); }); }
    fill(sa, compare.aId); fill(sb, compare.bId);
    var same = sameChartType(compare.aId, compare.bId);
    if (!same) compare.propLink = false;
    if (propLbl) propLbl.hidden = !same;
    if (propChk) propChk.checked = compare.propLink;
    var hint = $("gcp-cmp-std-hint"); if (hint) hint.hidden = !(same && compare.propLink);   // dica: arrastar a borda redimensiona os dois
    renderCmpAxis("a", compare.aId); renderCmpAxis("b", compare.bId);
  }
  // Config de eixo por lado (no comparar cada gráfico pode ter mín/máx/rótulos próprios). Auto = recalcula sozinho no render.
  function renderCmpAxis(side, id) {
    var host = $("gcp-cmp-axis-" + side); if (!host) return;
    var g = P.GCP._docById(id); if (!g) { host.innerHTML = ""; return; }
    var c = g.cfg;
    function row(lbl, k) { return '<label class="cmp-axf-row"><span>' + lbl + '</span><input type="number" class="mini" data-k="' + k + '" placeholder="auto" value="' + (c[k] != null ? c[k] : "") + '"></label>'; }
    host.innerHTML = row("Eixo x início", "axisMMin") + row("Eixo x fim", "axisMMax") + row("Intervalo dos rótulos", "axisLabelStep");
    Array.prototype.forEach.call(host.querySelectorAll("input"), function (inp) {
      inp.addEventListener("input", function () { var k = this.getAttribute("data-k"), v = this.value === "" ? null : +this.value; g.cfg[k] = (v != null && isFinite(v)) ? v : null; renderGcp(); });
    });
  }
  // Modo comparar: esconde os demais grupos do inspetor (só o grupo Comparar fica) e alterna botão entrar/sair.
  function syncCompareMode() {
    var cmp = compare.on, aside = document.querySelector("#view-gcp .sidebar.inspector");
    if (aside) Array.prototype.forEach.call(aside.querySelectorAll("details.group"), function (d) { if (d.id !== "gcp-insp-compare") d.hidden = cmp; });
    if ($("gcp-cmp-enter")) { $("gcp-cmp-enter").hidden = cmp; $("gcp-cmp-enter").disabled = P.GCP.docs.length < 2; }
    if ($("gcp-cmp-controls")) $("gcp-cmp-controls").hidden = !cmp;
    var grp = $("gcp-insp-compare"); if (grp) grp.open = true;
  }
  function exportComparePNG() {
    if (!(compare.on && P.GCP.docs.length >= 2)) return;
    var root = document.documentElement, prev = root.getAttribute("data-theme"), el;
    root.setAttribute("data-theme", "light");   // figura de publicação sempre em fundo branco
    try { el = buildCompareSVG(); } finally { if (prev) root.setAttribute("data-theme", prev); else root.removeAttribute("data-theme"); }
    if (el && P.GCP.exportPNG) P.GCP.exportPNG(300, el);
  }
  // Faixa de compassos de um doc (p/ a escala compartilhada do "padronizar").
  function docRange(id) {
    var g = P.GCP._docById(id); if (!g) return 1;
    var data = P.GCP._compose(g); if (!data) return 1;
    var lo = Infinity, hi = -Infinity;
    (data.segments || []).forEach(function (s) { if (isFinite(s.mStart)) { lo = Math.min(lo, s.mStart); hi = Math.max(hi, s.mStart); } if (isFinite(s.mEnd)) { lo = Math.min(lo, s.mEnd); hi = Math.max(hi, s.mEnd); } });
    if (g.cfg.axisMMin != null) lo = g.cfg.axisMMin; if (g.cfg.axisMMax != null) hi = g.cfg.axisMMax;
    return (isFinite(hi) && isFinite(lo) && hi > lo) ? (hi - lo) : 1;
  }
  // PADRONIZAR: escala compartilhada calculada pelo MAIOR gráfico (fica legível preenchendo a largura do monitor),
  // vezes os fatores do usuário (propMulX na horizontal = px/compasso; propMulY na vertical = altura de linha).
  // Os DOIS lados usam a MESMA escala → comparável e proporcional, independentemente do arraste.
  function computeStdScale(host, a, b) {
    var ga = P.GCP._docById(a), heat = ga && ga.cfg.chartStyle === "heatmap";
    var margin = heat ? 156 : 190;   // M.l+M.r por card (heatmap tem rótulos de linha largos ~132; GCP tem legenda)
    var ra = docRange(a), rb = docRange(b), availW = (host.clientWidth || 900) - 12;
    var usable = Math.max(120, availW - 2 * margin);
    var basePx = Math.max(2, usable / (ra + rb));   // base: os DOIS cabem lado a lado (mesma escala); o arraste horizontal (propMulX) amplia e rola
    var mulX = compare.propMulX || 1, mulY = compare.propMulY || 1;
    return { px: basePx * mulX, mulY: mulY };
  }
  function applyStdZoom() {   // re-render leve dos dois lados na escala atual, sem reconstruir o palco
    var host = $("gcp-compare"); if (!host || !compare._panels) return;
    var sc = computeStdScale(host, compare.aId, compare.bId);
    Object.keys(compare._panels).forEach(function (s) { renderStdSide(compare._panels[s], sc); });
  }
  function renderStdSide(p, scale) {   // renderiza um lado na escala padronizada (viewBox em px 1:1, nítido) e ajusta o card ao gráfico
    renderDocInto(p.id, p.host, { stdPx: scale.px, stdMulY: scale.mulY });
    var svg = p.host.querySelector("svg"); if (!svg) return;
    var vb = (svg.getAttribute("viewBox") || "0 0 320 220").split(/\s+/).map(Number);
    var sw = vb[2] || 320, sh = vb[3] || 220;
    svg.style.width = sw + "px"; svg.style.height = sh + "px";   // px explícito = 1:1 (legível; sem escalar pra 100% do card)
    p.panel.style.width = Math.round(sw) + "px"; p.panel.style.height = Math.round(sh + (p.title ? p.title.offsetHeight : 30) + 2) + "px";
  }
  // No padronizar, arrastar a borda é um RESIZER de escala compartilhada: a borda direita (axis "x") escala a
  // largura (px/compasso), a inferior (axis "y") escala a altura de linha, o canto (axis "xy") faz as duas.
  // Aplica aos DOIS lados com os mesmos fatores (bounds 0.4–4) → mantêm proporcionalidade.
  function wireStdResize(rz, axis) {
    rz.addEventListener("mousedown", function (e) {
      e.preventDefault(); e.stopPropagation();
      var pnl = rz.parentNode, host = $("gcp-compare");
      var w0 = pnl.offsetWidth || 1, h0 = pnl.offsetHeight || 1;
      var mx0 = compare.propMulX || 1, my0 = compare.propMulY || 1, x0 = e.clientX, y0 = e.clientY, raf = null;
      document.body.style.cursor = getComputedStyle(rz).cursor;
      function apply() { raf = null; var sc = computeStdScale(host, compare.aId, compare.bId); Object.keys(compare._panels).forEach(function (s) { renderStdSide(compare._panels[s], sc); }); }
      function mm(ev) {
        if (axis.indexOf("x") >= 0) compare.propMulX = Math.max(0.4, Math.min(4, mx0 * (w0 + (ev.clientX - x0)) / w0));
        if (axis.indexOf("y") >= 0) compare.propMulY = Math.max(0.4, Math.min(4, my0 * (h0 + (ev.clientY - y0)) / h0));
        if (!raf) raf = requestAnimationFrame(apply);
      }
      function mu() { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); document.body.style.cursor = ""; if (raf) cancelAnimationFrame(raf); apply(); }
      window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
    });
  }

  // Tamanhos padrão dos cards: se o usuário ainda NÃO arrastou (compare.manual), recalcula pela largura disponível
  // (por isso o comparar re-cabe quando a janela muda); depois de arrastar, respeita o que ele definiu.
  function ensureCompareDims(host) {
    if (compare.manual && compare.dims.a && compare.dims.a.w) return;
    var avail = (host.clientWidth || 900) - 12, w = Math.max(260, Math.floor(avail / 2)), hh = Math.min(640, Math.max(320, Math.round((window.innerHeight || 800) * 0.6)));
    compare.dims.a = { w: w, h: hh }; compare.dims.b = { w: w, h: hh };
  }
  function renderCompareCard(p) {   // (re)desenha um lado cabendo no card: largura sempre; heatmap também na altura; GCP rola
    renderDocInto(p.id, p.host, { w: p.host.clientWidth, h: p.host.clientHeight });
  }
  function renderCompare() {
    var host = $("gcp-compare");
    $("gcp-chart").parentElement.style.display = "none";
    $("gcp-stages").style.display = "none";
    $("gcp-empty").style.display = "none";
    host.hidden = false; host.innerHTML = "";
    var leftId = (compare.aId && P.GCP._docById(compare.aId)) ? compare.aId : (P.GCP.activeId || (P.GCP.docs[0] && P.GCP.docs[0].id));
    var rightId = (compare.bId && P.GCP._docById(compare.bId) && compare.bId !== leftId) ? compare.bId : firstOtherDoc(leftId);
    compare.aId = leftId; compare.bId = rightId;
    var prop = compare.propLink && sameChartType(leftId, rightId);   // padronizar: escala compartilhada (calc. pelo maior, legível) + zoom conjunto
    ensureCompareDims(host);
    var scale = prop ? computeStdScale(host, leftId, rightId) : null;
    var panels = {};
    [{ id: leftId, side: "a" }, { id: rightId, side: "b" }].forEach(function (it) {
      var g = P.GCP._docById(it.id);
      var panel = document.createElement("div"); panel.className = "cmp-panel"; panel.dataset.side = it.side;
      if (!prop) { var d = compare.dims[it.side]; panel.style.width = d.w + "px"; panel.style.height = d.h + "px"; }
      var h = document.createElement("div"); h.className = "cmp-title"; h.textContent = (g && g.name) || "-"; panel.appendChild(h);
      var chost = document.createElement("div"); chost.className = "cmp-host px-scroll"; panel.appendChild(chost);
      ["x", "y", "xy"].forEach(function (ax) {   // alças de borda: direita=X, inferior=Y, canto=ambas
        var rz = document.createElement("div"); rz.className = "cmp-rz cmp-rz-" + ax; panel.appendChild(rz);
        if (prop) wireStdResize(rz, ax);   // padronizado: arrasta a borda → escala compartilhada (X = largura, Y = altura de linha), aplica aos dois
        else wireCmpResize(rz, it.side, ax);   // livre: cada card tem seu tamanho
      });
      host.appendChild(panel);
      panels[it.side] = { panel: panel, host: chost, id: it.id, title: h };
    });
    compare._panels = panels;
    // renderiza APÓS o layout (pra ler o tamanho real de cada host)
    Object.keys(panels).forEach(function (s) {
      var p = panels[s]; if (!P.GCP._docById(p.id)) return;
      if (prop) renderStdSide(p, scale);   // escala compartilhada + card ajustado ao gráfico
      else renderCompareCard(p);
    });
  }
  // Alça de resize do card: x=largura, y=altura, xy=ambas. Arrasta → atualiza dims → re-renderiza cabendo.
  // Com "redimensionar juntos" ligado (só mesmo tipo), espelha o tamanho no outro card.
  function wireCmpResize(rz, side, axis) {
    rz.addEventListener("mousedown", function (e) {
      e.preventDefault(); e.stopPropagation();
      var panels = compare._panels, p = panels && panels[side]; if (!p) return;
      var x0 = e.clientX, y0 = e.clientY, w0 = p.panel.offsetWidth, h0 = p.panel.offsetHeight;
      var same = sameChartType(compare.aId, compare.bId), raf = null;
      document.body.style.cursor = getComputedStyle(rz).cursor;
      function apply() {
        raf = null;
        var d = compare.dims[side];
        p.panel.style.width = d.w + "px"; p.panel.style.height = d.h + "px"; renderCompareCard(p);
        if (compare.propLink && same) {
          var op = panels[side === "a" ? "b" : "a"];
          if (op) { compare.dims[op.panel.dataset.side] = { w: d.w, h: d.h }; op.panel.style.width = d.w + "px"; op.panel.style.height = d.h + "px"; renderCompareCard(op); }
        }
      }
      function mm(ev) {
        var d = { w: (compare.dims[side] || {}).w || w0, h: (compare.dims[side] || {}).h || h0 };
        if (axis === "x" || axis === "xy") d.w = Math.max(220, w0 + (ev.clientX - x0));
        if (axis === "y" || axis === "xy") d.h = Math.max(160, h0 + (ev.clientY - y0));
        compare.dims[side] = d; compare.manual = true;
        if (!raf) raf = requestAnimationFrame(apply);
      }
      function mu() { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); document.body.style.cursor = ""; if (raf) cancelAnimationFrame(raf); apply(); }
      window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
    });
  }

  // Exportação comparativa: monta UM SVG com os dois gráficos (ativo + comparado) lado a lado, com títulos.
  // Cada doc é renderizado como SVG único (mesma composição do export normal), embutido como <svg> aninhado.
  function buildCompareSVG() {
    var NS = "http://www.w3.org/2000/svg";
    function docSVG(id) {
      var g = P.GCP._docById(id); if (!g) return null;
      var data = P.GCP._compose(g); if (!data) return null;
      var sd = P.GCP.data, sc = P.GCP.cfg;
      P.GCP.data = data; P.GCP.cfg = g.cfg;
      var tmp = document.createElement("div"); tmp.style.cssText = "position:absolute;left:-99999px;top:0;width:1000px";
      document.body.appendChild(tmp);
      try { P.GCP.render(tmp, { isSub: true }); } finally { P.GCP.data = sd; P.GCP.cfg = sc; }
      var svg = tmp.querySelector("svg"); document.body.removeChild(tmp);
      return svg ? { svg: svg, name: g.name || "Gráfico" } : null;
    }
    var A = docSVG(compare.aId || P.GCP.activeId), B = docSVG(compare.bId);
    if (!A || !B) return null;
    function vb(s) { return (s.getAttribute("viewBox") || "0 0 680 400").split(/\s+/).map(Number); }
    var vbA = vb(A.svg), vbB = vb(B.svg);
    var wA = vbA[2], hA = vbA[3], wB = vbB[2], hB = vbB[3];
    var gap = 40, titleH = 40, pad = 16;
    var W = pad + wA + gap + wB + pad, H = pad + titleH + Math.max(hA, hB) + pad;
    var out = document.createElementNS(NS, "svg");
    out.setAttribute("xmlns", NS); out.setAttribute("viewBox", "0 0 " + W + " " + H);
    out.setAttribute("width", W); out.setAttribute("height", H);
    function place(svg, x, w, h) { svg.setAttribute("x", x); svg.setAttribute("y", pad + titleH); svg.setAttribute("width", w); svg.setAttribute("height", h); svg.removeAttribute("style"); return svg; }
    function title(text, x, w) { var t = document.createElementNS(NS, "text"); t.setAttribute("x", x + w / 2); t.setAttribute("y", pad + 26); t.setAttribute("text-anchor", "middle"); t.setAttribute("font-family", "system-ui, Segoe UI, sans-serif"); t.setAttribute("font-size", "20"); t.setAttribute("font-weight", "700"); t.setAttribute("fill", "#111111"); t.textContent = text; return t; }
    out.appendChild(place(A.svg, pad, wA, hA));
    out.appendChild(place(B.svg, pad + wA + gap, wB, hB));
    out.appendChild(title(A.name, pad, wA));
    out.appendChild(title(B.name, pad + wA + gap, wB));
    return out;
  }

  // Export do gráfico ativo EM COLUNAS: compõe as colunas (mesmo cálculo da tela) num SVG único, lado a lado.
  // Usa o tamanho natural (rowStep do estilo), não o "caber na altura" - export em resolução cheia.
  // sub = { from, to, preset, style, stageTint } limita as colunas a um ESTÁGIO (índices globais 1-based), igual ao renderColumns.
  function buildColumnsExportSVG(sub) {
    var base = P.GCP.data.segments.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); });
    var rf = sub && sub.from ? Math.max(1, sub.from) : 1, rt = sub && sub.to ? Math.min(base.length, sub.to) : base.length;
    var all = base.slice(rf - 1, rt);
    var N = all.length; if (!N) return null;
    var C = Math.min(P.GCP.cfg.colCount, Math.max(1, N));
    var per = Math.ceil(N / C);
    var gap = P.GCP.cfg.colGap != null ? P.GCP.cfg.colGap : 10;
    var colW = 700;   // largura fixa por coluna no export (o DPI cuida da resolução)
    var mode = P.GCP.cfg.colAxisMode || "proportional", pxPerUnit = 0;
    if (mode === "efficient") {
      var gmin = Infinity, gmax = -Infinity;
      all.forEach(function (s) { if (isFinite(s.mStart)) { gmin = Math.min(gmin, s.mStart); gmax = Math.max(gmax, s.mStart); } if (isFinite(s.mEnd)) { gmin = Math.min(gmin, s.mEnd); gmax = Math.max(gmax, s.mEnd); } });
      var gRange = (gmax > gmin) ? (gmax - gmin) : 1;
      var plotW = colW - (P.GCP.cfg.showSegLabels ? 52 : 16) - 8;
      pxPerUnit = Math.max(1, plotW / gRange) * (P.GCP.cfg.colEffScale || 1);
    }
    var NS = "http://www.w3.org/2000/svg";
    var tmp = document.createElement("div"); tmp.style.cssText = "position:absolute;left:-99999px;top:0;width:1200px"; document.body.appendChild(tmp);
    var Ccols = 0; for (var cc = 0; cc < C; cc++) { if (rf + cc * per <= Math.min(rt, rf + (cc + 1) * per - 1)) Ccols++; }
    var legHost = P.GCP.cfg.showLegend ? (/left/.test(P.GCP.cfg.legendPos || "right") ? 0 : Ccols - 1) : -1;   // 1 legenda p/ todas
    var cols = [];
    for (var c = 0; c < C; c++) {
      var from = rf + c * per, to = Math.min(rt, rf + (c + 1) * per - 1); if (from > to) break;
      var ropts = { isSub: true, range: { from: from, to: to }, compact: true };
      if (mode === "efficient") { ropts.sharedAxis = false; ropts.pxPerUnit = pxPerUnit; }
      else { ropts.sharedAxis = (mode === "proportional"); ropts.width = colW; }
      if (sub) { if (sub.preset) ropts.preset = sub.preset; if (sub.style) ropts.style = sub.style; if (sub.stageTint) ropts.stageTint = sub.stageTint; ropts.sharedAxisRange = { from: rf, to: rt }; }
      if (P.GCP.cfg.colSingleAxis) ropts.noAxisTitles = true;   // título único: colunas sem título próprio
      if (c === legHost) { ropts.forceLegend = true; ropts.legendUsedAll = all; }   // filtro "só usados" vê TODAS as colunas
      tmp.innerHTML = ""; P.GCP.render(tmp, ropts);
      var svg = tmp.querySelector("svg"); if (svg) cols.push(svg.cloneNode(true));
    }
    document.body.removeChild(tmp);
    if (!cols.length) return null;
    function vb(s) { return (s.getAttribute("viewBox") || "0 0 680 400").split(/\s+/).map(Number); }
    var xs = [], ws = [], hs = [], x = 0, maxH = 0;
    cols.forEach(function (s) { var v = vb(s); ws.push(v[2]); hs.push(v[3]); xs.push(x); x += v[2] + gap; if (v[3] > maxH) maxH = v[3]; });
    var single = P.GCP.cfg.colSingleAxis, ats = P.GCP.cfg.axisTitleSize || 11;
    var mL = single ? (ats + 12) : 0, mB = single ? (ats + 14) : 0, plotW = x - gap;
    var out = document.createElementNS(NS, "svg"); out.setAttribute("xmlns", NS);
    out.setAttribute("viewBox", "0 0 " + (plotW + mL) + " " + (maxH + mB)); out.setAttribute("width", plotW + mL); out.setAttribute("height", maxH + mB);
    cols.forEach(function (s, i) { s.setAttribute("x", xs[i] + mL); s.setAttribute("y", 0); s.setAttribute("width", ws[i]); s.setAttribute("height", hs[i]); s.removeAttribute("style"); out.appendChild(s); });
    if (single) {
      var light = document.documentElement.getAttribute("data-theme") === "light";
      var pr = P.GCP.activePreset(); var isBW = pr && pr.kind === "bw";
      var fg = isBW ? "#111111" : (light ? "#16202b" : "#e7edf3");
      var col = P.GCP.cfg.axisTitleColor || fg, cs = P.GCP.cfg.axisTitleCase;
      function titleEl(txt, x2, y2, rot) {
        var t = document.createElementNS(NS, "text");
        t.setAttribute("x", x2); t.setAttribute("y", y2); t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", col);
        t.setAttribute("font-family", pr && pr.font ? pr.font : (P.GCP.cfg.font || "sans-serif"));
        t.setAttribute("font-size", ats); if (P.GCP.cfg.axisTitleBold) t.setAttribute("font-weight", 700);
        if (P.GCP.cfg.axisTitleTrack) t.setAttribute("letter-spacing", P.GCP.cfg.axisTitleTrack + "px");
        if (rot) t.setAttribute("transform", "rotate(-90 " + x2 + " " + y2 + ")");
        t.textContent = P.GCP._axCase(txt, cs); return t;
      }
      out.appendChild(titleEl(P.GCP.cfg.xTitle != null ? P.GCP.cfg.xTitle : "Compasso", mL + plotW / 2, maxH + mB - 4, false));
      out.appendChild(titleEl(P.GCP.cfg.yTitle != null ? P.GCP.cfg.yTitle : "Segmento de prática", ats * 0.7, maxH / 2, true));
    }
    return out;
  }

  // === Módulos de gráfico na aba Segmentar: N painéis, cada um segue a agulha, com estado PRÓPRIO ===
  // (doc/zoom/fitX/seguir independentes). Cada instância é criada pela fábrica makeGcpInst e registrada
  // como um "módulo" no palco (engine de tiling). O gerente P.SegGCP controla o conjunto; o estado viaja
  // com o PROJETO (serialize/restore em P.StageLayout.graphs), não com o programa.
  var GCP_ICON = {
    zout: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5"/><path d="M11.8 11.8L16 16M5.5 8h5"/></svg>',
    zin: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5"/><path d="M11.8 11.8L16 16M5.5 8h5M8 5.5v5"/></svg>',
    fitx: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5v8M3.2 9h3.2M4.8 7.5L6.4 9l-1.6 1.5M14.8 9h-3.2M13.2 7.5L11.6 9l1.6 1.5" stroke-width="1.7"/></svg>',
    follow: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M11 7a3 3 0 0 0-4.2 0L4.5 9.3a3 3 0 0 0 4.2 4.2l1-1"/></svg>',
    eye: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 9S4 4 9 4s7.5 5 7.5 5-2.5 5-7.5 5S1.5 9 1.5 9z"/><circle cx="9" cy="9" r="2"/></svg>',
    close: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l10 10M14 4L4 14"/></svg>'
  };
  function gcpPaneDom(modId) {
    var s = (modId === "gcp") ? "" : "__" + modId;
    var d = document.createElement("div"); d.className = "gcpseg-pane"; d.dataset.mod = modId;
    d.innerHTML =
      '<div class="score-toolbar">' +
        '<span class="hint gcpseg-label" style="flex:0 0 auto;font-weight:700">Gráfico</span>' +
        '<select id="seggcp-doc' + s + '" style="flex:0 0 auto;max-width:150px"></select>' +
        '<span class="hint" id="seggcp-status' + s + '" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>' +
        '<button class="icon-btn" id="seggcp-zoomout' + s + '" title="Menos zoom">' + GCP_ICON.zout + '</button>' +
        '<span class="hint" id="seggcp-zoomval' + s + '" style="flex:0 0 auto;min-width:34px;text-align:center;font-variant-numeric:tabular-nums">100%</span>' +
        '<button class="icon-btn" id="seggcp-zoomin' + s + '" title="Mais zoom">' + GCP_ICON.zin + '</button>' +
        '<button class="icon-btn" id="seggcp-fitx' + s + '" title="Ajustar o eixo de compassos ao que está visível (com 2 compassos de folga)">' + GCP_ICON.fitx + '</button>' +
        '<button class="icon-btn active" id="seggcp-follow' + s + '" title="Seguir a agulha: destaca e rola até o segmento sob a reprodução. Desligue para olhar livre.">' + GCP_ICON.follow + '</button>' +
        '<button class="icon-btn" id="seggcp-collapse' + s + '" title="Ocultar este gráfico (reabre pela barrinha acima)">' + GCP_ICON.eye + '</button>' +
        '<button class="icon-btn" id="seggcp-close' + s + '" title="Remover este painel de gráfico">' + GCP_ICON.close + '</button>' +
      '</div>' +
      '<div id="seg-gcp-host' + s + '" class="gcpseg-render px-scroll"></div>';
    return d;
  }
  function makeGcpInst(modId, cfg) {
    cfg = cfg || {};
    var s = (modId === "gcp") ? "" : "__" + modId;
    var hostId = "seg-gcp-host" + s;
    function q(base) { return $(base + s); }
    var st = { id: modId, active: false, follow: cfg.follow !== false, docId: cfg.docId || null, segTimes: null, meas: null, segMin: 0, segMax: 1, lastSeg: -1, zoom: Math.max(1, Math.min(4, cfg.zoom || 1)), fitX: cfg.fitX !== false, isHeat: false, band: null, readout: null, gutter: null, ruler: null, _sc: null };
    var pane = gcpPaneDom(modId);

    function syncControls() {   // esconde controles sem sentido no heatmap (segue-agulha, ajuste de eixo)
      ["seggcp-follow", "seggcp-fitx"].forEach(function (id) { var b = q(id); if (b) b.hidden = st.isHeat; });
      var fx = q("seggcp-fitx"); if (fx) fx.classList.toggle("active", st.fitX && !st.isHeat);
      var fo = q("seggcp-follow"); if (fo) fo.classList.toggle("active", st.follow && !st.isHeat);
      var zv = q("seggcp-zoomval"); if (zv) zv.textContent = Math.round((st.zoom || 1) * 100) + "%";
    }
    function fin(x) { return isFinite(x.mStart) && isFinite(x.mEnd); }
    function visibleRange(host, scrollTop) {   // faixa de compassos VISÍVEL, medida pelos atributos y (imune ao scroll do DOM) + o scrollTop pretendido
      var meas = st.meas; if (!meas) return null;
      var svg = host.querySelector("svg"); if (!svg) return null;
      var vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number), vbH = vb[3] || 1;
      var rect = svg.getBoundingClientRect(), scale = rect.height ? rect.height / vbH : 1;
      var top = (scrollTop == null ? host.scrollTop : scrollTop), bot = top + host.clientHeight;
      var bars = svg.querySelectorAll("rect[data-seg]"), lo = Infinity, hi = -Infinity;
      for (var i = 0; i < bars.length; i++) {
        var y = parseFloat(bars[i].getAttribute("y")), h = parseFloat(bars[i].getAttribute("height")) || 0;
        if (!isFinite(y)) continue;
        if ((y + h) * scale < top || y * scale > bot) continue;
        var m = meas[bars[i].getAttribute("data-seg")]; if (!m) continue;
        if (m[0] < lo) lo = m[0]; if (m[1] > hi) hi = m[1];
      }
      return isFinite(lo) ? { lo: lo, hi: hi } : null;
    }
    function updateReadout(segNum) {
      var ro = st.readout; if (!ro) return;
      if (!segNum || !st.meas || !st.meas[segNum]) { ro.style.display = "none"; return; }
      var m = st.meas[segNum]; ro.textContent = "c. " + Math.round((m[0] + m[1]) / 2) + "  |  seg " + segNum; ro.style.display = "block";
    }
    function centerSeg(host) {
      var hr = host.getBoundingClientRect(), cy = hr.top + host.clientHeight / 2, best = null, bd = Infinity, bars = host.querySelectorAll("rect[data-seg]");
      for (var i = 0; i < bars.length; i++) { var r = bars[i].getBoundingClientRect(); var d = Math.abs((r.top + r.height / 2) - cy); if (d < bd) { bd = d; best = +bars[i].getAttribute("data-seg"); } }
      return best;
    }
    function render(keepScroll) {
      var host = $(hostId); if (!host) return;
      var ps = keepScroll ? { t: host.scrollTop, l: host.scrollLeft } : null;
      st.segTimes = null; st.meas = null; st.lastSeg = -1; st.band = null; st.readout = null;
      if (!st.active) { host.innerHTML = ""; return; }
      var id = (st.docId && P.GCP._docById(st.docId)) ? st.docId : P.GCP.activeId; st.docId = id;
      var g = id ? P.GCP._docById(id) : null;
      if (!g) { host.innerHTML = '<div class="hint" style="padding:20px">Gere um gráfico na aba Gráfico para acompanhá-lo aqui, sincronizado por segmento.</div>'; return; }
      var data = P.GCP._compose(g); if (!data) return;
      st.isHeat = (g.cfg.chartStyle === "heatmap");
      if (st.isHeat) {
        var sdh = P.GCP.data, sch = P.GCP.cfg; P.GCP.data = data; P.GCP.cfg = g.cfg;
        try { P.GCP.render(host, { isSub: true, editable: false, width: Math.max(200, host.clientWidth - 4), fitHeight: Math.max(120, host.clientHeight - 2) }); } finally { P.GCP.data = sdh; P.GCP.cfg = sch; }
        syncControls();
        return;
      }
      var segs = data.segments.filter(fin), pieceMin = Infinity, pieceMax = -Infinity;
      segs.forEach(function (x) { if (x.mStart < pieceMin) pieceMin = x.mStart; if (x.mEnd > pieceMax) pieceMax = x.mEnd; });
      st.segMin = pieceMin; st.segMax = pieceMax;
      function pass(axisOv) {
        var sd = P.GCP.data, sc = P.GCP.cfg;
        P.GCP.data = data; P.GCP.cfg = axisOv ? Object.assign({}, g.cfg, axisOv) : g.cfg;
        try { P.GCP.render(host, { isSub: true, editable: false, compact: true, width: Math.max(200, host.clientWidth - 4) }); } finally { P.GCP.data = sd; P.GCP.cfg = sc; }
        var svg = host.querySelector("svg"), z = st.zoom || 1;
        if (svg) { var vb = (svg.getAttribute("viewBox") || "0 0 680 400").split(/\s+/).map(Number); svg.style.width = Math.round(vb[2] * z) + "px"; svg.style.height = Math.round(vb[3] * z) + "px"; }
      }
      pass(null);
      var times = [], meas = {}; for (var i = 0; i < segs.length; i++) { times.push([segs[i].tStart, segs[i].tEnd]); meas[i + 1] = [segs[i].mStart, segs[i].mEnd]; }
      st.segTimes = times; st.meas = meas;
      if (ps) { host.scrollTop = ps.t; host.scrollLeft = ps.l; }
      if (st.fitX) { var vr = visibleRange(host, ps ? ps.t : host.scrollTop); if (vr) { var lo = Math.max(pieceMin, vr.lo - 2), hi = Math.min(pieceMax, vr.hi + 2); if (hi > lo) pass({ axisMMin: lo, axisMMax: hi }); } }   // 2 compassos de folga de cada lado (clampado ao trecho): respiro, não a margem-bug
      var svgEl = host.querySelector("svg");
      var grid = document.createElement("div"); grid.className = "seg-gcp-grid";
      if (svgEl) grid.appendChild(svgEl);
      host.appendChild(grid);
      var band = document.createElement("div"); band.className = "seg-gcp-band"; band.style.display = "none"; grid.appendChild(band); st.band = band;
      var ro = document.createElement("div"); ro.className = "seg-gcp-readout"; ro.style.display = "none"; grid.appendChild(ro); st.readout = ro;
      if (ps) { host.scrollTop = ps.t; host.scrollLeft = ps.l; }
      buildAxes(host, g);
      syncControls();
      if (P.Segmenter && P.Segmenter.media && P.Segmenter.annNow) sync(P.Segmenter.annNow());
      else updateReadout(centerSeg(host));
    }
    function sync(t) {
      if (!st.active) return;
      var host = $(hostId); if (!host) return;
      var times = st.segTimes; if (!times || !times.length) return;
      var cur = -1;
      for (var i = 0; i < times.length; i++) { if (t >= times[i][0] && t < times[i][1]) { cur = i; break; } }
      if (cur === st.lastSeg) return;
      var prev = host.querySelector("rect.seg-gcp-cur"); if (prev) prev.classList.remove("seg-gcp-cur");
      st.lastSeg = cur;
      if (cur < 0) { if (st.band) st.band.style.display = "none"; return; }
      var bar = host.querySelector('rect[data-seg="' + (cur + 1) + '"]'); if (!bar) { if (st.band) st.band.style.display = "none"; return; }
      bar.classList.add("seg-gcp-cur");
      var br = bar.getBoundingClientRect(), hr = host.getBoundingClientRect();
      if (st.band) { st.band.style.display = "block"; st.band.style.top = (br.top - hr.top + host.scrollTop - 2) + "px"; st.band.style.height = (br.height + 4) + "px"; st.band.style.width = host.scrollWidth + "px"; }
      if (st.follow) { host.scrollTop = host.scrollTop + (br.top - hr.top) - host.clientHeight / 2 + br.height / 2; }
      updateReadout(cur + 1);
    }
    function buildAxes(host, g) {   // eixos congelados como itens sticky do grid (clona só .gcp-xlab/.gcp-ylab)
      if (st.gutter && st.gutter.parentNode) st.gutter.parentNode.removeChild(st.gutter);
      if (st.ruler && st.ruler.parentNode) st.ruler.parentNode.removeChild(st.ruler);
      st.gutter = st.ruler = null;
      var svg = host.querySelector("svg"); if (!svg) return;
      var NS = "http://www.w3.org/2000/svg";
      var vb = (svg.getAttribute("viewBox") || "0 0 680 400").split(/\s+/).map(Number);
      var W = parseFloat(svg.style.width) || vb[2], Hh = parseFloat(svg.style.height) || vb[3];
      var border = null; Array.prototype.forEach.call(svg.querySelectorAll("rect"), function (r) { if (r.getAttribute("fill") === "none") border = r; });
      var Ml = border ? parseFloat(border.getAttribute("x")) : 52;
      var plotBottom = border ? (parseFloat(border.getAttribute("y")) + parseFloat(border.getAttribute("height"))) : (vb[3] - 44);
      var sx = W / vb[2], sy = Hh / vb[3];
      var gutterW = Math.max(20, (Ml + 3) * sx), rulerH = Math.max(16, (vb[3] - plotBottom + 3) * sy);
      var axisTop = !!(g.cfg.invertY && !g.cfg.xToBottom), canvas = getComputedStyle(host).backgroundColor;
      function overlay() {
        var ov = document.createElementNS(NS, "svg"); ov.setAttribute("viewBox", vb.join(" ")); ov.style.cssText = "position:absolute;left:0;top:0;display:block;width:" + W + "px;height:" + Hh + "px";
        var bg = document.createElementNS(NS, "rect"); bg.setAttribute("x", vb[0]); bg.setAttribute("y", vb[1]); bg.setAttribute("width", vb[2]); bg.setAttribute("height", vb[3]); bg.setAttribute("fill", canvas); ov.appendChild(bg);
        Array.prototype.forEach.call(svg.querySelectorAll(".gcp-xlab, .gcp-ylab"), function (n) { ov.appendChild(n.cloneNode(true)); });
        return ov;
      }
      var grid = svg.parentNode;
      var gut = document.createElement("div"); gut.className = "seg-gcp-gutter"; gut.style.width = gutterW + "px"; gut.appendChild(overlay()); grid.appendChild(gut); st.gutter = gut;
      var rul = document.createElement("div"); rul.className = "seg-gcp-ruler " + (axisTop ? "axis-top" : "axis-bottom"); rul.style.height = rulerH + "px";
      var ovR = overlay(); if (!axisTop) ovR.style.top = -(Hh - rulerH) + "px";
      // rótulos de seção (ex.: "Parte C") congelados na régua, numa linha junto aos números de compasso - seguem
      // o eixo x na horizontal e ficam pinados na vertical (o clone original, no topo do plot, rola embora normal).
      var secs = ovR.querySelectorAll(".gcp-seclab");
      if (secs.length) {
        var numY = null;
        Array.prototype.forEach.call(ovR.querySelectorAll("text.gcp-xlab"), function (t) { if (numY == null && /^\d+$/.test((t.textContent || "").trim())) numY = parseFloat(t.getAttribute("y")); });
        if (numY != null) Array.prototype.forEach.call(secs, function (t) { t.setAttribute("y", numY + 13); });   // uma linha ABAIXO dos números (dentro da faixa da régua, sem cortar no topo)
      }
      rul.appendChild(ovR); grid.appendChild(rul); st.ruler = rul;
    }
    function refresh() {
      var sel = q("seggcp-doc"), stt = q("seggcp-status"); if (!sel) return;
      if (st.docId && !P.GCP._docById(st.docId)) st.docId = null;
      var cur = (st.docId && P.GCP._docById(st.docId)) ? st.docId : P.GCP.activeId;
      st.docId = cur;
      sel.innerHTML = "";
      P.GCP.docs.forEach(function (g) { var o = document.createElement("option"); o.value = g.id; o.textContent = g.name || "Gráfico"; if (g.id === cur) o.selected = true; sel.appendChild(o); });
      sel.disabled = !P.GCP.docs.length;
      if (stt) stt.textContent = P.GCP.docs.length ? "" : "nenhum gráfico gerado";
      if (st.active) render();
    }
    function setActive(v) { st.active = !!v; render(); }
    function zoomBy(f) { st.zoom = Math.max(1, Math.min(4, (st.zoom || 1) * f)); render(); }   // piso 1.0: nunca menor que o painel
    // --- fiação dos controles DESTA instância ---
    function wire() {
      if (q("seggcp-collapse")) q("seggcp-collapse").addEventListener("click", function () {
        pane.classList.add("gcpseg-collapsed"); st.active = false; render();
        if (P._refreshPanels) P._refreshPanels();
      });
      if (q("seggcp-close")) q("seggcp-close").addEventListener("click", function () { P.SegGCP.remove(modId); });
      if (q("seggcp-follow")) q("seggcp-follow").addEventListener("click", function () { st.follow = !st.follow; this.classList.toggle("active", st.follow); });
      if (q("seggcp-doc")) q("seggcp-doc").addEventListener("change", function () { st.docId = this.value; render(); });
      if (q("seggcp-zoomin")) q("seggcp-zoomin").addEventListener("click", function () { zoomBy(1.2); });
      if (q("seggcp-zoomout")) q("seggcp-zoomout").addEventListener("click", function () { zoomBy(1 / 1.2); });
      var host = $(hostId);
      if (host) host.addEventListener("wheel", function (e) { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
      if (host) host.addEventListener("scroll", function () {
        if (!(P.Segmenter && P.Segmenter.media && !P.Segmenter.media.paused)) updateReadout(centerSeg(this));   // pausado/navegando: mostra o do centro
        if (st.fitX) { clearTimeout(st._sc); st._sc = setTimeout(function () { render(true); }, 200); }
      });
      if (q("seggcp-fitx")) q("seggcp-fitx").addEventListener("click", function () { st.fitX = !st.fitX; this.classList.toggle("active", st.fitX); render(true); });
      if (window.ResizeObserver && host) {
        var rs = null, w0 = 0, h0 = 0;
        new ResizeObserver(function () {
          var h = $(hostId); if (!st.active || !h) return;
          if (Math.abs(h.clientWidth - w0) < 2 && Math.abs(h.clientHeight - h0) < 2) return;
          w0 = h.clientWidth; h0 = h.clientHeight;
          clearTimeout(rs); rs = setTimeout(function () { if (st.active) render(true); }, 150);
        }).observe(host);
      }
    }
    return { id: modId, state: st, pane: pane, render: render, syncToTime: sync, refresh: refresh, setActive: setActive, wire: wire };
  }
  // --- Gerente: conjunto de instâncias; API de conjunto (render/sync/refresh) + add/remove + serialize ---
  var GcpMgr = (function () {
    var insts = {}, order = [], seq = 1;
    function each(fn) { order.forEach(function (id) { if (insts[id]) fn(insts[id]); }); }
    function create(modId, cfg) {
      if (insts[modId]) return insts[modId];
      var inst = makeGcpInst(modId, cfg);
      insts[modId] = inst; order.push(modId);
      if (P._graphHolder) P._graphHolder.appendChild(inst.pane);   // no DOM (oculto) p/ os ids existirem e a fiação valer
      inst.wire();
      if (P._registerGraphMod) P._registerGraphMod(modEntry(inst));
      return inst;
    }
    function modEntry(inst) {
      var idx = order.indexOf(inst.id), multi = order.length > 1;
      return {
        id: inst.id, title: multi ? ("Gráfico " + (idx + 1)) : "Gráfico de prática",
        chk: "mod-chk" + (inst.id === "gcp" ? "" : "__" + inst.id),
        el: inst.pane, body: inst.pane.querySelector(".gcpseg-render"),
        collapseBtn: "seggcp-collapse" + (inst.id === "gcp" ? "" : "__" + inst.id),
        isCollapsed: function () { return inst.pane.classList.contains("gcpseg-collapsed"); },
        expand: function () { inst.pane.classList.remove("gcpseg-collapsed"); inst.setActive(true); }
      };
    }
    return {
      render: function (keep) { each(function (i) { i.render(keep); }); },
      syncToTime: function (t) { each(function (i) { i.syncToTime(t); }); },
      refresh: function () { each(function (i) { i.refresh(); }); },
      setActive: function (modId, v) { if (insts[modId]) insts[modId].setActive(v); },
      list: function () { return order.map(function (id) { return insts[id]; }).filter(Boolean); },
      add: function () {   // cria um painel novo, habilitado, numa coluna nova
        var id; do { id = "gcp" + (++seq); } while (insts[id]);
        create(id, {});
        if (P._enableGraphMod) P._enableGraphMod(id);
        if (insts[id]) insts[id].refresh();   // popula o seletor de gráfico do painel novo na hora
        return id;
      },
      remove: function (modId) {
        if (!insts[modId]) return;
        if (order.length <= 1) return;   // sempre resta ao menos um painel de gráfico
        if (P._unregisterGraphMod) P._unregisterGraphMod(modId);
        var el = insts[modId].pane; if (el && el.parentNode) el.parentNode.removeChild(el);
        delete insts[modId]; var k = order.indexOf(modId); if (k >= 0) order.splice(k, 1);
      },
      serialize: function () { return order.map(function (id) { var s = insts[id].state; return { id: id, docId: s.docId, zoom: s.zoom, fitX: s.fitX, follow: s.follow }; }); },
      restore: function (listRaw) {   // recria o conjunto do projeto (destrói o atual). Não faz buildStage - quem chama (StageLayout) refaz.
        var list = (listRaw && listRaw.length) ? listRaw : [{ id: "gcp" }];
        order.slice().forEach(function (id) {   // remove tudo (sem o guard de "resta um")
          if (P._unregisterGraphMod) P._unregisterGraphMod(id);
          var el = insts[id].pane; if (el && el.parentNode) el.parentNode.removeChild(el);
          delete insts[id];
        });
        order.length = 0; seq = 1;
        list.forEach(function (c) { create(c.id, c); var n = parseInt(String(c.id).replace(/^gcp/, ""), 10); if (n > seq) seq = n; });
      }
    };
  })();
  P.SegGCP = GcpMgr;

  // Opções da faixa de partitura (compose síncrono) e injeção no SVG do GCP.
  function scoreStripOpts() {
    var c = P.GCP.cfg;
    return { pos: c.scorePos || "above", height: c.scoreHeight || 90, gap: (c.scoreGap != null ? c.scoreGap : 8) };
  }
  function composeStrip(svg, stg) {
    if (svg && P.GCP.cfg.showScore && !(stg && stg.noScore) && P.ScoreStrip && P.ScoreStrip.ready()) P.ScoreStrip.compose(svg, scoreStripOpts());
    return svg;
  }

  function renderGcp() {
    if (!P.GCP.data) return;
    var comparing = compare.on && P.GCP.docs.length >= 2;
    if ($("gcp-tabs")) $("gcp-tabs").hidden = comparing;   // comparar é tela dedicada, sem abas
    var statsCard = $("gcp-stats") ? $("gcp-stats").closest(".card") : null;
    if (comparing) { if (statsCard) statsCard.hidden = false; renderCompare(); renderCompareStats(); return; }   // no comparar: dois gráficos + estatísticas lado a lado
    if (statsCard) statsCard.hidden = false;
    $("gcp-compare").hidden = true;
    var heat = P.GCP.cfg.chartStyle === "heatmap";   // heatmap ignora colunas/estágios
    var stages = P.GCP.data.stages || [];
    var split = !heat && P.GCP.cfg.splitByStage && stages.length;
    var cols = !heat && !split && P.GCP.cfg.colView && P.GCP.cfg.colCount > 1;
    $("gcp-chart").parentElement.style.display = split ? "none" : "";
    $("gcp-stages").style.display = split ? "block" : "none";
    if (split) renderStages();
    else if (cols) renderColumns($("gcp-chart"), true);
    else composeStrip(P.GCP.render($("gcp-chart"), { editable: true }));
    renderStats();
  }

  // Modo colunas: reflui os segmentos em várias colunas lado a lado (mesma escala de compasso),
  // de cima p/ baixo (ou o contrário, conforme "inverter Y"), continuando à direita. Rolagem horizontal.
  function renderColumns(host, editable, sub) {
    host = host || $("gcp-chart");
    host.style.display = "block";
    host.innerHTML = "";
    var base = P.GCP.data.segments.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); });
    // sub = { from, to, preset, style, stageTint } limita as colunas a um ESTÁGIO (índices globais 1-based).
    var rf = sub && sub.from ? Math.max(1, sub.from) : 1, rt = sub && sub.to ? Math.min(base.length, sub.to) : base.length;
    var all = base.slice(rf - 1, rt);   // segmentos do intervalo (usados p/ contagem e escala eficiente)
    var N = all.length; if (!N) return;
    var C = Math.min(P.GCP.cfg.colCount, Math.max(1, N));
    var per = Math.ceil(N / C);
    var gap = P.GCP.cfg.colGap != null ? P.GCP.cfg.colGap : 10;
    var avail = (host.clientWidth || 900) - 8;
    var colW = Math.max(240, Math.floor((avail - gap * (C - 1)) / C));   // divide a largura, descontando os espaçamentos
    var fitRowStep = 0;
    if (P.GCP.cfg.colFit) {
      var top = Math.max(0, host.getBoundingClientRect().top);
      var availH = Math.max(300, (window.innerHeight || 800) - top - 24);
      fitRowStep = Math.max(0.2, (availH - 88) / per);
    }
    var mode = P.GCP.cfg.colAxisMode || "proportional";
    var pxPerUnit = 0;
    if (mode === "efficient") {
      var gmin = Infinity, gmax = -Infinity;
      all.forEach(function (s) { if (isFinite(s.mStart)) { gmin = Math.min(gmin, s.mStart); gmax = Math.max(gmax, s.mStart); } if (isFinite(s.mEnd)) { gmin = Math.min(gmin, s.mEnd); gmax = Math.max(gmax, s.mEnd); } });
      var gRange = (gmax > gmin) ? (gmax - gmin) : 1;
      var plotW = colW - (P.GCP.cfg.showSegLabels ? 52 : 16) - 8;
      pxPerUnit = Math.max(1, plotW / gRange) * (P.GCP.cfg.colEffScale || 1);
    }
    var Ccols = 0; for (var cc = 0; cc < C; cc++) { if (rf + cc * per <= Math.min(rt, rf + (cc + 1) * per - 1)) Ccols++; }
    var legHost = P.GCP.cfg.showLegend ? (/left/.test(P.GCP.cfg.legendPos || "right") ? 0 : Ccols - 1) : -1;   // 1 legenda p/ todas: coluna da borda
    var wrap = document.createElement("div");
    wrap.className = "gcp-colwrap px-scroll";
    wrap.style.gap = gap + "px";
    for (var c = 0; c < C; c++) {
      var from = rf + c * per, to = Math.min(rt, rf + (c + 1) * per - 1);   // faixa GLOBAL de cada coluna
      if (from > to) break;
      var col = document.createElement("div");
      col.className = "gcp-col";
      wrap.appendChild(col);
      var ropts = { isSub: true, editable: editable !== false, range: { from: from, to: to }, compact: true };
      if (fitRowStep) ropts.rowStep = fitRowStep;
      if (mode === "efficient") { ropts.sharedAxis = false; ropts.pxPerUnit = pxPerUnit; }
      else { ropts.sharedAxis = (mode === "proportional"); ropts.width = colW; }
      if (sub) { if (sub.preset) ropts.preset = sub.preset; if (sub.style) ropts.style = sub.style; if (sub.stageTint) ropts.stageTint = sub.stageTint; ropts.sharedAxisRange = { from: rf, to: rt }; }
      if (P.GCP.cfg.colSingleAxis) ropts.noAxisTitles = true;
      if (c === legHost) { ropts.forceLegend = true; ropts.legendUsedAll = all; }   // filtro "só usados" vê TODAS as colunas
      P.GCP.render(col, ropts);
    }
    if (P.GCP.cfg.colSingleAxis) {   // um único título de eixo X (embaixo, centrado) e Y (rotacionado, à esquerda)
      var cc = P.GCP.cfg, ats = cc.axisTitleSize || 11;
      var _prF = (P.GCP.activePreset && P.GCP.activePreset().font) || cc.font || "inherit";
      var tcss = "font-family:" + _prF + ";color:" + (cc.axisTitleColor || "var(--txt, #16202b)") + ";font-size:" + ats + "px;font-weight:" + (cc.axisTitleBold !== false ? 700 : 400) + ";letter-spacing:" + (cc.axisTitleTrack || 0) + "px;" + (cc.axisTitleItalic ? "font-style:italic;" : "") + (cc.axisTitleCase === "upper" ? "text-transform:uppercase;" : cc.axisTitleCase === "lower" ? "text-transform:lowercase;" : "");
      var outer = document.createElement("div"); outer.style.cssText = "display:flex;flex-direction:column;min-width:0";
      var rowc = document.createElement("div"); rowc.style.cssText = "display:flex;align-items:stretch;min-width:0";
      var yt = document.createElement("div"); yt.textContent = cc.yTitle != null ? cc.yTitle : "Segmento de prática";
      yt.style.cssText = "writing-mode:vertical-rl;transform:rotate(180deg);align-self:center;flex:0 0 auto;padding:0 2px 0 4px;white-space:nowrap;" + tcss;
      wrap.style.flex = "1 1 auto"; wrap.style.minWidth = "0";
      rowc.appendChild(yt); rowc.appendChild(wrap); outer.appendChild(rowc);
      var xt = document.createElement("div"); xt.textContent = cc.xTitle != null ? cc.xTitle : "Compasso";
      xt.style.cssText = "text-align:center;padding-top:3px;" + tcss;
      outer.appendChild(xt);
      host.appendChild(outer);
    } else host.appendChild(wrap);
  }

  // Reflete o estilo de gráfico (GCP/Heatmap) e mostra o "Agrupar por" só no heatmap.
  function updateStyleUI() {
    var mode = P.GCP.cfg.chartStyle || "gcp";
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-style button"), function (b) { b.classList.toggle("active", b.getAttribute("data-style") === mode); });
    if ($("view-gcp")) $("view-gcp").classList.toggle("heatmap-mode", mode === "heatmap");   // esconde UI do GCP, mostra a do heatmap
    if ($("gcp-heatgroup")) $("gcp-heatgroup").value = P.GCP.cfg.heatGroupBy || "stage";
    if ($("gcp-heatmetric")) $("gcp-heatmetric").value = P.GCP.cfg.heatMetric || "duration";
    var desc = $("gcp-style-desc");
    if (desc) desc.textContent = (mode === "heatmap")
      ? "Gráfico de densidade: calcula a concentração da prática ao longo dos compassos (duração, ocorrências ou repetições) a partir dos pontos de início e parada."
      : "Gráfico de comportamento de prática: gera segmentos a partir das transcrições de início e parada durante a prática musical.";
  }

  // Reflete o modo do eixo das colunas (botão ativo + dica).
  function updateColAxisUI() {
    var mode = P.GCP.cfg.colAxisMode || "proportional";
    Array.prototype.forEach.call(document.querySelectorAll("#gcp-colaxis button"), function (b) { b.classList.toggle("active", b.getAttribute("data-mode") === mode); });
    var hints = {
      proportional: "Todas as colunas na mesma escala de compasso (bom para comparar).",
      own: "Eixo próprio ajuda a visualizar cada coluna, mas torna os eixos delas desproporcionais.",
      efficient: "Corta os compassos não usados de cada coluna, mantendo a mesma escala (compara e economiza espaço)."
    };
    var h = $("gcp-colaxis-hint"); if (h) h.textContent = hints[mode] || "";
    if ($("gcp-coleffscale-row")) $("gcp-coleffscale-row").hidden = (mode !== "efficient");
  }

  // Apaga o bloco "Altura dos segmentos" quando o «Caber na altura» o controla (colunas + fit).
  function updateVsizeDim() {
    if ($("gcp-colfit-row")) $("gcp-colfit-row").hidden = !P.GCP.cfg.colView;   // o toggle só faz sentido em colunas
    var dim = !!(P.GCP.cfg.colView && P.GCP.cfg.colFit);
    var sl = $("gcp-vsize-sliders"); if (sl) sl.classList.toggle("dimmed", dim);   // apaga só os sliders (não o toggle)
  }

  // Sugestão de nº de colunas: cada coluna ≈ uma "tela" de altura (ajusta a quantidade ao tamanho do conjunto).
  function suggestColumns() {
    var all = (P.GCP.data.segments || []).filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); });
    var N = all.length; if (!N) return 2;
    var totalH = N * (P.GCP.cfg.rowStep || 9);
    var host = $("gcp-chart");
    var targetH = Math.max(420, (host && host.clientHeight) || Math.round(window.innerHeight * 0.7) || 700);
    return Math.max(2, Math.min(12, Math.round(totalH / targetH)));
  }

  function renderStages() {
    var host = $("gcp-stages"); host.innerHTML = "";
    function dpi() { return +$("gcp-dpi").value || 150; }
    P.GCP.data.stages.forEach(function (stg, idx) {
      if (!stg.style) stg.style = P.GCP.snapshotStyle();
      if (!stg.presetId) stg.presetId = P.GCP.cfg.activePreset;
      var st = stg.style;
      var card = document.createElement("div"); card.className = "card"; card.style.cssText = "margin-bottom:16px;padding:10px";
      var presetOpts = P.GCP.cfg.presets.map(function (p) { return '<option value="' + p.id + '"' + (p.id === stg.presetId ? " selected" : "") + '>' + P.escapeHtml(p.name) + (p.kind === "bw" ? " · P&B" : "") + '</option>'; }).join("");
      card.innerHTML =
        '<div class="chart-toolbar" style="margin-bottom:4px">' +
          '<b>' + P.escapeHtml(stg.name || ("Estágio " + (idx + 1))) + '</b>' +
          '<span class="mini" style="color:var(--txt-dim)">seg ' + stg.from + '–' + stg.to + '</span>' +
          '<div class="spacer"></div>' +
          '<select class="mini" data-preset>' + presetOpts + '</select>' +
          '<button class="icon-btn" data-exp="png">PNG</button><button class="icon-btn" data-exp="jpg">JPG</button><button class="icon-btn" data-exp="svg">SVG</button>' +
        '</div>' +
        '<div class="chart-toolbar" style="margin-bottom:6px">' +
          '<label class="mini">espessura <input type="range" data-st="barHeight" min="2" max="24" step="1" value="' + st.barHeight + '" style="width:66px"></label>' +
          '<label class="mini">espaç. <input type="range" data-st="rowStep" min="3" max="30" step="1" value="' + st.rowStep + '" style="width:66px"></label>' +
          '<label class="mini"><input type="checkbox" data-st="invert"' + (st.invertY ? " checked" : "") + '> inverter Y</label>' +
          '<label class="mini"><input type="checkbox" data-st="tints"' + (st.showSectionTints ? " checked" : "") + '> t.seção</label>' +
          '<label class="mini"><input type="checkbox" data-st="stagetint"' + (st.showStageTints ? " checked" : "") + '> t.estágio</label>' +
          (P.GCP.cfg.showScore ? '<label class="mini"><input type="checkbox" data-st="score"' + (stg.noScore ? "" : " checked") + '> partitura</label>' : '') +
        '</div>' +
        '<div class="chart-host"></div>';
      host.appendChild(card);
      var chartHost = card.querySelector(".chart-host");
      function draw() {
        if (P.GCP.cfg.colView && P.GCP.cfg.colCount > 1) { renderColumns(chartHost, true, { from: stg.from, to: stg.to, preset: P.GCP.presetById(stg.presetId), style: st, stageTint: stg.tint }); return; }
        composeStrip(P.GCP.render(chartHost, { range: { from: stg.from, to: stg.to }, preset: P.GCP.presetById(stg.presetId), style: st, stageTint: stg.tint, isSub: true }), stg);
      }
      draw();
      card.querySelector("[data-preset]").addEventListener("change", function () { stg.presetId = this.value; draw(); });
      card.querySelectorAll("[data-st]").forEach(function (ctrl) {
        ctrl.addEventListener(ctrl.type === "checkbox" ? "change" : "input", function () {
          var k = ctrl.dataset.st;
          if (k === "score") { stg.noScore = !ctrl.checked; draw(); return; }
          if (k === "invert") st.invertY = ctrl.checked;
          else if (k === "tints") st.showSectionTints = ctrl.checked;
          else if (k === "stagetint") st.showStageTints = ctrl.checked;
          else st[k] = +ctrl.value;
          draw();
        });
      });
      card.querySelectorAll("[data-exp]").forEach(function (b) {
        b.addEventListener("click", function () {
          // re-renderiza fora da tela pelo mesmo caminho do «Exportar…»: tema claro e, no modo colunas, TODAS as colunas
          var actD = P.GCP.activeDoc && P.GCP.activeDoc();
          var el = (actD && P._gcpRenderTarget) ? P._gcpRenderTarget(actD, { kind: "stage", stage: stg }) : chartHost.querySelector("svg");
          var fn = "gcp_" + (stg.name || ("estagio" + (idx + 1))).replace(/[^\w]+/g, "_");
          if (b.dataset.exp === "png") P.GCP.exportRaster(fn + ".png", "image/png", dpi(), el);
          else if (b.dataset.exp === "jpg") P.GCP.exportRaster(fn + ".jpg", "image/jpeg", dpi(), el);
          else P.GCP.exportSVG(fn + ".svg", el);
        });
      });
    });
  }

  function renderStagesManager() {
    var host = $("gcp-stages-list"); if (!host || !P.GCP.data) return;
    var N = P.GCP.data.segments.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); }).length || 1;
    host.innerHTML = "";
    // Edição inline pela lista (alternativa ao arrasto): duplo clique no NOME renomeia; no INTERVALO (from–to) renumera.
    function editName(stg, span) {
      var inp = document.createElement("input");
      inp.type = "text"; inp.value = stg.name || ""; inp.placeholder = "nome do estágio";
      inp.style.cssText = "flex:1;min-width:0;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 5px";
      span.replaceWith(inp); inp.focus(); inp.select();
      function done(save) { if (done._d) return; done._d = true; if (save) stg.name = inp.value.trim(); renderStagesManager(); renderGcp(); }
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); done(true); } else if (e.key === "Escape") { e.preventDefault(); done(false); } });
      inp.addEventListener("blur", function () { done(true); });
    }
    function editRange(stg, span) {
      var wrap = document.createElement("span"); wrap.style.cssText = "flex:0 0 auto;display:inline-flex;align-items:center;gap:2px";
      var fi = document.createElement("input"), ti = document.createElement("input");
      [fi, ti].forEach(function (x) { x.type = "text"; x.inputMode = "numeric"; x.style.cssText = "width:32px;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 2px;text-align:center"; });
      fi.value = stg.from; ti.value = stg.to;
      wrap.appendChild(fi); wrap.appendChild(document.createTextNode("–")); wrap.appendChild(ti);
      span.replaceWith(wrap); fi.focus(); fi.select();
      function done(save) {
        if (done._d) return; done._d = true;
        if (save) {
          var f = parseInt(fi.value, 10), t = parseInt(ti.value, 10);
          if (isFinite(f) && isFinite(t)) {
            f = Math.max(1, Math.min(N, f)); t = Math.max(1, Math.min(N, t)); if (f > t) { var tmp = f; f = t; t = tmp; }
            stg.from = f; stg.to = t; P.GCP.data.stages.sort(function (a, b) { return a.from - b.from; });
          }
        }
        renderStagesManager(); renderGcp();
      }
      fi.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ti.focus(); ti.select(); } else if (e.key === "Escape") { e.preventDefault(); done(false); } });
      ti.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); done(true); } else if (e.key === "Escape") { e.preventDefault(); done(false); } });
      wrap.addEventListener("focusout", function (e) { if (!wrap.contains(e.relatedTarget)) done(true); });   // salva ao sair dos dois campos
    }
    (P.GCP.data.stages || []).forEach(function (stg, i) {
      if (!stg.tint) stg.tint = P.PALETTE_COLOR ? P.PALETTE_COLOR[i % 8] : "#8899aa";
      var block = document.createElement("div"); block.style.cssText = "margin-bottom:8px;padding:6px 7px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)";
      var lblPh = stg.name ? (stg.name.length > 20 ? stg.name.slice(0, 19) + "…" : stg.name) : ("Estágio " + (i + 1));
      block.innerHTML =
        '<div class="row" style="align-items:center;gap:6px;margin-bottom:4px">' +
          '<span class="stg-cp" style="flex:0 0 auto"></span>' +
          '<span class="mini stg-range" title="duplo clique para mudar o intervalo" style="flex:1;cursor:text;color:var(--txt-dim)">segmentos ' + stg.from + '–' + stg.to + '</span>' +
          '<button class="btn sm ghost" data-del title="Remover estágio" style="flex:0 0 auto">' + P.ICON.close + '</button>' +
        '</div>' +
        '<div class="row" style="align-items:center;gap:6px;margin-bottom:3px"><span class="mini" style="flex:0 0 42px;color:var(--txt-dim)">nome</span><input class="stg-name mini" type="text" placeholder="nome do estágio" value="' + P.escapeHtml(stg.name || "") + '" title="Nome do estágio (usado no resumo/tabela; vem dos objetivos de médio prazo)" style="flex:1;min-width:0;padding:1px 5px"></div>' +
        '<div class="row" style="align-items:center;gap:6px"><span class="mini" style="flex:0 0 42px;color:var(--txt-dim)">rótulo</span><input class="stg-label mini" type="text" placeholder="' + P.escapeHtml(lblPh) + '" value="' + P.escapeHtml(stg.label || "") + '" title="Rótulo mostrado no GRÁFICO (vazio = usa o nome). Não afeta o resumo." style="flex:1;min-width:0;padding:1px 5px"></div>';
      (function (s) { var cp = colorPicker(s.tint || "#8899aa", function (hex) { s.tint = hex; renderGcp(); }); block.querySelector(".stg-cp").appendChild(cp.el); })(stg);
      block.querySelector(".stg-name").addEventListener("input", function () { stg.name = this.value; var li = block.querySelector(".stg-label"); if (li) li.placeholder = this.value.trim() ? (this.value.length > 20 ? this.value.slice(0, 19) + "…" : this.value) : ("Estágio " + (i + 1)); renderGcp(); if (P.GCP._refreshStagePreview) P.GCP._refreshStagePreview(); });
      block.querySelector(".stg-label").addEventListener("input", function () { stg.label = this.value; renderGcp(); });
      block.querySelector("[data-del]").addEventListener("click", function () { P.GCP.data.stages.splice(i, 1); renderStagesManager(); renderGcp(); });
      block.querySelector(".stg-range").addEventListener("dblclick", function () { editRange(stg, this); });
      host.appendChild(block);
    });
    if ((P.GCP.data.stages || []).length) {
      var rn = document.createElement("button"); rn.className = "btn sm ghost wide"; rn.style.marginTop = "4px";
      rn.textContent = "Numerar rótulos (Estágio 1, 2…)"; rn.title = "Define o rótulo do gráfico de cada estágio como «Estágio N» na ordem (mantém os nomes)";
      rn.addEventListener("click", function () { P.GCP.data.stages.forEach(function (s, k) { s.label = "Estágio " + (k + 1); }); renderStagesManager(); renderGcp(); if (P.GCP._refreshStagePreview) P.GCP._refreshStagePreview(); });
      host.appendChild(rn);
      var rc = document.createElement("button"); rc.className = "btn sm ghost wide"; rc.style.marginTop = "4px";
      rc.textContent = "Usar os nomes como rótulo"; rc.title = "Limpa os rótulos personalizados (o gráfico volta a mostrar o nome de cada estágio)";
      rc.addEventListener("click", function () { P.GCP.data.stages.forEach(function (s) { delete s.label; }); renderStagesManager(); renderGcp(); });
      host.appendChild(rc);
    }
  }
  function addStage() {
    var from = parseInt($("gcp-stage-from").value, 10), to = parseInt($("gcp-stage-to").value, 10), name = $("gcp-stage-name").value.trim();
    if (!isFinite(from) || !isFinite(to) || !P.GCP.data) return;
    P.GCP.data.stages.push({ from: from, to: to, name: name });
    P.GCP.data.stages.sort(function (a, b) { return a.from - b.from; });
    $("gcp-stage-from").value = ""; $("gcp-stage-to").value = ""; $("gcp-stage-name").value = "";
    renderStagesManager(); renderGcp();
  }

  // Blade: divide os estágios no segmento clicado. Sem estágios → parte o todo em dois; com estágios → parte o que contém o segmento.
  function bladeSplitAt(seg) {
    if (!P.GCP.data) return;
    var N = P.GCP.data.segments.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); }).length;
    if (N < 2) return;
    seg = Math.max(2, Math.min(N, Math.round(seg)));   // divisa começa o novo estágio; precisa de >=1 segmento antes
    var stages = P.GCP.data.stages, pal = P.PALETTE_COLOR || ["#8899aa"];
    if (!stages.length) {
      P.GCP.setStages([
        { from: 1, to: seg - 1, name: "Estágio 1", tint: pal[0] },
        { from: seg, to: N, name: "Estágio 2", tint: pal[1 % pal.length] }
      ]);
    } else {
      var idx = -1;
      for (var k = 0; k < stages.length; k++) { if (seg >= stages[k].from && seg <= stages[k].to) { idx = k; break; } }
      if (idx < 0 || seg <= stages[idx].from) return;   // fora de um estágio, ou já é uma divisa
      var st = stages[idx];
      var second = { from: seg, to: st.to, name: "", tint: pal[(idx + 1) % pal.length], presetId: st.presetId };
      st.to = seg - 1;
      stages.splice(idx + 1, 0, second);
    }
    P.GCP.data.stages.sort(function (a, b) { return a.from - b.from; });
    renderStagesManager(); renderGcp();
  }

  function showGcpEmpty() {
    if ($("gcp-empty")) $("gcp-empty").style.display = "";
    var host = $("gcp-chart"); if (host) { host.style.display = "none"; if (host.parentElement) host.parentElement.style.display = ""; }
    if ($("gcp-stages")) $("gcp-stages").style.display = "none";
    if ($("gcp-stats")) $("gcp-stats").innerHTML = "";
    var d = P.GCP.activeDoc();
    if ($("gcp-title")) $("gcp-title").textContent = d ? d.name : "Gráfico de comportamento de prática";
  }

  // Nome padrão para uma aba nova.
  function defaultDocName() { return "Gráfico " + (P.GCP.docs.length + 1); }

  // Ponto único de entrada: cada fonte cria um gráfico NOVO (dataset + conjunto + aba).
  function openGcpData(data, opts) {
    opts = opts || {};
    P.GCP.createGraph(data, { name: opts.name || (data.meta && data.meta.participant), style: opts.style });
    gcpLoaded = true;
    P._activate("gcp");
    refreshGcpView();
  }

  // "Gerar pacote de gráficos": um conjunto (mesmo dataset) com uma aba GCP + uma aba Heatmap.
  function generateGraphPackage() {
    P.Segmenter.generateGCP(function (data) {
      var name = (data.meta && data.meta.participant) || "Gráfico";
      var dsId = P.GCP.addDataset(data);
      var cjId = P.GCP.addConjunto(dsId, data, "Conjunto " + (Object.keys(P.GCP.conjuntos).length));
      P.GCP.addGraph(cjId, name + " · Heatmap", "heatmap");
      P.GCP.addGraph(cjId, name + " · GCP", "gcp");   // por último → fica ativo (você começa no GCP)
      gcpLoaded = true;
      P._activate("gcp");
      refreshGcpView();
    });
  }

  // "Gerar exemplo": sempre em uma aba nova.
  function openExampleGcp() {
    if (!window.PRAXIS_EXAMPLE_GCP) { alert("Dados de exemplo não encontrados."); return; }
    openGcpData(JSON.parse(JSON.stringify(window.PRAXIS_EXAMPLE_GCP)), { newTab: true, name: "Exemplo", carry: "none" });
  }

  // Redesenha a aba do gráfico: barra de abas + (gráfico do doc ativo | estado vazio).
  function refreshGcpView() {
    renderGcpTabs();
    var d = P.GCP.activeDoc();
    gcpLoaded = P.GCP.docs.length > 0;
    if (compare.on && P.GCP.docs.length < 2) compare.on = false;   // caiu abaixo de 2 gráficos → sai do comparar
    syncCompareMode(); syncCompareUI();
    if (P.SegGCP && P.SegGCP.refresh) P.SegGCP.refresh();
    if (d && P.GCP.data) renderGcpControls(); else showGcpEmpty();
  }

  // Barra de abas: uma por gráfico + botão de nova aba. Clicar troca; duplo clique renomeia; × fecha.
  function renderGcpTabs() {
    var host = $("gcp-tabs"); if (!host) return;
    var xIcon = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9"/></svg>';
    var addIcon = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 3.5v11M3.5 9h11"/></svg>';
    // Agrupa as abas por conjunto (contíguas, com cor e um separador entre grupos).
    var order = [], seen = {};
    P.GCP.docs.forEach(function (d) { if (!seen[d.conjuntoId]) { seen[d.conjuntoId] = 1; order.push(d.conjuntoId); } });
    _conjColors = {}; order.forEach(function (cj, i) { _conjColors[cj] = (P.PALETTE_COLOR || ["#5ab7ff"])[i % (P.PALETTE_COLOR ? P.PALETTE_COLOR.length : 1)]; });
    var parts = [];
    order.forEach(function (cj, gi) {
      if (gi > 0) parts.push('<div class="gcp-tabsep"></div>');
      var col = _conjColors[cj];
      P.GCP.docs.filter(function (d) { return d.conjuntoId === cj; }).forEach(function (d) {
        parts.push('<div class="gcp-tab' + (d.id === P.GCP.activeId ? " active" : "") + '" data-tab="' + d.id + '" draggable="true" style="--cj:' + col + '">' +
          '<span class="gcp-tab-name" data-name="' + d.id + '" title="' + P.escapeHtml(d.name) + '">' + P.escapeHtml(d.name) + '</span>' +
          '<button class="gcp-tab-x" data-close="' + d.id + '" title="Fechar gráfico" aria-label="Fechar">' + xIcon + '</button>' +
          '</div>');
      });
    });
    if (P.GCP.docs.length) parts.push('<button class="gcp-tab-add" id="gcp-tab-add" title="Novo gráfico" aria-label="Novo gráfico">' + addIcon + '</button>');   // só aparece quando já existe ao menos um gráfico
    host.innerHTML = parts.join("");
    Array.prototype.forEach.call(host.querySelectorAll(".gcp-tab"), function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.closest("[data-close]") || e.target.closest("input")) return;
        var id = el.getAttribute("data-tab");
        if (id !== P.GCP.activeId) { P.GCP.selectDoc(id); refreshGcpView(); }
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll(".gcp-tab-name"), function (el) {
      el.addEventListener("dblclick", function (e) { e.stopPropagation(); startTabRename(el, el.getAttribute("data-name")); });
    });
    Array.prototype.forEach.call(host.querySelectorAll("[data-close]"), function (btn) {
      btn.addEventListener("click", function (e) { e.stopPropagation(); closeGcpTab(btn.getAttribute("data-close")); });
    });
    // Arrastar uma aba sobre outra de conjunto diferente (mesmo dataset) associa-a àquele conjunto.
    Array.prototype.forEach.call(host.querySelectorAll(".gcp-tab"), function (el) {
      el.addEventListener("dragstart", function (e) { _dragTabId = el.getAttribute("data-tab"); if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", _dragTabId); } catch (x) {} } });
      el.addEventListener("dragend", function () { _dragTabId = null; el.classList.remove("drop-target"); });
      el.addEventListener("dragover", function (e) { if (dropOk(el)) { e.preventDefault(); el.classList.add("drop-target"); } });
      el.addEventListener("dragleave", function () { el.classList.remove("drop-target"); });
      el.addEventListener("drop", function (e) {
        e.preventDefault(); el.classList.remove("drop-target");
        var src = _dragTabId, tgt = el.getAttribute("data-tab"); _dragTabId = null;
        if (!dropOkIds(src, tgt)) return;
        P.GCP.linkGraph(src, P.GCP._docById(tgt).conjuntoId); refreshGcpView();
      });
    });
    function dropOk(el) { return dropOkIds(_dragTabId, el.getAttribute("data-tab")); }
    function dropOkIds(src, tgt) {
      if (!src || !tgt || src === tgt) return false;
      var a = P.GCP._docById(src), b = P.GCP._docById(tgt); if (!a || !b) return false;
      if (a.conjuntoId === b.conjuntoId) return false;                 // já no mesmo conjunto
      var da = P.GCP.datasetOf(a), db = P.GCP.datasetOf(b);
      return da && db && da.id === db.id;                              // só associa dentro do MESMO dataset
    }
    var add = $("gcp-tab-add");
    if (add) add.addEventListener("click", function () { openNewGraphMenu(add); });
  }

  // Menu do "+": novo gráfico no mesmo conjunto, ou um conjunto novo (mesmo dataset).
  function openNewGraphMenu(anchor) {
    closeGcpMenu();
    var a = P.GCP.activeDoc(); if (!a) return;
    var menu = document.createElement("div"); menu.className = "gcp-menu"; menu.id = "gcp-newmenu";
    menu.innerHTML = '<button data-act="dup">Duplicar aba atual</button><button data-act="same">Novo gráfico (mesmo conjunto)</button><button data-act="newcj">Novo conjunto (mesmo dataset)</button>' +
      '<div style="padding:6px 10px 3px;font-size:11px;color:var(--txt-faint);font-weight:600;border-top:1px solid var(--line);margin-top:2px">Novo conjunto (outro dataset)</div>' +
      '<button data-act="src-csv">Importar CSV…</button>' +
      '<button data-act="src-proj">De outro projeto (.praxis)…</button>' +
      '<button data-act="src-ex">Gerar exemplo</button>';
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - 230) + "px"; menu.style.top = (r.bottom + 4) + "px";
    menu.querySelector('[data-act="dup"]').addEventListener("click", function () { P.GCP.duplicateGraph(a.id); closeGcpMenu(); refreshGcpView(); });
    menu.querySelector('[data-act="same"]').addEventListener("click", function () { P.GCP.addGraph(a.conjuntoId, defaultDocName(), P.GCP.cfg.chartStyle); closeGcpMenu(); refreshGcpView(); });
    menu.querySelector('[data-act="newcj"]').addEventListener("click", function () {
      var ds = P.GCP.datasetOf(a);
      if (ds) {
        var srcCj = P.GCP.conjuntoOf(a);   // copia (independente) os estágios/seções do conjunto atual como ponto de partida
        var seed = srcCj ? { stages: JSON.parse(JSON.stringify(srcCj.stages || [])), sections: JSON.parse(JSON.stringify(srcCj.sections || [])) } : {};
        var cj = P.GCP.addConjunto(ds.id, seed, "Conjunto " + (Object.keys(P.GCP.conjuntos).length));
        P.GCP.addGraph(cj, defaultDocName(), P.GCP.cfg.chartStyle);
      }
      closeGcpMenu(); refreshGcpView();
    });
    // Novo conjunto a partir de OUTRO dataset: reusa as mesmas fontes do grupo "Novo gráfico" do inspetor (cada uma cria dataset+conjunto+gráfico novos). Dados transcritos = MESMO dataset, então ficam de fora daqui.
    menu.querySelector('[data-act="src-csv"]').addEventListener("click", function () { closeGcpMenu(); var f = $("gcp-importfile"); if (f) f.click(); });
    menu.querySelector('[data-act="src-proj"]').addEventListener("click", function () { closeGcpMenu(); var f = $("gcp-projfile"); if (f) f.click(); });
    menu.querySelector('[data-act="src-ex"]').addEventListener("click", function () { closeGcpMenu(); openExampleGcp(); });
    setTimeout(function () { document.addEventListener("mousedown", _closeMenuOutside, true); }, 0);
  }
  function closeGcpMenu() { var m = $("gcp-newmenu"); if (m) m.remove(); document.removeEventListener("mousedown", _closeMenuOutside, true); }
  function _closeMenuOutside(e) { var m = $("gcp-newmenu"); if (m && !m.contains(e.target)) closeGcpMenu(); }

  // Painel "Conjunto" no inspetor: nome, quantos gráficos compartilham, vincular a outro, desvincular.
  function renderConjuntoPanel() {
    var g = P.GCP.activeDoc(); if (!g) return;
    var cj = P.GCP.conjuntoOf(g), ds = P.GCP.datasetOf(g); if (!cj || !ds) return;
    if ($("gcp-cj-name")) $("gcp-cj-name").value = cj.name || "";
    var n = P.GCP.graphsInConjunto(cj.id).length;
    if ($("gcp-cj-info")) $("gcp-cj-info").textContent = "Estágios e seções compartilhados com " + n + " gráfico(s) deste conjunto.";
    var sel = $("gcp-cj-link");
    if (sel) {
      var others = P.GCP.conjuntosForDataset(ds.id).filter(function (c) { return c.id !== cj.id; });
      sel.innerHTML = '<option value="">-</option>' + others.map(function (c) { return '<option value="' + c.id + '">' + P.escapeHtml(c.name) + '</option>'; }).join("");
      sel.value = ""; sel.disabled = !others.length;
    }
    if ($("gcp-cj-unlink")) $("gcp-cj-unlink").disabled = n <= 1;   // já é privado
  }

  function startTabRename(nameEl, id) {
    var doc = P.GCP._docById(id); if (!doc) return;
    var inp = document.createElement("input");
    inp.type = "text"; inp.value = doc.name;
    nameEl.textContent = ""; nameEl.appendChild(inp); inp.focus(); inp.select();
    function commit() {
      var v = inp.value.trim();
      P.GCP.renameDoc(id, v || doc.name);
      renderGcpTabs();
      if (id === P.GCP.activeId && $("gcp-title")) $("gcp-title").textContent = P.GCP._docById(id).name;
    }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); else if (e.key === "Escape") { inp.value = doc.name; inp.blur(); } });
    inp.addEventListener("blur", commit);
  }

  function closeGcpTab(id) {
    var doc = P.GCP._docById(id); if (!doc) return;
    var cd = P.GCP._compose ? P.GCP._compose(doc) : null;   // o doc guarda só o vínculo; os dados vêm do conjunto
    if (cd && cd.segments && cd.segments.length && !confirm("Fechar o gráfico «" + doc.name + "»? Ele será removido do projeto ao salvar.")) return;
    P.GCP.removeDoc(id);
    refreshGcpView();
  }

  // "Carregar gráfico de outro projeto": traz um gráfico (dataset + conjunto + visão) de outro .praxis como aba nova.
  async function importGraphFromProject(file) {
    try {
      var buf = await file.arrayBuffer(), bytes = new Uint8Array(buf);
      if (new TextDecoder().decode(bytes.slice(0, 8)) !== "PRAXIS01") { alert("Arquivo inválido: escolha um projeto .praxis."); return; }
      var jsonLen = new DataView(buf).getUint32(8, true);
      var proj = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + jsonLen)));
      var g = proj.gcp;
      if (!g) { alert("Esse projeto não tem nenhum gráfico salvo."); return; }
      if (g.v !== 3) { alert("Esse projeto foi salvo numa versão antiga do gráfico. Abra-o, gere o gráfico e salve; depois ele poderá ser importado."); return; }
      if (!P.GCP.importFromProject(g)) { alert("Não há gráfico com dados nesse projeto."); return; }
      gcpLoaded = true;
      P._activate("gcp");
      refreshGcpView();
    } catch (e) {
      alert("Falha ao importar o gráfico: " + (e && e.message ? e.message : e));
    }
  }

  function importELAN(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var dec = P.decodeBuffer(reader.result);
        var parsed = P.ELAN.parse(dec.text);
        var name = file.name.replace(/\.(eaf(\.\d+)?|xml)$/i, "");
        // popula Segmentar e Transcrever com as camadas do ELAN
        P.Segmenter.loadTiers(P.ELAN.toTiers(parsed), name);
        // registra a mídia referenciada (com offsets) para vínculo sincronizado
        if (P.Segmenter.setElanMedia) P.Segmenter.setElanMedia(parsed.media || []);
        // monta o gráfico direto do EAF, quando há a camada Comportamento codificada
        var data = P.ELAN.toGCP(parsed, name);
        if (!data.segments.length) {
          P._activate("segmentar");
          alert("ELAN importado: " + parsed.tiers.length + " camada(s) na tela Segmentar.\n\nNão havia a camada «Comportamento» com compassos codificados (formato compasso,compasso,código), então o gráfico não foi gerado automaticamente.");
          return;
        }
        openGcpData(data, { carry: "none", name: name });
      } catch (e) {
        alert("Falha ao importar ELAN: " + (e && e.message ? e.message : e));
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function importCSV(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var dec = P.decodeBuffer(reader.result);
      var rows = P.parseCSV(dec.text);
      var data = csvToData(rows);
      if (data.segments.length && !data.behaviors.length) { alert("O CSV foi lido, mas nenhuma linha tem COMPASSOS, e o gráfico de comportamento precisa deles.\n\nInclua as colunas «Compasso início» e «Compasso fim» (a exportação de tabela do Praxis já tem), ou use rótulos no formato do ELAN «compasso,compasso,CÓDIGO»."); return; }
      if (!data.segments.length) { alert("Não foi possível interpretar o CSV. São necessárias colunas de início, fim e comportamento, ou o formato bruto do ELAN com início, fim e rótulo nas três primeiras colunas."); return; }
      data.meta = { participant: file.name, encoding: dec.encoding, nSegments: data.segments.length };
      openGcpData(data, { carry: "none", name: file.name });
    };
    reader.readAsArrayBuffer(file);
  }

  // Heurística de mapeamento de CSV -> segmentos (flexível a formatos variados). O gráfico precisa de COMPASSOS
  // (mStart/mEnd): vêm de colunas próprias (ex.: «Compasso início/fim» da exportação do Praxis) ou do rótulo no
  // formato do ELAN «compasso,compasso,CÓDIGO[, observação]» (mesmo parser da importação de .eaf).
  function csvToData(rows) {
    if (!rows.length) return { segments: [] };
    var header = rows[0].map(function (h) { return String(h || "").trim().toLowerCase(); });
    var hasHeader = header.some(function (h) { return /in[íi]cio|start|comport|dimens|fim|end|c[óo]digo|compasso/.test(h); });
    var body = hasHeader ? rows.slice(1) : rows;
    function findCol(re, not) { for (var i = 0; i < header.length; i++) if (re.test(header[i]) && !(not && not.test(header[i]))) return i; return -1; }
    var MEAS = /compasso|measure|^m ?(start|end|in[íi]cio|fim)/;
    var ci = {
      beh: findCol(/c[óo]digo ?\/ ?valor|^c[óo]digo$|comport|behavio|categoria|^code$/, /r[óo]tulo/),
      start: findCol(/in[íi]cio|start/, MEAS), end: findCol(/fim|end/, MEAS),
      mStart: findCol(/compasso in[íi]cio|measure start|^m ?start$/), mEnd: findCol(/compasso fim|measure end|^m ?end$/),
      kind: findCol(/tipo de camada|kind/), note: findCol(/descri|observ|note|texto/)
    };
    if (ci.beh < 0) ci.beh = findCol(/dimens|label|tier/, /r[óo]tulo|camada/);
    var parse = (P.ELAN && P.ELAN.parseComportamento) || null;
    var segs = [];
    body.forEach(function (r) {
      if (!r.length) return;
      if (ci.kind >= 0 && /vocabul|livre|dimens/i.test(r[ci.kind] || "")) return;   // export do Praxis: só camadas de prática
      var start, end, beh, note, mS = NaN, mE = NaN;
      if (ci.start >= 0 && ci.end >= 0) {
        start = P.parseTime(r[ci.start]); end = P.parseTime(r[ci.end]);
        beh = ci.beh >= 0 ? (r[ci.beh] || "").trim() : "";
        note = ci.note >= 0 ? (r[ci.note] || "").trim() : "";
      } else {
        // formato cru do ELAN: início, fim, "rótulo"
        start = P.parseTime(r[0]); end = P.parseTime(r[1]); beh = (r[2] || "").trim(); note = "";
      }
      if (ci.mStart >= 0) mS = parseFloat(String(r[ci.mStart] || "").replace(",", "."));
      if (ci.mEnd >= 0) mE = parseFloat(String(r[ci.mEnd] || "").replace(",", "."));
      if (!(isFinite(mS) && isFinite(mE)) && parse && /\d\s*,/.test(beh)) {   // rótulo do ELAN «23,24.9,EX, obs»
        var c = parse(beh); mS = c.mStart; mE = c.mEnd; beh = c.code || beh; if (c.note && !note) note = c.note;
      }
      if (isFinite(start) && isFinite(end)) segs.push({ tStart: start, tEnd: end, mStart: mS, mEnd: mE, behavior: beh || "?", note: note });
    });
    var behaviors = Array.from(new Set(segs.filter(function (s) { return isFinite(s.mStart) && isFinite(s.mEnd); }).map(function (s) { return s.behavior; }).filter(Boolean)));
    return { behaviors: behaviors, legend: {}, sections: [], phases: [], segments: segs };
  }

  function renderGcpControls() {
    if (!P.GCP.data) { showGcpEmpty(); return; }
    $("gcp-empty").style.display = "none";
    $("gcp-chart").style.display = "block";
    var actDoc = P.GCP.activeDoc();
    if ($("gcp-title")) $("gcp-title").textContent = (actDoc && actDoc.name) || (P.GCP.data.meta && P.GCP.data.meta.participant) || "Gráfico de comportamento de prática";   // título removido do layout; guardado por segurança
    renderPresets();
    syncPresetControls();
    updateStyleUI();
    renderConjuntoPanel();
    $("gcp-invert").checked = P.GCP.cfg.invertY;
    $("gcp-xbottom").checked = !!P.GCP.cfg.xToBottom; $("gcp-xbottom-row").hidden = !P.GCP.cfg.invertY;
    $("gcp-grid").checked = P.GCP.cfg.showGrid;
    $("gcp-xlabels").checked = P.GCP.cfg.showXLabels !== false;
    $("gcp-colview").checked = !!P.GCP.cfg.colView;
    $("gcp-col-opts").hidden = !P.GCP.cfg.colView;
    $("gcp-colcount").value = P.GCP.cfg.colCount || 3;
    $("gcp-colgap").value = P.GCP.cfg.colGap != null ? P.GCP.cfg.colGap : 10; $("gcp-colgapval").textContent = ($("gcp-colgap").value) + "px";
    $("gcp-colfit").checked = !!P.GCP.cfg.colFit;
    if ($("gcp-colsingleaxis")) $("gcp-colsingleaxis").checked = !!P.GCP.cfg.colSingleAxis;
    if ($("gcp-coleffscale")) { var _ces = P.GCP.cfg.colEffScale || 1; $("gcp-coleffscale").value = _ces; $("gcp-coleffscaleval").textContent = Math.round(_ces * 100) + "%"; }
    updateColAxisUI();
    updateVsizeDim();
    $("gcp-segtitle").checked = P.GCP.cfg.showSegTitle !== false;
    $("gcp-xtitle").value = P.GCP.cfg.xTitle != null ? P.GCP.cfg.xTitle : "Compasso";
    $("gcp-ytitle").value = P.GCP.cfg.yTitle != null ? P.GCP.cfg.yTitle : "Segmento de prática";
    $("gcp-axtsize").value = P.GCP.cfg.axisTitleSize || 11; $("gcp-axtsizeval").textContent = ($("gcp-axtsize").value);
    $("gcp-axttrack").value = P.GCP.cfg.axisTitleTrack || 0; $("gcp-axttrackval").textContent = ($("gcp-axttrack").value);
    if ($("gcp-axtgap")) { var _atg = P.GCP.cfg.axisTitleGap != null ? P.GCP.cfg.axisTitleGap : 15; $("gcp-axtgap").value = _atg; $("gcp-axtgapval").textContent = _atg; }
    if (axisTitleColorPicker) axisTitleColorPicker.set(P.GCP.cfg.axisTitleColor || "#888888");
    if ($("gcp-ylabelstep")) $("gcp-ylabelstep").value = (P.GCP.cfg.axisYLabelStep > 0) ? P.GCP.cfg.axisYLabelStep : "";
    $("gcp-axtbold").checked = !!P.GCP.cfg.axisTitleBold;
    (function () { var mc = P.GCP.cfg.axisTitleCase || "none"; Array.prototype.forEach.call(document.querySelectorAll("#gcp-axtcase button"), function (b) { b.classList.toggle("active", b.getAttribute("data-case") === mc); }); })();
    $("gcp-mmin").value = P.GCP.cfg.axisMMin == null ? "" : P.GCP.cfg.axisMMin;
    $("gcp-mmax").value = P.GCP.cfg.axisMMax == null ? "" : P.GCP.cfg.axisMMax;
    $("gcp-tickstep").value = P.GCP.cfg.axisTickStep == null ? "" : P.GCP.cfg.axisTickStep;
    $("gcp-labelstep").value = P.GCP.cfg.axisLabelStep == null ? "" : P.GCP.cfg.axisLabelStep;
    $("gcp-sec-labels").checked = P.GCP.cfg.showSectionLabels;
    if (secStrokePicker) secStrokePicker.set(P.GCP.cfg.sectionColor || "#888888");
    if ($("gcp-sec-behind")) $("gcp-sec-behind").checked = !!P.GCP.cfg.sectionLinesBehind;
    if (secLabelColorPicker) secLabelColorPicker.set(P.GCP.cfg.sectionLabelColor || "#888888");
    if ($("gcp-sec-labelsize")) $("gcp-sec-labelsize").value = P.GCP.cfg.sectionLabelSize || 11;
    $("gcp-bh").value = P.GCP.cfg.barHeight; $("gcp-bhval").textContent = P.GCP.cfg.barHeight;
    $("gcp-rs").value = P.GCP.cfg.rowStep; $("gcp-rsval").textContent = P.GCP.cfg.rowStep;
    if ($("gcp-legend-show")) { $("gcp-legend-show").checked = !!P.GCP.cfg.showLegend; $("gcp-legend-opts").hidden = !P.GCP.cfg.showLegend; }
    renderLegendLabels();
    if ($("gcp-legend-pos")) $("gcp-legend-pos").value = P.GCP.cfg.legendPos || "right";
    if ($("gcp-legend-size")) { var ls = P.GCP.cfg.legendSize || 10; $("gcp-legend-size").value = ls; $("gcp-legend-sizeval").textContent = ls; }
    if ($("gcp-legend-swatch")) { var lsw = P.GCP.cfg.legendSwatch || 12; $("gcp-legend-swatch").value = lsw; $("gcp-legend-swval").textContent = lsw; }
    if ($("gcp-legend-outline")) $("gcp-legend-outline").checked = !!P.GCP.cfg.legendOutline;
    if ($("gcp-legend-onlyused")) $("gcp-legend-onlyused").checked = !!P.GCP.cfg.legendOnlyUsed;
    if ($("gcp-legend-offx")) { var _lox = P.GCP.cfg.legendOffX || 0; $("gcp-legend-offx").value = _lox; $("gcp-legend-offxval").textContent = _lox; }
    if ($("gcp-legend-offy")) { var _loy = P.GCP.cfg.legendOffY || 0; $("gcp-legend-offy").value = _loy; $("gcp-legend-offyval").textContent = _loy; }
    if ($("gcp-score-show")) {
      var c = P.GCP.cfg;
      $("gcp-score-show").checked = !!c.showScore; $("gcp-score-opts").hidden = !c.showScore;
      if ($("gcp-score-pos")) $("gcp-score-pos").value = c.scorePos || "above";
      if ($("gcp-score-height")) { $("gcp-score-height").value = c.scoreHeight || 90; $("gcp-score-hval").textContent = c.scoreHeight || 90; }
      if ($("gcp-score-scale")) { $("gcp-score-scale").value = c.scoreScale || 40; $("gcp-score-sval").textContent = c.scoreScale || 40; }
      if ($("gcp-score-gap")) { $("gcp-score-gap").value = (c.scoreGap != null ? c.scoreGap : 8); $("gcp-score-gval").textContent = (c.scoreGap != null ? c.scoreGap : 8); }
      if ($("gcp-score-staff")) $("gcp-score-staff").value = c.scoreStaff || "all";
      if ($("gcp-score-mnum")) $("gcp-score-mnum").checked = !!c.scoreMnum;
      if ($("gcp-score-hint")) $("gcp-score-hint").style.display = (P.ScoreStrip && P.ScoreStrip.available()) ? "none" : "block";
      if (c.showScore && P.ScoreStrip && P.ScoreStrip.available() && !P.ScoreStrip.ready()) P.ScoreStrip.prepare({ scale: c.scoreScale, staff: c.scoreStaff, mnum: c.scoreMnum }, function (ok) { if (ok) renderGcp(); });
    }
    renderSectionsList();
    renderStagesManager();
    $("gcp-sectint").checked = !!P.GCP.cfg.showSectionTints;
    $("gcp-sectint-op").value = P.GCP.cfg.sectionTintOpacity; $("gcp-sectint-opval").textContent = Math.round(P.GCP.cfg.sectionTintOpacity * 100) + "%";
    if ($("gcp-stagelabel")) $("gcp-stagelabel").checked = !!P.GCP.cfg.showStageLabels;
    if ($("gcp-stagelabel-opts")) $("gcp-stagelabel-opts").hidden = !P.GCP.cfg.showStageLabels;
    if (stageLabelColorPicker) stageLabelColorPicker.set(P.GCP.cfg.stageLabelColor || "#888888");
    if ($("gcp-stagelabel-size")) $("gcp-stagelabel-size").value = P.GCP.cfg.stageLabelSize || 11;
    if ($("gcp-stagelabel-inside")) $("gcp-stagelabel-inside").checked = P.GCP.cfg.stageLabelInside !== false;
    if ($("gcp-stagelabel-vertical")) $("gcp-stagelabel-vertical").checked = !!P.GCP.cfg.stageLabelVertical;
    (function () { var sd = P.GCP.cfg.stageLabelSide || "left"; Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-side button"), function (b) { b.classList.toggle("active", b.getAttribute("data-side") === sd); }); })();
    (function () { var al = P.GCP.cfg.stageLabelAlign || "center"; Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-align button"), function (b) { b.classList.toggle("active", b.getAttribute("data-align") === al); }); })();
    if ($("gcp-stagelabel-track")) { var _slt = P.GCP.cfg.stageLabelTrack || 0; $("gcp-stagelabel-track").value = _slt; $("gcp-stagelabel-trackval").textContent = _slt; }
    if ($("gcp-stagelabel-off")) { var _slo = P.GCP.cfg.stageLabelOffset || 0; $("gcp-stagelabel-off").value = _slo; $("gcp-stagelabel-offval").textContent = _slo; }
    if ($("gcp-stagelabel-bold")) $("gcp-stagelabel-bold").checked = P.GCP.cfg.stageLabelBold !== false;
    if ($("gcp-stagelabel-italic")) $("gcp-stagelabel-italic").checked = !!P.GCP.cfg.stageLabelItalic;
    if ($("gcp-stagelabel-halo")) $("gcp-stagelabel-halo").checked = P.GCP.cfg.stageLabelHalo !== false;
    (function () { var lc = P.GCP.cfg.stageLabelCase || "none"; Array.prototype.forEach.call(document.querySelectorAll("#gcp-stagelabel-case button"), function (b) { b.classList.toggle("active", b.getAttribute("data-case") === lc); }); })();
    $("gcp-stagetint").checked = !!P.GCP.cfg.showStageTints;
    $("gcp-stagetint-op").value = P.GCP.cfg.stageTintOpacity; $("gcp-stagetint-opval").textContent = Math.round(P.GCP.cfg.stageTintOpacity * 100) + "%";
    if ($("gcp-stageline")) $("gcp-stageline").checked = !!P.GCP.cfg.showStageLines;
    if ($("gcp-stageline-opts")) $("gcp-stageline-opts").hidden = !P.GCP.cfg.showStageLines;
    if (stageLinePicker) stageLinePicker.set(P.GCP.cfg.stageLineColor || "#888888");
    if ($("gcp-stageline-dash")) $("gcp-stageline-dash").value = P.GCP.cfg.stageLineDash != null ? P.GCP.cfg.stageLineDash : "5 4";
    if ($("gcp-stageline-width")) $("gcp-stageline-width").value = P.GCP.cfg.stageLineWidth != null ? P.GCP.cfg.stageLineWidth : 1.4;
    $("gcp-split").checked = !!P.GCP.cfg.splitByStage;
    renderLegend();
    renderGcp();
  }

  function addSection() {
    var m = parseFloat($("gcp-sec-measure").value), name = $("gcp-sec-name").value.trim();
    if (!isFinite(m) || !P.GCP.data) return;
    P.GCP.data.sections.push({ measure: m, name: name });
    P.GCP.data.sections.sort(function (a, b) { return a.measure - b.measure; });
    $("gcp-sec-measure").value = ""; $("gcp-sec-name").value = "";
    renderSectionsList(); reRender();
  }
  function pullSectionsFromScore() {
    if (!P.GCP.data) { alert("Gere um gráfico primeiro (menu «Novo gráfico»)."); return; }
    if (!P.Score || !P.Score._raw || P.Score._raw.kind !== "xml") {
      alert("Abra a partitura (MusicXML) na aba Segmentar antes de puxar as seções."); return;
    }
    var secs = P.Score.extractSections();
    if (secs == null) { alert("Não consegui ler a partitura. Confira o arquivo MusicXML."); return; }
    if (!secs.length) { alert("A partitura não tem barra dupla nem marca de ensaio. Marque as seções na partitura ou inclua-as à mão."); return; }
    secs.forEach(function (s, i) { s.tint = P.PALETTE_COLOR[i % P.PALETTE_COLOR.length]; });
    P.GCP.setSections(secs);
    renderSectionsList(); reRender();
    alert(secs.length + " seç" + (secs.length === 1 ? "ão puxada" : "ões puxadas") + " da partitura.");
  }
  function renderSectionsList() {
    var host = $("gcp-sections-list"); if (!host || !P.GCP.data) return;
    host.innerHTML = "";
    // Renomear o rótulo de uma seção (duplo clique no nome), igual à lista de estágios.
    function editSecName(sec, span) {
      var inp = document.createElement("input");
      inp.type = "text"; inp.value = sec.name || ""; inp.placeholder = "nome da seção";
      inp.style.cssText = "flex:1;min-width:0;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 5px";
      span.replaceWith(inp); inp.focus(); inp.select();
      function done(save) { if (done._d) return; done._d = true; if (save) sec.name = inp.value.trim(); renderSectionsList(); reRender(); }
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); done(true); } else if (e.key === "Escape") { e.preventDefault(); done(false); } });
      inp.addEventListener("blur", function () { done(true); });
    }
    (P.GCP.data.sections || []).forEach(function (sec, i) {
      var row = document.createElement("div"); row.className = "row"; row.style.marginBottom = "4px";
      row.innerHTML = '<span class="sec-cp" style="flex:0 0 auto"></span><span class="mini" style="flex:0 0 38px">c.' + sec.measure + '</span><span class="sec-name" title="duplo clique para renomear" style="flex:1;cursor:text">' + (sec.name ? P.escapeHtml(sec.name) : '<span class="mini">(sem nome)</span>') + '</span><button class="btn sm ghost" data-del title="Remover seção" style="flex:0 0 auto">' + P.ICON.close + '</button>';
      (function (s) { var cp = colorPicker(s.tint || "#8899aa", function (hex) { s.tint = hex; reRender(); }); row.querySelector(".sec-cp").appendChild(cp.el); })(sec);
      row.querySelector(".sec-name").addEventListener("dblclick", function () { editSecName(sec, this); });
      row.querySelector("[data-del]").addEventListener("click", function () { P.GCP.data.sections.splice(i, 1); renderSectionsList(); reRender(); });
      host.appendChild(row);
    });
  }

  function renderPresets() {
    var sel = $("gcp-preset"); if (!sel) return;
    P.GCP.ensurePresets();
    sel.innerHTML = "";
    P.GCP.cfg.presets.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id; o.textContent = p.name + (p.kind === "bw" ? " · P&B" : "");
      sel.appendChild(o);
    });
    sel.value = P.GCP.cfg.activePreset;
  }

  // Reflete a APARÊNCIA da predefinição ativa nos controles (opacidade, contorno, fonte).
  function syncPresetControls() {
    var pr = P.GCP.activePreset(); if (!pr) return;
    var op = pr.opacity != null ? pr.opacity : 0.92;
    if ($("gcp-opacity")) { $("gcp-opacity").value = op; $("gcp-opval").textContent = Math.round(op * 100) + "%"; }
    var rad = pr.radius != null ? pr.radius : 1.5;
    if ($("gcp-brad")) { $("gcp-brad").value = rad; $("gcp-bradval").textContent = rad; }
    var ol = pr.outline || { show: false, color: "#111111", width: 1 };
    if ($("gcp-outline")) $("gcp-outline").checked = !!ol.show;
    if (outlinePicker) outlinePicker.set(ol.color || "#111111");
    if ($("gcp-outwidth")) $("gcp-outwidth").value = ol.width || 1;
    if ($("gcp-font") && pr.font) $("gcp-font").value = pr.font;
  }

  var PAT_LABELS = { solid: "sólida", diag: "hachura /", diag2: "hachura \\", cross: "grade", horiz: "horizontal", vert: "vertical", dots: "pontos" };
  function renderLegend() {
    var host = $("gcp-legend"); if (!host || !P.GCP.data) return;
    host.innerHTML = "";
    P.GCP.data.behaviors.forEach(function (b, i) {
      var color = P.GCP.behColor(b, i), pat = P.GCP.patternFor(b), name = P.GCP.data.legend[b] || "";
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap";
      var opts = Object.keys(PAT_LABELS).map(function (k) { return '<option value="' + k + '"' + (k === pat ? " selected" : "") + '>' + PAT_LABELS[k] + '</option>'; }).join("");
      row.innerHTML =
        '<b style="flex:0 0 30px">' + P.escapeHtml(b) + '</b>' +
        '<span class="mini" style="flex:1;min-width:52px;color:var(--txt-dim)">' + P.escapeHtml(name) + '</span>' +
        '<select class="mini" style="flex:0 0 96px">' + opts + '</select>';
      // Editar cor/padrão altera a predefinição (forkando a embutida) → atualiza a lista de predefinições.
      var cp = colorPicker(color, function (hex) { P.GCP.setBehColor(b, hex); renderPresets(); reRender(); renderLegend(); });
      row.insertBefore(cp.el, row.firstChild);
      row.querySelector("select").addEventListener("change", function () { P.GCP.setBehPattern(b, this.value); renderPresets(); reRender(); renderLegend(); });
      host.appendChild(row);
      // Cores do padrão (principal/marca + secundária/fundo), só quando há hachura.
      if (pat !== "solid") {
        var sub = document.createElement("div");
        sub.style.cssText = "display:flex;gap:4px;align-items:center;margin:-2px 0 8px 30px;flex-wrap:nowrap";
        var fgLab = document.createElement("span"); fgLab.className = "mini"; fgLab.style.color = "var(--txt-dim)"; fgLab.textContent = "padrão:";
        sub.appendChild(fgLab);
        var fg = P.GCP.patternFgFor(b, i);
        var cpFg = colorPicker(fg, function (hex) { P.GCP.setBehPatternFg(b, hex); renderPresets(); reRender(); });
        cpFg.el.classList.add("cp-sm");
        sub.appendChild(cpFg.el);
        var bgLab = document.createElement("span"); bgLab.className = "mini"; bgLab.style.color = "var(--txt-dim)"; bgLab.textContent = "fundo:";
        sub.appendChild(bgLab);
        var bg = P.GCP.patternBgFor(b);
        var cpBg = colorPicker(bg || "#ffffff", function (hex) { P.GCP.setBehPatternBg(b, hex); renderPresets(); reRender(); });
        cpBg.el.classList.add("cp-sm");
        sub.appendChild(cpBg.el);
        var bgClear = document.createElement("button"); bgClear.className = "btn sm ghost"; bgClear.textContent = "sem fundo"; bgClear.title = "Fundo transparente (padrão)"; bgClear.style.cssText = "flex:0 0 auto;white-space:nowrap;padding:2px 6px";
        bgClear.addEventListener("click", function () { P.GCP.setBehPatternBg(b, null); renderPresets(); reRender(); renderLegend(); });
        sub.appendChild(bgClear);
        host.appendChild(sub);
      }
    });
  }

  // Editor de rótulos da legenda (um texto por comportamento; vazio = "código · nome").
  function renderLegendLabels() {
    var host = $("gcp-legend-labels"); if (!host || !P.GCP.data) return;
    host.innerHTML = "";
    if (!P.GCP.cfg.legendLabels) P.GCP.cfg.legendLabels = {};
    var behs = P.GCP.data.behaviors, dragFrom = null;
    function clearIndicators() { Array.prototype.forEach.call(host.children, function (r) { r.style.borderTop = ""; r.style.borderBottom = ""; }); }
    behs.forEach(function (b, i) {
      var name = P.GCP.data.legend[b] || "", def = b + (name ? " · " + name : "");
      var row = document.createElement("div");
      row.dataset.i = i;
      row.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:5px";
      row.innerHTML = '<span class="drag-handle" draggable="true" title="Arraste para reordenar a legenda" style="flex:0 0 auto;cursor:grab;opacity:.55;user-select:none;font-size:13px;line-height:1">⠿</span>' +
        '<b style="flex:0 0 26px">' + P.escapeHtml(b) + '</b>' +
        '<input type="text" class="mini" style="flex:1;min-width:0" value="' + P.escapeHtml(P.GCP.cfg.legendLabels[b] || "") + '" placeholder="' + P.escapeHtml(def) + '">';
      row.querySelector("input").addEventListener("input", function () {
        if (this.value.trim() === "") delete P.GCP.cfg.legendLabels[b]; else P.GCP.cfg.legendLabels[b] = this.value;
        reRender();
      });
      var handle = row.querySelector(".drag-handle");
      handle.addEventListener("dragstart", function (e) { dragFrom = i; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); } catch (_) {} row.style.opacity = ".4"; });
      handle.addEventListener("dragend", function () { row.style.opacity = ""; clearIndicators(); dragFrom = null; });
      row.addEventListener("dragover", function (e) { if (dragFrom == null) return; e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch (_) {} clearIndicators(); row.style[(dragFrom < i) ? "borderBottom" : "borderTop"] = "2px solid var(--accent, #5ab7ff)"; });
      row.addEventListener("dragleave", function () { row.style.borderTop = ""; row.style.borderBottom = ""; });
      row.addEventListener("drop", function (e) {
        e.preventDefault(); clearIndicators();
        var from = (dragFrom != null) ? dragFrom : parseInt(e.dataTransfer.getData("text/plain"), 10);
        var to = i; if (!isFinite(from) || from === to) { dragFrom = null; return; }
        var order = behs.slice(), moved = order.splice(from, 1)[0];
        var ti = order.indexOf(behs[to]);
        order.splice(ti + (from < to ? 1 : 0), 0, moved);
        dragFrom = null;
        P.GCP.reorderBehaviors(order);
        renderLegendLabels(); renderLegend(); reRender();
      });
      host.appendChild(row);
    });
  }

  function statBlock(title, body, open) {
    return '<details class="stat-block"' + (open ? ' open' : '') + '><summary>' + title +
      ' <span class="chev" aria-hidden="true" style="margin-left:auto"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3L8 6l-3.5 3"/></svg></span></summary>' +
      '<div style="margin-top:6px">' + body + '</div></details>';
  }
  // Relatório: só comportamento + seção + estágio (camadas e co-ocorrência foram descartadas, decisão do João 2026-09-14).
  function statsInnerHTML() {
    var S = P.GCP.statsFull();
    function bar(pct, color) { return '<div class="stat-bar" style="width:' + Math.max(3, pct) + '%;background:' + (color || "var(--accent)") + '"></div>'; }
    function row2(a, b, c) { return '<tr><td>' + a + '</td><td style="width:60px;text-align:right">' + b + '</td><td style="width:80px;text-align:right;font-variant-numeric:tabular-nums">' + c + '</td></tr>'; }
    var h = '<div class="mini" style="margin-bottom:4px;color:var(--txt-dim)"><b style="color:var(--txt)">' + S.totalSegments + '</b> segmentos · tempo total <b style="color:var(--txt)">' + P.fmtTime(S.total) + '</b></div>';
    h += statBlock("Por comportamento", '<table class="stat-table">' + S.behaviors.map(function (s) {
      return '<tr><td style="width:38px"><span class="tag-b" style="background:' + s.color + '22;color:' + s.color + '">' + P.escapeHtml(s.code) + '</span></td><td>' + P.escapeHtml(s.name) + '</td><td style="width:40px;text-align:right">' + s.count + '×</td><td style="width:100px">' + bar(s.pct, s.color) + '</td><td style="width:92px;text-align:right;font-variant-numeric:tabular-nums">' + s.pct.toFixed(1) + '% · ' + P.fmtTime(s.seconds) + '</td></tr>';
    }).join("") + '</table>', true);
    if (S.perSection.length) h += statBlock("Por seção", '<table class="stat-table">' + S.perSection.map(function (x) { return row2(P.escapeHtml(x.name), x.count + " seg", P.fmtTime(x.seconds)); }).join("") + '</table>');
    if (S.perStage.length) h += statBlock("Por estágio", '<table class="stat-table">' + S.perStage.map(function (x) { return row2(P.escapeHtml(x.name || "sem nome"), x.count + " seg", P.fmtTime(x.seconds)); }).join("") + '</table>');
    return h;
  }
  function renderStats() {
    var host = $("gcp-stats"); if (!host || !P.GCP.data) return;
    host.innerHTML = statsInnerHTML();
    if (P.GCP._refreshStagePreview) P.GCP._refreshStagePreview();
  }
  function statsDataForDoc(id) {   // objeto de statsFull de um doc específico (troca temporária do estado ativo)
    var g = P.GCP._docById(id); if (!g) return null;
    var data = P.GCP._compose(g); if (!data) return null;
    var sd = P.GCP.data, sc = P.GCP.cfg; P.GCP.data = data; P.GCP.cfg = g.cfg;
    try { return P.GCP.statsFull(); } finally { P.GCP.data = sd; P.GCP.cfg = sc; }
  }
  // No comparar, um ÚNICO grid alinha os dois gráficos: coluna de rótulo + uma coluna por gráfico.
  // As linhas (comportamento/seção/estágio) são a UNIÃO das entradas dos dois → tudo alinha lado a lado
  // (quase uma tabela). Ausência de um lado vira "-".
  function renderCompareStats() {
    var host = $("gcp-stats"); if (!host) return;
    var SA = statsDataForDoc(compare.aId), SB = statsDataForDoc(compare.bId);
    if (!SA || !SB) { host.innerHTML = ""; return; }
    var aN = (P.GCP._docById(compare.aId) || {}).name || "-", bN = (P.GCP._docById(compare.bId) || {}).name || "-";
    function esc(s) { return P.escapeHtml(String(s == null ? "" : s)); }
    var H = ['<div class="cmp-stats-grid">'];
    H.push('<div class="cmp-st-head cmp-st-k"></div><div class="cmp-st-head cmp-st-v">' + esc(aN) + '</div><div class="cmp-st-head cmp-st-v">' + esc(bN) + '</div>');
    H.push('<div class="cmp-st-k">Resumo</div><div class="cmp-st-v">' + SA.totalSegments + ' seg · ' + P.fmtTime(SA.total) + '</div><div class="cmp-st-v">' + SB.totalSegments + ' seg · ' + P.fmtTime(SB.total) + '</div>');
    function sec(t) { H.push('<div class="cmp-st-sec">' + esc(t) + '</div>'); }
    function cell(v) { return v == null ? '<div class="cmp-st-v cmp-st-na">-</div>' : '<div class="cmp-st-v">' + v + '</div>'; }
    // Por comportamento: união por código, ordenada pelo maior tempo entre os dois.
    var bmap = {};
    SA.behaviors.forEach(function (x) { bmap[x.code] = { name: x.name, color: x.color, a: x }; });
    SB.behaviors.forEach(function (x) { if (!bmap[x.code]) bmap[x.code] = { name: x.name, color: x.color }; bmap[x.code].b = x; });
    var codes = Object.keys(bmap).sort(function (p, q) { var sp = Math.max((bmap[p].a || {}).seconds || 0, (bmap[p].b || {}).seconds || 0), sq = Math.max((bmap[q].a || {}).seconds || 0, (bmap[q].b || {}).seconds || 0); return sq - sp; });
    if (codes.length) {
      sec("Por comportamento");
      codes.forEach(function (c) {
        var o = bmap[c], col = o.color || "var(--accent)";
        H.push('<div class="cmp-st-k"><span class="tag-b" style="background:' + col + '22;color:' + col + '">' + esc(c) + '</span> ' + esc(o.name) + '</div>');
        H.push(cell(o.a ? (o.a.count + '× · ' + o.a.pct.toFixed(1) + '% · ' + P.fmtTime(o.a.seconds)) : null));
        H.push(cell(o.b ? (o.b.count + '× · ' + o.b.pct.toFixed(1) + '% · ' + P.fmtTime(o.b.seconds)) : null));
      });
    }
    // Por seção / por estágio: união por nome (preserva a ordem de A e anexa os que só existem em B).
    function pairByName(la, lb, title) {
      var order = [], seen = {}, mapA = {}, mapB = {};
      la.forEach(function (x) { mapA[x.name] = x; if (!seen[x.name]) { seen[x.name] = 1; order.push(x.name); } });
      lb.forEach(function (x) { mapB[x.name] = x; if (!seen[x.name]) { seen[x.name] = 1; order.push(x.name); } });
      if (!order.length) return;
      sec(title);
      order.forEach(function (nm) {
        var a = mapA[nm], b = mapB[nm];
        H.push('<div class="cmp-st-k">' + esc(nm || 'sem nome') + '</div>');
        H.push(cell(a ? (a.count + ' seg · ' + P.fmtTime(a.seconds)) : null));
        H.push(cell(b ? (b.count + ' seg · ' + P.fmtTime(b.seconds)) : null));
      });
    }
    pairByName(SA.perSection, SB.perSection, "Por seção");
    pairByName(SA.perStage, SB.perStage, "Por estágio");
    H.push('</div>');
    host.innerHTML = H.join("");
  }

  function toHex(c) {
    if (/^#/.test(c)) return c.length === 4 ? "#" + c.slice(1).split("").map(function (x) { return x + x; }).join("") : c;
    var m = c.match(/\d+/g); if (!m) return "#4f9df5";
    return "#" + m.slice(0, 3).map(function (n) { return ("0" + parseInt(n, 10).toString(16)).slice(-2); }).join("");
  }

  // Color picker reutilizável: botão-amostra que abre um popover com campo hex, seletor
  // nativo e duas paletas de atalho (Praxis geral e Okabe-Ito daltônico-segura).
  // Devolve { el, set(hex), get() }. onChange(hex) dispara ao vivo; onClose() ao fechar o popover.
  function colorPicker(initial, onChange, onClose) {
    var cur = toHex(initial || "#888888"), pop = null;
    var wrap = document.createElement("span"); wrap.className = "cp";
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "cp-btn"; btn.title = "Escolher cor";
    btn.style.background = cur; wrap.appendChild(btn);
    function apply(hex, fire) {
      hex = toHex(hex); if (!hex) return;
      cur = hex; btn.style.background = hex;
      if (pop) { pop.querySelector(".cp-hex").value = hex; pop.querySelector(".cp-native").value = hex; }
      if (fire !== false && onChange) onChange(hex);
    }
    function palRow(title, pal) {
      var r = '<div class="cp-pal-t">' + title + '</div><div class="cp-pal">';
      pal.forEach(function (c) { r += '<button type="button" class="cp-sw" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>'; });
      return r + '</div>';
    }
    function close() { if (pop) { pop.remove(); pop = null; document.removeEventListener("mousedown", outside, true); if (onClose) onClose(); } }
    function outside(e) { if (pop && !pop.contains(e.target) && e.target !== btn) close(); }
    function open() {
      close();
      pop = document.createElement("div"); pop.className = "cp-pop";
      pop.innerHTML = '<div class="cp-row"><input type="color" class="cp-native" value="' + cur + '"><input type="text" class="cp-hex" value="' + cur + '" maxlength="7" spellcheck="false"></div>' +
        palRow("Praxis", P.PALETTE_COLOR) + palRow("Daltônicos (Okabe-Ito)", P.PALETTE_CB);
      document.body.appendChild(pop);
      var r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + "px";
      pop.style.top = ((r.bottom + ph + 8 > window.innerHeight) ? Math.max(8, r.top - ph - 4) : r.bottom + 4) + "px";
      pop.querySelector(".cp-native").addEventListener("input", function () { apply(this.value); });
      pop.querySelector(".cp-hex").addEventListener("input", function () { var v = this.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) apply(v.charAt(0) === "#" ? v : "#" + v); });
      pop.querySelectorAll(".cp-sw").forEach(function (s) { s.addEventListener("click", function () { apply(this.getAttribute("data-c")); }); });
      setTimeout(function () { document.addEventListener("mousedown", outside, true); }, 0);
    }
    btn.addEventListener("click", function (e) { e.stopPropagation(); if (pop) close(); else open(); });
    return { el: wrap, set: function (h) { apply(h, false); }, get: function () { return cur; } };
  }
  P.colorPicker = colorPicker;   // exposto p/ os outros módulos (mdim, segmenter, transcription) usarem o mesmo widget

  // Atualiza TODOS os <input type=color> nativos dentro de `root` para o widget novo (hex + paletas),
  // sem mexer na fiação existente: o input nativo fica escondido como portador do valor e o widget
  // dispara nele os eventos input/change ao mudar, então os handlers atuais seguem funcionando.
  P.upgradeColorInputs = function (root) {
    if (!P.colorPicker || !root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('input[type="color"]'), function (inp) {
      if (inp.__cpDone) return;
      if (inp.classList && inp.classList.contains("cp-native")) return;   // não re-upgradar o input interno do próprio widget
      if (inp.closest && inp.closest(".cp")) return;
      inp.__cpDone = true;
      // swatches pequenos (ex.: chips de código de 13px) ganham a variante compacta do widget
      var w = inp.getBoundingClientRect().width, small = (w > 0 && w <= 20) || parseInt(inp.style.width, 10) <= 20;
      var dirty = false;
      var cp = P.colorPicker(inp.value || "#888888",
        function (hex) { inp.value = hex; dirty = true; inp.dispatchEvent(new Event("input", { bubbles: true })); },   // ao vivo
        function () { if (dirty) { dirty = false; inp.dispatchEvent(new Event("change", { bubbles: true })); } });     // change só ao fechar (como o picker nativo)
      if (small && cp.el.classList) cp.el.classList.add("cp-sm");
      inp.style.display = "none";
      if (inp.parentNode) inp.parentNode.insertBefore(cp.el, inp);
    });
  };
})(window.Praxis = window.Praxis || {});
