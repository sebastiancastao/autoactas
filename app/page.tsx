import Link from "next/link";

const workflowSteps = [
  {
    step: "01",
    title: "Crear o seleccionar proceso",
    description:
      "Inicia en Procesos para registrar un caso nuevo o continuar uno existente.",
    href: "/procesos",
    cta: "Ir a Procesos",
  },
  {
    step: "02",
    title: "Programar y revisar agenda",
    description:
      "Consulta eventos y fechas clave para el seguimiento del proceso.",
    href: "/calendario",
    cta: "Ir a Calendario",
  },
  {
    step: "03",
    title: "Gestionar audiencia en Lista",
    description:
      "Registra asistencia, define el tipo de acta y genera el documento final.",
    href: "/lista",
    cta: "Ir a Lista",
  },
  {
    step: "04",
    title: "Cerrar el proceso",
    description:
      "Finaliza actuaciones y deja constancia del estado definitivo.",
    href: "/finalizacion",
    cta: "Ir a Finalizacion",
  },
] as const;

const secondaryLinks = [
  {
    href: "/perfil",
    title: "Perfil",
    description: "Actualiza datos del conciliador y firma.",
  },
  {
    href: "/consulta-publica",
    title: "Consulta publica",
    description: "Consulta procesos disponibles para visualizacion.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <section className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
          AutoActas
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Navegacion del proceso
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300 sm:text-base">
          Esta pagina es el punto de entrada del flujo. Sigue los pasos en
          orden para crear el proceso, gestionar la audiencia, programar
          actividades y finalizar las actas correctamente.
        </p>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {workflowSteps.map((item) => (
          <article
            key={item.step}
            className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-sm dark:border-white/10 dark:bg-white/5"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
              Paso {item.step}
            </p>
            <h2 className="mt-2 text-xl font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              {item.description}
            </p>
            <Link
              href={item.href}
              className="mt-4 inline-flex rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition hover:border-zinc-900 hover:text-zinc-950 dark:border-white/20 dark:text-zinc-100 dark:hover:border-white"
            >
              {item.cta}
            </Link>
          </article>
        ))}
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h3 className="text-lg font-semibold">Modulos complementarios</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {secondaryLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm transition hover:border-zinc-900 dark:border-white/10 dark:bg-white/5 dark:hover:border-white"
            >
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                {item.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
