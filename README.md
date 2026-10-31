# Praxis

Ferramenta local e gratuita para analisar sessões de prática musical a partir de vídeo e áudio:
segmentar e codificar comportamentos, transcrever verbalizações, gerar o Gráfico de Comportamento
de Prática (GCP) e fazer a análise multidimensional (radar, linhas em degraus e tipos de prática).

Tudo roda no seu computador, dentro do navegador. Nenhum vídeo, áudio ou dado sai da sua máquina.

*English summary at the end.*

---

## O que o Praxis faz

| Aba | Para quê |
|---|---|
| **Segmentar** | Player de vídeo e áudio com forma de onda, várias camadas (vocabulário controlado, texto livre, dimensões), segmentação por teclado, partitura sincronizada por compasso e exportação de tabelas (CSV). |
| **Transcrever** | Lista editável de trechos, com loop e atalhos, e transcrição automática da fala com Whisper, rodando localmente. |
| **Gráfico** | Gráfico de Comportamento de Prática: tempo × compasso, seções, estágios, legendas, predefinições de cores (inclusive paleta para daltônicos), resumo dos estágios em tabela e exportação PNG, JPG e SVG. |
| **Multidim.** | Análise multidimensional: dimensões com escalas, índices, radar animado no tempo, linhas em degraus, tipos de prática, figuras multi-sessão (matriz de linhas, radar por tipo, barras de % por tipo) e GIF animado. |

Os projetos são salvos em arquivos `.praxis`, que guardam camadas, codificação e configurações.
A mídia não é copiada para dentro do projeto: o Praxis a encontra pelo nome nas pastas que você indicar.

---

## Instalação

### 1. Baixe o Praxis
Na página de **Releases** do repositório, baixe o `.zip` da versão mais recente e descompacte numa pasta
de sua preferência. O pacote de release já inclui o modelo de transcrição (funciona sem internet).

> Quem clonar o repositório com `git` recebe o mesmo programa, mas sem o modelo de transcrição embutido
> (ele passa do limite de tamanho do GitHub). Nesse caso o Praxis baixa o modelo na primeira transcrição.

### 2. Tenha o Python 3
O Praxis usa um pequeno servidor local escrito em Python (sem bibliotecas extras).

- **Windows:** instale pelo [python.org](https://www.python.org/downloads/) e marque **"Add python.exe to PATH"**.
- **macOS:** instale pelo [python.org](https://www.python.org/downloads/). O Python do Homebrew também funciona,
  mas sem o `tkinter` o botão "Localizar mídia…" não abre o seletor de arquivos.

### 3. Abra
- **Windows:** dois cliques em `iniciar.bat`.
- **macOS:** na primeira vez, clique com o botão direito em `iniciar.command` e escolha **Abrir**
  (o macOS bloqueia arquivos baixados da internet). Depois, dois cliques bastam.

O navegador abre em `http://localhost:8000`. Use **Chrome** ou **Edge** (recomendados). Safari e Firefox
abrem o Praxis, mas sem o salvamento automático e com aceleração limitada na transcrição.

> Mantenha sempre a porta 8000. O navegador guarda os modelos de transcrição e as preferências por endereço;
> mudar a porta faz parecer que eles sumiram.

---

## Onde ficam as mídias

O arquivo `media-roots.txt` (criado na primeira execução) lista as pastas onde estão seus vídeos e áudios,
uma por linha. O Praxis procura a mídia de cada projeto pelo nome nessas pastas. Nada é copiado.

Você não precisa editar o arquivo à mão: quando uma mídia não é encontrada, o botão **"Localizar mídia…"**
abre o seletor do sistema e registra a pasta automaticamente.

Como o `.praxis` guarda só o nome do arquivo, o mesmo projeto abre no Windows e no Mac.

---

## Transcrição automática (Whisper)

- Roda localmente com `transformers.js` e ONNX Runtime; o áudio não sai da máquina.
- O modelo **Base** vem no pacote de release. Os demais (Tiny, Small, Medium, Large v3, Large v3 turbo)
  são baixados do HuggingFace na primeira vez e depois funcionam offline.
- O Whisper transcreve a fala. A codificação de comportamentos continua sendo feita por você.

---

## Atalhos

Os atalhos podem ser remapeados em **Configurações**. No Mac, **⌘** faz o papel do **Ctrl**
(⌘Z desfaz, ⌘= amplia etc.).

| Tecla | Ação |
|---|---|
| `Espaço` | tocar / pausar (na aba Transcrever: `Tab`) |
| `Shift+←` / `Shift+→` | voltar / avançar 1 segundo |
| `←` / `→` | voltar / avançar 1 quadro |
| `↑` / `↓` | trocar a camada ativa |
| `Enter` | segmentar |
| `Esc` | cancelar a marcação / limpar a seleção |
| `1` a `9` | escolher o código na camada de vocabulário |
| `Ctrl+Z` / `Ctrl+Shift+Z` | desfazer / refazer |

---

## Estrutura

```
index.html          interface
css/                estilos
js/                 código (um módulo por área: segmenter, transcription, gcp, mdim, score, timeline...)
data/               exemplo anonimizado do GCP
vendor/             bibliotecas de terceiros (offline)
serve.py            servidor local (arquivos + mídia com HTTP Range)
build.py            carimba versões nos arquivos (cache do navegador)
iniciar.bat         abrir no Windows
iniciar.command     abrir no macOS
```

Não há etapa de compilação nem dependências para instalar além do Python.

---

## Licença

O código do Praxis está sob a licença **0BSD** (veja `LICENSE`): use, copie, modifique e redistribua como
quiser, sem nenhuma exigência. As bibliotecas incluídas em `vendor/` mantêm as próprias licenças
(veja `THIRD_PARTY_NOTICES.md`).

Se o Praxis ajudar na sua pesquisa, uma citação é bem-vinda (veja `CITATION.cff`).

---

## English summary

Praxis is a free, fully local tool for analysing music practice sessions from video and audio: segmenting
and coding behaviours, transcribing speech (Whisper, running locally), building Practice Behaviour Graphs,
and multidimensional analysis (radar plots, step plots, practice types). Nothing leaves your computer.

To run it, install Python 3, download the release `.zip`, and open `iniciar.bat` (Windows) or
`iniciar.command` (macOS; right-click > Open the first time). Chrome or Edge recommended.
The interface is currently in Portuguese. Code license: 0BSD.
