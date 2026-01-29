from pathlib import Path
lines = Path('components/proceso-form.tsx').read_text().splitlines()
for i in range(260, 380):
    print(f"{i+1:04}: {lines[i]}")
