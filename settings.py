import json
import os
import threading
from utils import get_appdata_dir


class SettingsManager:
    DEFAULTS = {
        'max_concurrent': 1,
        'save_path': ''
    }

    def __init__(self):
        self._path = os.path.join(get_appdata_dir(), 'settings.json')
        self._lock = threading.Lock()
        self._data = self._load()

    def _load(self):
        try:
            with open(self._path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                merged = dict(self.DEFAULTS)
                merged.update(data)
                return merged
        except (FileNotFoundError, json.JSONDecodeError):
            return dict(self.DEFAULTS)

    def _save_to_disk(self):
        with self._lock:
            try:
                with open(self._path, 'w', encoding='utf-8') as f:
                    json.dump(self._data, f, indent=2, ensure_ascii=False)
            except OSError:
                pass

    def get_all(self):
        """Return all settings."""
        with self._lock:
            return dict(self._data)

    def update(self, settings):
        """Update settings and save."""
        with self._lock:
            for k, v in settings.items():
                if k in self.DEFAULTS:
                    self._data[k] = v
        self._save_to_disk()
        return dict(self._data)
