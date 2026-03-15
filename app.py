import json
import os
import queue
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

import bleach
import requests
from flask import Flask, Response, jsonify, render_template, request, send_file
from jsonschema import ValidationError, validate

from services.export_docx import markdown_to_docx_bytes
from services.openrouter import OpenRouterClient
from services.storage import JsonStorage


ROOT = Path(__file__).resolve().parent

# When bundled by PyInstaller, ROOT points to sys._MEIPASS (read-only).
# HGWRITER_DATA_DIR overrides where user data (data/, prompts/) is stored.
_data_dir_override = os.environ.get('HGWRITER_DATA_DIR')
DATA_ROOT = Path(_data_dir_override) if _data_dir_override else ROOT

DEFAULT_PROMPTS = {
    "standards_and_preferences": """# Standaarden en voorkeuren\n\n- Gebruik de NBV21 als standaardvertaling, tenzij anders gevraagd.\n- Richtlengte preek: 1200 woorden, tenzij anders gevraagd.\n- Schrijf helder, pastoraal en toepasbaar.\n""",
    "chat_personality": """# Chatpersoonlijkheid\n\nJe bent een vriendelijke, deskundige, niet-sycophante assistent voor preekvoorbereiding.\nJe bent respectvol, concreet en theologisch zorgvuldig.\n""",
    "generate_sermon": """# Genereer preek\n\nGebruik de bijbeltekst en inhoudsbeschrijving om een volledige preek in het Nederlands te schrijven.\nLever een duidelijke structuur met inleiding, uitleg, toepassing en afsluiting.\n""",
    "sermon_style": """# Preekstijl\n\nSchrijf in een warme, uitnodigende stijl met heldere taal en concrete voorbeelden.\n""",
    "generate_ideas": """# Genereer ideeën\n\nGeef thema's, invalshoeken en kernvragen voor een preek op basis van de opgegeven bijbelreferentie.\n""",
    "modify_sermon": """# Pas preek aan\n\nHerschrijf of verbeter de huidige preek op basis van de inhoudsbeschrijving en context.\nBehoud de kernboodschap en verbeter helderheid en toepasbaarheid.\n""",
    "fetch_bible_text": """# Haal bijbeltekst op\n\nGeef de bijbeltekst passend bij de opgegeven referentie in goed leesbaar Nederlands.\nVermeld in chat of er onzekerheid is over de exacte afbakening.\n""",
}

DEFAULT_MODELS = [
    {
        "name": "NVIDIA Nemotron 3 Super (free)",
        "slug": "nvidia/nemotron-3-super-120b-a12b:free",
    },
    {
        "name": "Claude Sonnet 4.6",
        "slug": "anthropic/claude-sonnet-4.6",
    },
    {
        "name": "Mistral Medium 3.1",
        "slug": "mistralai/mistral-medium-3.1",
    },
    {
        "name": "ChatGPT 5.3 Chat",
        "slug": "openai/gpt-5.3-chat",
    },
    {
        "name": "OpenAI GPT 5.4 Pro",
        "slug": "openai/gpt-5.4-pro",
    },
    {
        "name": "Claude Opus 4.6",
        "slug": "anthropic/claude-opus-4.6",
    },
]

DEFAULT_SELECTED_MODEL_SLUG = "nvidia/nemotron-3-super-120b-a12b:free"
APP_VERSION = "0.1.2"
GITHUB_REPO = "rjbruin/holy-ghostwriter"

ACTION_PROMPT_MAP = {
    "fetch_bible_text": "fetch_bible_text",
    "generate_ideas": "generate_ideas",
    "generate_sermon": "generate_sermon",
    "modify_sermon": "modify_sermon",
    "chat": "chat_personality",
}

GENERIC_SCHEMA = {
    "type": "object",
    "properties": {
        "chat_message": {"type": "string"},
        "field_updates": {
            "type": "object",
            "properties": {
                "bible_text": {"type": "string"},
                "sermon_markdown": {"type": "string"},
                "content_notes": {"type": "string"},
                "title": {"type": "string"},
                "bible_reference": {"type": "string"},
            },
            "additionalProperties": False,
        },
        "meta": {
            "type": "object",
            "properties": {
                "warnings": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "string"},
            },
            "additionalProperties": True,
        },
    },
    "required": ["chat_message", "field_updates"],
    "additionalProperties": False,
}


def load_schema(action: str):
    path = ROOT / "schemas" / f"{action}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return GENERIC_SCHEMA


