const https = require('https')
const fs = require('fs')
const path = require('path')

const RESOURCES = path.join(__dirname, '..', 'resources')

async function download(url, dest) {
  if (fs.existsSync(dest)) {
    console.log(`Already exists: ${path.basename(dest)}`)
    return
  }
  console.log(`Downloading ${path.basename(dest)}...`)
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        const file = fs.createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err) })
      }).on('error', reject)
    }
    follow(url)
  })
}

async function main() {
  // yt-dlp (32-bit x86)
  const ytdlpDest = path.join(RESOURCES, 'yt-dlp.exe')
  await download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_x86.exe', ytdlpDest)

  // ffmpeg (32-bit win32 static GPL build from sudo-nautilus)
  const ffmpegDest = path.join(RESOURCES, 'ffmpeg.exe')
  if (!fs.existsSync(ffmpegDest)) {
    console.log('Downloading ffmpeg (win32 static)...')
    const zipDest = path.join(RESOURCES, 'ffmpeg.zip')
    await download('https://github.com/sudo-nautilus/FFmpeg-Builds-Win32/releases/download/latest/ffmpeg-master-latest-win32-gpl.zip', zipDest)

    console.log('Extracting ffmpeg.exe...')
    const { execSync } = require('child_process')
    try {
      execSync(
        `powershell -Command "` +
        `$zip = Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `$archive = [System.IO.Compression.ZipFile]::OpenRead('${zipDest.replace(/\\/g, '\\\\')}'); ` +
        `$entry = $archive.Entries | Where-Object { $_.Name -eq 'ffmpeg.exe' } | Select-Object -First 1; ` +
        `if ($entry) { ` +
        `  $dest = '${ffmpegDest.replace(/\\/g, '\\\\')}'; ` +
        `  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true); ` +
        `  Write-Output 'Extracted ffmpeg.exe' ` +
        `} else { Write-Output 'ffmpeg.exe not found in zip' }; ` +
        `$archive.Dispose()` +
        `"`,
        { stdio: 'inherit' }
      )
    } catch (e) {
      console.error('Extraction failed:', e.message)
    }
    try { fs.unlinkSync(zipDest) } catch {}
  }

  console.log('Done.')
  fs.readdirSync(RESOURCES).forEach(f => {
    const stat = fs.statSync(path.join(RESOURCES, f))
    console.log(`  ${f} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
  })
}

main().catch((err) => {
  console.error('Setup failed:', err.message)
  console.error('You can manually download:')
  console.error('  yt-dlp.exe: https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_x86.exe')
  console.error('  ffmpeg.exe: https://github.com/sudo-nautilus/FFmpeg-Builds-Win32/releases/latest')
  console.error('Place them both in the resources/ directory.')
})
