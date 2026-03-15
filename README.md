# Holy Ghostwriter

Flask-app om Nederlandstalige preken te maken met OpenRouter-modellen.

## Webapp starten (localhost:5010)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open daarna: http://127.0.0.1:5010

## Belangrijk
- OpenRouter API key wordt nu gelezen uit `api_key.txt`.
- Persistente opslag staat in `data/*.json`.
- Bewerkbare prompts staan in `prompts/*.md` en zijn ook via de instellingen-modal aan te passen.

## Desktop wrapper (Electron)

Zie [desktop/README.md](desktop/README.md).
