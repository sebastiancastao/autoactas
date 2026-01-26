from pathlib import Path
text = Path('app/lista/page.tsx').read_text(encoding='utf-8')
start = text.index('Marca')
snippet = text[start:start+120]
print(snippet)
print([hex(ord(c)) for c in snippet[:20]])
