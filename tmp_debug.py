from pathlib import Path
lines = Path('components/proceso-form.tsx').read_text().splitlines()
for idx in range(320, 380):
    print(f"{idx+1}: {lines[idx]}")
