/* pedal.js - Pedal de transcrição (P.Pedal).
   Controla a mídia (P.Segmenter.media) hands-free, no fluxo dos pedais de datilografia:
     - momentâneo: pedal desce = toca; pedal sobe = pausa + AUTO-RETROCESSO (rebobina rewindMs).
     - alterna: cada acionamento inverte toca/pausa (também com auto-retrocesso ao pausar).
   Fonte da ação é desacoplada: hoje entra por Web MIDI (pedal de sustain do piano digital = Control Change 64);
   dá pra ligar teclado depois nas mesmas ações. Pedais extras: sostenuto (CC66) = rebobinar, soft (CC67) = avançar.
   Web MIDI só em contexto seguro (localhost/https) e Chrome/Edge. */
(function (P) {
  "use strict";
  var STORE = "praxis.pedal";

  var Pedal = {
    mode: "momentary",     // "momentary" | "toggle"
    rewindMs: 1500,        // auto-retrocesso ao pausar
    shuttleMs: 3000,       // salto dos pedais extras (rebobinar/avançar)
    cc: 64,                // controlador do pedal principal (sustain = 64)
    extra: true,           // usar sostenuto(66)=rebobinar e soft(67)=avançar
    deviceId: "",          // "" = todos os dispositivos de entrada

    connected: false,      // Web MIDI ligado
    _access: null, _inputs: [], _down: false,
    onSignal: null,        // callback(kind) p/ o indicador ao vivo: "down"|"up"|"rew"|"fwd"
    onDevices: null,       // callback() quando a lista de dispositivos muda
    onRaw: null,           // callback(Uint8Array) para TODA mensagem MIDI (monitor / aprender pedal)

    load: function () {
      try {
        var o = JSON.parse(localStorage.getItem(STORE) || "{}");
        ["mode", "rewindMs", "shuttleMs", "cc", "extra", "deviceId"].forEach(function (k) { if (o[k] != null) Pedal[k] = o[k]; });
      } catch (e) {}
    },
    save: function () {
      try { localStorage.setItem(STORE, JSON.stringify({ mode: this.mode, rewindMs: this.rewindMs, shuttleMs: this.shuttleMs, cc: this.cc, extra: this.extra, deviceId: this.deviceId })); } catch (e) {}
    },
    media: function () { return P.Segmenter && P.Segmenter.media; },
    available: function () { return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function"; },

    // --- ações sobre a mídia ---
    _play: function () { var m = this.media(); if (m) { try { m.play(); } catch (e) {} } },
    _pauseRewind: function () { var m = this.media(); if (!m) return; m.pause(); m.currentTime = Math.max(0, m.currentTime - this.rewindMs / 1000); },
    rewind: function () { var m = this.media(); if (!m) return; m.currentTime = Math.max(0, m.currentTime - this.shuttleMs / 1000); if (this.onSignal) this.onSignal("rew"); },
    forward: function () { var m = this.media(); if (!m) return; m.currentTime = Math.min((isFinite(m.duration) ? m.duration : 1e9), m.currentTime + this.shuttleMs / 1000); if (this.onSignal) this.onSignal("fwd"); },

    // press/release do pedal principal (chamado pela fonte: MIDI hoje, teclado no futuro)
    press: function () {
      if (this._down) return; this._down = true;
      if (this.mode === "momentary") this._play();
      else { var m = this.media(); if (m && m.paused) this._play(); else this._pauseRewind(); }   // alterna
      if (this.onSignal) this.onSignal("down");
    },
    release: function () {
      if (!this._down) return; this._down = false;
      if (this.mode === "momentary") this._pauseRewind();
      if (this.onSignal) this.onSignal("up");
    },

    // --- Web MIDI ---
    connect: function () {
      var self = this;
      if (!this.available()) return Promise.resolve({ ok: false, msg: "Este navegador não tem Web MIDI. Use Chrome ou Edge." });
      return navigator.requestMIDIAccess({ sysex: false }).then(function (access) {
        self._access = access;
        access.onstatechange = function () { self._bindInputs(); if (self.onDevices) self.onDevices(); };
        self._bindInputs();
        self.connected = true;
        return { ok: true, msg: "" };
      }).catch(function () { return { ok: false, msg: "Permissão de MIDI negada ou nenhum dispositivo disponível." }; });
    },
    disconnect: function () {
      this._inputs.forEach(function (inp) { try { inp.onmidimessage = null; } catch (e) {} });
      this._inputs = []; this.connected = false; this._down = false;
    },
    inputList: function () {
      if (!this._access) return [];
      var out = []; this._access.inputs.forEach(function (inp) { out.push(inp); });   // MIDIInputMap é iterável, não array-like
      return out;
    },
    _bindInputs: function () {
      var self = this;
      this._inputs.forEach(function (inp) { try { inp.onmidimessage = null; } catch (e) {} });
      this._inputs = [];
      this.inputList().forEach(function (inp) {
        if (self.deviceId && inp.id !== self.deviceId) return;
        inp.onmidimessage = function (e) { self._onMIDI(e); };
        self._inputs.push(inp);
      });
    },
    _onMIDI: function (e) {
      var d = e.data; if (!d || d.length < 2) return;
      if (this.onRaw) { try { this.onRaw(d); } catch (er) {} }   // monitor / aprender pedal (todas as mensagens)
      if ((d[0] & 0xF0) !== 0xB0) return;   // só Control Change
      var ctrl = d[1], val = d.length > 2 ? d[2] : 0;
      if (ctrl === this.cc) { if (val >= 64) this.press(); else this.release(); return; }
      if (this.extra) {
        if (ctrl === 66 && val >= 64) this.rewind();      // sostenuto → rebobina
        else if (ctrl === 67 && val >= 64) this.forward(); // soft → avança
      }
    }
  };

  Pedal.load();
  P.Pedal = Pedal;
})(window.Praxis = window.Praxis || {});