app = Flask(__name__)
storage = JsonStorage(ROOT, data_root=DATA_ROOT)
openrouter = OpenRouterClient(ROOT)
storage.bootstrap(
    default_prompts=DEFAULT_PROMPTS,
    default_models=DEFAULT_MODELS,
    default_selected_model_slug=DEFAULT_SELECTED_MODEL_SLUG,
)

jobs_state_lock = threading.RLock()
jobs_event_bus = {}
worker_queue = queue.Queue()
MAX_EVENTS_PER_JOB = 400
MAX_DELTA_EVENT_CHARS = 24000
JOB_EVENT_RETENTION_SECONDS = 120
MAX_TRACKED_JOB_EVENT_STATES = 600


def prune_job_event_bus_locked(now_ts: float = None):
    now_ts = now_ts if now_ts is not None else time.time()
    stale_job_ids = []

    for job_id, state in jobs_event_bus.items():
        completed_at = state.get("completed_at")
        if completed_at and (now_ts - completed_at) > JOB_EVENT_RETENTION_SECONDS:
            stale_job_ids.append(job_id)

    for job_id in stale_job_ids:
        jobs_event_bus.pop(job_id, None)

    if len(jobs_event_bus) <= MAX_TRACKED_JOB_EVENT_STATES:
        return

    overflow = len(jobs_event_bus) - MAX_TRACKED_JOB_EVENT_STATES
    ordered = sorted(
        jobs_event_bus.items(),
        key=lambda item: item[1].get("completed_at") or item[1].get("created_at") or 0,
    )
    for job_id, _ in ordered[:overflow]:
        jobs_event_bus.pop(job_id, None)


def now_iso():
    return storage.now_iso()


def read_api_key_file() -> str:
    key_file = ROOT / "api_key.txt"
    if not key_file.exists():
        return ""
    return key_file.read_text(encoding="utf-8").strip()


def ensure_settings_api_key(settings: dict) -> dict:
    changed = False

    if "openrouter_api_key" not in settings:
        settings["openrouter_api_key"] = ""
        changed = True

    if "ignored_update_version" not in settings:
        settings["ignored_update_version"] = ""
        changed = True

    if not settings.get("openrouter_api_key"):
        file_key = read_api_key_file()
        if file_key:
            settings["openrouter_api_key"] = file_key
            changed = True

    openrouter.set_api_key(settings.get("openrouter_api_key", ""))

    if changed:
        storage.save_settings(settings)

    return settings


def parse_version_tuple(version: str):
    clean = (version or "").strip().lstrip("vV")
    parts = []
    for chunk in clean.split("."):
        try:
            parts.append(int(chunk))
        except ValueError:
            break
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def classify_exception(exc: Exception) -> dict:
    message = str(exc)
    lowered = message.lower()

    if "api key" in lowered or "401" in lowered or "unauthorized" in lowered:
        friendly = "De API key ontbreekt of is ongeldig. Stel je OpenRouter API key in via Instellingen."
    elif "credits" in lowered or "insufficient" in lowered or "402" in lowered or "payment required" in lowered:
        friendly = "Je OpenRouter credits lijken op te zijn. Voeg credits toe in OpenRouter en probeer opnieuw."
    elif "429" in lowered or "rate limit" in lowered:
        friendly = "OpenRouter krijgt te veel verzoeken tegelijk. Wacht even en probeer opnieuw."
    elif "timeout" in lowered:
        friendly = "Het verzoek duurde te lang. Controleer je verbinding en probeer opnieuw."
    else:
        friendly = "Er ging iets mis tijdens het AI-verzoek. Probeer het opnieuw of deel de foutdetails met de maintainer."

    return {
        "friendly_message": friendly,
        "details": message,
    }


def prepare_uploaded_context(sermon: dict):
    context_files = sermon.get("context_files") or []
    text_chunks = []
    attachments = []
    files_meta = []

    for file_item in context_files:
        file_type = (file_item.get("type") or "").lower()
        name = file_item.get("name") or "bestand"
        mime_type = file_item.get("mime_type") or "application/octet-stream"

        files_meta.append({
            "name": name,
            "type": file_type,
            "mime_type": mime_type,
        })

        if file_type == "text":
            text_value = (file_item.get("content_text") or "").strip()
            if text_value:
                text_chunks.append(f"Bestand: {name}\n{text_value[:15000]}")
        elif file_type == "image":
            data_base64 = file_item.get("data_base64") or ""
            if data_base64:
                attachments.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{data_base64}",
                        },
                    }
                )
        elif file_type == "pdf":
            data_base64 = file_item.get("data_base64") or ""
            if data_base64:
                attachments.append(
                    {
                        "type": "file",
                        "file": {
                            "filename": name,
                            "file_data": f"data:{mime_type};base64,{data_base64}",
                        },
                    }
                )

    return {
        "meta": files_meta,
        "text_context": "\n\n---\n\n".join(text_chunks),
        "attachments": attachments,
    }


