from pathlib import Path
text = Path('components/proceso-form.tsx').read_text(encoding='utf-8')
start = text.index('const renderAcreedorRow')
end = start + 1000
print(text[start:start+800])
