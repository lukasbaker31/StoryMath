import type { Editor } from 'tldraw'

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

  // Convert SVG element → PNG via canvas
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
