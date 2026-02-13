import json
import os
import re
import sys
import glob
import shutil
import subprocess
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from templates import catalog

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_DIR = Path(__file__).resolve().parent.parent / "projects" / "default"

DEFAULT_SCENE = '''from manim import *


class GeneratedScene(Scene):
    def construct(self):
        # Title text (uses Pango, no LaTeX required)
        title = Text("Hello, Manim!", font_size=72, color=BLUE)
        self.play(Write(title))
        self.wait(0.5)

        # Transform into a circle
        circle = Circle(radius=2, color=YELLOW, fill_opacity=0.3)
        self.play(Transform(title, circle))
        self.wait(0.5)

        # Add a square around it
        square = Square(side_length=4, color=GREEN)
        self.play(Create(square))
        self.wait(0.5)

        # Morph circle into a triangle
        triangle = Triangle(color=RED, fill_opacity=0.5).scale(2)
        self.play(
            Transform(title, triangle),
            square.animate.set_color(PURPLE),
        )
        self.wait(1)

        # Fade everything out
        self.play(FadeOut(title), FadeOut(square))
        self.wait(0.5)
'''


# ---------------------------------------------------------------------------
# LaTeX detection
# ---------------------------------------------------------------------------

def detect_latex() -> bool:
    """Check if pdflatex/xelatex is available for MathTex rendering."""
    search_paths = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/Library/TeX/texbin",
    ]
    for cmd in ("pdflatex", "xelatex", "latex"):
        if shutil.which(cmd):
            return True
        for p in search_paths:
            if (Path(p) / cmd).exists():
                return True
    return False


LATEX_AVAILABLE = detect_latex()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ensure_project_dir():
    PROJECT_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SaveRequest(BaseModel):
    storyboard_json: dict | None = None
    scene_code: str | None = None


class RenderRequest(BaseModel):
    scene_code: str
    quality: str = "l"  # l=480p, m=720p, h=1080p


class GenerateRequest(BaseModel):
    image_base64: str
    prompt: str = ""
    model: str = "claude-sonnet-4-5-20250929"
    selected_components: list[str] | None = None


# ---------------------------------------------------------------------------
# Dynamic system prompt for generation
# ---------------------------------------------------------------------------

BASE_SYSTEM_PROMPT = """You are an expert Manim developer specializing in quantum computing visualizations. You receive a rough hand-drawn sketch and must produce a polished Manim animation that captures the CONCEPT the user is communicating — NOT a literal reproduction of messy hand-drawn lines.

STEP 1 — ANALYZE (do this silently, do not output your analysis):
- Identify the conceptual elements: What objects, shapes, or ideas is the user trying to represent?
- Read any text or labels in the sketch for intent clues.
- Determine spatial relationships: What is above/below/beside what? What connects to what?
- Identify the likely animation flow: What should appear first? What transforms into what?
- Compare with the user's text prompt (if provided) to understand their goal.
- IGNORE drawing imperfections — a wobbly circle means "circle", a rough arrow means "arrow", messy handwriting should be interpreted as clean text.

STEP 2 — GENERATE: Produce clean, polished Manim code based on your analysis.

RULES:
1. Output EXACTLY ONE Python code block containing a complete, self-contained Manim scene.
2. The scene class MUST be named `GeneratedScene` and MUST inherit from `Scene` (or `ThreeDScene` for 3D content).
3. Use `from manim import *` as the only external import.
{latex_rules}
6. Create smooth, well-paced animations with `self.play()` and `self.wait()`.
7. Use clean geometric primitives (Circle, Square, Arrow, Line, etc.) — never try to replicate hand-drawn imperfections.
8. Use appropriate colors and spatial layout inspired by the sketch, but make everything polished and professional.
9. Keep the animation between 3-10 seconds total.
10. Do NOT use any external files, images, assets, SVGMobject, or SVG-related classes.
11. Ensure all objects fit within the default Manim frame (roughly -7 to 7 horizontal, -4 to 4 vertical).
{component_rules}
RESPOND WITH ONLY THE CODE BLOCK. No analysis, no explanations — just the code."""


LATEX_ENABLED_RULES = """4. You can use `MathTex()` and `Tex()` for mathematical notation. LaTeX IS available.
   - For Dirac notation: `MathTex(r'|\\psi\\rangle')`, `MathTex(r'\\langle\\phi|')`
   - For matrices: `MathTex(r'\\begin{pmatrix} a \\\\ b \\end{pmatrix}')`
   - For operators: `MathTex(r'\\hat{H}')`, `MathTex(r'\\sigma_x')`
   - For plain text labels, still prefer `Text()`.
5. For mathematical expressions, prefer `MathTex()` for proper typesetting."""

