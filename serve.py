#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor local do Praxis.

Serve os arquivos do app (como o http.server) E entrega a midia (audio/video) a partir das
pastas listadas em media-roots.txt, resolvendo por NOME (o tamanho desempata) e COM suporte a
HTTP Range - necessario para buscar/seek video sem baixar o arquivo inteiro. O http.server
padrao NAO faz range, por isso este servidor proprio.

Assim o .praxis guarda so o NOME da midia (nada de caminho absoluto nem handle do navegador):
fica portatil entre Windows e Mac, imune a troca de porta e a descarte de dados do navegador,
e nada precisa ser copiado - a midia continua onde ja esta.

Uso:  python serve.py [porta]      (porta padrao: 8000)
Liga SOMENTE em 127.0.0.1 (uso local).
"""
import os
import sys
import json
import mimetypes
import urllib.parse
import http.server
import socketserver
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOTS_FILE = os.path.join(HERE, "media-roots.txt")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

# Tipos que o mimetypes as vezes nao conhece (importante p/ o navegador tocar o video).
EXTRA_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
    ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo",
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".flac": "audio/flac", ".ogg": "audio/ogg", ".aac": "audio/aac",
}


def read_roots():
    roots = []
    try:
        # utf-8-sig: tolera BOM (Bloco de Notas); errors=replace: um arquivo salvo em ANSI nao derruba o servidor
        with open(ROOTS_FILE, "r", encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                s = line.strip()
                if s and not s.startswith("#"):
                    roots.append(s)
    except FileNotFoundError:
        pass
    return roots


def _key(name):
    """Chave de busca por nome: Unicode NFC + minusculas. O macOS grava nomes acentuados decompostos (NFD:
    "c" + cedilha combinante) e o Windows/.praxis compostos (NFC: "ç"); sem normalizar, "Gravação.mp4" nao casaria."""
    return unicodedata.normalize("NFC", name).lower()


# Indice nome(minusculo) -> [caminhos]. Reconstruido sob demanda (ex.: no primeiro uso e em cada "miss").
_index = None


def build_index():
    global _index
    idx = {}
    for root in read_roots():
        if not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                idx.setdefault(_key(fn), []).append(os.path.join(dirpath, fn))
    _index = idx
    return idx


def find_media(name, size=None):
    idx = _index if _index is not None else build_index()
    cands = idx.get(_key(name), [])
    if not cands:
        idx = build_index()  # talvez a pasta tenha sido adicionada agora; reindexe e tente de novo
        cands = idx.get(_key(name), [])
    if not cands:
        return None
    if size is not None:
        for p in cands:
            try:
                if os.path.getsize(p) == size:
                    return p
            except OSError:
                pass
    return cands[0]  # sem tamanho, ou nenhum casou: o primeiro (nomes costumam ser unicos)


MEDIA_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus"}
def is_media_path(p):
    return os.path.splitext(p)[1].lower() in MEDIA_EXTS


def path_in_roots(p):
    """True se o caminho estiver DENTRO de uma pasta registrada no media-roots.txt (evita servir arquivo arbitrario)."""
    try:
        ap = os.path.normcase(os.path.abspath(p))
    except Exception:
        return False
    for r in read_roots():
        try:
            rr = os.path.normcase(os.path.abspath(r))
        except Exception:
            continue
        if ap == rr or ap.startswith(rr + os.sep):
            return True
    return False


def content_type(path):
    ext = os.path.splitext(path)[1].lower()
    return EXTRA_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def add_root(folder):
    """Adiciona uma pasta ao media-roots.txt (sem duplicar). Preserva o conteudo/comentarios existentes."""
    folder = folder.rstrip("\\/") or folder
    if len(folder) == 2 and folder[1] == ":":   # "D:" sozinho = pasta atual do drive, nao a raiz
        folder += os.sep
    norm = os.path.normcase(os.path.abspath(folder))
    for r in read_roots():
        if os.path.normcase(os.path.abspath(r)) == norm:
            return False
    try:
        with open(ROOTS_FILE, "r", encoding="utf-8-sig", errors="replace") as f:
            content = f.read()
    except FileNotFoundError:
        content = ""
    if content and not content.endswith("\n"):
        content += "\n"
    content += folder + "\n"
    with open(ROOTS_FILE, "w", encoding="utf-8") as f:
        f.write(content)
    return True


# Codigo que roda num PROCESSO SEPARADO para abrir o dialogo nativo (tkinter nao e thread-safe;
# isolar no subprocesso evita conflito com as threads do servidor). Imprime o caminho escolhido.
_PICKER_CODE = (
    "import sys\n"
    "try:\n"
    "    import tkinter, tkinter.filedialog\n"
    "    r = tkinter.Tk(); r.withdraw()\n"
    "    try: r.attributes('-topmost', True)\n"
    "    except Exception: pass\n"
    "    p = tkinter.filedialog.askopenfilename(title='Selecione a midia deste projeto (video ou audio)')\n"
    "    try: r.destroy()\n"
    "    except Exception: pass\n"
    "    sys.stdout.write(p or '')\n"
    "except Exception as e:\n"
    "    sys.stderr.write(str(e)); sys.exit(2)\n"
)


def pick_media_file():
    """Abre um seletor de ARQUIVO nativo e devolve (ok, info). info = caminho ou motivo."""
    import subprocess
    try:
        proc = subprocess.run([sys.executable, "-c", _PICKER_CODE],
                              capture_output=True, text=True, timeout=600)
    except Exception as e:
        return False, "picker-fail: " + str(e)
    if proc.returncode != 0:
        return False, (proc.stderr or "tkinter indisponivel").strip()
    path = (proc.stdout or "").strip()
    if not path:
        return False, "cancelled"
    return True, path


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass  # silencioso

    # ---- protecao contra outros sites abertos no mesmo navegador -----------------------------------------
    # O servidor so escuta 127.0.0.1, mas qualquer pagina da internet pode MANDAR pedidos para localhost.
    #  - Host: recusa nomes que nao sejam localhost (bloqueia "DNS rebinding", em que um dominio externo passa a apontar
    #    para 127.0.0.1 e vira "mesma origem").
    #  - Sec-Fetch-Site/Origin: os endpoints internos (/__media__, /__pickmedia__, /__mediaroots__) so atendem o proprio
    #    app (mesma origem) ou o usuario digitando o endereco; um <img>/<video> de outro site e recusado.
    def _host_ok(self):
        host = (self.headers.get("Host") or "").strip().lower()
        return host in ("localhost:%d" % PORT, "127.0.0.1:%d" % PORT, "[::1]:%d" % PORT, "localhost", "127.0.0.1")

    def _site_ok(self):
        sfs = (self.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sfs:
            return sfs in ("same-origin", "none")
        origin = (self.headers.get("Origin") or "").strip().lower()
        if origin and origin not in ("http://localhost:%d" % PORT, "http://127.0.0.1:%d" % PORT, "http://[::1]:%d" % PORT):
            return False
        return True

    def _guard(self, parsed):
        """True = pode seguir. Responde 403 (mensagem fixa) quando o pedido nao vem do proprio Praxis."""
        if not self._host_ok():
            self.send_error(403, "Forbidden")
            return False
        if parsed.path.startswith("/__") and not self._site_ok():
            self.send_error(403, "Forbidden")
            return False
        return True

    def end_headers(self):
        # o index.html carrega os ?v=<hash> dos assets: nunca pode ficar velho no cache do navegador
        p = urllib.parse.urlparse(self.path).path
        if p.endswith("/") or p.endswith(".html"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ---- roteamento -------------------------------------------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if not self._guard(parsed):
            return
        if parsed.path == "/__mediaroots__":
            return self._send_roots()
        if parsed.path == "/__pickmedia__":
            return self._pick_media()
        if parsed.path == "/__media__":
            return self._serve_media(parsed, body=True)
        return super().do_GET()

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if not self._guard(parsed):
            return
        if parsed.path == "/__media__":
            return self._serve_media(parsed, body=False)
        if parsed.path == "/__mediaroots__":
            return self._send_roots(body=False)
        return super().do_HEAD()

    # ---- endpoints --------------------------------------------------------
    def _send_json(self, obj, body=True):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if body:
            self.wfile.write(payload)

    def _pick_media(self):
        # Abre o dialogo nativo do sistema, adiciona a PASTA do arquivo escolhido ao media-roots.txt e reindexa.
        ok, info = pick_media_file()
        if not ok:
            if info == "cancelled":
                return self._send_json({"ok": False, "cancelled": True})
            return self._send_json({"ok": False, "error": info})
        folder = os.path.dirname(info)
        added = add_root(folder)
        build_index()
        try:
            info_size = os.path.getsize(info)
        except OSError:
            info_size = None
        # Devolve o caminho EXATO + tamanho: o cliente pede exatamente este arquivo (sem ambiguidade por nome).
        return self._send_json({"ok": True, "folder": folder, "file": os.path.basename(info),
                                "path": info, "size": info_size, "added": added})

    def _send_roots(self, body=True):
        roots = read_roots()
        data = [{"path": r, "exists": os.path.isdir(r)} for r in roots]
        payload = json.dumps({"roots": data}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if body:
            self.wfile.write(payload)

    def _serve_media(self, parsed, body=True):
        qs = urllib.parse.parse_qs(parsed.query)
        name = (qs.get("name") or [""])[0]
        size_raw = (qs.get("size") or [""])[0]
        size = int(size_raw) if size_raw.isdigit() else None
        path_raw = (qs.get("path") or [""])[0]
        path = None; exact = False
        # Caminho EXATO (do seletor OU salvo no .praxis): serve este arquivo, desde que exista e seja mídia
        # (a checagem de extensão evita que uma página leia arquivos arbitrarios; a pasta nao precisa estar registrada).
        # caminho de rede (\\servidor\... ou //servidor/...) nunca: so consultar o arquivo ja faria o Windows
        # se autenticar no servidor remoto (vazamento do hash NTLM)
        if path_raw.startswith(("\\\\", "//")):
            path_raw = ""
        if path_raw and os.path.isfile(path_raw) and (is_media_path(path_raw) or path_in_roots(path_raw)):
            path = path_raw; exact = True
        if not path:
            if not name:
                return self.send_error(400, "Bad Request")
            path = find_media(name, size)   # fallback: resolve por nome (tamanho desempata) - reabrir projeto
        if not path or not os.path.isfile(path):
            return self.send_error(404, "Not Found")   # nunca ecoar dados do pedido (quebra de linha = injecao de cabecalho)
        self._stream(path, body=body, exact=exact)

    # ---- streaming com Range ---------------------------------------------
    def _stream(self, path, body=True, exact=False):
        try:
            total = os.path.getsize(path)
        except OSError:
            return self.send_error(404, "Not Found")
        ctype = content_type(path)
        rng = self.headers.get("Range")
        start, end, partial = 0, total - 1, False
        if rng and rng.startswith("bytes="):
            try:
                s, e = rng[6:].split("-", 1)
                if s.strip():
                    start = int(s)
                    end = int(e) if e.strip() else total - 1
                else:                       # sufixo: bytes=-N (ultimos N bytes)
                    start = max(0, total - int(e))
                    end = total - 1
                if start > end or start >= total:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % total)
                    self.end_headers()
                    return
                end = min(end, total - 1)
                partial = True
            except ValueError:
                start, end, partial = 0, total - 1, False
        length = end - start + 1
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if partial:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, total))
        # Diagnostico: qual arquivo foi realmente servido e se foi pelo caminho exato (1) ou por nome (0).
        self.send_header("X-Praxis-Served", urllib.parse.quote(path))
        self.send_header("X-Praxis-Path-Exact", "1" if exact else "0")
        self.end_headers()
        if not body:
            return
        remaining = length
        chunk = 1024 * 256
        with open(path, "rb") as f:
            f.seek(start)
            while remaining > 0:
                buf = f.read(min(chunk, remaining))
                if not buf:
                    break
                try:
                    self.wfile.write(buf)
                except (BrokenPipeError, ConnectionResetError):
                    break  # o navegador fechou a conexao (seek/troca de trecho): normal
                remaining -= len(buf)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    # No Windows, SO_REUSEADDR deixa DOIS servidores ocuparem a mesma porta (o segundo "rouba" as conexoes).
    # La usamos SO_EXCLUSIVEADDRUSE (porta ocupada = erro claro); no Mac/Linux o REUSEADDR so agiliza reiniciar.
    allow_reuse_address = (os.name != "nt")

    def server_bind(self):
        if os.name == "nt":
            import socket
            self.socket.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_EXCLUSIVEADDRUSE", -5), 1)
        super().server_bind()


if __name__ == "__main__":
    build_index()
    n_roots = len(read_roots())
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        # Porta ocupada. A porta NAO pode mudar (o navegador guarda modelos/preferencias por endereco), entao
        # verificamos se e o proprio Praxis ja aberto; se for, basta usar a janela/aba existente.
        running = False
        try:
            import urllib.request
            with urllib.request.urlopen("http://127.0.0.1:%d/__mediaroots__" % PORT, timeout=2) as r:
                running = b"roots" in r.read()
        except Exception:
            pass
        if running:
            print("O Praxis ja esta aberto em http://localhost:%d (outra janela). Pode usar essa." % PORT)
            sys.exit(0)
        print("ERRO: a porta %d esta ocupada por outro programa." % PORT)
        print("Feche o programa que usa essa porta e abra o Praxis de novo.")
        sys.exit(1)
    print("Praxis em http://localhost:%d" % PORT)
    print("Midia: %d pasta(s) em media-roots.txt%s" % (n_roots, "" if n_roots else "  (VAZIO - adicione suas pastas de midia)"))
    print("Ctrl+C para parar.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
