from pathlib import Path
lines = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8').splitlines()
print(repr(lines[269]))