LATEX_DISABLED_RULES = """4. Use `Text()` (Pango) instead of `MathTex()` or `Tex()` for all text — LaTeX is NOT available.
5. For mathematical expressions, use Unicode characters within `Text()` (e.g., Text("x² + y² = r²"))."""


def build_system_prompt(
    latex_available: bool,
    selected_components: list[str] | None = None,
) -> str:
    latex_rules = LATEX_ENABLED_RULES if latex_available else LATEX_DISABLED_RULES

    component_rules = ""
    if selected_components:
        component_source = catalog.get_component_source(selected_components)
        if component_source:
            component_rules = f"""
AVAILABLE COMPONENT LIBRARY:
The following reusable component classes are available for you to use. Include their class definitions
BEFORE the GeneratedScene class in your output. Use them as building blocks instead of recreating from scratch.

```python
{component_source}
```

When using these components, include the full class definition(s) in your output so the code is self-contained.
"""

    # Always include the catalog summary so the AI knows what's available
    summary = catalog.get_summary()
    if summary.strip():
        if not component_rules:
            component_rules = f"""
AVAILABLE COMPONENTS (not included in this prompt, but the user may select them):
{summary}

If you need any of these components, recreate simplified versions based on the names and base classes shown above.
"""

    return BASE_SYSTEM_PROMPT.format(
        latex_rules=latex_rules,
        component_rules=component_rules,
    )


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/api/status")
def get_status():
    return {
        "latex_available": LATEX_AVAILABLE,
        "template_count": len(catalog.get_components()),
    }


@app.post("/api/status/refresh")
def refresh_status():
    global LATEX_AVAILABLE
    LATEX_AVAILABLE = detect_latex()
    return {"latex_available": LATEX_AVAILABLE}


@app.get("/api/templates")
def get_templates():
    return {
        "categories": catalog.get_categories(),
        "examples": catalog.get_examples_list(),
    }


@app.get("/api/templates/{name}/source")
def get_template_source(name: str):
    item = catalog.get_by_name(name)
    if not item:
        return JSONResponse({"error": f"Template '{name}' not found"}, status_code=404)
    return {
        "name": item.name,
        "source": item.source,
        "requires_latex": item.requires_latex,
        "is_scene": item.is_scene,
    }


@app.get("/api/load")
def load_project():
    ensure_project_dir()

    storyboard_json = None
    storyboard_path = PROJECT_DIR / "storyboard.tldr.json"
    if storyboard_path.exists():
        with open(storyboard_path, "r") as f:
            storyboard_json = json.load(f)

    scene_code = None
    scene_path = PROJECT_DIR / "scene.py"
    if scene_path.exists():
        with open(scene_path, "r") as f:
            scene_code = f.read()
    else:
        scene_code = DEFAULT_SCENE
        with open(scene_path, "w") as f:
            f.write(DEFAULT_SCENE)

    has_render = (PROJECT_DIR / "render.mp4").exists()

    return {
        "storyboard_json": storyboard_json,
        "scene_code": scene_code,
        "has_render": has_render,
    }


@app.post("/api/save")
def save_project(req: SaveRequest):
    ensure_project_dir()

    if req.storyboard_json is not None:
        with open(PROJECT_DIR / "storyboard.tldr.json", "w") as f:
            json.dump(req.storyboard_json, f, indent=2)

    if req.scene_code is not None:
        with open(PROJECT_DIR / "scene.py", "w") as f:
            f.write(req.scene_code)

    return {"ok": True}


