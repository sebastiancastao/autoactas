from pathlib import Path
text = Path('app/lista/page.tsx').read_text(encoding='utf-8')
lines = text.splitlines()
for idx in range(230, 250):
    print(idx, repr(lines[idx]))
