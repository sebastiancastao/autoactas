from pathlib import Path
lines = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8').splitlines()
print(lines[209])
print(repr(lines[209]))
print('---')
print(lines[269])
print(repr(lines[269]))
