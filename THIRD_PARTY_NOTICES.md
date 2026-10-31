# Componentes de terceiros

O código do Praxis é distribuído sob a licença **0BSD** (ver `LICENSE`). Os componentes
abaixo são incluídos na pasta `vendor/` e **mantêm as suas próprias licenças**.

| Componente | Pasta | Licença | Origem |
|---|---|---|---|
| Transformers.js 3.5.1 | `vendor/transformers/` | Apache-2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime Web | `vendor/ort/` | MIT | https://github.com/microsoft/onnxruntime |
| Verovio | `vendor/verovio/` | LGPL-3.0-or-later | https://github.com/rism-digital/verovio |
| Fontes Edwin | `vendor/fonts/` | SIL Open Font License 1.1 | https://github.com/MuseScoreFonts/Edwin |
| Pesos do Whisper (base), conversão ONNX Xenova | `vendor/models/` (pacote de release) | MIT | https://github.com/openai/whisper · https://huggingface.co/Xenova/whisper-base |

Os demais modelos do Whisper (tiny, small, medium, large-v3, large-v3-turbo) não são
distribuídos com o Praxis: são baixados do HuggingFace no primeiro uso, sob a licença MIT
dos pesos originais.

Os textos completos dessas licenças estão na pasta `licenses/`:

- `licenses/transformers.js-Apache-2.0.txt`
- `licenses/onnxruntime-MIT.txt`
- `licenses/verovio-LGPL-3.0.txt` (a LGPL-3.0 complementa a GPL-3.0: `licenses/verovio-GPL-3.0.txt`)
- `licenses/edwin-OFL-1.1.txt` (as fontes são distribuídas sem modificação; "Edwin" é nome de fonte reservado)
- `licenses/whisper-MIT.txt`

O Verovio é usado como biblioteca separada e sem modificação (`vendor/verovio/`); quem quiser pode
substituí-lo por outra versão do Verovio trocando esse arquivo.
