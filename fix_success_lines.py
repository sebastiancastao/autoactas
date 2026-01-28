from pathlib import Path
path = Path('app/procesos/registro/page.tsx')
text = path.read_text(encoding='utf-8')
patterns = [
    ('success: `${validRows.length} deudor${validRows.length === 1 ? "" : "es"} registrados.\",',
     'success: `${validRows.length} deudor${validRows.length === 1 ? "" : "es"} registrados.`,','",
    ('success: `${validRows.length} acreedor${validRows.length === 1 ? "" : "es"} registrados.\",',
     'success: `${validRows.length} acreedor${validRows.length === 1 ? "" : "es"} registrados.`,')
]
for old, new in patterns:
    if old not in text:
        raise SystemExit(f'pattern missing: {old}')
    text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
