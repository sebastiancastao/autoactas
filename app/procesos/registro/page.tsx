"use client";

import Link from "next/link";

import ProcesoForm from "@/components/proceso-form";
import { useProcesoForm } from "@/lib/hooks/useProcesoForm";

export default function RegistroProcesosPage() {
  const form = useProcesoForm();

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Registro técnico
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Registro de acreedores y deudor
            </h1>
            <Link
              href="/procesos"
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
            >
              Volver a procesos
            </Link>
          </div>
          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Crea un proceso y registra al deudor, acreedores y apoderados en un solo flujo.
            Usa el formulario para capturar la información jurídica y pulsa el botón cuando tengas
            todo listo.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">
          <div>
            <ProcesoForm form={form} />
          </div>
          <aside className="hidden rounded-3xl border border-zinc-200 bg-white/80 p-5 text-sm text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 lg:block">
            <h2 className="text-xs uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-500">
              Consejos rápidos
            </h2>
            <p className="mt-3 text-sm text-zinc-900 dark:text-zinc-100">
              Aprovecha este espacio para crear procesos limpios y completos antes de notificar a
              los equipos jurídicos o financieros.
            </p>
            <ul className="mt-4 space-y-3 text-[13px] leading-snug">
              <li>1. Ingresa el número y la fecha exacta del expediente judicial.</li>
              <li>2. Completa al menos un acreedor y un deudor para mantener el proceso activo.</li>
              <li>3. Usa el modal de apoderado para vincular representantes claros.</li>
            </ul>
            <p className="mt-4 text-[11px] uppercase tracking-[0.4em] text-zinc-400 dark:text-zinc-500">
              Datos protegidos
            </p>
            <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
              La información se almacena encriptada y solo se comparte con el equipo autorizado.
            </p>
          </aside>
        </section>
      </main>
    </div>
  );
}
