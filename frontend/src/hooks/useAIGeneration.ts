import { useState, useRef, useCallback } from 'react'
import type { Editor } from 'tldraw'
import { api, ChatMessage, FrameImage } from '@/lib/api'
import { exportAllPagesAsPngBase64, PageExport } from '@/lib/exportSketch'

interface UseAIGenerationOptions {
  editorRef: React.RefObject<Editor | null>
  setStatus: (status: string) => void
  setRenderLog: (log: string) => void
}

export function useAIGeneration({ editorRef, setStatus, setRenderLog }: UseAIGenerationOptions) {
  const [sceneCode, setSceneCode] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5-20250929')
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set())
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [isChatting, setIsChatting] = useState(false)
  const chatSketchRef = useRef<PageExport[] | null>(null)

  const handleGenerate = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    setIsGenerating(true)
    setRenderLog('')
    setStatus('Generating...')

    try {
      const pageExports = await exportAllPagesAsPngBase64(editor)
      if (pageExports.length === 0) {
        setRenderLog('No shapes on any page to export.')
        setStatus('Generation failed')
        setIsGenerating(false)
        return
      }

      const images: FrameImage[] = pageExports.map((p) => ({
        name: p.pageName,
        base64: p.base64,
      }))

      const componentNames = selectedComponents.size > 0
        ? Array.from(selectedComponents)
        : undefined
      const result = await api.generate(
        images,
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
  }, [editorRef, generatePrompt, selectedModel, selectedComponents, setStatus, setRenderLog])

  const handleChatSend = useCallback(async (text: string) => {
    const editor = editorRef.current

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
      if (chatHistory.length === 0 && editor) {
        try {
          const pageExports = await exportAllPagesAsPngBase64(editor)
          chatSketchRef.current = pageExports.length > 0 ? pageExports : null
        } catch {
          chatSketchRef.current = null
        }
      }

      const apiMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = []

      const firstUserMsg = chatHistory.length === 0 ? userMsg : chatHistory[0]
      const firstContent: Array<Record<string, unknown>> = []
      if (chatSketchRef.current) {
        const frames = chatSketchRef.current
        for (let i = 0; i < frames.length; i++) {
          if (frames.length > 1) {
            firstContent.push({
              type: 'text',
              text: `[Frame ${i + 1}: ${frames[i].pageName}]`,
            })
          }
          firstContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: frames[i].base64,
            },
          })
        }
      }
      firstContent.push({ type: 'text', text: firstUserMsg.content })
      apiMessages.push({ role: 'user', content: firstContent })

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

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.code,
        timestamp: Date.now(),
        codeSnapshot: sceneCode,
      }
      setChatHistory((prev) => [...prev, assistantMsg])

      setSceneCode(result.code)
      setStatus('Code updated')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setRenderLog(`Chat error: ${message}`)
      setStatus('Chat failed')
    } finally {
      setIsChatting(false)
    }
  }, [editorRef, chatHistory, sceneCode, selectedModel, selectedComponents, setStatus, setRenderLog])

  const handleChatReset = useCallback(() => {
    setChatHistory([])
    chatSketchRef.current = null
  }, [])

  const handleInsertCode = useCallback((source: string) => {
    setSceneCode((prev) => {
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
      return prev + '\n\n\n' + source
    })
    setStatus('Unsaved')
  }, [setStatus])

  const handleCodeChange = useCallback((value: string | undefined) => {
    setSceneCode(value ?? '')
    setStatus('Unsaved')
  }, [setStatus])

  return {
    sceneCode,
    setSceneCode,
    isGenerating,
    generatePrompt,
    setGeneratePrompt,
    selectedModel,
    setSelectedModel,
    selectedComponents,
    setSelectedComponents,
    chatHistory,
    isChatting,
    handleGenerate,
    handleChatSend,
    handleChatReset,
    handleInsertCode,
    handleCodeChange,
  }
}
