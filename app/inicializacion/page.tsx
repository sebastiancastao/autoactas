"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { getApoderados } from "@/lib/api/apoderados";
import { getProcesos } from "@/lib/api/proceso";
import type { Apoderado, Proceso } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

type AutoAdmisorioResult = {
  fileId: string;
  fileName: string;
  webViewLink: string | null;
  apoderadoEmails?: string[];
};

type AutoAdmisorioState = {
  loading: boolean;
  error: string | null;
  result: AutoAdmisorioResult | null;
  emailSending: boolean;
  emailResult: { sent: number; errors?: string[] } | null;
  emailError: string | null;
};

const EMPTY_AUTO_STATE: AutoAdmisorioState = {
  loading: false,
  error: null,
  result: null,
  emailSending: false,
  emailResult: null,
  emailError: null,
};

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const first = [record.message, record.detail, record.details, record.error].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (first) return first;
  }
  return fallback;
}

function isMissingCreatedByAuthIdColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  const details = typeof record.details === "string" ? record.details : "";
  const source = `${message} ${details}`.toLowerCase();
  return (
    code === "PGRST204" ||
    code === "42703" ||
    source.includes("created_by_auth_id")
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function InicializacionPage() {
  const { user } = useAuth();
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [apoderadoOptions, setApoderadoOptions] = useState<Apoderado[]>([]);
  const apoderadosByProcesoId = useMemo(() => {
    const map: Record<string, Apoderado[]> = {};
    apoderadoOptions.forEach((apoderado) => {
      const procesoId = apoderado.proceso_id ?? "";
      if (!procesoId) return;
      if (!map[procesoId]) map[procesoId] = [];
      map[procesoId].push(apoderado);
    });
    return map;
  }, [apoderadoOptions]);
  const apoderadoById = useMemo(() => {
    const map: Record<string, Apoderado> = {};
    apoderadoOptions.forEach((apoderado) => {
      map[apoderado.id] = apoderado;
    });
    return map;
  }, [apoderadoOptions]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [legacyWarning, setLegacyWarning] = useState<string | null>(null);
  const [apoderadoSubmissionByProcesoId, setApoderadoSubmissionByProcesoId] = useState<
    Record<string, { deudorIds: string[]; acreedorIds: string[] }>
  >({});
  const [apoderadoSubmissionLoading, setApoderadoSubmissionLoading] = useState(false);
  const [autoAdmisorioByProcesoId, setAutoAdmisorioByProcesoId] = useState<
    Record<string, AutoAdmisorioState>
  >({});

  const loadProcesos = useCallback(async () => {
    if (!user?.id) {
      setProcesos([]);
      setLegacyWarning(null);
      setError(null);
      setCargando(false);
      return;
    }

    setCargando(true);
    setError(null);
    setLegacyWarning(null);

    try {
      const { data, error: queryError } = await supabase
        .from("proceso")
        .select("*")
        .eq("created_by_auth_id", user.id)
        .order("created_at", { ascending: false });

      if (queryError) {
        if (isMissingCreatedByAuthIdColumn(queryError)) {
          const legacyProcesos = await getProcesos();
          setProcesos(legacyProcesos ?? []);
          setLegacyWarning(
            "No se detecto la columna created_by_auth_id. Ejecuta la migracion 20260213 para filtrar por usuario.",
          );
          return;
        }
        throw queryError;
      }

      setProcesos(data ?? []);
    } catch (err) {
      setError(toErrorMessage(err, "No se pudo cargar la lista de procesos."));
    } finally {
      setCargando(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadProcesos();
  }, [loadProcesos]);

  useEffect(() => {
    let active = true;
    const cargarApoderados = async () => {
      try {
        const data = await getApoderados();
        if (active) {
          setApoderadoOptions(data ?? []);
        }
      } catch (loadError) {
        console.error("Error cargando apoderados para inicializacion:", loadError);
      }
    };
    void cargarApoderados();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const procesoIds = (procesos ?? []).map((proceso) => proceso.id).filter(Boolean);
    if (procesoIds.length === 0) {
      setApoderadoSubmissionByProcesoId({});
      return;
    }

    let canceled = false;
    (async () => {
      setApoderadoSubmissionLoading(true);
      try {
        const { data: deudores, error: deudorError } = await supabase
          .from("deudores")
          .select("proceso_id, apoderado_id")
          .in("proceso_id", procesoIds)
          .not("apoderado_id", "is", null);
        if (deudorError) throw deudorError;

        const { data: acreedores, error: acreedorError } = await supabase
          .from("acreedores")
          .select("proceso_id, apoderado_id")
          .in("proceso_id", procesoIds)
          .not("apoderado_id", "is", null);
        if (acreedorError) throw acreedorError;

        const map = new Map<string, { deudor: Set<string>; acreedor: Set<string> }>();
        const ensure = (procesoId: string) => {
          const existing = map.get(procesoId);
          if (existing) return existing;
          const created = { deudor: new Set<string>(), acreedor: new Set<string>() };
          map.set(procesoId, created);
          return created;
        };

        (deudores ?? []).forEach((row: { proceso_id: string | null; apoderado_id: string | null }) => {
          const procesoId = row.proceso_id;
          const apoderadoId = row.apoderado_id;
          if (!procesoId || !apoderadoId) return;
          ensure(procesoId).deudor.add(apoderadoId);
        });

        (acreedores ?? []).forEach((row: { proceso_id: string | null; apoderado_id: string | null }) => {
          const procesoId = row.proceso_id;
          const apoderadoId = row.apoderado_id;
          if (!procesoId || !apoderadoId) return;
          ensure(procesoId).acreedor.add(apoderadoId);
        });

        const next: Record<string, { deudorIds: string[]; acreedorIds: string[] }> = {};
        procesoIds.forEach((procesoId) => {
          const sets = map.get(procesoId);
          next[procesoId] = {
            deudorIds: sets ? Array.from(sets.deudor) : [],
            acreedorIds: sets ? Array.from(sets.acreedor) : [],
          };
        });

        if (!canceled) setApoderadoSubmissionByProcesoId(next);
      } catch (loadError) {
        console.error("Error loading apoderado submission summary in inicializacion:", loadError);
        if (!canceled) setApoderadoSubmissionByProcesoId({});
      } finally {
        if (!canceled) setApoderadoSubmissionLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [procesos]);

  const filteredProcesos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return procesos;
    return procesos.filter((proceso) => {
      const haystack = [
        proceso.numero_proceso,
        proceso.tipo_proceso,
        proceso.juzgado,
        proceso.descripcion,
        proceso.estado,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [procesos, searchQuery]);

  const getAutoState = (procesoId: string) =>
    autoAdmisorioByProcesoId[procesoId] ?? EMPTY_AUTO_STATE;

  async function crearAutoAdmisorio(proceso: Proceso) {
    const pid = proceso.id;
    setAutoAdmisorioByProcesoId((prev) => ({
      ...prev,
      [pid]: {
        ...(prev[pid] ?? EMPTY_AUTO_STATE),
        loading: true,
        error: null,
        emailError: null,
      },
    }));

    try {
      const response = await fetch("/api/crear-auto-admisorio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          procesoId: pid,
          authUserId: user?.id,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | (AutoAdmisorioResult & { error?: string; detail?: string })
        | null;

      if (!response.ok || !payload?.fileId) {
        throw new Error(
          payload?.detail || payload?.error || "No se pudo crear el auto admisorio.",
        );
      }

      setAutoAdmisorioByProcesoId((prev) => ({
        ...prev,
        [pid]: {
          ...(prev[pid] ?? EMPTY_AUTO_STATE),
          loading: false,
          error: null,
          result: {
            fileId: payload.fileId,
            fileName: payload.fileName,
            webViewLink: payload.webViewLink ?? null,
            apoderadoEmails: payload.apoderadoEmails ?? [],
          },
          emailResult: null,
          emailError: null,
        },
      }));
    } catch (err) {
      setAutoAdmisorioByProcesoId((prev) => ({
        ...prev,
        [pid]: {
          ...(prev[pid] ?? EMPTY_AUTO_STATE),
          loading: false,
          error: toErrorMessage(err, "No se pudo crear el auto admisorio."),
        },
      }));
    }
  }

  async function enviarAutoAdmisorioApoderados(proceso: Proceso) {
    const state = getAutoState(proceso.id);
    const emails = state.result?.apoderadoEmails ?? [];
    const webViewLink = state.result?.webViewLink;
    if (!emails.length || !webViewLink || state.emailSending) return;

    setAutoAdmisorioByProcesoId((prev) => ({
      ...prev,
      [proceso.id]: {
        ...(prev[proceso.id] ?? EMPTY_AUTO_STATE),
        emailSending: true,
        emailError: null,
        emailResult: null,
      },
    }));

    try {
      const response = await fetch("/api/enviar-acta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apoderadoEmails: emails,
          numeroProceso: proceso.numero_proceso || proceso.id,
          titulo: "Auto de Admision",
          fecha: new Date().toISOString().slice(0, 10),
          webViewLink,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { emailsSent: number; emailErrors?: string[]; error?: string; detail?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.detail || payload?.error || "No se pudieron enviar los correos.",
        );
      }

      setAutoAdmisorioByProcesoId((prev) => ({
        ...prev,
        [proceso.id]: {
          ...(prev[proceso.id] ?? EMPTY_AUTO_STATE),
          emailSending: false,
          emailError: null,
          emailResult: {
            sent: payload?.emailsSent ?? 0,
            errors: payload?.emailErrors ?? [],
          },
        },
      }));
    } catch (err) {
      setAutoAdmisorioByProcesoId((prev) => ({
        ...prev,
        [proceso.id]: {
          ...(prev[proceso.id] ?? EMPTY_AUTO_STATE),
          emailSending: false,
          emailError: toErrorMessage(err, "No se pudo enviar el correo a apoderados."),
        },
      }));
    }
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <div className="rounded-3xl border border-zinc-200 bg-white/85 p-6 text-sm text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
          Debes iniciar sesion para acceder a Inicializacion.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <header className="rounded-3xl border border-zinc-200 bg-white/85 p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Inicializacion
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Auto admisorio por proceso
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
            Aqui puedes generar el auto admisorio para cada proceso registrado por tu usuario
            y enviar el documento a los apoderados.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/procesos"
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
            >
              Procesos
            </Link>
            <Link
              href="/calendario"
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
            >
              Calendario
            </Link>
            <button
              type="button"
              onClick={() => void loadProcesos()}
              disabled={cargando}
              className="rounded-full bg-zinc-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {cargando ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-zinc-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Procesos disponibles:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{procesos.length}</span>
            </p>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar por numero, tipo o juzgado..."
              className="h-10 w-full max-w-xs rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>

          {legacyWarning && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {legacyWarning}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          {cargando ? (
            <div className="mt-5 text-sm text-zinc-500 dark:text-zinc-400">
              Cargando procesos...
            </div>
          ) : filteredProcesos.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              No se encontraron procesos para inicializar.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {filteredProcesos.map((proceso) => {
                const autoState = getAutoState(proceso.id);
                const submission = apoderadoSubmissionByProcesoId[proceso.id] ?? {
                  deudorIds: [],
                  acreedorIds: [],
                };
                const apoderadosDelProceso = (() => {
                  const seen = new Set<string>();
                  const result: Apoderado[] = [];
                  const addUnique = (apoderado: Apoderado) => {
                    if (!seen.has(apoderado.id)) {
                      seen.add(apoderado.id);
                      result.push(apoderado);
                    }
                  };
                  (apoderadosByProcesoId[proceso.id] ?? []).forEach(addUnique);
                  for (const apoderadoId of submission.deudorIds) {
                    const apoderado = apoderadoById[apoderadoId];
                    if (apoderado) addUnique(apoderado);
                  }
                  for (const apoderadoId of submission.acreedorIds) {
                    const apoderado = apoderadoById[apoderadoId];
                    if (apoderado) addUnique(apoderado);
                  }
                  return result;
                })();
                const deudorSet = new Set(submission.deudorIds);
                const acreedorSet = new Set(submission.acreedorIds);
                const submittedAnyCount = apoderadosDelProceso.filter(
                  (apoderado) => deudorSet.has(apoderado.id) || acreedorSet.has(apoderado.id),
                ).length;
                const hasApoderadosIncompletos =
                  apoderadosDelProceso.length > 0 && submittedAnyCount < apoderadosDelProceso.length;
                const apoderadoEmails = autoState.result?.apoderadoEmails ?? [];
                return (
                  <article
                    key={proceso.id}
                    className="rounded-2xl border border-zinc-200 bg-white/75 p-4 shadow-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                          {proceso.numero_proceso}
                        </h2>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Fecha: {formatDate(proceso.fecha_procesos)}
                          {proceso.tipo_proceso ? ` · Tipo: ${proceso.tipo_proceso}` : ""}
                          {proceso.juzgado ? ` · ${proceso.juzgado}` : ""}
                        </p>
                      </div>
                      <span
                        className={[
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          proceso.estado === "Activo"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : proceso.estado === "Finalizado"
                              ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
                        ].join(" ")}
                      >
                        {proceso.estado || "Sin estado"}
                      </span>
                    </div>

                    {proceso.descripcion && (
                      <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                        {proceso.descripcion}
                      </p>
                    )}

                    <div className="mt-3 flex flex-col gap-2">
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Apoderados:{" "}
                        <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                          {submittedAnyCount}/{apoderadosDelProceso.length}
                        </span>{" "}
                        {apoderadoSubmissionLoading ? "(cargando...)" : "registrados"}
                      </div>
                      {apoderadosDelProceso.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {apoderadosDelProceso.slice(0, 6).map((apoderado) => {
                            const didD = deudorSet.has(apoderado.id);
                            const didA = acreedorSet.has(apoderado.id);
                            const ok = didD || didA;
                            const flags = `${didD ? "D" : ""}${didA ? "A" : ""}`;
                            return (
                              <span
                                key={apoderado.id}
                                className={[
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                  ok
                                    ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
                                    : "border-zinc-200 bg-white/60 text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300",
                                ].join(" ")}
                              >
                                <span
                                  className={
                                    ok
                                      ? "h-1.5 w-1.5 rounded-full bg-green-500"
                                      : "h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600"
                                  }
                                />
                                <span className="max-w-[160px] truncate">{apoderado.nombre}</span>
                                {flags ? <span className="opacity-70">{flags}</span> : null}
                              </span>
                            );
                          })}
                          {apoderadosDelProceso.length > 6 && (
                            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                              +{apoderadosDelProceso.length - 6}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/lista?procesoId=${proceso.id}`}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/60"
                      >
                        Ir a Audiencia
                      </Link>

                      <button
                        type="button"
                        onClick={() => {
                          if (hasApoderadosIncompletos) {
                            const continuar = window.confirm(
                              `Este proceso tiene apoderados sin registrar (${submittedAnyCount}/${apoderadosDelProceso.length}). ¿Deseas crear el auto admisorio de todas formas?`,
                            );
                            if (!continuar) return;
                          }
                          void crearAutoAdmisorio(proceso);
                        }}
                        disabled={autoState.loading}
                        className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-900 transition hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:border-amber-700 dark:hover:bg-amber-950/60"
                      >
                        {autoState.loading ? "Creando..." : "Crear auto admisorio"}
                      </button>

                      {autoState.result?.webViewLink && (
                        <a
                          href={autoState.result.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
                        >
                          Abrir en Drive
                        </a>
                      )}

                      {apoderadoEmails.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void enviarAutoAdmisorioApoderados(proceso)}
                          disabled={autoState.emailSending}
                          className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 transition hover:border-blue-500 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/60"
                        >
                          {autoState.emailSending
                            ? "Enviando..."
                            : `Enviar a apoderados (${apoderadoEmails.length})`}
                        </button>
                      )}
                    </div>

                    {autoState.error && (
                      <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        {autoState.error}
                      </div>
                    )}

                    {autoState.result?.webViewLink && (
                      <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
                        Documento generado:{" "}
                        <span className="font-semibold">
                          {autoState.result.fileName || "Auto admisorio"}
                        </span>
                      </div>
                    )}

                    {apoderadoEmails.length === 0 && autoState.result?.fileId && (
                      <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                        No hay apoderados con correo disponible para envio.
                      </div>
                    )}

                    {autoState.emailError && (
                      <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        {autoState.emailError}
                      </div>
                    )}

                    {autoState.emailResult && (
                      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                        Correos enviados: {autoState.emailResult.sent}
                        {autoState.emailResult.errors && autoState.emailResult.errors.length > 0 && (
                          <span className="text-amber-700 dark:text-amber-300">
                            {" "}
                            ({autoState.emailResult.errors.length} fallidos)
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
