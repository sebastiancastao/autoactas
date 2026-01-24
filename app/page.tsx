"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type FilaPersona = {
  id: string;
  nombre: string;
  celular: string;
  email: string;
  categoria: string;
  tarjetaProfesional: string;
  calidadApoderadoDe: string;
};

const CATEGORIAS = ["Acreedor", "Deudor", "Apoderado"];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function limpiarTelefono(valor: string) {
  // Mantiene solo + y dígitos
  return valor.replace(/[^\d+]/g, "");
}

function limpiarEmail(valor: string) {
  return valor.trim().toLowerCase();
}

function esEmailValido(email: string) {
  // Validación simple (suficiente para UI)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const PAGINAS = [
  {
    href: "/lista",
    titulo: "Registro de asistencia",
    descripcion: "Marca rápidamente quién está presente o ausente.",
  },
  {
    href: "/calendario",
    titulo: "Calendario",
    descripcion: "Planifica eventos mensuales y consulta fechas clave.",
  },
  {
    href: "/finalizacion",
    titulo: "Finalización",
    descripcion: "Cierra procesos con veredicto final y notas.",
  },
] as const;

export default function Home() {
  const [filas, setFilas] = useState<FilaPersona[]>([
    { id: uid(), nombre: "", celular: "", email: "", categoria: "Acreedor", tarjetaProfesional: "", calidadApoderadoDe: "" },
  ]);

  const [guardado, setGuardado] = useState<
    Omit<FilaPersona, "id">[] | null
  >(null);

  const puedeGuardar = useMemo(() => {
    return (
      filas.length > 0 &&
      filas.every(
        (f) =>
          f.nombre.trim() &&
          f.celular.trim() &&
          f.email.trim() &&
          esEmailValido(f.email)
      )
    );
  }, [filas]);

  function agregarFila() {
    setFilas((prev) => [
      ...prev,
      { id: uid(), nombre: "", celular: "", email: "", categoria: "Acreedor", tarjetaProfesional: "", calidadApoderadoDe: "" },
    ]);
  }

  function eliminarFila(id: string) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  function actualizarFila(id: string, patch: Partial<FilaPersona>) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function reiniciarFormulario() {
    setFilas([{ id: uid(), nombre: "", celular: "", email: "", categoria: "Acreedor", tarjetaProfesional: "", calidadApoderadoDe: "" }]);
    setGuardado(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;

    const payload = filas.map((f) => ({
      nombre: f.nombre.trim(),
      celular: limpiarTelefono(f.celular.trim()),
      email: limpiarEmail(f.email),
      categoria: f.categoria,
      tarjetaProfesional: f.tarjetaProfesional.trim(),
      calidadApoderadoDe: f.calidadApoderadoDe.trim(),
    }));

    setGuardado(payload);
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      {/* Gradiente sutil arriba estilo Apple */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        {/* Encabezado */}
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Formulario de registro
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Registro de personas
          </h1>

          <p className="mt-2 max-w-xl text-zinc-600 dark:text-zinc-300">
            Agrega tantas filas como necesites. Cada fila captura{" "}
            <span className="font-medium text-zinc-950 dark:text-zinc-50">
              nombre
            </span>
            ,{" "}
            <span className="font-medium text-zinc-950 dark:text-zinc-50">
              celular
            </span>
            ,{" "}
            <span className="font-medium text-zinc-950 dark:text-zinc-50">
              email
            </span>{" "}
            y{" "}
            <span className="font-medium text-zinc-950 dark:text-zinc-50">
              categoría
            </span>
            .
          </p>
        </header>

        <section className="mb-8 grid gap-3 text-left sm:grid-cols-3">
          {PAGINAS.map((pagina) => (
            <Link
              key={pagina.href}
              href={pagina.href}
              className="group flex flex-col gap-2 rounded-3xl border border-zinc-200 bg-white/80 px-4 py-5 text-sm font-medium leading-tight text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
            >
              <span className="text-xs uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-500">
                Ir a
              </span>
              <span className="text-base font-semibold">{pagina.titulo}</span>
              <span className="text-[13px] font-normal text-zinc-500 dark:text-zinc-400">
                {pagina.descripcion}
              </span>
            </Link>
          ))}
        </section>

        {/* Tarjeta */}
        <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Filas */}
            <div className="space-y-4">
              {filas.map((fila, index) => {
                const emailValido = !fila.email.trim() || esEmailValido(fila.email);

                return (
                  <div
                    key={fila.id}
                    className="group rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-medium text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
                          {index + 1}
                        </span>
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          Datos de la persona
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => eliminarFila(fila.id)}
                        disabled={filas.length === 1}
                        className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                        title={filas.length === 1 ? "Debe quedar al menos 1 fila" : "Eliminar"}
                      >
                        Eliminar
                      </button>
                    </div>

                    {/* Grid 2x2 (se siente Apple) */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* Nombre */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Nombre
                        </label>
                        <input
                          value={fila.nombre}
                          onChange={(e) =>
                            actualizarFila(fila.id, { nombre: e.target.value })
                          }
                          placeholder="Ej: Juan Pérez"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                        {!fila.nombre.trim() && (
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            Obligatorio
                          </p>
                        )}
                      </div>

                      {/* Celular */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Celular
                        </label>
                        <input
                          value={fila.celular}
                          onChange={(e) =>
                            actualizarFila(fila.id, { celular: e.target.value })
                          }
                          onBlur={() =>
                            actualizarFila(fila.id, {
                              celular: limpiarTelefono(fila.celular),
                            })
                          }
                          placeholder="Ej: +57 300 123 4567"
                          inputMode="tel"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                        {!fila.celular.trim() && (
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            Obligatorio
                          </p>
                        )}
                      </div>

                      {/* Email */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Email
                        </label>
                        <input
                          value={fila.email}
                          onChange={(e) =>
                            actualizarFila(fila.id, { email: e.target.value })
                          }
                          onBlur={() =>
                            actualizarFila(fila.id, {
                              email: limpiarEmail(fila.email),
                            })
                          }
                          placeholder="Ej: ejemplo@correo.com"
                          inputMode="email"
                          className={`h-11 w-full rounded-2xl border bg-white px-4 text-sm outline-none transition
                            ${
                              emailValido
                                ? "border-zinc-200 focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                                : "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10 dark:border-red-500/40 dark:bg-black/20"
                            }`}
                        />
                        {!fila.email.trim() ? (
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            Obligatorio
                          </p>
                        ) : !emailValido ? (
                          <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">
                            Email inválido
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            OK
                          </p>
                        )}
                      </div>

                      {/* Categoría */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Categoría
                        </label>
                        <select
                          value={fila.categoria}
                          onChange={(e) =>
                            actualizarFila(fila.id, { categoria: e.target.value })
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

                      {/* Tarjeta Profesional No. */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          Tarjeta Profesional No.
                        </label>
                        <input
                          value={fila.tarjetaProfesional}
                          onChange={(e) =>
                            actualizarFila(fila.id, { tarjetaProfesional: e.target.value })
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
                          value={fila.calidadApoderadoDe}
                          onChange={(e) =>
                            actualizarFila(fila.id, { calidadApoderadoDe: e.target.value })
                          }
                          placeholder="Ej: Nombre del representado"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Opcional
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Acciones */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={agregarFila}
                className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                + Agregar otra
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={reiniciarFormulario}
                  className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  Reiniciar
                </button>

                <button
                  type="submit"
                  disabled={!puedeGuardar}
                  className="h-12 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  Guardar
                </button>
              </div>
            </div>

            {/* Preview JSON */}
            {guardado && (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    Datos guardados
                  </p>
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/10 dark:text-zinc-300">
                    {guardado.length} fila{guardado.length === 1 ? "" : "s"}
                  </span>
                </div>

                <pre className="max-h-64 overflow-auto rounded-xl bg-white p-3 text-xs text-zinc-800 shadow-inner dark:bg-black/30 dark:text-zinc-100">
{JSON.stringify(guardado, null, 2)}
                </pre>
              </div>
            )}
          </form>
        </section>

        <footer className="mt-8 text-xs text-zinc-500 dark:text-zinc-400">
          Tip: usa <span className="rounded bg-zinc-200 px-1 dark:bg-white/10">Tab</span>{" "}
          para moverte rápido entre campos.
        </footer>
      </main>
    </div>
  );
}
