(function () {
  'use strict';

  // ── State ──
  let nextId = 0;
  let items = [];
  let historyLoaded = false;
  let showHistory = false;
  let showSettings = false;
  let maxConcurrent = 1;
  let savePath = '';
  let historyTimer = null;

  // ── DOM refs ──
  const $ = (s) => document.querySelector(s);
  const urlInput = $('#url-input');
  const fetchBtn = $('#fetch-btn');
  const urlForm = $('#url-form');
  const activeList = $('#active-list');
  const historySection = $('#history-section');
  const historyList = $('#history-list');
  const historyToggle = $('#history-toggle');
  const historyArrow = $('#history-arrow');
  const historyCount = $('#history-count');
  const clearHistoryBtn = $('#clear-history-btn');
  const emptyState = $('#empty-state');
  const activeCountEl = $('#active-count');
  const downloadAllBtn = $('#download-all-btn');
  const readyCountEl = $('#ready-count');
  const settingsBtn = $('#settings-btn');
  const settingsPanel = $('#settings-panel');
  const maxConcurrentInput = $('#max-concurrent');
  const maxConcurrentVal = $('#max-concurrent-val');
  const concurrentHint = $('#concurrent-hint');
  const savePathDisplay = $('#save-path-display');
  const browseBtn = $('#browse-btn');
  const resetPathBtn = $('#reset-path-btn');

  // ── Helpers ──
  function genId() { return 'dl-' + (++nextId); }

  function shortenPath(p) {
    if (!p) return '';
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length <= 3) return p;
    return parts[0] + '/.../' + parts.slice(-2).join('/');
  }

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '...' : str;
  }

  function historyToItem(h) {
    return {
      id: h.id, url: h.url,
      status: h.status || 'ready',
      info: h.title ? { title: h.title, thumbnail: h.thumbnail, duration: h.duration, formats: h.formats } : null,
      selectedFormat: h.selectedFormat, progress: null, error: h.error, filePath: h.filePath
    };
  }

  function itemToHistory(item) {
    return {
      id: item.id, url: item.url,
      title: item.info ? item.info.title : '',
      thumbnail: item.info ? item.info.thumbnail : '',
      duration: item.info ? item.info.duration : 0,
      selectedFormat: item.selectedFormat,
      formats: item.info ? item.info.formats : [],
      status: item.status === 'fetching' ? 'ready' : item.status,
      filePath: item.filePath,
      createdAt: Date.now(),
      error: item.error
    };
  }

  // ── Settings Persistence ──
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('yt-fetcher-settings') || '{}');
      maxConcurrent = s.max_concurrent || 1;
      savePath = s.save_path || '';
    } catch (e) {
      maxConcurrent = 1;
      savePath = '';
    }
    maxConcurrentInput.value = maxConcurrent;
    maxConcurrentVal.textContent = maxConcurrent;
    updateConcurrentHint();
    updateSavePathDisplay();
  }

  function saveSettings() {
    localStorage.setItem('yt-fetcher-settings', JSON.stringify({
      max_concurrent: maxConcurrent, save_path: savePath
    }));
    // Also save to Python backend
    if (window.pywebview) {
      window.pywebview.api.save_settings({ max_concurrent: maxConcurrent, save_path: savePath });
    }
  }

  function updateConcurrentHint() {
    concurrentHint.textContent = maxConcurrent === 1
      ? 'Downloads run one at a time (queued)'
      : 'Up to ' + maxConcurrent + ' downloads run simultaneously';
  }

  function updateSavePathDisplay() {
    savePathDisplay.textContent = savePath ? shortenPath(savePath) : 'Default';
    savePathDisplay.title = savePath || 'Default (Downloads/YouTube Fetcher)';
    resetPathBtn.classList.toggle('hidden', !savePath);
  }

  // ── API Wrappers ──
  async function api(method) {
    if (!window.pywebview) return null;
    try {
      return await window.pywebview.api[method]();
    } catch (e) { return null; }
  }

  async function apiArg(method, ...args) {
    if (!window.pywebview) return null;
    try {
      return await window.pywebview.api[method](...args);
    } catch (e) { throw e; }
  }

  // ── pywebview Event Callbacks ──
  window._onProgress = function (data) {
    const item = items.find(i => i.id === data.downloadId);
    if (item) {
      item.progress = { percent: data.percent, speed: data.speed, eta: data.eta };
      updateRow(item);
    }
  };

  window._onComplete = function (data) {
    const item = items.find(i => i.id === data.downloadId);
    if (item) {
      item.status = 'completed';
      item.progress = null;
      if (data.filePath) item.filePath = data.filePath;
      updateRow(item);
      processQueue();
      scheduleHistorySave();
    }
  };

  window._onError = function (data) {
    const item = items.find(i => i.id === data.downloadId);
    if (item) {
      item.status = 'error';
      item.progress = null;
      item.error = data.message;
      updateRow(item);
      processQueue();
      scheduleHistorySave();
    }
  };

  window._onDestination = function (data) {
    const item = items.find(i => i.id === data.downloadId);
    if (item && data.filePath) {
      item.filePath = data.filePath;
    }
  };

  // ── Queue Processing ──
  function processQueue() {
    const active = items.filter(i => i.status === 'downloading').length;
    if (active >= maxConcurrent) return;
    const readyWaiting = items.filter(i => i.status === 'ready');
    const slots = maxConcurrent - active;
    if (slots <= 0 || readyWaiting.length === 0) return;
    const toStart = readyWaiting.slice(0, slots);
    for (const item of toStart) {
      item.status = 'downloading';
      item.progress = { percent: 0, speed: null, eta: null };
      item.error = null;
      updateRow(item);
      triggerDownload(item.id);
    }
    render();
  }

  // ── Download ──
  async function triggerDownload(id) {
    const item = items.find(i => i.id === id);
    if (!item || !item.info) return;
    try {
      await apiArg('start_download', item.id, item.url, item.selectedFormat, item.info.title, savePath);
    } catch (e) {
      item.status = 'error';
      item.progress = null;
      item.error = e.message || 'Download failed';
      updateRow(item);
      processQueue();
    }
  }

  async function handleFetch(fetchUrl) {
    const id = genId();
    const newItem = {
      id: id, url: fetchUrl, status: 'fetching', info: null,
      selectedFormat: 'best', progress: null, error: null, filePath: null
    };
    items.unshift(newItem);
    urlInput.value = '';
    updateFetchBtn();
    render();
    try {
      const info = await apiArg('fetch_info', fetchUrl);
      newItem.status = 'ready';
      newItem.info = info;
      newItem.selectedFormat = info.formats && info.formats[0] ? info.formats[0].formatId : 'best';
      render();
    } catch (e) {
      newItem.status = 'error';
      newItem.error = e.message || 'Failed to fetch video';
      render();
    }
  }

  // ── History Persistence ──
  function scheduleHistorySave() {
    if (!historyLoaded) return;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      const toSave = items.filter(i => i.status !== 'fetching');
      for (const item of toSave) {
        apiArg('history_save', itemToHistory(item));
      }
    }, 2000);
  }

  // ── Rendering ──
  function createRowHTML(item) {
    const isError = item.status === 'error';
    const isCompleted = item.status === 'completed';
    const isPaused = item.status === 'paused';
    const isFetching = item.status === 'fetching';
    const isDownloading = item.status === 'downloading';
    const isReady = item.status === 'ready';

    let statusClass = '';
    if (isError) statusClass = 'status-error';
    else if (isCompleted) statusClass = 'status-completed';
    else if (isPaused) statusClass = 'status-paused';

    let html = '<div class="dl-row ' + statusClass + '" data-id="' + item.id + '">';
    html += '<div class="dl-row-inner">';

    // Thumbnail
    if (item.info && item.info.thumbnail) {
      html += '<img class="dl-thumb" src="' + esc(item.info.thumbnail) + '" alt="">';
    } else {
      html += '<div class="dl-thumb-placeholder">';
      if (isFetching) html += '<div class="spinner"></div>';
      html += '</div>';
    }

    // Info
    html += '<div class="dl-info">';
    if (item.info) {
      html += '<div class="dl-title-row">';
      html += '<span class="yt-badge">YT</span>';
      html += '<span class="dl-title" title="' + esc(item.info.title) + '">' + esc(item.info.title) + '</span>';
      if (item.info.duration > 0) html += '<span class="dl-duration">' + formatDuration(item.info.duration) + '</span>';
      html += '</div>';
    } else {
      html += '<div class="dl-title-row">';
      html += '<span class="yt-badge">YT</span>';
      html += '<span class="dl-url">' + esc(truncate(item.url, 60)) + '</span>';
      html += '</div>';
    }
    html += '</div>';

    // Format selector
    if ((isReady || isPaused) && item.info) {
      html += '<select class="dl-format" data-action="select-format">';
      for (const f of item.info.formats) {
        html += '<option value="' + esc(f.formatId) + '"' + (f.formatId === item.selectedFormat ? ' selected' : '') + '>' + esc(f.label) + '</option>';
      }
      html += '</select>';
    }

    // Action buttons
    html += '<div class="dl-actions">';
    if (isReady) {
      html += '<button class="btn-green" data-action="download">Download</button>';
    }
    if (isPaused) {
      html += '<button class="btn-blue" data-action="resume">Resume</button>';
    }
    if (isDownloading && item.progress) {
      html += '<div class="dl-progress-wrap"><div class="dl-progress">';
      html += '<div class="dl-progress-header"><span>' + item.progress.percent.toFixed(1) + '%</span>';
      html += '<span class="dl-progress-speed">' + esc(item.progress.speed || '') + '</span></div>';
      html += '<div class="dl-progress-bar"><div class="dl-progress-fill" style="width:' + Math.min(item.progress.percent, 100) + '%"></div></div>';
      html += '</div>';
      html += '<button class="btn-pause" data-action="cancel" title="Pause download">Pause</button>';
      html += '</div>';
    }
    if (isCompleted) {
      html += '<span class="dl-done">Done</span>';
    }
    if (isError) {
      html += '<span class="dl-error" title="' + esc(item.error || '') + '">' + esc(item.error || '') + '</span>';
    }
    if ((isCompleted || isError) && item.filePath) {
      html += '<button class="icon-btn green-hover" data-action="delete-file" title="Delete file from disk">';
      html += '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
      html += '</button>';
    }
    if ((isCompleted || isError)) {
      html += '<button class="icon-btn" data-action="dismiss" title="Remove from list">&times;</button>';
    }
    if (isReady || isPaused) {
      html += '<button class="icon-btn" data-action="dismiss" title="Remove from queue">&times;</button>';
    }
    html += '</div>';

    html += '</div></div>';
    return html;
  }

  function render() {
    const activeItems = items.filter(i => ['fetching', 'ready', 'downloading', 'paused'].includes(i.status));
    const doneItems = items.filter(i => ['completed', 'error'].includes(i.status));
    const readyCount = activeItems.filter(i => i.status === 'ready').length;
    const activeCount = items.filter(i => i.status === 'downloading').length;

    // Active list
    activeList.innerHTML = activeItems.map(createRowHTML).join('');

    // History
    if (doneItems.length > 0) {
      historySection.classList.remove('hidden');
      historyCount.textContent = doneItems.length;
      historyList.innerHTML = doneItems.map(createRowHTML).join('');
      if (!showHistory) historyList.classList.add('hidden');
    } else {
      historySection.classList.add('hidden');
      historyList.classList.add('hidden');
    }

    // Empty state
    emptyState.classList.toggle('hidden', items.length !== 0 || !historyLoaded);

    // Header
    activeCountEl.classList.toggle('hidden', activeCount === 0);
    activeCountEl.textContent = activeCount + '/' + maxConcurrent + ' downloading';
    downloadAllBtn.classList.toggle('hidden', readyCount < 1);
    readyCountEl.textContent = readyCount;

    updateFetchBtn();
  }

  function updateRow(item) {
    // Update single row in place for progress updates (performance)
    const row = activeList.querySelector('[data-id="' + item.id + '"]');
    if (row) {
      row.outerHTML = createRowHTML(item);
    } else {
      const hRow = historyList.querySelector('[data-id="' + item.id + '"]');
      if (hRow) hRow.outerHTML = createRowHTML(item);
    }
    // Update header counters
    const activeCount = items.filter(i => i.status === 'downloading').length;
    const readyCount = items.filter(i => i.status === 'ready').length;
    activeCountEl.classList.toggle('hidden', activeCount === 0);
    activeCountEl.textContent = activeCount + '/' + maxConcurrent + ' downloading';
    downloadAllBtn.classList.toggle('hidden', readyCount < 1);
    readyCountEl.textContent = readyCount;
  }

  function updateFetchBtn() {
    fetchBtn.disabled = !urlInput.value.trim();
  }

  // ── Event Listeners ──
  urlInput.addEventListener('input', updateFetchBtn);

  urlForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (url) handleFetch(url);
  });

  urlInput.addEventListener('focus', async function () {
    try {
      const text = await apiArg('clipboard_read');
      if (text && text.trim() && !urlInput.value) {
        urlInput.value = text.trim();
        updateFetchBtn();
      }
    } catch (e) { /* ignore */ }
  });

  // Delegated click handlers for download rows
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.dl-row');
    if (!row) return;
    const id = row.dataset.id;
    const item = items.find(i => i.id === id);
    if (!item) return;

    const action = btn.dataset.action;
    if (action === 'download') {
      item.status = 'downloading';
      item.progress = { percent: 0, speed: null, eta: null };
      item.error = null;
      updateRow(item);
      triggerDownload(id);
    } else if (action === 'cancel') {
      apiArg('cancel_download', id);
      item.status = 'paused';
      item.progress = null;
      updateRow(item);
      processQueue();
      scheduleHistorySave();
    } else if (action === 'resume') {
      item.status = 'downloading';
      item.progress = { percent: 0, speed: null, eta: null };
      item.error = null;
      updateRow(item);
      triggerDownload(id);
    } else if (action === 'dismiss') {
      items = items.filter(i => i.id !== id);
      apiArg('history_delete', id);
      render();
    } else if (action === 'delete-file') {
      if (item.filePath) apiArg('delete_file', item.filePath);
      items = items.filter(i => i.id !== id);
      apiArg('history_delete', id);
      render();
    }
  });

  // Format change
  document.addEventListener('change', function (e) {
    if (e.target.dataset.action === 'select-format') {
      const row = e.target.closest('.dl-row');
      if (!row) return;
      const item = items.find(i => i.id === row.dataset.id);
      if (item) {
        item.selectedFormat = e.target.value;
        scheduleHistorySave();
      }
    }
  });

  // Settings toggle
  settingsBtn.addEventListener('click', function () {
    showSettings = !showSettings;
    settingsPanel.classList.toggle('hidden', !showSettings);
  });

  document.addEventListener('mousedown', function (e) {
    if (showSettings && !e.target.closest('[data-settings]')) {
      showSettings = false;
      settingsPanel.classList.add('hidden');
    }
  });

  // Max concurrent
  maxConcurrentInput.addEventListener('input', function () {
    maxConcurrent = parseInt(this.value, 10);
    maxConcurrentVal.textContent = maxConcurrent;
    updateConcurrentHint();
    saveSettings();
    processQueue();
  });

  // Browse folder
  browseBtn.addEventListener('click', async function () {
    const folder = await apiArg('select_folder');
    if (folder) {
      savePath = folder;
      updateSavePathDisplay();
      saveSettings();
    }
  });

  // Reset path
  resetPathBtn.addEventListener('click', function () {
    savePath = '';
    updateSavePathDisplay();
    saveSettings();
  });

  // History toggle
  historyToggle.addEventListener('click', function (e) {
    if (e.target.closest('#clear-history-btn')) return;
    showHistory = !showHistory;
    historyArrow.classList.toggle('open', showHistory);
    historyList.classList.toggle('hidden', !showHistory);
  });

  // Clear history
  clearHistoryBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    items = items.filter(i => !['completed', 'error'].includes(i.status));
    apiArg('history_clear');
    render();
  });

  // Download All
  downloadAllBtn.addEventListener('click', function () {
    processQueue();
  });

  // ── Init ──
  async function init() {
    loadSettings();

    // Set version badge
    const versionBadge = $('#version-badge');
    try {
      const ver = await apiArg('get_version');
      if (ver) versionBadge.textContent = 'v' + ver;
    } catch (e) { /* ignore */ }

    // Check for updates
    checkForUpdate();

    // Load history from Python backend
    try {
      const entries = await apiArg('history_load');
      if (entries && Array.isArray(entries)) {
        items = entries.map(historyToItem);
      }
    } catch (e) { /* ignore */ }
    historyLoaded = true;
    render();
  }

  // ── Update Feature ──
  async function checkForUpdate() {
    const updateBtn = $('#update-btn');
    const updateProgress = $('#update-progress');
    try {
      const result = await apiArg('check_update');
      if (result && result.available) {
        updateBtn.classList.remove('hidden');
        updateBtn.title = 'Update to v' + result.version;
        updateBtn.dataset.version = result.version;
        updateBtn.dataset.url = result.download_url;
      }
    } catch (e) { /* ignore */ }
  }

  const updateBtn = $('#update-btn');
  const updateProgress = $('#update-progress');

  updateBtn.addEventListener('click', async function () {
    const url = this.dataset.url;
    if (!url) return;
    this.classList.add('hidden');
    updateProgress.classList.remove('hidden');
    updateProgress.textContent = 'Starting update...';
    try {
      await apiArg('download_update', url);
    } catch (e) {
      updateProgress.textContent = 'Update failed: ' + (e.message || 'Unknown error');
    }
  });

  window._onUpdateProgress = function (msg) {
    updateProgress.textContent = msg;
  };

  // Wait for pywebview to be ready
  if (window.pywebview) {
    init();
  } else {
    window.addEventListener('pywebviewready', init);
  }
})();
