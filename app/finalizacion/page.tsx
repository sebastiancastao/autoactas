"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Categoria = "Acreedor" | "Deudor" | "Apoderado";
type EstadoAsistencia = "Presente" | "Ausente";
type Veredicto = "Aprobado" | "Rechazado" | "Aplazado";

type Asistente = {
  id: string;
  nombre: string;
  email: string;
  celular: string;
  categoria: Categoria;
  estado: EstadoAsistencia;
  tarjetaProfesional: string;
  calidadApoderadoDe: string;
};

const CATEGORIAS: Categoria[] = ["Acreedor", "Deudor", "Apoderado"];
const VEREDICTOS: Veredicto[] = ["Aprobado", "Rechazado", "Aplazado"];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function limpiarTelefono(valor: string) {
  return valor.replace(/[^\d+]/g, "");
}

function limpiarEmail(valor: string) {
  return valor.trim().toLowerCase();
}

function esEmailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function FinalizacionPage() {
  const hoyISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [titulo, setTitulo] = useState("Finalización del proceso");
  const [fecha, setFecha] = useState(hoyISO);

  // Asistencia
  const [asistentes, setAsistentes] = useState<Asistente[]>([
    {
      id: uid(),
      nombre: "",
      email: "",
      celular: "",
      categoria: "Acreedor",
      estado: "Ausente",
      tarjetaProfesional: "",
      calidadApoderadoDe: "",
    },
  ]);

  // Veredicto
  const [veredicto, setVeredicto] = useState<Veredicto>("Aprobado");
  const [observaciones, setObservaciones] = useState("");

  // Resultado final guardado
  const [guardado, setGuardado] = useState<Record<string, unknown> | null>(null);

  const total = asistentes.length;
  const presentes = asistentes.filter((a) => a.estado === "Presente").length;
  const ausentes = total - presentes;

  const puedeGuardar = useMemo(() => {
    // Nombre obligatorio
    // Email + celular opcionales, pero si se llenan: validar
    return (
      asistentes.length > 0 &&
      asistentes.every((a) => {
        const okNombre = a.nombre.trim().length > 0;
        const okEmail = !a.email.trim() || esEmailValido(a.email);
        return okNombre && okEmail;
      })
    );
  }, [asistentes]);

  function agregarAsistente() {
    setAsistentes((prev) => [
      ...prev,
      {
        id: uid(),
        nombre: "",
        email: "",
        celular: "",
        categoria: "Acreedor",
        estado: "Ausente",
        tarjetaProfesional: "",
        calidadApoderadoDe: "",
      },
    ]);
  }

  function eliminarAsistente(id: string) {
    setAsistentes((prev) => prev.filter((a) => a.id !== id));
  }

  function actualizarAsistente(id: string, patch: Partial<Asistente>) {
    setAsistentes((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  }

  function marcarTodos(estado: EstadoAsistencia) {
    setAsistentes((prev) => prev.map((a) => ({ ...a, estado })));
  }

  function reiniciar() {
    setTitulo("Finalización del proceso");
    setFecha(hoyISO);
    setVeredicto("Aprobado");
    setObservaciones("");
    setAsistentes([
      {
        id: uid(),
        nombre: "",
        email: "",
        celular: "",
        categoria: "Acreedor",
        estado: "Ausente",
        tarjetaProfesional: "",
        calidadApoderadoDe: "",
      },
    ]);
    setGuardado(null);
  }

  function guardarFinalizacion(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;

    const payload = {
      titulo: titulo.trim(),
      fecha,
      resumen_asistencia: {
        total,
        presentes,
        ausentes,
      },
      veredicto,
      observaciones: observaciones.trim() || null,
      asistentes: asistentes.map(({ id, ...rest }) => ({
        ...rest,
        nombre: rest.nombre.trim(),
        email: rest.email ? limpiarEmail(rest.email) : "",
        celular: rest.celular ? limpiarTelefono(rest.celular) : "",
        tarjetaProfesional: rest.tarjetaProfesional.trim(),
        calidadApoderadoDe: rest.calidadApoderadoDe.trim(),
      })),
      guardado_en: new Date().toISOString(),
    };

    setGuardado(payload);
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      {/* Gradiente sutil arriba estilo Apple */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
        {/* Header */}
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Finalización
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Finalización del proceso
          </h1>

          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Registra la asistencia y define el veredicto final en un solo lugar.
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
            href="/lista"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Asistencia
          </Link>
          <Link
            href="/calendario"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Calendario
          </Link>
        </nav>

        {/* Main card */}
        <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <form onSubmit={guardarFinalizacion} className="space-y-6">
            {/* Top info */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Título
                </label>
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej: Audiencia / Reunión / Caso #"
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

            {/* Summary + bulk actions */}
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

            {/* Attendance list */}
            <div className="space-y-3">
              {asistentes.map((a, index) => {
                const emailValido = !a.email.trim() || esEmailValido(a.email);

                return (
                  <div
                    key={a.id}
                    className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
                        onClick={() => eliminarAsistente(a.id)}
                        disabled={asistentes.length === 1}
                        className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                        title={
                          asistentes.length === 1
                            ? "Debe quedar al menos 1 fila"
                            : "Eliminar"
                        }
                      >
                        Eliminar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* Nombre */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Nombre
                        </label>
                        <input
                          value={a.nombre}
                          onChange={(e) =>
                            actualizarAsistente(a.id, { nombre: e.target.value })
                          }
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
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Categoría
                        </label>
                        <select
                          value={a.categoria}
                          onChange={(e) =>
                            actualizarAsistente(a.id, {
                              categoria: e.target.value as Categoria,
                            })
                          }
                          className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        >
                          {CATEGORIAS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Email */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Email (opcional)
                        </label>
                        <input
                          value={a.email}
                          onChange={(e) =>
                            actualizarAsistente(a.id, { email: e.target.value })
                          }
                          onBlur={() =>
                            actualizarAsistente(a.id, { email: limpiarEmail(a.email) })
                          }
                          placeholder="Ej: persona@correo.com"
                          inputMode="email"
                          className={`h-11 w-full rounded-2xl border bg-white px-4 text-sm outline-none transition
                            ${
                              emailValido
                                ? "border-zinc-200 focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                                : "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10 dark:border-red-500/40 dark:bg-black/20"
                            }`}
                        />
                        {!emailValido && (
                          <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">
                            Email inválido
                          </p>
                        )}
                      </div>

                      {/* Celular */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Celular (opcional)
                        </label>
                        <input
                          value={a.celular}
                          onChange={(e) =>
                            actualizarAsistente(a.id, { celular: e.target.value })
                          }
                          onBlur={() =>
                            actualizarAsistente(a.id, {
                              celular: limpiarTelefono(a.celular),
                            })
                          }
                          placeholder="Ej: +57 300 123 4567"
                          inputMode="tel"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                      </div>

                      {/* Tarjeta Profesional No. */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Tarjeta Profesional No.
                        </label>
                        <input
                          value={a.tarjetaProfesional}
                          onChange={(e) =>
                            actualizarAsistente(a.id, { tarjetaProfesional: e.target.value })
                          }
                          placeholder="Ej: 123456"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Opcional
                        </p>
                      </div>

                      {/* Calidad de apoderado de */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Calidad de apoderado de
                        </label>
                        <input
                          value={a.calidadApoderadoDe}
                          onChange={(e) =>
                            actualizarAsistente(a.id, { calidadApoderadoDe: e.target.value })
                          }
                          placeholder="Ej: Nombre del representado"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Opcional
                        </p>
                      </div>

                      {/* Estado asistencia */}
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Asistencia
                        </label>

                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-2 dark:border-white/10 dark:bg-black/20">
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
                              actualizarAsistente(a.id, {
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
                              className={`absolute top-1 h-5 w-5 rounded-full shadow transition ${
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
                );
              })}
            </div>

            {/* Verdict + notes */}
            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Veredicto final
              </p>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Veredicto
                  </label>
                  <select
                    value={veredicto}
                    onChange={(e) => setVeredicto(e.target.value as Veredicto)}
                    className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  >
                    {VEREDICTOS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>

                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Selecciona el resultado final
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Observaciones (opcional)
                  </label>
                  <textarea
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Escribe un resumen corto del cierre del proceso..."
                    className="min-h-[44px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={agregarAsistente}
                className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                + Agregar asistente
              </button>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={reiniciar}
                  className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  Reiniciar
                </button>

                <button
                  type="submit"
                  disabled={!puedeGuardar}
                  className="h-12 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  Finalizar y guardar
                </button>
              </div>
            </div>

            {/* JSON Preview */}
            {guardado !== null && (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    Resultado guardado
                  </p>
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/10 dark:text-zinc-300">
                    {veredicto} · {presentes}/{total} presentes
                  </span>
                </div>

                <pre className="max-h-80 overflow-auto rounded-xl bg-white p-3 text-xs text-zinc-800 shadow-inner dark:bg-black/30 dark:text-zinc-100">
{JSON.stringify(guardado, null, 2)}
                </pre>
              </div>
            )}
          </form>
        </section>

        <footer className="mt-8 text-xs text-zinc-500 dark:text-zinc-400">
          Tip: si quieres persistencia real, el JSON ya está listo para guardarlo en Supabase.
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
