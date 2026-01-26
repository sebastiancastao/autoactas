from pathlib import Path
text = Path('app/lista/page.tsx').read_text(encoding='utf-8')
start = text.index('<p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">')
end = text.index('</p>', start)
print(text[start:end+4])
