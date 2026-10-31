#!/bin/bash
# Abre o Praxis no macOS: sobe o servidor local (mídia por pasta + HTTP range) e abre o navegador.
# A porta é SEMPRE 8000: o navegador guarda modelos e preferências por endereço.
# Primeira vez: clique com o botão direito neste arquivo > Abrir (o macOS bloqueia arquivos baixados).
cd "$(dirname "$0")" || exit 1

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo
  echo "  O Praxis precisa do Python 3, que não foi encontrado neste Mac."
  echo "  Instale em https://www.python.org/downloads/ e abra este arquivo de novo."
  echo
  read -r -p "Pressione Enter para fechar..." _
  exit 1
fi
if ! "$PY" -c 'import tkinter' >/dev/null 2>&1; then
  echo "Aviso: este Python não tem tkinter; o botão «Localizar mídia…» não vai abrir o seletor."
  echo "       (Use o Python do python.org, ou liste as pastas de mídia em media-roots.txt.)"
fi

if [ ! -f media-roots.txt ]; then
  cat > media-roots.txt <<'TXT'
# Uma pasta por linha: onde ficam suas mídias (vídeo/áudio). Nada é copiado; a mídia fica onde está.
# Exemplo Mac:     /Users/voce/Pesquisa/Gravacoes
# Exemplo Windows: D:\Pesquisa\Gravacoes
TXT
fi

"$PY" build.py
echo "Abrindo o Praxis em http://localhost:8000 ..."
( sleep 1 && open "http://localhost:8000" ) &
"$PY" serve.py 8000 || read -r -p "Pressione Enter para fechar..." _