def fetch_latest_release_info(settings: dict):
    response = requests.get(f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest", timeout=20)
    response.raise_for_status()
    data = response.json()

    latest_version = (data.get("tag_name") or "").strip()
    latest_tuple = parse_version_tuple(latest_version)
    current_tuple = parse_version_tuple(APP_VERSION)
    available = bool(latest_version) and latest_tuple > current_tuple

    ignored = (settings.get("ignored_update_version") or "").strip()
    should_notify = available and latest_version != ignored

    return {
        "current_version": APP_VERSION,
        "latest_version": latest_version,
        "available": available,
        "should_notify": should_notify,
        "release_url": data.get("html_url") or f"https://github.com/{GITHUB_REPO}/releases",
        "changelog": data.get("body") or "",
        "ignored_version": ignored,
    }


def format_display_datetime(iso_value: str) -> str:
    if not iso_value:
        return "-"
    try:
        parsed = datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
        local_dt = parsed.astimezone()
        return local_dt.strftime("%d-%m-%Y %H:%M")
    except ValueError:
        return iso_value


def safe_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def enrich_models_pricing(settings: dict):
    pricing_map = openrouter.fetch_pricing_map()
    capabilities_map = openrouter.fetch_model_capabilities_map()
    for model in settings.get("models", []):
        model_slug = model.get("slug")
        price = pricing_map.get(model_slug)
        capabilities = capabilities_map.get(model_slug) or {"text": True, "pdf": False, "image": False}
        if not price:
            try:
                price = openrouter.fetch_model_endpoints_pricing(model_slug)
            except Exception:
                price = None
        if price:
            model["pricing_prompt"] = price.get("prompt")
            model["pricing_completion"] = price.get("completion")
            model["pricing_cached"] = price.get("cached")
            model["pricing_cached_at"] = now_iso()
        model["supported_input_types"] = capabilities


def analyze_usage_and_persist(settings: dict):
    entries = storage.list_usage_entries()

    per_action = {}
    sermon_sum_prompt = 0.0
    sermon_sum_completion = 0.0
    sermon_count = 0
    chat_sum_prompt = 0.0
    chat_sum_completion = 0.0
    chat_count = 0

    for entry in entries:
        action = entry.get("action_type") or "unknown"
        prompt_tokens = int(entry.get("prompt_tokens", 0) or 0)
        completion_tokens = int(entry.get("completion_tokens", 0) or 0)

        bucket = per_action.setdefault(
            action,
            {
                "count": 0,
                "sum_prompt_tokens": 0,
                "sum_completion_tokens": 0,
                "sum_total_tokens": 0,
            },
        )
        bucket["count"] += 1
        bucket["sum_prompt_tokens"] += prompt_tokens
        bucket["sum_completion_tokens"] += completion_tokens
        bucket["sum_total_tokens"] += prompt_tokens + completion_tokens

        if action == "generate_sermon":
            sermon_count += 1
            sermon_sum_prompt += prompt_tokens
            sermon_sum_completion += completion_tokens
        else:
            chat_count += 1
            chat_sum_prompt += prompt_tokens
            chat_sum_completion += completion_tokens

    action_averages = {}
    for action, bucket in per_action.items():
        count = bucket["count"]
        action_averages[action] = {
            "count": count,
            "avg_prompt_tokens": (bucket["sum_prompt_tokens"] / count) if count else 0.0,
            "avg_completion_tokens": (bucket["sum_completion_tokens"] / count) if count else 0.0,
            "avg_total_tokens": (bucket["sum_total_tokens"] / count) if count else 0.0,
        }

    sermon_avg_prompt = (sermon_sum_prompt / sermon_count) if sermon_count else 0.0
    sermon_avg_completion = (sermon_sum_completion / sermon_count) if sermon_count else 0.0
    chat_avg_prompt = (chat_sum_prompt / chat_count) if chat_count else 0.0
    chat_avg_completion = (chat_sum_completion / chat_count) if chat_count else 0.0

    model_estimates = {}
    for model in settings.get("models", []):
        slug = model.get("slug")
        prompt_price = safe_float(model.get("pricing_prompt"))
        completion_price = safe_float(model.get("pricing_completion"))

        model_estimates[slug] = {
            "estimated_avg_sermon_generation_cost_usd": round((sermon_avg_prompt * prompt_price) + (sermon_avg_completion * completion_price), 8),
            "estimated_avg_chat_message_cost_usd": round((chat_avg_prompt * prompt_price) + (chat_avg_completion * completion_price), 8),
        }

    analysis = {
        "generated_at": now_iso(),
        "total_entries": len(entries),
        "action_averages": action_averages,
        "summary_token_averages": {
            "sermon_generation": {
                "count": sermon_count,
                "avg_prompt_tokens": sermon_avg_prompt,
                "avg_completion_tokens": sermon_avg_completion,
            },
            "chat_non_sermon": {
                "count": chat_count,
                "avg_prompt_tokens": chat_avg_prompt,
                "avg_completion_tokens": chat_avg_completion,
            },
        },
        "model_estimates": model_estimates,
    }

    storage.save_usage_analysis(analysis)
    return analysis


def push_job_event(job_id: str, event: dict):
    with jobs_state_lock:
        state = jobs_event_bus.setdefault(
            job_id,
            {"events": [], "done": False, "created_at": time.time(), "completed_at": None},
        )
        events = state["events"]

        if event.get("type") == "delta" and events and events[-1].get("type") == "delta":
            previous = events[-1].get("content", "")
            incoming = event.get("content", "")
            merged = f"{previous}{incoming}"
            if len(merged) <= MAX_DELTA_EVENT_CHARS:
                events[-1]["content"] = merged
            else:
                events.append(event)
        else:
            events.append(event)

        if len(events) > MAX_EVENTS_PER_JOB:
            state["events"] = events[-MAX_EVENTS_PER_JOB:]

        prune_job_event_bus_locked()


def complete_job_events(job_id: str):
    with jobs_state_lock:
        state = jobs_event_bus.setdefault(
            job_id,
            {"events": [], "done": False, "created_at": time.time(), "completed_at": None},
        )
        state["done"] = True
        state["completed_at"] = time.time()
        prune_job_event_bus_locked()


def calc_cost_usd(model_entry: dict, usage: dict):
    prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
    completion_tokens = int(usage.get("completion_tokens", 0) or 0)

    def as_float(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    prompt_price = as_float(model_entry.get("pricing_prompt"))
    completion_price = as_float(model_entry.get("pricing_completion"))
    return round(prompt_tokens * prompt_price + completion_tokens * completion_price, 8)


def read_prompt(name: str, settings_prompts: dict):
    file_value = storage.read_prompt(name)
    if file_value is not None:
        return file_value
    return settings_prompts.get(name, "")


def build_messages(action: str, sermon: dict, payload: dict, settings: dict):
    prompts = settings.get("prompts", {})
    personality = read_prompt("chat_personality", prompts)
    standards = read_prompt("standards_and_preferences", prompts)
    style = read_prompt("sermon_style", prompts)
    action_prompt_name = ACTION_PROMPT_MAP.get(action, "chat_personality")
    action_prompt = read_prompt(action_prompt_name, prompts)

    context = {
        "sermon": {
            "title": sermon.get("title", ""),
            "bible_reference": sermon.get("bible_reference", ""),
            "bible_text": sermon.get("bible_text", ""),
            "content_notes": sermon.get("content_notes", ""),
            "sermon_markdown": sermon.get("sermon_markdown", ""),
        },
        "payload": payload,
    }

    uploaded_text_context = (payload.get("_uploaded_text_context") or "").strip()
    if uploaded_text_context:
        context["uploaded_text_context"] = uploaded_text_context

    system_message = (
        f"{personality}\n\n"
        f"{standards}\n\n"
        f"{style}\n\n"
        f"Actie-instructie:\n{action_prompt}\n\n"
        "Antwoord ALTIJD met exact één JSON object volgens het schema. "
        "Gebruik chat_message voor chattekst voor de gebruiker. "
        "Gebruik field_updates alleen voor daadwerkelijke veldinhoud."
    )

    user_message = (
        "Werk met deze context (JSON):\n"
        f"{json.dumps(context, ensure_ascii=False)}"
    )

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_message},
    ]


