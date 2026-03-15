import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path


class JsonStorage:
    def __init__(self, root_path: Path, data_root: Path = None):
        self.root_path = Path(root_path)
        _data_root = Path(data_root) if data_root else self.root_path
        self.data_dir = _data_root / "data"
        self.prompts_dir = _data_root / "prompts"
        self.lock = threading.RLock()

        self.settings_file = self.data_dir / "settings.json"
        self.sermons_file = self.data_dir / "sermons.json"
        self.usage_file = self.data_dir / "usage_log.json"
        self.usage_analysis_file = self.data_dir / "usage_analysis.json"
        self.jobs_file = self.data_dir / "jobs.json"

    @staticmethod
    def now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def bootstrap(self, default_prompts: dict, default_models: list, default_selected_model_slug: str):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.prompts_dir.mkdir(parents=True, exist_ok=True)

        with self.lock:
            if not self.settings_file.exists():
                settings = {
                    "selected_model_slug": default_selected_model_slug,
                    "openrouter_api_key": "",
                    "ignored_update_version": "",
                    "models": [
                        {
                            "id": str(uuid.uuid4()),
                            "name": model.get("name"),
                            "slug": model.get("slug"),
                            "pricing_prompt": None,
                            "pricing_completion": None,
                            "pricing_cached": None,
                            "pricing_cached_at": None,
                        }
                        for model in default_models
                    ],
                    "prompts": default_prompts,
                    "updated_at": self.now_iso(),
                }
                self._write_json(self.settings_file, settings)

            if not self.sermons_file.exists():
                self._write_json(self.sermons_file, {"sermons": []})

            if not self.usage_file.exists():
                self._write_json(self.usage_file, {"entries": []})

            if not self.jobs_file.exists():
                self._write_json(self.jobs_file, {"jobs": []})

            if not self.usage_analysis_file.exists():
                self._write_json(
                    self.usage_analysis_file,
                    {
                        "generated_at": None,
                        "total_entries": 0,
                        "action_averages": {},
                        "summary_token_averages": {
                            "sermon_generation": {"count": 0, "avg_prompt_tokens": 0.0, "avg_completion_tokens": 0.0},
                            "chat_non_sermon": {"count": 0, "avg_prompt_tokens": 0.0, "avg_completion_tokens": 0.0},
                        },
                        "model_estimates": {},
                    },
                )

            for prompt_name, content in default_prompts.items():
                prompt_file = self.prompts_dir / f"{prompt_name}.md"
                if not prompt_file.exists():
                    prompt_file.write_text(content, encoding="utf-8")

    def _read_json(self, file_path: Path):
        with file_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _write_json(self, file_path: Path, data):
        tmp_file = file_path.with_suffix(file_path.suffix + ".tmp")
        with tmp_file.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_file, file_path)

    def get_settings(self):
        with self.lock:
            return self._read_json(self.settings_file)

    def save_settings(self, settings):
        with self.lock:
            settings["updated_at"] = self.now_iso()
            self._write_json(self.settings_file, settings)

    def list_sermons(self):
        with self.lock:
            data = self._read_json(self.sermons_file)
            sermons = data.get("sermons", [])
            for sermon in sermons:
                sermon.setdefault("context_files", [])
            return sermons

    def get_sermon(self, sermon_id: str):
        sermons = self.list_sermons()
        for sermon in sermons:
            if sermon["id"] == sermon_id:
                return sermon
        return None

    def create_sermon(self, title: str = "Nieuwe preek"):
        with self.lock:
            data = self._read_json(self.sermons_file)
            sermon = {
                "id": str(uuid.uuid4()),
                "title": title or "Nieuwe preek",
                "bible_reference": "",
                "bible_text": "",
                "content_notes": "",
                "sermon_markdown": "",
                "context_files": [],
                "sermon_generated": False,
                "chat_messages": [],
                "created_at": self.now_iso(),
                "updated_at": self.now_iso(),
                "total_cost_usd": 0.0,
            }
            data["sermons"].append(sermon)
            self._write_json(self.sermons_file, data)
            return sermon

    def update_sermon(self, sermon_id: str, updates: dict):
        with self.lock:
            data = self._read_json(self.sermons_file)
            for sermon in data["sermons"]:
                if sermon["id"] == sermon_id:
                    sermon.update(updates)
                    sermon["updated_at"] = self.now_iso()
                    self._write_json(self.sermons_file, data)
                    return sermon
        return None

    def delete_sermon(self, sermon_id: str) -> bool:
        with self.lock:
            data = self._read_json(self.sermons_file)
            original_len = len(data["sermons"])
            data["sermons"] = [s for s in data["sermons"] if s["id"] != sermon_id]
            self._write_json(self.sermons_file, data)
            return len(data["sermons"]) != original_len

    def append_chat_message(self, sermon_id: str, message: dict):
        with self.lock:
            data = self._read_json(self.sermons_file)
            for sermon in data["sermons"]:
                if sermon["id"] == sermon_id:
                    sermon.setdefault("chat_messages", []).append(message)
                    sermon["updated_at"] = self.now_iso()
                    self._write_json(self.sermons_file, data)
                    return sermon
        return None

    def add_usage_entry(self, entry: dict):
        with self.lock:
            usage = self._read_json(self.usage_file)
            usage.setdefault("entries", []).append(entry)
            self._write_json(self.usage_file, usage)

            sermons = self._read_json(self.sermons_file)
            for sermon in sermons["sermons"]:
                if sermon["id"] == entry.get("sermon_id"):
                    sermon["total_cost_usd"] = round(float(sermon.get("total_cost_usd", 0.0)) + float(entry.get("cost_usd", 0.0)), 8)
                    sermon["updated_at"] = self.now_iso()
                    break
            self._write_json(self.sermons_file, sermons)

    def list_usage_entries(self):
        with self.lock:
            usage = self._read_json(self.usage_file)
            return usage.get("entries", [])

    def get_usage_analysis(self):
        with self.lock:
            return self._read_json(self.usage_analysis_file)

    def save_usage_analysis(self, analysis: dict):
        with self.lock:
            self._write_json(self.usage_analysis_file, analysis)

    def save_job(self, job: dict):
        with self.lock:
            jobs = self._read_json(self.jobs_file)
            existing = None
            for idx, item in enumerate(jobs["jobs"]):
                if item["id"] == job["id"]:
                    existing = idx
                    break
            if existing is None:
                jobs["jobs"].append(job)
            else:
                jobs["jobs"][existing] = job
            self._write_json(self.jobs_file, jobs)

    def get_job(self, job_id: str):
        with self.lock:
            jobs = self._read_json(self.jobs_file)
            for job in jobs.get("jobs", []):
                if job["id"] == job_id:
                    return job
        return None

    def list_prompt_files(self):
        return sorted([p for p in self.prompts_dir.glob("*.md")])

    def read_prompt(self, prompt_name: str):
        path = self.prompts_dir / f"{prompt_name}.md"
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    def write_prompt(self, prompt_name: str, content: str):
        path = self.prompts_dir / f"{prompt_name}.md"
        path.write_text(content, encoding="utf-8")
