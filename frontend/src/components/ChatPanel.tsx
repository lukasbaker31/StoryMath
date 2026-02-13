'use client'

import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '@/lib/api'

interface ChatPanelProps {
  chatHistory: ChatMessage[]
  onSendMessage: (text: string) => void
  onNewChat: () => void
  isChatting: boolean
}

export default function ChatPanel({
  chatHistory,
  onSendMessage,
  onNewChat,
  isChatting,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [chatHistory.length, isChatting])

  const handleSubmit = () => {
    const text = inputText.trim()
    if (!text || isChatting) return
    onSendMessage(text)
    setInputText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-2 border-b border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {chatHistory.length === 0
            ? 'Chat to generate and refine code'
            : `${chatHistory.length} message${chatHistory.length !== 1 ? 's' : ''}`}
        </span>
        {chatHistory.length > 0 && (
          <button
            onClick={onNewChat}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            New Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-2"
      >
        {chatHistory.length === 0 && !isChatting && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 text-xs space-y-2">
              <p>Describe what you want to animate.</p>
              <p className="text-gray-600">
                The sketch on the canvas will be included as context.
              </p>
              <p className="text-gray-600">
                After generating, send follow-up messages to refine the code.
              </p>
            </div>
          </div>
        )}

        {chatHistory.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-purple-700 text-white'
                  : 'bg-gray-700 text-gray-200'
              }`}
            >
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400">
                    Code updated ({msg.content.split('\n').length} lines)
                  </p>
                  <pre className="text-xs text-gray-500 max-h-20 overflow-y-auto whitespace-pre-wrap font-mono">
                    {msg.content.split('\n').slice(0, 5).join('\n')}
                    {msg.content.split('\n').length > 5 && '\n...'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        ))}

        {isChatting && (
          <div className="flex justify-start">
            <div className="bg-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400 animate-pulse">
              {chatHistory.length === 0
                ? 'Generating code...'
                : 'Refining code...'}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-gray-700 flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            chatHistory.length === 0
              ? 'Describe what to animate...'
              : 'Describe changes...'
          }
          disabled={isChatting}
          className="flex-1 px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
        />
        <button
          onClick={handleSubmit}
          disabled={isChatting || !inputText.trim()}
          className="px-3 py-1.5 text-sm bg-purple-700 hover:bg-purple-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white transition-colors"
        >
          {isChatting ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
