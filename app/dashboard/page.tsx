"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import type { Database } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

type ProcesoRow = Database["public"]["Tables"]["proceso"]["Row"];
type EventoRow = Database["public"]["Tables"]["eventos"]["Row"];
type UsuarioRow = Database["public"]["Tables"]["usuarios"]["Row"];
type DeudorRow = Database["public"]["Tables"]["deudores"]["Row"];
type AcreedorRow = Database["public"]["Tables"]["acreedores"]["Row"];
type ApoderadoRow = Database["public"]["Tables"]["apoderados"]["Row"];
type AcreenciaRow = Database["public"]["Tables"]["acreencias"]["Row"];
type ProgresoRow = Database["public"]["Tables"]["progreso"]["Row"];
type ProgresoEstado = ProgresoRow["estado"];

type ProcesoDashboardRow = Pick<
  ProcesoRow,
  "id" | "numero_proceso" | "estado" | "tipo_proceso" | "juzgado" | "created_at" | "created_by_auth_id" | "usuario_id"
>;

type EventoDashboardRow = Pick<EventoRow, "id" | "titulo" | "fecha" | "hora" | "proceso_id">;

type DeudorDashboardRow = Pick<DeudorRow, "id" | "proceso_id" | "apoderado_id" | "nombre" | "identificacion">;
type AcreedorDashboardRow = Pick<
  AcreedorRow,
  "id" | "proceso_id" | "apoderado_id" | "nombre" | "identificacion"
>;
type ApoderadoDashboardRow = Pick<ApoderadoRow, "id" | "nombre" | "email">;
type AcreenciaDashboardRow = Pick<
  AcreenciaRow,
  | "id"
  | "proceso_id"
  | "acreedor_id"
  | "naturaleza"
  | "prelacion"
  | "capital"
  | "int_cte"
  | "int_mora"
  | "otros_cobros_seguros"
  | "total"
  | "porcentaje"
>;
type ProgresoDashboardRow = Pick<
  ProgresoRow,
  | "id"
  | "proceso_id"
  | "estado"
  | "numero_audiencias"
  | "fecha_procesos_real"
  | "fecha_finalizacion"
  | "updated_at"
>;
type UsuarioOwnerDashboardRow = Pick<UsuarioRow, "id" | "auth_id" | "nombre" | "email">;

type DeudorDetalle = {
  deudor: DeudorDashboardRow;
  apoderado: ApoderadoDashboardRow | null;
};

type AcreedorDetalle = {
  acreedor: AcreedorDashboardRow;
  apoderado: ApoderadoDashboardRow | null;
  acreencias: AcreenciaDashboardRow[];
  totalAcreencias: number;
};

type ProcesoMetricas = {
  proceso: ProcesoDashboardRow;
  progreso: ProgresoDashboardRow | null;
  progresoEstado: ProgresoEstado;
  progresoAvance: number;
  usuarioProcesoLabel: string;
  totalEventos: number;
  eventosRealizados: number;
  eventosPorVenir: number;
  ultimoRealizado: EventoDashboardRow | null;
  proximoEvento: EventoDashboardRow | null;
  deudores: DeudorDetalle[];
  acreedores: AcreedorDetalle[];
  totalAcreenciasProceso: number;
  eventos: EventoDashboardRow[];
};

const PROCESO_SELECT =
  "id, numero_proceso, estado, tipo_proceso, juzgado, created_at, created_by_auth_id, usuario_id";
const EVENTO_SELECT = "id, titulo, fecha, hora, proceso_id";
const DEUDOR_SELECT = "id, proceso_id, apoderado_id, nombre, identificacion";
const ACREEDOR_SELECT = "id, proceso_id, apoderado_id, nombre, identificacion";
const APODERADO_SELECT = "id, nombre, email";
const ACREENCIA_SELECT =
  "id, proceso_id, acreedor_id, naturaleza, prelacion, capital, int_cte, int_mora, otros_cobros_seguros, total, porcentaje";
const PROGRESO_SELECT_FULL =
  "id, proceso_id, estado, numero_audiencias, fecha_procesos_real, fecha_finalizacion, updated_at";
const PROGRESO_SELECT_BASIC = "id, proceso_id, estado, numero_audiencias, updated_at";
const COP_CURRENCY = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

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
    if (message) return message;
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

