# StoryMath

Sketch-to-animation tool: draw storyboard frames, generate Manim code via Claude, render MP4s.

## Quick Start

```bash
# Backend
cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8000

# Frontend
cd frontend && npm run dev
```

## Build & Test

```bash
# Frontend build
cd frontend && npx next build

# Backend tests
cd backend && venv/bin/python -m pytest tests/ -v
```

## Architecture

- **Frontend**: Next.js 14 (App Router) + tldraw v2 + Monaco Editor + Tailwind CSS
- **Backend**: FastAPI (Python) → Claude API for code generation, Manim for rendering
- **Hooks**: `useStoryboard` (pages/frames), `useRenderPipeline` (render/stitch), `useAIGeneration` (generate/chat)
- **Templates**: Jupyter notebooks in `manim_code_samples/` parsed via AST into reusable components

## Key Constraints

- LaTeX is NOT installed on this system — use `Text()` not `MathTex()`
- Client-only components (tldraw, Monaco) must use `dynamic()` with `ssr: false`
- Use `Array.from(set)` instead of `[...set]` spread (Next.js build fails with Set spread)
- tldraw uses a hidden `<textarea>` — keyboard handlers must check `.tl-container` ancestry