def process_job(job: dict):
    job_id = job["id"]
    sermon_id = job["sermon_id"]
    action = job["action"]
    payload = job.get("payload", {})

    push_job_event(job_id, {"type": "status", "status": "running"})

    sermon = storage.get_sermon(sermon_id)
    if not sermon:
        job["status"] = "failed"
        job["error"] = "Preek niet gevonden"
        storage.save_job(job)
        push_job_event(job_id, {"type": "error", "message": job["error"]})
        complete_job_events(job_id)
        return

    settings = ensure_settings_api_key(storage.get_settings())
    model_slug = settings.get("selected_model_slug")
    model_entry = next((m for m in settings.get("models", []) if m.get("slug") == model_slug), {})

    request_meta = {
        "action": action,
        "payload": payload,
        "model_slug": model_slug,
    }

    uploaded_context = prepare_uploaded_context(sermon)
    payload_with_context = dict(payload)
    payload_with_context["_uploaded_files_meta"] = uploaded_context["meta"]
    payload_with_context["_uploaded_text_context"] = uploaded_context["text_context"]

    user_label = payload.get("action_label") or payload.get("user_message") or action
    storage.append_chat_message(
        sermon_id,
        {
            "id": str(uuid.uuid4()),
            "role": "user",
            "kind": "action",
            "text": user_label,
            "action": action,
            "request_meta": request_meta,
            "timestamp": now_iso(),
        },
    )
    push_job_event(job_id, {"type": "chat_user_action", "label": user_label, "meta": request_meta})

    messages = build_messages(action, storage.get_sermon(sermon_id), payload_with_context, settings)
    schema = load_schema(action)

    usage = {}
    raw_text = ""

    try:
        for event in openrouter.stream_chat(
            model_slug=model_slug,
            messages=messages,
            response_schema=schema,
            attachments=uploaded_context["attachments"],
        ):
            if event["type"] == "delta":
                delta = event["content"]
                raw_text += delta
                push_job_event(job_id, {"type": "delta", "content": delta})
            elif event["type"] == "usage":
                usage = event["usage"]

        parsed = openrouter.parse_structured_response(raw_text)
        if parsed is None:
            parsed = {
                "chat_message": "Ik kon het antwoord niet volledig structureren, maar dit kwam er terug.",
                "field_updates": {},
                "meta": {"warnings": ["Kon JSON-antwoord niet parsen"]},
            }

        try:
            validate(instance=parsed, schema=schema)
        except ValidationError as exc:
            parsed = {
                "chat_message": "Er trad een validatiefout op bij de AI-output. Ik toon de ruwe reactie in de chat.",
                "field_updates": {},
                "meta": {"warnings": [str(exc)]},
            }

        field_updates = parsed.get("field_updates", {})
        if action == "generate_sermon" and field_updates.get("sermon_markdown"):
            field_updates["sermon_generated"] = True
        if action == "modify_sermon" and field_updates.get("sermon_markdown"):
            field_updates["sermon_generated"] = True

        updated_sermon = storage.update_sermon(sermon_id, field_updates) if field_updates else storage.get_sermon(sermon_id)

        ai_message = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "kind": "action_result",
            "text": parsed.get("chat_message", ""),
            "action": action,
            "response_meta": parsed.get("meta", {}),
            "timestamp": now_iso(),
        }
        storage.append_chat_message(sermon_id, ai_message)

        cost_usd = calc_cost_usd(model_entry, usage)
        usage_entry = {
            "id": str(uuid.uuid4()),
            "sermon_id": sermon_id,
            "action_type": action,
            "model_slug": model_slug,
            "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0),
            "completion_tokens": int(usage.get("completion_tokens", 0) or 0),
            "total_tokens": int(usage.get("total_tokens", 0) or 0),
            "cost_usd": cost_usd,
            "timestamp": now_iso(),
            "request_payload_meta": request_meta,
            "response_meta": parsed.get("meta", {}),
        }
        storage.add_usage_entry(usage_entry)
        updated_sermon = storage.get_sermon(sermon_id)

        job["status"] = "completed"
        job["result"] = {
            "chat_message": ai_message,
            "field_updates": field_updates,
            "usage": usage_entry,
            "sermon": updated_sermon,
        }
        job["completed_at"] = now_iso()
        storage.save_job(job)

        push_job_event(job_id, {"type": "result", "result": job["result"]})
        push_job_event(job_id, {"type": "done"})
        complete_job_events(job_id)
    except Exception as exc:
        classified = classify_exception(exc)
        job["status"] = "failed"
        job["error"] = classified["details"]
        job["completed_at"] = now_iso()
        storage.save_job(job)
        push_job_event(
            job_id,
            {
                "type": "error",
                "message": classified["friendly_message"],
                "details": classified["details"],
            },
        )
        complete_job_events(job_id)