function normalizeHora(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

function toEventDate(fecha: string, hora: string | null | undefined, fallback: "start" | "end") {
  const safeHora = normalizeHora(hora) ?? (fallback === "end" ? "23:59:59" : "00:00:00");
  const parsed = new Date(`${fecha}T${safeHora}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function compareEventosByDateTime(a: EventoDashboardRow, b: EventoDashboardRow) {
  const dateA = toEventDate(a.fecha, a.hora, "start");
  const dateB = toEventDate(b.fecha, b.hora, "start");
  const timeA = dateA?.getTime() ?? Number.POSITIVE_INFINITY;
  const timeB = dateB?.getTime() ?? Number.POSITIVE_INFINITY;
  if (timeA !== timeB) return timeA - timeB;
  return a.titulo.localeCompare(b.titulo);
}

function isEventoRealizado(evento: EventoDashboardRow, now: Date) {
  const eventDate = toEventDate(evento.fecha, evento.hora, "end");
  if (!eventDate) return false;
  return eventDate.getTime() < now.getTime();
}

function formatEventoFechaHora(evento: EventoDashboardRow) {
  const baseDate = toEventDate(evento.fecha, evento.hora, "start");
  if (!baseDate) return evento.fecha;

  const fechaTexto = baseDate.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hora = normalizeHora(evento.hora);
  if (!hora) return fechaTexto;
  return `${fechaTexto} ${hora.slice(0, 5)}`;
}

function toSafeNumber(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return value;
}

function resolveAcreenciaTotal(acreencia: AcreenciaDashboardRow) {
  if (typeof acreencia.total === "number" && !Number.isNaN(acreencia.total)) {
    return acreencia.total;
  }

  const fallbackTotal =
    toSafeNumber(acreencia.capital) +
    toSafeNumber(acreencia.int_cte) +
    toSafeNumber(acreencia.int_mora) +
    toSafeNumber(acreencia.otros_cobros_seguros);
  return fallbackTotal;
}

function formatMoney(value: number) {
  return COP_CURRENCY.format(value);
}

function isAdminRole(rol: string | null | undefined) {
  return (rol ?? "").trim().toLowerCase() === "admin";
}

function resolveProcesoUsuarioLabel(
  proceso: ProcesoDashboardRow,
  usuariosById: ReadonlyMap<string, UsuarioOwnerDashboardRow>,
  usuariosByAuthId: ReadonlyMap<string, UsuarioOwnerDashboardRow>,
  fallbackLabel: string,
) {
  const fromUsuarioId = proceso.usuario_id ? usuariosById.get(proceso.usuario_id) ?? null : null;
  const fromAuthId = proceso.created_by_auth_id
    ? usuariosByAuthId.get(proceso.created_by_auth_id) ?? null
    : null;

  const preferredName =
    fromUsuarioId?.nombre?.trim() ||
    fromAuthId?.nombre?.trim() ||
    fromUsuarioId?.email?.trim() ||
    fromAuthId?.email?.trim();

  if (preferredName) return preferredName;
  if (proceso.created_by_auth_id) return proceso.created_by_auth_id;
  return fallbackLabel || "Sin usuario asignado";
}

function estadoToneClass(estado: string | null) {
  if (estado === "Activo") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (estado === "Finalizado") {
    return "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
  if (estado === "Suspendido") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300";
}

function formatProgresoEstado(estado: ProgresoEstado) {
  if (estado === "iniciado") return "Iniciado";
  if (estado === "finalizado") return "Finalizado";
  return "No iniciado";
}

function getProgresoAvance(estado: ProgresoEstado) {
  if (estado === "finalizado") return 100;
  if (estado === "iniciado") return 55;
  return 10;
}

function progresoToneClass(estado: ProgresoEstado) {
  if (estado === "finalizado") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (estado === "iniciado") {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

function progresoBarClass(estado: ProgresoEstado) {
  if (estado === "finalizado") return "bg-emerald-500";
  if (estado === "iniciado") return "bg-blue-500";
  return "bg-zinc-400 dark:bg-zinc-500";
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type MetricChipProps = {
  label: string;
  value: number;
  tone?: "neutral" | "positive" | "warning";
};

function MetricChip({ label, value, tone = "neutral" }: MetricChipProps) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-zinc-200 bg-white/80 text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200";

  return (
    <div className={`rounded-2xl border px-3 py-2.5 sm:px-4 sm:py-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-85">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{value}</p>
    </div>
  );
}

type ProgresoChartEntry = {
  id: ProgresoEstado;
  label: string;
  value: number;
  color: string;
};

function ProgresoDonutChart({
  data,
  total,
  finalizadoPct,
}: {
  data: ProgresoChartEntry[];
  total: number;
  finalizadoPct: number;
}) {
  const size = 164;
  const strokeWidth = 16;
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = data.reduce(
    (acc, entry) => {
      if (entry.value <= 0 || total <= 0) return acc;
      const segmentLength = (entry.value / total) * circumference;
      return {
        offset: acc.offset + segmentLength,
        items: [
          ...acc.items,
          {
            entry,
            segmentLength,
            segmentOffset: acc.offset,
          },
        ],
      };
    },
    {
      offset: 0,
      items: [] as Array<{
        entry: ProgresoChartEntry;
        segmentLength: number;
        segmentOffset: number;
      }>,
    },
  ).items;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-40 w-40 shrink-0" role="img" aria-label="Distribucion de progreso">
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-zinc-200 dark:text-zinc-700"
      />
      <g transform={`rotate(-90 ${center} ${center})`}>
        {segments.map(({ entry, segmentLength, segmentOffset }) => {
          return (
            <circle
              key={entry.id}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={entry.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segmentLength} ${circumference}`}
              strokeDashoffset={-segmentOffset}
              strokeLinecap="butt"
            />
          );
        })}
      </g>
      <text
        x={center}
        y={center - 6}
        textAnchor="middle"
        className="fill-zinc-900 text-[18px] font-semibold dark:fill-zinc-100"
      >
        {finalizadoPct}%
      </text>
      <text
        x={center}
        y={center + 16}
        textAnchor="middle"
        className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
      >
        finalizado
      </text>
    </svg>
  );
}

function ProgresoBarsChart({
  data,
  maxValue,
}: {
  data: ProgresoChartEntry[];
  maxValue: number;
}) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {data.map((entry) => {
        const ratio = maxValue > 0 ? (entry.value / maxValue) * 100 : 0;
        return (
          <div key={entry.id} className="rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              {entry.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{entry.value}</p>
            <div className="mt-3 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${ratio}%`, backgroundColor: entry.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [usuarioNombre, setUsuarioNombre] = useState<string>("");
  const [metricasPorProceso, setMetricasPorProceso] = useState<ProcesoMetricas[]>([]);

  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false);
      setUsuarioNombre("");
      setMetricasPorProceso([]);
      setError(null);
      setSchemaWarning(null);
      setLoading(false);
      return;
    }

    let canceled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setSchemaWarning(null);

      try {
        let warning: string | null = null;
        let usuarioPerfil: Pick<UsuarioRow, "id" | "nombre" | "rol" | "email"> | null = null;

        const { data: usuarioData, error: usuarioError } = await supabase
          .from("usuarios")
          .select("id, nombre, rol, email")
          .eq("auth_id", user.id)
          .maybeSingle();

        if (usuarioError) {
          console.warn("No se pudo resolver usuarios.id para el dashboard:", usuarioError);
        } else {
          usuarioPerfil =
            (usuarioData as Pick<UsuarioRow, "id" | "nombre" | "rol" | "email"> | null) ?? null;
        }

        const nombreMostrado = usuarioPerfil?.nombre?.trim() || usuarioPerfil?.email || user.email || "Usuario";
        const usuarioEsAdmin = isAdminRole(usuarioPerfil?.rol);
        if (!canceled) {
          setIsAdmin(usuarioEsAdmin);
          setUsuarioNombre(nombreMostrado);
        }

        const usuarioPerfilId = usuarioPerfil?.id ?? null;
        let procesos: ProcesoDashboardRow[] = [];

        if (usuarioEsAdmin) {
          const allProcesos = await supabase
            .from("proceso")
            .select(PROCESO_SELECT)
            .order("created_at", { ascending: false });
          if (allProcesos.error) throw allProcesos.error;
          procesos = (allProcesos.data ?? []) as ProcesoDashboardRow[];
        } else if (usuarioPerfilId) {
          const combined = await supabase
            .from("proceso")
            .select(PROCESO_SELECT)
            .or(`created_by_auth_id.eq.${user.id},usuario_id.eq.${usuarioPerfilId}`)
            .order("created_at", { ascending: false });

          if (!combined.error) {
            procesos = (combined.data ?? []) as ProcesoDashboardRow[];
          } else {
            const missingUsuarioId = isMissingColumnError(combined.error, "usuario_id");
            const missingCreatedByAuthId = isMissingColumnError(combined.error, "created_by_auth_id");

            if (missingUsuarioId && !missingCreatedByAuthId) {
              const byCreator = await supabase
                .from("proceso")
                .select(PROCESO_SELECT)
                .eq("created_by_auth_id", user.id)
                .order("created_at", { ascending: false });
              if (byCreator.error) throw byCreator.error;
              procesos = (byCreator.data ?? []) as ProcesoDashboardRow[];
            } else if (!missingUsuarioId && missingCreatedByAuthId) {
              const byUsuario = await supabase
                .from("proceso")
                .select(PROCESO_SELECT)
                .eq("usuario_id", usuarioPerfilId)
                .order("created_at", { ascending: false });
              if (byUsuario.error) throw byUsuario.error;
              procesos = (byUsuario.data ?? []) as ProcesoDashboardRow[];
            } else if (missingUsuarioId && missingCreatedByAuthId) {
              procesos = [];
              warning =
                "No se detectaron columnas de propiedad de proceso (created_by_auth_id / usuario_id). Ejecuta migraciones para filtrar por usuario.";
            } else {
              throw combined.error;
            }
          }
        } else {
          const byCreator = await supabase
            .from("proceso")
            .select(PROCESO_SELECT)
            .eq("created_by_auth_id", user.id)
            .order("created_at", { ascending: false });

          if (byCreator.error) {
            if (isMissingColumnError(byCreator.error, "created_by_auth_id")) {
              procesos = [];
              warning =
                "No se detecto la columna created_by_auth_id en proceso. Ejecuta migraciones para filtrar por usuario.";
            } else {
              throw byCreator.error;
            }
          } else {
            procesos = (byCreator.data ?? []) as ProcesoDashboardRow[];
          }
        }

        if (!canceled) {
          setSchemaWarning(warning);
        }

        if (procesos.length === 0) {
          if (!canceled) {
            setMetricasPorProceso([]);
          }
          return;
        }

        const procesoIds = procesos.map((proceso) => proceso.id);
        const [eventosResponse, deudoresResponse, acreedoresResponse, acreenciasResponse] =
          await Promise.all([
            supabase
              .from("eventos")
              .select(EVENTO_SELECT)
              .in("proceso_id", procesoIds)
              .order("fecha", { ascending: true })
              .order("hora", { ascending: true }),
            supabase.from("deudores").select(DEUDOR_SELECT).in("proceso_id", procesoIds),
            supabase.from("acreedores").select(ACREEDOR_SELECT).in("proceso_id", procesoIds),
            supabase.from("acreencias").select(ACREENCIA_SELECT).in("proceso_id", procesoIds),
          ]);

        if (eventosResponse.error) throw eventosResponse.error;
        if (deudoresResponse.error) throw deudoresResponse.error;
        if (acreedoresResponse.error) throw acreedoresResponse.error;
        if (acreenciasResponse.error) throw acreenciasResponse.error;

        const eventos = (eventosResponse.data ?? []) as EventoDashboardRow[];
        const deudores = (deudoresResponse.data ?? []) as DeudorDashboardRow[];
        const acreedores = (acreedoresResponse.data ?? []) as AcreedorDashboardRow[];
        const acreencias = (acreenciasResponse.data ?? []) as AcreenciaDashboardRow[];
        let progresos: ProgresoDashboardRow[] = [];
        const progresosFullResponse = await supabase
          .from("progreso")
          .select(PROGRESO_SELECT_FULL)
          .in("proceso_id", procesoIds)
          .order("updated_at", { ascending: false });

        if (!progresosFullResponse.error) {
          progresos = (progresosFullResponse.data ?? []) as ProgresoDashboardRow[];
        } else {
          const missingFechaInicio = isMissingColumnError(
            progresosFullResponse.error,
            "fecha_procesos_real",
          );
          const missingFechaFinal = isMissingColumnError(
            progresosFullResponse.error,
            "fecha_finalizacion",
          );

          if (missingFechaInicio || missingFechaFinal) {
            const progresosBasicResponse = await supabase
              .from("progreso")
              .select(PROGRESO_SELECT_BASIC)
              .in("proceso_id", procesoIds)
              .order("updated_at", { ascending: false });

            if (progresosBasicResponse.error) throw progresosBasicResponse.error;

            progresos = ((progresosBasicResponse.data ?? []) as Array<
              Pick<ProgresoDashboardRow, "id" | "proceso_id" | "estado" | "numero_audiencias" | "updated_at">
            >).map((row) => ({
              ...row,
              fecha_procesos_real: null,
              fecha_finalizacion: null,
            }));

            warning = warning
              ? `${warning} La tabla progreso no expone todas las columnas de fecha en este entorno.`
              : "La tabla progreso no expone todas las columnas de fecha en este entorno.";
          } else {
            throw progresosFullResponse.error;
          }
        }
        const usuariosById = new Map<string, UsuarioOwnerDashboardRow>();
        const usuariosByAuthId = new Map<string, UsuarioOwnerDashboardRow>();

        const usuariosResponse = await supabase
          .from("usuarios")
          .select("id, auth_id, nombre, email");

        if (usuariosResponse.error) {
          console.warn("No se pudieron cargar usuarios para etiquetar propietarios en dashboard:", usuariosResponse.error);
        } else {
          ((usuariosResponse.data ?? []) as UsuarioOwnerDashboardRow[]).forEach((usuarioOwner) => {
            usuariosById.set(usuarioOwner.id, usuarioOwner);
            if (usuarioOwner.auth_id) {
              usuariosByAuthId.set(usuarioOwner.auth_id, usuarioOwner);
            }
          });
        }

        const apoderadoIds = Array.from(
          new Set(
            [...deudores.map((row) => row.apoderado_id), ...acreedores.map((row) => row.apoderado_id)].filter(
              (value): value is string => Boolean(value),
            ),
          ),
        );

        let apoderadosById = new Map<string, ApoderadoDashboardRow>();
        if (apoderadoIds.length > 0) {
          const { data: apoderadosData, error: apoderadosError } = await supabase
            .from("apoderados")
            .select(APODERADO_SELECT)
            .in("id", apoderadoIds);
          if (apoderadosError) throw apoderadosError;

          apoderadosById = new Map(
            ((apoderadosData ?? []) as ApoderadoDashboardRow[]).map((apoderado) => [
              apoderado.id,
              apoderado,
            ]),
          );
        }

        const eventosByProcesoId = new Map<string, EventoDashboardRow[]>();
        eventos.forEach((evento) => {
          const procesoId = evento.proceso_id;
          if (!procesoId) return;
          const list = eventosByProcesoId.get(procesoId);
          if (list) {
            list.push(evento);
          } else {
            eventosByProcesoId.set(procesoId, [evento]);
          }
        });

        const deudoresByProcesoId = new Map<string, DeudorDashboardRow[]>();
        deudores.forEach((deudor) => {
          const procesoId = deudor.proceso_id;
          if (!procesoId) return;
          const list = deudoresByProcesoId.get(procesoId);
          if (list) {
            list.push(deudor);
          } else {
            deudoresByProcesoId.set(procesoId, [deudor]);
          }
        });

        const acreedoresByProcesoId = new Map<string, AcreedorDashboardRow[]>();
        acreedores.forEach((acreedor) => {
          const procesoId = acreedor.proceso_id;
          if (!procesoId) return;
          const list = acreedoresByProcesoId.get(procesoId);
          if (list) {
            list.push(acreedor);
          } else {
            acreedoresByProcesoId.set(procesoId, [acreedor]);
          }
        });

        const acreenciasByAcreedorId = new Map<string, AcreenciaDashboardRow[]>();
        acreencias.forEach((acreencia) => {
          const acreedorId = acreencia.acreedor_id;
          if (!acreedorId) return;
          const list = acreenciasByAcreedorId.get(acreedorId);
          if (list) {
            list.push(acreencia);
          } else {
            acreenciasByAcreedorId.set(acreedorId, [acreencia]);
          }
        });

        const progresoByProcesoId = new Map<string, ProgresoDashboardRow>();
        progresos.forEach((progreso) => {
          if (!progreso.proceso_id) return;
          if (!progresoByProcesoId.has(progreso.proceso_id)) {
            // Query is ordered by updated_at desc, keep the most recent row per proceso.
            progresoByProcesoId.set(progreso.proceso_id, progreso);
          }
        });

        if (!canceled) {
          setSchemaWarning(warning);
        }

        const now = new Date();
        const metricas = procesos.map((proceso) => {
          const progreso = progresoByProcesoId.get(proceso.id) ?? null;
          const progresoEstado: ProgresoEstado = progreso?.estado ?? "no_iniciado";

          const eventosProceso = [...(eventosByProcesoId.get(proceso.id) ?? [])].sort(compareEventosByDateTime);

          const realizados: EventoDashboardRow[] = [];
          const porVenir: EventoDashboardRow[] = [];

          eventosProceso.forEach((evento) => {
            if (isEventoRealizado(evento, now)) {
              realizados.push(evento);
            } else {
              porVenir.push(evento);
            }
          });

          const deudoresProceso = [...(deudoresByProcesoId.get(proceso.id) ?? [])]
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
            .map((deudor) => ({
              deudor,
              apoderado: deudor.apoderado_id ? apoderadosById.get(deudor.apoderado_id) ?? null : null,
            }));

          const acreedoresProceso = [...(acreedoresByProcesoId.get(proceso.id) ?? [])]
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
            .map((acreedor) => {
              const acreenciasAcreedor = [...(acreenciasByAcreedorId.get(acreedor.id) ?? [])].sort(
                (a, b) =>
                  (a.naturaleza ?? "").localeCompare(b.naturaleza ?? "") ||
                  (a.prelacion ?? "").localeCompare(b.prelacion ?? ""),
              );
              const totalAcreencias = acreenciasAcreedor.reduce(
                (sum, acreencia) => sum + resolveAcreenciaTotal(acreencia),
                0,
              );
              return {
                acreedor,
                apoderado: acreedor.apoderado_id ? apoderadosById.get(acreedor.apoderado_id) ?? null : null,
                acreencias: acreenciasAcreedor,
                totalAcreencias,
              };
            });

          const totalAcreenciasProceso = acreedoresProceso.reduce(
            (sum, acreedorDetalle) => sum + acreedorDetalle.totalAcreencias,
            0,
          );

          return {
            proceso,
            progreso,
            progresoEstado,
            progresoAvance: getProgresoAvance(progresoEstado),
            usuarioProcesoLabel: resolveProcesoUsuarioLabel(
              proceso,
              usuariosById,
              usuariosByAuthId,
              nombreMostrado,
            ),
            totalEventos: eventosProceso.length,
            eventosRealizados: realizados.length,
            eventosPorVenir: porVenir.length,
            ultimoRealizado: realizados.length > 0 ? realizados[realizados.length - 1] : null,
            proximoEvento: porVenir.length > 0 ? porVenir[0] : null,
            deudores: deudoresProceso,
            acreedores: acreedoresProceso,
            totalAcreenciasProceso,
            eventos: eventosProceso,
          };
        });

        if (usuarioEsAdmin) {
          metricas.sort(
            (a, b) =>
              a.usuarioProcesoLabel.localeCompare(b.usuarioProcesoLabel, "es", { sensitivity: "base" }) ||
              b.proceso.created_at.localeCompare(a.proceso.created_at),
          );
        }

        if (!canceled) {
          setMetricasPorProceso(metricas);
        }
      } catch (err) {
        if (!canceled) {
          setMetricasPorProceso([]);
          setError(toErrorMessage(err, "No se pudo cargar el dashboard."));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [user?.id, user?.email]);

  const resumenGlobal = useMemo(() => {
    return metricasPorProceso.reduce(
      (acc, item) => ({
        procesos: acc.procesos + 1,
        totalEventos: acc.totalEventos + item.totalEventos,
        realizados: acc.realizados + item.eventosRealizados,
        porVenir: acc.porVenir + item.eventosPorVenir,
      }),
      { procesos: 0, totalEventos: 0, realizados: 0, porVenir: 0 },
    );
  }, [metricasPorProceso]);

  const resumenProgreso = useMemo(() => {
    const base = {
      total: 0,
      no_iniciado: 0,
      iniciado: 0,
      finalizado: 0,
    };

    const counts = metricasPorProceso.reduce((acc, item) => {
      acc.total += 1;
      acc[item.progresoEstado] += 1;
      return acc;
    }, base);

    const finalizadoPct =
      counts.total > 0 ? Math.round((counts.finalizado / counts.total) * 100) : 0;

    return {
      ...counts,
      finalizadoPct,
    };
  }, [metricasPorProceso]);

  const progresoChartData = useMemo<ProgresoChartEntry[]>(
    () => [
      {
        id: "no_iniciado",
        label: "No iniciado",
        value: resumenProgreso.no_iniciado,
        color: "#94a3b8",
      },
      {
        id: "iniciado",
        label: "Iniciado",
        value: resumenProgreso.iniciado,
        color: "#3b82f6",
      },
      {
        id: "finalizado",
        label: "Finalizado",
        value: resumenProgreso.finalizado,
        color: "#10b981",
      },
    ],
    [resumenProgreso],
  );

  const maxProgresoChartValue = useMemo(() => {
    return Math.max(...progresoChartData.map((entry) => entry.value), 1);
  }, [progresoChartData]);

  const usuariosConProcesos = useMemo(() => {
    if (!isAdmin) return 0;
    return new Set(metricasPorProceso.map((item) => item.usuarioProcesoLabel)).size;
  }, [isAdmin, metricasPorProceso]);

  const resumenPorUsuario = useMemo(() => {
    if (!isAdmin) return [];

    const now = new Date();

    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    const dow = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - (dow === 0 ? 6 : dow - 1));

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const byUser = new Map<string, {
      label: string;
      eventosSemana: number;
      eventosMes: number;
      eventosRealizados: number;
      eventosPorVenir: number;
      eventosTotal: number;
    }>();

    for (const item of metricasPorProceso) {
      const label = item.usuarioProcesoLabel;
      const entry = byUser.get(label) ?? {
        label,
        eventosSemana: 0,
        eventosMes: 0,
        eventosRealizados: item.eventosRealizados,
        eventosPorVenir: item.eventosPorVenir,
        eventosTotal: item.totalEventos,
      };

      if (byUser.has(label)) {
        entry.eventosRealizados += item.eventosRealizados;
        entry.eventosPorVenir += item.eventosPorVenir;
        entry.eventosTotal += item.totalEventos;
      }

      for (const evento of item.eventos) {
        const eventDate = toEventDate(evento.fecha, evento.hora, "start");
        if (!eventDate) continue;
        const t = eventDate.getTime();
        if (t >= startOfWeek.getTime() && t <= endOfWeek.getTime()) entry.eventosSemana++;
        if (t >= startOfMonth.getTime() && t <= endOfMonth.getTime()) entry.eventosMes++;
      }

      byUser.set(label, entry);
    }

    return Array.from(byUser.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    );
  }, [isAdmin, metricasPorProceso]);

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
        <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
          <section className="rounded-3xl border border-zinc-200 bg-white/85 p-6 text-sm text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
            Debes iniciar sesion para ver tu dashboard de procesos.
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <header className="rounded-3xl border border-zinc-200 bg-white/85 p-4 shadow-sm sm:p-6 dark:border-white/10 dark:bg-white/5">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Dashboard
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl sm:text-4xl">
            Dashboard de procesos por usuario
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            {isAdmin
              ? "Resumen de todos los procesos por usuario, progreso del tramite y estado de agenda."
              : "Resumen de tus procesos con progreso del tramite y estado de agenda."}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Usuario: <span className="font-semibold">{usuarioNombre || user.email}</span>
            {isAdmin ? " (Admin)" : ""}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/procesos"
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
            >
              Ir a procesos
            </Link>
            <Link
              href="/calendario"
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
            >
              Ir a calendario
            </Link>
          </div>
        </header>

        {schemaWarning && (
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {schemaWarning}
          </section>
        )}

        {error && (
          <section className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </section>
        )}

        {loading ? (
          <section className="mt-6 rounded-3xl border border-zinc-200 bg-white/80 p-5 text-sm text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            Cargando dashboard...
          </section>
        ) : metricasPorProceso.length === 0 ? (
          <section className="mt-6 rounded-3xl border border-zinc-200 bg-white/80 p-5 text-sm text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            No hay procesos para mostrar.
          </section>
        ) : (
          <>
            <section
              className={`mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4 ${isAdmin ? "2xl:grid-cols-8" : "2xl:grid-cols-6"}`}
            >
              <MetricChip label="Procesos" value={resumenGlobal.procesos} />
              <MetricChip label="Eventos totales" value={resumenGlobal.totalEventos} />
              <MetricChip label="Eventos realizados" value={resumenGlobal.realizados} tone="positive" />
              <MetricChip label="Eventos por venir" value={resumenGlobal.porVenir} tone="warning" />
              <MetricChip label="No iniciados" value={resumenProgreso.no_iniciado} />
              <MetricChip label="Iniciados" value={resumenProgreso.iniciado} tone="warning" />
              <MetricChip label="Finalizados" value={resumenProgreso.finalizado} tone="positive" />
              {isAdmin && <MetricChip label="Usuarios" value={usuariosConProcesos} />}
            </section>

            {isAdmin && resumenPorUsuario.length > 0 && (
              <section className="mt-6 rounded-3xl border border-zinc-200 bg-white/85 p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-white/5">
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Actividad por usuario
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Eventos de cada usuario en la semana y mes actuales.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-white/10">
                        <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Usuario</th>
                        <th className="pb-2 px-3 text-right text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Esta semana</th>
                        <th className="pb-2 px-3 text-right text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Este mes</th>
                        <th className="pb-2 px-3 text-right text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400">Realizados</th>
                        <th className="pb-2 px-3 text-right text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-600 dark:text-amber-400">Por venir</th>
                        <th className="pb-2 pl-3 text-right text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                      {resumenPorUsuario.map((entry) => (
                        <tr key={entry.label}>
                          <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-100">{entry.label}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{entry.eventosSemana}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{entry.eventosMes}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{entry.eventosRealizados}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">{entry.eventosPorVenir}</td>
                          <td className="py-3 pl-3 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">{entry.eventosTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="mt-6 grid gap-4 lg:grid-cols-2">
              <article className="rounded-3xl border border-zinc-200 bg-white/85 p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-white/5">
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Overview de progreso
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Distribucion global del estado en la tabla de progreso por proceso.
                </p>

                <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
                  <ProgresoDonutChart
                    data={progresoChartData}
                    total={resumenProgreso.total}
                    finalizadoPct={resumenProgreso.finalizadoPct}
                  />
                  <div className="grid w-full flex-1 gap-2">
                    {progresoChartData.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white/75 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-zinc-600 dark:text-zinc-300">{entry.label}</span>
                        </div>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {entry.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Finalizados sobre total: {resumenProgreso.finalizadoPct}%
                  </p>
                  <div className="h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${resumenProgreso.finalizadoPct}%` }}
                    />
                  </div>
                </div>
              </article>

              <article className="rounded-3xl border border-zinc-200 bg-white/85 p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-white/5">
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Grafico de procesos por estado
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Comparativo por cantidad de procesos en No iniciado, Iniciado y Finalizado.
                </p>
                <ProgresoBarsChart data={progresoChartData} maxValue={maxProgresoChartValue} />
              </article>
            </section>

            <section className="mt-6 space-y-3">
              {metricasPorProceso.map((item) => (
                <article
                  key={item.proceso.id}
                  className="rounded-3xl border border-zinc-200 bg-white/85 p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-white/5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                        {item.proceso.numero_proceso || item.proceso.id}
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {item.proceso.tipo_proceso || "Sin tipo"}
                        {item.proceso.juzgado ? ` - ${item.proceso.juzgado}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Usuario: <span className="font-semibold">{item.usuarioProcesoLabel}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${estadoToneClass(
                          item.proceso.estado,
                        )}`}
                      >
                        Proceso: {item.proceso.estado || "Sin estado"}
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${progresoToneClass(
                          item.progresoEstado,
                        )}`}
                      >
                        Progreso: {formatProgresoEstado(item.progresoEstado)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <MetricChip label="Total" value={item.totalEventos} />
                    <MetricChip label="Realizados" value={item.eventosRealizados} tone="positive" />
                    <MetricChip label="Por venir" value={item.eventosPorVenir} tone="warning" />
                  </div>

                  <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                        Avance del progreso
                      </p>
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {formatProgresoEstado(item.progresoEstado)} ({item.progresoAvance}%)
                      </p>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all ${progresoBarClass(item.progresoEstado)}`}
                        style={{ width: `${item.progresoAvance}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>Audiencias: {item.progreso?.numero_audiencias ?? 0}</span>
                      {item.progreso?.fecha_procesos_real && (
                        <span>Inicio real: {formatDateLabel(item.progreso.fecha_procesos_real)}</span>
                      )}
                      {item.progreso?.fecha_finalizacion && (
                        <span>Finalizacion: {formatDateLabel(item.progreso.fecha_finalizacion)}</span>
                      )}
                      {!item.progreso && <span>Sin registro en tabla progreso (asumiendo no iniciado).</span>}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-zinc-600 dark:text-zinc-300 md:grid-cols-2">
                    <p>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">Ultimo realizado:</span>{" "}
                      {item.ultimoRealizado
                        ? `${item.ultimoRealizado.titulo} (${formatEventoFechaHora(item.ultimoRealizado)})`
                        : "Sin eventos realizados"}
                    </p>
                    <p>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">Proximo evento:</span>{" "}
                      {item.proximoEvento
                        ? `${item.proximoEvento.titulo} (${formatEventoFechaHora(item.proximoEvento)})`
                        : "Sin eventos por venir"}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Deudores y apoderados</h3>
                      {item.deudores.length === 0 ? (
                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Sin deudores registrados.</p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {item.deudores.map(({ deudor, apoderado }) => (
                            <div
                              key={deudor.id}
                              className="rounded-xl border border-zinc-200 bg-white/70 p-3 text-xs dark:border-white/10 dark:bg-black/20"
                            >
                              <p className="font-semibold text-zinc-900 dark:text-zinc-100">{deudor.nombre}</p>
                              <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                                ID: {deudor.identificacion || "Sin identificacion"}
                              </p>
                              <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                                Apoderado: {apoderado?.nombre || "Sin apoderado asignado"}
                              </p>
                              {apoderado?.email && (
                                <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">Correo: {apoderado.email}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          Acreedores, apoderados y acreencias
                        </h3>
                        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200">
                          Total: {formatMoney(item.totalAcreenciasProceso)}
                        </span>
                      </div>

                      {item.acreedores.length === 0 ? (
                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Sin acreedores registrados.</p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {item.acreedores.map(({ acreedor, apoderado, acreencias, totalAcreencias }) => (
                            <div
                              key={acreedor.id}
                              className="rounded-xl border border-zinc-200 bg-white/70 p-3 text-xs dark:border-white/10 dark:bg-black/20"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">{acreedor.nombre}</p>
                                  <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                                    ID: {acreedor.identificacion || "Sin identificacion"}
                                  </p>
                                  <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                                    Apoderado: {apoderado?.nombre || "Sin apoderado asignado"}
                                  </p>
                                  {apoderado?.email && (
                                    <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">Correo: {apoderado.email}</p>
                                  )}
                                </div>

                                <div className="text-right">
                                  <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                                    {acreencias.length} acreencias
                                  </p>
                                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">{formatMoney(totalAcreencias)}</p>
                                </div>
                              </div>

                              {acreencias.length > 0 ? (
                                <div className="mt-2 space-y-1">
                                  {acreencias.map((acreencia) => (
                                    <div
                                      key={acreencia.id}
                                      className="rounded-lg border border-zinc-200 bg-white/80 px-2 py-1.5 dark:border-white/10 dark:bg-white/5"
                                    >
                                      <p className="font-medium text-zinc-800 dark:text-zinc-100">
                                        {acreencia.naturaleza || "Sin naturaleza"}
                                        {acreencia.prelacion ? ` - ${acreencia.prelacion}` : ""}
                                      </p>
                                      <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">
                                        Total: {formatMoney(resolveAcreenciaTotal(acreencia))}
                                      </p>
                                      {typeof acreencia.porcentaje === "number" && (
                                        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                                          Porcentaje: {acreencia.porcentaje}%
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-zinc-500 dark:text-zinc-400">
                                  Sin acreencias registradas para este acreedor.
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/calendario?procesoId=${encodeURIComponent(item.proceso.id)}`}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
                    >
                      Ver en calendario
                    </Link>
                    <Link
                      href={`/lista?procesoId=${encodeURIComponent(item.proceso.id)}`}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white"
                    >
                      Abrir lista
                    </Link>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

