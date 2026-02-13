"""
Template extraction and catalog for Manim component classes.

Parses Jupyter notebooks in manim_code_samples/ to extract reusable
component classes (VGroup subclasses, gates, atoms, etc.) and example
Scene classes, then serves them via a structured catalog.
"""

import ast
import json
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "manim_code_samples"

SCENE_BASES = {"Scene", "ThreeDScene", "MovingCameraScene", "ZoomedScene"}

# Map class names to categories
CATEGORY_MAP = {
    # Circuit elements
    "Node": "circuit_elements",
    "Wire": "circuit_elements",
    "Resistor": "circuit_elements",
    "Capacitor": "circuit_elements",
    "Inductor": "circuit_elements",
    "JosephsonJunction": "circuit_elements",
    "Ground": "circuit_elements",
    "ReferenceGrid": "circuit_elements",
    # Superconducting
    "CooperPairBox": "superconducting",
    "resonator": "superconducting",
    "TransistorSymbol": "superconducting",
    "SwitchSymbol": "superconducting",
    "Transmon": "superconducting",
    # Quantum gates
    "Hadamard": "quantum_gates",
    "Oracle": "quantum_gates",
    "Not": "quantum_gates",
    "Measurement": "quantum_gates",
    "Identity": "quantum_gates",
    "Zgate": "quantum_gates",
    "Cnot": "quantum_gates",
    "Register": "quantum_gates",
    # Atoms
    "GeneralAtom": "atoms",
    "NeutralAtom": "atoms",
    "RydbergAtom": "atoms",
    "MajoranaParticle": "atoms",
    # Spin
    "ElectronSpinObject": "spin",
    "SpinFlip": "spin",
    # Bloch sphere
    "BlochSphere": "bloch_sphere",
    # Complexity
    "ComplexityComparison": "complexity",
}

CATEGORY_LABELS = {
    "quantum_gates": "Quantum Gates",
    "circuit_elements": "Circuit Elements",
    "atoms": "Atoms & Particles",
    "bloch_sphere": "Bloch Sphere",
    "spin": "Electron Spin",
    "superconducting": "Superconducting Qubits",
    "complexity": "Complexity",
    "other": "Other",
}


@dataclass
class TemplateClass:
    name: str
    source: str
    base_classes: list[str]
    is_scene: bool
    requires_latex: bool
    category: str
    notebook: str  # which notebook it came from


def _extract_code_cells(notebook_path: Path) -> list[str]:
    """Read a .ipynb file and return the source of all code cells."""
    with open(notebook_path, "r", encoding="utf-8") as f:
        nb = json.load(f)

    cells = []
    for cell in nb.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        source = cell.get("source", [])
        if isinstance(source, list):
            text = "".join(source)
        else:
            text = source
        if text.strip():
            cells.append(text)
    return cells


def _extract_classes_from_source(source: str, notebook_name: str) -> list[TemplateClass]:
    """Use ast to extract top-level class definitions from Python source."""
    classes = []

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return classes

    lines = source.splitlines(keepends=True)

    for node in ast.iter_child_nodes(tree):
        if not isinstance(node, ast.ClassDef):
            continue

        base_names = []
        for base in node.bases:
            if isinstance(base, ast.Name):
                base_names.append(base.id)
            elif isinstance(base, ast.Attribute):
                base_names.append(ast.unparse(base))

        # Extract the source lines for this class
        start = node.lineno - 1
        # Find the end line: use end_lineno if available (Python 3.8+)
        end = getattr(node, "end_lineno", None)
        if end is None:
            # Fallback: find next class or end of source
            end = len(lines)
            for other in ast.iter_child_nodes(tree):
                if isinstance(other, ast.ClassDef) and other.lineno > node.lineno:
                    end = other.lineno - 1
                    # Walk back past blank lines
                    while end > start and not lines[end - 1].strip():
                        end -= 1
                    break

        class_source = "".join(lines[start:end]).rstrip()

        is_scene = bool(set(base_names) & SCENE_BASES)
        requires_latex = "MathTex" in class_source or "Tex(" in class_source

        category = CATEGORY_MAP.get(node.name, "examples" if is_scene else "other")

        classes.append(TemplateClass(
            name=node.name,
            source=class_source,
            base_classes=base_names,
            is_scene=is_scene,
            requires_latex=requires_latex,
            category=category,
            notebook=notebook_name,
        ))

    return classes


