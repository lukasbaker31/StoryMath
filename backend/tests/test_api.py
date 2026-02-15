"""Tests for FastAPI endpoints in main.py."""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
import main
from main import app


@pytest.fixture()
def client(tmp_path):
    """Create a test client with isolated project/render dirs."""
    original_project_dir = main.PROJECT_DIR
    original_renders_dir = main.RENDERS_DIR
    original_renders_index = main.RENDERS_INDEX_PATH

    main.PROJECT_DIR = tmp_path / "project"
    main.RENDERS_DIR = main.PROJECT_DIR / "renders"
    main.RENDERS_INDEX_PATH = main.PROJECT_DIR / "renders.json"

    main.PROJECT_DIR.mkdir(parents=True, exist_ok=True)

    yield TestClient(app)

    main.PROJECT_DIR = original_project_dir
    main.RENDERS_DIR = original_renders_dir
    main.RENDERS_INDEX_PATH = original_renders_index


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


class TestStatus:
    def test_get_status(self, client):
        resp = client.get("/api/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "latex_available" in data
        assert "template_count" in data
        assert isinstance(data["template_count"], int)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


class TestTemplates:
    def test_get_templates(self, client):
        resp = client.get("/api/templates")
        assert resp.status_code == 200
        data = resp.json()
        assert "categories" in data
        assert "examples" in data
        assert isinstance(data["categories"], list)
        assert isinstance(data["examples"], list)

    def test_get_template_source_valid(self, client):
        # Use a template name we know exists
        resp = client.get("/api/templates/Hadamard/source")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Hadamard"
        assert "source" in data
        assert len(data["source"]) > 0

    def test_get_template_source_not_found(self, client):
        resp = client.get("/api/templates/NonexistentTemplate999/source")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Load / Save
# ---------------------------------------------------------------------------


class TestLoadSave:
    def test_load_empty_project(self, client):
        resp = client.get("/api/load")
        assert resp.status_code == 200
        data = resp.json()
        assert data["scene_code"] is not None
        assert "GeneratedScene" in data["scene_code"]
        assert data["has_render"] is False
        assert data["storyboard_json"] is None

    def test_load_existing_scene(self, client):
        scene = "from manim import *\nclass CustomScene(Scene): pass\n"
        (main.PROJECT_DIR / "scene.py").write_text(scene)

        resp = client.get("/api/load")
        assert resp.status_code == 200
        assert resp.json()["scene_code"] == scene

    def test_save_scene_code(self, client):
        resp = client.post("/api/save", json={"scene_code": "test code"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert (main.PROJECT_DIR / "scene.py").read_text() == "test code"

    def test_save_storyboard_json(self, client):
        sb = {"pages": [1, 2, 3]}
        resp = client.post("/api/save", json={"storyboard_json": sb})
        assert resp.status_code == 200
        saved = json.loads((main.PROJECT_DIR / "storyboard.tldr.json").read_text())
        assert saved == sb

    def test_save_both(self, client):
        resp = client.post(
            "/api/save",
            json={"scene_code": "code", "storyboard_json": {"k": "v"}},
        )
        assert resp.status_code == 200
        assert (main.PROJECT_DIR / "scene.py").read_text() == "code"


# ---------------------------------------------------------------------------
# Generate (no API key)
# ---------------------------------------------------------------------------


class TestGenerate:
    def test_generate_no_api_key(self, client):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}, clear=False):
            resp = client.post(
                "/api/generate",
                json={"prompt": "test", "images": [{"name": "f", "base64": "abc"}]},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is False
            assert "not configured" in data["error"].lower()


# ---------------------------------------------------------------------------
# Renders (library CRUD)
# ---------------------------------------------------------------------------


class TestRenders:
    def test_list_renders_empty(self, client):
        resp = client.get("/api/renders")
        assert resp.status_code == 200
        assert resp.json() == []

    def _seed_render(self, render_id="test-id-1", name="Render 1", quality="l"):
        """Helper to seed a render entry + dummy mp4."""
        main.RENDERS_DIR.mkdir(parents=True, exist_ok=True)
        renders = [
            {
                "id": render_id,
                "name": name,
                "created_at": "2025-01-01T00:00:00+00:00",
                "quality": quality,
            }
        ]
        main.RENDERS_INDEX_PATH.write_text(json.dumps(renders))
        (main.RENDERS_DIR / f"{render_id}.mp4").write_bytes(b"\x00" * 100)
        return render_id

    def test_list_renders_with_entry(self, client):
        self._seed_render()
        resp = client.get("/api/renders")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == "test-id-1"

    def test_rename_render(self, client):
        self._seed_render()
        resp = client.patch("/api/renders/test-id-1", json={"name": "New Name"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify persisted
        renders = json.loads(main.RENDERS_INDEX_PATH.read_text())
        assert renders[0]["name"] == "New Name"

    def test_rename_render_not_found(self, client):
        resp = client.patch("/api/renders/nonexistent", json={"name": "x"})
        assert resp.status_code == 404

    def test_delete_render(self, client):
        rid = self._seed_render()
        video_path = main.RENDERS_DIR / f"{rid}.mp4"
        assert video_path.exists()

        resp = client.delete(f"/api/renders/{rid}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify file deleted
        assert not video_path.exists()
        # Verify removed from index
        renders = json.loads(main.RENDERS_INDEX_PATH.read_text())
        assert len(renders) == 0

    def test_delete_render_not_found(self, client):
        resp = client.delete("/api/renders/nonexistent")
        assert resp.status_code == 404

    def test_get_render_video(self, client):
        self._seed_render()
        resp = client.get("/api/renders/test-id-1/video")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "video/mp4"

    def test_get_render_video_not_found(self, client):
        resp = client.get("/api/renders/nonexistent/video")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Stitch (validation only — no ffmpeg)
# ---------------------------------------------------------------------------


class TestStitch:
    def test_stitch_too_few_ids(self, client):
        resp = client.post("/api/renders/stitch", json={"render_ids": ["one"]})
        assert resp.status_code == 400

    def test_stitch_missing_render_id(self, client):
        resp = client.post(
            "/api/renders/stitch",
            json={"render_ids": ["missing1", "missing2"]},
        )
        assert resp.status_code == 404
