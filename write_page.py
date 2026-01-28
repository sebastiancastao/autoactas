from pathlib import Path
content = """
"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { createAcreedor } from "@/lib/api/acreedores";
import { createDeudor } from "@/lib/api/deudores";
import { getApoderados } from "@/lib/api/apoderados";
import { getProcesos } from "@/lib/api/proceso";
import type { Apoderado, Proceso } from "@/lib/database.types";

const IDENTIFICACION_OPTIONS = [
  "Cedula de Ciudadania",
  "Cedula de Extranjeria",
  "Pasaporte",
];

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

const crearDeudorRow = () => ({
  id: uid(),
  nombre: "",
  identificacion: "",
  tipoIdentificacion: "",
  direccion: "",
  telefono: "",
  email: "",
  apoderadoId: "",
  apoderadoNombre: "",
});

const crearAcreedorRow = () => ({
  id: uid(),
  nombre: "",
  identificacion: "",
  tipoIdentificacion: "",
  direccion: "",
  telefono: "",
  email: "",
  apoderadoId: "",
  apoderadoNombre: "",
  monto: "",
  tipoAcreencia: "",
});

type DeudorRow = ReturnType<typeof crearDeudorRow>;
type AcreedorRow = ReturnType<typeof crearAcreedorRow>;

type Feedback = {
  loading: boolean;
  success: string | null;
  error: string | null;
};

export default function RegistroProcesosPage() {
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [procesosLoading, setProcesosLoading] = useState(true);
  const [procesosError, setProcesosError] = useState<string | null>(null);
  const [selectedProcesoId, setSelectedProcesoId] = useState<string>("");

  const [apoderados, setApoderados] = useState<Apoderado[]>([]);
  const [apoderadosLoading, setApoderadosLoading] = useState(true);

  const [deudores, setDeudores] = useState<DeudorRow[]>([crearDeudorRow()]);
  const [acreedores, setAcreedores] = useState<AcreedorRow[]>([crearAcreedorRow()]);

  const [deudoresFeedback, setDeudoresFeedback] = useState<Feedback>({ loading: false, success: null, error: null });
  const [acreedoresFeedback, setAcreedoresFeedback] = useState<Feedback>({ loading: false, success: null, error: null });

  useEffect(() => {
    let active = true;
    (async () => {
      setProcesosLoading(true);
      setProcesosError(null);
      try {
        const data = await getProcesos();
        if (active) {
          setProcesos(data ?? []);
          if (!selectedProcesoId && (data ?? []).length > 0) {
            setSelectedProcesoId(data![0].id);
          }
        }
      } catch (error) {
        console.error("Error fetching procesos:", error);
        if (active) setProcesosError("No se pudieron cargar los procesos.");
      } finally {
        if (active) setProcesosLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedProcesoId]);

  useEffect(() => {
    let active = true;
    (async () => {
      setApoderadosLoading(true);
      try {
        const data = await getApoderados();
        if (active) setApoderados(data ?? []);
      } catch (error) {
        console.error("Error cargando apoderados:", error);
      } finally {
        if (active) setApoderadosLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedProceso = useMemo(
    () => procesos.find((proceso) => proceso.id === selectedProcesoId) ?? null,
    [procesos, selectedProcesoId]
  );

  const updateRow = <T extends { id: string }>(rows: T[], setter: React.Dispatch<React.SetStateAction<T[]>>, id: string, patch: Partial<T>) => {
    setter(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, factory: () => T) => {
    setter((prev) => [...prev, factory()]);
  };

  const removeRow = <T extends { id: string }>(rows: T[], setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) => {
    if (rows.length === 1) return;
    setter(rows.filter((row) => row.id !== id));
  };

  const filasConNombre = <T extends { nombre: string }>(rows: T[]) => rows.filter((row) => row.nombre.trim());

  const handleSubmitDeudores = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProcesoId) {
        setDeudoresFeedback({ loading: false, success: null, error: "Selecciona un proceso primero." });
        return;
      }
      const validRows = filasConNombre(deudores);
      if (validRows.length === 0) {
        setDeudoresFeedback({ loading: false, success: null, error: "Agrega al menos un deudor con nombre." });
        return;
      }
      setDeudoresFeedback({ loading: true, success: null, error: null });
      try {
        await Promise.all(
          validRows.map((row) =>
            createDeudor({
              proceso_id: selectedProcesoId,
              nombre: row.nombre.trim(),
              identificacion: row.identificacion.trim(),
              tipo_identificacion: row.tipoIdentificacion.trim() || null,
              direccion: row.direccion.trim() || null,
              telefono: row.telefono.trim() || null,
              email: row.email.trim() || null,
              apoderado_id: row.apoderadoId || null,
            })
          )
        );
        setDeudores([crearDeudorRow()]);
        setDeudoresFeedback({
          loading: false,
          success: `${validRows.length} deudor${validRows.length === 1 ? "" : "es"} registrados.`,
          error: null,
        });
      } catch (error) {
        console.error("Error guardando deudores:", error);
        setDeudoresFeedback({
          loading: false,
          success: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [deudores, selectedProcesoId]
  );

  const handleSubmitAcreedores = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProcesoId) {
        setAcreedoresFeedback({ loading: false, success: null, error: "Selecciona un proceso primero." });
        return;
      }
      const validRows = filasConNombre(acreedores);
      if (validRows.length === 0) {
        setAcreedoresFeedback({ loading: false, success: null, error: "Agrega al menos un acreedor con nombre." });
        return;
      }
      setAcreedoresFeedback({ loading: true, success: null, error: null });
      try {
        await Promise.all(
          validRows.map((row) => {
            const montoParsed = row.monto.trim() ? Number(row.monto) : null;
            const montoFinal = typeof montoParsed === "number" && !Number.isNaN(montoParsed) ? montoParsed : null;
            return createAcreedor({
              proceso_id: selectedProcesoId,
              nombre: row.nombre.trim(),
              identificacion: row.identificacion.trim(),
              tipo_identificacion: row.tipoIdentificacion.trim() || null,
              direccion: row.direccion.trim() || null,
              telefono: row.telefono.trim() || null,
              email: row.email.trim() || null,
              apoderado_id: row.apoderadoId || null,
              monto_acreencia: montoFinal,
              tipo_acreencia: row.tipoAcreencia.trim() || null,
            });
          })
        );
        setAcreedores([crearAcreedorRow()]);
        setAcreedoresFeedback({
          loading: false,
          success: `${validRows.length} acreedor${validRows.length === 1 ? "" : "es"} registrados.`,
          error: null,
        });
      } catch (error) {
        console.error("Error guardando acreedores:", error);
        setAcreedoresFeedback({
          loading: false,
          success: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [acreedores, selectedProcesoId]
  );

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <header className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Registro técnico
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Registro de acreedores y deudores</h1>
            <Link
              href="/procesos"
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
            >
              Volver a procesos
            </Link>
          </div>
          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Selecciona un proceso y registra a los representantes jurídicos de un solo tiro.
          </p>
        </header>
        <section className="mb-6 rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-500">Proceso</p>
              {procesosLoading ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando procesos...</p>
              ) : procesosError ? (
                <p className="text-sm text-red-600 dark:text-red-300">{procesosError}</p>
              ) : procesos.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  No hay procesos disponibles. <Link href="/procesos" className="font-semibold text-indigo-700 dark:text-indigo-300">crea uno nuevo</Link>.
                </p>
              ) : (
                <select
                  value={selectedProcesoId}
                  onChange={(event) => setSelectedProcesoId(event.target.value)}
                  className="w-full max-w-lg cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                >
                  {procesos.map((proceso) => (
                    <option key={proceso.id} value={proceso.id}>
                      {proceso.numero_proceso} {proceso.tipo_proceso ? `· ${proceso.tipo_proceso}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {selectedProceso && (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
                <p className="font-semibold">{selectedProceso.numero_proceso}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Fecha inicial: {selectedProceso.fecha_procesos}</p>
                {selectedProceso.juzgado && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{selectedProceso.juzgado}</p>
                )}
              </div>
            )}
          </div>
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={handleSubmitDeudores} className="space-y-5 rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold">Deudores</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Registra al menos uno con el nombre completo.</p>
              </div>
              <button
                type="button"
                onClick={() => addRow(setDeudores, crearDeudorRow)}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
              >
                + Agregar fila
              </button>
            </div>
            <div className="space-y-4">
              {deudores.map((row, index) => (
                <article key={row.id} className="space-y-3 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Deudor {index + 1}</p>
                    <button
                      type="button"
                      onClick={() => removeRow(deudores, setDeudores, row.id)}
                      disabled={deudores.length === 1}
                      className="rounded-full px-3 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      Eliminar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Nombre
                      <input
                        value={row.nombre}
                        onChange={(event) => updateRow(deudores, setDeudores, row.id, { nombre: event.target.value })}
                        placeholder="Ej: Claudia Gómez"
                        className="mt-1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                        required
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Teléfono
                      <input
                        value={row.telefono}
                        onChange={(event) => updateRow(deudores, setDeudores, row.id, { telefono: event.target.value })}
                        inputMode="tel"
                        placeholder="Ej: +57 300 123 4567"
                        className="mt-1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Tipo de identificación
                      <select
                        value={row.tipoIdentificacion}
                        onChange={(event) => updateRow(deudores, setDeudores, row.id, { tipoIdentificacion: event.target.value })}
                        className="mt-1 h-10 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                      >
                        <option value="">Seleccionar...</option>
                        {IDENTIFICACION_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Identificación
                      <input
                        value={row.identificacion}
                        onChange={(event) => updateRow(deudores, setDeudores, row.id, { identificacion: event.target.value })}
                        placeholder="Ej: 1.234.567.890"
                        className="mt-1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Correo electrónico
                      <input
                        value={row.email}
                        onChange={(event) => updateRow(deudores, setDeudores, row.id, { email: event.target.value })}
                        inputMode="email"
                        placeholder="ejemplo@correo.com"
                        className="mt-1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring=4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                      />
                    </label>
                    <label className="sm:col-span=2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Dirección
                      <input
                        value={row.direccion}
                        onChange={(event) => updateRow(deudores, setDeudores, row.id, { direccion: event.target.value })}
                        placeholder="Ej: Carrera 10 #45-67"
                        className="mt=1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                      />
                    </label>
                    <label className="sm:col-span=2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Apoderado
                      <input
                        value={row.apoderadoNombre}
                        list="apoderados-list"
                        onChange={(event) => updateRow(deudores, setDeudores, row.id, { apoderadoNombre: event.target.value })}
                        placeholder="Busca por nombre"
                        className="mt-1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-white"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
            <datalist id="apoderados-list">
              {apoderados.map((ap) => (
                <option key={ap.id} value={ap.nombre} />
              ))}
            </datalist>
            <div className="space-y-2">
              {(deudoresFeedback.error || deudoresFeedback.success) && (
                <p className={`text-sm ${deudoresFeedback.error ? "text-red-600" : "text-emerald-600"} dark:text-${deudoresFeedback.error ? "red-300" : "emerald-300"}`}>
                  {deudoresFeedback.error ?? deudoresFeedback.success}
                </p>
              )}
              <button
                type="submit"
                disabled={deudoresFeedback.loading || procesosLoading || !selectedProcesoId}
                className="h-12 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {deudoresFeedback.loading ? "Registrando..." : "Guardar deudores"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
"""
Path('app/procesos/registro/page.tsx').write_text(content, encoding='utf-8')
