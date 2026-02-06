"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { getAcreedoresByProceso } from "@/lib/api/acreedores";
import { getAcreenciasByProcesoAndApoderado, upsertAcreencias } from "@/lib/api/acreencias";
import { getApoderadoById } from "@/lib/api/apoderados";
import { getProcesoById } from "@/lib/api/proceso";
import type { Acreedor, Acreencia } from "@/lib/database.types";

type AcreenciaDraft = {
  id?: string;
  acreedor_id: string;
  acreedor_nombre: string;
  naturaleza: string;
  prelacion: string;
  capital: string;
  int_cte: string;
  int_mora: string;
  otros_cobros_seguros: string;
  total: string;
  porcentaje: string;
};

function normalizarNumero(valor: string) {
  return valor.replace(",", ".").trim();
}

function toNumberOrNull(valor: string) {
  const normalized = normalizarNumero(valor);
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function toFixedOrEmpty(n: number | null | undefined) {
  if (n === null || n === undefined) return "";
  return String(n);
}

function calcularTotal(draft: Pick<AcreenciaDraft, "capital" | "int_cte" | "int_mora" | "otros_cobros_seguros">) {
  const capital = toNumberOrNull(draft.capital) ?? 0;
  const intCte = toNumberOrNull(draft.int_cte) ?? 0;
  const intMora = toNumberOrNull(draft.int_mora) ?? 0;
  const otros = toNumberOrNull(draft.otros_cobros_seguros) ?? 0;
  const total = capital + intCte + intMora + otros;
  return total === 0 ? "" : String(total);
}

function formatPorcentaje(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return value.toFixed(2);
}

function toErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    return JSON.stringify(e, Object.getOwnPropertyNames(e));
  }
  return String(e);
}

