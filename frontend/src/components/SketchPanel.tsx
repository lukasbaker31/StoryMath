'use client'

import { useRef } from 'react'
import { Tldraw, inlineBase64AssetStore } from 'tldraw'
import 'tldraw/tldraw.css'
import type { Editor } from 'tldraw'

interface SketchPanelProps {
  onMount: (editor: Editor) => void
}

export default function SketchPanel({ onMount }: SketchPanelProps) {
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleMount = (editor: Editor) => {
    editorRef.current = editor
    onMount(editor)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const editor = editorRef.current
    const files = e.target.files
    if (!editor || !files || files.length === 0) return

    await editor.putExternalContent({
      type: 'files',
      files: Array.from(files),
      ignoreParent: false,
    })

    // Reset so the same file can be selected again
    e.target.value = ''
  }

  return (
    <div className="flex-1 relative min-w-0">
      <div className="absolute inset-0">
        <Tldraw onMount={handleMount} assets={inlineBase64AssetStore} autoFocus />
      </div>
      {/* Upload image button overlay */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="absolute top-2 right-2 z-10 bg-gray-800/80 hover:bg-gray-700 text-white text-xs px-2 py-1 rounded shadow"
        title="Upload an image to the canvas"
      >
        Upload Image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  )
}
