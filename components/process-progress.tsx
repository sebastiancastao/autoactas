"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

const STEPS = [
  {
    key: "proceso",
    label: "Proceso",
    description: "Configura expediente y participantes.",
    href: "/procesos",
  },
  {
    key: "calendario",
    label: "Calendario",
    description: "Programa audiencia y seguimiento.",
    href: "/calendario",
  },
  {
    key: "inicializacion",
    label: "Inicializacion",
    description: "Prepara documentos de inicio.",
    href: "/inicializacion",
  },
  {
    key: "lista",
    label: "Audiencia",
    description: "Controla asistencia y actas.",
    href: "/lista",
  },
] as const;

type ListaProcesoOption = {
  id: string;
  numero_proceso: string;
  created_at: string;
};

function normalizePathname(pathname: string | null | undefined) {
  if (!pathname) return "/";
  const [base] = pathname.split("?");
  return base;
}

function resolveStageIndex(normalizedPathname: string): number {
  if (
    !normalizedPathname ||
    normalizedPathname === "/" ||
    normalizedPathname.startsWith("/procesos")
  ) {
    return 0;
  }
  if (normalizedPathname.startsWith("/calendario")) {
    return 1;
  }
  if (normalizedPathname.startsWith("/inicializacion")) {
    return 2;
  }
  if (normalizedPathname.startsWith("/lista") || normalizedPathname.startsWith("/acreencias")) {
    return 3;
  }
  return 0;
}

function shouldShowProgress(pathname: string) {
  return [
    "/",
    "/procesos",
    "/calendario",
    "/inicializacion",
    "/lista",
    "/acreencias",
  ].some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = [record.message, record.detail, record.details, record.hint]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (message) {
      return message;
    }
  }

  return fallback;
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = `${record.message ?? ""} ${record.details ?? ""}`.toLowerCase();
  return (code === "PGRST204" || code === "42703" || code === "PGRST200") && message.includes(columnName);
}

