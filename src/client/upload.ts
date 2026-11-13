/**
 * Sending files to the brain, one after another, with progress. XMLHttpRequest
 * because fetch cannot report how far an upload has got.
 */

export interface UploadProgress {
  done: number
  total: number
  file: string
}

function sendOne(url: string, file: File, onBytes: (sent: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', new URL(url, document.baseURI).href)
    xhr.upload.onprogress = event => onBytes(event.loaded)
    xhr.onload = () => {
      let message: string | undefined
      let value: unknown
      try {
        value = JSON.parse(xhr.responseText)
        message = (value as { message?: string }).message
      } catch {
        // not JSON: the status says enough
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(value)
      else reject(new Error(message ?? `上传 ${file.name} 失败（HTTP ${xhr.status}）`))
    }
    xhr.onerror = () => reject(new Error(`上传 ${file.name} 时网络断了`))
    xhr.send(file)
  })
}

/** Upload one file; what the brain answered. */
export function uploadFile(file: File, url: string, onProgress: (progress: UploadProgress) => void): Promise<unknown> {
  return sendOne(url, file, sent => onProgress({ done: sent, total: file.size, file: file.name }))
}

/** Upload `files` to the place `urlFor` names for each; progress in bytes over all of them. */
export async function uploadFiles(files: File[], urlFor: (file: File) => string, onProgress: (progress: UploadProgress) => void): Promise<void> {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  let finished = 0
  for (const file of files) {
    await sendOne(urlFor(file), file, sent => onProgress({ done: finished + sent, total, file: file.name }))
    finished += file.size
    onProgress({ done: finished, total, file: file.name })
  }
}

/** A file's path inside the folder that was chosen (its top folder dropped). */
export function insideFolder(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
  return relative === '' ? file.name : relative.split('/').slice(1).join('/')
}

/** Hidden files and what the importer would never read are not worth the wait. */
export const worthSending = (file: File) => !insideFolder(file).split('/').some(part => part.startsWith('.')) && /\.(mp4|webm|mov|m4v|png|jpe?g|webp|wav|mp3|m4a|json|txt|md)$/i.test(file.name)
