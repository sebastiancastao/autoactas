"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { getProcesoWithRelations } from "@/lib/api/proceso";
import { getApoderadosByIds } from "@/lib/api/apoderados";
import { getDeudoresByProceso } from "@/lib/api/deudores";
import { createAsistenciasBulk } from "@/lib/api/asistencia";
import { getAcreenciasByProceso, getAcreenciasHistorialByProceso, updateAcreencia } from "@/lib/api/acreencias";
import type { Acreedor, Acreencia, Apoderado, AsistenciaInsert } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

type Categoria = "Acreedor" | "Deudor" | "Apoderado";
type EstadoAsistencia = "Presente" | "Ausente";

type Asistente = {
  id: string;
  apoderadoId?: string;
  nombre: string;
  email: string;
  identificacion: string;
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

function getBogotaTimeHHMMNow(fallback = "11:30") {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(new Date());

    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hour}:${minute}`;
  } catch {
    return fallback;
  }
}

function normalizeHoraHHMM(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

type AcreedorConApoderadoId = {
  id?: string;
  nombre?: string | null;
  apoderado_id?: string | null;
};

type DeudorConApoderadoId = {
  id?: string;
  nombre?: string | null;
  identificacion?: string | null;
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
      identificacion: apoderado.identificacion ?? "",
      categoria: "Apoderado",
      estado: "Ausente",
      tarjetaProfesional: apoderado.tarjeta_profesional ?? "",
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

type AcreenciaHistorialRow = {
  id: string | number;
  acreencia_id: string | number;
  operacion: "INSERT" | "UPDATE" | "DELETE";
  changed_at: string;
  changed_by: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

type AcreenciaDraft = {
  naturaleza: string;
  prelacion: string;
  capital: string;
  int_cte: string;
  int_mora: string;
  otros_cobros_seguros: string;
  total: string;
  porcentaje: string;
};

type AcreenciaSnapshot = {
  id: string;
  updated_at: string;
  naturaleza: string | null;
  prelacion: string | null;
  capital: number | null;
  int_cte: number | null;
  int_mora: number | null;
  otros_cobros_seguros: number | null;
  total: number | null;
  porcentaje: number | null;
};

type AcreenciaCambio = {
  key: keyof Omit<AcreenciaSnapshot, "id" | "updated_at">;
  campo: string;
  antes: string;
  despues: string;
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

function esAcreenciaActualizada(acreencia: Pick<Acreencia, "created_at" | "updated_at">) {
  const created = new Date(acreencia.created_at).getTime();
  const updated = new Date(acreencia.updated_at).getTime();
  return Number.isFinite(created) && Number.isFinite(updated) && updated > created;
}

function formatFechaHora(valor: string) {
  const dt = new Date(valor);
  if (!Number.isFinite(dt.getTime())) return valor;
  return dt.toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatValorAcreencia(valor: string | number | null) {
  if (valor === null) return "—";
  if (typeof valor === "number") return String(valor);
  const v = valor.trim();
  return v ? v : "—";
}

function formatPorcentaje(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function getAcreenciaCambios(prev: AcreenciaSnapshot, next: AcreenciaSnapshot): AcreenciaCambio[] {
  const cambios: AcreenciaCambio[] = [];

  const campos: Array<{
    key: keyof Omit<AcreenciaSnapshot, "id" | "updated_at">;
    label: string;
  }> = [
    { key: "naturaleza", label: "Naturaleza" },
    { key: "prelacion", label: "Prelación" },
    { key: "capital", label: "Capital" },
    { key: "int_cte", label: "Int. Cte." },
    { key: "int_mora", label: "Int. Mora" },
    { key: "otros_cobros_seguros", label: "Otros" },
    { key: "total", label: "Total" },
  ];

  campos.forEach(({ key, label }) => {
    const a = prev[key] as string | number | null;
    const b = next[key] as string | number | null;
    if (a !== b) {
      cambios.push({
        key,
        campo: label,
        antes: formatValorAcreencia(a),
        despues: formatValorAcreencia(b),
      });
    }
  });

  return cambios;
}

function emptyAcreenciaSnapshot(id: string, updatedAt: string): AcreenciaSnapshot {
  return {
    id,
    updated_at: updatedAt,
    naturaleza: null,
    prelacion: null,
    capital: null,
    int_cte: null,
    int_mora: null,
    otros_cobros_seguros: null,
    total: null,
    porcentaje: null,
  };
}

function snapshotFromHistorialData(data: Record<string, unknown> | null): AcreenciaSnapshot | null {
  if (!data) return null;
  const id =
    typeof data.id === "string"
      ? data.id
      : typeof data.id === "number"
        ? String(data.id)
        : null;
  const updated_at = typeof data.updated_at === "string" ? data.updated_at : null;
  if (!id || !updated_at) return null;

  const getStringOrNull = (key: string) => {
    const v = data[key];
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    return String(v);
  };

  const getNumberOrNull = (key: string) => {
    const v = data[key];
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    id,
    updated_at,
    naturaleza: getStringOrNull("naturaleza"),
    prelacion: getStringOrNull("prelacion"),
    capital: getNumberOrNull("capital"),
    int_cte: getNumberOrNull("int_cte"),
    int_mora: getNumberOrNull("int_mora"),
    otros_cobros_seguros: getNumberOrNull("otros_cobros_seguros"),
    total: getNumberOrNull("total"),
    porcentaje: getNumberOrNull("porcentaje"),
  };
}

function AttendanceContent() {
  const searchParams = useSearchParams();
  const procesoId = searchParams.get("procesoId");
  const eventoId = searchParams.get("eventoId");
  const debugRaw = searchParams.get("debug");
  const debugLista = debugRaw === "1" || debugRaw?.toLowerCase() === "true";

  const [titulo, setTitulo] = useState("Llamado de asistencia");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [hora, setHora] = useState(() => getBogotaTimeHHMMNow("11:30"));
  const [ciudad, setCiudad] = useState("Cali");
  const [numeroProceso, setNumeroProceso] = useState<string | null>(null);

  // Deudor info
  const [deudorNombre, setDeudorNombre] = useState("");
  const [deudorIdentificacion, setDeudorIdentificacion] = useState("");

  // Operador/Conciliador info
  const [operadorNombre, setOperadorNombre] = useState("JOSE ALEJANDRO PARDO MARTINEZ");
  const [operadorIdentificacion, setOperadorIdentificacion] = useState("1.154.967.376");
  const [operadorTarjetaProfesional, setOperadorTarjetaProfesional] = useState("429.496");
  const [operadorEmail, setOperadorEmail] = useState("fundaseer@gmail.com");

  useEffect(() => {
    if (!eventoId) return;

    let canceled = false;
    (async () => {
      try {
        const { data: evento, error: eventoError } = await supabase
          .from("eventos")
          .select("usuario_id, hora")
          .eq("id", eventoId)
          .maybeSingle();

        if (eventoError) throw eventoError;
        const usuarioId = evento?.usuario_id ?? null;
        const eventoHora = normalizeHoraHHMM(evento?.hora ?? null);
        if (eventoHora && !canceled) setHora(eventoHora);
        if (!usuarioId) return;

        const { data: usuario, error: usuarioError } = await supabase
          .from("usuarios")
          .select("nombre, email")
          .eq("id", usuarioId)
          .maybeSingle();

        if (usuarioError) throw usuarioError;
        if (canceled) return;

        if (usuario?.nombre) setOperadorNombre(usuario.nombre);
        if (usuario?.email) setOperadorEmail(usuario.email);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[/lista] Unable to resolve event creator user:", msg);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [eventoId]);

  // Próxima audiencia
  const [proximaFecha, setProximaFecha] = useState("");
  const [proximaHora, setProximaHora] = useState("9:30");

  const [asistentes, setAsistentes] = useState<Asistente[]>([
    { id: uid(), nombre: "", email: "", identificacion: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" },
  ]);

  const [guardado, setGuardado] = useState<Record<string, unknown> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoError, setGuardadoError] = useState<string | null>(null);
  const [terminandoAudiencia, setTerminandoAudiencia] = useState(false);
  const [terminarAudienciaError, setTerminarAudienciaError] = useState<string | null>(null);
  const [terminarAudienciaResult, setTerminarAudienciaResult] = useState<
    { fileId: string; fileName: string; webViewLink: string | null; apoderadoEmails?: string[] } | null
  >(null);
  const [enviandoCorreos, setEnviandoCorreos] = useState(false);
  const [enviarCorreosError, setEnviarCorreosError] = useState<string | null>(null);
  const [enviarCorreosResult, setEnviarCorreosResult] = useState<
    { emailsSent: number; emailErrors?: string[] } | null
  >(null);
  const [procesoApoderadosMensaje, setProcesoApoderadosMensaje] = useState<string | null>(null);
  const [procesoApoderadosCargando, setProcesoApoderadosCargando] = useState(false);
  const [procesoApoderadosError, setProcesoApoderadosError] = useState<string | null>(null);

  const [acreencias, setAcreencias] = useState<AcreenciaDetalle[]>([]);
  const [acreenciasCargando, setAcreenciasCargando] = useState(false);
  const [acreenciasError, setAcreenciasError] = useState<string | null>(null);
  const [acreenciasRefreshToken, setAcreenciasRefreshToken] = useState(0);

  const [acreenciasVistas, setAcreenciasVistas] = useState<Record<string, string>>({});
  const [acreenciasSnapshots, setAcreenciasSnapshots] = useState<Record<string, AcreenciaSnapshot>>({});
  const [acreenciasHistorial, setAcreenciasHistorial] = useState<Record<string, AcreenciaHistorialRow[]>>({});

  const [acreenciaEditandoId, setAcreenciaEditandoId] = useState<string | null>(null);
  const [acreenciaDrafts, setAcreenciaDrafts] = useState<Record<string, AcreenciaDraft>>({});
  const [acreenciaGuardandoId, setAcreenciaGuardandoId] = useState<string | null>(null);
  const [acreenciaGuardarError, setAcreenciaGuardarError] = useState<string | null>(null);

  const porcentajeCalculadoByAcreenciaId = useMemo(() => {
    const totalById = new Map<string, number>();
    let totalSum = 0;

    acreencias.forEach((acreencia) => {
      const draft = acreenciaDrafts[acreencia.id];
      const editando = acreenciaEditandoId === acreencia.id && Boolean(draft);
      const total = editando ? (toNumberOrNull(draft.total) ?? 0) : (acreencia.total ?? 0);
      totalById.set(acreencia.id, total);
      totalSum += total;
    });

    const byAcreenciaId = new Map<string, number | null>();
    acreencias.forEach((acreencia) => {
      const total = totalById.get(acreencia.id) ?? 0;
      byAcreenciaId.set(acreencia.id, totalSum > 0 ? (total / totalSum) * 100 : null);
    });

    return { totalSum, byAcreenciaId };
  }, [acreencias, acreenciaDrafts, acreenciaEditandoId]);

  const acreenciasVistasStorageKey = useMemo(() => {
    if (!procesoId) return null;
    return `autoactas:acreencias:vistas:${procesoId}`;
  }, [procesoId]);

  const acreenciasSnapshotsStorageKey = useMemo(() => {
    if (!procesoId) return null;
    return `autoactas:acreencias:snapshots:${procesoId}`;
  }, [procesoId]);

  useEffect(() => {
    setAcreenciaEditandoId(null);
    setAcreenciaDrafts({});
    setAcreenciaGuardandoId(null);
    setAcreenciaGuardarError(null);
  }, [procesoId]);

  useEffect(() => {
    if (!acreenciasVistasStorageKey) {
      setAcreenciasVistas({});
      return;
    }

    try {
      const raw = localStorage.getItem(acreenciasVistasStorageKey);
      if (!raw) {
        setAcreenciasVistas({});
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        setAcreenciasVistas({});
        return;
      }
      setAcreenciasVistas(parsed as Record<string, string>);
    } catch {
      setAcreenciasVistas({});
    }
  }, [acreenciasVistasStorageKey]);

  const persistAcreenciasVistas = (next: Record<string, string>) => {
    if (!acreenciasVistasStorageKey) return;
    try {
      localStorage.setItem(acreenciasVistasStorageKey, JSON.stringify(next));
    } catch {
      // ignore quota / privacy mode errors
    }
  };

  useEffect(() => {
    if (!acreenciasSnapshotsStorageKey) {
      setAcreenciasSnapshots({});
      return;
    }

    try {
      const raw = localStorage.getItem(acreenciasSnapshotsStorageKey);
      if (!raw) {
        setAcreenciasSnapshots({});
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        setAcreenciasSnapshots({});
        return;
      }
      setAcreenciasSnapshots(parsed as Record<string, AcreenciaSnapshot>);
    } catch {
      setAcreenciasSnapshots({});
    }
  }, [acreenciasSnapshotsStorageKey]);

  const persistAcreenciasSnapshots = (next: Record<string, AcreenciaSnapshot>) => {
    if (!acreenciasSnapshotsStorageKey) return;
    try {
      localStorage.setItem(acreenciasSnapshotsStorageKey, JSON.stringify(next));
    } catch {
      // ignore quota / privacy mode errors
    }
  };

  useEffect(() => {
    if (!procesoId) {
      setProcesoApoderadosMensaje(null);
      setProcesoApoderadosError(null);
      setNumeroProceso(null);
      return;
    }

    let activo = true;

    const cargarApoderadosDelProceso = async () => {
      setProcesoApoderadosMensaje(null);
      setProcesoApoderadosError(null);
      setProcesoApoderadosCargando(true);

      try {
        // Fetch proceso and deudores in parallel
        const [procesoConRelaciones, deudores] = await Promise.all([
          getProcesoWithRelations(procesoId),
          getDeudoresByProceso(procesoId),
        ]);

        if (debugLista) {
          console.log("[/lista debug] deudores fetch result", {
            procesoId,
            deudoresCount: deudores?.length ?? 0,
            primerDeudor: deudores?.[0] ?? null,
          });
        }

        if (activo) {
          setNumeroProceso(procesoConRelaciones.numero_proceso ?? null);

          // Set deudor info from direct fetch
          const primerDeudor = deudores?.[0];
          if (primerDeudor) {
            setDeudorNombre(primerDeudor.nombre || "");
            setDeudorIdentificacion(primerDeudor.identificacion || "");
            if (debugLista) {
              console.log("[/lista debug] deudor set from DB", {
                nombre: primerDeudor.nombre ?? null,
                identificacion: primerDeudor.identificacion ?? null,
              });
            }
          }
        }
        const apoderadoIds = new Set<string>();

        deudores?.forEach((deudor) => {
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
          { ...procesoConRelaciones, deudores },
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
  }, [procesoId, debugLista]);

  useEffect(() => {
    if (!procesoId) {
      setAcreencias([]);
      setAcreenciasError(null);
      setAcreenciasCargando(false);
      setAcreenciasHistorial({});
      return;
    }

    let activo = true;

    const cargarAcreencias = async () => {
      setAcreenciasCargando(true);
      setAcreenciasError(null);

      try {
        const [data, historialRaw] = await Promise.all([
          getAcreenciasByProceso(procesoId),
          getAcreenciasHistorialByProceso(procesoId).catch(() => []),
        ]);
        if (!activo) return;
        setAcreencias((data ?? []) as unknown as AcreenciaDetalle[]);

        const historial = (historialRaw ?? []) as unknown as AcreenciaHistorialRow[];
        const byAcreenciaId: Record<string, AcreenciaHistorialRow[]> = {};
        historial.forEach((row) => {
          if (!row?.acreencia_id) return;
          if (!byAcreenciaId[row.acreencia_id]) byAcreenciaId[row.acreencia_id] = [];
          byAcreenciaId[row.acreencia_id].push(row);
        });
        setAcreenciasHistorial(byAcreenciaId);
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
  }, [procesoId, acreenciasRefreshToken]);

  const iniciarEdicionAcreencia = (acreencia: AcreenciaDetalle) => {
    setAcreenciaGuardarError(null);
    setAcreenciaEditandoId(acreencia.id);
    setAcreenciaDrafts((prev) => ({
      ...prev,
      [acreencia.id]: {
        naturaleza: acreencia.naturaleza ?? "",
        prelacion: acreencia.prelacion ?? "",
        capital: toFixedOrEmpty(acreencia.capital),
        int_cte: toFixedOrEmpty(acreencia.int_cte),
        int_mora: toFixedOrEmpty(acreencia.int_mora),
        otros_cobros_seguros: toFixedOrEmpty(acreencia.otros_cobros_seguros),
        total: toFixedOrEmpty(acreencia.total),
        porcentaje: toFixedOrEmpty(acreencia.porcentaje),
      },
    }));
  };

  const cancelarEdicionAcreencia = () => {
    setAcreenciaGuardarError(null);
    setAcreenciaEditandoId(null);
  };

  const onChangeAcreenciaDraft = (acreenciaId: string, patch: Partial<AcreenciaDraft>) => {
    setAcreenciaDrafts((prev) => {
      const base = prev[acreenciaId];
      if (!base) return prev;
      const merged: AcreenciaDraft = { ...base, ...patch };

      const camposQueRecalcularonTotal = ["capital", "int_cte", "int_mora", "otros_cobros_seguros"] as const;
      if (camposQueRecalcularonTotal.some((k) => k in patch)) {
        merged.total = calcularTotal(merged);
      }

      return { ...prev, [acreenciaId]: merged };
    });
  };

  const guardarEdicionAcreencia = async (acreenciaId: string): Promise<boolean> => {
    if (acreenciaGuardandoId) return false;
    const draft = acreenciaDrafts[acreenciaId];
    if (!draft) return false;

    setAcreenciaGuardandoId(acreenciaId);
    setAcreenciaGuardarError(null);

    try {
      const porcentaje = porcentajeCalculadoByAcreenciaId.byAcreenciaId.get(acreenciaId) ?? null;
      const updated = await updateAcreencia(acreenciaId, {
        naturaleza: draft.naturaleza.trim() || null,
        prelacion: draft.prelacion.trim() || null,
        capital: toNumberOrNull(draft.capital),
        int_cte: toNumberOrNull(draft.int_cte),
        int_mora: toNumberOrNull(draft.int_mora),
        otros_cobros_seguros: toNumberOrNull(draft.otros_cobros_seguros),
        total: toNumberOrNull(draft.total),
        porcentaje,
      });

      setAcreencias((prev) =>
        prev.map((a) =>
          a.id === acreenciaId ? ({ ...a, ...updated } as AcreenciaDetalle) : a
        )
      );
      setAcreenciaEditandoId(null);
      setAcreenciasRefreshToken((v) => v + 1);
      return true;
    } catch (error) {
      console.error("Error actualizando acreencia:", error);
      setAcreenciaGuardarError("No se pudo guardar la acreencia. Intenta de nuevo.");
      return false;
    } finally {
      setAcreenciaGuardandoId(null);
    }
  };

  const restaurarAcreenciaAnterior = (acreenciaIdRaw: string | number, snapshotAnterior: AcreenciaSnapshot) => {
    const acreenciaId = String(acreenciaIdRaw);
    if (acreenciaGuardandoId) return;

    setAcreenciaGuardarError(null);
    setAcreenciaEditandoId(acreenciaId);
    setAcreenciaDrafts((prev) => ({
      ...prev,
      [acreenciaId]: {
        naturaleza: snapshotAnterior.naturaleza ?? "",
        prelacion: snapshotAnterior.prelacion ?? "",
        capital: toFixedOrEmpty(snapshotAnterior.capital),
        int_cte: toFixedOrEmpty(snapshotAnterior.int_cte),
        int_mora: toFixedOrEmpty(snapshotAnterior.int_mora),
        otros_cobros_seguros: toFixedOrEmpty(snapshotAnterior.otros_cobros_seguros),
        total: toFixedOrEmpty(snapshotAnterior.total) || calcularTotal({
          capital: toFixedOrEmpty(snapshotAnterior.capital),
          int_cte: toFixedOrEmpty(snapshotAnterior.int_cte),
          int_mora: toFixedOrEmpty(snapshotAnterior.int_mora),
          otros_cobros_seguros: toFixedOrEmpty(snapshotAnterior.otros_cobros_seguros),
        }),
        porcentaje: toFixedOrEmpty(snapshotAnterior.porcentaje),
      },
    }));
  };

  const esAcreenciaVisto = (acreencia: Pick<Acreencia, "id" | "created_at" | "updated_at">) => {
    const updated = new Date(acreencia.updated_at).getTime();
    if (!Number.isFinite(updated)) return true;
    const vista = acreenciasVistas[acreencia.id];
    if (!vista) return false;
    const vistaTime = new Date(vista).getTime();
    return Number.isFinite(vistaTime) && vistaTime >= updated;
  };

  const snapshotFromAcreencia = (acreencia: Pick<Acreencia, "id" | "updated_at" | "naturaleza" | "prelacion" | "capital" | "int_cte" | "int_mora" | "otros_cobros_seguros" | "total" | "porcentaje">): AcreenciaSnapshot => ({
    id: String(acreencia.id),
    updated_at: acreencia.updated_at,
    naturaleza: acreencia.naturaleza,
    prelacion: acreencia.prelacion,
    capital: acreencia.capital,
    int_cte: acreencia.int_cte,
    int_mora: acreencia.int_mora,
    otros_cobros_seguros: acreencia.otros_cobros_seguros,
    total: acreencia.total,
    porcentaje: acreencia.porcentaje,
  });

  const marcarAcreenciaVisto = (acreencia: AcreenciaSnapshot) => {
    setAcreenciasVistas((prev) => {
      const next = { ...prev, [acreencia.id]: acreencia.updated_at };
      persistAcreenciasVistas(next);
      return next;
    });

    setAcreenciasSnapshots((prev) => {
      const next = { ...prev, [acreencia.id]: acreencia };
      persistAcreenciasSnapshots(next);
      return next;
    });
  };

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
      { id: uid(), nombre: "", email: "", identificacion: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" },
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
    setAsistentes([{ id: uid(), nombre: "", email: "", identificacion: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" }]);
    setGuardado(null);
  }

  const buildAsistenciaPayload = () => {
    return {
      titulo: titulo.trim(),
      fecha,
      resumen: { total, presentes, ausentes },
      asistentes: asistentes.map((a) => ({
        nombre: a.nombre.trim(),
        email: a.email ? limpiarEmail(a.email) : "",
        identificacion: a.identificacion?.trim() || "",
        categoria: a.categoria,
        estado: a.estado,
        tarjetaProfesional: a.tarjetaProfesional.trim(),
        calidadApoderadoDe: a.calidadApoderadoDe.trim(),
      })),
      guardadoEn: new Date().toISOString(),
    };
  };

  const guardarAsistenciaInterno = async () => {
    if (!puedeGuardar || guardando) return false;

    setGuardando(true);
    setGuardadoError(null);

    try {
      const registros: AsistenciaInsert[] = asistentes.map((a) => ({
        proceso_id: procesoId || undefined,
        evento_id: eventoId || undefined,
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

      await createAsistenciasBulk(registros);
      setGuardado(buildAsistenciaPayload());
      return true;
    } catch (error) {
      console.error("Error guardando asistencia:", error);
      setGuardadoError("No se pudo guardar la asistencia. Intenta de nuevo.");
      return false;
    } finally {
      setGuardando(false);
    }
  };

  async function guardarAsistencia(e: React.FormEvent) {
    e.preventDefault();
    await guardarAsistenciaInterno();
  }

  const terminarAudiencia = async () => {
    if (!procesoId || terminandoAudiencia) return;

    setTerminandoAudiencia(true);
    setTerminarAudienciaError(null);
    setTerminarAudienciaResult(null);

    try {
      if (acreenciaEditandoId && acreenciaDrafts[acreenciaEditandoId]) {
        const okAcreencia = await guardarEdicionAcreencia(acreenciaEditandoId);
        if (!okAcreencia) {
          throw new Error("No se pudo guardar la acreencia en edición.");
        }
      }

      if (guardado === null) {
        const okAsistencia = await guardarAsistenciaInterno();
        if (!okAsistencia) {
          throw new Error("No se pudo guardar la asistencia.");
        }
      }

      const asistenciaPayload = buildAsistenciaPayload();
      const acreenciasPayload = acreencias.map((a) => ({
        acreedor: a.acreedores?.nombre ?? null,
        apoderado: a.apoderados?.nombre ?? null,
        naturaleza: a.naturaleza ?? null,
        prelacion: a.prelacion ?? null,
        capital: a.capital ?? null,
        int_cte: a.int_cte ?? null,
        int_mora: a.int_mora ?? null,
        otros: a.otros_cobros_seguros ?? null,
        total: a.total ?? null,
        porcentaje: porcentajeCalculadoByAcreenciaId.byAcreenciaId.get(a.id) ?? null,
      }));

      const terminarAudienciaPayload = {
        procesoId,
        numeroProceso,
        titulo: asistenciaPayload.titulo,
        fecha: asistenciaPayload.fecha,
        eventoId,
        hora,
        ciudad,
        resumen: asistenciaPayload.resumen,
        asistentes: asistenciaPayload.asistentes,
        acreencias: acreenciasPayload,
        debug: debugLista,
        deudor: deudorNombre
          ? {
              nombre: deudorNombre,
              identificacion: deudorIdentificacion,
            }
          : undefined,
        operador: {
          nombre: operadorNombre,
          identificacion: operadorIdentificacion,
          tarjetaProfesional: operadorTarjetaProfesional,
          email: operadorEmail,
        },
        proximaAudiencia: proximaFecha
          ? {
              fecha: proximaFecha,
              hora: proximaHora,
            }
          : undefined,
      };

      // Always log deudor data for debugging
      console.log("[/lista] ===== SENDING DEUDOR DATA =====");
      console.log("[/lista] deudorNombre state:", deudorNombre);
      console.log("[/lista] deudorIdentificacion state:", deudorIdentificacion);
      console.log("[/lista] payload.deudor:", JSON.stringify(terminarAudienciaPayload.deudor, null, 2));
      console.log("[/lista] ================================");

      const res = await fetch("/api/terminar-audiencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(terminarAudienciaPayload),
      });

      const json = (await res.json().catch(() => null)) as
        | { fileId: string; fileName: string; webViewLink: string | null; apoderadoEmails?: string[]; error?: string; detail?: string }
        | null;

      if (debugLista) {
        console.log("[/lista debug] terminar-audiencia response", {
          ok: res.ok,
          status: res.status,
          json,
        });
      }

      if (!res.ok) {
        throw new Error(json?.detail || json?.error || "No se pudo terminar la audiencia.");
      }

      if (!json?.fileId) {
        throw new Error("Respuesta inválida del servidor.");
      }

      setTerminarAudienciaResult({
        fileId: json.fileId,
        fileName: json.fileName,
        webViewLink: json.webViewLink ?? null,
        apoderadoEmails: json.apoderadoEmails,
      });
      // Reset email sending state when new doc is generated
      setEnviarCorreosResult(null);
      setEnviarCorreosError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTerminarAudienciaError(msg);
    } finally {
      setTerminandoAudiencia(false);
    }
  };

  const enviarCorreosApoderados = async () => {
    if (!terminarAudienciaResult?.webViewLink || enviandoCorreos) return;
    if (!terminarAudienciaResult.apoderadoEmails || terminarAudienciaResult.apoderadoEmails.length === 0) {
      setEnviarCorreosError("No hay correos de apoderados para enviar.");
      return;
    }

    setEnviandoCorreos(true);
    setEnviarCorreosError(null);
    setEnviarCorreosResult(null);

    try {
      const payload = {
        apoderadoEmails: terminarAudienciaResult.apoderadoEmails,
        numeroProceso: numeroProceso || procesoId,
        titulo: titulo,
        fecha: fecha,
        webViewLink: terminarAudienciaResult.webViewLink,
      };

      const res = await fetch("/api/enviar-acta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json().catch(() => null)) as
        | { emailsSent: number; emailErrors?: string[]; error?: string; detail?: string }
        | null;

      if (!res.ok) {
        throw new Error(json?.detail || json?.error || "No se pudieron enviar los correos.");
      }

      setEnviarCorreosResult({
        emailsSent: json?.emailsSent ?? 0,
        emailErrors: json?.emailErrors,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setEnviarCorreosError(msg);
    } finally {
      setEnviandoCorreos(false);
    }
  };

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Hora (Bogota)
                </label>
                <input
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
            </div>

            {/* Deudor & Ciudad */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Nombre del Deudor
                </label>
                <input
                  value={deudorNombre}
                  onChange={(e) => setDeudorNombre(e.target.value)}
                  placeholder="Ej: JORGE ARMANDO SERNA GARCIA"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  C.C. Deudor
                </label>
                <input
                  value={deudorIdentificacion}
                  onChange={(e) => setDeudorIdentificacion(e.target.value)}
                  placeholder="Ej: 16.847.359"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Ciudad
                </label>
                <input
                  value={ciudad}
                  onChange={(e) => setCiudad(e.target.value)}
                  placeholder="Ej: Cali"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
            </div>

            {/* Próxima Audiencia */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Próxima Fecha
                </label>
                <input
                  type="date"
                  value={proximaFecha}
                  onChange={(e) => setProximaFecha(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Próxima Hora
                </label>
                <input
                  type="time"
                  value={proximaHora}
                  onChange={(e) => setProximaHora(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
            </div>

            {/* Operador/Conciliador (collapsible) */}
            <details className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Datos del Operador/Conciliador
              </summary>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Nombre Operador
                  </label>
                  <input
                    value={operadorNombre}
                    onChange={(e) => setOperadorNombre(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    C.C. Operador
                  </label>
                  <input
                    value={operadorIdentificacion}
                    onChange={(e) => setOperadorIdentificacion(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Tarjeta Profesional
                  </label>
                  <input
                    value={operadorTarjetaProfesional}
                    onChange={(e) => setOperadorTarjetaProfesional(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Email Operador
                  </label>
                  <input
                    value={operadorEmail}
                    onChange={(e) => setOperadorEmail(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
              </div>
            </details>

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

                    {/* Cédula/Identificación */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Cédula/NIT
                      </label>
                      <input
                        value={a.identificacion}
                        onChange={(e) => actualizarFila(a.id, { identificacion: e.target.value })}
                        placeholder="Ej: 1.144.109.996"
                        className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
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

                <button
                  type="button"
                  onClick={terminarAudiencia}
                  disabled={
                    !procesoId ||
                    !puedeGuardar ||
                    guardando ||
                    terminandoAudiencia ||
                    acreenciaGuardandoId !== null
                  }
                  className="h-12 rounded-2xl bg-amber-500 px-6 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-amber-400 dark:text-black"
                >
                  {terminandoAudiencia ? "Terminando..." : "Terminar audiencia"}
                </button>
              </div>
            </div>

            {/* Error message */}
            {guardadoError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {guardadoError}
              </div>
            )}

            {terminarAudienciaError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {terminarAudienciaError}
              </div>
            )}

            {/* Success message */}
            {guardado !== null && (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
                Asistencia guardada correctamente ({presentes}/{total} presentes)
              </div>
            )}

            {terminarAudienciaResult && (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
                <p className="font-medium">Audiencia terminada.</p>
                <p className="mt-1 break-words">
                  Documento: {terminarAudienciaResult.fileName}
                  {terminarAudienciaResult.webViewLink ? (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={terminarAudienciaResult.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                      >
                        Abrir en Drive
                      </a>
                    </>
                  ) : null}
                </p>
                {debugLista ? (
                  <p className="mt-1 break-words text-xs opacity-80">
                    Debug fileId: {terminarAudienciaResult.fileId}
                  </p>
                ) : null}

                {/* Send to apoderados button */}
                {terminarAudienciaResult.webViewLink && terminarAudienciaResult.apoderadoEmails && terminarAudienciaResult.apoderadoEmails.length > 0 && !enviarCorreosResult && (
                  <div className="mt-4 border-t border-green-200 pt-4 dark:border-green-500/30">
                    <p className="mb-2 text-zinc-700 dark:text-zinc-300">
                      {terminarAudienciaResult.apoderadoEmails.length} apoderado{terminarAudienciaResult.apoderadoEmails.length > 1 ? "s" : ""} con correo registrado
                    </p>
                    <button
                      type="button"
                      onClick={enviarCorreosApoderados}
                      disabled={enviandoCorreos}
                      className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {enviandoCorreos ? "Enviando..." : "Enviar acta a apoderados"}
                    </button>
                  </div>
                )}

                {/* No apoderados with email */}
                {terminarAudienciaResult.webViewLink && (!terminarAudienciaResult.apoderadoEmails || terminarAudienciaResult.apoderadoEmails.length === 0) && (
                  <p className="mt-3 text-zinc-500 dark:text-zinc-400">
                    No hay apoderados con correo registrado para enviar el acta.
                  </p>
                )}
              </div>
            )}

            {/* Email sending error */}
            {enviarCorreosError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {enviarCorreosError}
              </div>
            )}

            {/* Email sending success */}
            {enviarCorreosResult && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                <p className="font-medium">Correos enviados a apoderados: {enviarCorreosResult.emailsSent}</p>
                {enviarCorreosResult.emailErrors && enviarCorreosResult.emailErrors.length > 0 && (
                  <p className="mt-2 text-amber-700 dark:text-amber-300">
                    Algunos correos no pudieron enviarse: {enviarCorreosResult.emailErrors.length}
                  </p>
                )}
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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={
                    !acreenciaEditandoId ||
                    !acreenciaDrafts[acreenciaEditandoId] ||
                    acreenciaGuardandoId !== null
                  }
                  onClick={() => acreenciaEditandoId && guardarEdicionAcreencia(acreenciaEditandoId)}
                  className="inline-flex h-10 items-center rounded-2xl bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  Guardar
                </button>

                <button
                  type="button"
                  disabled={!acreenciaEditandoId || acreenciaGuardandoId !== null}
                  onClick={cancelarEdicionAcreencia}
                  className="inline-flex h-10 items-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            </div>

            {acreenciasError && (
              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {acreenciasError}
              </div>
            )}

            {acreenciaGuardarError && (
              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {acreenciaGuardarError}
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
                      const draft = acreenciaDrafts[acreencia.id];
                      const editando = acreenciaEditandoId === acreencia.id && Boolean(draft);
                      const deshabilitado = acreenciaGuardandoId === acreencia.id;
                      const actualizada = esAcreenciaActualizada(acreencia);
                      const visto = esAcreenciaVisto(acreencia);
                      const resaltar = actualizada && !visto;
                      const porcentajeCalculado = porcentajeCalculadoByAcreenciaId.byAcreenciaId.get(acreencia.id) ?? null;
                      const snapshotNow = snapshotFromAcreencia(acreencia);
                      const snapshotPrev = acreenciasSnapshots[acreencia.id];
                      const historialItems = acreenciasHistorial[acreencia.id] ?? [];
                      const ultimoCambio = historialItems[0];
                      const historialCount = historialItems.length;

                      const snapshotAnteriorParaRestaurar = (() => {
                        const match = historialItems.find((row) => {
                          if (row.operacion !== "UPDATE") return false;
                          const newSnap = snapshotFromHistorialData(row.new_data);
                          if (!newSnap) return false;
                          return (
                            new Date(newSnap.updated_at).getTime() ===
                            new Date(snapshotNow.updated_at).getTime()
                          );
                        });

                        const candidate = match ?? historialItems.find((row) => row.operacion === "UPDATE");
                        if (!candidate) return null;
                        return snapshotFromHistorialData(candidate.old_data);
                      })();

                      const historialOld = snapshotFromHistorialData(ultimoCambio?.old_data ?? null);
                      const historialNew = snapshotFromHistorialData(ultimoCambio?.new_data ?? null);
                      const historialAplica =
                        Boolean(historialNew) &&
                        new Date(historialNew!.updated_at).getTime() ===
                          new Date(snapshotNow.updated_at).getTime();

                      const cambiosDesdeHistorial =
                        historialAplica && historialNew
                          ? getAcreenciaCambios(
                              historialOld ?? emptyAcreenciaSnapshot(snapshotNow.id, snapshotNow.updated_at),
                              historialNew
                            )
                          : [];

                      const cambiosDesdeSnapshot =
                        snapshotPrev && snapshotPrev.updated_at !== snapshotNow.updated_at
                          ? getAcreenciaCambios(snapshotPrev, snapshotNow)
                          : [];

                      const cambios = cambiosDesdeHistorial.length ? cambiosDesdeHistorial : cambiosDesdeSnapshot;
                      const cambiosByKey: Partial<
                        Record<keyof Omit<AcreenciaSnapshot, "id" | "updated_at">, AcreenciaCambio>
                      > = {};
                      cambios.forEach((c) => {
                        cambiosByKey[c.key] = c;
                      });

                      const qs = new URLSearchParams();
                      if (procesoId) qs.set("procesoId", procesoId);
                      qs.set("apoderadoId", acreencia.apoderado_id);
                      const hrefDetalle = `/acreencias?${qs.toString()}`;

                      return (
                        <tr
                          key={acreencia.id}
                          className={`border-t border-zinc-200/70 dark:border-white/10 ${
                            resaltar ? "bg-amber-50/70 dark:bg-amber-500/10" : ""
                          }`}
                        >
                          <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                            <div className="flex max-w-[240px] items-center gap-2 truncate">
                              {resaltar ? (
                                <span
                                  className="h-2 w-2 flex-none rounded-full bg-amber-500"
                                  aria-label="Acreencia actualizada"
                                  title="Acreencia actualizada"
                                />
                              ) : null}
                              {acreencia.acreedores?.nombre ?? acreencia.acreedor_id}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="max-w-[220px] truncate">
                              {acreencia.apoderados?.nombre ?? acreencia.apoderado_id}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                value={draft?.naturaleza ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { naturaleza: e.target.value })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="Ej: Laboral"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.naturaleza ?? "—"}</div>
                                {resaltar && cambiosByKey.naturaleza ? (
                                  <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.naturaleza.antes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                value={draft?.prelacion ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { prelacion: e.target.value })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="Ej: 1"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.prelacion ?? "—"}</div>
                                {resaltar && cambiosByKey.prelacion ? (
                                  <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.prelacion.antes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                inputMode="decimal"
                                value={draft?.capital ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { capital: e.target.value })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="0"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.capital ?? "—"}</div>
                                {resaltar && cambiosByKey.capital ? (
                                  <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.capital.antes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                inputMode="decimal"
                                value={draft?.int_cte ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { int_cte: e.target.value })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="0"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.int_cte ?? "—"}</div>
                                {resaltar && cambiosByKey.int_cte ? (
                                  <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.int_cte.antes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                inputMode="decimal"
                                value={draft?.int_mora ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { int_mora: e.target.value })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="0"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.int_mora ?? "—"}</div>
                                {resaltar && cambiosByKey.int_mora ? (
                                  <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.int_mora.antes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                inputMode="decimal"
                                value={draft?.otros_cobros_seguros ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, {
                                    otros_cobros_seguros: e.target.value,
                                  })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="0"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.otros_cobros_seguros ?? "—"}</div>
                                {resaltar && cambiosByKey.otros_cobros_seguros ? (
                                  <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.otros_cobros_seguros.antes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4 font-medium">
                            {editando ? (
                              <input
                                inputMode="decimal"
                                value={draft?.total ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { total: e.target.value })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="0"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.total ?? "—"}</div>
                                {resaltar && cambiosByKey.total ? (
                                  <p className="mt-1 text-[11px] font-normal text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.total.antes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                inputMode="decimal"
                                value={porcentajeCalculado === null ? "" : porcentajeCalculado.toFixed(2)}
                                readOnly
                                disabled
                                className="w-full cursor-not-allowed rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none dark:border-white/10 dark:bg-white/10 dark:text-zinc-50"
                                placeholder={porcentajeCalculadoByAcreenciaId.totalSum > 0 ? "0" : "—"}
                              />
                            ) : (
                              <div>{formatPorcentaje(porcentajeCalculado)}</div>
                            )}
                          </td>
                          <td className="py-3 pr-0">
                            <div className="flex justify-end gap-2">
                              {editando ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={deshabilitado}
                                    onClick={() => guardarEdicionAcreencia(acreencia.id)}
                                    className="inline-flex items-center rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                                  >
                                    {deshabilitado ? "Guardando..." : "Guardar"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deshabilitado}
                                    onClick={cancelarEdicionAcreencia}
                                    className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
                                  >
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <>
                                  {resaltar ? (
                                    <button
                                      type="button"
                                      onClick={() => marcarAcreenciaVisto(snapshotNow)}
                                      className="inline-flex items-center rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-900 shadow-sm transition hover:bg-amber-500/30 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30"
                                    >
                                      Marcar visto
                                    </button>
                                  ) : actualizada && visto ? (
                                    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                                      Visto
                                    </span>
                                  ) : null}
                                  {snapshotAnteriorParaRestaurar ? (
                                    <button
                                      type="button"
                                      disabled={acreenciaGuardandoId !== null}
                                      onClick={() =>
                                        restaurarAcreenciaAnterior(acreencia.id, snapshotAnteriorParaRestaurar)
                                      }
                                      className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/20"
                                    >
                                      Restaurar anterior
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => iniciarEdicionAcreencia(acreencia)}
                                    className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
                                  >
                                    Editar
                                  </button>
                                  <Link
                                    href={hrefDetalle}
                                    className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
                                  >
                                    Detalle
                                  </Link>
                                </>
                              )}
                            </div>
                            {actualizada && (
                              <p className="mt-1 text-right text-[11px] text-zinc-500 dark:text-zinc-400">
                                Actualizada: {formatFechaHora(acreencia.updated_at)}
                              </p>
                            )}
                            {resaltar && (
                              <details className="mt-1 text-right text-[11px]">
                                <summary className="cursor-pointer select-none text-amber-800 hover:underline dark:text-amber-200">
                                  Ver cambios{cambios.length ? ` (${cambios.length})` : ""}
                                </summary>
                                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                                  {historialCount > 0 ? (
                                    <p className="mb-2 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                      Historial guardado: <span className="font-medium">{historialCount}</span>{" "}
                                      {historialCount === 1 ? "registro" : "registros"}.
                                    </p>
                                  ) : null}
                                  {historialAplica ? (
                                    <>
                                      <p className="mb-2">
                                        Último cambio:{" "}
                                        <span className="font-medium">
                                          {formatFechaHora(ultimoCambio?.changed_at ?? snapshotNow.updated_at)}
                                        </span>
                                      </p>
                                      {cambios.length === 0 ? (
                                        <p>No se detectaron cambios en los campos visibles.</p>
                                      ) : (
                                        <ul className="space-y-1">
                                          {cambios.map((c) => (
                                            <li key={c.campo}>
                                              <span className="font-medium">{c.campo}:</span> {c.antes} → {c.despues}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </>
                                  ) : snapshotPrev ? (
                                    <>
                                      <p className="mb-2">
                                        Cambios desde la última vez que marcaste como visto (
                                        <span className="font-medium">{formatFechaHora(snapshotPrev.updated_at)}</span>)
                                      </p>
                                      {cambios.length === 0 ? (
                                        <p>No se detectaron cambios en los campos visibles.</p>
                                      ) : (
                                        <ul className="space-y-1">
                                          {cambios.map((c) => (
                                            <li key={c.campo}>
                                              <span className="font-medium">{c.campo}:</span> {c.antes} → {c.despues}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </>
                                  ) : cambios.length === 0 ? (
                                    <p>
                                      No hay historial disponible todavía. Ejecuta la migración de historial y luego
                                      usa <span className="font-medium">Marcar visto</span> para establecer una
                                      línea base.
                                    </p>
                                  ) : (
                                    <p>No se detectaron cambios en los campos visibles.</p>
                                  )}
                                </div>
                              </details>
                            )}
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