export function ProcessProgress() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const normalizedPathname = useMemo(() => normalizePathname(pathname), [pathname]);
  const activeIndex = useMemo(
    () => resolveStageIndex(normalizedPathname),
    [normalizedPathname],
  );
  const [listaPickerOpen, setListaPickerOpen] = useState(false);
  const [loadingListaProcesos, setLoadingListaProcesos] = useState(false);
  const [listaProcesosError, setListaProcesosError] = useState<string | null>(null);
  const [listaProcesos, setListaProcesos] = useState<ListaProcesoOption[]>([]);
  const [hasLoadedListaProcesos, setHasLoadedListaProcesos] = useState(false);
  const [selectedListaProcesoId, setSelectedListaProcesoId] = useState("");

  async function loadListaProcesos(force = false) {
    if (!user?.id) {
      setListaProcesos([]);
      setListaProcesosError("Inicia sesion para ver tus procesos.");
      setHasLoadedListaProcesos(true);
      return;
    }

    if (hasLoadedListaProcesos && !force) return;

    setLoadingListaProcesos(true);
    setListaProcesosError(null);

    try {
      let usuarioPerfilId: string | null = null;

      const { data: usuarioPerfil, error: usuarioError } = await supabase
        .from("usuarios")
        .select("id")
        .eq("auth_id", user.id)
        .maybeSingle();

      if (usuarioError) {
        console.warn("No se pudo resolver usuarios.id para el selector de Lista:", usuarioError);
      } else {
        usuarioPerfilId = usuarioPerfil?.id ?? null;
      }

      let rows: ListaProcesoOption[] = [];

      if (usuarioPerfilId) {
        const combined = await supabase
          .from("proceso")
          .select("id, numero_proceso, created_at")
          .or(`created_by_auth_id.eq.${user.id},usuario_id.eq.${usuarioPerfilId}`)
          .order("created_at", { ascending: false });

        if (!combined.error) {
          rows = (combined.data ?? []) as ListaProcesoOption[];
        } else {
          const missingUsuarioId = isMissingColumnError(combined.error, "usuario_id");
          const missingCreatedByAuthId = isMissingColumnError(combined.error, "created_by_auth_id");

          if (missingUsuarioId && !missingCreatedByAuthId) {
            const byCreator = await supabase
              .from("proceso")
              .select("id, numero_proceso, created_at")
              .eq("created_by_auth_id", user.id)
              .order("created_at", { ascending: false });
            if (byCreator.error) throw byCreator.error;
            rows = (byCreator.data ?? []) as ListaProcesoOption[];
          } else if (!missingUsuarioId && missingCreatedByAuthId) {
            const byUsuario = await supabase
              .from("proceso")
              .select("id, numero_proceso, created_at")
              .eq("usuario_id", usuarioPerfilId)
              .order("created_at", { ascending: false });
            if (byUsuario.error) throw byUsuario.error;
            rows = (byUsuario.data ?? []) as ListaProcesoOption[];
          } else if (missingUsuarioId && missingCreatedByAuthId) {
            rows = [];
          } else {
            throw combined.error;
          }
        }
      } else {
        const byCreator = await supabase
          .from("proceso")
          .select("id, numero_proceso, created_at")
          .eq("created_by_auth_id", user.id)
          .order("created_at", { ascending: false });

        if (byCreator.error) {
          if (isMissingColumnError(byCreator.error, "created_by_auth_id")) {
            rows = [];
          } else {
            throw byCreator.error;
          }
        } else {
          rows = (byCreator.data ?? []) as ListaProcesoOption[];
        }
      }

      setListaProcesos(rows);
    } catch (error) {
      setListaProcesos([]);
      setListaProcesosError(toErrorMessage(error, "No se pudo cargar tus procesos."));
    } finally {
      setLoadingListaProcesos(false);
      setHasLoadedListaProcesos(true);
    }
  }

  function handleListaStepClick() {
    const nextOpen = !listaPickerOpen;
    setListaPickerOpen(nextOpen);
    setSelectedListaProcesoId("");

    if (nextOpen) {
      void loadListaProcesos();
    }
  }

  function handleListaProcesoChange(procesoId: string) {
    setSelectedListaProcesoId(procesoId);
    if (!procesoId) return;
    setListaPickerOpen(false);
    router.push(`/lista?procesoId=${encodeURIComponent(procesoId)}`);
  }

  useEffect(() => {
    setListaPickerOpen(false);
    setSelectedListaProcesoId("");
  }, [normalizedPathname]);

  useEffect(() => {
    setHasLoadedListaProcesos(false);
    setListaProcesos([]);
    setListaProcesosError(null);
    setSelectedListaProcesoId("");
  }, [user?.id]);

  if (normalizedPathname === "/login" || !shouldShowProgress(normalizedPathname)) {
    return null;
  }

  const progressPercent = ((activeIndex + 1) / STEPS.length) * 100;

  return (
    <div className="border-b border-zinc-800 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black shadow-sm">
      <div className="mx-auto w-full max-w-6xl px-5 py-4 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-zinc-400">
              Flujo del proceso
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              Avanza por etapas y usa cada paso para navegar mas rapido.
            </p>
          </div>
          <div className="self-start rounded-full border border-emerald-500/70 bg-zinc-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400 sm:self-auto">
            Etapa {activeIndex + 1} / {STEPS.length}
          </div>
        </div>

        <div className="mt-4 h-1.5 w-full rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <ol className="mt-4 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          {STEPS.map((step, index) => {
            const isActive = index === activeIndex;
            const isComplete = index < activeIndex;
            const cardClassName = `group flex h-full min-h-[96px] flex-col justify-between rounded-2xl border p-3 transition ${
              isActive
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-100 shadow-sm shadow-emerald-500/20"
                : isComplete
                  ? "border-zinc-500 bg-zinc-800/90 text-zinc-100 hover:border-emerald-400"
                  : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`;
            const badgeClassName = `inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              isActive
                ? "bg-emerald-400 text-black"
                : isComplete
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-800 text-zinc-300"
            }`;

            return (
              <li key={step.key} className="min-w-[165px] flex-1 sm:min-w-[180px]">
                {step.key === "lista" ? (
                  <div className={cardClassName}>
                    <button
                      type="button"
                      onClick={handleListaStepClick}
                      aria-current={isActive ? "step" : undefined}
                      aria-expanded={listaPickerOpen}
                      aria-controls="lista-proceso-picker"
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={badgeClassName}>{isComplete ? "OK" : index + 1}</span>
                        <span className="text-[10px] font-medium uppercase tracking-[0.2em] opacity-80">
                          {isActive ? "Actual" : isComplete ? "Completa" : "Pendiente"}
                        </span>
                      </div>
                      <div className="mt-2">
                        <p className="text-sm font-semibold tracking-wide">{step.label}</p>
                        <p className="mt-1 text-[11px] leading-relaxed opacity-80">{step.description}</p>
                      </div>
                    </button>

                    {listaPickerOpen && (
                      <div id="lista-proceso-picker" className="mt-3 border-t border-zinc-700/60 pt-3">
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-300">
                          Selecciona proceso
                        </label>
                        <select
                          value={selectedListaProcesoId}
                          onChange={(event) => handleListaProcesoChange(event.target.value)}
                          disabled={loadingListaProcesos}
                          className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">
                            {loadingListaProcesos ? "Cargando..." : "Selecciona un proceso..."}
                          </option>
                          {listaProcesos.map((proceso) => (
                            <option key={proceso.id} value={proceso.id}>
                              {proceso.numero_proceso || proceso.id}
                            </option>
                          ))}
                        </select>

                        {listaProcesosError && (
                          <p className="mt-2 text-[11px] text-red-300">{listaProcesosError}</p>
                        )}

                        {!loadingListaProcesos && !listaProcesosError && listaProcesos.length === 0 && (
                          <p className="mt-2 text-[11px] text-zinc-300">
                            No tienes procesos disponibles para abrir en Lista.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <Link
                    href={step.href}
                    aria-current={isActive ? "step" : undefined}
                    className={cardClassName}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={badgeClassName}>{isComplete ? "OK" : index + 1}</span>
                      <span className="text-[10px] font-medium uppercase tracking-[0.2em] opacity-80">
                        {isActive ? "Actual" : isComplete ? "Completa" : "Pendiente"}
                      </span>
                    </div>
                    <div className="mt-2">
                      <p className="text-sm font-semibold tracking-wide">{step.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed opacity-80">{step.description}</p>
                    </div>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
