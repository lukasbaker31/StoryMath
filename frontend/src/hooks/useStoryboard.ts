import { useState, useRef, useCallback } from 'react'
import type { Editor } from 'tldraw'
import { getIndexAbove, getIndexBelow, getIndexBetween, IndexKey } from '@tldraw/utils'
import { exportPageThumbnail } from '@/lib/exportSketch'
import type { PageInfo } from '@/lib/types'

interface UseStoryboardOptions {
  editorRef: React.RefObject<Editor | null>
  setStatus: (status: string) => void
}

export function useStoryboard({ editorRef, setStatus }: UseStoryboardOptions) {
  const [pages, setPages] = useState<PageInfo[]>([])
  const [currentPageId, setCurrentPageId] = useState('')
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  const thumbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const generateThumbnailForPage = useCallback(async (pageId: string) => {
    const editor = editorRef.current
    if (!editor) return
    try {
      const thumb = await exportPageThumbnail(editor, pageId)
      setThumbnails((prev) => {
        const next = new Map(prev)
        if (thumb) {
          next.set(pageId, thumb)
        } else {
          next.delete(pageId)
        }
        return next
      })
    } catch {
      // Thumbnail generation can fail silently
    }
  }, [editorRef])

  const generateAllThumbnails = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const allPages = editor.getPages()
    for (const page of allPages) {
      await generateThumbnailForPage(page.id)
    }
  }, [editorRef, generateThumbnailForPage])

  const syncPages = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    const editorPages = editor.getPages()
    const next = editorPages.map((p) => ({ id: p.id, name: p.name }))

    setPages((prev) => {
      if (
        prev.length === next.length &&
        prev.every((p, i) => p.id === next[i].id && p.name === next[i].name)
      ) {
        return prev
      }
      return next
    })

    setCurrentPageId((prev) => {
      const cur = editor.getCurrentPageId()
      return prev === cur ? prev : cur
    })
  }, [editorRef])

  const handleAddFrame = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    const count = editor.getPages().length
    editor.createPage({ name: `Frame ${count + 1}` })

    const allPages = editor.getPages()
    const newPage = allPages[allPages.length - 1]
    editor.setCurrentPage(newPage.id)
    syncPages()
    setStatus('Unsaved')
  }, [editorRef, syncPages, setStatus])

  const handleSelectFrame = useCallback((pageId: string) => {
    const editor = editorRef.current
    if (!editor) return
    editor.setCurrentPage(pageId as Parameters<typeof editor.setCurrentPage>[0])
    setCurrentPageId(pageId)
  }, [editorRef])

  const handleDeleteFrame = useCallback(
    (pageId: string) => {
      const editor = editorRef.current
      if (!editor) return
      const allPages = editor.getPages()
      if (allPages.length <= 1) return
      editor.deletePage(pageId as Parameters<typeof editor.deletePage>[0])
      syncPages()
      setThumbnails((prev) => {
        const next = new Map(prev)
        next.delete(pageId)
        return next
      })
      setStatus('Unsaved')
    },
    [editorRef, syncPages, setStatus]
  )

  const handleReorderFrames = useCallback(
    (fromIndex: number, toIndex: number) => {
      const editor = editorRef.current
      if (!editor) return

      const editorPages = editor.getPages()
      if (fromIndex < 0 || fromIndex >= editorPages.length) return
      if (toIndex < 0 || toIndex >= editorPages.length) return

      const movingPage = editorPages[fromIndex]

      const pagesWithout = editorPages.filter((_, i) => i !== fromIndex)
      const targetIdx = fromIndex < toIndex ? toIndex - 1 : toIndex

      const below = targetIdx > 0 ? pagesWithout[targetIdx - 1]?.index as IndexKey : undefined
      const above = targetIdx < pagesWithout.length ? pagesWithout[targetIdx]?.index as IndexKey : undefined

      let newIndex: IndexKey
      if (below && above) {
        newIndex = getIndexBetween(below, above)
      } else if (below) {
        newIndex = getIndexAbove(below)
      } else if (above) {
        newIndex = getIndexBelow(above)
      } else {
        return
      }

      editor.mark('moving page')
      editor.updatePage({ id: movingPage.id, index: newIndex } as Parameters<typeof editor.updatePage>[0])
      syncPages()
      setStatus('Unsaved')
    },
    [editorRef, syncPages, setStatus]
  )

  return {
    pages,
    currentPageId,
    thumbnails,
    thumbTimerRef,
    syncPages,
    generateAllThumbnails,
    generateThumbnailForPage,
    handleAddFrame,
    handleSelectFrame,
    handleDeleteFrame,
    handleReorderFrames,
  }
}
