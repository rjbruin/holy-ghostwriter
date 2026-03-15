import json
from pathlib import Path
from typing import Dict, Generator, Optional
from urllib.parse import quote

import requests


class OpenRouterClient:
    def __init__(self, root_path: Path):
        self.root_path = Path(root_path)
        self.base_url = "https://openrouter.ai/api/v1"
        self.api_key = self._load_api_key()

    def _load_api_key(self) -> str:
        key_file = self.root_path / "api_key.txt"
        if not key_file.exists():
            return ""
        key = key_file.read_text(encoding="utf-8").strip()
        return key

    def set_api_key(self, key: str):
        self.api_key = (key or "").strip()

    def _headers(self):
        if not self.api_key:
            raise RuntimeError("OpenRouter API key ontbreekt. Stel eerst een API key in via Instellingen.")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5010",
            "X-Title": "Holy Ghostwriter",
        }

    def fetch_models(self):
        response = requests.get(f"{self.base_url}/models", headers=self._headers(), timeout=30)
        response.raise_for_status()
        return response.json()

    def fetch_pricing_map(self) -> Dict[str, dict]:
        data = self.fetch_models()
        mapping = {}
        for item in data.get("data", []):
            slug = item.get("id")
            if not slug:
                continue
            pricing = item.get("pricing", {})
            mapping[slug] = {
                "prompt": pricing.get("prompt"),
                "completion": pricing.get("completion"),
                "cached": pricing.get("image") or pricing.get("request") or pricing.get("web_search"),
            }
        return mapping

    @staticmethod
    def _detect_supported_input_types(model_item: dict) -> Dict[str, bool]:
        architecture = model_item.get("architecture") or {}
        modality = str(architecture.get("modality") or "").lower()

        values = []
        for key in ("input_modalities", "modalities", "supported_input_types"):
            raw = architecture.get(key) or model_item.get(key)
            if isinstance(raw, list):
                values.extend([str(v).lower() for v in raw])
            elif isinstance(raw, str):
                values.append(raw.lower())

        if modality:
            values.append(modality)

        flattened = " ".join(values)
        supports_image = any(token in flattened for token in ["image", "vision"])
        supports_pdf = any(token in flattened for token in ["pdf", "file", "document"])

        return {
            "text": True,
            "image": supports_image,
            "pdf": supports_pdf,
        }

    def fetch_model_capabilities_map(self) -> Dict[str, dict]:
        data = self.fetch_models()
        mapping = {}
        for item in data.get("data", []):
            slug = item.get("id")
            if not slug:
                continue
            mapping[slug] = self._detect_supported_input_types(item)
        return mapping

    def fetch_model_endpoints_pricing(self, model_slug: str) -> Optional[dict]:
        if not model_slug or "/" not in model_slug:
            return None

        author, slug = model_slug.split("/", 1)
        encoded_author = quote(author, safe="")
        encoded_slug = quote(slug, safe="")

        response = requests.get(
            f"{self.base_url}/models/{encoded_author}/{encoded_slug}/endpoints",
            headers=self._headers(),
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        endpoints = ((data or {}).get("data") or {}).get("endpoints") or []
        if not endpoints:
            return None

        chosen = None
        for endpoint in endpoints:
            pricing = endpoint.get("pricing") or {}
            if pricing.get("prompt") is not None or pricing.get("completion") is not None:
                chosen = pricing
                break

        if chosen is None:
            chosen = (endpoints[0].get("pricing") or {})

        return {
            "prompt": chosen.get("prompt"),
            "completion": chosen.get("completion"),
            "cached": chosen.get("input_cache_read") or chosen.get("request") or chosen.get("image"),
        }

    def stream_chat(
        self,
        *,
        model_slug: str,
        messages: list,
        response_schema: dict,
        attachments: Optional[list] = None,
        temperature: float = 0.4,
    ) -> Generator[dict, None, None]:
        effective_messages = list(messages)
        if attachments:
            final_message = dict(effective_messages[-1])
            text_content = str(final_message.get("content") or "")
            final_message["content"] = [{"type": "text", "text": text_content}, *attachments]
            effective_messages[-1] = final_message

        payload = {
            "model": model_slug,
            "messages": effective_messages,
            "temperature": temperature,
            "stream": True,
            "stream_options": {"include_usage": True},
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "holy_ghostwriter_response",
                    "strict": True,
                    "schema": response_schema,
                },
            },
        }

        with requests.post(
            f"{self.base_url}/chat/completions",
            headers=self._headers(),
            json=payload,
            stream=True,
            timeout=240,
        ) as response:
            response.raise_for_status()
            response.encoding = "utf-8"
            for raw_line in response.iter_lines(decode_unicode=True):
                if not raw_line:
                    continue
                if not raw_line.startswith("data:"):
                    continue
                data_line = raw_line.removeprefix("data:").strip()
                if data_line == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_line)
                except json.JSONDecodeError:
                    continue

                usage = chunk.get("usage")
                if usage:
                    yield {"type": "usage", "usage": usage}

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {})
                content = delta.get("content")
                if content:
                    yield {"type": "delta", "content": content}

    @staticmethod
    def parse_structured_response(raw_text: str) -> Optional[dict]:
        raw_text = (raw_text or "").strip()
        if not raw_text:
            return None
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError:
            start = raw_text.find("{")
            end = raw_text.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(raw_text[start : end + 1])
                except json.JSONDecodeError:
                    return None
            return None
