from pathlib import Path
lines = Path('components/proceso-form.tsx').read_text(encoding='utf-8').splitlines()
for i in range(480, 660):
    print(f"{i+1:04}: {lines[i]}")
