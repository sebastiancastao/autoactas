from pathlib import Path
lines = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8').splitlines()
print(len(lines))
print('line 210 repr', repr(lines[209]))
print('line 270 repr', repr(lines[269]))
