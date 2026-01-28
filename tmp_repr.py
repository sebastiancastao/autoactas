from pathlib import Path
lines = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8').splitlines()
for i in range(263, 275):
    print(i+1, repr(lines[i]))
