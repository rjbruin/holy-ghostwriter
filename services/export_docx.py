from io import BytesIO

import markdown
from docx import Document



def markdown_to_docx_bytes(markdown_text: str) -> bytes:
    html = markdown.markdown(markdown_text or "")

    document = Document()

    for line in html.replace("</p>", "\n").replace("<p>", "").splitlines():
        plain = line
        for tag in ["<strong>", "</strong>", "<em>", "</em>", "<ul>", "</ul>", "<li>", "</li>", "<h1>", "</h1>", "<h2>", "</h2>", "<h3>", "</h3>"]:
            plain = plain.replace(tag, "")
        plain = plain.strip()
        if plain:
            document.add_paragraph(plain)

    output = BytesIO()
    document.save(output)
    output.seek(0)
    return output.read()
