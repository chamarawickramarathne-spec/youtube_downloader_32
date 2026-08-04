import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null
const downloads = new Map<string, ChildProcess>()
let workingCookieBrowser: string | null = null

interface HistoryEntry {
  id: string; url: string; title: string; thumbnail: string
  duration: number; selectedFormat: string; formats: any[]; status: string
  filePath: string | null; createdAt: number; error: string | null
}

function getHistoryPath(): string {
  return join(app.getPath('userData'), 'history.json')
}

async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const data = await readFile(getHistoryPath(), 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  await writeFile(getHistoryPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

function getCookieConfigPath(): string {
  return join(app.getPath('userData'), 'cookie-config.json')
}

async function loadCookieConfig(): Promise<void> {
  try {
    const data = await readFile(getCookieConfigPath(), 'utf-8')
    const config = JSON.parse(data)
    if (config.workingCookieBrowser !== undefined) {
      workingCookieBrowser = config.workingCookieBrowser
    }
  } catch {
    // No saved config, start fresh
  }
}

async function saveCookieConfig(): Promise<void> {
  try {
    await writeFile(getCookieConfigPath(), JSON.stringify({ workingCookieBrowser }), 'utf-8')
  } catch {
    // Non-critical, ignore
  }
}

function getYtdlpPath(): string {
  if (app.isPackaged) {
    const unpacked = join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'yt-dlp.exe')
    if (existsSync(unpacked)) return unpacked
  }
  const dev = join(__dirname, '../../resources/yt-dlp.exe')
  if (existsSync(dev)) return dev
  return 'yt-dlp'
}

function getFfmpegDir(): string {
  if (app.isPackaged) {
    const unpacked = join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    if (existsSync(join(unpacked, 'ffmpeg.exe'))) return unpacked
  }
  const devDir = join(__dirname, '../../resources')
  if (existsSync(join(devDir, 'ffmpeg.exe'))) return devDir
  return ''
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim()
}

async function getUniqueFilename(dir: string, baseName: string): Promise<string> {
  try {
    const existing = await readdir(dir)
    const exts = ['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'ogg', 'wav', 'opus']
    let candidate = baseName
    let counter = 1
    while (true) {
      const hasConflict = existing.some((f) => {
        const lower = f.toLowerCase()
        return exts.some((ext) => lower === `${candidate}.${ext}`)
      })
      if (!hasConflict) break
      counter++
      candidate = `${baseName} (${counter})`
    }
    return candidate
  } catch {
    return baseName
  }
}

function send(channel: string, data: any) {
  mainWindow?.webContents.send(channel, data)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 650,
    minWidth: 720,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow!.show())
  mainWindow.webContents.setWindowOpenHandler((d) => { shell.openExternal(d.url); return { action: 'deny' } })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Folder picker ──
ipcMain.handle('dialog:select-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

const COOKIE_BROWSERS = ['edge', 'chrome', 'brave', 'vivaldi', 'firefox']
const FETCH_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 3_000

function runYtdlpOnce(url: string, extraArgs: string[] = []): Promise<{ success: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    const args = ['--dump-single-json', '--no-download', '--no-warnings', '--no-check-certificates', '--no-playlist', '--js-runtimes', 'node']
    args.push(...extraArgs)
    args.push(url)

    const proc = spawn(getYtdlpPath(), args)
    let stdout = '', stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      proc.kill()
      resolve({ success: false, error: 'Fetch timed out after 30 seconds' })
    }, FETCH_TIMEOUT_MS)

    proc.on('close', (code) => {
      clearTimeout(timer)
      const combinedOutput = (stdout + '\n' + stderr).trim()
      if (code !== 0) {
        const errorMsg = combinedOutput || `exit code ${code}`
        return resolve({ success: false, error: errorMsg })
      }
      try { resolve({ success: true, data: JSON.parse(stdout) }) }
      catch {
        const errorMsg = combinedOutput || 'Failed to parse yt-dlp JSON'
        resolve({ success: false, error: errorMsg })
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ success: false, error: err.message })
    })
  })
}

