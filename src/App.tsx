import { useState, useEffect, useCallback, useRef } from 'react'
import DownloadRow from './components/DownloadRow'
import type { DownloadItem, VideoInfo, HistoryEntry } from './types'

let nextId = 0
function genId() { return `dl-${++nextId}` }

const STORAGE_KEY_MAX_CONCURRENT = 'yt-fetcher-max-concurrent'
const STORAGE_KEY_SAVE_PATH = 'yt-fetcher-save-path'

function historyToItem(h: HistoryEntry): DownloadItem {
  return {
    id: h.id,
    url: h.url,
    status: h.status as any,
    info: h.title ? { title: h.title, thumbnail: h.thumbnail, duration: h.duration, formats: h.formats } : null,
    selectedFormat: h.selectedFormat,
    progress: null,
    error: h.error,
    filePath: h.filePath
  }
}

function itemToHistory(item: DownloadItem): HistoryEntry {
  return {
    id: item.id,
    url: item.url,
    title: item.info?.title || '',
    thumbnail: item.info?.thumbnail || '',
    duration: item.info?.duration || 0,
    selectedFormat: item.selectedFormat,
    formats: item.info?.formats || [],
    status: (item.status === 'fetching' ? 'ready' : item.status) as any,
    filePath: item.filePath,
    createdAt: Date.now(),
    error: item.error
  }
}

