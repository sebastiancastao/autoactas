from pathlib import Path
import re
text = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8')
for match in re.finditer('registrados\.|registrados"', text):
    start = match.start()
    print(start, text[start-20:start+20])
