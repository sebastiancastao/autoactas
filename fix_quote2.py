from pathlib import Path
path = Path('app/procesos/registro/page.tsx')
text = path.read_text(encoding='utf-8')
old = 'registrados.",'
new = 'registrados.`,'
if old not in text:
    raise SystemExit('pattern missing')
text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