@app.post("/api/render")
def render_scene(req: RenderRequest):
    ensure_project_dir()

    scene_path = PROJECT_DIR / "scene.py"
    with open(scene_path, "w") as f:
        f.write(req.scene_code)

    # Build env with Homebrew + LaTeX paths so ffmpeg/cairo/pdflatex are findable
    env = os.environ.copy()
    extra_paths = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"]
    if LATEX_AVAILABLE:
        extra_paths.append("/Library/TeX/texbin")
    existing = env.get("PATH", "")
    env["PATH"] = ":".join(extra_paths) + ":" + existing

    try:
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "manim",
                "render",
                f"-q{req.quality}",
                "--media_dir",
                str(PROJECT_DIR / "media"),
                str(scene_path),
                "GeneratedScene",
            ],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(PROJECT_DIR),
            env=env,
        )

        log = result.stdout + "\n" + result.stderr
        with open(PROJECT_DIR / "render.log", "w") as f:
            f.write(log)

        mp4_files = glob.glob(
            str(PROJECT_DIR / "media" / "**" / "*.mp4"), recursive=True
        )

        if mp4_files and result.returncode == 0:
            latest = max(mp4_files, key=os.path.getmtime)
            shutil.copy2(latest, str(PROJECT_DIR / "render.mp4"))
            return {"ok": True, "mp4_url": "/api/render.mp4", "log": log}
        else:
            return {"ok": False, "mp4_url": None, "log": log}

    except subprocess.TimeoutExpired:
        log = "Render timed out after 120 seconds."
        with open(PROJECT_DIR / "render.log", "w") as f:
            f.write(log)
        return {"ok": False, "mp4_url": None, "log": log}

    except Exception as e:
        log = f"Render error: {str(e)}"
        with open(PROJECT_DIR / "render.log", "w") as f:
            f.write(log)
        return {"ok": False, "mp4_url": None, "log": log}


def extract_code_from_response(response_text: str) -> str:
    """Extract Python code from Claude's markdown-fenced response."""
    match = re.search(r"```python\s*(.*?)\s*```", response_text, re.DOTALL)
    if match:
        return match.group(1).strip()
    if "```" in response_text:
        match = re.search(r"```\s*(.*?)\s*```", response_text, re.DOTALL)
        return match.group(1).strip() if match else response_text.strip()
    return response_text.strip()


class ChatRequest(BaseModel):
    messages: list[dict]
    model: str = "claude-sonnet-4-5-20250929"
    selected_components: list[str] | None = None


@app.post("/api/generate")
def generate_from_sketch(req: GenerateRequest):
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "ok": False,
            "code": None,
            "error": "ANTHROPIC_API_KEY not configured. Add it to backend/.env",
        }

    system_prompt = build_system_prompt(
        latex_available=LATEX_AVAILABLE,
        selected_components=req.selected_components,
    )

    user_text = req.prompt.strip() if req.prompt else "Generate Manim code that recreates this sketch as an animation."

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=req.model,
            max_tokens=8192,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": req.image_base64,
                            },
                        },
                        {"type": "text", "text": user_text},
                    ],
                }
            ],
        )

        response_text = message.content[0].text
        code = extract_code_from_response(response_text)
        return {"ok": True, "code": code, "error": None}

    except anthropic.AuthenticationError:
        return {
            "ok": False,
            "code": None,
            "error": "Authentication failed: check your ANTHROPIC_API_KEY.",
        }
    except anthropic.RateLimitError:
        return {
            "ok": False,
            "code": None,
            "error": "Rate limit exceeded. Try again in a moment.",
        }
    except anthropic.APIError as e:
        return {"ok": False, "code": None, "error": f"Claude API error: {e}"}
    except Exception as e:
        return {"ok": False, "code": None, "error": f"Generation error: {e}"}


@app.post("/api/chat")
def chat_refine(req: ChatRequest):
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "ok": False,
            "code": None,
            "error": "ANTHROPIC_API_KEY not configured. Add it to backend/.env",
        }

    system_prompt = build_system_prompt(
        latex_available=LATEX_AVAILABLE,
        selected_components=req.selected_components,
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=req.model,
            max_tokens=8192,
            system=system_prompt,
            messages=req.messages,
        )

        response_text = message.content[0].text
        code = extract_code_from_response(response_text)
        return {"ok": True, "code": code, "error": None}

    except anthropic.AuthenticationError:
        return {
            "ok": False,
            "code": None,
            "error": "Authentication failed: check your ANTHROPIC_API_KEY.",
        }
    except anthropic.RateLimitError:
        return {
            "ok": False,
            "code": None,
            "error": "Rate limit exceeded. Try again in a moment.",
        }
    except anthropic.APIError as e:
        return {"ok": False, "code": None, "error": f"Claude API error: {e}"}
    except Exception as e:
        return {"ok": False, "code": None, "error": f"Chat error: {e}"}


@app.get("/api/render.mp4")
def serve_render():
    mp4_path = PROJECT_DIR / "render.mp4"
    if not mp4_path.exists():
        return JSONResponse({"error": "No render available"}, status_code=404)
    return FileResponse(
        str(mp4_path),
        media_type="video/mp4",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )
