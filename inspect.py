from pathlib import Path
text = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8')
import re
for match in re.finditer('registrados', text):
    snippet = text[match.start()-10:match.end()+10]
    print(snippet)
    print([ord(c) for c in text[match.start():match.start()+15]])
