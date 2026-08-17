import json
import os
import time
import threading
from utils import get_appdata_dir


class HistoryManager:
    def __init__(self):
        self._path = os.path.join(get_appdata_dir(), 'history.json')
        self._timer = None
        self._lock = threading.Lock()
        self._entries = self._load()

    def _load(self):
        try:
            with open(self._path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def _save_to_disk(self):
        with self._lock:
            try:
                with open(self._path, 'w', encoding='utf-8') as f:
                    json.dump(self._entries, f, indent=2, ensure_ascii=False)
            except OSError:
                pass

    def load(self):
        """Return all history entries."""
        return list(self._entries)

    def save_entry(self, entry):
        """Upsert a single history entry."""
        with self._lock:
            entry_id = entry.get('id', '')
            idx = next((i for i, e in enumerate(self._entries) if e.get('id') == entry_id), -1)
            if idx >= 0:
                self._entries[idx] = entry
            else:
                self._entries.insert(0, entry)
        self._schedule_save()

    def delete_entry(self, entry_id):
        """Remove an entry by id."""
        with self._lock:
            self._entries = [e for e in self._entries if e.get('id') != entry_id]
        self._schedule_save()

    def clear(self):
        """Clear all history."""
        with self._lock:
            self._entries = []
        self._schedule_save()

    def _schedule_save(self):
        """Debounce save to disk (2 seconds)."""
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(2.0, self._save_to_disk)
        self._timer.daemon = True
        self._timer.start()
