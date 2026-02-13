'use client'

import { useRef, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Editor from '@monaco-editor/react'
import type { ChatMessage, TemplateCategory, TemplateExample } from '@/lib/api'

const TemplateBrowser = dynamic(
  () => import('@/components/TemplateBrowser'),
  { ssr: false }
)

const ChatPanel = dynamic(
  () => import('@/components/ChatPanel'),
  { ssr: false }
)

const MODELS = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
]

const QUALITY_OPTIONS = [
  { value: 'l', label: 'Low (480p)' },
  { value: 'm', label: 'Medium (720p)' },
  { value: 'h', label: 'High (1080p)' },
]

type Tab = 'code' | 'templates' | 'chat'

interface CodeRenderPanelProps {
  code: string
  onCodeChange: (value: string | undefined) => void
  onSave: () => void
  onRender: () => void
  onGenerate: () => void
  isGenerating: boolean
  generatePrompt: string
  onGeneratePromptChange: (value: string) => void
  selectedModel: string
  onModelChange: (model: string) => void
  renderQuality: string
  onRenderQualityChange: (quality: string) => void
  renderLog: string
  videoUrl: string | null
  isRendering: boolean
  status: string
  // Template/LaTeX props
  latexAvailable: boolean
  onRefreshLatex: () => void
  templateCategories: TemplateCategory[]
  templateExamples: TemplateExample[]
  selectedComponents: Set<string>
  onSelectedComponentsChange: (selected: Set<string>) => void
  onInsertCode: (source: string) => void
  // Chat props
  chatHistory: ChatMessage[]
  onChatSend: (text: string) => void
  onChatReset: () => void
  isChatting: boolean
}

