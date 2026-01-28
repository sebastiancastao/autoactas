from pathlib import Path
text = Path('app/procesos/registro/page.tsx').read_text(encoding='utf-8')
idx = text.find('success: `${validRows.length}')
print(text[idx:idx+160])
print('line', text[idx:text.find('\n', idx)])
print('substr', text[idx:text.find('registrados', idx)+len('registrados')+2])
