"""Build slides.html (reveal.js from a CDN) with every screenshot and the diagram
embedded, so it still works when emailed.   python3 report/build_slides.py"""

import base64
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent


def img(name: str) -> str:
    data = base64.b64encode((HERE / "img" / name).read_bytes()).decode()
    return f'<img class="shot" src="data:image/jpeg;base64,{data}" alt="{name}">'


html = (HERE / "slides_template.html").read_text()
html = re.sub(r"\{\{IMG:([^}]+)\}\}", lambda m: img(m[1]), html)
html = html.replace("{{DIAGRAM}}", (HERE / "diagram.svg").read_text())
assert not re.findall(r"\{\{[^}]+\}\}", html), "unfilled placeholder"
(HERE / "slides.html").write_text(html)
print(f"slides.html written ({len(html) // 1024} KB), {html.count('<section')} slides")