export default function CodeRenderPanel({
  code,
  onCodeChange,
  onSave,
  onRender,
  onGenerate,
  isGenerating,
  generatePrompt,
  onGeneratePromptChange,
  selectedModel,
  onModelChange,
  renderQuality,
  onRenderQualityChange,
  renderLog,
  videoUrl,
  isRendering,
  status,
  latexAvailable,
  onRefreshLatex,
  templateCategories,
  templateExamples,
  selectedComponents,
  onSelectedComponentsChange,
  onInsertCode,
  chatHistory,
  onChatSend,
  onChatReset,
  isChatting,
}: CodeRenderPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [activeTab, setActiveTab] = useState<Tab>('code')

  useEffect(() => {
    if (videoRef.current && videoUrl) {
      videoRef.current.load()
    }
  }, [videoUrl])

  const handleDownload = async () => {
    if (!videoUrl) return
    const res = await fetch(videoUrl)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'render.mp4'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const statusColor =
    status === 'Saved' || status === 'Ready' || status === 'Rendered' || status === 'Generated'
      ? 'bg-green-900 text-green-300'
      : status === 'Rendering...' || status === 'Saving...' || status === 'Loading...' || status === 'Generating...'
        ? 'bg-yellow-900 text-yellow-300'
        : status === 'Unsaved'
          ? 'bg-orange-900 text-orange-300'
          : 'bg-red-900 text-red-300'

  const selectClass =
    'px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500'

  return (
    <div className="w-[480px] bg-gray-800 border-l border-gray-700 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Code &amp; Render
          </h2>
          {/* LaTeX badge */}
          <button
            onClick={onRefreshLatex}
            className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
              latexAvailable
                ? 'bg-green-900/60 text-green-400 hover:bg-green-900'
                : 'bg-gray-700 text-gray-500 hover:bg-gray-600'
            }`}
            title={
              latexAvailable
                ? 'LaTeX is available - MathTex enabled. Click to re-check.'
                : 'LaTeX not installed. Run: brew install --cask basictex. Click to re-check.'
            }
          >
            {latexAvailable ? 'LaTeX' : 'No LaTeX'}
          </button>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${statusColor}`}>
          {status}
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('code')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'code'
              ? 'text-white border-b-2 border-blue-500 bg-gray-800'
              : 'text-gray-500 hover:text-gray-300 bg-gray-850'
          }`}
        >
          Code
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'templates'
              ? 'text-white border-b-2 border-blue-500 bg-gray-800'
              : 'text-gray-500 hover:text-gray-300 bg-gray-850'
          }`}
        >
          Templates
          {selectedComponents.size > 0 && (
            <span className="ml-1 px-1 py-0.5 text-xs bg-blue-600 rounded-full text-white">
              {selectedComponents.size}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'chat'
              ? 'text-white border-b-2 border-purple-500 bg-gray-800'
              : 'text-gray-500 hover:text-gray-300 bg-gray-850'
          }`}
        >
          Chat
          {chatHistory.length > 0 && (
            <span className="ml-1 px-1 py-0.5 text-xs bg-purple-600 rounded-full text-white">
              {chatHistory.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-[3] min-h-0">
        {activeTab === 'code' ? (
          <Editor
            height="100%"
            defaultLanguage="python"
            theme="vs-dark"
            value={code}
            onChange={onCodeChange}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        ) : activeTab === 'templates' ? (
          <TemplateBrowser
            categories={templateCategories}
            examples={templateExamples}
            selectedComponents={selectedComponents}
            onSelectedComponentsChange={onSelectedComponentsChange}
            onInsertCode={(source) => {
              onInsertCode(source)
              setActiveTab('code')
            }}
            latexAvailable={latexAvailable}
          />
        ) : (
          <ChatPanel
            chatHistory={chatHistory}
            onSendMessage={onChatSend}
            onNewChat={onChatReset}
            isChatting={isChatting}
          />
        )}
      </div>

      {/* Generate from Sketch */}
      <div className="p-2 border-t border-gray-700 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={generatePrompt}
            onChange={(e) => onGeneratePromptChange(e.target.value)}
            placeholder="Optional: describe what to animate..."
            disabled={isGenerating}
            className="flex-1 px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={onGenerate}
            disabled={isGenerating || isRendering}
            className="px-3 py-1.5 text-sm bg-purple-700 hover:bg-purple-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white transition-colors whitespace-nowrap"
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 shrink-0">Model:</label>
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isGenerating}
            className={selectClass}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {selectedComponents.size > 0 && (
            <span className="text-xs text-blue-400">
              +{selectedComponents.size} templates
            </span>
          )}
        </div>
      </div>

      {/* Action buttons + quality */}
      <div className="p-2 border-t border-gray-700 flex gap-2 items-center">
        <button
          onClick={onSave}
          className="flex-1 px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 rounded text-white transition-colors"
        >
          Save
        </button>
        <button
          onClick={onRender}
          disabled={isRendering}
          className="flex-1 px-3 py-1.5 text-sm bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white transition-colors"
        >
          {isRendering ? 'Rendering...' : 'Render'}
        </button>
        <select
          value={renderQuality}
          onChange={(e) => onRenderQualityChange(e.target.value)}
          disabled={isRendering}
          className={selectClass}
          title="Render quality"
        >
          {QUALITY_OPTIONS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      </div>

      {/* Bottom section: logs + video */}
      <div className="flex-[2] min-h-0 overflow-y-auto border-t border-gray-700">
        {/* Render logs */}
        {renderLog && (
          <div className="p-2 border-b border-gray-700">
            <h3 className="text-xs font-semibold text-gray-400 mb-1">
              Render Log
            </h3>
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
              {renderLog}
            </pre>
          </div>
        )}

        {/* Video preview */}
        {videoUrl && (
          <div className="p-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-gray-400">
                Preview
              </h3>
              <button
                onClick={handleDownload}
                className="px-2 py-0.5 text-xs bg-blue-700 hover:bg-blue-600 rounded text-white transition-colors"
              >
                Download MP4
              </button>
            </div>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              autoPlay
              className="w-full rounded bg-black"
            />
          </div>
        )}

        {!renderLog && !videoUrl && (
          <div className="flex items-center justify-center h-full text-gray-500 text-xs">
            Click &quot;Render&quot; to generate a preview
          </div>
        )}
      </div>
    </div>
  )
}
