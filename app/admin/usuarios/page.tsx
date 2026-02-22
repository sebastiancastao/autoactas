"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type UsuarioRow = {
  id: string;
  auth_id: string | null;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  identificacion: string | null;
  created_at: string;
};

function isAdminRole(rol: string | null | undefined) {
  return (rol ?? "").trim().toLowerCase() === "admin";
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function AdminUsuariosPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

        const admin = isAdminRole(profile?.rol);
        if (!canceled) setIsAdmin(admin);

        if (!admin) {
          if (!canceled) setLoading(false);
          return;
        }

        const { data, error: fetchError } = await supabase
          .from("usuarios")
          .select("id, auth_id, nombre, email, rol, activo, identificacion, created_at")
          .order("nombre", { ascending: true });

        if (fetchError) throw fetchError;
        if (!canceled) setUsuarios((data ?? []) as UsuarioRow[]);
      } catch (err) {
        if (!canceled)
          setError(err instanceof Error ? err.message : "Error al cargar usuarios.");
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [user?.id]);

  async function handleDelete(usuario: UsuarioRow) {
    if (
      !confirm(
        `¿Estás seguro de que deseas eliminar al usuario "${usuario.nombre || usuario.email}"?\n\nEsta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    setDeletingId(usuario.id);
    try {
      // Delete from Supabase Auth if the user has an auth account
      if (usuario.auth_id) {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;

        const res = await fetch("/api/admin/delete-user", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ authId: usuario.auth_id }),
        });

        if (!res.ok) {
          const responseData = await res.json().catch(() => ({}));
          throw new Error(
            (responseData as { message?: string }).message ??
              "Error al eliminar el usuario de autenticación."
          );
        }
      }

      // Delete from usuarios table
      const { error: deleteError } = await supabase
        .from("usuarios")
        .delete()
        .eq("id", usuario.id);

      if (deleteError) throw deleteError;

      setUsuarios((prev) => prev.filter((u) => u.id !== usuario.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al eliminar el usuario.");
    } finally {
      setDeletingId(null);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
        <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
          <div className="rounded-3xl border border-zinc-200 bg-white/85 p-6 text-sm text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
            Debes iniciar sesión para acceder a esta página.
          </div>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
        <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
          <div className="rounded-3xl border border-zinc-200 bg-white/80 p-5 text-sm text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            Cargando...
          </div>
        </main>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
        <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            No tienes permisos para acceder a esta página. Se requiere rol de administrador.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <header className="rounded-3xl border border-zinc-200 bg-white/85 p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Gestión de usuarios
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            Administra los usuarios registrados en el sistema.
          </p>

          <div className="mt-4">
            <Link
              href="/dashboard"
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
            >
              Volver al dashboard
            </Link>
          </div>
        </header>

        {error && (
          <section className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </section>
        )}

        <section className="mt-6">
          {usuarios.length === 0 ? (
            <div className="rounded-3xl border border-zinc-200 bg-white/80 p-5 text-sm text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              No hay usuarios registrados.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
                {usuarios.length} usuario{usuarios.length !== 1 ? "s" : ""} en total
              </p>

              {usuarios.map((usuario) => (
                <article
                  key={usuario.id}
                  className="rounded-3xl border border-zinc-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                          {usuario.nombre || "Sin nombre"}
                        </h2>

                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                            isAdminRole(usuario.rol)
                              ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                              : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          }`}
                        >
                          {usuario.rol || "sin rol"}
                        </span>

                        {!usuario.activo && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                            Inactivo
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {usuario.email}
                      </p>

                      {usuario.identificacion && (
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          ID: {usuario.identificacion}
                        </p>
                      )}

                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        Registrado: {formatDate(usuario.created_at)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDelete(usuario)}
                      disabled={deletingId === usuario.id}
                      className="shrink-0 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-700 transition hover:border-red-400 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:border-red-500 dark:hover:bg-red-900/30"
                    >
                      {deletingId === usuario.id ? "Eliminando..." : "Eliminar"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
