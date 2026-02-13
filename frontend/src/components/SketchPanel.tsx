'use client'

import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import type { Editor } from 'tldraw'

interface SketchPanelProps {
  onMount: (editor: Editor) => void
}

export default function SketchPanel({ onMount }: SketchPanelProps) {
  return (
    <div className="flex-1 relative min-w-0">
      <div className="absolute inset-0">
        <Tldraw onMount={onMount} autoFocus />
      </div>
    </div>
  )
}
