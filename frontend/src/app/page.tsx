'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  api,
  LoadResponse,
  TemplateCategory,
  TemplateExample,
} from '@/lib/api'
import type { Editor } from 'tldraw'
import { useStoryboard } from '@/hooks/useStoryboard'
import { useRenderPipeline } from '@/hooks/useRenderPipeline'
import { useAIGeneration } from '@/hooks/useAIGeneration'

const StoryboardPanel = dynamic(
  () => import('@/components/StoryboardPanel'),
  { ssr: false }
)

const SketchPanel = dynamic(() => import('@/components/SketchPanel'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 bg-gray-900 flex items-center justify-center">
      <span className="text-gray-500">Loading canvas...</span>
    </div>
  ),
})

const CodeRenderPanel = dynamic(
  () => import('@/components/CodeRenderPanel'),
  {
    ssr: false,
    loading: () => (
      <div className="w-[480px] bg-gray-800 flex items-center justify-center">
        <span className="text-gray-500">Loading editor...</span>
      </div>
    ),
  }
)

export default function Home() {
  // Cross-cutting state
  const [status, setStatus] = useState('Loading...')
  const [renderLog, setRenderLog] = useState('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [editorMounted, setEditorMounted] = useState(false)

  // Config state
  const [latexAvailable, setLatexAvailable] = useState(false)
  const [templateCategories, setTemplateCategories] = useState<TemplateCategory[]>([])
  const [templateExamples, setTemplateExamples] = useState<TemplateExample[]>([])

  // Refs
  const editorRef = useRef<Editor | null>(null)
  const initialDataRef = useRef<LoadResponse | null>(null)
  const snapshotLoadedRef = useRef(false)

  // Hooks
  const storyboard = useStoryboard({ editorRef, setStatus })
  const renderPipeline = useRenderPipeline({ setStatus, setRenderLog, setVideoUrl })
  const aiGeneration = useAIGeneration({ editorRef, setStatus, setRenderLog })

  // Load project data + status + templates from backend on mount
  useEffect(() => {
    api
      .load()
      .then((data) => {
        initialDataRef.current = data
        if (data.scene_code) aiGeneration.setSceneCode(data.scene_code)
        if (data.has_render) setVideoUrl(api.renderMp4Url())
        setStatus('Ready')

        if (
          editorRef.current &&
          data.storyboard_json &&
          !snapshotLoadedRef.current
        ) {
          snapshotLoadedRef.current = true
          editorRef.current.store.loadSnapshot(
            data.storyboard_json as unknown as Parameters<
              typeof editorRef.current.store.loadSnapshot
            >[0]
          )
          storyboard.syncPages()
          storyboard.generateAllThumbnails()
        }
      })
      .catch((err) => {
        console.error('Failed to load project:', err)
        setStatus('Backend unavailable')
      })

    api
      .status()
      .then((s) => setLatexAvailable(s.latex_available))
      .catch(() => {})

    api
      .templates()
      .then((t) => {
        setTemplateCategories(t.categories)
        setTemplateExamples(t.examples)
      })
      .catch(() => {})

    renderPipeline.loadRenders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Called once when tldraw mounts
  const handleEditorMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      setEditorMounted(true)

      const data = initialDataRef.current
      if (data?.storyboard_json && !snapshotLoadedRef.current) {
        snapshotLoadedRef.current = true
        editor.store.loadSnapshot(
          data.storyboard_json as unknown as Parameters<
            typeof editor.store.loadSnapshot
          >[0]
        )
      }

      storyboard.syncPages()
      storyboard.generateAllThumbnails()
    },
    [storyboard]
  )

  // Listen to tldraw store changes to keep page list in sync + debounced thumbnail regen
  useEffect(() => {
    if (!editorMounted || !editorRef.current) return

    const editor = editorRef.current
    let rafId: number

    const unlisten = editor.store.listen(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        storyboard.syncPages()

        if (storyboard.thumbTimerRef.current) {
          clearTimeout(storyboard.thumbTimerRef.current)
        }
        storyboard.thumbTimerRef.current = setTimeout(() => {
          const currentId = editor.getCurrentPageId()
          storyboard.generateThumbnailForPage(currentId)
        }, 1500)
      })
    })

    return () => {
      unlisten()
      cancelAnimationFrame(rafId)
      if (storyboard.thumbTimerRef.current) {
        clearTimeout(storyboard.thumbTimerRef.current)
      }
    }
  }, [editorMounted, storyboard])

  // Forward Delete/Backspace to tldraw when not typing in an input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return

      const active = document.activeElement as HTMLElement | null
      if (!active) return

      if (active.closest('.monaco-editor')) return

      const editor = editorRef.current
      if (!editor) return

      if (editor.getEditingShapeId()) return

      const insideTldraw = !!active.closest('.tl-container')
      if (
        !insideTldraw &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        return
      }

      const selected = editor.getSelectedShapeIds()
      if (selected.length > 0) {
        editor.deleteShapes(selected)
        e.preventDefault()
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleSave = useCallback(async () => {
    const editor = editorRef.current
    const snapshot = editor ? editor.store.getSnapshot() : null
    setStatus('Saving...')
    try {
      await api.save(
        snapshot as Record<string, unknown> | null,
        aiGeneration.sceneCode
      )
      setStatus('Saved')
    } catch {
      setStatus('Save failed')
    }
  }, [aiGeneration.sceneCode])

  const handleRender = useCallback(
    () => renderPipeline.handleRender(aiGeneration.sceneCode),
    [renderPipeline, aiGeneration.sceneCode]
  )

  const handleRefreshLatex = useCallback(async () => {
    try {
      const result = await api.refreshStatus()
      setLatexAvailable(result.latex_available)
    } catch {}
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <StoryboardPanel
        pages={storyboard.pages}
        currentPageId={storyboard.currentPageId}
        thumbnails={storyboard.thumbnails}
        onAddFrame={storyboard.handleAddFrame}
        onSelectFrame={storyboard.handleSelectFrame}
        onDeleteFrame={storyboard.handleDeleteFrame}
        onReorderFrames={storyboard.handleReorderFrames}
        savedRenders={renderPipeline.savedRenders}
        activeRenderId={renderPipeline.activeRenderId}
        onPreviewRender={renderPipeline.handlePreviewRender}
        onRenameRender={renderPipeline.handleRenameRender}
        onDeleteRender={renderPipeline.handleDeleteRender}
        onDownloadRender={renderPipeline.handleDownloadRender}
        selectedRenderIds={renderPipeline.selectedRenderIds}
        onSelectedRenderIdsChange={renderPipeline.setSelectedRenderIds}
        onStitchRenders={renderPipeline.handleStitchRenders}
      />
      <SketchPanel onMount={handleEditorMount} />
      <CodeRenderPanel
        code={aiGeneration.sceneCode}
        onCodeChange={aiGeneration.handleCodeChange}
        onSave={handleSave}
        onRender={handleRender}
        onGenerate={aiGeneration.handleGenerate}
        isGenerating={aiGeneration.isGenerating}
        generatePrompt={aiGeneration.generatePrompt}
        onGeneratePromptChange={aiGeneration.setGeneratePrompt}
        selectedModel={aiGeneration.selectedModel}
        onModelChange={aiGeneration.setSelectedModel}
        renderQuality={renderPipeline.renderQuality}
        onRenderQualityChange={renderPipeline.setRenderQuality}
        renderLog={renderLog}
        videoUrl={videoUrl}
        isRendering={renderPipeline.isRendering}
        status={status}
        latexAvailable={latexAvailable}
        onRefreshLatex={handleRefreshLatex}
        templateCategories={templateCategories}
        templateExamples={templateExamples}
        selectedComponents={aiGeneration.selectedComponents}
        onSelectedComponentsChange={aiGeneration.setSelectedComponents}
        onInsertCode={aiGeneration.handleInsertCode}
        chatHistory={aiGeneration.chatHistory}
        onChatSend={aiGeneration.handleChatSend}
        onChatReset={aiGeneration.handleChatReset}
        isChatting={aiGeneration.isChatting}
      />
    </div>
  )
}
