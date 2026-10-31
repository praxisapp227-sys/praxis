/*!
 * grafia.js - cifragem de acordes em múltiplas grafias
 *
 * Um acorde é um conjunto de graus. A CIFRA é só uma das muitas maneiras de
 * escrever esse conjunto, e sistemas diferentes escrevem a mesma coisa de
 * formas diferentes: o que o Chediak grafa "C7M(9)" o Real Book grafa "CΔ9".
 * Esta biblioteca separa as três camadas que costumam vir embaralhadas:
 *
 *   1. INTERPRETAÇÃO  qual conjunto de graus um tipo de acorde significa
 *                     (e onde isso diverge entre convenções: C11 no Brasil não
 *                      tem nona; nos EUA tem)
 *   2. GRAFIA         como esse tipo é escrito em cada sistema de cifragem
 *   3. TIPOGRAFIA     como essa escrita é POSICIONADA (empilhada, sobrescrita,
 *                     em fração), o que é HTML + CSS, não string
 *
 * Sem dependências. Roda no browser (window.Grafia) e no Node (require).
 * O CSS companheiro (grafia.css) é obrigatório para a camada 3.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else root.Grafia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ===================== soletração =====================
  // Nomes de nota são LETRA + ALTERAÇÃO, nunca só altura. A letra vem do grau
  // (uma terça sempre pula uma letra), a alteração sai da conta. É isso que faz
  // o °7 de Dó soletrar Si𝄫 em vez de Lá.

  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var ALT_SEMI = { '': 0, '#': 1, 'x': 2, 'b': -1, 'bb': -2 };
  var ACC_TEXT = { '': '', '#': '♯', 'x': '×', 'b': '♭', 'bb': '𝄫' };

  // grau -> deslocamento de letra e semitons (referência: escala MAIOR)
  var LETTER_OFF = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 9: 1, 11: 3, 13: 5 };
  var BASE_SEMI = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };

  function parseRoot(n) {
    var m = String(n == null ? '' : n).match(/^([A-G])(bb|##|x|#|b)?$/);
    if (!m) return null;
    var acc = m[2] === '##' ? 'x' : (m[2] || '');
    return { letter: m[1], acc: acc, idx: LETTERS.indexOf(m[1]) };
  }

  function parseToken(tok) {
    var m = String(tok).match(/^(bb|##|x|#|b)?(\d{1,2})$/);
    if (!m) return null;
    return { degree: parseInt(m[2], 10), alt: m[1] === '##' ? 'x' : (m[1] || '') };
  }

  function accidentalOf(alter) {
    return alter === 1 ? '♯' : alter === 2 ? '×' : alter === -1 ? '♭' : alter === -2 ? '𝄫' : '';
  }

  // Dada a altura e a LETRA exigida pelo grau, deduz alteração e oitava.
  function spell(midi, letter) {
    var pc = LETTER_PC[letter];
    var alter = (((midi % 12) + 12) % 12) - pc;
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    return {
      midi: midi,
      letter: letter,
      alter: alter,
      accidental: accidentalOf(alter),
      octave: (midi - pc - alter) / 12 - 1,
      name: letter + accidentalOf(alter) + ((midi - pc - alter) / 12 - 1)
    };
  }

  function rootText(rp) { return rp.letter + ACC_TEXT[rp.acc]; }
  function rootMidi(rp, octave) { return 12 * (octave + 1) + LETTER_PC[rp.letter] + ALT_SEMI[rp.acc]; }

  // ===================== catálogo de tipos =====================
  // chave -> { sym, tokens }
  //   sym    sufixo da cifra. String quando é igual em toda grafia, OU um objeto
  //          { chediak, jazz, realbook, compacta } quando varia. Cadeia de fallback:
  //          realbook -> jazz -> chediak. 'chediak-sign' é DERIVADO do chediak
  //          (♭9 vira 9-, ♯11 vira 11+), e 'compacta' deriva trocando ♭/♯ por b/#.
  //   tokens graus do acorde. Array quando a interpretação é universal, OU
  //          { br, us } quando as escolas divergem sobre quais notas o símbolo
  //          significa (o caso das extensões 11 e 13).

  var TYPES = {
    maj:      { sym: '',       tokens: ['1', '3', '5'] },
    min:      { sym: { chediak: 'm', realbook: '-' },  tokens: ['1', 'b3', '5'] },
    dim:      { sym: '°',      tokens: ['1', 'b3', 'b5'] },
    aug:      { sym: '+',      tokens: ['1', '3', '#5'] },
    '5':      { sym: '5',      tokens: ['1', '5'] },
    sus2:     { sym: 'sus2',   tokens: ['1', '2', '5'] },
    sus4:     { sym: 'sus4',   tokens: ['1', '4', '5'] },
    '6':      { sym: '6',      tokens: ['1', '3', '5', '6'] },
    m6:       { sym: { chediak: 'm6', realbook: '-6' },  tokens: ['1', 'b3', '5', '6'] },
    '7':      { sym: '7',      tokens: ['1', '3', '5', 'b7'] },
    maj7:     { sym: { chediak: '7M', jazz: 'maj7', realbook: 'Δ7', compacta: 'Maj7' },  tokens: ['1', '3', '5', '7'] },
    m7:       { sym: { chediak: 'm7', realbook: '-7' },  tokens: ['1', 'b3', '5', 'b7'] },
    m7b5:     { sym: { chediak: 'm7(♭5)', jazz: 'm7♭5', realbook: 'ø7' },  tokens: ['1', 'b3', 'b5', 'b7'] },
    dim7:     { sym: '°7',     tokens: ['1', 'b3', 'b5', 'bb7'] },
    mMaj7:    { sym: { chediak: 'm7M', jazz: 'mMaj7', realbook: '-Δ7', compacta: 'mMaj7' },  tokens: ['1', 'b3', '5', '7'] },
    '7sus4':  { sym: '7sus4',  tokens: ['1', '4', '5', 'b7'] },
    '7b5':    { sym: { chediak: '7(♭5)', jazz: '7♭5' },  tokens: ['1', '3', 'b5', 'b7'] },
    '7#5':    { sym: { chediak: '7(♯5)', jazz: '7♯5' },  tokens: ['1', '3', '#5', 'b7'] },
    add9:     { sym: 'add9',   tokens: ['1', '3', '5', '9'] },
    '9':      { sym: { chediak: '7(9)', jazz: '9' },     tokens: ['1', '3', '5', 'b7', '9'] },
    maj9:     { sym: { chediak: '7M(9)', jazz: 'maj9', realbook: 'Δ9', compacta: 'Maj7(9)' },  tokens: ['1', '3', '5', '7', '9'] },
    m9:       { sym: { chediak: 'm7(9)', jazz: 'm9', realbook: '-9' },  tokens: ['1', 'b3', '5', 'b7', '9'] },
    '7b9':    { sym: { chediak: '7(♭9)', jazz: '7♭9' },  tokens: ['1', '3', '5', 'b7', 'b9'] },
    '7#9':    { sym: { chediak: '7(♯9)', jazz: '7♯9' },  tokens: ['1', '3', '5', 'b7', '#9'] },
    '7#11':   { sym: { chediak: '7(♯11)', jazz: '7♯11' },  tokens: ['1', '3', '5', 'b7', '#11'] },
    '9omit5': { sym: '9omit5', tokens: ['1', '3', 'b7', '9'] },
    '11':     { sym: { chediak: '7(11)', jazz: '11', compacta: '11' },  tokens: { br: ['1', '3', '5', 'b7', '11'], us: ['1', '3', '5', 'b7', '9', '11'] } },
    '13':     { sym: { chediak: '7(13)', jazz: '13', compacta: '13' },  tokens: { br: ['1', '3', '5', 'b7', '13'], us: ['1', '3', '5', 'b7', '9', '13'] } },
    // Estes dois EMPILHAM na grafia 'compacta' (6 sobre 9; 7 sobre 4 com o (9) à direita).
    '69':     { sym: { chediak: '6/9', jazz: '6/9', realbook: '6/9', compacta: '6/9' },  tokens: ['1', '3', '5', '6', '9'] },
    '9sus4':  { sym: { chediak: '7sus4(9)', jazz: '9sus4', realbook: '9sus4', compacta: '7sus4(9)' },  tokens: ['1', '4', '5', 'b7', '9'] }
  };

  // ===================== grafias =====================

  var NOTATIONS = ['chediak', 'chediak-sign', 'jazz', 'realbook', 'compacta'];

  function normNotation(n, convention) {
    if (n === 'br') return 'chediak';
    if (n === 'us') return 'jazz';
    if (n === 'lima') return 'compacta';   // nome antigo desta grafia (projetos/preferências salvos antes)
    if (NOTATIONS.indexOf(n) >= 0) return n;
    return convention === 'us' ? 'jazz' : 'chediak';   // o default acompanha a interpretação
  }

  function normConvention(c) { return c === 'us' ? 'us' : 'br'; }

  // (compacta usa acidentes reais ♭/♯, como o chediak - NÃO ASCII. Correção do autor 2026-08-17.)

  function symFor(type, notation) {
    var s = type.sym;
    if (typeof s === 'string') return s;
    if (notation === 'compacta') return s.compacta != null ? s.compacta : (s.chediak != null ? s.chediak : (s.jazz || ''));
    if (notation === 'jazz') return s.jazz != null ? s.jazz : (s.chediak || '');
    if (notation === 'realbook') return s.realbook != null ? s.realbook : (s.jazz != null ? s.jazz : (s.chediak || ''));
    var base = s.chediak != null ? s.chediak : (s.jazz || '');
    if (notation === 'chediak-sign') return base.replace(/♭(\d+)/g, '$1-').replace(/♯(\d+)/g, '$1+');
    return base;
  }

  // Classe CSS da grafia. 'compacta' usa o estilo base (sem classe extra).
  function grafiaClass(notation) {
    if (notation === 'compacta') return '';
    if (notation === 'chediak-sign') return 'chediak';
    return notation;
  }

  // ===================== gerador a partir de partes =====================
  // Monta a cifra de QUALQUER acorde a partir da decomposição em tríade + sétima + tensões (lidas dos <degree>
  // do arquivo), seguindo a regra de cada grafia. Usado para o que a tabela TYPES não nomeia.
  //   desc: { root, bass, triad, seventh, sixth, tensions:[{deg,alt}], notation, convention }
  //     triad: 'maj'|'min'|'dim'|'aug'|'sus2'|'sus4'|'5'   seventh: null|'dom'|'maj'|'dim'
  //     tensions: extensões/alterações {deg in 5|9|11|13, alt in -2..2}
  var ADD_MAJ7 = { chediak: '7M', 'chediak-sign': '7M', compacta: 'Maj7' };   // sétima maior nas aditivas

  function _accSign(alt) { return alt === 1 ? '♯' : alt === 2 ? '×' : alt === -1 ? '♭' : alt === -2 ? '𝄫' : ''; }
  // Texto de uma tensão conforme a grafia (chediak-sign usa sufixo +/−; as demais, acidente antes do número).
  function _tenText(t, notation, isAdd) {
    if (notation === 'chediak-sign') return (isAdd ? 'add' : '') + t.deg + (t.alt === 1 ? '+' : t.alt === -1 ? '-' : t.alt === 2 ? '++' : t.alt === -2 ? '--' : '');
    return (isAdd ? 'add' : '') + _accSign(t.alt) + t.deg;
  }
  // Núcleo (sem tensões) das grafias ADITIVAS.
  function _coreAdd(triad, seventh, notation) {
    var M = ADD_MAJ7[notation] || '7M';
    switch (triad) {
      case 'maj': return seventh === 'maj' ? M : seventh === 'dom' ? '7' : '';
      case 'min': return seventh === 'maj' ? 'm' + M : seventh === 'dom' ? 'm7' : 'm';
      case 'dim': return seventh === 'dim' ? '°7' : seventh === 'maj' ? '°' + M : seventh === 'dom' ? 'm7' : '°';
      case 'aug': return '+' + (seventh === 'dom' ? '7' : seventh === 'maj' ? M : '');
      case 'sus2': return seventh === 'dom' ? '7sus2' : 'sus2';
      case 'sus4': return seventh === 'dom' ? '7sus4' : 'sus4';
      case '5': return '5';
    }
    return '';
  }
  // Núcleo das grafias IMPLICATIVAS (a extensão natural mais alta nomeia o acorde: lvl 7|9|11|13).
  function _coreImpl(triad, seventh, lvl, notation) {
    var maj = notation === 'realbook' ? 'Δ' : 'maj', m = notation === 'realbook' ? '-' : 'm';
    switch (triad) {
      case 'maj': return seventh === 'maj' ? maj + lvl : seventh === 'dom' ? '' + lvl : '';
      case 'min': return seventh === 'maj' ? m + maj + lvl : seventh === 'dom' ? m + lvl : m;
      case 'dim': return seventh === 'dim' ? '°7' : seventh === 'maj' ? '°' + maj + '7' : seventh === 'dom' ? (notation === 'realbook' ? 'ø' + lvl : m + lvl + '♭5') : '°';
      case 'aug': return '+' + (seventh === 'dom' ? '' + lvl : seventh === 'maj' ? maj + lvl : '');
      case 'sus2': return seventh === 'dom' ? lvl + 'sus2' : 'sus2';
      case 'sus4': return seventh === 'dom' ? lvl + 'sus4' : 'sus4';
      case '5': return '5';
    }
    return '';
  }

  // Decompõe o desc em { core, listed[], isAdd, additive } conforme a grafia.
  function _parts(desc, notation) {
    var additive = notation !== 'jazz' && notation !== 'realbook';
    var triad = desc.triad || 'maj', seventh = desc.seventh || null;
    var tens = (desc.tensions || []).map(function (t) { return { deg: +t.deg, alt: +t.alt || 0 }; })
      .filter(function (t) { return [5, 9, 11, 13].indexOf(t.deg) >= 0; })
      .sort(function (a, b) { return a.deg - b.deg; });
    var isAdd = !seventh && tens.length > 0;   // extensões sem 7ª → add
    if (additive) return { core: _coreAdd(triad, seventh, notation), listed: tens, isAdd: isAdd, additive: true };
    if (isAdd) return { core: _coreImpl(triad, null, 7, notation), listed: tens, isAdd: true, additive: false };   // sem 7ª: lista tudo como add
    var nat = tens.filter(function (t) { return t.alt === 0 && t.deg !== 5; });
    var lvl = nat.length ? Math.max.apply(null, nat.map(function (t) { return t.deg; })) : 7;
    var listed = tens.filter(function (t) { return t.deg === 5 || t.alt !== 0; });   // 5 e alteradas ficam explícitas
    return { core: _coreImpl(triad, seventh, isAdd ? 7 : lvl, notation), listed: listed, isAdd: isAdd, additive: false };
  }

  function _suffixText(p, notation) {
    if (!p.listed.length) return p.core;
    var toks = p.listed.map(function (t) { return _tenText(t, notation, p.isAdd); });
    if (p.additive || p.isAdd) return p.core + '(' + toks.join(',') + ')';      // aditivas e adds: sempre parênteses
    return toks.length === 1 ? p.core + toks[0] : p.core + '(' + toks.join(',') + ')';   // implicativa: 1 inline, 2+ parênteses
  }

  // Cifra completa a partir de partes (texto puro).
  function chordText(desc) {
    var rp = parseRoot(desc.root); if (!rp) return null;
    var notation = normNotation(desc.notation, normConvention(desc.convention));
    var bp = desc.bass ? parseRoot(desc.bass) : null;
    return rootText(rp) + _suffixText(_parts(desc, notation), notation) + (desc.bass ? '/' + (bp ? rootText(bp) : String(desc.bass)) : '');
  }
  // Cifra completa a partir de partes (HTML tipográfico).
  function chordRender(desc) {
    var rp = parseRoot(desc.root); if (!rp) return null;
    var notation = normNotation(desc.notation, normConvention(desc.convention));
    var p = _parts(desc, notation), body;
    if (!p.additive) {                       // implicativa: núcleo + tensões, tudo no sufixo (jazz sobrescreve; realbook mostra)
      body = spanH('suffix', esc(_suffixText(p, notation)));
    } else {
      var par = '';
      if (p.listed.length) {
        var toks = p.listed.map(function (t) { return _tenText(t, notation, p.isAdd); });
        if ((notation === 'chediak' || notation === 'chediak-sign') && toks.length > 1) {
          // empilhado na vertical dentro do parêntese (estilo livro Chediak): maior em cima
          var col = toks.slice().reverse().map(function (x) { return spanH('', esc(x)); }).join('');
          // parênteses altos (envolvem a coluna toda, não só a linha do meio): escalam com o nº de tensões
          par = '<span class="paren pstacked" style="--rows:' + toks.length + '"><span class="pbrace">(</span>' + spanH('pcol', col) + '<span class="pbrace">)</span></span>';
        } else {
          par = spanH('paren', esc('(' + toks.join(',') + ')'));
        }
      }
      body = (p.core ? spanH('suffix', esc(p.core)) : '') + par;
    }
    var bp = desc.bass ? parseRoot(desc.bass) : null;
    var slash = desc.bass ? '/' + (bp ? rootText(bp) : String(desc.bass)) : '';
    var cls = ['grafia']; var gc = grafiaClass(notation); if (gc) cls.push(gc); if (rp.acc) cls.push('acc');
    return { html: esc(rootText(rp)) + body + esc(slash), className: cls.join(' '), notation: notation };
  }
  function chordHtml(desc) { var r = chordRender(desc); return r ? '<span class="' + r.className + '">' + r.html + '</span>' : null; }

  // ===================== API =====================

  function types() { return Object.keys(TYPES); }
  function notations() { return NOTATIONS.slice(); }

  // Sufixo da cifra, como texto puro.
  function symbol(typeKey, opts) {
    var t = TYPES[typeKey];
    if (!t) return null;
    opts = opts || {};
    return symFor(t, normNotation(opts.notation, normConvention(opts.convention)));
  }

  // Graus do acorde, já resolvida a divergência br/us.
  function tokens(typeKey, opts) {
    var t = TYPES[typeKey];
    if (!t) return null;
    var tk = t.tokens;
    return Array.isArray(tk) ? tk.slice() : tk[normConvention((opts || {}).convention)].slice();
  }

  // Notas reais e SOLETRADAS do acorde.
  //   opts: { convention:'br'|'us', inversion:0..n, octave:4 }
  function notes(rootName, typeKey, opts) {
    var rp = parseRoot(rootName);
    var tk = tokens(typeKey, opts);
    if (!rp || !tk) return null;
    opts = opts || {};
    var octave = opts.octave == null ? 4 : opts.octave;
    var base = rootMidi(rp, octave);
    var out = tk.map(function (tok) {
      var p = parseToken(tok);
      if (!p) return null;
      var letter = LETTERS[(rp.idx + LETTER_OFF[p.degree]) % 7];
      var n = spell(base + BASE_SEMI[p.degree] + ALT_SEMI[p.alt], letter);
      n.degree = tok;
      return n;
    });
    if (out.indexOf(null) >= 0) return null;
    var inv = Math.max(0, Math.min(out.length - 1, opts.inversion | 0));
    if (inv) {
      out = out.map(function (n, i) {
        return i < inv ? spell(n.midi + 12, n.letter) : n;
      }).map(function (n, i) { n.degree = out[i].degree; return n; });
      out.sort(function (a, b) { return a.midi - b.midi; });
    }
    return out;
  }

  // ===================== render =====================

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function spanH(cls, inner) { return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + inner + '</span>'; }
  function stackH(top, bot) { return spanH('stack', spanH('', esc(top)) + spanH('', esc(bot))); }
  function fracH(num, den) {
    return spanH('frac', '<span class="num">' + esc(num) + '</span><span class="bar">/</span><span class="den">' + esc(den) + '</span>');
  }

  // Monta o HTML interno da cifra e as classes que o CSS usa pra posicionar.
  //   spec: { root, type, notation?, convention?, bass? }
  //   -> { html, className, symbol, notation }
  // Uso: `<span class="${r.className}">${r.html}</span>`
  function render(spec) {
    spec = spec || {};
    var rp = parseRoot(spec.root);
    var t = TYPES[spec.type];
    if (!rp || !t) return null;

    var convention = normConvention(spec.convention);
    var notation = normNotation(spec.notation, convention);
    var sym = symFor(t, notation);
    var body;

    if (spec.type === '69') {
      body = notation === 'compacta' ? stackH('6', '9')
        : notation === 'realbook' ? fracH('6', '9')
          : spanH('suffix', esc('6/9'));
    } else if (spec.type === '9sus4' && notation === 'compacta') {
      body = stackH('7', '4') + spanH('paren', esc('(9)'));
    } else {
      var core = sym, paren = '', pi = sym.indexOf('(');
      if (pi >= 0) {
        var pe = sym.indexOf(')', pi);
        core = sym.slice(0, pi) + sym.slice(pe + 1);
        paren = sym.slice(pi, pe + 1);
      }
      body = (core ? spanH('suffix', esc(core)) : '') + (paren ? spanH('paren', esc(paren)) : '');
    }

    var bp = spec.bass ? parseRoot(spec.bass) : null;
    var slash = spec.bass ? '/' + (bp ? rootText(bp) : String(spec.bass)) : '';

    var cls = ['grafia'];
    var gc = grafiaClass(notation);
    if (gc) cls.push(gc);
    if (rp.acc) cls.push('acc');

    return {
      html: esc(rootText(rp)) + body + esc(slash),
      className: cls.join(' '),
      symbol: sym,
      notation: notation
    };
  }

  // Elemento completo, pronto pra injetar.
  function html(spec) {
    var r = render(spec);
    return r ? '<span class="' + r.className + '">' + r.html + '</span>' : null;
  }

  // Cifra como TEXTO puro, sem tipografia (logs, exportação, comparação).
  function text(spec) {
    spec = spec || {};
    var rp = parseRoot(spec.root);
    var t = TYPES[spec.type];
    if (!rp || !t) return null;
    var notation = normNotation(spec.notation, normConvention(spec.convention));
    var bp = spec.bass ? parseRoot(spec.bass) : null;
    return rootText(rp) + symFor(t, notation) + (spec.bass ? '/' + (bp ? rootText(bp) : String(spec.bass)) : '');
  }

  return {
    TYPES: TYPES,
    NOTATIONS: NOTATIONS,
    types: types,
    notations: notations,
    symbol: symbol,
    tokens: tokens,
    notes: notes,
    render: render,
    html: html,
    text: text,
    chordText: chordText,     // gerador a partir de partes (tríade+sétima+tensões): texto
    chordHtml: chordHtml,     // ...HTML tipográfico
    chordRender: chordRender,
    parseRoot: parseRoot,
    spell: spell
  };
});