function shortenPath(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return p
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

export default function App() {
  const [url, setUrl] = useState('')
  const [items, setItems] = useState<DownloadItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [maxConcurrent, setMaxConcurrent] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_MAX_CONCURRENT)
    return saved ? parseInt(saved, 10) || 1 : 1
  })
  const [savePath, setSavePath] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_SAVE_PATH) || ''
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  const maxConcurrentRef = useRef(maxConcurrent)
  const savePathRef = useRef(savePath)

  itemsRef.current = items
  maxConcurrentRef.current = maxConcurrent
  savePathRef.current = savePath

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_MAX_CONCURRENT, String(maxConcurrent))
  }, [maxConcurrent])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SAVE_PATH, savePath)
  }, [savePath])

  useEffect(() => {
    if (!showSettings) return
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-settings]')) {
        setShowSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSettings])

  useEffect(() => {
    window.api.historyLoad().then((entries) => {
      setItems(entries.map(historyToItem))
      setHistoryLoaded(true)
    })
  }, [])

  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemsRefForHistory = useRef(items)

  useEffect(() => {
    itemsRefForHistory.current = items
  }, [items])

  useEffect(() => {
    if (!historyLoaded) return
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      const toSave = itemsRefForHistory.current.filter((i) => i.status !== 'fetching')
      for (const item of toSave) {
        window.api.historySave(itemToHistory(item))
      }
    }, 2000)
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    }
  }, [items, historyLoaded])

  const triggerDownloadRef = useRef<(id: string) => void>(() => {})

  const triggerDownload = useCallback(async (id: string) => {
    const item = itemsRef.current.find((i) => i.id === id)
    if (!item || !item.info) return
    setItems((prev) => prev.map((i) =>
      i.id === id ? { ...i, status: 'downloading', progress: { percent: 0, speed: null, eta: null }, error: null } : i
    ))
    try {
      await window.api.startDownload(item.id, item.url, item.selectedFormat, item.info.title, savePathRef.current)
    } catch (e: any) {
      setItems((prev) => {
        const updated = prev.map((i) =>
          i.id === id ? { ...i, status: 'error', progress: null, error: e.message || 'Download failed' } : i
        )
        return processQueue(updated)
      })
    }
  }, [])

  triggerDownloadRef.current = triggerDownload

  const processQueue = useCallback((currentItems: DownloadItem[]) => {
    const active = currentItems.filter((i) => i.status === 'downloading').length
    const max = maxConcurrentRef.current
    if (active >= max) return currentItems
    const readyWaiting = currentItems.filter((i) => i.status === 'ready')
    const slotsAvailable = max - active
    if (slotsAvailable <= 0 || readyWaiting.length === 0) return currentItems

    const newItems = [...currentItems]
    const toStart = readyWaiting.slice(0, slotsAvailable)
    for (const item of toStart) {
      const idx = newItems.findIndex((i) => i.id === item.id)
      if (idx !== -1) {
        newItems[idx] = { ...newItems[idx], status: 'downloading', progress: { percent: 0, speed: null, eta: null }, error: null }
        const itemId = newItems[idx].id
        setTimeout(() => { triggerDownloadRef.current(itemId) }, 0)
      }
    }
    return newItems
  }, [])

  useEffect(() => {
    const unsubs = [
      window.api.onProgress((data) => {
        setItems((prev) => prev.map((item) =>
          item.id === data.downloadId
            ? { ...item, progress: { percent: data.percent, speed: data.speed, eta: data.eta } }
            : item
        ))
      }),
      window.api.onComplete((data) => {
        setItems((prev) => {
          const updated = prev.map((item) =>
            item.id === data.downloadId
              ? { ...item, status: 'completed', progress: null, filePath: data.filePath || item.filePath }
              : item
          )
          return processQueue(updated)
        })
      }),
      window.api.onError((data) => {
        setItems((prev) => {
          const updated = prev.map((item) =>
            item.id === data.downloadId
              ? { ...item, status: 'error', progress: null, error: data.message }
              : item
          )
          return processQueue(updated)
        })
      }),
      window.api.onDestination((data) => {
        setItems((prev) => prev.map((item) =>
          item.id === data.downloadId ? { ...item, filePath: data.filePath } : item
        ))
      })
    ]
    return () => unsubs.forEach((u) => u())
  }, [processQueue])

  const handleFetch = useCallback(async (fetchUrl: string) => {
    const id = genId()
    setItems((prev) => [
      { id, url: fetchUrl, status: 'fetching', info: null, selectedFormat: 'best', progress: null, error: null, filePath: null },
      ...prev
    ])
    setUrl('')
    try {
      const info: VideoInfo = await window.api.fetchInfo(fetchUrl)
      setItems((prev) => prev.map((item) =>
        item.id === id
          ? { ...item, status: 'ready', info, selectedFormat: info.formats[0]?.formatId || 'best' }
          : item
      ))
    } catch (e: any) {
      setItems((prev) => prev.map((item) =>
        item.id === id ? { ...item, status: 'error', error: e.message || 'Failed to fetch video' } : item
      ))
    }
  }, [])

  const handleSelectFormat = useCallback((id: string, formatId: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, selectedFormat: formatId } : item)))
  }, [])

  const handleDownload = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id)
      if (!item || item.status !== 'ready') return prev
      const updated = prev.map((i) =>
        i.id === id ? { ...i, status: 'downloading', progress: { percent: 0, speed: null, eta: null }, error: null } : i
      )
      setTimeout(() => { triggerDownload(id) }, 0)
      return updated
    })
  }, [triggerDownload])

  const handleResume = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id)
      if (!item || !item.info) return prev
      const updated = prev.map((i) =>
        i.id === id ? { ...i, status: 'downloading', progress: { percent: 0, speed: null, eta: null }, error: null } : i
      )
      setTimeout(() => { triggerDownload(id) }, 0)
      return updated
    })
  }, [triggerDownload])

  const handleCancel = useCallback(async (id: string) => {
    await window.api.cancelDownload(id)
    setItems((prev) => {
      const updated = prev.map((i) =>
        i.id === id ? { ...i, status: 'paused', progress: null } : i
      )
      return processQueue(updated)
    })
  }, [processQueue])

  const handleDismiss = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    await window.api.historyDelete(id)
  }, [])

  const handleDeleteFile = useCallback(async (id: string, filePath: string | null) => {
    if (filePath) await window.api.deleteFile(filePath)
    setItems((prev) => prev.filter((i) => i.id !== id))
    await window.api.historyDelete(id)
  }, [])

  const handleClearHistory = useCallback(async () => {
    setItems((prev) => prev.filter((i) => !['completed', 'error'].includes(i.status)))
    await window.api.historyClear()
  }, [])

  const handleDownloadAll = useCallback(() => {
    setItems((prev) => processQueue(prev))
  }, [processQueue])

  const handleSelectFolder = useCallback(async () => {
    const folder = await window.api.selectFolder()
    if (folder) setSavePath(folder)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim()) handleFetch(url.trim())
  }

  const handleInputFocus = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.trim() && !url) {
        setUrl(text.trim())
      }
    } catch {
      // clipboard access denied - user can paste manually
    }
  }

  const activeItems = items.filter((i) => ['fetching', 'ready', 'downloading', 'paused'].includes(i.status))
  const doneItems = items.filter((i) => ['completed', 'error'].includes(i.status))
  const readyCount = activeItems.filter((i) => i.status === 'ready').length
  const activeCount = items.filter((i) => i.status === 'downloading').length

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-red-500">YouTube Fetcher</h1>
        <div className="flex items-center gap-3">
          {activeCount > 0 && (
            <span className="text-xs text-gray-400">{activeCount}/{maxConcurrent} downloading</span>
          )}

          <div className="relative" data-settings>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors"
              title="Settings"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl z-50 w-64">
                <label className="block text-xs text-gray-400 mb-1.5">Max parallel downloads</label>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(parseInt(e.target.value, 10))}
                    className="flex-1 accent-red-500"
                  />
                  <span className="text-white text-sm font-mono w-6 text-center">{maxConcurrent}</span>
                </div>
                <p className="text-[10px] text-gray-500 mb-3">
                  {maxConcurrent === 1 ? 'Downloads run one at a time (queued)' : `Up to ${maxConcurrent} downloads run simultaneously`}
                </p>

                <label className="block text-xs text-gray-400 mb-1.5">Save videos to</label>
                <div className="flex items-center gap-2">
                  <span
                    className="flex-1 text-[11px] text-gray-300 truncate bg-gray-700 rounded px-2 py-1.5"
                    title={savePath || 'Default (Downloads/YouTube Fetcher)'}
                  >
                    {savePath ? shortenPath(savePath) : 'Default'}
                  </span>
                  <button
                    onClick={handleSelectFolder}
                    className="px-2 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-300 text-[10px] flex-shrink-0"
                  >
                    Browse
                  </button>
                </div>
                {savePath && (
                  <button
                    onClick={() => setSavePath('')}
                    className="text-[10px] text-gray-500 hover:text-red-400 mt-1"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            )}
          </div>

          {readyCount >= 1 && (
            <button
              onClick={handleDownloadAll}
              className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
            >
              Download All ({readyCount})
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-3 max-w-3xl mx-auto w-full">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={handleInputFocus}
            placeholder="Paste YouTube URL here..."
            className="flex-1 px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 text-sm"
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
          >
            Fetch
          </button>
        </form>

        <div className="flex flex-col gap-2">
          {activeItems.map((item) => (
            <DownloadRow
              key={item.id}
              item={item}
              onSelectFormat={handleSelectFormat}
              onDownload={handleDownload}
              onDismiss={handleDismiss}
              onCancel={handleCancel}
              onResume={handleResume}
              onDeleteFile={handleDeleteFile}
            />
          ))}
        </div>

        {doneItems.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-gray-400 hover:text-gray-200 text-xs mb-2"
            >
              <svg className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              History ({doneItems.length})
              {doneItems.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleClearHistory() }}
                  className="ml-auto text-gray-500 hover:text-red-400 text-[10px]"
                >
                  Clear all
                </button>
              )}
            </button>
            {showHistory && (
              <div className="flex flex-col gap-2">
                {doneItems.map((item) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    onSelectFormat={handleSelectFormat}
                    onDownload={handleDownload}
                    onDismiss={handleDismiss}
                    onCancel={handleCancel}
                    onResume={handleResume}
                    onDeleteFile={handleDeleteFile}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {items.length === 0 && historyLoaded && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <p className="text-gray-500 text-sm">Paste a YouTube URL above and click Fetch</p>
            <p className="text-gray-600 text-[10px]">Click the input field to auto-paste from clipboard</p>
          </div>
        )}
      </main>
    </div>
  )
}