function isBotDetection(error: string | undefined): boolean {
  if (!error) return false
  return error.includes('Sign in to confirm') || error.includes('bot')
}

function isCookieError(error: string | undefined): boolean {
  if (!error) return false
  return error.includes('DPAPI') || error.includes('decrypt') || error.includes('Could not copy') || error.includes('could not find')
}

const EXTRACTOR_BYPASS_ATTEMPTS = [
  { label: 'web+mweb client', args: ['--extractor-args', 'youtube:player_client=web,mweb'] },
  { label: 'android client', args: ['--extractor-args', 'youtube:player_client=android'] },
  { label: 'ios client', args: ['--extractor-args', 'youtube:player_client=ios'] },
  { label: 'tv client', args: ['--extractor-args', 'youtube:player_client=tv'] },
]

async function runYtdlpJson(url: string): Promise<any> {
  // 1. Try cached working cookie browser first
  if (workingCookieBrowser !== null) {
    const result = await runYtdlpOnce(url, ['--cookies-from-browser', workingCookieBrowser])
    if (result.success) return result.data
    console.log(`[yt-dlp] Cached browser '${workingCookieBrowser}' failed, clearing cache`)
    workingCookieBrowser = null
    await saveCookieConfig()
  }

  // 2. Try without cookies
  const noCookie = await runYtdlpOnce(url)
  if (noCookie.success) {
    workingCookieBrowser = ''
    await saveCookieConfig()
    return noCookie.data
  }

  const hasBotDetection = isBotDetection(noCookie.error)
  if (hasBotDetection) console.log('[yt-dlp] Bot detection hit, trying bypass strategies...')
  else console.log(`[yt-dlp] Fetch failed (not bot detection): ${(noCookie.error || '').substring(0, 200)}`)

  // 3. Try extractor-args bypass (no cookies needed)
  if (hasBotDetection) {
    for (const attempt of EXTRACTOR_BYPASS_ATTEMPTS) {
      console.log(`[yt-dlp] Trying ${attempt.label}...`)
      const result = await runYtdlpOnce(url, attempt.args)
      if (result.success) {
        console.log(`[yt-dlp] ${attempt.label} worked!`)
        workingCookieBrowser = ''
        await saveCookieConfig()
        return result.data
      }
    }
  }

  // 4. Try all browsers in parallel
  console.log('[yt-dlp] Trying browser cookies in parallel...')
  const results = await Promise.allSettled(
    COOKIE_BROWSERS.map((browser) =>
      runYtdlpOnce(url, ['--cookies-from-browser', browser]).then((r) => ({ ...r, browser }))
    )
  )

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      workingCookieBrowser = result.value.browser
      await saveCookieConfig()
      console.log(`[yt-dlp] Cookies from ${workingCookieBrowser} worked!`)
      return result.value.data
    }
    if (result.status === 'fulfilled') {
      console.log(`[yt-dlp] Cookies from ${result.value.browser} failed: ${(result.value.error || '').substring(0, 150)}`)
    }
  }

  // 5. All attempts failed
  const bestError = hasBotDetection
    ? 'Bot detected. Log into YouTube in a browser (Edge/Chrome/Firefox) and try again, or the video may be restricted.'
    : (noCookie.error || 'yt-dlp failed to fetch video info')
  throw new Error(bestError)
}

