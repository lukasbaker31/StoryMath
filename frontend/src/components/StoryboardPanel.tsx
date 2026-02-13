'use client'

interface PageInfo {
  id: string
  name: string
}

interface StoryboardPanelProps {
  pages: PageInfo[]
  currentPageId: string
  onAddFrame: () => void
  onSelectFrame: (pageId: string) => void
  onDeleteFrame: (pageId: string) => void
}

export default function StoryboardPanel({
  pages,
  currentPageId,
  onAddFrame,
  onSelectFrame,
  onDeleteFrame,
}: StoryboardPanelProps) {
  return (
    <div className="w-56 bg-gray-800 border-r border-gray-700 flex flex-col shrink-0">
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
        {pages.map((page, index) => (
          <div
            key={page.id}
            className={`group w-full text-left p-2 rounded text-sm transition-colors cursor-pointer ${
              page.id === currentPageId
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            onClick={() => onSelectFrame(page.id)}
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-12 h-8 rounded border flex items-center justify-center text-xs font-mono shrink-0 ${
                  page.id === currentPageId
                    ? 'border-blue-400 bg-blue-500/20'
                    : 'border-gray-600 bg-gray-800'
                }`}
              >
                {index + 1}
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
        ))}
        {pages.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">
            No frames yet
          </p>
        )}
      </div>
    </div>
  )
}
