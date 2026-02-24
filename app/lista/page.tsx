"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { getProcesoWithRelations } from "@/lib/api/proceso";
import { getApoderadosByIds, getApoderadosByProceso, getApoderadoById } from "@/lib/api/apoderados";
import { getDeudoresByProceso } from "@/lib/api/deudores";
import { createAsistenciasBulk } from "@/lib/api/asistencia";
import { getAcreenciasByProceso, getAcreenciasHistorialByProceso, updateAcreencia } from "@/lib/api/acreencias";
import { createEvento, updateEvento, getEventosByProceso } from "@/lib/api/eventos";
import { updateProgresoByProcesoId } from "@/lib/api/progreso";
import type { Acreedor, Acreencia, Apoderado, AsistenciaInsert } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

type Categoria = "Acreedor" | "Deudor" | "Apoderado";
type EstadoAsistencia = "Presente" | "Ausente";
type VotoAcuerdo = "POSITIVO" | "NEGATIVO" | "AUSENTE" | "ABSTENCION";

type HorarioSugerido = {
  fecha: string;
  hora: string;
  score: number;
  reason: string;
};

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
const TIPOS_ACTA_CON_TERMINACION_PROCESO = new Set([
  "ACUERDO DE PAGO",
  "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE",
  "ACTA FRACASO DEL TRAMITE",
  "ACTA RECHAZO DEL TRAMITE",
  "AUTO DECLARA NULIDAD",
]);

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function limpiarEmail(valor: string) {
  return valor.trim().toLowerCase();
}

function esEmailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function extractUuidFromParam(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
  );
  return match ? match[0] : null;
}

function hasEmbeddedDebugParam(value: string | null | undefined) {
  const raw = String(value ?? "").toLowerCase();
  return raw.includes("debug=1") || raw.includes("debug=true");
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const parts = [
      rec.message,
      rec.details,
      rec.hint,
      rec.code,
      rec.error_description,
      rec.status,
      rec.statusText,
    ]
      .map((v) => (v === undefined || v === null ? "" : String(v).trim()))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      return String(error);
    }
  }
  return String(error);
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

const BOGOTA_TZ = "America/Bogota";
const BOGOTA_OFFSET = "-05:00";

function formatBogotaDateKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: BOGOTA_TZ });
}

