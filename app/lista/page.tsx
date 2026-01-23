"use client";

import { useMemo, useState } from "react";

type Categoria = "Acreedor" | "Deudor";
type EstadoAsistencia = "Presente" | "Ausente";

type Asistente = {
  id: string;
  nombre: string;
  categoria: Categoria;
  estado: EstadoAsistencia;
};

const CATEGORIAS: Categoria[] = ["Acreedor", "Deudor"];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function AttendancePage() {
  const [titulo, setTitulo] = useState("Llamado de asistencia");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));

  const [asistentes, setAsistentes] = useState<Asistente[]>([
    { id: uid(), nombre: "", categoria: "Acreedor", estado: "Ausente" },
  ]);

  const [guardado, setGuardado] = useState<any>(null);

  const total = asistentes.length;
  const presentes = asistentes.filter((a) => a.estado === "Presente").length;
  const ausentes = total - presentes;

  const puedeGuardar = useMemo(() => {
    return asistentes.length > 0 && asistentes.every((a) => a.nombre.trim());
  }, [asistentes]);

  function agregarFila() {
    setAsistentes((prev) => [
      ...prev,
      { id: uid(), nombre: "", categoria: "Acreedor", estado: "Ausente" },
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
    setAsistentes([{ id: uid(), nombre: "", categoria: "Acreedor", estado: "Ausente" }]);
    setGuardado(null);
  }

  function guardarAsistencia(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;

    const payload = {
      titulo: titulo.trim(),
      fecha,
      resumen: { total, presentes, ausentes },
      asistentes: asistentes.map(({ id, ...rest }) => ({
        ...rest,
        nombre: rest.nombre.trim(),
      })),
      guardadoEn: new Date().toISOString(),
    };

    setGuardado(payload);
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
            Attendance Call
          </h1>

          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Marca quién está presente o ausente en segundos. Diseño limpio y rápido, estilo Apple.
          </p>
        </header>

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
                  disabled={!puedeGuardar}
                  className="h-12 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  Guardar asistencia
                </button>
              </div>
            </div>

            {/* Preview JSON */}
            {guardado && (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    Resultado guardado
                  </p>
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/10 dark:text-zinc-300">
                    {presentes}/{total} presentes
                  </span>
                </div>

                <pre className="max-h-72 overflow-auto rounded-xl bg-white p-3 text-xs text-zinc-800 shadow-inner dark:bg-black/30 dark:text-zinc-100">
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

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
      <span className="text-zinc-500 dark:text-zinc-300">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
