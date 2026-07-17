type SaveGeneratedAssetOptions = {
  source: string
  filenamePrefix: string
  fallbackExtension: string
}

type PrepareGeneratedAssetOptions = {
  source: string
  fallbackExtension: string
}

export type PreparedGeneratedAsset = {
  url: string
  extension: string
  release: () => void
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

const sanitizeFilenamePart = (value: string) => {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'asset'
}

const getExtensionFromMime = (mimeType: string) => {
  const normalized = mimeType.trim().toLowerCase()
  return MIME_EXTENSION_MAP[normalized] ?? null
}

const getExtensionFromSource = (source: string) => {
  const dataUrlMatch = source.match(/^data:([^;,]+)[;,]/i)
  if (dataUrlMatch) {
    return getExtensionFromMime(dataUrlMatch[1]) ?? null
  }

  try {
    const url = new URL(source)
    const pathname = url.pathname.toLowerCase()
    const ext = pathname.split('.').pop()
    if (ext && ext.length <= 5) return ext
  } catch {
    const cleaned = source.split('#')[0].split('?')[0].toLowerCase()
    const ext = cleaned.split('.').pop()
    if (ext && ext.length <= 5) return ext
  }

  return null
}

const normalizeBase64Payload = (value: string) => {
  const normalized = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '')
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(normalized)) return null
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return normalized + padding
}

const decodeBase64 = (value: string) => {
  const normalized = normalizeBase64Payload(value)
  if (!normalized) return null

  const chunkSize = 32768
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    let binary = ''
    try {
      binary = window.atob(normalized.slice(offset, offset + chunkSize))
    } catch {
      return null
    }
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    chunks.push(bytes)
  }
  return chunks
}

const decodePlainData = (value: string) => {
  try {
    return new TextEncoder().encode(decodeURIComponent(value))
  } catch {
    return new TextEncoder().encode(value)
  }
}

export const createBlobFromDataUrl = (source: string) => {
  if (!source.toLowerCase().startsWith('data:')) return null

  const commaIndex = source.indexOf(',')
  if (commaIndex < 0) return null

  const meta = source.slice(5, commaIndex)
  const parts = meta.split(';').filter(Boolean)
  const mimeType = parts.find((part) => part.includes('/')) || 'application/octet-stream'
  const payload = source.slice(commaIndex + 1)
  const isBase64 = parts.some((part) => part.toLowerCase() === 'base64')
  const bytes = isBase64 ? decodeBase64(payload) : [decodePlainData(payload)]
  if (!bytes) return null
  return new Blob(bytes, { type: mimeType })
}

const createPreparedBlob = (blob: Blob, fallbackExtension: string): PreparedGeneratedAsset => {
  const url = URL.createObjectURL(blob)
  let released = false
  return {
    url,
    extension: getExtensionFromMime(blob.type) ?? fallbackExtension.toLowerCase(),
    release: () => {
      if (released) return
      released = true
      URL.revokeObjectURL(url)
    },
  }
}

export const prepareGeneratedAsset = async ({
  source,
  fallbackExtension,
}: PrepareGeneratedAssetOptions): Promise<PreparedGeneratedAsset> => {
  const extension = getExtensionFromSource(source) ?? fallbackExtension.toLowerCase()

  if (source.startsWith('data:')) {
    const blob = createBlobFromDataUrl(source)
    return blob
      ? createPreparedBlob(blob, extension)
      : { url: source, extension, release: () => undefined }
  }

  if (source.startsWith('blob:')) {
    return { url: source, extension, release: () => undefined }
  }

  try {
    const response = await fetch(source)
    if (!response.ok) throw new Error('fetch_failed')
    return createPreparedBlob(await response.blob(), extension)
  } catch {
    return { url: source, extension, release: () => undefined }
  }
}

const triggerDownload = (href: string, filename: string) => {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export const saveGeneratedAsset = async ({ source, filenamePrefix, fallbackExtension }: SaveGeneratedAssetOptions) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const baseName = sanitizeFilenamePart(filenamePrefix) + '-' + timestamp

  if (source.startsWith('blob:')) {
    const extension = getExtensionFromSource(source) ?? fallbackExtension.toLowerCase()
    triggerDownload(source, baseName + '.' + extension)
    return
  }

  if (source.startsWith('data:')) {
    const blob = createBlobFromDataUrl(source)
    if (blob) {
      const extension =
        getExtensionFromMime(blob.type) ?? getExtensionFromSource(source) ?? fallbackExtension.toLowerCase()
      const objectUrl = URL.createObjectURL(blob)
      triggerDownload(objectUrl, baseName + '.' + extension)
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
      return
    }
    const extension = getExtensionFromSource(source) ?? fallbackExtension.toLowerCase()
    triggerDownload(source, baseName + '.' + extension)
    return
  }

  try {
    const response = await fetch(source)
    if (!response.ok) throw new Error('fetch_failed')
    const blob = await response.blob()
    const extension =
      getExtensionFromMime(blob.type) ?? getExtensionFromSource(source) ?? fallbackExtension.toLowerCase()
    const objectUrl = URL.createObjectURL(blob)
    triggerDownload(objectUrl, baseName + '.' + extension)
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
    return
  } catch {
    const extension = getExtensionFromSource(source) ?? fallbackExtension.toLowerCase()
    triggerDownload(source, baseName + '.' + extension)
  }
}
