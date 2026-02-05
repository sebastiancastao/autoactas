"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { getProcesoWithRelations } from "@/lib/api/proceso";
import { getApoderadosByIds } from "@/lib/api/apoderados";
import { createAsistenciasBulk } from "@/lib/api/asistencia";
import { getAcreenciasByProceso, getAcreenciasHistorialByProceso, updateAcreencia } from "@/lib/api/acreencias";
import type { Acreedor, Acreencia, Apoderado, AsistenciaInsert } from "@/lib/database.types";

type Categoria = "Acreedor" | "Deudor" | "Apoderado";
type EstadoAsistencia = "Presente" | "Ausente";

type Asistente = {
  id: string;
  apoderadoId?: string;
  nombre: string;
  email: string;
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

type AcreedorConApoderadoId = {
  id?: string;
  nombre?: string | null;
  apoderado_id?: string | null;
};

type DeudorConApoderadoId = {
  id?: string;
  nombre?: string | null;
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
      categoria: "Apoderado",
      estado: "Ausente",
      tarjetaProfesional: "",
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
    { key: "porcentaje", label: "%" },
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

  const [titulo, setTitulo] = useState("Llamado de asistencia");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));

  const [asistentes, setAsistentes] = useState<Asistente[]>([
    { id: uid(), nombre: "", email: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" },
  ]);

  const [guardado, setGuardado] = useState<Record<string, unknown> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoError, setGuardadoError] = useState<string | null>(null);
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
      return;
    }

    let activo = true;

    const cargarApoderadosDelProceso = async () => {
      setProcesoApoderadosMensaje(null);
      setProcesoApoderadosError(null);
      setProcesoApoderadosCargando(true);

      try {
        const procesoConRelaciones = await getProcesoWithRelations(procesoId);
        const apoderadoIds = new Set<string>();

        procesoConRelaciones.deudores?.forEach((deudor) => {
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
          procesoConRelaciones,
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
  }, [procesoId]);

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

  const guardarEdicionAcreencia = async (acreenciaId: string) => {
    if (acreenciaGuardandoId) return;
    const draft = acreenciaDrafts[acreenciaId];
    if (!draft) return;

    setAcreenciaGuardandoId(acreenciaId);
    setAcreenciaGuardarError(null);

    try {
      const updated = await updateAcreencia(acreenciaId, {
        naturaleza: draft.naturaleza.trim() || null,
        prelacion: draft.prelacion.trim() || null,
        capital: toNumberOrNull(draft.capital),
        int_cte: toNumberOrNull(draft.int_cte),
        int_mora: toNumberOrNull(draft.int_mora),
        otros_cobros_seguros: toNumberOrNull(draft.otros_cobros_seguros),
        total: toNumberOrNull(draft.total),
        porcentaje: toNumberOrNull(draft.porcentaje),
      });

      setAcreencias((prev) =>
        prev.map((a) =>
          a.id === acreenciaId ? ({ ...a, ...updated } as AcreenciaDetalle) : a
        )
      );
      setAcreenciaEditandoId(null);
      setAcreenciasRefreshToken((v) => v + 1);
    } catch (error) {
      console.error("Error actualizando acreencia:", error);
      setAcreenciaGuardarError("No se pudo guardar la acreencia. Intenta de nuevo.");
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
      { id: uid(), nombre: "", email: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" },
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
    setAsistentes([{ id: uid(), nombre: "", email: "", categoria: "Acreedor", estado: "Ausente", tarjetaProfesional: "", calidadApoderadoDe: "" }]);
    setGuardado(null);
  }

  async function guardarAsistencia(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar || guardando) return;

    setGuardando(true);
    setGuardadoError(null);

    try {
      // Prepare records for database
      const registros: AsistenciaInsert[] = asistentes.map((a) => ({
        proceso_id: procesoId || undefined,
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

      // Save to database
      await createAsistenciasBulk(registros);

      // Also set local state for preview
      const payload = {
        titulo: titulo.trim(),
        fecha,
        resumen: { total, presentes, ausentes },
        asistentes: asistentes.map((a) => ({
          nombre: a.nombre.trim(),
          email: a.email ? limpiarEmail(a.email) : "",
          categoria: a.categoria,
          estado: a.estado,
          tarjetaProfesional: a.tarjetaProfesional.trim(),
          calidadApoderadoDe: a.calidadApoderadoDe.trim(),
        })),
        guardadoEn: new Date().toISOString(),
      };

      setGuardado(payload);
    } catch (error) {
      console.error("Error guardando asistencia:", error);
      setGuardadoError("No se pudo guardar la asistencia. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
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
              </div>
            </div>

            {/* Error message */}
            {guardadoError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {guardadoError}
              </div>
            )}

            {/* Success message */}
            {guardado !== null && (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
                Asistencia guardada correctamente ({presentes}/{total} presentes)
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
                                value={draft?.porcentaje ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { porcentaje: e.target.value })
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="0"
                              />
                            ) : (
                              <div>
                                <div>{acreencia.porcentaje ?? "—"}</div>
                                {resaltar && cambiosByKey.porcentaje ? (
                                  <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                                    Antes: {cambiosByKey.porcentaje.antes}
                                  </p>
                                ) : null}
                              </div>
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
