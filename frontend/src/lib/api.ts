const API_BASE = 'http://127.0.0.1:8000'

export interface LoadResponse {
  storyboard_json: Record<string, unknown> | null
  scene_code: string | null
  has_render: boolean
}

export interface RenderResponse {
  ok: boolean
  mp4_url: string | null
  log: string
}

export interface GenerateResponse {
  ok: boolean
  code: string | null
  error: string | null
}

export interface StatusResponse {
  latex_available: boolean
  template_count: number
}

export interface TemplateComponent {
  name: string
  category: string
  requires_latex: boolean
  base_classes: string[]
  char_count: number
}

export interface TemplateCategory {
  name: string
  label: string
  components: TemplateComponent[]
}

export interface TemplateExample {
  name: string
  requires_latex: boolean
  notebook: string
  char_count: number
}

export interface TemplatesResponse {
  categories: TemplateCategory[]
  examples: TemplateExample[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  codeSnapshot?: string
}

export interface ChatResponse {
  ok: boolean
  code: string | null
  error: string | null
}

export interface TemplateSourceResponse {
  name: string
  source: string
  requires_latex: boolean
  is_scene: boolean
}

export const api = {
  async load(): Promise<LoadResponse> {
    const res = await fetch(`${API_BASE}/api/load`)
    return res.json()
  },

  async save(
    storyboardJson: Record<string, unknown> | null,
    sceneCode: string | null
  ): Promise<{ ok: boolean }> {
    const res = await fetch(`${API_BASE}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyboard_json: storyboardJson,
        scene_code: sceneCode,
      }),
    })
    return res.json()
  },

  async render(sceneCode: string, quality: string = 'l'): Promise<RenderResponse> {
    const res = await fetch(`${API_BASE}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_code: sceneCode, quality }),
    })
    return res.json()
  },

  async generate(
    imageBase64: string,
    prompt: string,
    model: string = 'claude-sonnet-4-5-20250929',
    selectedComponents?: string[]
  ): Promise<GenerateResponse> {
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        prompt,
        model,
        selected_components: selectedComponents?.length ? selectedComponents : null,
      }),
    })
    return res.json()
  },

  async chat(
    messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
    model: string = 'claude-sonnet-4-5-20250929',
    selectedComponents?: string[]
  ): Promise<ChatResponse> {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model,
        selected_components: selectedComponents?.length ? selectedComponents : null,
      }),
    })
    return res.json()
  },

  async status(): Promise<StatusResponse> {
    const res = await fetch(`${API_BASE}/api/status`)
    return res.json()
  },

  async refreshStatus(): Promise<StatusResponse> {
    const res = await fetch(`${API_BASE}/api/status/refresh`, { method: 'POST' })
    return res.json()
  },

  async templates(): Promise<TemplatesResponse> {
    const res = await fetch(`${API_BASE}/api/templates`)
    return res.json()
  },

  async templateSource(name: string): Promise<TemplateSourceResponse> {
    const res = await fetch(`${API_BASE}/api/templates/${encodeURIComponent(name)}/source`)
    return res.json()
  },

  renderMp4Url(cacheBust?: boolean): string {
    const url = `${API_BASE}/api/render.mp4`
    return cacheBust ? `${url}?t=${Date.now()}` : url
  },
}
