import Link from "next/link";
import { AuthCodeRecoveryRedirect } from "@/components/auth-code-recovery-redirect";

const workflowSteps = [
  {
    id: "01",
    title: "Crear o seleccionar proceso",
    description: "Define el expediente y prepara los participantes antes de programar audiencias.",
    href: "/procesos",
    cta: "Abrir Procesos",
    badge: "Inicio",
  },
  {
    id: "02",
    title: "Programar agenda",
    description: "Organiza reuniones, audiencias y fechas limite desde una sola vista.",
    href: "/calendario",
    cta: "Abrir Calendario",
    badge: "Planeacion",
  },
  {
    id: "03",
    title: "Inicializar documentos",
    description: "Genera el auto admisorio y deja listo el arranque documental del caso.",
    href: "/inicializacion",
    cta: "Abrir Inicializacion",
    badge: "Inicializacion",
  },
  {
    id: "04",
    title: "Audiencia",
    description: "Controla asistencia, documentos y decisiones para la audiencia activa.",
    href: "/lista",
    cta: "Abrir Lista",
    badge: "Operacion",
  },
] as const;

const supportModules = [
  {
    href: "/perfil",
    title: "Perfil del conciliador",
    description: "Actualiza datos personales y firma digital.",
  },
  {
    href: "/consulta-publica",
    title: "Consulta publica",
    description: "Visualiza la informacion publicada de apoderados y acreedores.",
  },
] as const;

const quickTips = [
  "Empieza siempre desde Procesos para mantener el flujo sincronizado.",
  "Si retomas un caso, valida primero su etapa en la barra superior.",
  "En Lista, deja agendada la proxima audiencia antes de cerrar.",
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-7xl 2xl:max-w-[96rem]">
      <AuthCodeRecoveryRedirect />
      <section className="rounded-3xl border border-zinc-200 bg-white/85 p-6 shadow-[0_12px_45px_-24px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Centro de control
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Gestiona el proceso sin perder contexto
            </h1>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300 sm:text-base">
              Usa esta vista como entrada principal. Cada tarjeta te lleva al siguiente paso operativo
              para reducir cambios de contexto y tiempos muertos.
            </p>
          </div>

          <div className="grid w-full gap-2 rounded-2xl border border-zinc-200 bg-white/75 p-4 text-sm shadow-sm sm:w-auto sm:min-w-[220px] dark:border-white/10 dark:bg-white/5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500 dark:text-zinc-400">
              Atajos
            </p>
            <Link
              href="/procesos"
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100 dark:hover:border-white"
            >
              Crear proceso nuevo
            </Link>
            <Link
              href="/calendario"
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100 dark:hover:border-white"
            >
              Revisar agenda de hoy
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {workflowSteps.map((item) => (
          <article
            key={item.id}
            className="group rounded-3xl border border-zinc-200 bg-white/85 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/5"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                Paso {item.id}
              </p>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                {item.badge}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">{item.title}</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{item.description}</p>
            <Link
              href={item.href}
              className="mt-5 inline-flex rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:border-zinc-900 hover:text-zinc-950 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100 dark:hover:border-white"
            >
              {item.cta}
            </Link>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-3xl border border-zinc-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <h3 className="text-lg font-semibold">Modulos complementarios</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {supportModules.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl border border-zinc-200 bg-white/75 px-4 py-3 text-sm transition hover:border-zinc-900 dark:border-white/10 dark:bg-white/5 dark:hover:border-white"
              >
                <p className="font-semibold">{item.title}</p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{item.description}</p>
              </Link>
            ))}
          </div>
        </div>

        <aside className="rounded-3xl border border-zinc-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <h3 className="text-lg font-semibold">Recomendaciones rapidas</h3>
          <ul className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
            {quickTips.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </main>
  );
}
