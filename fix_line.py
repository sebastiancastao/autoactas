from pathlib import Path
path = Path('app/procesos/registro/page.tsx')
text = path.read_text(encoding='utf-8')
if 'registrados."' not in text:
    raise SystemExit('pattern missing')
text = text.replace('registrados."', 'registrados.', 1)
path.write_text(text, encoding='utf-8')
