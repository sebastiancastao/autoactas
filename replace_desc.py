from pathlib import Path
path = Path('app/lista/page.tsx')
text = path.read_text(encoding='utf-8')
old = "Marca qui\u00E9n est\u00E1 presente o ausente en segundos. Dise\u00F1o limpio y r\u00E1pido, estilo Apple."
if old not in text:
    raise SystemExit('old string not found')
new = old + '\n            {(procesoId || eventoId) && (\n              <span className="block text-sm text-zinc-500 dark:text-zinc-400">\n                {procesoId && `Proceso ${procesoId}`}\n                {procesoId && eventoId && " - "}\n                {eventoId && `Evento ${eventoId}`}\n              </span>\n            )}'
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
