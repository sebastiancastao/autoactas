from pathlib import Path
lines = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8').splitlines()
for idx in range(220, 235):
    print(idx+1, repr(lines[idx]))
