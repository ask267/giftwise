"""Build report.html: one self-contained file with every screenshot and the
diagram embedded, so it opens anywhere by double-clicking.

    python3 report/build_report.py
"""

import base64
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent


def img(name: str) -> str:
    data = base64.b64encode((HERE / "img" / name).read_bytes()).decode()
    return f'<img src="data:image/jpeg;base64,{data}" alt="{name}">'


html = (HERE / "report_template.html").read_text()
html = re.sub(r"\{\{IMG:([^}]+)\}\}", lambda m: img(m[1]), html)
html = html.replace("{{DIAGRAM}}", (HERE / "diagram.svg").read_text())
missing = re.findall(r"\{\{[^}]+\}\}", html)
assert not missing, f"unfilled placeholders: {missing}"
(HERE / "report.html").write_text(html)
print(f"report.html written ({len(html) // 1024} KB)")
