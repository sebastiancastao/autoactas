from pathlib import Path
text = Path('components/proceso-form.tsx').read_text().splitlines()
for i in range(320, 410):
    print(f"{i+1}: {text[i]}")
