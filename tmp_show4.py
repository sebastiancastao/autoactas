from pathlib import Path
lines = Path('components/proceso-form.tsx').read_text().splitlines()
for i in range(220, 270):
    print(f"{i+1}: {lines[i]}")
