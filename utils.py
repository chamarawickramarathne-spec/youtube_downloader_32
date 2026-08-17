import re
import os
import sys
import json


def get_app_dir():
    """Get app data directory for settings/history."""
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return base


def get_appdata_dir():
    """Get per-user appdata directory."""
    appdata = os.environ.get('APPDATA', os.path.expanduser('~'))
    d = os.path.join(appdata, 'YouTube Fetcher')
    os.makedirs(d, exist_ok=True)
    return d


def get_resource_path(filename):
    """Resolve bundled resource path (dev vs PyInstaller)."""
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'resources', filename)


def get_ytdlp_path():
    """Resolve yt-dlp executable path."""
    path = get_resource_path('yt-dlp.exe')
    if os.path.isfile(path):
        return path
    return 'yt-dlp'


def get_ffmpeg_dir():
    """Resolve ffmpeg directory."""
    if getattr(sys, 'frozen', False):
        d = os.path.join(sys._MEIPASS, 'resources')
    else:
        d = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resources')
    if os.path.isfile(os.path.join(d, 'ffmpeg.exe')):
        return d
    return ''


def get_web_dir():
    """Resolve web/ directory for frontend files."""
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, 'web')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')


def sanitize_filename(name):
    """Replace invalid filename characters."""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def get_unique_filename(directory, base_name):
    """Find a unique filename by appending (2), (3), etc. if needed."""
    exts = ['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'ogg', 'wav', 'opus']
    candidate = base_name
    counter = 1
    try:
        existing = os.listdir(directory) if os.path.isdir(directory) else []
    except OSError:
        return base_name
    while True:
        has_conflict = any(
            f.lower() == f'{candidate}.{ext}'
            for f in existing
            for ext in exts
        )
        if not has_conflict:
            break
        counter += 1
        candidate = f'{base_name} ({counter})'
    return candidate


def shorten_path(p):
    """Shorten path for display: C:/.../subdir/file.ext."""
    if not p:
        return ''
    parts = p.replace('\\', '/').split('/')
    if len(parts) <= 3:
        return p
    return parts[0] + '/.../' + '/'.join(parts[-2:])
