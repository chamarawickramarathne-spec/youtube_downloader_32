import json
import os
import re
import subprocess
import threading
import time
from utils import get_ytdlp_path, get_ffmpeg_dir, sanitize_filename, get_unique_filename

COOKIE_BROWSERS = ['edge', 'chrome', 'brave', 'vivaldi', 'firefox']
FETCH_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 600
MAX_RETRIES = 2
RETRY_DELAY = 3

EXTRACTOR_BYPASS = [
    {'label': 'web+mweb', 'args': ['--extractor-args', 'youtube:player_client=web,mweb']},
    {'label': 'android', 'args': ['--extractor-args', 'youtube:player_client=android']},
    {'label': 'ios', 'args': ['--extractor-args', 'youtube:player_client=ios']},
    {'label': 'tv', 'args': ['--extractor-args', 'youtube:player_client=tv']},
]


class YtdlpManager:
    def __init__(self):
        self._ytdlp = get_ytdlp_path()
        self._ffmpeg = get_ffmpeg_dir()
        self._working_browser = None
        self._working_extractor_args = None
        self._processes = {}
        self._lock = threading.Lock()
        self._window = None

    def set_window(self, window):
        self._window = window

    def _js_call(self, js_code):
        """Call JavaScript from Python (non-blocking)."""
        if self._window:
            try:
                self._window.evaluate_js(js_code)
            except Exception:
                pass

    def _emit_progress(self, download_id, percent, speed, eta):
        data = json.dumps({'downloadId': download_id, 'percent': percent, 'speed': speed, 'eta': eta})
        self._js_call(f'window._onProgress({data})')

    def _emit_complete(self, download_id, file_path=''):
        data = json.dumps({'downloadId': download_id, 'filePath': file_path})
        self._js_call(f'window._onComplete({data})')

    def _emit_error(self, download_id, message):
        data = json.dumps({'downloadId': download_id, 'message': message})
        self._js_call(f'window._onError({data})')

    def _emit_destination(self, download_id, file_path):
        data = json.dumps({'downloadId': download_id, 'filePath': file_path})
        self._js_call(f'window._onDestination({data})')

    def _emit_log(self, download_id, message):
        data = json.dumps({'downloadId': download_id, 'message': message})
        self._js_call(f'window._onLog({data})')

    def _run_once(self, url, extra_args=None):
        """Run yt-dlp once for metadata fetch. Returns (success, data, error)."""
        args = [
            '--dump-single-json', '--no-download', '--no-warnings',
            '--no-check-certificates', '--no-playlist',
        ]
        if extra_args:
            args.extend(extra_args)
        args.append(url)

        try:
            proc = subprocess.Popen(
                [self._ytdlp] + args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            stdout, stderr = proc.communicate(timeout=FETCH_TIMEOUT)
            stdout = stdout.decode('utf-8', errors='replace')
            stderr = stderr.decode('utf-8', errors='replace')
            combined = (stdout + '\n' + stderr).strip()

            if proc.returncode != 0:
                return (False, None, combined or f'exit code {proc.returncode}')

            try:
                return (True, json.loads(stdout), None)
            except json.JSONDecodeError:
                return (False, None, combined or 'Failed to parse yt-dlp JSON')
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            return (False, None, 'Fetch timed out after 30 seconds')
        except FileNotFoundError:
            return (False, None, 'yt-dlp.exe not found')
        except Exception as e:
            return (False, None, str(e))

    @staticmethod
    def _is_bot_detection(error):
        if not error:
            return False
        return 'Sign in to confirm' in error or 'bot' in error.lower()

    @staticmethod
    def _is_cookie_error(error):
        if not error:
            return False
        return any(kw in error for kw in ['DPAPI', 'decrypt', 'Could not copy', 'could not find'])

    @staticmethod
    def _parse_error(stderr_lines):
        """Extract the most useful error message from yt-dlp stderr."""
        if not stderr_lines:
            return None
        for line in reversed(stderr_lines):
            if 'ERROR:' in line:
                msg = line.split('ERROR:', 1)[1].strip()
                if msg:
                    return msg
        for line in reversed(stderr_lines):
            if any(kw in line.lower() for kw in ['error', 'failed', 'unable', 'cannot']):
                return line
        return stderr_lines[-1] if stderr_lines else None

    @staticmethod
    def _is_retriable(error_msg):
        """Check if an error is worth retrying."""
        if not error_msg:
            return True
        non_retriable = [
            'Sign in to confirm', 'bot', 'login', 'private video',
            'Video unavailable', 'This video is not available',
            'Premiere will begin', 'is live streaming',
            'Unsupported URL', 'is not a valid URL',
            'No video found', 'File already downloaded',
        ]
        return not any(kw in error_msg for kw in non_retriable)

    def fetch_video_info(self, url):
        """Fetch video metadata with multi-strategy approach."""
        self._working_extractor_args = None

        # 1. Try cached browser
        if self._working_browser:
            ok, data, err = self._run_once(url, ['--cookies-from-browser', self._working_browser])
            if ok:
                return data
            self._working_browser = None

        # 2. No cookies
        ok, data, err = self._run_once(url)
        if ok:
            self._working_browser = ''
            return data

        is_bot = self._is_bot_detection(err)

        # 3. Extractor-args bypass
        for attempt in EXTRACTOR_BYPASS:
            if is_bot or True:
                ok, data, _ = self._run_once(url, attempt['args'])
                if ok:
                    self._working_browser = ''
                    self._working_extractor_args = attempt['args']
                    return data

        # 4. Parallel browser cookie probing
        results = [None] * len(COOKIE_BROWSERS)
        threads = []
        for i, browser in enumerate(COOKIE_BROWSERS):
            def probe(idx=i, br=browser):
                results[idx] = self._run_once(url, ['--cookies-from-browser', br])
            t = threading.Thread(target=probe)
            threads.append(t)
            t.start()
        for t in threads:
            t.join(timeout=FETCH_TIMEOUT + 5)

        for i, browser in enumerate(COOKIE_BROWSERS):
            if results[i] and results[i][0]:
                self._working_browser = browser
                return results[i][1]

        # 5. All failed
        if is_bot:
            raise Exception('Bot detected. Log into YouTube in a browser and try again, or the video may be restricted.')
        raise Exception(err or 'yt-dlp failed to fetch video info')

    def start_download(self, download_id, url, format_id, title, output_dir, window=None):
        """Start a download in a background thread."""
        if window:
            self._window = window
        t = threading.Thread(target=self._execute_download, args=(download_id, url, format_id, title, output_dir, 0, 0))
        t.daemon = True
        t.start()

    def cancel_download(self, download_id):
        """Kill a running download."""
        with self._lock:
            proc = self._processes.pop(download_id, None)
        if proc:
            try:
                proc.kill()
            except Exception:
                pass
            self._emit_error(download_id, 'Cancelled')

    def _execute_download(self, download_id, url, format_id, title, output_dir, attempt, extractor_idx=0):
        downloads_dir = output_dir or os.path.join(os.path.expanduser('~'), 'Downloads', 'YouTube Fetcher')
        os.makedirs(downloads_dir, exist_ok=True)

        args = []
        if format_id == 'bestaudio/best':
            args.extend(['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3'])
        elif format_id == 'best' or '+' in format_id:
            args.extend(['-f', format_id if '+' in format_id else 'bestvideo+bestaudio/best'])
            args.extend(['--merge-output-format', 'mp4'])
        else:
            h = format_id.replace('p', '')
            if h.isdigit():
                args.extend(['-f', f'bestvideo[height<={h}]+bestaudio/best/bestvideo+bestaudio/best'])
            else:
                args.extend(['-f', f'{format_id}+bestaudio/best/{format_id}/best'])
            args.extend(['--merge-output-format', 'mp4'])

        # Quality label for filename
        if format_id == 'bestaudio/best':
            quality_label = 'audio'
        else:
            h_match = re.search(r'height<=(\d+)', format_id)
            quality_label = f'{h_match.group(1)}p' if h_match else ('best' if format_id == 'best' else format_id)

        base_name = sanitize_filename(f'{title} [{quality_label}]')
        unique_name = get_unique_filename(downloads_dir, base_name)
        out_path = os.path.join(downloads_dir, f'{unique_name}.%(ext)s')

        args.extend([
            '-o', out_path,
            '--newline', '--progress', '--no-warnings', '--no-check-certificates',
            '--no-overwrites', '--no-playlist',
            '--concurrent-fragments', '8',
            '--socket-timeout', '30',
            '--http-chunk-size', '10485760',
        ])

        if self._ffmpeg:
            args.extend(['--ffmpeg-location', self._ffmpeg])
        else:
            self._emit_log(download_id, 'Warning: ffmpeg not found, video+audio merge may fail')

        if self._working_browser:
            args.extend(['--cookies-from-browser', self._working_browser])
        elif extractor_idx < len(EXTRACTOR_BYPASS):
            args.extend(EXTRACTOR_BYPASS[extractor_idx]['args'])
        else:
            args.extend(['--extractor-args', 'youtube:player_client=web,mweb'])

        args.append(url)

        try:
            proc = subprocess.Popen(
                [self._ytdlp] + args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            with self._lock:
                self._processes[download_id] = proc
        except Exception as e:
            self._emit_error(download_id, f'Failed to start yt-dlp: {e}')
            return

        tracked_path = ''
        start_time = time.time()
        stderr_output = []

        def read_stdout():
            nonlocal tracked_path
            try:
                for line in iter(proc.stdout.readline, ''):
                    if not line:
                        break
                    line = line.decode('utf-8', errors='replace')
                    # Progress
                    m = re.search(r'(\d+\.?\d*)%', line)
                    if m:
                        speed_m = re.search(r'at\s+([\d.]+\w+/s)', line)
                        eta_m = re.search(r'ETA\s+(\S+)', line)
                        self._emit_progress(download_id, float(m.group(1)), speed_m.group(1) if speed_m else None, eta_m.group(1) if eta_m else None)
                    # Destination
                    dest_m = re.search(r'\[download\]\s+Destination:\s+(.+)', line)
                    if dest_m:
                        tracked_path = dest_m.group(1).strip()
                        self._emit_destination(download_id, tracked_path)
                    # Merge
                    merge_m = re.search(r'\[Merger\]\s+Merging formats into\s+"(.+)"', line)
                    if merge_m:
                        tracked_path = merge_m.group(1).strip()
                        self._emit_destination(download_id, tracked_path)
            except Exception:
                pass

        def read_stderr():
            try:
                for line in iter(proc.stderr.readline, ''):
                    if not line:
                        break
                    line = line.decode('utf-8', errors='replace').strip()
                    if line:
                        stderr_output.append(line)
                    if any(kw in line for kw in ['ERROR', 'error', 'Merge', 'ffmpeg']):
                        self._emit_log(download_id, line)
            except Exception:
                pass

        stdout_thread = threading.Thread(target=read_stdout, daemon=True)
        stderr_thread = threading.Thread(target=read_stderr, daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        # Timeout check
        while proc.poll() is None:
            elapsed = time.time() - start_time
            if elapsed > DOWNLOAD_TIMEOUT:
                proc.kill()
                with self._lock:
                    self._processes.pop(download_id, None)
                self._emit_error(download_id, 'Download timed out after 10 minutes')
                return
            time.sleep(0.5)

        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)

        with self._lock:
            self._processes.pop(download_id, None)

        if proc.returncode == 0:
            self._emit_complete(download_id, tracked_path)
        else:
            error_detail = self._parse_error(stderr_output)
            is_format_error = error_detail and ('format is not available' in error_detail.lower() or 'no video' in error_detail.lower() or '403' in error_detail)

            if is_format_error and extractor_idx < len(EXTRACTOR_BYPASS) - 1:
                next_idx = extractor_idx + 1
                self._emit_log(download_id, f'Trying alternate client: {EXTRACTOR_BYPASS[next_idx]["label"]}...')
                time.sleep(1)
                self._execute_download(download_id, url, format_id, title, output_dir, 0, next_idx)
            elif attempt < MAX_RETRIES:
                if error_detail and not self._is_retriable(error_detail):
                    self._emit_error(download_id, error_detail)
                    return
                self._emit_log(download_id, f'Retrying... (attempt {attempt + 2}/{MAX_RETRIES + 1})')
                time.sleep(RETRY_DELAY)
                self._execute_download(download_id, url, format_id, title, output_dir, attempt + 1, extractor_idx)
            else:
                self._emit_error(download_id, error_detail or f'yt-dlp exited with code {proc.returncode}')
