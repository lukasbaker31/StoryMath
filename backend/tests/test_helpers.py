"""Tests for helper functions in main.py."""

from unittest.mock import patch

import pytest

import sys
from pathlib import Path

# Add backend to path so we can import main
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import extract_code_from_response, build_system_prompt, detect_latex


# ---------------------------------------------------------------------------
# extract_code_from_response
# ---------------------------------------------------------------------------


class TestExtractCode:
    def test_python_fenced_block(self):
        text = '```python\nfrom manim import *\nclass S(Scene): pass\n```'
        assert extract_code_from_response(text) == "from manim import *\nclass S(Scene): pass"

    def test_generic_fenced_block(self):
        text = '```\nsome code here\n```'
        assert extract_code_from_response(text) == "some code here"

    def test_no_fences(self):
        text = "from manim import *\nclass S(Scene): pass"
        assert extract_code_from_response(text) == text.strip()

    def test_surrounding_text_with_fenced_block(self):
        text = "Here is the code:\n```python\nprint('hello')\n```\nHope that helps!"
        assert extract_code_from_response(text) == "print('hello')"

    def test_multiple_code_blocks_returns_first_python(self):
        text = '```python\nfirst\n```\n\n```python\nsecond\n```'
        assert extract_code_from_response(text) == "first"

    def test_whitespace_stripping(self):
        text = '```python\n\n  code  \n\n```'
        assert extract_code_from_response(text) == "code"

    def test_empty_string(self):
        assert extract_code_from_response("") == ""

    def test_only_backticks_no_content(self):
        text = '```python\n```'
        assert extract_code_from_response(text) == ""


# ---------------------------------------------------------------------------
# build_system_prompt
# ---------------------------------------------------------------------------


class TestBuildSystemPrompt:
    def test_latex_enabled(self):
        prompt = build_system_prompt(latex_available=True)
        assert "MathTex" in prompt
        assert "LaTeX IS available" in prompt

    def test_latex_disabled(self):
        prompt = build_system_prompt(latex_available=False)
        assert "LaTeX is NOT available" in prompt
        assert "Text()" in prompt

    def test_with_selected_components(self):
        prompt = build_system_prompt(
            latex_available=False,
            selected_components=["Hadamard"],
        )
        # If Hadamard exists in catalog, its source should be in the prompt
        from templates import catalog
        hadamard = catalog.get_by_name("Hadamard")
        if hadamard:
            assert "AVAILABLE COMPONENT LIBRARY" in prompt
            assert "Hadamard" in prompt

    def test_without_components_includes_summary(self):
        prompt = build_system_prompt(latex_available=False, selected_components=None)
        from templates import catalog
        if catalog.get_components():
            assert "AVAILABLE COMPONENTS" in prompt or "AVAILABLE COMPONENT LIBRARY" in prompt


# ---------------------------------------------------------------------------
# detect_latex
# ---------------------------------------------------------------------------


class TestDetectLatex:
    @patch("shutil.which", return_value="/usr/bin/pdflatex")
    def test_returns_true_when_found(self, mock_which):
        assert detect_latex() is True

    @patch("shutil.which", return_value=None)
    @patch("pathlib.Path.exists", return_value=False)
    def test_returns_false_when_not_found(self, mock_exists, mock_which):
        assert detect_latex() is False
