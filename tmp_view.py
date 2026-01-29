from pathlib import Path
lines = Path('components/registro-form.tsx').read_text().splitlines()
for i in range(110, 160):
    print(f"{i+1:04}: {lines[i]}")