def worker_loop():
    while True:
        job = worker_queue.get()
        if job is None:
            break
        process_job(job)


worker_thread = threading.Thread(target=worker_loop, daemon=True)
worker_thread.start()


@app.get("/")
def index_page():
    sort_by = (request.args.get("sort") or "updated_at").strip()
    direction = (request.args.get("direction") or "desc").strip().lower()
    reverse = direction != "asc"

    sermons = storage.list_sermons()
    sort_map = {
        "title": lambda sermon: (sermon.get("title") or "").lower(),
        "bible_reference": lambda sermon: (sermon.get("bible_reference") or "").lower(),
        "updated_at": lambda sermon: sermon.get("updated_at") or "",
    }
    sort_key = sort_map.get(sort_by, sort_map["updated_at"])
    sermons = sorted(sermons, key=sort_key, reverse=reverse)

    sermons_display = []
    for sermon in sermons:
        item = dict(sermon)
        item["updated_at_display"] = format_display_datetime(sermon.get("updated_at", ""))
        sermons_display.append(item)
    return render_template("index.html", sermons=sermons_display, sort_by=sort_by, direction=direction)


@app.get("/sermon/<sermon_id>")
def sermon_page(sermon_id):
    sermon = storage.get_sermon(sermon_id)
    if not sermon:
        return "Preek niet gevonden", 404
    settings = storage.get_settings()
    selected = next((m for m in settings.get("models", []) if m.get("slug") == settings.get("selected_model_slug")), None)
    model_name = selected.get("name") if selected else "Onbekend model"
    model_slug = selected.get("slug") if selected else ""
    return render_template("sermon.html", sermon=sermon, model_name=model_name, model_slug=model_slug)


