"""Tests for template extraction and catalog in templates.py."""

import json
import tempfile
from pathlib import Path

import pytest

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from templates import (
    _extract_code_cells,
    _extract_classes_from_source,
    _find_component_cell,
    TemplateCatalog,
    catalog,
)


# ---------------------------------------------------------------------------
# _extract_code_cells
# ---------------------------------------------------------------------------


class TestExtractCodeCells:
    def test_extracts_code_cells_only(self, tmp_path):
        nb = {
            "cells": [
                {"cell_type": "markdown", "source": ["# Title"]},
                {"cell_type": "code", "source": ["print('hello')"]},
                {"cell_type": "code", "source": ["# empty stripped"], "outputs": []},
                {"cell_type": "markdown", "source": ["Some text"]},
                {"cell_type": "code", "source": ["x = 1"]},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 4,
        }
        nb_path = tmp_path / "test.ipynb"
        nb_path.write_text(json.dumps(nb))
        cells = _extract_code_cells(nb_path)
        assert len(cells) == 3
        assert cells[0] == "print('hello')"

    def test_handles_string_source(self, tmp_path):
        nb = {
            "cells": [
                {"cell_type": "code", "source": "single_string_source"},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 4,
        }
        nb_path = tmp_path / "test.ipynb"
        nb_path.write_text(json.dumps(nb))
        cells = _extract_code_cells(nb_path)
        assert len(cells) == 1
        assert cells[0] == "single_string_source"

    def test_skips_empty_code_cells(self, tmp_path):
        nb = {
            "cells": [
                {"cell_type": "code", "source": [""]},
                {"cell_type": "code", "source": ["  \n  "]},
                {"cell_type": "code", "source": ["real code"]},
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 4,
        }
        nb_path = tmp_path / "test.ipynb"
        nb_path.write_text(json.dumps(nb))
        cells = _extract_code_cells(nb_path)
        assert len(cells) == 1


# ---------------------------------------------------------------------------
# _extract_classes_from_source
# ---------------------------------------------------------------------------


class TestExtractClassesFromSource:
    def test_vgroup_subclass(self):
        source = "class MyGate(VGroup):\n    def __init__(self):\n        super().__init__()\n"
        classes = _extract_classes_from_source(source, "test_nb")
        assert len(classes) == 1
        assert classes[0].name == "MyGate"
        assert classes[0].is_scene is False
        assert classes[0].base_classes == ["VGroup"]

    def test_scene_subclass(self):
        source = "class MyScene(Scene):\n    def construct(self):\n        pass\n"
        classes = _extract_classes_from_source(source, "test_nb")
        assert len(classes) == 1
        assert classes[0].is_scene is True

    def test_requires_latex_mathtex(self):
        source = 'class S(Scene):\n    def construct(self):\n        t = MathTex(r"x^2")\n'
        classes = _extract_classes_from_source(source, "test_nb")
        assert len(classes) == 1
        assert classes[0].requires_latex is True

    def test_requires_latex_tex(self):
        source = 'class S(Scene):\n    def construct(self):\n        t = Tex("hello")\n'
        classes = _extract_classes_from_source(source, "test_nb")
        assert len(classes) == 1
        assert classes[0].requires_latex is True

    def test_no_latex_needed(self):
        source = 'class S(Scene):\n    def construct(self):\n        t = Text("hello")\n'
        classes = _extract_classes_from_source(source, "test_nb")
        assert len(classes) == 1
        assert classes[0].requires_latex is False

    def test_invalid_syntax_returns_empty(self):
        source = "class Broken(\n"
        classes = _extract_classes_from_source(source, "test_nb")
        assert classes == []

    def test_category_assignment(self):
        source = "class Hadamard(VGroup):\n    pass\n"
        classes = _extract_classes_from_source(source, "test_nb")
        assert len(classes) == 1
        assert classes[0].category == "quantum_gates"

    def test_unknown_category(self):
        source = "class UnknownThing(VGroup):\n    pass\n"
        classes = _extract_classes_from_source(source, "test_nb")
        assert len(classes) == 1
        assert classes[0].category == "other"


# ---------------------------------------------------------------------------
# _find_component_cell
# ---------------------------------------------------------------------------


class TestFindComponentCell:
    def test_finds_cell_with_most_components(self):
        cell_a = "class A(VGroup):\n    pass\nclass B(VGroup):\n    pass\nclass C(VGroup):\n    pass\n"
        cell_b = "class MyScene(Scene):\n    def construct(self):\n        pass\n"
        result = _find_component_cell([cell_a, cell_b])
        assert result == cell_a

    def test_empty_list_returns_none(self):
        assert _find_component_cell([]) is None

    def test_all_scenes_returns_none(self):
        cell = "class S1(Scene):\n    pass\nclass S2(Scene):\n    pass\n"
        # Scene subclasses are excluded from component count, so best_count stays 0
        assert _find_component_cell([cell]) is None


# ---------------------------------------------------------------------------
# TemplateCatalog (integration — uses real notebooks)
# ---------------------------------------------------------------------------


class TestCatalogIntegration:
    def test_components_not_empty(self):
        components = catalog.get_components()
        assert len(components) > 0

    def test_get_by_name_hadamard(self):
        h = catalog.get_by_name("Hadamard")
        assert h is not None
        assert h.name == "Hadamard"
        assert h.is_scene is False

    def test_get_component_source(self):
        source = catalog.get_component_source(["Hadamard"])
        assert len(source) > 0
        assert "Hadamard" in source

    def test_get_categories_structure(self):
        categories = catalog.get_categories()
        assert isinstance(categories, list)
        assert len(categories) > 0
        for cat in categories:
            assert "name" in cat
            assert "label" in cat
            assert "components" in cat
            assert isinstance(cat["components"], list)

    def test_get_examples_list(self):
        examples = catalog.get_examples_list()
        assert isinstance(examples, list)
        # We expect at least some example scenes
        assert len(examples) > 0
        for ex in examples:
            assert "name" in ex
            assert "requires_latex" in ex

    def test_get_summary_not_empty(self):
        summary = catalog.get_summary()
        assert len(summary) > 0
