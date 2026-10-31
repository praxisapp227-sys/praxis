/* util.js - parsing de tempo, encoding, CSV. Sem dependências. */
(function (P) {
  "use strict";

  // --- Ícones (SVG inline, grade 16, traço 1,4, currentColor). O svg interno
  //     ignora ponteiro para que o clique registre no elemento pai. ---------
  P.ICON = {
    edit: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="pointer-events:none;vertical-align:middle"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    lock: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" style="pointer-events:none;vertical-align:middle"><rect x="3.5" y="7" width="9" height="6.4" rx="1.3"/><path d="M5.6 7V5.1a2.4 2.4 0 0 1 4.8 0V7"/></svg>',
    eye: '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" style="pointer-events:none;vertical-align:middle"><path d="M1.5 9S4 4 9 4s7.5 5 7.5 5-2.5 5-7.5 5S1.5 9 1.5 9Z"/><circle cx="9" cy="9" r="2.1"/></svg>',
    eyeOff: '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" style="pointer-events:none;vertical-align:middle"><path d="M1.5 9S4 4 9 4s7.5 5 7.5 5-2.5 5-7.5 5S1.5 9 1.5 9Z"/><circle cx="9" cy="9" r="2.1"/><path stroke-linecap="round" d="M3 3l12 12"/></svg>',
    play: '<svg viewBox="0 0 18 18" width="13" height="13" fill="currentColor" style="pointer-events:none;vertical-align:middle"><polygon points="4,2 15,9 4,16"/></svg>',
    pause: '<svg viewBox="0 0 18 18" width="13" height="13" fill="currentColor" style="pointer-events:none;vertical-align:middle"><rect x="4" y="3" width="3.4" height="12" rx="1"/><rect x="10.6" y="3" width="3.4" height="12" rx="1"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="pointer-events:none;vertical-align:middle"><path d="M8 3v10M3 8h10"/></svg>'
  };

  // --- Tempo -----------------------------------------------------------------
  // Aceita "hh:mm:ss.ms", "mm:ss.ms", "ss.ms" e segundos puros. Retorna segundos (float).
  P.parseTime = function (str) {
    if (str == null) return NaN;
    str = String(str).trim().replace(",", ".");
    if (str === "") return NaN;
    if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    var parts = str.split(":").map(function (p) { return parseFloat(p); });
    if (parts.some(isNaN)) return NaN;
    var s = 0;
    for (var i = 0; i < parts.length; i++) s = s * 60 + parts[i];
    return s;
  };

  P.fmtTime = function (sec, withMs) {
    if (!isFinite(sec)) return "--:--";
    sec = Math.max(0, sec);
    if (withMs) sec = Math.round(sec * 10) / 10;   // arredonda aos décimos ANTES de separar (65,96 s → 1:06.0, não 1:05.10)
    var h = Math.floor(sec / 3600),
        m = Math.floor((sec % 3600) / 60),
        s = Math.floor(sec % 60),
        ms = Math.round((sec - Math.floor(sec)) * 10);
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    var base = (h > 0 ? h + ":" + p2(m) : m + "") + ":" + p2(s);
    return withMs ? base + "." + ms : base;
  };

  // --- Encoding --------------------------------------------------------------
  // Detecta BOM UTF-16/UTF-8; se nada, tenta UTF-8 e cai para ISO-8859-1 se houver
  // caracteres de substituição (o caso real do export do ELAN).
  P.decodeBuffer = function (buf) {
    var bytes = new Uint8Array(buf);
    var enc = "utf-8", hadBom = false;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { enc = "utf-16le"; hadBom = true; }
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { enc = "utf-16be"; hadBom = true; }
    else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { enc = "utf-8"; hadBom = true; }
    var text = new TextDecoder(enc, { fatal: false }).decode(bytes);
    if (!hadBom && text.indexOf("�") !== -1) {
      // provável ISO-8859-1 (Latin-1) - o "a priori" do ELAN
      var latin = new TextDecoder("iso-8859-1").decode(bytes);
      if ((latin.match(/�/g) || []).length < (text.match(/�/g) || []).length) {
        return { text: latin, encoding: "iso-8859-1" };
      }
    }
    return { text: text, encoding: enc };
  };

  // --- CSV -------------------------------------------------------------------
  P.detectDelimiter = function (sample) {
    var cands = [";", ",", "\t"], best = ",", bestCount = -1;
    cands.forEach(function (d) {
      var line = sample.split(/\r?\n/)[0] || "";
      var n = line.split(d).length;
      if (n > bestCount) { bestCount = n; best = d; }
    });
    return best;
  };

  P.parseCSV = function (text, delim) {
    text = String(text).replace(/\r\n?/g, "\n");   // CRLF (Windows) e CR sozinho (Mac antigo) → LF
    delim = delim || P.detectDelimiter(text);
    var rows = [], row = [], field = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (c === "\r") { /* skip */ }
        else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length && r.some(function (x) { return x.trim() !== ""; }); });
  };

  P.toCSV = function (rows, delim) {
    delim = delim || ";";
    return rows.map(function (r) {
      return r.map(function (v) {
        v = v == null ? "" : String(v);
        return /["\n\r;,\t]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(delim);
    }).join("\r\n");
  };

  // --- XLSX (planilha nativa do Excel, gerada localmente, sem biblioteca) ------
  // AoA (matriz de linhas) -> Blob .xlsx. Número (ou string numérica) vira célula
  // numérica; o resto, texto (inlineStr). ZIP método STORE (sem compressão) + CRC32.
  (function () {
    var CRC = (function () {
      var t = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
      return t;
    })();
    function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    var enc = new TextEncoder();
    function xesc(s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    }
    function colLetter(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26 | 0; } return s; }
    function sheetXml(aoa) {
      var body = "";
      (aoa || []).forEach(function (row, r) {
        body += '<row r="' + (r + 1) + '">';
        (row || []).forEach(function (v, c) {
          var ref = colLetter(c) + (r + 1);
          var isNum = (typeof v === "number" && isFinite(v)) || (typeof v === "string" && v !== "" && /^-?\d+(\.\d+)?$/.test(v));
          if (v == null || v === "") body += '<c r="' + ref + '"/>';
          else if (isNum) body += '<c r="' + ref + '"><v>' + xesc(v) + '</v></c>';
          else body += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>';
        });
        body += '</row>';
      });
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
    }
    function zip(files) {
      var chunks = [], central = [], offset = 0;
      function u16(n) { return [n & 255, (n >>> 8) & 255]; }
      function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
      files.forEach(function (f) {
        var nameB = enc.encode(f.name), data = f.bytes, crc = crc32(data);
        var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
        chunks.push(new Uint8Array(local), nameB, data);
        var cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
        central.push(new Uint8Array(cen), nameB);
        offset += local.length + nameB.length + data.length;
      });
      var cdStart = offset, cdSize = 0;
      central.forEach(function (b) { cdSize += b.length; });
      var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(cdStart), u16(0));
      return new Blob(chunks.concat(central, [new Uint8Array(end)]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }
    P.toXLSX = function (aoa, sheetName) {
      sheetName = (sheetName || "Planilha").replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31) || "Planilha";
      return zip([
        { name: "[Content_Types].xml", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
        { name: "_rels/.rels", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
        { name: "xl/workbook.xml", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xesc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>') },
        { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
        { name: "xl/worksheets/sheet1.xml", bytes: enc.encode(sheetXml(aoa)) }
      ]);
    };
  })();

  // --- Download --------------------------------------------------------------
  P.download = function (filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  };

  P.escapeHtml = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // --- File System Access + armazenamento de handles -------------------------
  // Disponível no Chromium (Chrome/Edge). Permite reabrir os arquivos de mídia e
  // regravar o .praxis sem novo file-picker (itens 2 e 3).
  P.hasFSA = typeof window !== "undefined" && "showSaveFilePicker" in window && "showOpenFilePicker" in window;

  // Pede armazenamento PERSISTENTE. Sem isso o navegador pode DESCARTAR (evict), sob pressão de disco, o que este app
  // guarda por origem: os handles de mídia (IndexedDB) e os modelos do Whisper baixados (Cache API). Foi o que deixou
  // o sistema "não confiável" - mídia que não religa e modelos que "somem". Best-effort (o navegador pode negar), não
  // bloqueia nada. IMPORTANTE: isto protege dados FUTUROS e é preso à ORIGEM (porta) - por isso o launcher fixa a porta.
  P.persistStorage = function () {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persisted().then(function (already) {
          return already ? true : navigator.storage.persist();
        }).catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  };
  if (typeof window !== "undefined" && typeof Promise !== "undefined") P.persistStorage();

  P.uid = function () {
    return "p" + Date.now().toString(36) + Math.floor((typeof crypto !== "undefined" && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : 0) || 0).toString(36);
  };

  // KV mínimo em IndexedDB (guarda FileSystemFileHandle, que é clonável estruturalmente).
  P.idb = (function () {
    var DB = "praxis", STORE = "kv", dbp = null;
    function open() {
      return dbp || (dbp = new Promise(function (res, rej) {
        var r = indexedDB.open(DB, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      }));
    }
    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction(STORE, mode), st = tx.objectStore(STORE), rq = fn(st);
          rq.onsuccess = function () { res(rq.result); };
          rq.onerror = function () { rej(rq.error); };
        });
      });
    }
    return {
      get: function (k) { return run("readonly", function (st) { return st.get(k); }); },
      set: function (k, v) { return run("readwrite", function (st) { return st.put(v, k); }); },
      del: function (k) { return run("readwrite", function (st) { return st.delete(k); }); }
    };
  })();

  // --- Correlação cruzada (alinhamento por onda) ------------------------------
  // Acha o deslocamento (em amostras) de b em relação a a que maximiza a correlação
  // normalizada (Pearson na sobreposição). lag>0 => b está atrasado em relação a a
  // (b[i+lag] ~ a[i]). Devolve {lag, score}. a e b devem ter a mesma taxa de amostragem.
  P.xcorrBestLag = function (a, b, maxLag) {
    var n = Math.min(a.length, b.length);
    if (n < 4) return { lag: 0, score: 0 };
    maxLag = Math.min(maxLag || Math.floor(n / 2), n - 1);
    var ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var best = -Infinity, bestLag = 0;
    for (var lag = -maxLag; lag <= maxLag; lag++) {
      var s = 0, ea = 0, eb = 0, cnt = 0;
      var i0 = Math.max(0, -lag), i1 = Math.min(n, n - lag);
      for (i = i0; i < i1; i++) {
        var va = a[i] - ma, vb = b[i + lag] - mb;
        s += va * vb; ea += va * va; eb += vb * vb; cnt++;
      }
      if (cnt < n * 0.4) continue;              // exige sobreposição substancial
      var denom = Math.sqrt(ea * eb);
      if (denom <= 0) continue;
      var score = s / denom;
      if (score > best) { best = score; bestLag = lag; }
    }
    return { lag: bestLag, score: best === -Infinity ? 0 : best };
  };

  // Paletas: cor (padrão), escala de cinza e daltônico-segura (Okabe-Ito).
  P.PALETTE_COLOR = ["#4f9df5", "#33c9a3", "#f0a63a", "#e8636b", "#a879e6", "#6fb96f", "#e07bb0", "#7a8a99"];
  P.PALETTE_GRAY = ["#2b2b2b", "#4a4a4a", "#666", "#808080", "#999", "#b3b3b3", "#cccccc", "#5c5c5c"];
  P.PALETTE_CB = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442", "#666666"];


  // Aviso flutuante de erro (canto inferior, some sozinho; clique fecha). Usa o estilo .status.err.
  P.toastError = function (msg) {
    var el = document.getElementById("px-toast");
    if (!el) {
      el = document.createElement("div"); el.id = "px-toast"; el.setAttribute("role", "alert");
      el.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;max-width:min(680px,92vw);cursor:pointer;box-shadow:var(--shadow-2)";
      el.addEventListener("click", function () { el.style.display = "none"; });
      document.body.appendChild(el);
    }
    el.className = "status err"; el.textContent = msg; el.style.display = "inline-flex";
    clearTimeout(el._t); el._t = setTimeout(function () { el.style.display = "none"; }, 7000);
  };
})(window.Praxis = window.Praxis || {});