@app.get("/help")
def help_page():
    return render_template("help.html")


@app.get("/privacy")
def privacy_page():
    return render_template("privacy.html")


@app.get("/api/settings")
def api_get_settings():
    settings = storage.get_settings()
    settings = ensure_settings_api_key(settings)
    try:
        enrich_models_pricing(settings)
        storage.save_settings(settings)
    except Exception:
        pass

    analysis = analyze_usage_and_persist(settings)
    estimates = analysis.get("model_estimates", {})
    for model in settings.get("models", []):
        model_estimate = estimates.get(model.get("slug"), {})
        model["estimated_avg_sermon_generation_cost_usd"] = model_estimate.get("estimated_avg_sermon_generation_cost_usd", 0.0)
        model["estimated_avg_chat_message_cost_usd"] = model_estimate.get("estimated_avg_chat_message_cost_usd", 0.0)

    prompts = {}
    for prompt_file in storage.list_prompt_files():
        prompts[prompt_file.stem] = prompt_file.read_text(encoding="utf-8")
    settings["prompts"] = prompts
    settings["usage_analysis"] = analysis
    return jsonify(settings)


@app.put("/api/settings/api-key")
def api_set_api_key():
    body = request.get_json(force=True)
    key = (body.get("api_key") or "").strip()

    settings = storage.get_settings()
    settings["openrouter_api_key"] = key
    storage.save_settings(settings)
    openrouter.set_api_key(key)
    return jsonify({"ok": True})


@app.get("/api/app/update/check")
def api_check_update():
    settings = ensure_settings_api_key(storage.get_settings())
    try:
        return jsonify(fetch_latest_release_info(settings))
    except Exception as exc:
        return jsonify(
            {
                "current_version": APP_VERSION,
                "latest_version": "",
                "available": False,
                "should_notify": False,
                "release_url": f"https://github.com/{GITHUB_REPO}/releases",
                "changelog": "",
                "ignored_version": settings.get("ignored_update_version") or "",
                "error": str(exc),
            }
        )


@app.put("/api/app/update/ignore")
def api_ignore_update():
    body = request.get_json(force=True)
    version = (body.get("version") or "").strip()

    settings = ensure_settings_api_key(storage.get_settings())
    settings["ignored_update_version"] = version
    storage.save_settings(settings)
    return jsonify({"ok": True})


