from pathlib import Path
text = Path('components/proceso-form.tsx').read_text().splitlines()
for idx in range(188, 210):
    if idx < len(text):
        print(f"{idx+1}: {text[idx]}")
