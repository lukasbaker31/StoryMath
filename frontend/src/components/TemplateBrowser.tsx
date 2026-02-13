'use client'

import { useState, useCallback } from 'react'
import type {
  TemplateCategory,
  TemplateExample,
} from '@/lib/api'
import { api } from '@/lib/api'

interface TemplateBrowserProps {
  categories: TemplateCategory[]
  examples: TemplateExample[]
  selectedComponents: Set<string>
  onSelectedComponentsChange: (selected: Set<string>) => void
  onInsertCode: (source: string) => void
  latexAvailable: boolean
}

export default function TemplateBrowser({
  categories,
  examples,
  selectedComponents,
  onSelectedComponentsChange,
  onInsertCode,
  latexAvailable,
}: TemplateBrowserProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  )
  const [showExamples, setShowExamples] = useState(false)
  const [loadingInsert, setLoadingInsert] = useState<string | null>(null)

  const toggleCategory = useCallback((catName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(catName)) {
        next.delete(catName)
      } else {
        next.add(catName)
      }
      return next
    })
  }, [])

  const toggleComponent = useCallback(
    (name: string) => {
      const next = new Set(selectedComponents)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      onSelectedComponentsChange(next)
    },
    [selectedComponents, onSelectedComponentsChange]
  )

  const selectAllInCategory = useCallback(
    (components: { name: string }[]) => {
      const next = new Set(selectedComponents)
      components.forEach((c) => next.add(c.name))
      onSelectedComponentsChange(next)
    },
    [selectedComponents, onSelectedComponentsChange]
  )

  const deselectAllInCategory = useCallback(
    (components: { name: string }[]) => {
      const next = new Set(selectedComponents)
      components.forEach((c) => next.delete(c.name))
      onSelectedComponentsChange(next)
    },
    [selectedComponents, onSelectedComponentsChange]
  )

  const handleInsert = useCallback(
    async (name: string) => {
      setLoadingInsert(name)
      try {
        const result = await api.templateSource(name)
        if (result.requires_latex && !latexAvailable) {
          const proceed = window.confirm(
            `"${name}" uses MathTex which requires LaTeX.\n\nLaTeX is not currently installed. The code will fail to render until you install it:\n  brew install --cask basictex\n\nInsert anyway?`
          )
          if (!proceed) return
        }
        onInsertCode(result.source)
      } catch {
        alert(`Failed to load template source for "${name}"`)
      } finally {
        setLoadingInsert(null)
      }
    },
    [latexAvailable, onInsertCode]
  )

  const totalSelected = selectedComponents.size

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header with selection count */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {totalSelected > 0
            ? `${totalSelected} component${totalSelected !== 1 ? 's' : ''} selected for generation`
            : 'Select components to include when generating code'}
        </span>
        {totalSelected > 0 && (
          <button
            onClick={() => onSelectedComponentsChange(new Set())}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {categories.map((cat) => {
          const isExpanded = expandedCategories.has(cat.name)
          const selectedInCat = cat.components.filter((c) =>
            selectedComponents.has(c.name)
          ).length

          return (
            <div key={cat.name} className="rounded bg-gray-750">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat.name)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-gray-300 hover:bg-gray-700 rounded transition-colors"
              >
                <span className="text-xs text-gray-500 w-4">
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
                <span className="flex-1 text-left font-medium">
                  {cat.label}
                </span>
                <span className="text-xs text-gray-500">
                  {selectedInCat > 0 && (
                    <span className="text-blue-400 mr-1">
                      {selectedInCat}/
                    </span>
                  )}
                  {cat.components.length}
                </span>
              </button>

              {/* Expanded component list */}
              {isExpanded && (
                <div className="pb-1 px-1">
                  {cat.components.map((comp) => {
                    const isSelected = selectedComponents.has(comp.name)
                    const dimmed =
                      comp.requires_latex && !latexAvailable

                    return (
                      <div
                        key={comp.name}
                        className={`flex items-center gap-2 px-2 py-1 rounded text-sm ${
                          dimmed
                            ? 'opacity-50'
                            : 'hover:bg-gray-700'
                        } transition-colors`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleComponent(comp.name)}
                          className="shrink-0 accent-blue-500"
                        />
                        <span
                          className={`flex-1 truncate ${
                            isSelected
                              ? 'text-white'
                              : 'text-gray-400'
                          }`}
                        >
                          {comp.name}
                        </span>
                        <span className="text-xs text-gray-600 shrink-0">
                          {comp.base_classes.join(', ')}
                        </span>
                        {comp.requires_latex && (
                          <span
                            className={`text-xs px-1 rounded ${
                              latexAvailable
                                ? 'bg-green-900/50 text-green-400'
                                : 'bg-yellow-900/50 text-yellow-500'
                            }`}
                            title={
                              latexAvailable
                                ? 'Uses LaTeX (available)'
                                : 'Uses LaTeX (not installed)'
                            }
                          >
                            TeX
                          </span>
                        )}
                        <button
                          onClick={() => handleInsert(comp.name)}
                          disabled={loadingInsert === comp.name}
                          className="text-xs px-1.5 py-0.5 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 rounded text-gray-300 transition-colors shrink-0"
                          title="Insert into code editor"
                        >
                          {loadingInsert === comp.name
                            ? '...'
                            : 'Insert'}
                        </button>
                      </div>
                    )
                  })}

                  {/* Select all / Deselect all */}
                  <div className="flex gap-2 px-2 pt-1">
                    <button
                      onClick={() =>
                        selectAllInCategory(cat.components)
                      }
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() =>
                        deselectAllInCategory(cat.components)
                      }
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      Deselect all
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Examples section */}
        {examples.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-700">
            <button
              onClick={() => setShowExamples(!showExamples)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-gray-300 hover:bg-gray-700 rounded transition-colors"
            >
              <span className="text-xs text-gray-500 w-4">
                {showExamples ? '\u25BC' : '\u25B6'}
              </span>
              <span className="flex-1 text-left font-medium">
                Example Scenes
              </span>
              <span className="text-xs text-gray-500">
                {examples.length}
              </span>
            </button>

            {showExamples && (
              <div className="pb-1 px-1 max-h-48 overflow-y-auto">
                {examples.map((ex) => (
                  <div
                    key={ex.name}
                    className="flex items-center gap-2 px-2 py-1 rounded text-sm hover:bg-gray-700 transition-colors"
                  >
                    <span className="flex-1 truncate text-gray-400">
                      {ex.name}
                    </span>
                    {ex.requires_latex && (
                      <span
                        className={`text-xs px-1 rounded ${
                          latexAvailable
                            ? 'bg-green-900/50 text-green-400'
                            : 'bg-yellow-900/50 text-yellow-500'
                        }`}
                      >
                        TeX
                      </span>
                    )}
                    <button
                      onClick={() => handleInsert(ex.name)}
                      disabled={loadingInsert === ex.name}
                      className="text-xs px-1.5 py-0.5 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 rounded text-gray-300 transition-colors shrink-0"
                    >
                      {loadingInsert === ex.name ? '...' : 'Insert'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {categories.length === 0 && (
          <div className="text-center text-gray-500 text-xs py-8">
            No templates found. Add .ipynb files to manim_code_samples/
          </div>
        )}
      </div>
    </div>
  )
}
