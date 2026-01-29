from pathlib import Path
text = Path('components/proceso-form.tsx').read_text()
for i,line in enumerate(text.splitlines(),1):
    if 360 <= i <= 420:
        print(f"{i}: {line}")
