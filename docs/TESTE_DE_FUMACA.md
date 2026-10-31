# Teste de fumaça (antes de cada versão)

Roteiro curto para conferir, à mão, que o essencial funciona. Faça no **Windows** e no **macOS**,
de preferência no Chrome ou no Edge, a partir do zip de release recém-gerado (`python make_release.py X.Y.Z`).

## Abrir
- [ ] Descompactar o zip numa pasta com acento no caminho (ex.: `Música/Análise`).
- [ ] Windows: dois cliques em `iniciar.bat`. macOS: botão direito em `iniciar.command` > Abrir.
- [ ] O navegador abre em `http://localhost:8000` sem erros no console (F12).
- [ ] Abrir o lançador de novo com o Praxis já aberto: aparece a mensagem "já está aberto" (não sobe um segundo servidor).

## Segmentar
- [ ] Carregar um vídeo e um áudio cujo nome tenha acento (ex.: `Gravação.mp4`). A forma de onda aparece.
- [ ] Espaço toca/pausa; setas navegam; Enter segmenta; `Ctrl+Z` (⌘Z no Mac) desfaz.
- [ ] Salvar o projeto (`.praxis`), fechar a aba, reabrir o projeto: a mídia é reencontrada sozinha.
- [ ] Renomear a pasta da mídia: ao reabrir, "Localizar mídia…" abre o seletor do sistema e religa.
- [ ] Exportar tabela (CSV) com camadas e colunas escolhidas.

## Transcrever
- [ ] Transcrição Whisper (modelo Base) num trecho curto, sem internet: sai texto com tempos.
- [ ] Tab toca o trecho; Alt+↑/↓ navega; o loop funciona.

## Gráfico
- [ ] "Gerar exemplo" desenha o GCP; trocar a predefinição de cores; ligar a legenda.
- [ ] Dividir por estágios; exportar PNG e SVG pelo "Exportar…"; o SVG abre no navegador com as hachuras.
- [ ] "Resumo dos estágios": copiar a tabela e colar no Word; baixar o Excel e abrir.

## Multidim.
- [ ] Carregar o dataset didático; o radar anima ao tocar; os tipos de prática acendem.
- [ ] Figuras: carregar 2 ou mais `.praxis`, ver Matriz, Radar por tipo e Barras %; exportar PNG.
- [ ] Exportar o GIF animado.

## Pacote
- [ ] O zip não contém `media-roots.txt`, projetos `.praxis`, nem dados de participantes.
- [ ] `LICENSE`, `THIRD_PARTY_NOTICES.md` e `licenses/` estão no zip.
