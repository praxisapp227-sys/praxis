@echo off
REM Abre o Praxis no Windows: sobe o servidor local (midia por pasta + HTTP range) e abre o navegador.
REM A porta e SEMPRE 8000: o navegador guarda modelos e preferencias por endereco.
cd /d "%~dp0"

set "PY="
REM "py -3" primeiro (instalacao padrao do python.org); "python" so se RODAR de verdade: no Windows existe um
REM atalho falso "python" da Microsoft Store que so abre a loja.
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY ( python -c "import sys" >nul 2>nul && set "PY=python" )
if not defined PY (
  echo.
  echo  O Praxis precisa do Python 3, que nao foi encontrado neste computador.
  echo  Instale em https://www.python.org/downloads/  e marque "Add python.exe to PATH".
  echo  Depois abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "media-roots.txt" (
  echo # Uma pasta por linha: onde ficam suas midias ^(video/audio^). Nada e copiado; a midia fica onde esta.> media-roots.txt
  echo # Exemplo Windows: D:\Pesquisa\Gravacoes>> media-roots.txt
  echo # Exemplo Mac:     /Users/voce/Pesquisa/Gravacoes>> media-roots.txt
)

%PY% build.py
echo Abrindo o Praxis em http://localhost:8000 ...
start "" http://localhost:8000
%PY% serve.py 8000
if errorlevel 1 pause
