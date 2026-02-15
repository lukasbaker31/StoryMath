'use client'

import { useState, useRef, useEffect } from 'react'
import type { SavedRender } from '@/lib/api'
import type { PageInfo } from '@/lib/types'

interface StoryboardPanelProps {
  pages: PageInfo[]
  currentPageId: string
  thumbnails: Map<string, string>
  onAddFrame: () => void
  onSelectFrame: (pageId: string) => void
  onDeleteFrame: (pageId: string) => void
  onReorderFrames: (fromIndex: number, toIndex: number) => void
  // Animation library props
  savedRenders: SavedRender[]
  activeRenderId: string | null
  onPreviewRender: (id: string) => void
  onRenameRender: (id: string, name: string) => void
  onDeleteRender: (id: string) => void
  onDownloadRender: (id: string, name: string) => void
  // Stitch props
  selectedRenderIds: Set<string>
  onSelectedRenderIdsChange: (ids: Set<string>) => void
  onStitchRenders: () => void
}

const QUALITY_LABELS: Record<string, string> = {
  l: '480p',
  m: '720p',
  h: '1080p',
}

export default function StoryboardPanel({
  pages,
  currentPageId,
  thumbnails,
  onAddFrame,
  onSelectFrame,
  onDeleteFrame,
  onReorderFrames,
  savedRenders,
  activeRenderId,
  onPreviewRender,
  onRenameRender,
  onDeleteRender,
  onDownloadRender,
  selectedRenderIds,
  onSelectedRenderIdsChange,
  onStitchRenders,
}: StoryboardPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Drag-and-drop state for frames
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  // Multi-select mode for stitch
  const [multiSelectMode, setMultiSelectMode] = useState(false)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const startRename = (render: SavedRender) => {
    setEditingId(render.id)
    setEditName(render.name)
  }

  const commitRename = () => {
    if (editingId && editName.trim()) {
      onRenameRender(editingId, editName.trim())
    }
    setEditingId(null)
  }

  const toggleRenderSelection = (id: string) => {
    const next = new Set(selectedRenderIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onSelectedRenderIdsChange(next)
  }

  return (
    <div className="w-56 bg-gray-800 border-r border-gray-700 flex flex-col shrink-0">
      {/* Storyboard section */}
      <div className="flex flex-col min-h-0 flex-1">
        <div className="p-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Storyboard
          </h2>
          <button
            onClick={onAddFrame}
            className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white transition-colors"
          >
            + Add Frame
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {pages.map((page, index) => {
            const thumb = thumbnails.get(page.id)
            return (
              <div
                key={page.id}
                draggable
                onDragStart={(e) => {
                  setDragIndex(index)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropIndex(index)
                }}
                onDragLeave={() => {
                  setDropIndex((prev) => (prev === index ? null : prev))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIndex !== null && dragIndex !== index) {
                    onReorderFrames(dragIndex, index)
                  }
                  setDragIndex(null)
                  setDropIndex(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setDropIndex(null)
                }}
                className={`group w-full text-left p-2 rounded text-sm transition-colors cursor-pointer ${
                  dragIndex === index ? 'opacity-50' : ''
                } ${
                  dropIndex === index && dragIndex !== index
                    ? 'border-t-2 border-blue-400'
                    : ''
                } ${
                  page.id === currentPageId
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                onClick={() => onSelectFrame(page.id)}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-12 h-8 rounded border flex items-center justify-center text-xs font-mono shrink-0 overflow-hidden ${
                      page.id === currentPageId
                        ? 'border-blue-400 bg-blue-500/20'
                        : 'border-gray-600 bg-gray-800'
                    }`}
                  >
                    {thumb ? (
                      <img
                        src={`data:image/png;base64,${thumb}`}
                        alt={`Frame ${index + 1}`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span className="truncate flex-1">{page.name}</span>
                  {pages.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteFrame(page.id)
                      }}
                      className={`opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs transition-opacity ${
                        page.id === currentPageId
                          ? 'hover:bg-blue-500 text-blue-200'
                          : 'hover:bg-gray-500 text-gray-400'
                      }`}
                      title="Delete frame"
                    >
                      X
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {pages.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">
              No frames yet
            </p>
          )}
        </div>
      </div>

      {/* Animations section */}
      <div className="flex flex-col min-h-0 flex-1 border-t border-gray-600">
        <div className="p-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Animations
          </h2>
          <div className="flex items-center gap-1">
            {multiSelectMode && selectedRenderIds.size >= 2 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onStitchRenders()
                }}
                className="px-2 py-0.5 text-[10px] bg-purple-600 hover:bg-purple-500 rounded text-white transition-colors"
              >
                Stitch ({selectedRenderIds.size})
              </button>
            )}
            {savedRenders.length >= 2 && (
              <button
                onClick={() => {
                  setMultiSelectMode((prev) => !prev)
                  if (multiSelectMode) {
                    onSelectedRenderIdsChange(new Set())
                  }
                }}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                  multiSelectMode
                    ? 'bg-purple-700 text-purple-100'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                }`}
              >
                Select
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {savedRenders.map((render) => (
            <div
              key={render.id}
              className={`group w-full text-left p-2 rounded text-sm transition-colors cursor-pointer ${
                render.id === activeRenderId
                  ? 'bg-green-700 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              onClick={() => {
                if (multiSelectMode) {
                  toggleRenderSelection(render.id)
                } else {
                  onPreviewRender(render.id)
                }
              }}
            >
              <div className="flex items-center gap-1.5">
                {multiSelectMode && (
                  <input
                    type="checkbox"
                    checked={selectedRenderIds.has(render.id)}
                    onChange={() => toggleRenderSelection(render.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 accent-purple-500"
                  />
                )}
                <span
                  className={`text-[10px] px-1 py-0.5 rounded shrink-0 ${
                    render.id === activeRenderId
                      ? 'bg-green-600 text-green-100'
                      : 'bg-gray-600 text-gray-400'
                  }`}
                >
                  {QUALITY_LABELS[render.quality] || render.quality}
                </span>
                {editingId === render.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-gray-900 text-white text-sm px-1 py-0 rounded border border-gray-500 outline-none"
                  />
                ) : (
                  <span
                    className="truncate flex-1"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startRename(render)
                    }}
                    title="Double-click to rename"
                  >
                    {render.name}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDownloadRender(render.id, render.name)
                  }}
                  className={`opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs transition-opacity ${
                    render.id === activeRenderId
                      ? 'hover:bg-green-600 text-green-200'
                      : 'hover:bg-gray-500 text-gray-400'
                  }`}
                  title="Download"
                >
                  &#8595;
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteRender(render.id)
                  }}
                  className={`opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs transition-opacity ${
                    render.id === activeRenderId
                      ? 'hover:bg-green-600 text-green-200'
                      : 'hover:bg-gray-500 text-gray-400'
                  }`}
                  title="Delete render"
                >
                  X
                </button>
              </div>
            </div>
          ))}
          {savedRenders.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">
              No renders yet
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
