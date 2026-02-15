import type { Editor } from 'tldraw'

export interface PageExport {
  pageId: string
  pageName: string
  base64: string
}

/**
 * Exports the current tldraw page as a PNG base64 string (no data URL prefix).
 * Throws if the page has no shapes.
 */
export async function exportCurrentPageAsPngBase64(
  editor: Editor
): Promise<string> {
  const shapeIds = editor.getCurrentPageShapeIds()
  if (shapeIds.size === 0) {
    throw new Error('No shapes on canvas to export')
  }

  // Use tldraw's getSvg to get an SVG element for the current shapes
  const ids = Array.from(shapeIds)
  const svg = await editor.getSvg(ids, { padding: 32 })
  if (!svg) {
    throw new Error('Failed to export canvas as SVG')
  }

  return svgToPngBase64(svg)
}

/**
 * Exports all pages that have shapes as PNG base64 strings.
 * Restores the original page after export.
 * Returns empty array if no pages have shapes.
 */
export async function exportAllPagesAsPngBase64(
  editor: Editor
): Promise<PageExport[]> {
  const originalPageId = editor.getCurrentPageId()
  const allPages = editor.getPages()
  const results: PageExport[] = []

  try {
    for (const page of allPages) {
      // Switch to this page to access its shapes
      editor.setCurrentPage(page.id)

      const shapeIds = editor.getCurrentPageShapeIds()
      if (shapeIds.size === 0) continue

      const ids = Array.from(shapeIds)
      const svg = await editor.getSvg(ids, { padding: 32 })
      if (!svg) continue

      const base64 = await svgToPngBase64(svg)
      results.push({
        pageId: page.id,
        pageName: page.name,
        base64,
      })
    }
  } finally {
    // Always restore the original page
    editor.setCurrentPage(originalPageId)
  }

  return results
}

/**
 * Exports a single page as a small thumbnail PNG base64 string.
 * Returns null if the page has no shapes.
 */
export async function exportPageThumbnail(
  editor: Editor,
  pageId: string
): Promise<string | null> {
  const originalPageId = editor.getCurrentPageId()
  try {
    editor.setCurrentPage(pageId as Parameters<typeof editor.setCurrentPage>[0])
    const shapeIds = editor.getCurrentPageShapeIds()
    if (shapeIds.size === 0) return null

    const ids = Array.from(shapeIds)
    const svg = await editor.getSvg(ids, { padding: 16 })
    if (!svg) return null

    return svgToThumbnailBase64(svg, 192, 128)
  } finally {
    editor.setCurrentPage(originalPageId)
  }
}

/** Convert an SVG element to a scaled-down thumbnail PNG base64 string (no data URL prefix). */
async function svgToThumbnailBase64(
  svg: SVGElement,
  maxWidth: number,
  maxHeight: number
): Promise<string> {
  const svgString = new XMLSerializer().serializeToString(svg)
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const img = new Image()
  img.src = url

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load SVG as image'))
  })

  const srcW = img.naturalWidth || 800
  const srcH = img.naturalHeight || 600
  const scale = Math.min(maxWidth / srcW, maxHeight / srcH, 1)
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  URL.revokeObjectURL(url)

  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.split(',')[1]
}

/** Convert an SVG element to a PNG base64 string (no data URL prefix). */
async function svgToPngBase64(svg: SVGElement): Promise<string> {
  const svgString = new XMLSerializer().serializeToString(svg)
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const img = new Image()
  img.src = url

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load SVG as image'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 800
  canvas.height = img.naturalHeight || 600
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)

  URL.revokeObjectURL(url)

  // Return raw base64 (strip the data:image/png;base64, prefix)
  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.split(',')[1]
}