// ── Fetch video info ──
ipcMain.handle('ytdlp:fetch-info', async (_event, url: string) => {
  try {
    const info = await runYtdlpJson(url)
    const allFormats = (info.formats || [])
    const hasSeparateStreams = allFormats.some((f: any) => f.vcodec !== 'none' && f.acodec === 'none')

    let mergedFormats
    if (hasSeparateStreams) {
      const heights = [...new Set(allFormats.filter((f: any) => f.vcodec !== 'none' && f.height).map((f: any) => f.height))]
        .sort((a: number, b: number) => b - a)
      mergedFormats = heights.map((h) => ({
        formatId: `bestvideo[height<=${h}]+bestaudio/best`,
        label: `${h}p`,
        height: h,
        ext: 'mp4'
      }))
    } else {
      mergedFormats = allFormats
        .filter((f: any) => f.vcodec !== 'none' && f.acodec !== 'none' && f.height && f.protocol !== 'm3u8_native')
        .reduce((acc: any[], f: any) => {
          if (!acc.find((x: any) => x.height === f.height)) {
            acc.push({ formatId: f.format_id, label: `${f.height}p`, height: f.height, ext: f.ext })
          }
          return acc
        }, [])
        .sort((a: any, b: any) => b.height - a.height)
    }

    if (hasSeparateStreams) {
      mergedFormats.unshift({ formatId: 'bestvideo+bestaudio/best', label: 'Best Quality (merged)', height: 9999, ext: 'mp4' })
    } else {
      mergedFormats.unshift({ formatId: 'best', label: 'Best Quality', height: 9999, ext: 'mp4' })
    }
    mergedFormats.push({ formatId: 'bestaudio/best', label: 'Audio Only', height: 0, ext: 'mp3' })

    return {
      title: info.title || 'Unknown',
      thumbnail: info.thumbnail || '',
      duration: info.duration || 0,
      formats: mergedFormats
    }
  } catch (e: any) {
    throw new Error(e.message || 'Failed to fetch video info')
  }
})