function AcreenciasContent() {
  const searchParams = useSearchParams();
  const procesoId = searchParams.get("procesoId") ?? "";
  const apoderadoId = searchParams.get("apoderadoId") ?? "";

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);

  const [procesoNumero, setProcesoNumero] = useState<string | null>(null);
  const [apoderadoNombre, setApoderadoNombre] = useState<string | null>(null);

  const [acreedores, setAcreedores] = useState<Acreedor[]>([]);
  const [drafts, setDrafts] = useState<AcreenciaDraft[]>([]);

  const puedeCargar = Boolean(procesoId && apoderadoId);

  const hrefVolver = useMemo(() => {
    const qs = new URLSearchParams();
    if (procesoId) qs.set("procesoId", procesoId);
    return `/lista?${qs.toString()}`;
  }, [procesoId]);

  const porcentajeCalculadoByAcreedorId = useMemo(() => {
    const totales = drafts.map((draft) => toNumberOrNull(draft.total) ?? 0);
    const totalSum = totales.reduce((acc, n) => acc + n, 0);

    const byAcreedorId = new Map<string, number | null>();
    drafts.forEach((draft, idx) => {
      const total = totales[idx] ?? 0;
      byAcreedorId.set(draft.acreedor_id, totalSum > 0 ? (total / totalSum) * 100 : null);
    });

    return { totalSum, byAcreedorId };
  }, [drafts]);

  useEffect(() => {
    if (!puedeCargar) {
      setError(null);
      setAcreedores([]);
      setDrafts([]);
      setProcesoNumero(null);
      setApoderadoNombre(null);
      return;
    }

    let activo = true;

    const cargar = async () => {
      setCargando(true);
      setError(null);
      setGuardadoOk(null);

      try {
        const [proceso, apoderado, acreedoresProceso, acreenciasExistentes] =
          await Promise.all([
            getProcesoById(procesoId),
            getApoderadoById(apoderadoId),
            getAcreedoresByProceso(procesoId),
            getAcreenciasByProcesoAndApoderado(procesoId, apoderadoId),
          ]);

        if (!activo) return;

        setProcesoNumero(proceso.numero_proceso ?? null);
        setApoderadoNombre(apoderado.nombre ?? null);

        const acreedoresDelApoderado = (acreedoresProceso ?? []).filter(
          (a) => a.apoderado_id === apoderadoId
        );
        setAcreedores(acreedoresDelApoderado);

        const byAcreedorId = new Map<string, Acreencia>();
        acreenciasExistentes.forEach((a) => byAcreedorId.set(a.acreedor_id, a));

        const filas: AcreenciaDraft[] = acreedoresDelApoderado.map((acreedor) => {
          const existente = byAcreedorId.get(acreedor.id);
          const draftBase: AcreenciaDraft = {
            id: existente?.id,
            acreedor_id: acreedor.id,
            acreedor_nombre: acreedor.nombre ?? "Acreedor",
            naturaleza: existente?.naturaleza ?? "",
            prelacion: existente?.prelacion ?? "",
            capital: toFixedOrEmpty(existente?.capital ?? null),
            int_cte: toFixedOrEmpty(existente?.int_cte ?? null),
            int_mora: toFixedOrEmpty(existente?.int_mora ?? null),
            otros_cobros_seguros: toFixedOrEmpty(existente?.otros_cobros_seguros ?? null),
            total: toFixedOrEmpty(existente?.total ?? null),
            porcentaje: toFixedOrEmpty(existente?.porcentaje ?? null),
          };

          const totalCalculado = calcularTotal(draftBase);
          return {
            ...draftBase,
            total: draftBase.total || totalCalculado,
          };
        });

        setDrafts(filas);
      } catch (e: unknown) {
        if (activo) setError(toErrorMessage(e));
      } finally {
        if (activo) setCargando(false);
      }
    };

    cargar();

    return () => {
      activo = false;
    };
  }, [apoderadoId, procesoId, puedeCargar]);

  const onChange = (idx: number, patch: Partial<AcreenciaDraft>) => {
    setDrafts((prev) => {
      const next = [...prev];
      const base = next[idx];
      if (!base) return prev;
      const merged = { ...base, ...patch };

      const camposQueRecalcularonTotal = ["capital", "int_cte", "int_mora", "otros_cobros_seguros"] as const;
      if (camposQueRecalcularonTotal.some((k) => k in patch)) {
        merged.total = calcularTotal(merged);
      }

      next[idx] = merged;
      return next;
    });
  };

  const guardar = async () => {
    if (!puedeCargar) return;
    setGuardando(true);
    setError(null);
    setGuardadoOk(null);

    try {
      const payloads = drafts.map((draft) => ({
        proceso_id: procesoId,
        apoderado_id: apoderadoId,
        acreedor_id: draft.acreedor_id,
        naturaleza: draft.naturaleza.trim() || null,
        prelacion: draft.prelacion.trim() || null,
        capital: toNumberOrNull(draft.capital),
        int_cte: toNumberOrNull(draft.int_cte),
        int_mora: toNumberOrNull(draft.int_mora),
        otros_cobros_seguros: toNumberOrNull(draft.otros_cobros_seguros),
        total: toNumberOrNull(draft.total),
        porcentaje: porcentajeCalculadoByAcreedorId.byAcreedorId.get(draft.acreedor_id) ?? null,
      }));

      const guardadas = await upsertAcreencias(payloads);
      const byAcreedorId = new Map<string, Acreencia>();
      guardadas.forEach((a) => byAcreedorId.set(a.acreedor_id, a));

      setDrafts((prev) =>
        prev.map((draft) => {
          const saved = byAcreedorId.get(draft.acreedor_id);
          return saved ? { ...draft, id: saved.id } : draft;
        })
      );

      setGuardadoOk("Acreencias guardadas correctamente.");
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Formulario de acreencias
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Acreencias</h1>
            <Link
              href={hrefVolver}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
            >
              Volver
            </Link>
          </div>

          <p className="mt-2 max-w-3xl text-zinc-600 dark:text-zinc-300">
            Proceso:{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {procesoNumero ?? (procesoId || "—")}
            </span>{" "}
            · Apoderado:{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {apoderadoNombre ?? (apoderadoId || "—")}
            </span>
          </p>
        </header>

        {!puedeCargar ? (
          <section className="rounded-3xl border border-zinc-200 bg-white/80 p-6 text-sm text-zinc-700 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
            <p className="font-medium">Faltan par&aacute;metros.</p>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Abre esta p&aacute;gina con <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">procesoId</code>{" "}
              y <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">apoderadoId</code> en la URL.
            </p>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Ejemplo: <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">/acreencias?procesoId=...&amp;apoderadoId=...</code>
            </p>
          </section>
        ) : (
          <section className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-zinc-600 dark:text-zinc-300">
                {cargando ? "Cargando datos..." : acreedores.length === 0 ? "No hay acreedores asociados a este apoderado en este proceso." : "Edita y guarda la informaci\u00f3n."}
              </div>
              <button
                type="button"
                onClick={guardar}
                disabled={guardando || cargando || drafts.length === 0}
                className="inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-2 text-sm font-medium text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-950"
              >
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            ) : null}

            {guardadoOk ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
                {guardadoOk}
              </div>
            ) : null}

            {drafts.length > 0 ? (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[980px] border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.25em] text-zinc-400">
                      <th className="pb-3 pr-4">Acreedor</th>
                      <th className="pb-3 pr-4">Naturaleza</th>
                      <th className="pb-3 pr-4">Prelaci&oacute;n</th>
                      <th className="pb-3 pr-4">Capital</th>
                      <th className="pb-3 pr-4">Int. Cte.</th>
                      <th className="pb-3 pr-4">Int. Mora</th>
                      <th className="pb-3 pr-4">Otros</th>
                      <th className="pb-3 pr-4">Total</th>
                      <th className="pb-3 pr-0">%</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {drafts.map((draft, idx) => (
                      <tr key={draft.acreedor_id} className="border-t border-zinc-200/70 dark:border-white/10">
                        <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                          <div className="max-w-[260px] truncate">{draft.acreedor_nombre}</div>
                        </td>

                        <td className="py-3 pr-4">
                          <input
                            value={draft.naturaleza}
                            onChange={(e) => onChange(idx, { naturaleza: e.target.value })}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                            placeholder="Ej: Quirografaria"
                          />
                        </td>

                        <td className="py-3 pr-4">
                          <input
                            value={draft.prelacion}
                            onChange={(e) => onChange(idx, { prelacion: e.target.value })}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                            placeholder="Ej: 1"
                          />
                        </td>

                        <td className="py-3 pr-4">
                          <input
                            inputMode="decimal"
                            value={draft.capital}
                            onChange={(e) => onChange(idx, { capital: e.target.value })}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                            placeholder="0"
                          />
                        </td>

                        <td className="py-3 pr-4">
                          <input
                            inputMode="decimal"
                            value={draft.int_cte}
                            onChange={(e) => onChange(idx, { int_cte: e.target.value })}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                            placeholder="0"
                          />
                        </td>

                        <td className="py-3 pr-4">
                          <input
                            inputMode="decimal"
                            value={draft.int_mora}
                            onChange={(e) => onChange(idx, { int_mora: e.target.value })}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                            placeholder="0"
                          />
                        </td>

                        <td className="py-3 pr-4">
                          <input
                            inputMode="decimal"
                            value={draft.otros_cobros_seguros}
                            onChange={(e) => onChange(idx, { otros_cobros_seguros: e.target.value })}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                            placeholder="0"
                          />
                        </td>

                        <td className="py-3 pr-4">
                          <input
                            inputMode="decimal"
                            value={draft.total}
                            onChange={(e) => onChange(idx, { total: e.target.value })}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                            placeholder="0"
                          />
                        </td>

                        <td className="py-3 pr-0">
                          {(() => {
                            const porcentaje =
                              porcentajeCalculadoByAcreedorId.byAcreedorId.get(draft.acreedor_id) ?? null;
                            return (
                          <input
                            inputMode="decimal"
                            value={formatPorcentaje(porcentaje)}
                            readOnly
                            disabled
                            className="w-full cursor-not-allowed rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none dark:border-white/10 dark:bg-white/10 dark:text-zinc-50"
                            placeholder={porcentajeCalculadoByAcreedorId.totalSum > 0 ? "0" : "—"}
                          />
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

export default function AcreenciasPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
          <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">Cargando...</main>
        </div>
      }
    >
      <AcreenciasContent />
    </Suspense>
  );
}
