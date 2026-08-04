import { contextBridge, ipcRenderer } from 'electron'

export interface VideoFormat {
  formatId: string
  label: string
  height: number
  ext: string
}

export interface VideoInfo {
  title: string
  thumbnail: string
  duration: number
  formats: VideoFormat[]
}

export interface DownloadProgress {
  downloadId: string
  percent: number
  speed: string | null
  eta: string | null
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  thumbnail: string
  duration: number
  selectedFormat: string
  formats: VideoFormat[]
  status: string
  filePath: string | null
  createdAt: number
  error: string | null
}

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-folder'),
  fetchInfo: (url: string): Promise<VideoInfo> => ipcRenderer.invoke('ytdlp:fetch-info', url),
  startDownload: (downloadId: string, url: string, formatId: string, title: string, outputDir: string): Promise<any> =>
    ipcRenderer.invoke('ytdlp:start-download', downloadId, url, formatId, title, outputDir),
  cancelDownload: (downloadId: string): Promise<any> =>
    ipcRenderer.invoke('ytdlp:cancel-download', downloadId),
  onProgress: (cb: (d: DownloadProgress) => void) => {
    const h = (_e: any, d: DownloadProgress) => cb(d)
    ipcRenderer.on('ytdlp:progress', h)
    return () => ipcRenderer.removeListener('ytdlp:progress', h)
  },
  onComplete: (cb: (d: { downloadId: string; filePath: string }) => void) => {
    const h = (_e: any, d: { downloadId: string; filePath: string }) => cb(d)
    ipcRenderer.on('ytdlp:complete', h)
    return () => ipcRenderer.removeListener('ytdlp:complete', h)
  },
  onError: (cb: (d: { downloadId: string; message: string }) => void) => {
    const h = (_e: any, d: { downloadId: string; message: string }) => cb(d)
    ipcRenderer.on('ytdlp:error', h)
    return () => ipcRenderer.removeListener('ytdlp:error', h)
  },
  onDestination: (cb: (d: { downloadId: string; filePath: string }) => void) => {
    const h = (_e: any, d: { downloadId: string; filePath: string }) => cb(d)
    ipcRenderer.on('ytdlp:destination', h)
    return () => ipcRenderer.removeListener('ytdlp:destination', h)
  },
  onLog: (cb: (d: { downloadId: string; message: string }) => void) => {
    const h = (_e: any, d: { downloadId: string; message: string }) => cb(d)
    ipcRenderer.on('ytdlp:log', h)
    return () => ipcRenderer.removeListener('ytdlp:log', h)
  },
  historyLoad: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:load'),
  historySave: (entry: HistoryEntry): Promise<void> => ipcRenderer.invoke('history:save', entry),
  historyDelete: (id: string): Promise<void> => ipcRenderer.invoke('history:delete', id),
  historyClear: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  deleteFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke('file:delete', filePath)
}

contextBridge.exposeInMainWorld('api', api)
