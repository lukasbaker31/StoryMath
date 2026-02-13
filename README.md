# StoryMath

A local app for sketching storyboards and generating/rendering Manim animations with AI assistance. Built for creating quantum computing explainer videos.

## Architecture

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + tldraw v2 + Monaco Editor
- **Backend**: FastAPI (Python) on port 8000
- **Rendering**: Manim Community Edition via subprocess
- **AI Generation**: Claude API (Anthropic) for sketch-to-code and iterative refinement

## Setup

### 1. System Prerequisites (macOS)

```bash
brew install ffmpeg cairo pkg-config
```

Optional — for LaTeX math rendering (`MathTex`, `Tex`):

```bash
brew install --cask basictex
sudo /Library/TeX/texbin/tlmgr update --self
sudo /Library/TeX/texbin/tlmgr install standalone preview doublestroke setspace rsfs relsize ragged2e fundus-calligra microtype wasysym physics dvisvgm collection-fontsrecommended
```

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Start the backend:

```bash
uvicorn main:app --reload --port 8000
```

### 3. API Key

Copy the example env file and add your Anthropic API key:

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and set your ANTHROPIC_API_KEY
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Features

- **Storyboard Frames** — Multi-page tldraw canvas for planning animation sequences
- **Sketch-to-Code** — Draw on the canvas, then generate Manim code from the sketch via Claude
- **Iterative Chat** — Refine generated code through multi-turn conversation ("make the rotation slower", "add axis labels")
- **Template Library** — Pre-built quantum computing components (gates, circuits, Bloch spheres, atoms) from Jupyter notebooks
- **LaTeX Support** — Automatic detection; uses `MathTex`/`Tex` when available, falls back to `Text()` when not
- **Live Preview** — Render animations at 480p/720p/1080p and preview inline
- **Monaco Editor** — Full Python editor with syntax highlighting

## Usage

1. **Storyboard (left)**: Add frames to plan your animation sequence
2. **Canvas (center)**: Sketch what you want to animate using tldraw
3. **Code & Render (right)**:
   - **Code tab**: Edit Manim code directly in the Monaco editor
   - **Templates tab**: Browse and select quantum computing component templates
   - **Chat tab**: Describe what you want and iteratively refine the code
   - Click **Generate** for single-shot sketch-to-code generation
   - Click **Render** to produce an MP4 preview

## Project Files

Projects are stored in `./projects/default/` (gitignored):

- `storyboard.tldr.json` — tldraw document state
- `scene.py` — Manim scene code
- `render.mp4` — Latest render output
- `render.log` — Latest render logs
