from pathlib import Path
path = Path('app/procesos/registro/page.tsx')
lines = path.read_text(encoding='utf-8').splitlines()
lines[209] = '        success: `${validRows.length} deudor${validRows.length === 1 ? "" : "es"} registrados.`, '
lines[269] = '        success: `${validRows.length} acreedor${validRows.length === 1 ? "" : "es"} registrados.`, '
path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