// ── Download ──
async function executeDownload(
  downloadId: string, url: string, formatId: string, title: string, outputDir: string, attempt: number = 0
): Promise<{ success: boolean; message?: string }> {
  const downloadsDir = outputDir || join(app.getPath('downloads'), 'YouTube Fetcher')
  await mkdir(downloadsDir, { recursive: true })

  const ytdlp = getYtdlpPath()
  const ffmpegDir = getFfmpegDir()
  const args: string[] = []

  const needsMerge = formatId.includes('+')
  if (formatId === 'bestaudio/best') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3')
  } else if (formatId === 'best' || needsMerge) {
    args.push('-f', formatId === 'best' ? 'bestvideo+bestaudio/best' : formatId)
    args.push('--merge-output-format', 'mp4')
  } else {
    const h = formatId.replace('p', '')
    args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`)
    args.push('--merge-output-format', 'mp4')
  }

  let qualityLabel = 'best'
  if (formatId === 'bestaudio/best') {
    qualityLabel = 'audio'
  } else {
    const hMatch = formatId.match(/height<=(\d+)/)
    if (hMatch) qualityLabel = `${hMatch[1]}p`
    else if (formatId === 'best') qualityLabel = 'best'
    else qualityLabel = formatId
  }

  const safeName = await getUniqueFilename(downloadsDir, `${sanitizeFilename(title)} [${qualityLabel}]`)
  const outPath = join(downloadsDir, `${safeName}.%(ext)s`)

  args.push(
    '-o', outPath,
    '--newline',
    '--progress',
    '--no-warnings',
    '--no-check-certificates',
    '--no-overwrites',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--concurrent-fragments', '8',
    '--socket-timeout', '30',
    '--http-chunk-size', '10485760',
  )

  if (ffmpegDir) {
    args.push('--ffmpeg-location', ffmpegDir)
  } else {
    send('ytdlp:log', { downloadId, message: 'Warning: ffmpeg not found, video+audio merge may fail' })
  }

  if (workingCookieBrowser) {
    args.push('--cookies-from-browser', workingCookieBrowser)
  } else {
    args.push('--extractor-args', 'youtube:player_client=web,mweb')
  }

  args.push(url)

  console.log(`[yt-dlp] Running: ${ytdlp} ${args.join(' ')}`)

  return new Promise((resolve) => {
    const proc = spawn(ytdlp, args)
    downloads.set(downloadId, proc)
    let trackedFilePath = ''

    const timeout = setTimeout(() => {
      proc.kill()
      downloads.delete(downloadId)
      resolve({ success: false, message: 'Download timed out after 10 minutes' })
    }, DOWNLOAD_TIMEOUT_MS)

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const line of text.split('\n')) {
        const m = line.match(/(\d+\.?\d*)%/)
        if (m) {
          const speedM = line.match(/at\s+([\d.]+\w+\/s)/)
          const etaM = line.match(/ETA\s+(\S+)/)
          send('ytdlp:progress', {
            downloadId,
            percent: parseFloat(m[1]),
            speed: speedM?.[1] || null,
            eta: etaM?.[1] || null
          })
        }
        const destM = line.match(/\[download\]\s+Destination:\s+(.+)/)
        if (destM) {
          trackedFilePath = destM[1].trim()
          send('ytdlp:destination', { downloadId, filePath: trackedFilePath })
        }
        const mergeM = line.match(/\[Merger\]\s+Merging formats into\s+"(.+)"/)
        if (mergeM) {
          trackedFilePath = mergeM[1].trim()
          send('ytdlp:destination', { downloadId, filePath: trackedFilePath })
        }
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      const lines = text.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        if (line.includes('ERROR') || line.includes('error') || line.includes('Merge') || line.includes('ffmpeg')) {
          send('ytdlp:log', { downloadId, message: line.trim() })
        }
      }
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      downloads.delete(downloadId)
      if (code === 0) {
        send('ytdlp:complete', { downloadId, filePath: trackedFilePath })
        resolve({ success: true })
      } else {
        if (attempt < MAX_RETRIES) {
          console.log(`[yt-dlp] Download failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${RETRY_DELAY_MS}ms...`)
          send('ytdlp:log', { downloadId, message: `Retrying... (attempt ${attempt + 2}/${MAX_RETRIES + 1})` })
          setTimeout(() => {
            executeDownload(downloadId, url, formatId, title, outputDir, attempt + 1).then(resolve)
          }, RETRY_DELAY_MS)
        } else {
          const msg = `yt-dlp exited with code ${code}`
          send('ytdlp:error', { downloadId, message: msg })
          resolve({ success: false, message: msg })
        }
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timeout)
      downloads.delete(downloadId)
      if (attempt < MAX_RETRIES) {
        console.log(`[yt-dlp] Spawn error (attempt ${attempt + 1}), retrying...`)
        setTimeout(() => {
          executeDownload(downloadId, url, formatId, title, outputDir, attempt + 1).then(resolve)
        }, RETRY_DELAY_MS)
      } else {
        send('ytdlp:error', { downloadId, message: `Failed to start yt-dlp: ${err.message}` })
        resolve({ success: false, message: err.message })
      }
    })
  })
}

ipcMain.handle('ytdlp:start-download', async (_event, downloadId: string, url: string, formatId: string, title: string, outputDir: string) => {
  return executeDownload(downloadId, url, formatId, title, outputDir, 0)
})

// ── Cancel ──
ipcMain.handle('ytdlp:cancel-download', async (_event, downloadId: string) => {
  const handle = downloads.get(downloadId)
  if (handle) {
    handle.kill()
    downloads.delete(downloadId)
    send('ytdlp:error', { downloadId, message: 'Cancelled' })
  }
  return { success: true }
})

// ── History IPC ──
ipcMain.handle('history:load', async () => loadHistory())

ipcMain.handle('history:save', async (_event, entry: HistoryEntry) => {
  const history = await loadHistory()
  const idx = history.findIndex((h) => h.id === entry.id)
  if (idx >= 0) {
    history[idx] = entry
  } else {
    history.unshift(entry)
  }
  await saveHistory(history)
})

ipcMain.handle('history:delete', async (_event, id: string) => {
  const history = (await loadHistory()).filter((h) => h.id !== id)
  await saveHistory(history)
})

ipcMain.handle('history:clear', async () => {
  await saveHistory([])
})

ipcMain.handle('file:delete', async (_event, filePath: string) => {
  try {
    if (filePath && existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.youtube-fetcher')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  await loadCookieConfig()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