@app.post("/api/usage/analyze")
def api_usage_analyze():
    settings = ensure_settings_api_key(storage.get_settings())
    try:
        enrich_models_pricing(settings)
        storage.save_settings(settings)
    except Exception:
        pass

    analysis = analyze_usage_and_persist(settings)
    return jsonify(analysis)


@app.put("/api/settings/model")
def api_set_model():
    body = request.get_json(force=True)
    slug = body.get("slug")
    settings = storage.get_settings()
    settings = ensure_settings_api_key(settings)
    if not any(m.get("slug") == slug for m in settings.get("models", [])):
        return jsonify({"error": "Model niet gevonden"}), 404
    settings["selected_model_slug"] = slug
    storage.save_settings(settings)
    return jsonify({"ok": True})


@app.post("/api/settings/models")
def api_add_model():
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    slug = (body.get("slug") or "").strip()
    if not name or not slug:
        return jsonify({"error": "Naam en slug zijn verplicht"}), 400

    settings = storage.get_settings()
    settings = ensure_settings_api_key(settings)
    if any(m.get("slug") == slug for m in settings.get("models", [])):
        return jsonify({"error": "Model bestaat al"}), 400

    new_model = {
        "id": str(uuid.uuid4()),
        "name": name,
        "slug": slug,
        "supported_input_types": {"text": True, "pdf": False, "image": False},
        "pricing_prompt": None,
        "pricing_completion": None,
        "pricing_cached": None,
        "pricing_cached_at": None,
    }

    try:
        capabilities = openrouter.fetch_model_capabilities_map().get(slug)
        if capabilities:
            new_model["supported_input_types"] = capabilities
    except Exception:
        pass

    try:
        price = openrouter.fetch_model_endpoints_pricing(slug)
        if price:
            new_model["pricing_prompt"] = price.get("prompt")
            new_model["pricing_completion"] = price.get("completion")
            new_model["pricing_cached"] = price.get("cached")
            new_model["pricing_cached_at"] = now_iso()
    except Exception:
        pass

    settings.setdefault("models", []).append(new_model)
    storage.save_settings(settings)
    return jsonify({"ok": True})


@app.put("/api/settings/models/<model_id>")
def api_update_model(model_id):
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    slug = (body.get("slug") or "").strip()
    if not name or not slug:
        return jsonify({"error": "Naam en slug zijn verplicht"}), 400

    settings = storage.get_settings()
    settings = ensure_settings_api_key(settings)
    models = settings.get("models", [])
    target_model = next((model for model in models if model.get("id") == model_id), None)
    if not target_model:
        return jsonify({"error": "Model niet gevonden"}), 404

    if any(model.get("slug") == slug and model.get("id") != model_id for model in models):
        return jsonify({"error": "Model bestaat al"}), 400

    previous_slug = target_model.get("slug")
    target_model["name"] = name
    target_model["slug"] = slug
    target_model["supported_input_types"] = {"text": True, "pdf": False, "image": False}
    target_model["pricing_prompt"] = None
    target_model["pricing_completion"] = None
    target_model["pricing_cached"] = None
    target_model["pricing_cached_at"] = None

    try:
        capabilities = openrouter.fetch_model_capabilities_map().get(slug)
        if capabilities:
            target_model["supported_input_types"] = capabilities
    except Exception:
        pass

    try:
        price = openrouter.fetch_model_endpoints_pricing(slug)
        if price:
            target_model["pricing_prompt"] = price.get("prompt")
            target_model["pricing_completion"] = price.get("completion")
            target_model["pricing_cached"] = price.get("cached")
            target_model["pricing_cached_at"] = now_iso()
    except Exception:
        pass

    if settings.get("selected_model_slug") == previous_slug:
        settings["selected_model_slug"] = slug

    storage.save_settings(settings)
    return jsonify({"ok": True})


@app.delete("/api/settings/models/<model_id>")
def api_delete_model(model_id):
    settings = storage.get_settings()
    settings = ensure_settings_api_key(settings)
    models = settings.get("models", [])
    target = next((m for m in models if m.get("id") == model_id), None)
    if not target:
        return jsonify({"error": "Model niet gevonden"}), 404
    settings["models"] = [m for m in models if m.get("id") != model_id]
    if settings.get("selected_model_slug") == target.get("slug"):
        remaining = settings["models"]
        settings["selected_model_slug"] = remaining[0]["slug"] if remaining else None
    storage.save_settings(settings)
    return jsonify({"ok": True})


