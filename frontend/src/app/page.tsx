'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  api,
  ChatMessage,
  LoadResponse,
  TemplateCategory,
  TemplateExample,
} from '@/lib/api'
import { exportCurrentPageAsPngBase64 } from '@/lib/exportSketch'
import type { Editor } from 'tldraw'

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

interface PageInfo {
  id: string
  name: string
}

export default function Home() {
  const [sceneCode, setSceneCode] = useState('')
  const [pages, setPages] = useState<PageInfo[]>([])
  const [currentPageId, setCurrentPageId] = useState('')
  const [status, setStatus] = useState('Loading...')
  const [renderLog, setRenderLog] = useState('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5-20250929')
  const [renderQuality, setRenderQuality] = useState('l')
  const [editorMounted, setEditorMounted] = useState(false)

  // Template & LaTeX state
  const [latexAvailable, setLatexAvailable] = useState(false)
  const [templateCategories, setTemplateCategories] = useState<TemplateCategory[]>([])
  const [templateExamples, setTemplateExamples] = useState<TemplateExample[]>([])
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set())

  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [isChatting, setIsChatting] = useState(false)
  const chatSketchRef = useRef<string | null>(null)

  const editorRef = useRef<Editor | null>(null)
  const initialDataRef = useRef<LoadResponse | null>(null)
  const snapshotLoadedRef = useRef(false)

  // Reads pages from the tldraw editor and syncs to React state
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
  }, [])

  // Load project data + status + templates from backend on mount
  useEffect(() => {
    // Load project
    api
      .load()
      .then((data) => {
        initialDataRef.current = data
        if (data.scene_code) setSceneCode(data.scene_code)
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
          syncPages()
        }
      })
      .catch((err) => {
        console.error('Failed to load project:', err)
        setStatus('Backend unavailable')
      })

    // Load status (LaTeX detection)
    api
      .status()
      .then((s) => setLatexAvailable(s.latex_available))
      .catch(() => {})

    // Load templates
    api
      .templates()
      .then((t) => {
        setTemplateCategories(t.categories)
        setTemplateExamples(t.examples)
      })
      .catch(() => {})
  }, [syncPages])

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

      syncPages()
    },
    [syncPages]
  )

  // Listen to tldraw store changes to keep page list in sync
  useEffect(() => {
    if (!editorMounted || !editorRef.current) return

    const editor = editorRef.current
    let rafId: number

    const unlisten = editor.store.listen(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => syncPages())
    })

    return () => {
      unlisten()
      cancelAnimationFrame(rafId)
    }
  }, [editorMounted, syncPages])

  // Forward Delete/Backspace to tldraw when not typing in an input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return

      const active = document.activeElement as HTMLElement | null
      if (!active) return

      // Don't intercept when user is typing in the code editor
      if (active.closest('.monaco-editor')) return

      const editor = editorRef.current
      if (!editor) return

      // Don't intercept while editing text on a tldraw shape
      if (editor.getEditingShapeId()) return

      // Don't intercept when typing in inputs outside tldraw
      // (tldraw uses a hidden textarea internally, so we must allow it through)
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
  }, [syncPages])

  const handleSelectFrame = useCallback((pageId: string) => {
    const editor = editorRef.current
    if (!editor) return
    editor.setCurrentPage(pageId as Parameters<typeof editor.setCurrentPage>[0])
    setCurrentPageId(pageId)
  }, [])

  const handleDeleteFrame = useCallback(
    (pageId: string) => {
      const editor = editorRef.current
      if (!editor) return
      const allPages = editor.getPages()
      if (allPages.length <= 1) return
      editor.deletePage(pageId as Parameters<typeof editor.deletePage>[0])
      syncPages()
      setStatus('Unsaved')
    },
    [syncPages]
  )

  const handleSave = useCallback(async () => {
    const editor = editorRef.current
    const snapshot = editor ? editor.store.getSnapshot() : null
    setStatus('Saving...')
    try {
      await api.save(
        snapshot as Record<string, unknown> | null,
        sceneCode
      )
      setStatus('Saved')
    } catch {
      setStatus('Save failed')
    }
  }, [sceneCode])

  const handleRender = useCallback(async () => {
    setIsRendering(true)
    setRenderLog('')
    setStatus('Rendering...')
    try {
      const result = await api.render(sceneCode, renderQuality)
      setRenderLog(result.log)
      if (result.ok && result.mp4_url) {
        setVideoUrl(api.renderMp4Url(true))
      }
      setStatus(result.ok ? 'Rendered' : 'Render failed')
    } catch {
      setRenderLog('Network error: could not reach backend.')
      setStatus('Render failed')
    } finally {
      setIsRendering(false)
    }
  }, [sceneCode, renderQuality])

  const handleGenerate = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    setIsGenerating(true)
    setRenderLog('')
    setStatus('Generating...')

    try {
      const base64 = await exportCurrentPageAsPngBase64(editor)
      const componentNames = selectedComponents.size > 0
        ? Array.from(selectedComponents)
        : undefined
      const result = await api.generate(
        base64,
        generatePrompt,
        selectedModel,
        componentNames
      )

      if (!result.ok || !result.code) {
        setRenderLog(result.error ?? 'Unknown error during generation')
        setStatus('Generation failed')
        return
      }

      const confirmed = window.confirm(
        'Replace the current code with AI-generated code? This cannot be undone.'
      )

      if (confirmed) {
        setSceneCode(result.code)
        setChatHistory([])
        chatSketchRef.current = null
        setStatus('Generated')
      } else {
        setStatus('Generation cancelled')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setRenderLog(`Generation error: ${message}`)
      setStatus('Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }, [generatePrompt, selectedModel, selectedComponents])

  const handleRefreshLatex = useCallback(async () => {
    try {
      const result = await api.refreshStatus()
      setLatexAvailable(result.latex_available)
    } catch {}
  }, [])

  const handleInsertCode = useCallback((source: string) => {
    setSceneCode((prev) => {
      // Insert template source before the GeneratedScene class definition
      const classPattern = /^class GeneratedScene\b/m
      const match = classPattern.exec(prev)
      if (match && match.index > 0) {
        return (
          prev.slice(0, match.index) +
          source +
          '\n\n\n' +
          prev.slice(match.index)
        )
      }
      // If no GeneratedScene found, append at the end
      return prev + '\n\n\n' + source
    })
    setStatus('Unsaved')
  }, [])

  const handleChatSend = useCallback(async (text: string) => {
    const editor = editorRef.current

    // Add user message to history
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setChatHistory((prev) => [...prev, userMsg])
    setIsChatting(true)
    setStatus('Refining...')

    try {
      // On first message, capture the sketch
      if (chatHistory.length === 0 && editor) {
        try {
          chatSketchRef.current = await exportCurrentPageAsPngBase64(editor)
        } catch {
          // Canvas might be empty — proceed without image
          chatSketchRef.current = null
        }
      }

      // Build the messages array for the Claude API
      const apiMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = []

      // First message always includes the sketch image (if available)
      const firstUserMsg = chatHistory.length === 0 ? userMsg : chatHistory[0]
      const firstContent: Array<Record<string, unknown>> = []
      if (chatSketchRef.current) {
        firstContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: chatSketchRef.current,
          },
        })
      }
      firstContent.push({ type: 'text', text: firstUserMsg.content })
      apiMessages.push({ role: 'user', content: firstContent })

      // Add the rest of the conversation history (skip the first user message, already added)
      const historyToReplay = chatHistory.length === 0 ? [] : chatHistory.slice(1)
      for (const msg of historyToReplay) {
        if (msg.role === 'assistant') {
          apiMessages.push({
            role: 'assistant',
            content: `\`\`\`python\n${msg.content}\n\`\`\``,
          })
        } else {
          apiMessages.push({ role: 'user', content: msg.content })
        }
      }

      // For follow-up messages, include the current editor code for context
      if (chatHistory.length > 0) {
        const currentCode = sceneCode
        apiMessages.push({
          role: 'user',
          content: `Here is the current Manim code:\n\`\`\`python\n${currentCode}\n\`\`\`\n\nPlease modify it: ${text}`,
        })
      }

      const componentNames = selectedComponents.size > 0
        ? Array.from(selectedComponents)
        : undefined

      const result = await api.chat(apiMessages, selectedModel, componentNames)

      if (!result.ok || !result.code) {
        setRenderLog(result.error ?? 'Unknown error during chat')
        setStatus('Chat failed')
        setIsChatting(false)
        return
      }

      // Add assistant message
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.code,
        timestamp: Date.now(),
        codeSnapshot: sceneCode, // save previous code for potential undo
      }
      setChatHistory((prev) => [...prev, assistantMsg])

      // Auto-apply the code
      setSceneCode(result.code)
      setStatus('Code updated')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setRenderLog(`Chat error: ${message}`)
      setStatus('Chat failed')
    } finally {
      setIsChatting(false)
    }
  }, [chatHistory, sceneCode, selectedModel, selectedComponents])

  const handleChatReset = useCallback(() => {
    setChatHistory([])
    chatSketchRef.current = null
  }, [])

  const handleCodeChange = useCallback((value: string | undefined) => {
    setSceneCode(value ?? '')
    setStatus('Unsaved')
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <StoryboardPanel
        pages={pages}
        currentPageId={currentPageId}
        onAddFrame={handleAddFrame}
        onSelectFrame={handleSelectFrame}
        onDeleteFrame={handleDeleteFrame}
      />
      <SketchPanel onMount={handleEditorMount} />
      <CodeRenderPanel
        code={sceneCode}
        onCodeChange={handleCodeChange}
        onSave={handleSave}
        onRender={handleRender}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        generatePrompt={generatePrompt}
        onGeneratePromptChange={setGeneratePrompt}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        renderQuality={renderQuality}
        onRenderQualityChange={setRenderQuality}
        renderLog={renderLog}
        videoUrl={videoUrl}
        isRendering={isRendering}
        status={status}
        latexAvailable={latexAvailable}
        onRefreshLatex={handleRefreshLatex}
        templateCategories={templateCategories}
        templateExamples={templateExamples}
        selectedComponents={selectedComponents}
        onSelectedComponentsChange={setSelectedComponents}
        onInsertCode={handleInsertCode}
        chatHistory={chatHistory}
        onChatSend={handleChatSend}
        onChatReset={handleChatReset}
        isChatting={isChatting}
      />
    </div>
  )
}
