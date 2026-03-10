"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { getUsuarios, type Usuario } from "@/lib/api/usuarios";
import {
  getAsignaciones,
  createAsignacion,
  updateAsignacion,
  deleteAsignacion,
  type AsignacionConNombres,
} from "@/lib/api/asignaciones";

function isAdminRole(rol: string | null | undefined) {
  return (rol ?? "").trim().toLowerCase() === "admin";
}

export default function AsignacionesPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionConNombres[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [origenId, setOrigenId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    let canceled = false;

    (async () => {
      try {
        const { data: profile } = await supabase
          .from("usuarios")
          .select("rol")
          .eq("auth_id", user.id)
          .maybeSingle();

        if (canceled) return;

        if (!isAdminRole(profile?.rol)) {
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        setIsAdmin(true);

        const [usuariosData, asignacionesData] = await Promise.all([
          getUsuarios(),
          getAsignaciones(),
        ]);

        if (!canceled) {
          setUsuarios(usuariosData ?? []);
          setAsignaciones(asignacionesData);
        }
      } catch (err) {
        if (!canceled) setError("No se pudo cargar la información.");
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [user?.id]);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!origenId || !destinoId || origenId === destinoId) return;
    setGuardando(true);
    setError(null);
    try {
      await createAsignacion(origenId, destinoId);
      const data = await getAsignaciones();
      setAsignaciones(data);
      setOrigenId("");
      setDestinoId("");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo crear la asignación.");
    } finally {
      setGuardando(false);
    }
  }

  async function handleToggleActivo(asignacion: AsignacionConNombres) {
    try {
      await updateAsignacion(asignacion.id, { activo: !asignacion.activo });
      setAsignaciones((prev) =>
        prev.map((a) =>
          a.id === asignacion.id ? { ...a, activo: !a.activo } : a
        )
      );
    } catch (err: any) {
      setError(err?.message ?? "No se pudo actualizar la asignación.");
    }
  }

  async function handleEliminar(id: string) {
    setEliminandoId(id);
    try {
      await deleteAsignacion(id);
      setAsignaciones((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setError(err?.message ?? "No se pudo eliminar la asignación.");
    } finally {
      setEliminandoId(null);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-zinc-500">Cargando...</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-zinc-500">No tienes acceso a esta página.</p>
      </main>
    );
  }

  const usuariosDisponibles = usuarios;

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">
            Asignaciones de usuarios
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Cuando un usuario cree un proceso o evento, se asignará
            automáticamente al usuario destino configurado aquí.
          </p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Nueva asignación */}
        <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Nueva asignación
          </h2>
          <form onSubmit={handleCrear} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Usuario origen
                </label>
                <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                  Cuando este usuario cree algo...
                </p>
                <select
                  value={origenId}
                  onChange={(e) => setOrigenId(e.target.value)}
                  required
                  className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                >
                  <option value="">Seleccionar usuario...</option>
                  {usuariosDisponibles.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Usuario destino
                </label>
                <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                  ...se asignará automáticamente a este
                </p>
                <select
                  value={destinoId}
                  onChange={(e) => setDestinoId(e.target.value)}
                  required
                  className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                >
                  <option value="">Seleccionar usuario...</option>
                  {usuariosDisponibles
                    .filter((u) => u.id !== origenId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {origenId && destinoId && origenId !== destinoId && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Cuando{" "}
                <strong>
                  {usuariosDisponibles.find((u) => u.id === origenId)?.nombre}
                </strong>{" "}
                cree un proceso o evento, se asignará a{" "}
                <strong>
                  {usuariosDisponibles.find((u) => u.id === destinoId)?.nombre}
                </strong>
                .
              </p>
            )}

            <button
              type="submit"
              disabled={guardando || !origenId || !destinoId || origenId === destinoId}
              className="h-11 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {guardando ? "Guardando..." : "Crear asignación"}
            </button>
          </form>
        </section>

        {/* Lista de asignaciones */}
        <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Asignaciones configuradas
          </h2>

          {asignaciones.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No hay asignaciones configuradas.
            </p>
          ) : (
            <div className="space-y-2">
              {asignaciones.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/70 px-4 py-3 dark:border-white/5 dark:bg-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2 w-2 flex-shrink-0 rounded-full ${a.activo ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    />
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">
                        {a.origen_nombre}
                        <span className="mx-2 text-zinc-400">→</span>
                        {a.destino_nombre}
                      </p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        {a.activo ? "Activa" : "Inactiva"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleActivo(a)}
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
                    >
                      {a.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEliminar(a.id)}
                      disabled={eliminandoId === a.id}
                      className="rounded-full px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      {eliminandoId === a.id ? "..." : "Eliminar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>


      </div>
    </main>
  );
}
