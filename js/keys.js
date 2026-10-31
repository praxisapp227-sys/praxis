/* keys.js - Registro central de atalhos de teclado (remapeáveis pelo usuário em Configurações).
   Cada ação tem um id, categoria, rótulo e uma tecla padrão (combo baseado em ev.code). O binding do
   usuário é persistido em localStorage. O segmenter consulta P.Keys.actionFor(ev) no onKey e despacha. */
(function (P) {
  "use strict";
  var STORE = "praxis.keys";

  // Todas as ações que recebem (ou podem receber) atalho na tela de Segmentar.
  var ACTIONS = [
    { id: "play",      cat: "Transporte",  label: "Reproduzir / pausar",                def: "Space" },
    { id: "tostart",   cat: "Transporte",  label: "Ir para o início",                   def: "Ctrl+KeyB" },
    { id: "frameBack", cat: "Transporte",  label: "Voltar 1 quadro",                    def: "ArrowLeft" },
    { id: "frameFwd",  cat: "Transporte",  label: "Avançar 1 quadro",                   def: "ArrowRight" },
    { id: "halfBack",  cat: "Transporte",  label: "Voltar 0,5 segundo",                 def: "Ctrl+ArrowLeft" },
    { id: "halfFwd",   cat: "Transporte",  label: "Avançar 0,5 segundo",                def: "Ctrl+ArrowRight" },
    { id: "secBack",   cat: "Transporte",  label: "Voltar 1 segundo",                   def: "Shift+ArrowLeft" },
    { id: "secFwd",    cat: "Transporte",  label: "Avançar 1 segundo",                  def: "Shift+ArrowRight" },
    { id: "speedUp",   cat: "Transporte",  label: "Acelerar reprodução",                def: "Shift+ArrowUp" },
    { id: "speedDown", cat: "Transporte",  label: "Desacelerar reprodução",             def: "Shift+ArrowDown" },
    { id: "seg",       cat: "Segmentação", label: "Marcar segmento (início / fim)",     def: "Enter" },
    { id: "segSkip",   cat: "Segmentação", label: "Pular região (novo ponto, sem criar segmento)", def: "Ctrl+Enter" },
    { id: "segMergePrev", cat: "Segmentação", label: "Marcar segmento e unir ao anterior",      def: "Slash" },
    { id: "blade",     cat: "Segmentação", label: "Ferramenta blade (dividir clicando no cursor)", def: "KeyB" },
    { id: "cancel",    cat: "Segmentação", label: "Cancelar marcação / limpar seleção", def: "Escape" },
    { id: "del",       cat: "Segmentação", label: "Apagar segmento(s) selecionado(s)",  def: "Delete" },
    { id: "selall",    cat: "Segmentação", label: "Selecionar todos da camada",         def: "Ctrl+KeyA" },
    { id: "tierUp",    cat: "Camadas",     label: "Camada anterior",                    def: "ArrowUp" },
    { id: "tierDown",  cat: "Camadas",     label: "Próxima camada",                     def: "ArrowDown" },
    { id: "undo",      cat: "Edição",      label: "Desfazer",                           def: "Ctrl+KeyZ" },
    { id: "redo",      cat: "Edição",      label: "Refazer",                            def: "Ctrl+Shift+KeyZ" },
    { id: "zoomIn",    cat: "Timeline",    label: "Ampliar",                            def: "Ctrl+Equal" },
    { id: "zoomOut",   cat: "Timeline",    label: "Reduzir",                            def: "Ctrl+Minus" },
    { id: "zoomReset", cat: "Timeline",    label: "Zoom 100%",                          def: "Ctrl+Digit0" },
    { id: "pageNext",  cat: "Timeline",    label: "Próxima tela",                       def: "Alt+PageDown" },
    { id: "pagePrev",  cat: "Timeline",    label: "Tela anterior",                      def: "Alt+PageUp" },

    // --- Aba Transcrever (escopo "tr"): namespace próprio, então pode reusar combos da Segmentar sem colidir. ---
    { id: "trPlay",      scope: "tr", cat: "Transcrever · Transporte", label: "Reproduzir / pausar o trecho", def: "Tab" },
    { id: "trRepeat",    scope: "tr", cat: "Transcrever · Transporte", label: "Repetir o trecho do início",   def: "Shift+Tab" },
    { id: "trPrevSeg",   scope: "tr", cat: "Transcrever · Transporte", label: "Trecho anterior",              def: "Alt+ArrowUp" },
    { id: "trNextSeg",   scope: "tr", cat: "Transcrever · Transporte", label: "Próximo trecho",               def: "Alt+ArrowDown" },
    { id: "trSpeedUp",   scope: "tr", cat: "Transcrever · Transporte", label: "Acelerar",                     def: "Shift+ArrowUp" },
    { id: "trSpeedDown", scope: "tr", cat: "Transcrever · Transporte", label: "Desacelerar",                  def: "Shift+ArrowDown" },
    { id: "trHalfBack",  scope: "tr", cat: "Transcrever · Transporte", label: "Voltar 0,5 segundo",           def: "Alt+ArrowLeft" },
    { id: "trHalfFwd",   scope: "tr", cat: "Transcrever · Transporte", label: "Avançar 0,5 segundo",          def: "Alt+ArrowRight" },
    { id: "trLoop",      scope: "tr", cat: "Transcrever · Transporte", label: "Ligar / desligar o loop",      def: "Alt+KeyL" },
    { id: "trStop",      scope: "tr", cat: "Transcrever · Transporte", label: "Parar a reprodução",           def: "Escape" },
    { id: "trPedal",     scope: "tr", cat: "Transcrever · Transporte", label: "Pedal de transcrição (segure)",def: "Space" },
    { id: "trUndo",      scope: "tr", cat: "Transcrever · Edição",     label: "Desfazer",                     def: "Ctrl+KeyZ" },
    { id: "trRedo",      scope: "tr", cat: "Transcrever · Edição",     label: "Refazer",                      def: "Ctrl+Shift+KeyZ" },
    { id: "trCopyPrev",  scope: "tr", cat: "Transcrever · Edição",     label: "Repetir o trecho anterior (mesmo início/fim/código)", def: "Alt+KeyC" }
  ];

  var binding = {};   // id -> combo (string)
  var maps = {};      // scope -> { combo -> id } (inverso por escopo, p/ despacho sem colisão entre telas)

  function scopeOf(id) { for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i].scope || "seg"; return "seg"; }
  function rebuildMap() {
    maps = {};
    ACTIONS.forEach(function (a) { var sc = a.scope || "seg"; if (!maps[sc]) maps[sc] = {}; var c = binding[a.id]; if (c) maps[sc][c] = a.id; });
  }
  function load() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) {}
    binding = {}; ACTIONS.forEach(function (a) { binding[a.id] = saved[a.id] != null ? saved[a.id] : a.def; });
    rebuildMap();
  }
  function save() {
    try { var o = {}; ACTIONS.forEach(function (a) { if (binding[a.id] !== a.def) o[a.id] = binding[a.id]; }); localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {}
  }

  // No Mac, Cmd (⌘) faz o papel do Ctrl: ⌘Z desfaz, ⌘= amplia etc. O combo grava "Ctrl" nos dois sistemas
  // (atalhos salvos continuam valendo em qualquer máquina) e a exibição mostra ⌘ no Mac.
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "");

  // Normaliza um evento de teclado num combo "Mod+...+Code" estável (ordem fixa dos modificadores).
  function combo(ev) {
    var code = ev.code || "";
    if (/^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(code)) return null;   // só a tecla modificadora
    code = code.replace(/^NumpadAdd$/, "Equal").replace(/^NumpadSubtract$/, "Minus").replace(/^Numpad0$/, "Digit0");
    code = code.replace(/^(IntlRo|NumpadDivide)$/, "Slash");   // ABNT2 (e numérico) → mesma "/" do teclado padrão
    var m = [];
    var cmdAsCtrl = IS_MAC && ev.metaKey && !ev.ctrlKey;
    if (ev.ctrlKey || cmdAsCtrl) m.push("Ctrl");
    if (ev.altKey) m.push("Alt");
    if (ev.shiftKey) m.push("Shift");
    if (ev.metaKey && !cmdAsCtrl) m.push("Meta");
    m.push(code);
    return m.join("+");
  }
  function actionFor(ev, scope) { var c = combo(ev); if (!c) return null; var m = maps[scope || "seg"]; return m ? (m[c] || null) : null; }

  function set(id, comboStr) {
    var m = maps[scopeOf(id)] || {};
    var prev = m[comboStr]; if (prev && prev !== id) binding[prev] = "";   // conflito DENTRO do mesmo escopo: a outra ação perde a tecla
    binding[id] = comboStr; rebuildMap(); save();
  }
  function reset() { ACTIONS.forEach(function (a) { binding[a.id] = a.def; }); rebuildMap(); save(); }

  var NICE = { Space: "Espaço", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Equal: "=", Minus: "−",
    Enter: "Enter", Escape: "Esc", Delete: "Del", Backspace: "⌫", PageUp: "PgUp", PageDown: "PgDn", Home: "Home", End: "End",
    Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "⌘", Tab: "Tab", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
    Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]" };
  function pretty(c) {
    if (!c) return "-";
    return c.split("+").map(function (p) { return (IS_MAC && p === "Ctrl") ? "⌘" : (IS_MAC && p === "Alt") ? "⌥" : (NICE[p] || p.replace(/^Key/, "").replace(/^Digit/, "")); }).join(" + ");
  }

  P.Keys = {
    actions: function () { return ACTIONS; },
    binding: function () { return binding; },
    isMac: IS_MAC,
    combo: combo, actionFor: actionFor, set: set, reset: reset, pretty: pretty, load: load
  };
  load();
  P.modKey = IS_MAC ? "⌘" : "Ctrl";   // rótulo do modificador principal p/ textos gerados ("⌘+scroll" no Mac)
  // Dicas fixas do HTML ("Desfazer (Ctrl+Z)") mostram ⌘ no Mac.
  if (IS_MAC) document.addEventListener("DOMContentLoaded", function () {
    Array.prototype.forEach.call(document.querySelectorAll("[title*='Ctrl']"), function (el) { el.title = el.title.replace(/Ctrl\+(?=[^\s)])/g, "⌘").replace(/Ctrl/g, "⌘"); });
  });
})(window.Praxis = window.Praxis || {});
