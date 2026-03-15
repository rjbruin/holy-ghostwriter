# Acceptance checklist — Holy Ghostwriter

Gebruik deze lijst om de implementatie systematisch te controleren tegen de SPEC.

## 0) Opstart en basis

- [ ] Maak/activeer venv en installeer dependencies:
  - `python3 -m venv .venv`
  - `source .venv/bin/activate`
  - `pip install -r requirements.txt`
- [ ] Controleer dat `api_key.txt` bestaat en een geldige OpenRouter key bevat.
- [ ] Start app: `python app.py`
- [ ] Open `http://127.0.0.1:5010`
- [ ] Verifieer dat UI in het Nederlands is.
- [ ] Verifieer dat de app draait op poort 5010.

## 1) Homepagina / projecten

- [ ] Home toont lijst met preekprojecten.
- [ ] Knop **Nieuwe preek** maakt een project aan en opent de editor.
- [ ] Knop **Bewerken** opent bestaand project.
- [ ] Knop **Verwijderen** verwijdert project uit lijst en opslag.
- [ ] Na herstart van app zijn projecten nog aanwezig (persistente opslag).

## 2) Instellingen (gear-icoon)

- [ ] Gear-knop opent instellingen-modal.
- [ ] Model-lijst toont minstens:
  - Naam: NVIDIA Nemotron 3 Super (free)
  - Slug: `nvidia/nemotron-3-super-120b-a12b:free`
- [ ] Geselecteerd model is initieel bovenstaande NVIDIA-model.
- [ ] Prijsvelden (token costs) worden opgehaald en zichtbaar indien OpenRouter data beschikbaar is.
- [ ] Modelselectie opslaan werkt en blijft behouden na refresh.
- [ ] **Model toevoegen** modal accepteert naam + slug en voegt model persistent toe.

## 3) Prompts

- [ ] Map `prompts` bevat:
  - `standards_and_preferences.md`
  - `chat_personality.md`
  - `generate_sermon.md`
  - `sermon_style.md`
  - `generate_ideas.md`
  - `modify_sermon.md`
  - `fetch_bible_text.md`
- [ ] In settings zijn prompts zichtbaar en bewerkbaar.
- [ ] Opslaan van prompts werkt en blijft behouden na refresh/herstart.
- [ ] Prompt-tekst is in het Nederlands.

## 4) Preekpagina layout en velden

- [ ] Twee-koloms layout:
  - Links: preekvelden
  - Rechts: chat
- [ ] Beide kolommen vullen verticaal scherm en scrollen intern.
- [ ] Velden aanwezig:
  - Titel
  - Bijbelreferentie
  - Inhoudsbeschrijving
  - Preek-editor (WYSIWYG met Markdown onderliggend)
- [ ] Naast bijbelreferentie staat knop **Laden**.
- [ ] Onder referentie verschijnt bijbeltekst-paragraaf.
- [ ] Export-knop opent modal met gerenderde Markdown preview.
- [ ] Download DOCX levert een `.docx`-bestand op.

## 5) Chat UI

- [ ] Chat-header toont modelnaam + info-icoon.
- [ ] Hover op naam/icoon toont slug tooltip.
- [ ] Berichtenstijl klopt:
  - User rechts
  - AI links
- [ ] Tijdens AI-wachttijd verschijnt pending bubble (geanimeerd).
- [ ] Streaming zichtbaar: tekst groeit tijdens antwoord.

## 6) Actieknoppen en activatielogica

### Genereer ideeën
- [ ] Actief alleen als:
  - bijbelreferentie gevuld
  - inhoudsbeschrijving leeg
  - preek leeg
- [ ] Uitkomst verschijnt alleen als chatbericht (geen veldoverwrite nodig).

### Genereer preek
- [ ] Actief alleen als:
  - bijbelreferentie gevuld
  - inhoudsbeschrijving gevuld
  - preek leeg
- [ ] Bij inactief toont tooltip met voorwaarden.
- [ ] Na succesvolle generatie:
  - preekveld wordt gevuld
  - backend markeert `sermon_generated`
  - knop wordt vervangen door **Pas preek aan**

### Pas preek aan
- [ ] Werkt na gegenereerde/bestaande preek.
- [ ] AI-uitkomst vervangt preektekst in editor.

## 7) Structured outputs en scheiding content/chat

- [ ] Elke AI-actie gebruikt een schema in `schemas/`.
- [ ] AI-uitkomst wordt verwerkt in:
  - chatbegeleiding (`chat_message`)
  - veldupdates (`field_updates`)
- [ ] Begeleidende tekst komt in chat en niet in preekveld.
- [ ] Veldinhoud komt in juiste formulierdelen.

## 8) Chat-acties met metadata modal

- [ ] Klik op action/user bubble toont modal met verzonden info.
- [ ] Klik op AI bubble toont modal met response/meta.
- [ ] Bubble markeert zichtbaar dat actie gebruikt is (tekst/label/context).

## 9) Persistente context per preek

- [ ] Bij sluiten/heropenen van preek blijven behouden:
  - titel
  - bijbelreferentie
  - bijbeltekst
  - inhoudsbeschrijving
  - preektekst
  - chatgeschiedenis
- [ ] Na herstart server blijft bovenstaande nog steeds aanwezig.

## 10) Achtergrondverwerking requests

- [ ] Start AI-actie en navigeer weg van pagina.
- [ ] Verifieer dat job in backend doorloopt en afrondt.
- [ ] Bij terugkomen is resultaat opvraagbaar/zichtbaar via jobstatus en opgeslagen data.

## 11) Kostenregistratie (USD)

- [ ] Na AI-response wordt usage gelogd in `data/usage_log.json` met timestamp.
- [ ] Entry bevat tokens + model + cost_usd + sermon-koppeling.
- [ ] `sermon.total_cost_usd` wordt opgehoogd per request.
- [ ] Kostenheader op preekpagina update na afgeronde response.

## 12) Nederlandse termen en toon

- [ ] Terminologie klopt in UI:
  - preek
  - bijbeltekst
  - inhoudsbeschrijving
- [ ] Geen ongepaste grapjes rondom christendom.
- [ ] Algemene stijl: sober, rustig, functioneel.

## 13) Desktop packaging

- [ ] `desktop/` bevat Electron wrapper met Flask procesbeheer.
- [ ] Contextmenu/Jumplist bevat:
  - Open
  - Afsluiten
- [ ] `Afsluiten` stopt Electron én Flask.
- [ ] `npm run start` opent appvenster met webinterface.
- [ ] Packaging instructies aanwezig en bruikbaar voor macOS en Windows.

## 14) Regressie-snelflow (end-to-end)

- [ ] Maak nieuwe preek.
- [ ] Vul bijbelreferentie en klik **Laden**.
- [ ] Laat **Genereer ideeën** draaien in juiste toestand.
- [ ] Vul inhoudsbeschrijving, laat **Genereer preek** draaien.
- [ ] Laat **Pas preek aan** draaien.
- [ ] Exporteer DOCX.
- [ ] Controleer kostenupdate.
- [ ] Herlaad pagina en verifieer persistente status.

---

## Notities tijdens test

- Datum/tijd:
- Versie/commit:
- Bevindingen:
- Blokkers:
- Beslissingen:
