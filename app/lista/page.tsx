"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { getProcesoWithRelations } from "@/lib/api/proceso";
import { getApoderadosByIds } from "@/lib/api/apoderados";
import { createAsistenciasBulk } from "@/lib/api/asistencia";
import { getAcreenciasByProceso } from "@/lib/api/acreencias";
import type { Acreedor, Acreencia, Apoderado, AsistenciaInsert } from "@/lib/database.types";

type Categoria = "Acreedor" | "Deudor" | "Apoderado";
type EstadoAsistencia = "Presente" | "Ausente";

type Asistente = {
  id: string;
  apoderadoId?: string;
  nombre: string;
  email: string;
  categoria: Categoria;
  estado: EstadoAsistencia;
  tarjetaProfesional: string;
  calidadApoderadoDe: string;
};

const CATEGORIAS: Categoria[] = ["Acreedor", "Deudor", "Apoderado"];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function limpiarEmail(valor: string) {
  return valor.trim().toLowerCase();
}

function esEmailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

type AcreedorConApoderadoId = {
  id?: string;
  nombre?: string | null;
  apoderado_id?: string | null;
};

type DeudorConApoderadoId = {
  id?: string;
  nombre?: string | null;
  apoderado_id?: string | null;
};

type ProcesoConRelaciones = {
  numero_proceso?: string | null;
  acreedores?: AcreedorConApoderadoId[] | null;
  deudores?: DeudorConApoderadoId[] | null;
  apoderados?: Apoderado[] | null;
};

function mapApoderadosFromProceso(
  detalle?: ProcesoConRelaciones,
  apoderados?: Apoderado[]
): Asistente[] {
  if (!detalle) return [];

  const listaApoderados = apoderados ?? detalle.apoderados ?? [];
  const filas: Asistente[] = [];

  // Get apoderados directly from proceso or participants
  listaApoderados.forEach((apoderado) => {
    // Find if this apoderado represents an acreedor
    const acreedor = detalle.acreedores?.find(
      (a) => a.apoderado_id === apoderado.id
    );
    // Find if this apoderado represents a deudor
    const deudor = detalle.deudores?.find(
      (d) => d.apoderado_id === apoderado.id
    );

    let calidadDe = "";
    if (acreedor) {
      calidadDe = `Acreedor: ${acreedor.nombre ?? "Sin nombre"}`;
    } else if (deudor) {
      calidadDe = `Deudor: ${deudor.nombre ?? "Sin nombre"}`;
    }

    filas.push({
      id: uid(),
      apoderadoId: apoderado.id,
      nombre: apoderado.nombre,
      email: apoderado.email ?? "",
      categoria: "Apoderado",
      estado: "Ausente",
      tarjetaProfesional: "",
      calidadApoderadoDe: calidadDe,
    });
  });

  return filas;
}

function mergeApoderadosById(primary: Apoderado[], fallback: Apoderado[]): Apoderado[] {
  const merged = new Map<string, Apoderado>();
  primary.forEach((apoderado) => merged.set(apoderado.id, apoderado));
  fallback.forEach((apoderado) => merged.set(apoderado.id, apoderado));
  return Array.from(merged.values());
}

type AcreenciaDetalle = Acreencia & {
  acreedores?: Acreedor | null;
  apoderados?: Apoderado | null;
};

function AttendanceContent() {
  const searchParams = useSearchParams();
  const procesoId = searchParams.get("procesoId");

  const [titulo, setTitulo] = useState("Llamado de asistencia");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));

  const [asistentes, setAsistentes] = useState<Asistente[]>([
    { id: uid(), nombre: "", email: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" },
  ]);

  const [guardado, setGuardado] = useState<unknown | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoError, setGuardadoError] = useState<string | null>(null);
  const [procesoApoderadosMensaje, setProcesoApoderadosMensaje] = useState<string | null>(null);
  const [procesoApoderadosCargando, setProcesoApoderadosCargando] = useState(false);
  const [procesoApoderadosError, setProcesoApoderadosError] = useState<string | null>(null);

  const [acreencias, setAcreencias] = useState<AcreenciaDetalle[]>([]);
  const [acreenciasCargando, setAcreenciasCargando] = useState(false);
  const [acreenciasError, setAcreenciasError] = useState<string | null>(null);

  useEffect(() => {
    if (!procesoId) {
      setProcesoApoderadosMensaje(null);
      setProcesoApoderadosError(null);
      return;
    }

    let activo = true;

    const cargarApoderadosDelProceso = async () => {
      setProcesoApoderadosMensaje(null);
      setProcesoApoderadosError(null);
      setProcesoApoderadosCargando(true);

      try {
        const procesoConRelaciones = await getProcesoWithRelations(procesoId);
        const apoderadoIds = new Set<string>();

        procesoConRelaciones.deudores?.forEach((deudor) => {
          if (deudor.apoderado_id) {
            apoderadoIds.add(deudor.apoderado_id);
          }
        });

        procesoConRelaciones.acreedores?.forEach((acreedor) => {
          if (acreedor.apoderado_id) {
            apoderadoIds.add(acreedor.apoderado_id);
          }
        });

        const adicionales =
          apoderadoIds.size > 0
            ? await getApoderadosByIds(Array.from(apoderadoIds))
            : [];

        const apoderadosParaMostrar = mergeApoderadosById(
          procesoConRelaciones.apoderados ?? [],
          adicionales
        );

        const filas = mapApoderadosFromProceso(
          procesoConRelaciones,
          apoderadosParaMostrar
        );

        if (!activo) return;

        if (filas.length > 0) {
          setAsistentes(filas);
          setProcesoApoderadosMensaje(`Apoderados cargados (${filas.length})`);
        } else {
          setProcesoApoderadosMensaje(
            "No se encontraron apoderados vinculados a este proceso."
          );
        }
      } catch (error) {
        console.error("Error cargando apoderados del proceso:", error);
        if (activo) {
          setProcesoApoderadosError(
            "No se pudieron cargar los apoderados del proceso."
          );
        }
      } finally {
        if (activo) {
          setProcesoApoderadosCargando(false);
        }
      }
    };

    cargarApoderadosDelProceso();

    return () => {
      activo = false;
    };
  }, [procesoId]);

  useEffect(() => {
    if (!procesoId) {
      setAcreencias([]);
      setAcreenciasError(null);
      setAcreenciasCargando(false);
      return;
    }

    let activo = true;

    const cargarAcreencias = async () => {
      setAcreenciasCargando(true);
      setAcreenciasError(null);

      try {
        const data = (await getAcreenciasByProceso(procesoId)) as unknown as AcreenciaDetalle[];
        if (!activo) return;
        setAcreencias(data ?? []);
      } catch (error) {
        console.error("Error cargando acreencias del proceso:", error);
        if (activo) {
          setAcreenciasError("No se pudieron cargar las acreencias del proceso.");
        }
      } finally {
        if (activo) {
          setAcreenciasCargando(false);
        }
      }
    };

    cargarAcreencias();

    return () => {
      activo = false;
    };
  }, [procesoId]);

  const total = asistentes.length;
  const presentes = asistentes.filter((a) => a.estado === "Presente").length;
  const ausentes = total - presentes;

  const mensajeApoderado = procesoApoderadosCargando
    ? "Cargando apoderados del proceso..."
    : procesoApoderadosError ?? procesoApoderadosMensaje;

  const puedeGuardar = useMemo(() => {
    return asistentes.length > 0 && asistentes.every((a) => a.nombre.trim());
  }, [asistentes]);

  function agregarFila() {
    setAsistentes((prev) => [
      ...prev,
      { id: uid(), nombre: "", email: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" },
    ]);
  }

  function eliminarFila(id: string) {
    setAsistentes((prev) => prev.filter((a) => a.id !== id));
  }

  function actualizarFila(id: string, patch: Partial<Asistente>) {
    setAsistentes((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  }

  function marcarTodos(estado: EstadoAsistencia) {
    setAsistentes((prev) => prev.map((a) => ({ ...a, estado })));
  }

  function reiniciar() {
    setTitulo("Llamado de asistencia");
    setFecha(new Date().toISOString().slice(0, 10));
    setAsistentes([{ id: uid(), nombre: "", email: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" }]);
    setGuardado(null);
  }

  async function guardarAsistencia(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar || guardando) return;

    setGuardando(true);
    setGuardadoError(null);

    try {
      // Prepare records for database
      const registros: AsistenciaInsert[] = asistentes.map((a) => ({
        proceso_id: procesoId || undefined,
        apoderado_id: a.apoderadoId || undefined,
        nombre: a.nombre.trim(),
        email: a.email ? limpiarEmail(a.email) : null,
        categoria: a.categoria,
        estado: a.estado,
        tarjeta_profesional: a.tarjetaProfesional.trim() || null,
        calidad_apoderado_de: a.calidadApoderadoDe.trim() || null,
        fecha,
        titulo: titulo.trim() || null,
      }));

      // Save to database
      await createAsistenciasBulk(registros);

      // Also set local state for preview
      const payload = {
        titulo: titulo.trim(),
        fecha,
        resumen: { total, presentes, ausentes },
        asistentes: asistentes.map((a) => ({
          nombre: a.nombre.trim(),
          email: a.email ? limpiarEmail(a.email) : "",
          categoria: a.categoria,
          estado: a.estado,
          tarjetaProfesional: a.tarjetaProfesional.trim(),
          calidadApoderadoDe: a.calidadApoderadoDe.trim(),
        })),
        guardadoEn: new Date().toISOString(),
      };

      setGuardado(payload);
    } catch (error) {
      console.error("Error guardando asistencia:", error);
      setGuardadoError("No se pudo guardar la asistencia. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      {/* Gradient top */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
        {/* Header */}
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Asistencia
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Llamado a Lista
          </h1>

          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Marca quién está presente o ausente en segundos. Diseño limpio y rápido, estilo Apple.
          </p>
        </header>

        {/* Navigation */}
        <nav className="mb-8 flex flex-wrap gap-2">
          <Link
            href="/procesos"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            ← procesos
          </Link>
          <Link
            href="/calendario"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Calendario
          </Link>
          <Link
            href="/finalizacion"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Finalización
          </Link>
        </nav>

        {procesoId && mensajeApoderado && (
          <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
            {mensajeApoderado}
          </p>
        )}

        {/* Main Card */}
        <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <form onSubmit={guardarAsistencia} className="space-y-6">
            {/* Top Controls */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Título
                </label>
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej: Asistencia reunión #12"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Fecha
                </label>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
            </div>

            {/* Stats + Bulk Actions */}
            <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Pill label="Total" value={total} />
                <Pill label="Presentes" value={presentes} />
                <Pill label="Ausentes" value={ausentes} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => marcarTodos("Presente")}
                  className="h-10 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  Marcar todos presentes
                </button>

                <button
                  type="button"
                  onClick={() => marcarTodos("Ausente")}
                  className="h-10 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  Marcar todos ausentes
                </button>
              </div>
            </div>

            {/* Attendance Rows */}
            <div className="space-y-3">
              {asistentes.map((a, index) => (
                <div
                  key={a.id}
                  className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-medium text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
                        {index + 1}
                      </span>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        Asistente
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => eliminarFila(a.id)}
                      disabled={asistentes.length === 1}
                      className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                      title={asistentes.length === 1 ? "Debe quedar al menos 1 fila" : "Eliminar"}
                    >
                      Eliminar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {/* Nombre */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Nombre
                      </label>
                      <input
                        value={a.nombre}
                        onChange={(e) => actualizarFila(a.id, { nombre: e.target.value })}
                        placeholder="Ej: Juan Pérez"
                        className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                      {!a.nombre.trim() && (
                        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Obligatorio
                        </p>
                      )}
                    </div>

                    {/* Categoría */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Categoría
                      </label>
                      <select
                        value={a.categoria}
                        onChange={(e) =>
                          actualizarFila(a.id, { categoria: e.target.value as Categoria })
                        }
                        className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      >
                        {CATEGORIAS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        Opcional
                      </p>
                    </div>

                    {/* Correo Electrónico */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Correo Electrónico
                      </label>
                      <input
                        value={a.email}
                        onChange={(e) => actualizarFila(a.id, { email: e.target.value })}
                        onBlur={() => actualizarFila(a.id, { email: limpiarEmail(a.email) })}
                        placeholder="Ej: ejemplo@correo.com"
                        inputMode="email"
                        className={`h-11 w-full rounded-2xl border bg-white px-4 text-sm outline-none transition ${
                          !a.email.trim() || esEmailValido(a.email)
                            ? "border-zinc-200 focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            : "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10 dark:border-red-500/40 dark:bg-black/20"
                        }`}
                      />
                      {a.email.trim() && !esEmailValido(a.email) && (
                        <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">
                          Email inválido
                        </p>
                      )}
                    </div>

                    {/* Tarjeta Profesional No. */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Tarjeta Profesional No.
                      </label>
                      <input
                        value={a.tarjetaProfesional}
                        onChange={(e) => actualizarFila(a.id, { tarjetaProfesional: e.target.value })}
                        placeholder="Ej: 123456"
                        className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        Opcional
                      </p>
                    </div>

                    {/* Calidad de apoderado de */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Calidad de apoderado de
                      </label>
                      <input
                        value={a.calidadApoderadoDe}
                        onChange={(e) => actualizarFila(a.id, { calidadApoderadoDe: e.target.value })}
                        placeholder="Ej: Nombre del representado"
                        className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        Opcional
                      </p>
                    </div>

                    {/* Switch */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Estado
                      </label>

                      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-2 dark:border-white/10 dark:bg-black/20">
                        <div>
                          <p className="text-sm font-medium">
                            {a.estado === "Presente" ? "Presente ✅" : "Ausente ❌"}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Toca para cambiar
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            actualizarFila(a.id, {
                              estado: a.estado === "Presente" ? "Ausente" : "Presente",
                            })
                          }
                          className={`relative h-7 w-12 rounded-full transition ${
                            a.estado === "Presente"
                              ? "bg-zinc-950 dark:bg-white"
                              : "bg-zinc-300 dark:bg-white/20"
                          }`}
                        >
                          <span
                            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                              a.estado === "Presente"
                                ? "left-6 bg-white dark:bg-black"
                                : "left-1 bg-white"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Actions */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={agregarFila}
                className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                + Agregar asistente
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={reiniciar}
                  className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  Reiniciar
                </button>

                <button
                  type="submit"
                  disabled={!puedeGuardar || guardando}
                  className="h-12 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  {guardando ? "Guardando..." : "Guardar asistencia"}
                </button>
              </div>
            </div>

            {/* Error message */}
            {guardadoError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {guardadoError}
              </div>
            )}

            {/* Success message */}
            {guardado && (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
                Asistencia guardada correctamente ({presentes}/{total} presentes)
              </div>
            )}
          </form>
        </section>

        {procesoId && (
          <section className="mt-8 rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Acreencias del proceso</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  {acreenciasCargando
                    ? "Cargando acreencias..."
                    : acreencias.length === 0
                    ? "No hay acreencias registradas."
                    : `Total: ${acreencias.length}`}
                </p>
              </div>
            </div>

            {acreenciasError && (
              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {acreenciasError}
              </div>
            )}

            {acreencias.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.25em] text-zinc-400">
                      <th className="pb-3 pr-4">Acreedor</th>
                      <th className="pb-3 pr-4">Apoderado</th>
                      <th className="pb-3 pr-4">Naturaleza</th>
                      <th className="pb-3 pr-4">Prelación</th>
                      <th className="pb-3 pr-4">Capital</th>
                      <th className="pb-3 pr-4">Int. Cte.</th>
                      <th className="pb-3 pr-4">Int. Mora</th>
                      <th className="pb-3 pr-4">Otros</th>
                      <th className="pb-3 pr-4">Total</th>
                      <th className="pb-3 pr-4">%</th>
                      <th className="pb-3 pr-0">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acreencias.map((acreencia) => {
                      const hrefEditar = `/acreencias?${new URLSearchParams({
                        procesoId,
                        apoderadoId: acreencia.apoderado_id,
                      }).toString()}`;

                      return (
                        <tr key={acreencia.id} className="border-t border-zinc-200/70 dark:border-white/10">
                          <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                            <div className="max-w-[240px] truncate">
                              {acreencia.acreedores?.nombre ?? acreencia.acreedor_id}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="max-w-[220px] truncate">
                              {acreencia.apoderados?.nombre ?? acreencia.apoderado_id}
                            </div>
                          </td>
                          <td className="py-3 pr-4">{acreencia.naturaleza ?? "—"}</td>
                          <td className="py-3 pr-4">{acreencia.prelacion ?? "—"}</td>
                          <td className="py-3 pr-4">{acreencia.capital ?? "—"}</td>
                          <td className="py-3 pr-4">{acreencia.int_cte ?? "—"}</td>
                          <td className="py-3 pr-4">{acreencia.int_mora ?? "—"}</td>
                          <td className="py-3 pr-4">{acreencia.otros_cobros_seguros ?? "—"}</td>
                          <td className="py-3 pr-4 font-medium">{acreencia.total ?? "—"}</td>
                          <td className="py-3 pr-4">{acreencia.porcentaje ?? "—"}</td>
                          <td className="py-3 pr-0">
                            <Link
                              href={hrefEditar}
                              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
                            >
                              Editar
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <footer className="mt-8 text-xs text-zinc-500 dark:text-zinc-400">
          Tip: usa <span className="rounded bg-zinc-200 px-1 dark:bg-white/10">Tab</span>{" "}
          para moverte rápido entre campos.
        </footer>
      </main>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
      <span className="text-zinc-500 dark:text-zinc-300">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function AttendancePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50 dark:bg-black flex items-center justify-center">Cargando...</div>}>
      <AttendanceContent />
    </Suspense>
  );
}
