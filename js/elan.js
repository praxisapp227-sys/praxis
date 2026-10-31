/* elan.js - importação de arquivos ELAN (.eaf, XML EAF 2.x/3.0).
   Converte tiers alinhadas ao tempo em camadas do Praxis e, quando existe a
   tier "Comportamento" (valor no formato "compassoInicio,compassoFim,CODIGO[, observação]"),
   monta diretamente os dados do Gráfico de Comportamento de Prática. Sem dependências. */
(function (P) {
  "use strict";

  var _seq = 0;
  function uid() { _seq++; return "el" + _seq + "_" + Math.floor((typeof performance !== "undefined" ? performance.now() : 0) * 1000 % 1e9); }

  // Rótulos conhecidos dos códigos de comportamento. Códigos não mapeados ficam
  // sem rótulo (aparecem só pela sigla e podem ser editados na tela Gráfico).
  var LABELS = {
    EX: "Execução", HM: "Harmonia", VR: "Variação de ritmo", VC: "Vocalize",
    ML: "Melodia", CT: "Contexto", EV: "Execução variada", AN: "Anotar guia"
  };

  // Interpreta o valor da camada Comportamento -> {mStart, mEnd, code, note}.
  // Formato base: "compassoInicio,compassoFim,CODIGO[, observação]", por exemplo
  // "23,24.9,EX" ou "23,24.9,EX, subindo a oitava". O código é o primeiro campo
  // com letra; os campos numéricos antes dele são os compassos. Como o pesquisador
  // às vezes usa vírgula decimal ("16,9" em vez de "16.9") e a vírgula também
  // separa campos, três números antes do código indicam um decimal partido no fim
  // (mStart inteiro, mEnd = campo + "." + campo); quatro números, ambos partidos.
  function parseComportamento(value) {
    var fields = String(value == null ? "" : value).split(",").map(function (x) { return x.trim(); });
    var codeIdx = -1;
    for (var i = 0; i < fields.length; i++) { if (/[A-Za-z]/.test(fields[i])) { codeIdx = i; break; } }
    if (codeIdx < 0) codeIdx = Math.min(2, fields.length);           // sem código explícito
    var nums = fields.slice(0, codeIdx);
    var code = (fields[codeIdx] || "").trim();
    var note = fields.slice(codeIdx + 1).join(", ").trim();
    var mStart, mEnd;
    if (nums.length >= 4) { mStart = parseFloat(nums[0] + "." + nums[1]); mEnd = parseFloat(nums[2] + "." + nums[3]); }
    else if (nums.length === 3) { mStart = parseFloat(nums[0]); mEnd = parseFloat(nums[1] + "." + nums[2]); }
    else if (nums.length === 2) { mStart = parseFloat(nums[0]); mEnd = parseFloat(nums[1]); }
    else if (nums.length === 1) { mStart = parseFloat(nums[0]); mEnd = mStart; }
    else { mStart = NaN; mEnd = NaN; }
    return { mStart: mStart, mEnd: mEnd, code: code, note: note };
  }

  // Aceita "Comportamento" e "Comportamentos" (singular/plural), com espaços e
  // acentuação eventual. É a camada cujo valor codifica compasso,compasso,código.
  function isComportamento(id) { return /^\s*comportamentos?\s*$/i.test(id || ""); }

  P.ELAN = {
    parseComportamento: parseComportamento,

    // --- Leitura do EAF ------------------------------------------------------
    parse: function (xmlText) {
      var doc = new DOMParser().parseFromString(xmlText, "application/xml");
      var perr = doc.getElementsByTagName("parsererror");
      if (perr && perr.length) throw new Error("Não foi possível ler o arquivo ELAN: XML inválido.");
      if (!doc.getElementsByTagName("ANNOTATION_DOCUMENT").length) throw new Error("Este arquivo não parece ser um ELAN (.eaf).");

      // TIME_SLOT sem TIME_VALUE é normal no ELAN (camadas Time_Subdivision/Included_In): o ELAN distribui esses pontos
      // por igual entre os vizinhos alinhados. Antes viravam 0 s e as anotações filhas saíam esticadas desde o início.
      var slots = {}, ts = doc.getElementsByTagName("TIME_SLOT"), i, seq = [];
      for (i = 0; i < ts.length; i++) {
        var tv = ts[i].getAttribute("TIME_VALUE");
        seq.push({ id: ts[i].getAttribute("TIME_SLOT_ID"), v: (tv != null && tv !== "" && isFinite(parseInt(tv, 10))) ? parseInt(tv, 10) : null });
      }
      for (i = 0; i < seq.length; i++) {
        if (seq[i].v != null) continue;
        var a0 = i - 1; while (a0 >= 0 && seq[a0].v == null) a0--;
        var b0 = i + 1; while (b0 < seq.length && seq[b0].v == null) b0++;
        var va = a0 >= 0 ? seq[a0].v : null, vb = b0 < seq.length ? seq[b0].v : null;
        if (va != null && vb != null) seq[i].v = Math.round(va + (vb - va) * (i - a0) / (b0 - a0));
        else seq[i].v = va != null ? va : (vb != null ? vb : 0);
      }
      seq.forEach(function (x) { slots[x.id] = x.v; });

      // mapa de anotações alinháveis por id (para resolver REF_ANNOTATION encadeadas)
      var alnById = {}, alns = doc.getElementsByTagName("ALIGNABLE_ANNOTATION");
      for (i = 0; i < alns.length; i++) {
        var a = alns[i];
        alnById[a.getAttribute("ANNOTATION_ID")] = { t1: slots[a.getAttribute("TIME_SLOT_REF1")], t2: slots[a.getAttribute("TIME_SLOT_REF2")] };
      }
      var refParent = {}, refs = doc.getElementsByTagName("REF_ANNOTATION");
      for (i = 0; i < refs.length; i++) refParent[refs[i].getAttribute("ANNOTATION_ID")] = refs[i].getAttribute("ANNOTATION_REF");
      function timeFor(id) { var n = 0; while (id && !alnById[id] && refParent[id] && n < 100) { id = refParent[id]; n++; } return alnById[id]; }

      var tiers = [], tierEls = doc.getElementsByTagName("TIER");
      for (i = 0; i < tierEls.length; i++) {
        var tier = tierEls[i], id = tier.getAttribute("TIER_ID");
        var anns = tier.getElementsByTagName("ANNOTATION"), segs = [];
        for (var j = 0; j < anns.length; j++) {
          var inner = anns[j].firstElementChild; if (!inner) continue;
          var vEls = inner.getElementsByTagName("ANNOTATION_VALUE");
          var val = vEls.length ? (vEls[0].textContent || "").trim() : "";
          var tm;
          if (inner.tagName === "ALIGNABLE_ANNOTATION") tm = { t1: slots[inner.getAttribute("TIME_SLOT_REF1")], t2: slots[inner.getAttribute("TIME_SLOT_REF2")] };
          else tm = timeFor(inner.getAttribute("ANNOTATION_ID"));
          if (tm && tm.t1 != null && tm.t2 != null && tm.t2 >= tm.t1) segs.push({ tStart: tm.t1 / 1000, tEnd: tm.t2 / 1000, value: val });
        }
        segs.sort(function (x, y) { return x.tStart - y.tStart; });
        tiers.push({ id: id, segments: segs });
      }

      // Descritores de mídia com o offset de sincronia (TIME_ORIGIN, em ms). Esse
      // offset é o resultado do alinhamento feito no ELAN: tempo_local_da_mídia =
      // tempo_da_anotação − offset. Reaproveitamos para sincronizar áudio e vídeo.
      var mds = doc.getElementsByTagName("MEDIA_DESCRIPTOR"), media = [];
      for (i = 0; i < mds.length; i++) {
        var u = mds[i].getAttribute("MEDIA_URL") || "", mime = mds[i].getAttribute("MIME_TYPE") || "";
        var origin = parseFloat(mds[i].getAttribute("TIME_ORIGIN") || "0") || 0;
        var base = (u.split(/[\\/]/).pop() || "").trim(), name = base;
        try { name = decodeURIComponent(base); } catch (e) {}
        media.push({ name: name, url: u, mime: mime, offset: origin / 1000, isVideo: /^video\//i.test(mime) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(name) });
      }
      return { tiers: tiers, media: media };
    },

    // --- Camadas do Praxis (Segmentar / Transcrever) -------------------------
    // A tier "Comportamento" vira camada de prática com compassos já codificados;
    // as demais viram camadas de texto livre (verbalização, objetivos, estratégias).
    toTiers: function (parsed) {
      return parsed.tiers.map(function (t) {
        if (isComportamento(t.id)) {
          var vocabSet = {}, segments = t.segments.map(function (s) {
            var c = parseComportamento(s.value);
            if (c.code) vocabSet[c.code] = true;
            var seg = { tStart: s.tStart, tEnd: s.tEnd, value: c.code, note: c.note, locked: true };
            if (isFinite(c.mStart)) seg.mStart = c.mStart;
            if (isFinite(c.mEnd)) seg.mEnd = c.mEnd;
            if (isFinite(c.mStart) && isFinite(c.mEnd)) seg.duration = c.mEnd - c.mStart;
            return seg;
          });
          var vocab = Object.keys(vocabSet).map(function (code) { return { code: code, label: LABELS[code] || "" }; });
          if (!vocab.length) vocab = [{ code: "EX", label: "Execução" }];
          return { id: uid(), name: t.id, kind: "practice", vocab: vocab, activeCat: vocab[0].code, segments: segments };
        }
        return {
          id: uid(), name: t.id, kind: "free", vocab: [], activeCat: null,
          segments: t.segments.map(function (s) { return { tStart: s.tStart, tEnd: s.tEnd, value: s.value, note: "", locked: true }; })
        };
      });
    },

    // --- Dados do Gráfico diretamente do EAF ---------------------------------
    toGCP: function (parsed, name) {
      var comp = null, others = [];
      parsed.tiers.forEach(function (t) { if (!comp && isComportamento(t.id)) comp = t; else others.push(t); });

      var behSet = {}, segments = [];
      (comp ? comp.segments : []).forEach(function (s) {
        var c = parseComportamento(s.value);
        if (!c.code || !isFinite(c.mStart) || !isFinite(c.mEnd)) return;
        behSet[c.code] = true;
        segments.push({ tStart: s.tStart, tEnd: s.tEnd, mStart: c.mStart, mEnd: c.mEnd, behavior: c.code, note: c.note });
      });
      segments.sort(function (a, b) { return a.tStart - b.tStart; });

      var behaviors = Object.keys(behSet), legend = {};
      behaviors.forEach(function (code) { legend[code] = LABELS[code] || ""; });

      // demais tiers como camadas para estatística cruzada e co-ocorrência
      var layers = others.map(function (t) {
        return { name: t.id, kind: "free", segments: t.segments.map(function (s) { return { tStart: s.tStart, tEnd: s.tEnd, value: s.value }; }) };
      });

      // estágios automáticos a partir de "Objetivos de Médio Prazo", por sobreposição
      // no tempo: cada objetivo vira um estágio (GCP menor) cobrindo os segmentos
      // de comportamento cujo início cai dentro do intervalo do objetivo.
      var phases = [];
      var mid = others.filter(function (t) { return /m[eé]dio\s*prazo/i.test(t.id); })[0];
      if (mid && segments.length) {
        mid.segments.forEach(function (o) {
          var from = 0, to = -1;
          segments.forEach(function (s, gi) { if (s.tStart >= o.tStart - 0.001 && s.tStart < o.tEnd) { if (to < 0) from = gi + 1; to = gi + 1; } });
          if (to >= from && to > 0) phases.push({ name: (o.value || "").split(",")[0].trim() || "Estágio", segFrom: from, segTo: to });
        });
      }

      return {
        meta: { participant: name || "Sessão ELAN", nSegments: segments.length, source: "ELAN" },
        behaviors: behaviors, legend: legend, sections: [], phases: phases, layers: layers, segments: segments
      };
    }
  };
})(window.Praxis = window.Praxis || {});