@app.put("/api/settings/prompts/<prompt_name>")
def api_save_prompt(prompt_name):
    body = request.get_json(force=True)
    content = body.get("content", "")
    storage.write_prompt(prompt_name, content)

    settings = storage.get_settings()
    settings.setdefault("prompts", {})[prompt_name] = content
    storage.save_settings(settings)
    return jsonify({"ok": True})


@app.get("/api/sermons")
def api_list_sermons():
    sermons = sorted(storage.list_sermons(), key=lambda s: s.get("updated_at", ""), reverse=True)
    return jsonify({"sermons": sermons})


@app.post("/api/sermons")
def api_create_sermon():
    body = request.get_json(silent=True) or {}
    sermon = storage.create_sermon(body.get("title") or "Nieuwe preek")
    return jsonify(sermon)


@app.get("/api/sermons/<sermon_id>")
def api_get_sermon(sermon_id):
    sermon = storage.get_sermon(sermon_id)
    if not sermon:
        return jsonify({"error": "Niet gevonden"}), 404
    return jsonify(sermon)


@app.put("/api/sermons/<sermon_id>")
def api_update_sermon(sermon_id):
    body = request.get_json(force=True)
    allowed = {"title", "bible_reference", "bible_text", "content_notes", "sermon_markdown", "sermon_generated", "context_files"}
    updates = {k: v for k, v in body.items() if k in allowed}
    sermon = storage.update_sermon(sermon_id, updates)
    if not sermon:
        return jsonify({"error": "Niet gevonden"}), 404
    return jsonify(sermon)


@app.delete("/api/sermons/<sermon_id>")
def api_delete_sermon(sermon_id):
    deleted = storage.delete_sermon(sermon_id)
    if not deleted:
        return jsonify({"error": "Niet gevonden"}), 404
    return jsonify({"ok": True})


@app.post("/api/jobs")
def api_start_job():
    body = request.get_json(force=True)
    sermon_id = body.get("sermon_id")
    action = body.get("action")
    payload = body.get("payload", {})
    if not sermon_id or not action:
        return jsonify({"error": "sermon_id en action zijn verplicht"}), 400

    sermon = storage.get_sermon(sermon_id)
    if not sermon:
        return jsonify({"error": "Preek niet gevonden"}), 404

    job = {
        "id": str(uuid.uuid4()),
        "sermon_id": sermon_id,
        "action": action,
        "payload": payload,
        "status": "queued",
        "created_at": now_iso(),
        "completed_at": None,
    }
    storage.save_job(job)
    worker_queue.put(job)
    return jsonify({"job_id": job["id"]})


@app.get("/api/jobs/<job_id>")
def api_get_job(job_id):
    job = storage.get_job(job_id)
    if not job:
        return jsonify({"error": "Job niet gevonden"}), 404
    return jsonify(job)


@app.get("/api/jobs/<job_id>/stream")
def api_stream_job(job_id):
    if not storage.get_job(job_id):
        return jsonify({"error": "Job niet gevonden"}), 404

    def event_stream():
        cursor = 0
        try:
            while True:
                pending_event = None
                done = False

                with jobs_state_lock:
                    state = jobs_event_bus.get(job_id)
                    if state is None:
                        done = True
                    else:
                        events = state["events"]
                        done = state["done"]

                        if cursor < len(events):
                            pending_event = events[cursor]
                            cursor += 1

                if pending_event is not None:
                    yield f"data: {json.dumps(pending_event, ensure_ascii=False)}\n\n"
                    continue

                if done:
                    break

                time.sleep(0.15)
        finally:
            with jobs_state_lock:
                state = jobs_event_bus.get(job_id)
                if state and state.get("done"):
                    jobs_event_bus.pop(job_id, None)

    return Response(event_stream(), content_type="text/event-stream; charset=utf-8")


@app.post("/api/sermons/<sermon_id>/export/docx")
def api_export_docx(sermon_id):
    sermon = storage.get_sermon(sermon_id)
    if not sermon:
        return jsonify({"error": "Preek niet gevonden"}), 404

    markdown_text = sermon.get("sermon_markdown", "")
    docx_bytes = markdown_to_docx_bytes(markdown_text)

    from io import BytesIO

    file_buffer = BytesIO(docx_bytes)
    safe_title = bleach.clean((sermon.get("title") or "preek"), strip=True).replace(" ", "_")

    return send_file(
        file_buffer,
        as_attachment=True,
        download_name=f"{safe_title}.docx",
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@app.get("/health")
def healthcheck():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5010, debug=True)
