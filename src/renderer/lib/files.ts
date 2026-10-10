/** Files the user saves or opens through the page (Electron asks where, as a browser's download would). */

/** Saves data as a file named `name`. */
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Saves text as a file. */
export function downloadText(name: string, text: string, type = 'text/plain'): void {
  download(name, new Blob([text], { type }))
}

/** Saves bytes as a file. */
export function downloadBytes(name: string, data: ArrayBuffer | Uint8Array, type = 'application/octet-stream'): void {
  // A Uint8Array is a valid blob part; TypeScript's lib types it narrower than the DOM accepts.
  download(name, new Blob([data as BlobPart], { type }))
}

/** Asks for a text file and reads it (null when none was picked). */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', async () => {
      const f = input.files?.[0]
      resolve(f ? { name: f.name, text: await f.text() } : null)
    })
    input.click()
  })
}

/** Reads a dropped or picked file as base64, to send over IPC. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
