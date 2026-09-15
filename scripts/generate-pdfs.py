#!/usr/bin/env python3
"""Generate submission PDFs from markdown sources (phase 19).

Uses `markdown` + `weasyprint` (pip install markdown weasyprint).
Outputs:
  docs/architecture.pdf          from docs/architecture.md
  docs/ai-tools-usage.pdf        from docs/ai-tools-usage.md
  docs/development-prompts.pdf   concatenated docs/development-prompts/NN-*.md
"""
import pathlib

import markdown
from weasyprint import HTML

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

CSS = """
@page { size: A4; margin: 2cm; }
body { font-family: sans-serif; font-size: 11pt; line-height: 1.5; color: #111; }
h1, h2, h3 { color: #064e3b; }
code { font-size: 9pt; background: #f0fdf4; padding: 1px 4px; border-radius: 3px; }
pre { background: #f6f6f4; padding: 12px; border-radius: 6px; font-size: 8.5pt; overflow-wrap: break-word; white-space: pre-wrap; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
blockquote { border-left: 3px solid #10b981; margin-left: 0; padding-left: 12px; color: #333; }
.page-break { page-break-before: always; }
"""


def md_to_html(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    return markdown.markdown(text, extensions=["tables", "fenced_code", "toc"])


def write_pdf(title: str, body_html: str, out: pathlib.Path) -> None:
    html = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body><h1>{title}</h1>{body_html}</body></html>"
    HTML(string=html).write_pdf(str(out))
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB)")


def main() -> None:
    write_pdf("AI Study Companion — Architecture", md_to_html(DOCS / "architecture.md"), DOCS / "architecture.pdf")
    write_pdf("AI Study Companion — AI Tools Usage", md_to_html(DOCS / "ai-tools-usage.md"), DOCS / "ai-tools-usage.pdf")

    parts = []
    for md in sorted((DOCS / "development-prompts").glob("[0-9]*-*.md")):
        parts.append(f"<div class='page-break'></div><h2>{md.name}</h2>" + md_to_html(md))
    write_pdf("AI Study Companion — Development Prompts", "".join(parts), DOCS / "development-prompts.pdf")


if __name__ == "__main__":
    main()
