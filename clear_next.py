import shutil
from pathlib import Path
path = Path('.next')
if path.exists():
    shutil.rmtree(path, ignore_errors=True)
