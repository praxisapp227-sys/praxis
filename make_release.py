#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera o pacote de release do Praxis: dist/Praxis-<versao>.zip

Inclui exatamente os arquivos do repositorio (o que o git versiona, respeitando o .gitignore)
MAIS o modelo de transcricao vendor/models/ (que fica fora do git por passar de 100 MB).
O iniciar.command sai com permissao de execucao, para abrir com dois cliques no macOS.

Uso:  python make_release.py 1.0.0
"""
import os
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXEC = {"iniciar.command", "serve.py", "build.py", "make_release.py"}


def repo_files():
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                         cwd=ROOT, capture_output=True, check=True).stdout
    return sorted({p for p in out.decode("utf-8").split("\0") if p and (ROOT / p).is_file()})


def model_files():
    base = ROOT / "vendor" / "models"
    if not base.is_dir():
        sys.exit("ERRO: vendor/models/ nao existe; o pacote de release precisa do modelo Base do Whisper.")
    return sorted(p.relative_to(ROOT).as_posix() for p in base.rglob("*") if p.is_file())


def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: python make_release.py <versao>   (ex.: 1.0.0)")
    version = sys.argv[1].lstrip("v")
    subprocess.run([sys.executable, "build.py"], cwd=ROOT, check=True)   # carimba as versoes dos assets
    files = repo_files() + model_files()
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    top = "Praxis-%s" % version
    target = dist / (top + ".zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rel in files:
            info = zipfile.ZipInfo.from_file(ROOT / rel, arcname=top + "/" + rel)
            mode = 0o755 if Path(rel).name in EXEC else 0o644
            info.external_attr = (0o100000 | mode) << 16    # arquivo regular + permissoes Unix
            info.compress_type = zipfile.ZIP_STORED if rel.endswith((".onnx", ".wasm", ".otf")) else zipfile.ZIP_DEFLATED
            with open(ROOT / rel, "rb") as f:
                z.writestr(info, f.read())
    print("Pacote: %s (%d arquivos, %.0f MB)" % (target.relative_to(ROOT), len(files), target.stat().st_size / 1048576))


if __name__ == "__main__":
    main()
