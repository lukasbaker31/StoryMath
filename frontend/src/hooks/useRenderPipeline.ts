import { useState, useCallback, type Dispatch, type SetStateAction } from 'react'
import { api, SavedRender } from '@/lib/api'

interface UseRenderPipelineOptions {
  setStatus: (status: string) => void
  setRenderLog: Dispatch<SetStateAction<string>>
  setVideoUrl: (url: string | null) => void
}

export function useRenderPipeline({ setStatus, setRenderLog, setVideoUrl }: UseRenderPipelineOptions) {
  const [isRendering, setIsRendering] = useState(false)
  const [renderQuality, setRenderQuality] = useState('l')
  const [savedRenders, setSavedRenders] = useState<SavedRender[]>([])
  const [activeRenderId, setActiveRenderId] = useState<string | null>(null)
  const [selectedRenderIds, setSelectedRenderIds] = useState<Set<string>>(new Set())

  const loadRenders = useCallback(async () => {
    try {
      const renders = await api.listRenders()
      setSavedRenders(renders)
    } catch {
      // ignore
    }
  }, [])

  const handleRender = useCallback(async (sceneCode: string) => {
    setIsRendering(true)
    setRenderLog('')
    setStatus('Rendering...')
    try {
      const result = await api.renderStream(sceneCode, renderQuality, (line) => {
        setRenderLog((prev: string) => prev + line + '\n')
      })
      if (result.ok && result.mp4_url) {
        setVideoUrl(api.renderMp4Url(true))
        if (result.render_id) {
          setActiveRenderId(result.render_id)
        }
        api.listRenders().then(setSavedRenders).catch(() => {})
      }
      setStatus(result.ok ? 'Rendered' : 'Render failed')
    } catch {
      setRenderLog('Network error: could not reach backend.')
      setStatus('Render failed')
    } finally {
      setIsRendering(false)
    }
  }, [renderQuality, setStatus, setRenderLog, setVideoUrl])

  const handlePreviewRender = useCallback((id: string) => {
    setActiveRenderId(id)
    setVideoUrl(api.renderVideoUrl(id) + `?t=${Date.now()}`)
  }, [setVideoUrl])

  const handleRenameRender = useCallback(async (id: string, name: string) => {
    await api.renameRender(id, name)
    const renders = await api.listRenders()
    setSavedRenders(renders)
  }, [])

  const handleDeleteRender = useCallback(async (id: string) => {
    await api.deleteRender(id)
    const renders = await api.listRenders()
    setSavedRenders(renders)
    if (activeRenderId === id) {
      setActiveRenderId(null)
      setVideoUrl(null)
    }
  }, [activeRenderId, setVideoUrl])

  const handleDownloadRender = useCallback(async (id: string, name: string) => {
    const url = api.renderVideoUrl(id)
    const res = await fetch(url)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `${name}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  }, [])

  const handleStitchRenders = useCallback(async () => {
    if (selectedRenderIds.size < 2) return

    const orderedIds = savedRenders
      .filter((r) => selectedRenderIds.has(r.id))
      .map((r) => r.id)

    setStatus('Stitching...')
    try {
      const result = await api.stitchRenders(orderedIds)
      if (result.ok && result.render_id) {
        const renders = await api.listRenders()
        setSavedRenders(renders)
        setActiveRenderId(result.render_id)
        setVideoUrl(api.renderVideoUrl(result.render_id) + `?t=${Date.now()}`)
        setSelectedRenderIds(new Set())
        setStatus('Stitched')
      } else {
        setStatus('Stitch failed')
      }
    } catch {
      setStatus('Stitch failed')
    }
  }, [selectedRenderIds, savedRenders, setStatus, setVideoUrl])

  return {
    isRendering,
    renderQuality,
    setRenderQuality,
    savedRenders,
    setSavedRenders,
    activeRenderId,
    selectedRenderIds,
    setSelectedRenderIds,
    handleRender,
    handlePreviewRender,
    handleRenameRender,
    handleDeleteRender,
    handleDownloadRender,
    handleStitchRenders,
    loadRenders,
  }
}
