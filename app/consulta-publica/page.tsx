import Link from "next/link";

import { createServerSupabase } from "@/lib/serverSupabase";
import type { Acreedor, Apoderado } from "@/lib/database.types";

type AcreedorDetalle = Acreedor & {
  apoderados: Apoderado[] | null;
};

const STATS = [
  { label: "Apoderados", description: "Personas habilitadas para representar", accent: "bg-emerald-50 text-emerald-600" },
  { label: "Acreedores", description: "Actores protegidos por un apoderado", accent: "bg-blue-50 text-blue-600" },
  { label: "Última actualización", description: "Información cargada directamente desde la base", accent: "bg-zinc-50 text-zinc-800" },
];

export const revalidate = 0;

export default async function ConsultaPublicaPage() {
  const supabase = createServerSupabase();

  const [apoderadosResult, acreedoresResult] = await Promise.all([
    supabase.from("apoderados").select("*").order("nombre", { ascending: true }),
    supabase
      .from("acreedores")
      .select("*, apoderados!acreedores_apoderado_id_fkey (*)")
      .order("created_at", { ascending: false }),
  ]);

  const apoderados = apoderadosResult.data ?? [];
  const acreedores = (acreedoresResult.data ?? []) as AcreedorDetalle[];

  const errores = [];
  if (apoderadosResult.error) errores.push("apoderados");
  if (acreedoresResult.error) errores.push("acreedores");

  const acreedoresByApoderado = new Map<string, AcreedorDetalle[]>();
  acreedores.forEach((acreedor) => {
    const ownerId = acreedor.apoderado_id;
    if (!ownerId) return;
    const lista = acreedoresByApoderado.get(ownerId) ?? [];
    lista.push(acreedor);
    acreedoresByApoderado.set(ownerId, lista);
  });

  const muestraApoderados = apoderados.slice(0, 6);
  const muestraAcreedores = acreedores.slice(0, 6);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <header className="space-y-3 rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-600 shadow-sm dark:border-white/10 dark:bg-black/20 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Consulta pública
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Apoderados y acreedores</h1>
            <p className="mt-2 max-w-3xl text-base text-zinc-600 dark:text-zinc-300">
              Accede sin iniciar sesión para revisar en tiempo real los apoderados registrados y a quiénes representan.
              Cualquier persona con el enlace puede ver la información general sin modificar nada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <p>Los datos se actualizan cada vez que recargas esta página.</p>
            <Link
              href="/login"
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 font-semibold text-zinc-800 transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:hover:border-white"
            >
              Inicia sesión para administrar
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          {STATS.map((stat, index) => {
            const value =
              index === 0
                ? apoderados.length
                : index === 1
                ? acreedores.length
                : new Date().toLocaleString();

            return (
              <div
                key={stat.label}
                className="space-y-1 rounded-2xl border border-zinc-200 bg-white/70 p-5 text-sm font-medium text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
              >
                <p className="text-xs uppercase tracking-[0.3em] text-zinc-400">{stat.description}</p>
                <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
                <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${stat.accent}`}>
                  {stat.label}
                </span>
              </div>
            );
          })}
        </section>

        {errores.length > 0 && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            No se pudieron cargar {errores.join(" y ")}. Intenta recargar en unos instantes.
          </div>
        )}

        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Apoderados destacados</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Se muestran hasta 6 registros recientes. Cada tarjeta resume contacto y acreedores asociados.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">
              {apoderados.length} registrados
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {muestraApoderados.map((apoderado) => {
              const representados = acreedoresByApoderado.get(apoderado.id) ?? [];
              return (
                <article
                  key={apoderado.id}
                  className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{apoderado.nombre}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{apoderado.identificacion}</p>
                    </div>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                      {representados.length} acreedor{representados.length === 1 ? "" : "es"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">Email: {apoderado.email ?? "Sin registro"}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Teléfono: {apoderado.telefono ?? "Sin registro"}
                  </p>
                  {representados.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {representados.slice(0, 3).map((acreedor) => (
                        <span
                          key={acreedor.id}
                          className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-semibold text-zinc-700 dark:bg-white/10 dark:text-zinc-200"
                        >
                          {acreedor.nombre}
                        </span>
                      ))}
                      {representados.length > 3 && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          +{representados.length - 3} más
                        </span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {muestraApoderados.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No hay apoderados para mostrar.</p>
            )}
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Acreedores vinculados</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Los acreedores más recientes que actualmente están ligados a un apoderado.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">
              {acreedores.length} totales
            </span>
          </div>
          <div className="grid gap-3">
            {muestraAcreedores.map((acreedor) => (
              <div
                key={acreedor.id}
                className="grid gap-2 rounded-2xl border border-zinc-200 bg-white/80 p-4 text-sm shadow-sm dark:border-white/10 dark:bg-white/5 sm:grid-cols-3"
              >
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50">{acreedor.nombre}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{acreedor.identificacion}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Tipo</p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">{acreedor.tipo_acreencia ?? "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Apoderado asignado</p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">
                    {acreedor.apoderados?.[0]?.nombre ?? "Sin asignar"}
                  </p>
                </div>
              </div>
            ))}
            {muestraAcreedores.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No hay acreedores con apoderado en este momento.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