function dateKeyToBogotaMidnight(dateKey: string) {
  const d = new Date(`${dateKey}T00:00:00${BOGOTA_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDaysBogota(dateKey: string, days: number) {
  const d = dateKeyToBogotaMidnight(dateKey);
  if (!d) return dateKey;
  return formatBogotaDateKey(new Date(d.getTime() + days * 86400000));
}

function hhmmToMinutes(hhmm: string | null) {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function minutesToHHMM(total: number) {
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const BUSINESS_START_MINUTES = 8 * 60;
const BUSINESS_END_MINUTES = 17 * 60;

function getBusinessSlotsHHMM() {
  const out: string[] = [];
  for (let m = BUSINESS_START_MINUTES; m <= BUSINESS_END_MINUTES; m += 30) out.push(minutesToHHMM(m));
  return out;
}

function isWithinBusinessHours(hhmm: string | null | undefined) {
  const normalized = normalizeHoraHHMM(hhmm);
  if (!normalized) return false;
  const total = hhmmToMinutes(normalized);
  if (total === null) return false;
  return total >= BUSINESS_START_MINUTES && total <= BUSINESS_END_MINUTES;
}

async function hasUserTimeConflict(params: {
  userId: string;
  fechaISO: string;
  horaHHMM: string;
  excludeEventoId?: string;
}) {
  const hora = `${params.horaHHMM}:00`;
  let query = supabase
    .from("eventos")
    .select("id", { head: true, count: "exact" })
    .eq("usuario_id", params.userId)
    .eq("fecha", params.fechaISO)
    .eq("hora", hora);

  if (params.excludeEventoId) {
    query = query.neq("id", params.excludeEventoId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return (count ?? 0) > 0;
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
  const apoderadoById = new Map(listaApoderados.map((apoderado) => [apoderado.id, apoderado]));

  const agregarFila = (apoderadoId: string, calidadDe: string) => {
    const apoderado = apoderadoById.get(apoderadoId);
    filas.push({
      id: uid(),
      apoderadoId,
      nombre: apoderado?.nombre ?? "Apoderado sin registro",
      email: apoderado?.email ?? "",
      identificacion: apoderado?.identificacion ?? "",
      categoria: "Apoderado",
      estado: "Ausente",
      tarjetaProfesional: apoderado?.tarjeta_profesional ?? "",
      calidadApoderadoDe: calidadDe,
    });
  };

  (detalle.acreedores ?? []).forEach((acreedor) => {
    const apoderadoId = acreedor.apoderado_id;
    if (!apoderadoId) return;
    agregarFila(apoderadoId, `Acreedor: ${acreedor.nombre ?? "Sin nombre"}`);
  });

  (detalle.deudores ?? []).forEach((deudor) => {
    const apoderadoId = deudor.apoderado_id;
    if (!apoderadoId) return;
    agregarFila(apoderadoId, `Deudor: ${deudor.nombre ?? "Sin nombre"}`);
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

type ProcesoExcelArchivoPayload = {
  id: string;
  proceso_id: string;
  original_file_name: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_web_view_link: string | null;
  drive_web_content_link: string | null;
  created_at: string;
};

type UploadExcelGetItem = {
  id: string;
  proceso_id: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_web_view_link: string | null;
  drive_web_content_link: string | null;
  created_at: string;
};

type UploadExcelGetResponse = {
  files?: UploadExcelGetItem[];
  error?: string;
  detail?: string;
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
  dias_mora: string;
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

type PropuestaPagoClaseDraft = {
  numero_cuotas: string;
  interes_reconocido: string;
  inicio_pagos: string; // YYYY-MM-DD
  fecha_fin_pagos: string; // YYYY-MM-DD
};

type PropuestaPagoDraft = {
  primera_clase: PropuestaPagoClaseDraft;
  tercera_clase: PropuestaPagoClaseDraft;
  quinta_clase: PropuestaPagoClaseDraft;
};

type InasistenciaDisclaimerItem = {
  apoderadoId: string;
  nombre: string;
  eventosAusentes: number;
};

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function buildAcronimo(nombre: string | null | undefined) {
  const normalized = normalizeLabel(nombre, "SIN APODERADO");
  const words = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const initials = words.map((word) => word[0]?.toUpperCase() ?? "").join("");
  return initials || "SA";
}

async function buildProcesoEventoTitle(procesoId: string): Promise<string> {
  const [deudoresProceso, eventosProceso] = await Promise.all([
    getDeudoresByProceso(procesoId).catch(() => []),
    getEventosByProceso(procesoId).catch(() => null),
  ]);

  const deudorPrincipal = deudoresProceso.find((d) => (d.nombre ?? "").trim().length > 0);
  const deudorNombre = normalizeLabel(deudorPrincipal?.nombre, "SIN DEUDOR");

  let apoderadoNombre = "";
  if (deudorPrincipal?.apoderado_id) {
    try {
      const apoderado = await getApoderadoById(deudorPrincipal.apoderado_id);
      apoderadoNombre = apoderado?.nombre ?? "";
    } catch {
      // ignore
    }
  }
  if (!apoderadoNombre) {
    try {
      const apoderadosProceso = await getApoderadosByProceso(procesoId);
      apoderadoNombre =
        apoderadosProceso.find((a) => (a.nombre ?? "").trim().length > 0)?.nombre ?? "";
    } catch {
      // ignore
    }
  }

  const apoderadoAcronimo = buildAcronimo(apoderadoNombre);
  const eventosExistentes = Array.isArray(eventosProceso) ? eventosProceso.length : 0;
  const numeroEvento = eventosExistentes + 1;

  return `AUD INSOLVENCIA ${deudorNombre}- ${apoderadoAcronimo}-${numeroEvento}`;
}

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
  const procesoIdRaw = searchParams.get("procesoId");
  const eventoIdRaw = searchParams.get("eventoId");
  const procesoId = extractUuidFromParam(procesoIdRaw) ?? procesoIdRaw;
  const eventoId = extractUuidFromParam(eventoIdRaw) ?? eventoIdRaw;
  const debugRaw = searchParams.get("debug");
  const debugLista =
    debugRaw === "1" ||
    debugRaw?.toLowerCase() === "true" ||
    hasEmbeddedDebugParam(procesoIdRaw) ||
    hasEmbeddedDebugParam(eventoIdRaw);

  const { user } = useAuth();

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
  const [mostrarDatosOperador, setMostrarDatosOperador] = useState(false);

  // If user is logged in, prefer the `usuarios` profile (by auth_id) as a fallback for operador.
  // This avoids generating docs with the default placeholder when no eventoId/usuario_id is available.
  useEffect(() => {
    const authId = user?.id ?? null;
    if (!authId) return;

    const defaultNombre = "JOSE ALEJANDRO PARDO MARTINEZ";
    const defaultEmail = "fundaseer@gmail.com";
    const defaultIdentificacion = "1.154.967.376";

    const shouldSetNombre =
      !operadorNombre.trim() || operadorNombre.trim().toUpperCase() === defaultNombre;
    const shouldSetEmail =
      !operadorEmail.trim() || operadorEmail.trim().toLowerCase() === defaultEmail;
    const shouldSetIdentificacion =
      !operadorIdentificacion.trim() || operadorIdentificacion.trim() === defaultIdentificacion;

    if (!shouldSetNombre && !shouldSetEmail && !shouldSetIdentificacion) return;

    let canceled = false;
    (async () => {
      try {
        const { data: usuario, error: usuarioError } = await supabase
          .from("usuarios")
          .select("id, nombre, email, identificacion")
          .eq("auth_id", authId)
          .maybeSingle();

        if (usuarioError) throw usuarioError;
        if (canceled) return;

        if (usuario?.id) setOperadorUsuarioId(usuario.id);
        if (shouldSetNombre && usuario?.nombre) setOperadorNombre(usuario.nombre);
        if (shouldSetEmail && usuario?.email) setOperadorEmail(usuario.email);
        if (shouldSetIdentificacion && usuario?.identificacion) {
          setOperadorIdentificacion(usuario.identificacion);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[/lista] Unable to resolve operador from usuarios(auth_id):", msg);
      }
    })();

    return () => {
      canceled = true;
    };
    // Intentionally do not include operador fields in deps: we only want to run when auth user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
        if (usuarioId && !canceled) setOperadorUsuarioId(usuarioId);
        if (!usuarioId) return;

        const { data: usuario, error: usuarioError } = await supabase
          .from("usuarios")
          .select("nombre, email, identificacion")
          .eq("id", usuarioId)
          .maybeSingle();

        if (usuarioError) throw usuarioError;
        if (canceled) return;

        if (usuario?.nombre) setOperadorNombre(usuario.nombre);
        if (usuario?.email) setOperadorEmail(usuario.email);
        if (usuario?.identificacion) setOperadorIdentificacion(usuario.identificacion);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[/lista] Unable to resolve event creator user:", msg);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [eventoId]);

  const [operadorUsuarioId, setOperadorUsuarioId] = useState<string | null>(null);

  // Próxima audiencia
  const [proximaFecha, setProximaFecha] = useState("");
  const [proximaHora, setProximaHora] = useState("09:00");
  const [proximaTitulo, setProximaTitulo] = useState("");
  const [agendando, setAgendando] = useState(false);
  const [agendarError, setAgendarError] = useState<string | null>(null);
  const [agendarExito, setAgendarExito] = useState<string | null>(null);

  const [sugiriendo, setSugiriendo] = useState(false);
  const [sugerirError, setSugerirError] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<HorarioSugerido[]>([]);
  const [autoSugerido, setAutoSugerido] = useState(false);

  const [eventoSiguienteId, setEventoSiguienteId] = useState<string | null>(null);
  const [eventoSiguienteCargando, setEventoSiguienteCargando] = useState(false);
  const [eventoSiguienteError, setEventoSiguienteError] = useState<string | null>(null);

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
  const [tipoDocumentoActaGenerada, setTipoDocumentoActaGenerada] = useState<string | null>(null);
  const [terminandoProceso, setTerminandoProceso] = useState(false);
  const [terminarProcesoError, setTerminarProcesoError] = useState<string | null>(null);
  const [terminarProcesoExito, setTerminarProcesoExito] = useState<string | null>(null);
  const [mostrarModalTerminarAudiencia, setMostrarModalTerminarAudiencia] = useState(false);
  const [terminarAudienciaAdvertencias, setTerminarAudienciaAdvertencias] = useState<string[]>([]);
  const [tipoDocumento, setTipoDocumento] = useState("ACTA AUDIENCIA");
  const [votosAcuerdoByAcreenciaId, setVotosAcuerdoByAcreenciaId] = useState<Record<string, VotoAcuerdo | "">>({});
  const [propuestaPago, setPropuestaPago] = useState<PropuestaPagoDraft>({
    primera_clase: { numero_cuotas: "", interes_reconocido: "", inicio_pagos: "", fecha_fin_pagos: "" },
    tercera_clase: { numero_cuotas: "", interes_reconocido: "", inicio_pagos: "", fecha_fin_pagos: "" },
    quinta_clase: { numero_cuotas: "", interes_reconocido: "", inicio_pagos: "", fecha_fin_pagos: "" },
  });
  const [enviandoCorreos, setEnviandoCorreos] = useState(false);
  const [enviarCorreosError, setEnviarCorreosError] = useState<string | null>(null);
  const [enviarCorreosResult, setEnviarCorreosResult] = useState<
    { emailsSent: number; emailErrors?: string[] } | null
  >(null);
  const [procesoApoderadosMensaje, setProcesoApoderadosMensaje] = useState<string | null>(null);
  const [procesoApoderadosCargando, setProcesoApoderadosCargando] = useState(false);
  const [procesoApoderadosError, setProcesoApoderadosError] = useState<string | null>(null);
  const [deudorApoderadoIds, setDeudorApoderadoIds] = useState<string[]>([]);
  const [deudorApoderadoNombreById, setDeudorApoderadoNombreById] = useState<Record<string, string>>({});
  const [inasistenciaDisclaimerItems, setInasistenciaDisclaimerItems] = useState<InasistenciaDisclaimerItem[]>([]);
  const [inasistenciaDisclaimerOpen, setInasistenciaDisclaimerOpen] = useState(false);
  const [inasistenciaDisclaimerSignature, setInasistenciaDisclaimerSignature] = useState("");
  const [inasistenciaDisclaimerSeenSignature, setInasistenciaDisclaimerSeenSignature] = useState("");
  const [inasistenciaDisclaimerError, setInasistenciaDisclaimerError] = useState<string | null>(null);
  const [asistenciaRefreshToken, setAsistenciaRefreshToken] = useState(0);
  const [mostrarDatosAsistenteById, setMostrarDatosAsistenteById] = useState<Record<string, boolean>>({});

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

  const mostrarVotacionAcuerdo = useMemo(() => {
    const t = tipoDocumento.trim().toUpperCase();
    return t.startsWith("ACUERDO DE PAGO") || t === "ACTA FRACASO DEL TRAMITE";
  }, [tipoDocumento]);

  const votosNegativosMayores = useMemo(() => {
    if (!mostrarVotacionAcuerdo) return false;

    let positivos = 0;
    let negativos = 0;

    acreencias.forEach((a) => {
      const pct = porcentajeCalculadoByAcreenciaId.byAcreenciaId.get(a.id) ?? null;
      if (typeof pct !== "number" || Number.isNaN(pct)) return;

      const voto = votosAcuerdoByAcreenciaId[a.id];
      if (voto === "POSITIVO") positivos += pct;
      else if (voto === "NEGATIVO") negativos += pct;
    });

    return negativos > positivos;
  }, [acreencias, mostrarVotacionAcuerdo, porcentajeCalculadoByAcreenciaId.byAcreenciaId, votosAcuerdoByAcreenciaId]);

  const tipoDocumentoOpciones = useMemo(() => {
    const base = [
      { value: "ACTA AUDIENCIA", label: "Acta Audiencia" },
      { value: "ACUERDO DE PAGO", label: "Acuerdo de Pago" },
      { value: "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE", label: "Acuerdo de Pago Bilateral y Fracaso del Tr\u00E1mite" },
      { value: "ACTA FRACASO DEL TRAMITE", label: "Acta Fracaso del Tr\u00E1mite" },
      { value: "ACTA RECHAZO DEL TRAMITE", label: "Acta Rechazo del Tr\u00E1mite" },
      { value: "AUTO DECLARA NULIDAD", label: "Auto Declara Nulidad" },
    ];

    if (!votosNegativosMayores) return base;

    // If the vote result is mostly negative, restrict the type choices to "rechazo" outcomes.
    return base.filter((o) =>
      o.value === "ACTA RECHAZO DEL TRAMITE" || o.value === "ACTA FRACASO DEL TRAMITE" || o.value === "AUTO DECLARA NULIDAD"
    );
  }, [votosNegativosMayores]);

  useEffect(() => {
    if (!votosNegativosMayores) return;
    const allowed = new Set(tipoDocumentoOpciones.map((o) => o.value));
    if (!allowed.has(tipoDocumento)) {
      // Prefer "fracaso" as the default outcome when votes are mostly negative.
      setTipoDocumento("ACTA FRACASO DEL TRAMITE");
    }
  }, [tipoDocumento, tipoDocumentoOpciones, votosNegativosMayores]);

  const resumenVotosAcuerdo = useMemo(() => {
    const out = {
      POSITIVO: 0,
      NEGATIVO: 0,
      AUSENTE: 0,
      ABSTENCION: 0,
      SIN_VOTO: 0,
      TOTAL: 0,
    };

    if (!mostrarVotacionAcuerdo) return out;

    acreencias.forEach((a) => {
      const pct = porcentajeCalculadoByAcreenciaId.byAcreenciaId.get(a.id) ?? null;
      if (typeof pct !== "number" || Number.isNaN(pct)) return;
      out.TOTAL += pct;

      const voto = votosAcuerdoByAcreenciaId[a.id];
      if (!voto) {
        out.SIN_VOTO += pct;
        return;
      }

      if (voto === "POSITIVO") out.POSITIVO += pct;
      else if (voto === "NEGATIVO") out.NEGATIVO += pct;
      else if (voto === "AUSENTE") out.AUSENTE += pct;
      else if (voto === "ABSTENCION") out.ABSTENCION += pct;
      else out.SIN_VOTO += pct;
    });

    return out;
  }, [acreencias, mostrarVotacionAcuerdo, porcentajeCalculadoByAcreenciaId, votosAcuerdoByAcreenciaId]);

  const formatPctUi = (value: number) => value.toFixed(2).replace(".", ",") + "%";
  const mostrarBotonTerminarProceso = useMemo(() => {
    if (!terminarAudienciaResult) return false;
    const tipo = (tipoDocumentoActaGenerada ?? "").trim().toUpperCase();
    return TIPOS_ACTA_CON_TERMINACION_PROCESO.has(tipo);
  }, [terminarAudienciaResult, tipoDocumentoActaGenerada]);

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
      setMostrarDatosAsistenteById({});
      setDeudorApoderadoIds([]);
      setDeudorApoderadoNombreById({});
      setInasistenciaDisclaimerItems([]);
      setInasistenciaDisclaimerOpen(false);
      setInasistenciaDisclaimerSignature("");
      setInasistenciaDisclaimerSeenSignature("");
      setInasistenciaDisclaimerError(null);
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

        const deudorApoderadosUnicos = Array.from(
          new Set(
            (deudores ?? [])
              .map((deudor) => deudor.apoderado_id ?? "")
              .filter((id): id is string => Boolean(id))
          )
        );

        const apoderadoNombreById = new Map(
          apoderadosParaMostrar.map((apoderado) => [apoderado.id, apoderado.nombre ?? "Apoderado del deudor"])
        );
        const deudorApoderadoNombres: Record<string, string> = {};
        deudorApoderadosUnicos.forEach((apoderadoId) => {
          deudorApoderadoNombres[apoderadoId] =
            apoderadoNombreById.get(apoderadoId) ?? "Apoderado del deudor";
        });

        const filas = mapApoderadosFromProceso(
          { ...procesoConRelaciones, deudores },
          apoderadosParaMostrar
        );

        if (!activo) return;

        if (filas.length > 0) {
          setAsistentes(filas);
          setMostrarDatosAsistenteById({});
          setProcesoApoderadosMensaje(`Apoderados cargados (${filas.length})`);
        } else {
          setProcesoApoderadosMensaje(
            "No se encontraron apoderados vinculados a este proceso."
          );
        }
        setDeudorApoderadoIds(deudorApoderadosUnicos);
        setDeudorApoderadoNombreById(deudorApoderadoNombres);
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
    if (!procesoId || deudorApoderadoIds.length === 0) {
      setInasistenciaDisclaimerItems([]);
      setInasistenciaDisclaimerOpen(false);
      setInasistenciaDisclaimerSignature("");
      setInasistenciaDisclaimerError(null);
      return;
    }

    let canceled = false;
    (async () => {
      try {
        setInasistenciaDisclaimerError(null);
        const { data, error } = await supabase
          .from("asistencia")
          .select("apoderado_id, evento_id, estado")
          .eq("proceso_id", procesoId)
          .in("apoderado_id", deudorApoderadoIds)
          .eq("estado", "Ausente")
          .not("evento_id", "is", null);

        if (error) throw error;
        if (canceled) return;

        const ausenciasPorApoderado = new Map<string, Set<string>>();
        (data ?? []).forEach((row) => {
          const apoderadoId = row.apoderado_id ?? "";
          const eventoId = row.evento_id ?? "";
          if (!apoderadoId || !eventoId) return;
          if (!ausenciasPorApoderado.has(apoderadoId)) {
            ausenciasPorApoderado.set(apoderadoId, new Set<string>());
          }
          ausenciasPorApoderado.get(apoderadoId)!.add(eventoId);
        });

        const items = deudorApoderadoIds
          .map((apoderadoId) => ({
            apoderadoId,
            nombre: deudorApoderadoNombreById[apoderadoId] ?? "Apoderado del deudor",
            eventosAusentes: ausenciasPorApoderado.get(apoderadoId)?.size ?? 0,
          }))
          .filter((item) => item.eventosAusentes >= 2);

        setInasistenciaDisclaimerItems(items);

        if (items.length === 0) {
          setInasistenciaDisclaimerSignature("");
          setInasistenciaDisclaimerOpen(false);
          return;
        }

        const signature = `${procesoId}:${items
          .map((item) => `${item.apoderadoId}:${item.eventosAusentes}`)
          .sort()
          .join("|")}`;
        setInasistenciaDisclaimerSignature(signature);

        if (signature !== inasistenciaDisclaimerSeenSignature) {
          setInasistenciaDisclaimerOpen(true);
        }
      } catch (error) {
        if (!canceled) {
          const detail = toErrorMessage(error);
          setInasistenciaDisclaimerError(
            `No se pudo verificar inasistencias de apoderados de deudor. ${detail}`
          );
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    procesoId,
    deudorApoderadoIds,
    deudorApoderadoNombreById,
    asistenciaRefreshToken,
    inasistenciaDisclaimerSeenSignature,
  ]);

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
        dias_mora: toFixedOrEmpty(acreencia.dias_mora),
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
        dias_mora: toNumberOrNull(draft.dias_mora),
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
        dias_mora: "",
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
  const asistenciaCompletitud = total > 0 ? Math.round((presentes / total) * 100) : 0;
  const procesoLabel = numeroProceso?.trim() || "Sin proceso seleccionado";
  const procesoIdCompact = procesoId ? `${procesoId.slice(0, 8)}...${procesoId.slice(-4)}` : null;
  const eventoIdCompact = eventoId ? `${eventoId.slice(0, 8)}...${eventoId.slice(-4)}` : null;

  const mensajeApoderado = procesoApoderadosCargando
    ? "Cargando apoderados del proceso..."
    : procesoApoderadosError ?? procesoApoderadosMensaje;

  const puedeGuardar = useMemo(() => {
    return asistentes.length > 0 && asistentes.every((a) => a.nombre.trim());
  }, [asistentes]);

  function agregarFila() {
    const nuevaFila = {
      id: uid(),
      nombre: "",
      email: "",
      identificacion: "",
      categoria: "Acreedor" as Categoria,
      estado: "Ausente" as EstadoAsistencia,
      tarjetaProfesional: "",
      calidadApoderadoDe: "",
    };
    setAsistentes((prev) => [
      ...prev,
      nuevaFila,
    ]);
    setMostrarDatosAsistenteById((prev) => ({ ...prev, [nuevaFila.id]: true }));
  }

  function eliminarFila(id: string) {
    setAsistentes((prev) => prev.filter((a) => a.id !== id));
    setMostrarDatosAsistenteById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function actualizarFila(id: string, patch: Partial<Asistente>) {
    setAsistentes((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  }

  function toggleDatosAsistente(id: string) {
    setMostrarDatosAsistenteById((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function marcarTodos(estado: EstadoAsistencia) {
    setAsistentes((prev) => prev.map((a) => ({ ...a, estado })));
  }

  function reiniciar() {
    const filaInicial = {
      id: uid(),
      nombre: "",
      email: "",
      identificacion: "",
      categoria: "Acreedor" as Categoria,
      estado: "Ausente" as EstadoAsistencia,
      tarjetaProfesional: "",
      calidadApoderadoDe: "",
    };
    setTitulo("Llamado de asistencia");
    setFecha(new Date().toISOString().slice(0, 10));
    setAsistentes([filaInicial]);
    setMostrarDatosAsistenteById({ [filaInicial.id]: true });
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
      const procesoIdSafe = procesoId?.trim() || null;
      const eventoIdSafe = eventoId?.trim() || null;

      if (!procesoIdSafe && !eventoIdSafe) {
        throw new Error("Falta procesoId en la URL. Abre /lista?procesoId=...");
      }
      if (procesoIdSafe && !isUuid(procesoIdSafe)) {
        throw new Error(`procesoId no es UUID válido: ${procesoIdSafe}`);
      }
      if (eventoIdSafe && !isUuid(eventoIdSafe)) {
        throw new Error(`eventoId no es UUID válido: ${eventoIdSafe}`);
      }

      const registros: AsistenciaInsert[] = asistentes.map((a) => ({
        proceso_id: procesoIdSafe,
        evento_id: eventoIdSafe,
        apoderado_id: a.apoderadoId || null,
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
      setAsistenciaRefreshToken((prev) => prev + 1);
      return true;
    } catch (error) {
      const detail = toErrorMessage(error);
      console.error("Error guardando asistencia:", { detail, error });
      setGuardadoError(`No se pudo guardar la asistencia. ${detail}`);
      return false;
    } finally {
      setGuardando(false);
    }
  };

  async function guardarAsistencia(e: React.FormEvent) {
    e.preventDefault();
    await guardarAsistenciaInterno();
  }

  const terminarAudiencia = async (opts?: { force?: boolean }) => {
    if (!procesoId || terminandoAudiencia) return;

    const force = opts?.force === true;
    const advertencias: string[] = [];

    const acreenciasVacias =
      !acreenciasCargando &&
      !acreenciasError &&
      (acreencias?.length ?? 0) === 0;
    if (acreenciasVacias) {
      advertencias.push("Acreencias del proceso: est\u00E1 vac\u00EDo.");
    }

    const agendarVacio = !proximaFecha || !eventoSiguienteId;
    if (agendarVacio) {
      advertencias.push("Agendar pr\u00F3xima audiencia: est\u00E1 vac\u00EDo (no hay evento pr\u00F3ximo guardado).");
    }

    if (!force && advertencias.length > 0) {
      setTerminarAudienciaAdvertencias(advertencias);
      setMostrarModalTerminarAudiencia(true);
      return;
    }

    setTerminandoAudiencia(true);
    setTerminarAudienciaError(null);
    setTerminarAudienciaResult(null);
    setTipoDocumentoActaGenerada(null);
    setTerminarProcesoError(null);
    setTerminarProcesoExito(null);

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

      // Build a set of apoderado IDs that are present in the llamado a lista
      const apoderadosPresentesIds = new Set(
        asistentes
          .filter((a) => a.estado === "Presente" && a.apoderadoId)
          .map((a) => a.apoderadoId!)
      );

      const acreenciasRaw = acreencias.map((a) => ({
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
        voto: mostrarVotacionAcuerdo ? (votosAcuerdoByAcreenciaId[a.id] || null) : null,
        dias_mora: a.dias_mora ?? null,
        _presente: apoderadosPresentesIds.has(a.apoderado_id),
      }));

      // If at least one acreencia is present and at least one is absent, sort presentes first
      const hayAlgunoPresente = acreenciasRaw.some((a) => a._presente);
      const hayAlgunoAusente = acreenciasRaw.some((a) => !a._presente);
      const acreenciasOrdenadas =
        hayAlgunoPresente && hayAlgunoAusente
          ? [...acreenciasRaw].sort((a, b) => (a._presente === b._presente ? 0 : a._presente ? -1 : 1))
          : acreenciasRaw;

      const acreenciasPayload = acreenciasOrdenadas.map(({ _presente: _p, ...rest }) => rest);

      let excelArchivoPayload: ProcesoExcelArchivoPayload | null = null;
      if (procesoId) {
        try {
          const params = new URLSearchParams({ procesoIds: procesoId });
          const excelRes = await fetch(`/api/upload-excel?${params.toString()}`);
          const excelJson = (await excelRes.json().catch(() => null)) as UploadExcelGetResponse | null;

          if (excelRes.ok) {
            const latest = excelJson?.files?.[0] ?? null;
            if (latest) {
              excelArchivoPayload = {
                ...latest,
                original_file_name: latest.drive_file_name,
              };
            }
          } else if (debugLista) {
            console.warn("[/lista debug] /api/upload-excel lookup failed", {
              status: excelRes.status,
              payload: excelJson,
            });
          }
        } catch (apiError) {
          if (debugLista) {
            console.warn("[/lista debug] /api/upload-excel lookup exception", apiError);
          }
        }

        if (!excelArchivoPayload) {
          const { data: excelArchivo, error: excelArchivoError } = await supabase
            .from("proceso_excel_archivos")
            .select(
              "id, proceso_id, original_file_name, drive_file_id, drive_file_name, drive_web_view_link, drive_web_content_link, created_at"
            )
            .eq("proceso_id", procesoId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (excelArchivoError) {
            if (debugLista) {
              console.warn("[/lista debug] unable to load excel metadata for payload", excelArchivoError);
            }
          } else if (excelArchivo) {
            excelArchivoPayload = excelArchivo as ProcesoExcelArchivoPayload;
          }
        }
      }

      const requiereExcelAcuerdo = tipoDocumento.trim().toUpperCase().startsWith("ACUERDO DE PAGO");
      if (requiereExcelAcuerdo && !excelArchivoPayload) {
        throw new Error(
          "No hay archivo Excel asociado a este proceso para generar la proyeccion de pagos. Sube el Excel en /procesos para este mismo proceso y vuelve a generar el acta."
        );
      }

      const terminarAudienciaPayload = {
        procesoId,
        numeroProceso,
        titulo: asistenciaPayload.titulo,
        fecha: asistenciaPayload.fecha,
        eventoId,
        hora,
        ciudad,
        tipoDocumento,
        propuestaPago,
        excelArchivo: excelArchivoPayload ?? undefined,
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
        | { fileId: string; fileName: string; webViewLink: string | null; apoderadoEmails?: string[]; actaId?: string | null; error?: string; detail?: string }
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
      setTipoDocumentoActaGenerada(tipoDocumento);
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

  const terminarProceso = async () => {
    if (!procesoId || terminandoProceso) return;

    setTerminandoProceso(true);
    setTerminarProcesoError(null);
    setTerminarProcesoExito(null);

    try {
      await updateProgresoByProcesoId(procesoId, { estado: "finalizado" });
      setTerminarProcesoExito("Proceso marcado como terminado.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTerminarProcesoError(msg);
    } finally {
      setTerminandoProceso(false);
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
        fileId: terminarAudienciaResult.fileId,
        fileName: terminarAudienciaResult.fileName,
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

  const sugerirHorario = async () => {
    if (sugiriendo) return;
    if (!user?.id) {
      setSugerirError("Inicia sesion para sugerencias basadas en tu calendario.");
      return;
    }

    setSugiriendo(true);
    setSugerirError(null);
    setSugerencias([]);

    try {
      const todayKey = formatBogotaDateKey(new Date());
      const anchorKey = proximaFecha || addDaysBogota(todayKey, 1);
      const rangeEndKey = addDaysBogota(anchorKey, 14);
      const historyStartKey = addDaysBogota(todayKey, -180);

      const { data: history, error: historyError } = await supabase
        .from("eventos")
        .select("fecha, hora")
        .eq("usuario_id", user.id)
        .gte("fecha", historyStartKey)
        .lte("fecha", todayKey);

      if (historyError) throw historyError;

      const { data: upcoming, error: upcomingError } = await supabase
        .from("eventos")
        .select("fecha, hora, fecha_fin, hora_fin")
        .eq("usuario_id", user.id)
        .gte("fecha", anchorKey)
        .lte("fecha", rangeEndKey);

      if (upcomingError) throw upcomingError;

      const prefByKey = new Map<string, number>();
      const prefSlot = new Map<string, number>();
      const prefWeekday = new Map<number, number>();

      const now = new Date();
      const slots = getBusinessSlotsHHMM();

      for (const evt of history ?? []) {
        const fecha = (evt as any).fecha as string | null;
        const hora = normalizeHoraHHMM((evt as any).hora);
        if (!fecha || !hora) continue;

        const d0 = dateKeyToBogotaMidnight(fecha);
        if (!d0) continue;

        const daysAgo = Math.max(0, Math.floor((now.getTime() - d0.getTime()) / 86400000));
        const w = Math.exp(-daysAgo / 45);

        const weekday = d0.getUTCDay();
        const k = `${weekday}-${hora}`;
        prefByKey.set(k, (prefByKey.get(k) ?? 0) + w);
        prefSlot.set(hora, (prefSlot.get(hora) ?? 0) + w);
        prefWeekday.set(weekday, (prefWeekday.get(weekday) ?? 0) + w);
      }

      const busyByDate = new Map<string, Array<[number, number]>>();
      const defaultDurationMin = 60;

      for (const evt of upcoming ?? []) {
        const fecha = (evt as any).fecha as string | null;
        const hora = normalizeHoraHHMM((evt as any).hora);
        if (!fecha || !hora) continue;

        const start = hhmmToMinutes(hora);
        if (start === null) continue;

        const horaFin = normalizeHoraHHMM((evt as any).hora_fin);
        let end = start + defaultDurationMin;
        const fechaFin = (evt as any).fecha_fin as string | null;
        if (horaFin && (!fechaFin || fechaFin === fecha)) {
          const endMin = hhmmToMinutes(horaFin);
          if (endMin !== null && endMin > start) end = endMin;
        }

        const list = busyByDate.get(fecha) ?? [];
        list.push([start, end]);
        busyByDate.set(fecha, list);
      }

      const candidates: HorarioSugerido[] = [];
      const daysToTry = proximaFecha ? 1 : 14;

      for (let i = 0; i < daysToTry; i++) {
        const dateKey = proximaFecha ? proximaFecha : addDaysBogota(anchorKey, i);
        const d0 = dateKeyToBogotaMidnight(dateKey);
        if (!d0) continue;
        const weekday = d0.getUTCDay();

        for (const hhmm of slots) {
          const start = hhmmToMinutes(hhmm)!;
          const end = start + defaultDurationMin;

          const busy = busyByDate.get(dateKey) ?? [];
          const conflict = busy.some(([bs, be]) => start < be && end > bs);
          if (conflict) continue;

          const k = `${weekday}-${hhmm}`;
          const score =
            (prefByKey.get(k) ?? 0) * 1.0 +
            (prefSlot.get(hhmm) ?? 0) * 0.35 +
            (prefWeekday.get(weekday) ?? 0) * 0.15 -
            (proximaFecha ? 0 : i * 0.02);

          const learned = (prefByKey.get(k) ?? 0) + (prefSlot.get(hhmm) ?? 0) + (prefWeekday.get(weekday) ?? 0);
          const reason = learned > 0.25
            ? "Basado en tu historial (preferencias aprendidas) y sin conflictos."
            : "Sin conflictos en tu calendario.";

          candidates.push({ fecha: dateKey, hora: hhmm, score, reason });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      const top = candidates.slice(0, 5);
      setSugerencias(top);
      if (top.length === 0) {
        setSugerirError("No encontre espacios libres en el rango evaluado.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSugerirError(msg);
    } finally {
      setSugiriendo(false);
    }
  };

  useEffect(() => {
    if (!procesoId) {
      setEventoSiguienteId(null);
      setEventoSiguienteError(null);
      setEventoSiguienteCargando(false);
      return;
    }

    let canceled = false;
    (async () => {
      setEventoSiguienteCargando(true);
      setEventoSiguienteError(null);
      try {
        const todayKey = formatBogotaDateKey(new Date());
        let query = supabase
          .from("eventos")
          .select("id, titulo, fecha, hora, tipo, completado")
          .eq("proceso_id", procesoId)
          .eq("completado", false)
          .gte("fecha", todayKey)
          .order("fecha", { ascending: true })
          .order("hora", { ascending: true })
          .limit(10);

        if (eventoId) {
          query = query.neq("id", eventoId);
        }

        const { data, error } = await query;

        if (error) throw error;

        const eventos = (data ?? [])
          .map((e) => ({ ...e, horaHHMM: normalizeHoraHHMM((e as any).hora) }))
          .filter((e) => Boolean(e.fecha));

        const pick =
          eventos.find((e) => (e.tipo ?? "").toLowerCase() === "audiencia") ??
          eventos[0] ??
          null;

        if (canceled) return;
        if (!pick) {
          setEventoSiguienteId(null);
          return;
        }

        setEventoSiguienteId(pick.id);
        setProximaTitulo(pick.titulo ?? "");
        setProximaFecha(pick.fecha);

        const horaPick = (pick as any).horaHHMM as string | null;
        if (horaPick && isWithinBusinessHours(horaPick)) {
          setProximaHora(horaPick);
        } else if (horaPick) {
          setProximaHora(minutesToHHMM(BUSINESS_START_MINUTES));
          setEventoSiguienteError(`El evento existente tiene hora ${horaPick} fuera del horario 08:00-17:00. Ajusta antes de guardar.`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!canceled) setEventoSiguienteError(msg);
      } finally {
        if (!canceled) setEventoSiguienteCargando(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [procesoId, eventoId]);

  useEffect(() => {
    if (autoSugerido) return;
    if (!user?.id) return;
    setAutoSugerido(true);
    void sugerirHorario();
  }, [autoSugerido, user?.id]);

  const agendarProximaAudiencia = async () => {
    if (!procesoId || !proximaFecha || agendando) return;

    setAgendando(true);
    setAgendarError(null);
    setAgendarExito(null);

    try {
      const horaNormalizada = normalizeHoraHHMM(proximaHora);
      if (!horaNormalizada || !isWithinBusinessHours(horaNormalizada)) {
        throw new Error("La hora debe estar entre 08:00 y 17:00.");
      }

      if (operadorUsuarioId) {
        const conflict = await hasUserTimeConflict({
          userId: operadorUsuarioId,
          fechaISO: proximaFecha,
          horaHHMM: horaNormalizada,
          excludeEventoId: eventoSiguienteId ?? undefined,
        });
        if (conflict) {
          throw new Error("Ese usuario ya tiene un evento en esa fecha y hora. Cambia la hora.");
        }
      }

      const tituloEvento = proximaTitulo.trim() || await buildProcesoEventoTitle(procesoId);

      const payloadBase = {
        titulo: tituloEvento,
        descripcion: `Proxima audiencia programada desde lista de asistencia.`,
        fecha: proximaFecha,
        hora: `${horaNormalizada}:00`,
        fecha_fin: null,
        hora_fin: null,
        usuario_id: operadorUsuarioId,
        proceso_id: procesoId,
        tipo: "audiencia",
        color: "#f59e0b",
        // recordatorio=false means: reminder not sent yet (see /api/event-reminders)
        recordatorio: false,
        completado: false,
      };

      if (eventoSiguienteId) {
        await updateEvento(eventoSiguienteId, payloadBase);
      } else {
        const creado = await createEvento(payloadBase);
        setEventoSiguienteId(creado.id);
      }

      // Format time for display (24h -> 12h)
      const [hh, mm] = horaNormalizada.split(":");
      const h24 = Number(hh);
      const meridiem = h24 >= 12 ? "PM" : "AM";
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      const horaDisplay = `${h12}:${mm} ${meridiem}`;

      const accion = eventoSiguienteId ? "actualizado" : "agendado";
      setAgendarExito(`Evento "${tituloEvento}" ${accion} para ${proximaFecha} a las ${horaDisplay}.`);
    } catch (e: unknown) {
      console.error("[agendarProximaAudiencia] error:", e);
      setAgendarError(toErrorMessage(e));
    } finally {
      setAgendando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(226,232,240,0.65),transparent_55%),linear-gradient(to_bottom,#fafafa,#f4f4f5)] text-zinc-950 dark:bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.45),transparent_50%),linear-gradient(to_bottom,#000,#09090b)] dark:text-zinc-50">
      {/* Gradient top */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-56 bg-gradient-to-b from-white/80 to-transparent dark:from-zinc-900/70" />

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        {mostrarModalTerminarAudiencia && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => setMostrarModalTerminarAudiencia(false)}
              className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
            />
            <div className="relative w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-zinc-950 sm:p-6">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Faltan secciones antes de terminar
              </h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Est\u00E1s a punto de terminar la audiencia, pero estas secciones est\u00E1n vac\u00EDas:
              </p>

              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-200">
                {terminarAudienciaAdvertencias.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMostrarModalTerminarAudiencia(false)}
                  className="h-11 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMostrarModalTerminarAudiencia(false);
                    void terminarAudiencia({ force: true });
                  }}
                  className="h-11 rounded-2xl bg-amber-500 px-5 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-400 dark:bg-amber-400 dark:text-black"
                >
                  Continuar y terminar
                </button>
              </div>
            </div>
          </div>
        )}

        {inasistenciaDisclaimerOpen && inasistenciaDisclaimerItems.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Cerrar advertencia de inasistencia"
              onClick={() => {
                setInasistenciaDisclaimerSeenSignature(inasistenciaDisclaimerSignature);
                setInasistenciaDisclaimerOpen(false);
              }}
              className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
            />
            <div className="relative w-full max-w-lg rounded-3xl border border-red-200 bg-white p-5 shadow-xl dark:border-red-500/30 dark:bg-zinc-950 sm:p-6">
              <h3 className="text-base font-semibold tracking-tight text-red-700 dark:text-red-300">
                Advertencia de inasistencia
              </h3>
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                Se detectaron apoderados del deudor con inasistencia en 2 o m&aacute;s eventos:
              </p>

              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-100">
                {inasistenciaDisclaimerItems.map((item) => (
                  <li key={item.apoderadoId}>
                    {item.nombre}: {item.eventosAusentes} inasistencias
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setInasistenciaDisclaimerSeenSignature(inasistenciaDisclaimerSignature);
                    setInasistenciaDisclaimerOpen(false);
                  }}
                  className="h-11 rounded-2xl bg-red-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="mb-8 space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Asistencia
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Audiencia
          </h1>

          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Marca quién está presente o ausente en segundos. Diseño limpio y rápido, estilo Apple.
          </p>
          <div className="rounded-3xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                  Proceso
                </p>
                <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {procesoLabel}
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  {presentes} presentes de {total} asistentes ({asistenciaCompletitud}%).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill label="Total" value={total} tone="neutral" />
                <Pill label="Presentes" value={presentes} tone="positive" />
                <Pill label="Ausentes" value={ausentes} tone="negative" />
                {procesoIdCompact ? <Pill label="ID proceso" value="" compactLabel={procesoIdCompact} tone="neutral" /> : null}
                {eventoIdCompact ? <Pill label="ID evento" value="" compactLabel={eventoIdCompact} tone="neutral" /> : null}
              </div>
            </div>
            <div className="mt-4 h-2 rounded-full bg-zinc-200/80 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-zinc-900 transition-[width] duration-300 dark:bg-zinc-100"
                style={{ width: `${asistenciaCompletitud}%` }}
              />
            </div>
          </div>
        </header>

        {/* Navigation */}
        <nav className="mb-8 flex flex-wrap items-center gap-2">
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
          <a
            href="#asistencia"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Asistencia
          </a>
          <a
            href="#acreencias"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Acreencias
          </a>
          <a
            href="#agendar"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Agendar proxima
          </a>
        </nav>

        {!procesoId && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Esta vista funciona mejor con proceso vinculado. Abre <code>/lista?procesoId=&lt;uuid&gt;</code> desde Procesos o Calendario.
          </div>
        )}

        {procesoId && mensajeApoderado && (
          <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
            {mensajeApoderado}
          </p>
        )}

        {inasistenciaDisclaimerError && (
          <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {inasistenciaDisclaimerError}
          </div>
        )}

        {/* Main Card */}
        <section id="asistencia" className="scroll-mt-24 rounded-[30px] border border-zinc-200/90 bg-white/85 p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/[0.04] sm:p-7">
          <form onSubmit={guardarAsistencia} className="space-y-6">
            {/* Top Controls */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                  <span className="ml-1 text-zinc-400 dark:text-zinc-500">(8 AM – 5 PM)</span>
                </label>
                <input
                  type="time"
                  value={proximaHora}
                  onChange={(e) => setProximaHora(e.target.value)}
                  min={minutesToHHMM(BUSINESS_START_MINUTES)}
                  max={minutesToHHMM(BUSINESS_END_MINUTES)}
                  step={60}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
            </div>

            {/* Operador/Conciliador (collapsible) */}
            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <button
                type="button"
                onClick={() => setMostrarDatosOperador((prev) => !prev)}
                className="flex w-full items-center justify-between text-left text-sm font-medium text-zinc-700 dark:text-zinc-200"
              >
                <span>Datos del Operador/Conciliador</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {mostrarDatosOperador ? "Ocultar" : "Mostrar"}
                </span>
              </button>
              {mostrarDatosOperador && (
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
              )}
            </div>

            {/* Stats + Bulk Actions */}
            <div className="flex flex-col gap-3 rounded-3xl border border-zinc-200 bg-gradient-to-br from-white to-zinc-50 p-4 shadow-sm dark:border-white/10 dark:bg-gradient-to-br dark:from-white/10 dark:to-white/5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Pill label="Total" value={total} tone="neutral" />
                <Pill label="Presentes" value={presentes} tone="positive" />
                <Pill label="Ausentes" value={ausentes} tone="negative" />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => marcarTodos("Presente")}
                  className="h-10 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100 dark:hover:bg-emerald-500/20"
                >
                  Marcar todos presentes
                </button>

                <button
                  type="button"
                  onClick={() => marcarTodos("Ausente")}
                  className="h-10 rounded-2xl border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/20"
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
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-medium text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
                        {index + 1}
                      </span>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        Asistente
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleDatosAsistente(a.id)}
                        className="rounded-full px-3 py-1 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                      >
                        {Boolean(mostrarDatosAsistenteById[a.id]) ? "Ocultar datos" : "Mostrar datos"}
                      </button>
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
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {Boolean(mostrarDatosAsistenteById[a.id]) && (
                      <>
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

                      </>
                    )}

                    {/* Switch */}
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Estado
                      </label>

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-2 dark:border-white/10 dark:bg-black/20">
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

            {/* Votación apoderados (acuerdos y fracaso del tramite) */}
            {mostrarVotacionAcuerdo && (
              <>
              <section className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">
                      Propuesta de pago
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Completa los campos recurrentes de la propuesta. Se imprimirán en el acta como viñetas.
                    </p>
                  </div>
                </div>

                {(
                  [
                    { key: "primera_clase", title: "Pago acreedor de primera clase" },
                    { key: "tercera_clase", title: "Pago a acreedor tercera clase" },
                    { key: "quinta_clase", title: "Pago a acreedores de quinta clase" },
                  ] as const
                ).map(({ key, title }) => {
                  const v = propuestaPago[key];
                  return (
                    <div key={key} className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-black/20">
                      <h4 className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                        {title}
                      </h4>

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                            Número de cuotas
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={v.numero_cuotas}
                            onChange={(e) =>
                              setPropuestaPago((prev) => ({
                                ...prev,
                                [key]: { ...prev[key], numero_cuotas: e.target.value },
                              }))
                            }
                            placeholder="Ej: 80"
                            className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                          />
                        </div>

                        <div className="sm:col-span-1">
                          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                            Interés reconocido
                          </label>
                          <input
                            value={v.interes_reconocido}
                            onChange={(e) =>
                              setPropuestaPago((prev) => ({
                                ...prev,
                                [key]: { ...prev[key], interes_reconocido: e.target.value },
                              }))
                            }
                            placeholder="Ej: 0,7% nominal mensual futuro"
                            className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                            Inicio de pagos
                          </label>
                          <input
                            type="date"
                            value={v.inicio_pagos}
                            onChange={(e) =>
                              setPropuestaPago((prev) => ({
                                ...prev,
                                [key]: { ...prev[key], inicio_pagos: e.target.value },
                              }))
                            }
                            className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                            Fecha fin pagos
                          </label>
                          <input
                            type="date"
                            value={v.fecha_fin_pagos}
                            onChange={(e) =>
                              setPropuestaPago((prev) => ({
                                ...prev,
                                [key]: { ...prev[key], fecha_fin_pagos: e.target.value },
                              }))
                            }
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
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">
                      Votación de apoderados
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Captura el voto por acreedor (normalmente vota su apoderado) para el acuerdo de pago o el acta de fracaso.
                    </p>
                  </div>

                  {acreencias.length > 0 && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Total ponderado: {formatPctUi(resumenVotosAcuerdo.TOTAL)}
                    </p>
                  )}
                </div>

                {acreenciasCargando ? (
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                    Cargando acreencias...
                  </p>
                ) : acreencias.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                    No hay acreencias registradas para capturar la votación.
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm md:min-w-[860px]">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-[0.25em] text-zinc-400">
                          <th className="pb-3 pr-4">Acreedor</th>
                          <th className="pb-3 pr-4">Apoderado</th>
                          <th className="pb-3 pr-4 text-right">%</th>
                          <th className="pb-3 pr-0">Voto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acreencias.map((a) => {
                          const pct = porcentajeCalculadoByAcreenciaId.byAcreenciaId.get(a.id) ?? null;
                          const voto = votosAcuerdoByAcreenciaId[a.id] ?? "";
                          return (
                            <tr
                              key={a.id}
                              className="border-t border-zinc-200/70 dark:border-white/10"
                            >
                              <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                                <div className="max-w-[320px] truncate">
                                  {a.acreedores?.nombre ?? a.acreedor_id ?? "—"}
                                </div>
                              </td>
                              <td className="py-3 pr-4">
                                <div className="max-w-[280px] truncate">
                                  {a.apoderados?.nombre ?? a.apoderado_id ?? "—"}
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-right tabular-nums">
                                {typeof pct === "number" && !Number.isNaN(pct) ? formatPctUi(pct) : "—"}
                              </td>
                              <td className="py-3 pr-0">
                                <select
                                  value={voto}
                                  onChange={(e) =>
                                    setVotosAcuerdoByAcreenciaId((prev) => ({
                                      ...prev,
                                      [a.id]: e.target.value as VotoAcuerdo | "",
                                    }))
                                  }
                                  className="h-10 w-full min-w-[160px] cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 text-sm font-medium shadow-sm sm:min-w-[220px] dark:border-white/10 dark:bg-white/5 dark:text-white"
                                >
                                  <option value="">Seleccionar...</option>
                                  <option value="POSITIVO">Voto positivo</option>
                                  <option value="NEGATIVO">Voto negativo</option>
                                  <option value="AUSENTE">Voto ausente</option>
                                  <option value="ABSTENCION">Abstención</option>
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {acreencias.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm dark:border-white/10 dark:bg-white/10">
                      Positivos: {formatPctUi(resumenVotosAcuerdo.POSITIVO)}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm dark:border-white/10 dark:bg-white/10">
                      Negativos: {formatPctUi(resumenVotosAcuerdo.NEGATIVO)}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm dark:border-white/10 dark:bg-white/10">
                      Ausentes: {formatPctUi(resumenVotosAcuerdo.AUSENTE)}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm dark:border-white/10 dark:bg-white/10">
                      Abstención: {formatPctUi(resumenVotosAcuerdo.ABSTENCION)}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm dark:border-white/10 dark:bg-white/10">
                      Sin voto: {formatPctUi(resumenVotosAcuerdo.SIN_VOTO)}
                    </span>
                  </div>
                )}
              </section>
              </>
            )}

            {/* Footer Actions */}
            <div className="grid gap-3 rounded-3xl border border-zinc-200 bg-white/60 p-4 shadow-sm dark:border-white/10 dark:bg-white/5 lg:grid-cols-[auto_1fr] lg:items-center">
              <button
                type="button"
                onClick={agregarFila}
                className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 lg:w-auto dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                + Agregar asistente
              </button>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:flex-wrap">
                <button
                  type="button"
                  onClick={reiniciar}
                  className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 xl:w-auto dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  Reiniciar
                </button>

                <button
                  type="submit"
                  disabled={!puedeGuardar || guardando}
                  className="h-12 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 xl:w-auto dark:bg-white dark:text-black"
                >
                  {guardando ? "Guardando..." : "Guardar asistencia"}
                </button>

                <select
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm font-medium shadow-sm xl:w-auto dark:border-white/10 dark:bg-white/5 dark:text-white"
                >
                  {tipoDocumentoOpciones.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => void terminarAudiencia()}
                  disabled={
                    !procesoId ||
                    !puedeGuardar ||
                    guardando ||
                    terminandoAudiencia ||
                    acreenciaGuardandoId !== null
                  }
                  className="h-12 w-full rounded-2xl bg-amber-500 px-6 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 xl:w-auto dark:bg-amber-400 dark:text-black"
                >
                  {terminandoAudiencia ? "Terminando..." : "Crear Acta"}
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

                {mostrarBotonTerminarProceso && (
                  <div className="mt-4 border-t border-green-200 pt-4 dark:border-green-500/30">
                    <button
                      type="button"
                      onClick={() => void terminarProceso()}
                      disabled={terminandoProceso || Boolean(terminarProcesoExito)}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {terminandoProceso
                        ? "Terminando..."
                        : terminarProcesoExito
                          ? "Proceso terminado"
                          : "Terminar proceso"}
                    </button>
                    {terminarProcesoError && (
                      <p className="mt-2 text-red-700 dark:text-red-300">{terminarProcesoError}</p>
                    )}
                    {terminarProcesoExito && (
                      <p className="mt-2 text-emerald-700 dark:text-emerald-300">{terminarProcesoExito}</p>
                    )}
                  </div>
                )}

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
          <section id="acreencias" className="mt-8 scroll-mt-24 rounded-[30px] border border-zinc-200/90 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
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

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={
                    !acreenciaEditandoId ||
                    !acreenciaDrafts[acreenciaEditandoId] ||
                    acreenciaGuardandoId !== null
                  }
                  onClick={() => acreenciaEditandoId && guardarEdicionAcreencia(acreenciaEditandoId)}
                  className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto dark:bg-white dark:text-black"
                >
                  Guardar
                </button>

                <button
                  type="button"
                  disabled={!acreenciaEditandoId || acreenciaGuardandoId !== null}
                  onClick={cancelarEdicionAcreencia}
                  className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
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
                <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm md:min-w-[980px]">
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
                      <th className="pb-3 pr-4">Días de mora</th>
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
                          <td className="py-3 pr-4">
                            {editando ? (
                              <input
                                type="number"
                                value={draft?.dias_mora ?? ""}
                                onChange={(e) =>
                                  onChangeAcreenciaDraft(acreencia.id, { dias_mora: e.target.value })
                                }
                                min="0"
                                step="1"
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50 dark:focus:border-white"
                                placeholder="0"
                              />
                            ) : (
                              <div>{acreencia.dias_mora ?? "—"}</div>
                            )}
                          </td>
                          <td className="py-3 pr-0">
                            <div className="flex flex-wrap justify-end gap-2">
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

        {/* Schedule Next Event */}
        <section id="agendar" className="mt-8 scroll-mt-24 rounded-[30px] border border-zinc-200/90 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight">Agendar próxima audiencia</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Programa la fecha y hora del próximo evento para este proceso.
              <span className="ml-1 text-zinc-400 dark:text-zinc-500">Horario: 8:00 AM – 5:00 PM (Bogotá)</span>
            </p>

            {!procesoId && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Para agendar, abre /lista con ?procesoId=... (por ejemplo desde Procesos o Calendario).
              </div>
            )}

            {procesoId && (
              <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                {eventoSiguienteCargando
                  ? "Buscando evento existente en el calendario..."
                  : eventoSiguienteId
                    ? "Editando evento existente (se actualiza, no se crea uno nuevo)."
                    : "No hay evento proximo: se creara uno nuevo al guardar."}
              </div>
            )}

            {eventoSiguienteError && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                {eventoSiguienteError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Título del evento
                </label>
                <input
                  value={proximaTitulo}
                  onChange={(e) => setProximaTitulo(e.target.value)}
                  placeholder={`Audiencia - ${numeroProceso || "Proceso"}`}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Fecha
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
                  Hora
                </label>
                <input
                  type="time"
                  value={proximaHora}
                  onChange={(e) => setProximaHora(e.target.value)}
                  min={minutesToHHMM(BUSINESS_START_MINUTES)}
                  max={minutesToHHMM(BUSINESS_END_MINUTES)}
                  step={60}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={sugerirHorario}
                disabled={sugiriendo || !user?.id}
                className="h-11 rounded-2xl border border-zinc-200 bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
              >
                {sugiriendo ? "Sugiriendo..." : "Sugerir horario"}
              </button>

              <button
                type="button"
                onClick={agendarProximaAudiencia}
                disabled={!procesoId || !proximaFecha || agendando}
                className="h-11 rounded-2xl bg-zinc-950 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                {agendando ? "Guardando..." : (eventoSiguienteId ? "Guardar cambios" : "Agendar evento")}
              </button>
            </div>

            {sugerirError && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                {sugerirError}
              </div>
            )}

            {sugerencias.length > 0 && (
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
                <div className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Sugerencias</div>
                <div className="flex flex-col gap-2">
                  {sugerencias.map((s) => (
                    <button
                      key={`${s.fecha}-${s.hora}`}
                      type="button"
                      onClick={() => {
                        setProximaFecha(s.fecha);
                        setProximaHora(s.hora);
                      }}
                      className="flex w-full flex-col rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-zinc-50 dark:border-white/10 dark:bg-black/20 dark:hover:bg-white/5"
                    >
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {s.fecha} {s.hora}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{s.reason}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {agendarError && (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {agendarError}
              </div>
            )}

            {agendarExito && (
              <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
                {agendarExito}
              </div>
            )}
          </section>

        <footer className="mt-8 text-xs text-zinc-500 dark:text-zinc-400">
          Tip: usa <span className="rounded bg-zinc-200 px-1 dark:bg-white/10">Tab</span>{" "}
          para moverte rápido entre campos.
        </footer>
      </main>
    </div>
  );
}

function Pill({
  label,
  value,
  tone = "neutral",
  compactLabel,
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "positive" | "negative";
  compactLabel?: string;
}) {
  const toneClassName =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
      : tone === "negative"
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
      : "border-zinc-200 bg-white text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200";
  const labelClassName =
    tone === "neutral" ? "text-zinc-500 dark:text-zinc-300" : "text-current/70";

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs shadow-sm ${toneClassName}`}>
      <span className={labelClassName}>{label}</span>
      <span className="font-medium">{compactLabel ?? value}</span>
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
