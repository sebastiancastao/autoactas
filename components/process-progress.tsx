"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

const STEPS = [
  {
    key: "proceso",
    label: "Proceso",
    description: "Define el expediente y el equipo asignado.",
  },
  {
    key: "calendario",
    label: "Calendario",
    description: "Agenda audiencias y talleres clave.",
  },
  {
    key: "inicializacion",
    label: "Inicializacion",
    description: "Prepara documentos iniciales.",
  },
  {
    key: "lista",
    label: "Lista",
    description: "Controla asistencia y registros.",
  },
  {
    key: "finalizacion",
    label: "Finalizacion",
    description: "Cierra el proceso con firma final.",
  },
] as const;

function normalizePathname(pathname: string | null | undefined) {
  if (!pathname) return "/";
  const [base] = pathname.split("?");
  return base;
}

function resolveStageIndex(pathname: string): number {
  const normalized = normalizePathname(pathname);

  if (normalized === "/" || normalized === "" || normalized.startsWith("/procesos")) {
    return 0;
  }
  if (normalized.startsWith("/calendario")) {
    return 1;
  }
  if (normalized.startsWith("/inicializacion")) {
    return 2;
  }
  if (normalized.startsWith("/lista")) {
    return 3;
  }
  if (normalized.startsWith("/finalizacion")) {
    return 4;
  }
  return 0;
}

export function ProcessProgress() {
  const pathname = usePathname();
  const activeIndex = useMemo(() => resolveStageIndex(pathname ?? "/"), [pathname]);

  return (
    <div className="border-b border-zinc-800 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-zinc-400">
                Proceso general
              </p>
              <p className="text-sm text-zinc-300">
                Sigue la ruta y mantente en el paso correcto del flujo.
              </p>
            </div>
            <div className="rounded-full border border-emerald-500 bg-zinc-800 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400 shadow-inner">
              Paso {activeIndex + 1} / {STEPS.length}
            </div>
          </div>

        <nav aria-label="Etapas del proceso" className="relative">
          <div
            className="pointer-events-none absolute inset-x-8 top-1/2 hidden h-px rounded-full bg-zinc-200 dark:bg-white/10 sm:block"
            aria-hidden="true"
          />
          <ol className="flex flex-col gap-6 text-[11px] uppercase sm:flex-row sm:items-center sm:gap-4">
            {STEPS.map((step, index) => {
              const isActive = index === activeIndex;
              const isDone = index < activeIndex;
              return (
                <li
                  key={step.key}
                  className="flex-1"
                  aria-current={isActive ? "step" : undefined}
                >
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-full border-2 bg-zinc-900 text-base font-semibold shadow transition duration-200 ${
                        isActive
                          ? "border-emerald-500 bg-emerald-500 text-white shadow-emerald-200/80"
                          : "border-zinc-700 text-zinc-500"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <span
                      className={`font-semibold tracking-[0.2em] ${
                        isActive ? "text-emerald-400" : "text-zinc-400"
                      }`}
                    >
                      {step.label}
                    </span>
                    <span className="text-[9px] font-medium uppercase tracking-[0.3em] text-zinc-500">
                      {step.description}
                    </span>
                    <span
                      className={`h-1 w-12 rounded-full transition ${
                        isActive
                          ? "bg-emerald-400"
                          : "bg-zinc-800 dark:bg-zinc-700"
                      }`}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
}
