import json
import os
import sys
import threading
import urllib.request
import urllib.error
import tempfile
import subprocess
import webview
from utils import shorten_path
from history import HistoryManager
from settings import SettingsManager
from ytdlp_manager import YtdlpManager
from version import APP_VERSION, APP_NAME, GITHUB_REPO


class Api:
    def __init__(self):
        self._history = HistoryManager()
        self._settings = SettingsManager()
        self._ytdlp = YtdlpManager()
        self._window = None
        self._history_timer = None

    def set_window(self, window):
        self._window = window
        self._ytdlp.set_window(window)

    def _js_call(self, js_code):
        if self._window:
            try:
                self._window.evaluate_js(js_code)
            except Exception:
                pass

    # ── Video Info ──

    def fetch_info(self, url):
        """Fetch video metadata and available formats."""
        try:
            info = self._ytdlp.fetch_video_info(url)
            all_formats = info.get('formats', [])
            has_separate = any(f.get('vcodec') != 'none' and f.get('acodec') == 'none' for f in all_formats)

            if has_separate:
                heights = sorted(set(
                    f['height'] for f in all_formats
                    if f.get('vcodec') != 'none' and f.get('height')
                ), reverse=True)
                merged = [
                    {'formatId': f'bestvideo[height<={h}]+bestaudio/best', 'label': f'{h}p', 'height': h, 'ext': 'mp4'}
                    for h in heights
                ]
            else:
                seen = set()
                merged = []
                for f in all_formats:
                    if (f.get('vcodec') != 'none' and f.get('acodec') != 'none'
                            and f.get('height') and f.get('protocol') != 'm3u8_native'):
                        h = f['height']
                        if h not in seen:
                            seen.add(h)
                            merged.append({'formatId': f['format_id'], 'label': f'{h}p', 'height': h, 'ext': f['ext']})
                merged.sort(key=lambda x: x['height'], reverse=True)

            if has_separate:
                merged.insert(0, {'formatId': 'bestvideo+bestaudio/best', 'label': 'Best Quality (merged)', 'height': 9999, 'ext': 'mp4'})
            else:
                merged.insert(0, {'formatId': 'best', 'label': 'Best Quality', 'height': 9999, 'ext': 'mp4'})
            merged.append({'formatId': 'bestaudio/best', 'label': 'Audio Only', 'height': 0, 'ext': 'mp3'})

            return {
                'title': info.get('title', 'Unknown'),
                'thumbnail': info.get('thumbnail', ''),
                'duration': info.get('duration', 0),
                'formats': merged
            }
        except Exception as e:
            raise Exception(str(e) or 'Failed to fetch video info')

    # ── Downloads ──

    def start_download(self, download_id, url, format_id, title, output_dir):
        """Start a yt-dlp download."""
        self._ytdlp.start_download(download_id, url, format_id, title, output_dir, self._window)
        return {'success': True}

    def cancel_download(self, download_id):
        """Cancel a running download."""
        self._ytdlp.cancel_download(download_id)
        return {'success': True}

    # ── Folder Picker ──

    def select_folder(self):
        """Open native folder picker dialog."""
        if not self._window:
            return None
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0:
            return result[0]
        return None

    # ── History ──

    def history_load(self):
        """Load all history entries."""
        return self._history.load()

    def history_save(self, entry):
        """Save/update a history entry."""
        self._history.save_entry(entry)

    def history_delete(self, entry_id):
        """Delete a history entry by id."""
        self._history.delete_entry(entry_id)

    def history_clear(self):
        """Clear all history."""
        self._history.clear()

    # ── File Operations ──

    def delete_file(self, file_path):
        """Delete a file from disk."""
        try:
            if file_path and os.path.isfile(file_path):
                os.remove(file_path)
            return True
        except Exception:
            return False

    # ── Settings ──

    def get_settings(self):
        """Get all settings."""
        return self._settings.get_all()

    def save_settings(self, settings):
        """Update settings."""
        return self._settings.update(settings)

    # ── Clipboard ──

    def clipboard_read(self):
        """Read clipboard text."""
        try:
            import pyperclip
            return pyperclip.paste()
        except Exception:
            return ''

    # ── Version & Update ──

    def get_version(self):
        """Return current app version."""
        return APP_VERSION

    def check_update(self):
        """Check GitHub for newer version. Returns {available, version, download_url, body}."""
        try:
            url = f'https://api.github.com/repos/{GITHUB_REPO}/releases/latest'
            req = urllib.request.Request(url, headers={'User-Agent': f'{APP_NAME}/{APP_VERSION}'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))

            remote_tag = data.get('tag_name', '').lstrip('v')
            if not remote_tag:
                return {'available': False, 'version': APP_VERSION}

            remote_parts = [int(x) for x in remote_tag.split('.')]
            local_parts = [int(x) for x in APP_VERSION.split('.')]

            if remote_parts > local_parts:
                exe_asset = None
                for asset in data.get('assets', []):
                    if asset.get('name', '').endswith('.exe'):
                        exe_asset = asset
                        break
                return {
                    'available': True,
                    'version': remote_tag,
                    'download_url': exe_asset['browser_download_url'] if exe_asset else None,
                    'body': data.get('body', '')
                }
            return {'available': False, 'version': APP_VERSION}
        except Exception as e:
            return {'available': False, 'error': str(e)}

    def download_update(self, download_url):
        """Download new exe, replace current, and restart."""
        try:
            exe_path = sys.executable
            if getattr(sys, 'frozen', False):
                exe_path = sys.executable
            else:
                return {'success': False, 'message': 'Not running as exe'}

            tmp_path = os.path.join(tempfile.gettempdir(), 'YouTubeFetcher_new.exe')
            self._js_call('window._onUpdateProgress("Downloading update...")')

            req = urllib.request.Request(download_url, headers={'User-Agent': f'{APP_NAME}/{APP_VERSION}'})
            with urllib.request.urlopen(req, timeout=120) as resp:
                total = int(resp.headers.get('Content-Length', 0))
                downloaded = 0
                chunk_size = 1024 * 1024
                with open(tmp_path, 'wb') as f:
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            pct = int(downloaded * 100 / total)
                            self._js_call(f'window._onUpdateProgress("Downloading... {pct}%")')

            self._js_call('window._onUpdateProgress("Installing update...")')

            bat_path = os.path.join(tempfile.gettempdir(), 'YouTubeFetcher_update.bat')
            bat_content = f'''@echo off
timeout /t 2 /nobreak >nul
del /f "{exe_path}"
move /y "{tmp_path}" "{exe_path}"
start "" "{exe_path}"
del /f "%~f0"
'''
            with open(bat_path, 'w') as f:
                f.write(bat_content)

            subprocess.Popen([bat_path], shell=True, creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0))
            os._exit(0)
        except Exception as e:
            return {'success': False, 'message': str(e)}