def _find_component_cell(cells: list[str]) -> str | None:
    """Find the large cell containing component class definitions.

    This is the cell with the most class definitions that are NOT Scene subclasses.
    """
    best_cell = None
    best_count = 0

    for cell_source in cells:
        try:
            tree = ast.parse(cell_source)
        except SyntaxError:
            continue

        component_count = 0
        for node in ast.iter_child_nodes(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            base_names = []
            for base in node.bases:
                if isinstance(base, ast.Name):
                    base_names.append(base.id)
            if not (set(base_names) & SCENE_BASES):
                component_count += 1

        if component_count > best_count:
            best_count = component_count
            best_cell = cell_source

    return best_cell


class TemplateCatalog:
    """Catalog of template classes extracted from Jupyter notebooks."""

    def __init__(self):
        self._components: list[TemplateClass] = []
        self._examples: list[TemplateClass] = []
        self._by_name: dict[str, TemplateClass] = {}
        self._load()

    def _load(self):
        if not SAMPLES_DIR.exists():
            return

        notebooks = sorted(SAMPLES_DIR.glob("*.ipynb"))
        if not notebooks:
            return

        seen_components: set[str] = set()
        seen_examples: set[str] = set()

        # Process each notebook
        for nb_path in notebooks:
            nb_name = nb_path.stem
            cells = _extract_code_cells(nb_path)

            # Find and extract the main component cell
            component_cell = _find_component_cell(cells)
            if component_cell:
                classes = _extract_classes_from_source(component_cell, nb_name)
                for cls in classes:
                    if not cls.is_scene and cls.name not in seen_components:
                        seen_components.add(cls.name)
                        self._components.append(cls)
                        self._by_name[cls.name] = cls

            # Extract Scene classes from all other cells
            for cell_source in cells:
                if cell_source == component_cell:
                    continue
                classes = _extract_classes_from_source(cell_source, nb_name)
                for cls in classes:
                    if cls.is_scene and cls.name not in seen_examples:
                        seen_examples.add(cls.name)
                        self._examples.append(cls)
                        self._by_name[cls.name] = cls

    def get_components(self) -> list[TemplateClass]:
        return list(self._components)

    def get_examples(self) -> list[TemplateClass]:
        return list(self._examples)

    def get_by_name(self, name: str) -> TemplateClass | None:
        return self._by_name.get(name)

    def get_by_category(self, category: str) -> list[TemplateClass]:
        return [c for c in self._components if c.category == category]

    def get_categories(self) -> list[dict]:
        """Return categories with their components for the frontend."""
        cats: dict[str, list[dict]] = {}
        for comp in self._components:
            cat = comp.category
            if cat not in cats:
                cats[cat] = []
            cats[cat].append({
                "name": comp.name,
                "category": cat,
                "requires_latex": comp.requires_latex,
                "base_classes": comp.base_classes,
                "char_count": len(comp.source),
            })

        result = []
        for cat_key, components in cats.items():
            result.append({
                "name": cat_key,
                "label": CATEGORY_LABELS.get(cat_key, cat_key.replace("_", " ").title()),
                "components": components,
            })
        return result

    def get_component_source(self, names: list[str] | None = None) -> str:
        """Return combined Python source for selected components.

        If names is None, return all components.
        """
        if names is None:
            targets = self._components
        else:
            name_set = set(names)
            targets = [c for c in self._components if c.name in name_set]

        if not targets:
            return ""

        parts = []
        for cls in targets:
            parts.append(cls.source)
        return "\n\n\n".join(parts)

    def get_summary(self) -> str:
        """Return a compact text summary of all components for inclusion in prompts."""
        lines = []
        current_cat = ""
        for comp in self._components:
            cat_label = CATEGORY_LABELS.get(comp.category, comp.category)
            if cat_label != current_cat:
                current_cat = cat_label
                lines.append(f"\n## {cat_label}")
            bases = ", ".join(comp.base_classes)
            latex_tag = " [uses LaTeX]" if comp.requires_latex else ""
            lines.append(f"- `{comp.name}` (extends {bases}){latex_tag}")
        return "\n".join(lines)

    def get_example_source(self, name: str) -> str | None:
        """Return the source for a specific example scene."""
        cls = self._by_name.get(name)
        if cls and cls.is_scene:
            return cls.source
        return None

    def get_examples_list(self) -> list[dict]:
        """Return examples list for the frontend."""
        return [
            {
                "name": ex.name,
                "requires_latex": ex.requires_latex,
                "notebook": ex.notebook,
                "char_count": len(ex.source),
            }
            for ex in self._examples
        ]


# Singleton catalog loaded at import time
catalog = TemplateCatalog()
