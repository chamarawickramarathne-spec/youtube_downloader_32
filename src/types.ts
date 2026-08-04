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
  percent: number
  speed: string | null
  eta: string | null
}

export type ItemStatus = 'fetching' | 'ready' | 'downloading' | 'completed' | 'error' | 'paused'

export interface DownloadItem {
  id: string
  url: string
  status: ItemStatus
  info: VideoInfo | null
  selectedFormat: string
  progress: DownloadProgress | null
  error: string | null
  filePath: string | null
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  thumbnail: string
  duration: number
  selectedFormat: string
  formats: VideoFormat[]
  status: 'ready' | 'completed' | 'error' | 'paused'
  filePath: string | null
  createdAt: number
  error: string | null
}

export interface ElectronAPI {
  selectFolder: () => Promise<string | null>
  fetchInfo: (url: string) => Promise<VideoInfo>
  startDownload: (downloadId: string, url: string, formatId: string, title: string, outputDir: string) => Promise<any>
  cancelDownload: (downloadId: string) => Promise<any>
  onProgress: (cb: (d: any) => void) => () => void
  onComplete: (cb: (d: any) => void) => () => void
  onError: (cb: (d: any) => void) => () => void
  onDestination: (cb: (d: any) => void) => () => void
  onLog: (cb: (d: any) => void) => () => void
  historyLoad: () => Promise<HistoryEntry[]>
  historySave: (entry: HistoryEntry) => Promise<void>
  historyDelete: (id: string) => Promise<void>
  historyClear: () => Promise<void>
  deleteFile: (filePath: string) => Promise<boolean>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
