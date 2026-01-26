
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getProcesos } from "@/lib/api/proceso";
import type { Proceso } from "@/lib/database.types";
import ProcesoForm from "@/components/proceso-form";
import { useProcesoForm } from "@/lib/hooks/useProcesoForm";

export default function ProcesosPage() {
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const handleSaveSuccess = useCallback((savedProceso: Proceso) => {
    setProcesos((prev) => {
      const exists = prev.some((proceso) => proceso.id === savedProceso.id);
      if (exists) {
        return prev.map((proceso) =>
          proceso.id === savedProceso.id ? savedProceso : proceso
        );
      }
      return [savedProceso, ...prev];
    });
  }, []);

  const form = useProcesoForm({ onSaveSuccess: handleSaveSuccess });
  const { editingProcesoId, cargandoDetalle, cargarProcesoDetalle } = form;

  useEffect(() => {
    async function loadProcesos() {
      setCargando(true);
      setListError(null);
      try {
        const data = await getProcesos();
        setProcesos(data || []);
      } catch (err) {
        console.error("Error fetching procesos:", err);
        setListError("Error al cargar los procesos");
      } finally {
        setCargando(false);
      }
    }
    loadProcesos();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Procesos
          </div>
          <div className="mt-4">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Procesos</h1>
            <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
              Gestiona los procesos judiciales. Crea nuevos procesos y visualiza los existentes.
            </p>
          </div>
        </header>

        <nav className="mb-8 flex flex-wrap gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Inicio
          </Link>
          <Link
            href="/calendario"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Calendario
          </Link>
          <Link
            href="/lista"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Asistencia
          </Link>
          <Link
            href="/finalizacion"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            FinalizaciÃ³n
          </Link>
        </nav>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ProcesoForm form={form} />

          <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Procesos Existentes</h2>
            {listError && (
              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {listError}
              </div>
            )}

            {cargando ? (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Cargando procesos...</div>
            ) : procesos.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                No hay procesos registrados.
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {procesos.map((proceso) => {
                  const isSelected = editingProcesoId === proceso.id;
                  return (
                    <button
                      key={proceso.id}
                      type="button"
                      onClick={() => cargarProcesoDetalle(proceso.id)}
                      disabled={cargandoDetalle && !isSelected}
                      className={[
                        "w-full text-left transition",
                        "rounded-2xl border p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                        isSelected
                          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
                          : "border-zinc-200 bg-white/60 hover:border-zinc-800 dark:border-white/10 dark:bg-white/5",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{proceso.numero_proceso}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            {proceso.tipo_proceso && <span>{proceso.tipo_proceso} Â· </span>}
                            <span>{proceso.fecha_inicio}</span>
                          </p>
                          {proceso.juzgado && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                              {proceso.juzgado}
                            </p>
                          )}
                          {proceso.descripcion && (
                            <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-2 line-clamp-2">
                              {proceso.descripcion}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span
                            className={[
                              "shrink-0 rounded-full px-2 py-1 text-xs font-medium",
                              proceso.estado === "Activo"
                                ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                                : proceso.estado === "Finalizado"
                                ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                                : proceso.estado === "Suspendido"
                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
                            ].join(" ")}
                          >
                            {proceso.estado || "Sin estado"}
                          </span>
                          {isSelected && cargandoDetalle && (
                            <span className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                              cargandoâ€¦
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                          {isSelected ? "Editando este proceso" : "Haz clic para cargar y editar"}
                        </p>
                        <Link
                          href={`/calendario?procesoId=${proceso.id}`}
                          className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200 dark:hover:border-white"
                        >
                          Programar en calendario
                        </Link>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
