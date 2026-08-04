import type { DownloadItem } from '../types'

interface Props {
  item: DownloadItem
  onSelectFormat: (id: string, formatId: string) => void
  onDownload: (id: string) => void
  onDismiss: (id: string) => void
  onCancel: (id: string) => void
  onResume: (id: string) => void
  onDeleteFile: (id: string, filePath: string | null) => void
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function DownloadRow({ item, onSelectFormat, onDownload, onDismiss, onCancel, onResume, onDeleteFile }: Props) {
  const isFetching = item.status === 'fetching'
  const isDownloading = item.status === 'downloading'
  const isCompleted = item.status === 'completed'
  const isError = item.status === 'error'
  const isReady = item.status === 'ready'
  const isPaused = item.status === 'paused'

  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      isError ? 'bg-red-900/30 border-red-700' :
      isCompleted ? 'bg-green-900/20 border-green-800' :
      isPaused ? 'bg-gray-800 border-yellow-700 border-dashed' :
      'bg-gray-800 border-gray-700'
    }`}>
      <div className="flex items-center gap-3">
        {item.info?.thumbnail ? (
          <img src={item.info.thumbnail} alt="" className="w-20 h-12 object-cover rounded flex-shrink-0" />
        ) : (
          <div className="w-20 h-12 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
            {isFetching && (
              <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {item.info ? (
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 text-[10px] flex-shrink-0">YT</span>
              <p className="text-white text-sm font-medium truncate" title={item.info.title}>
                {item.info.title}
              </p>
              {item.info.duration > 0 && (
                <span className="text-gray-500 text-xs flex-shrink-0">{formatDuration(item.info.duration)}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 text-[10px] flex-shrink-0">YT</span>
              <p className="text-gray-400 text-xs truncate">{item.url}</p>
            </div>
          )}
        </div>

        {(isReady || isPaused) && item.info && (
          <select
            value={item.selectedFormat}
            onChange={(e) => onSelectFormat(item.id, e.target.value)}
            className="bg-gray-700 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-red-500 flex-shrink-0"
          >
            {item.info.formats.map((f) => (
              <option key={f.formatId} value={f.formatId}>{f.label}</option>
            ))}
          </select>
        )}

        {isReady && (
          <button
            onClick={() => onDownload(item.id)}
            className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors flex-shrink-0"
          >
            Download
          </button>
        )}

        {isPaused && (
          <button
            onClick={() => onResume(item.id)}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors flex-shrink-0"
          >
            Resume
          </button>
        )}

        {isDownloading && item.progress && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-28">
              <div className="flex justify-between text-[10px] text-gray-300 mb-0.5">
                <span>{item.progress.percent.toFixed(1)}%</span>
                <span className="text-gray-500">{item.progress.speed || ''}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-red-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(item.progress.percent, 100)}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => onCancel(item.id)}
              className="px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 text-gray-300 text-[10px] flex-shrink-0"
              title="Pause download"
            >
              Pause
            </button>
          </div>
        )}

        {isCompleted && (
          <span className="text-green-400 text-xs flex-shrink-0">Done</span>
        )}

        {isError && (
          <span className="text-red-400 text-xs truncate max-w-32 flex-shrink-0" title={item.error || ''}>
            {item.error}
          </span>
        )}

        {(isCompleted || isError) && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {item.filePath && (
              <button
                onClick={() => onDeleteFile(item.id, item.filePath)}
                className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0"
                title="Delete file from disk"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <button
              onClick={() => onDismiss(item.id)}
              className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0"
              title="Remove from list"
            >
              &times;
            </button>
          </div>
        )}

        {(isReady || isPaused) && (
          <button
            onClick={() => onDismiss(item.id)}
            className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0"
            title="Remove from queue"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  )
}
