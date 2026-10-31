#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Cache-busting automatico do Praxis.
# Carimba em cada asset local (js/css/data) referenciado no index.html um
# "?v=<hash>" derivado do CONTEUDO do arquivo. Assim o navegador so rebaixa o
# que mudou (hash estavel = cache; conteudo novo = hash novo), sem precisar
# bumpar "?v=bN" na mao. Roda automatico no iniciar.bat; rode tambem antes de
# publicar no GitHub Pages.  Uso:  python build.py
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "index.html"

# casa src="js/x.js"  href="css/x.css"  src="data/x.js" (com ou sem ?v= antigo)
PAT = re.compile(r'(src|href)="((?:js|css|data)/[^"?]+)(?:\?v=[^"]*)?"')


def main():
    html = INDEX.read_text(encoding="utf-8")
    seen = {}
    missing = []

    def repl(m):
        attr, path = m.group(1), m.group(2)
        f = ROOT / path
        if not f.exists():
            missing.append(path)
            return m.group(0)
        if path not in seen:
            seen[path] = hashlib.sha1(f.read_bytes()).hexdigest()[:10]
        return '%s="%s?v=%s"' % (attr, path, seen[path])

    new = PAT.sub(repl, html)
    changed = new != html
    if changed:
        INDEX.write_text(new, encoding="utf-8")

    print("[build] %d assets carimbados%s" % (len(seen), " (index.html atualizado)" if changed else " (sem mudanca)"))
    if missing:
        print("[build] AVISO: nao encontrei: " + ", ".join(sorted(set(missing))))


if __name__ == "__main__":
    main()
