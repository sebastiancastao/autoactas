from pathlib import Path
path = Path('app/lista/page.tsx')
text = path.read_text(encoding='utf-8')
old = '          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">\n            Marca qui\u00E9n est\u00E1 presente o ausente en segundos. Dise\u00F1o limpio y r\u00E1pido, estilo Apple.\n          </p>'
if old not in text:
    raise SystemExit('old block not found')
new = '          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">\n            Marca qui\u00E9n est\u00E1 presente o ausente en segundos. Dise\u00F1o limpio y r\u00E1pido, estilo Apple.\n            {(procesoId || eventoId) && (\n              <span className="block text-sm text-zinc-500 dark:text-zinc-400">\n                {procesoId && `Proceso ${procesoId}`}\n                {procesoId && eventoId && " - "}\n                {eventoId && `Evento ${eventoId}`}\n              </span>\n            )}\n          </p>'
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
