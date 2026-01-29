from pathlib import Path
lines = Path('components/proceso-form.tsx').read_text().splitlines()
for idx in range(380, 440):
    if idx < len(lines):
        print(f"{idx+1}: {lines[idx]}")
