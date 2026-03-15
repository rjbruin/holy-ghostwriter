# PLAN - Holy Ghostwriter

## 1) Backend planning (eerst)

### 1.1 Architectuur
- Stack: Python 3 + Flask.
- App draait op `localhost:5010`.
- Server-side rendering met Jinja2 voor basispagina's; REST/JSON endpoints voor dynamische acties.
- OpenRouter-calls volledig in backend, inclusief streaming en usage-registratie.

### 1.2 Projectstructuur
- `app.py` (Flask app + routes)
- `services/openrouter.py` (OpenRouter client, streaming, schema-validatie)
- `services/storage.py` (JSON-opslag, lock-safe writes)
- `services/export_docx.py` (Markdown -> DOCX export)
- `schemas/*.json` (structured output schema's per actie)
- `data/` (persistente JSON-bestanden)
- `prompts/*.md` (bewerkbare systeemprompts)
- `templates/` + `static/` (frontend)

### 1.3 Datamodel (persistente JSON)
- `data/settings.json`
  - `selected_model_slug`
  - `models[]`: `{ id, name, slug, pricing_prompt, pricing_completion, pricing_cached }`
  - `prompts`: per promptbestand de inhoud (mirror + override)
- `data/sermons.json`
  - `sermons[]`: `{ id, title, bible_reference, bible_text, content_notes, sermon_markdown, sermon_generated, chat_messages[], created_at, updated_at, total_cost_usd }`
- `data/usage_log.json`
  - `entries[]`: `{ id, sermon_id, action_type, model_slug, prompt_tokens, completion_tokens, total_tokens, cost_usd, timestamp, request_payload_meta, response_meta }`
- `data/jobs.json`
  - achtergrondtakenstatus voor requests die doorlopen bij navigeren/sluiten.

### 1.4 Kern-endpoints
- Pagina's
  - `GET /` overzicht projecten (preken)
  - `GET /sermon/<id>` editor/chat pagina
- Sermon CRUD
  - `POST /api/sermons`
  - `PUT /api/sermons/<id>`
  - `DELETE /api/sermons/<id>`
- Settings + modellen
  - `GET /api/settings`
  - `PUT /api/settings/model`
  - `POST /api/settings/models`
  - `PUT /api/settings/prompts/<name>`
- OpenRouter acties (async job-start + stream)
  - `POST /api/action/fetch_bible_text`
  - `POST /api/action/generate_ideas`
  - `POST /api/action/generate_sermon`
  - `POST /api/action/modify_sermon`
  - `POST /api/action/chat`
- Job/stream
  - `POST /api/jobs` (start)
  - `GET /api/jobs/<job_id>/stream` (SSE)
  - `GET /api/jobs/<job_id>` (status/resultaat)
- Export
  - `POST /api/sermons/<id>/export/docx`

### 1.5 Structured output aanpak
- Voor elke actie een JSON-schema:
  - `chat_message`: tekst voor chatbubble (begeleidende woorden)
  - `field_updates`: object met alleen relevante veldwijzigingen (`bible_text`, `sermon_markdown`, etc.)
  - `meta`: confidence, warnings, cited_reference
- Bij stream:
  - tussentijdse delta's naar chat/veld buffer
  - finale schema-validatie met fail-safe parser
- Geen directe ongevalideerde modeloutput naar persistente velden.

### 1.6 Prompt-compositie
- Elke request combineert:
  1. `chat_personality.md`
  2. `standards_and_preferences.md`
  3. actieprompt (`generate_sermon.md`, etc.)
  4. `sermon_style.md`
  5. context (sermonvelden + chatgeschiedenis)
- Alle promptbestanden editable via settings-modal en persistent opgeslagen.

### 1.7 Kostenregistratie
- Parse OpenRouter usage + tokenprijzen.
- Bereken `cost_usd` per request.
- Update `usage_log.json` + increment `sermon.total_cost_usd`.
- UI header op sermonpagina ontvangt realtime update na afronding.

### 1.8 Betrouwbaarheid / background verwerking
- Request start creëert job in backend.
- Worker-thread verwerkt OpenRouter call doorlopend, ook als client disconnect.
- Resultaat blijft opvraagbaar via job-status endpoint.

### 1.9 Security en configuratie
- API key inlezen uit `api_key.txt` (nu), fallback later env var.
- Basale inputvalidatie op alle JSON endpoints.
- Escape/clean voor gerenderde markdown output.

---

## 2) Frontend planning (daarna)

### 2.1 Algemene UX en stijl
- Taal: Nederlands.
- Bootstrap 5 + lichte eigen stylesheet.
- Minimalistisch, rustige klassieke tinten, geen speelse religieuze grappen.

### 2.2 Pagina's
- Home (`/`): lijst projecten met knoppen Nieuw/Bewerken/Verwijderen.
- Sermon detail (`/sermon/<id>`): 2 kolommen, beide full height met interne scroll.
  - Links: titel, bijbelreferentie + `Laden`, bijbeltekstweergave, inhoudsbeschrijving, preek-editor + export.
  - Rechts: chat met header (chatbotnaam + info icoon met slug tooltip), berichten, actieknoppen, inputveld.

### 2.3 Editor en export
- WYSIWYG-editor met markdown als onderliggend formaat.
- Preview/export modal toont gerenderde markdown.
- Downloadknop voor DOCX via backend endpoint.

### 2.4 Settings modal
- Gear-icoon op homepage en/of sermonpage.
- Modelkeuze + prijsinformatie (prompt/completion).
- Modal-in-modal of aparte modal voor model toevoegen (naam + slug).
- Prompt editor tabs/accordions voor alle promptbestanden.

### 2.5 Chatinteractie
- Bubble layout: gebruiker rechts, AI links.
- Pending bubble tijdens wachten (bijv. geanimeerde puntjes).
- Streaming rendering van respons in bubble en relevante velden.
- Actieknoppen contextafhankelijk actief/inactief met tooltip-condities:
  - `Genereer ideeën`
  - `Genereer preek` -> na eerste generatie vervangen door `Pas preek aan`
- Bij actieklik: user-action bubble met knopbadge; klik opent modal met verzonden payload.
- AI-response bubble met vergelijkbare badge + modal met response/meta.

### 2.6 Dataflow frontend
- Bij openen sermon: hydrateer alle velden + chat uit backend.
- Autosave of event-gedreven save voor velden.
- Job-gebaseerde calls (start job -> luister stream -> finalize -> persist).

---

## 3) Bouwvolgorde (iteratief)
1. Backend skeleton + data-opslag + settings/prompts bootstrap.
2. Sermon CRUD + homepage.
3. Sermon detail basislayout + state sync.
4. OpenRouter client + action endpoints + schema's.
5. SSE streaming + pending bubbles + field patching.
6. Promptbeheer + modelbeheer + pricing lookup.
7. Export markdown->DOCX.
8. Usage tracking zichtbaar in UI.
9. Desktop packaging (Electron wrapper met Flask process management, inclusief menu: Open / Afsluiten).
10. E2E sanity check.

## 4) Definition of done
- Alle spec-onderdelen aanwezig en functioneel.
- Persistente data over herstart heen.
- Streaming en structured outputs werken voor alle AI-acties.
- Promptbestanden bestaan en zijn bewerkbaar via settings.
- App start lokaal op poort 5010.
- Desktop wrappers voor macOS en Windows aanwezig met korte run/build instructies in README.
