"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getProcesos } from "@/lib/api/proceso";
import { getUsuarios, type Usuario } from "@/lib/api/usuarios";
import {
  getEventos,
  getEventosByProceso,
  createEvento,
  updateEvento as updateEventoApi,
  deleteEvento as deleteEventoApi,
  retryEventoGoogleSync,
  type Evento,
} from "@/lib/api/eventos";
import { getDeudoresByProceso } from "@/lib/api/deudores";
import { getApoderadoById, getApoderadosByProceso } from "@/lib/api/apoderados";
import { getProgresos, updateProgresoByProcesoId, type Progreso } from "@/lib/api/progreso";
import type { Proceso } from "@/lib/database.types";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { getDestinoAsignado } from "@/lib/api/asignaciones";

type EventoCalendario = {
  id: string;
  titulo: string;
  fechaISO: string;
  hora?: string;
  usuarioId?: string;
  procesoId?: string;
  googleMeetUrl?: string;
  googleCalendarUrl?: string;
  googleSyncStatus?: string;
  googleSyncError?: string;
  googleSyncUpdatedAt?: string;
};

type AutoAdmisorioState = {
  loading: boolean;
  error: string | null;
  result: {
    fileId: string;
    fileName: string;
    webViewLink: string | null;
    apoderadoEmails?: string[];
  } | null;
  emailSending: boolean;
  emailResult: { sent: number; errors?: string[] } | null;
  emailError: string | null;
  adjuntosExtra: { name: string; content: string; contentType: string }[];
};

type ProgresoAction = {
  url: string;
  label: string;
  requiereIniciar: boolean;
};

type GoogleCalendarStatus = {
  available: boolean;
  oauthConfigured?: boolean;
  storageReady?: boolean;
  connected: boolean;
  googleEmail: string | null;
  connectedAt: string | null;
  setupMessage?: string | null;
};

function toEventoCalendario(evento: Evento): EventoCalendario {
  return {
    id: evento.id,
    titulo: evento.titulo,
    fechaISO: evento.fecha,
    hora: evento.hora?.slice(0, 5) || undefined,
    usuarioId: evento.usuario_id || undefined,
    procesoId: evento.proceso_id || undefined,
    googleMeetUrl: evento.google_meet_url || undefined,
    googleCalendarUrl: evento.google_calendar_html_link || undefined,
    googleSyncStatus: evento.google_sync_status || undefined,
    googleSyncError: evento.google_sync_error || undefined,
    googleSyncUpdatedAt: evento.google_sync_updated_at || undefined,
  };
}

function getGoogleSyncBadgeClassName(status: string | undefined) {
  switch (status) {
    case "synced":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "error":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    case "disabled":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    default:
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  }
}

function getGoogleSyncLabel(status: string | undefined) {
  switch (status) {
    case "synced":
      return "Google sincronizado";
    case "error":
      return "Error de sincronizacion";
    case "disabled":
      return "Google no configurado";
    case "pending":
      return "Sincronizando Google";
    default:
      return "Sin estado de Google";
  }
}

function formatGoogleSyncTimestamp(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

const BUSINESS_START_MINUTES = 8 * 60;
const BUSINESS_END_MINUTES = 17 * 60;

function minutesToHHMM(total: number) {
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeHoraHHMM(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function isWithinBusinessHours(hhmm: string | null | undefined) {
  const normalized = normalizeHoraHHMM(hhmm);
  if (!normalized) return false;
  const [hours, minutes] = normalized.split(":");
  const total = Number(hours) * 60 + Number(minutes);
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

function startOfWeek(date: Date) {
  const result = new Date(date);
  const dayIndex = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - dayIndex);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

const VIEW_OPTIONS = [
  { id: "month", label: "Mes" },
  { id: "week", label: "Semana" },
  { id: "day", label: "Día" },
] as const;

const MAX_MOBILE_WEEK_DAYS = 3;

const USER_COLOR_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#22d3ee", // cyan
  "#60a5fa", // blue
  "#a855f7", // purple
  "#ec4899", // pink
] as const;
const DEFAULT_EVENT_COLOR = "#94a3b8";

function withAlpha(hex: string, alpha: string) {
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return `${hex}${alpha}`;
  }
  return hex;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      detail?: unknown;
      details?: unknown;
      error?: unknown;
    };
    const firstMessage = [candidate.message, candidate.detail, candidate.details, candidate.error].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (firstMessage) {
      return firstMessage;
    }
  }
  return fallback;
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function notifyGoogleSyncIssue(evento: EventoCalendario) {
  if (evento.googleSyncStatus === "synced" && evento.googleSyncError) {
    alert(`El evento se sincronizo en Google Calendar, pero Google Meet no quedo disponible: ${evento.googleSyncError}`);
    return;
  }

  if (evento.googleSyncStatus === "error" && evento.googleSyncError) {
    alert(`El evento se guardo, pero fallo la sincronizacion con Google: ${evento.googleSyncError}`);
    return;
  }

  if (evento.googleSyncStatus === "disabled" && evento.googleSyncError) {
    alert(`El evento se guardo solo en AutoActas. ${evento.googleSyncError}`);
  }
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

function CalendarioContent() {
  const { user } = useAuth();
  const hoy = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [diaSeleccionadoISO, setDiaSeleccionadoISO] = useState(() => toISODate(new Date()));
  const [viewType, setViewType] = useState<"month" | "week" | "day">("month");
  const diaSeleccionadoDate = useMemo(() => new Date(diaSeleccionadoISO), [diaSeleccionadoISO]);
  const [isMobileScreen, setIsMobileScreen] = useState(false);

  const [eventos, setEventos] = useState<EventoCalendario[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState("");
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [nuevaHora, setNuevaHora] = useState("09:00");
  const [nuevoUsuarioId, setNuevoUsuarioId] = useState<string>("");
  const [nuevoProcesoId, setNuevoProcesoId] = useState<string>("");
  const [nuevaDuracion, setNuevaDuracion] = useState(60);
  const [tituloEditable, setTituloEditable] = useState(false);
  const [eventoSeleccionado, setEventoSeleccionado] = useState<EventoCalendario | null>(null);
  const [horaDetalleEditable, setHoraDetalleEditable] = useState("09:00");
  const [guardandoHoraDetalle, setGuardandoHoraDetalle] = useState(false);
  const [sincronizandoGoogleDetalle, setSincronizandoGoogleDetalle] = useState(false);

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioFiltro, setUsuarioFiltro] = useState<string>("global");
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [progresos, setProgresos] = useState<Progreso[]>([]);
  const [iniciandoProcesoById, setIniciandoProcesoById] = useState<Record<string, boolean>>({});
  const [iniciarProcesoErrorById, setIniciarProcesoErrorById] = useState<Record<string, string>>({});
  const [apoderadosRegistradosByProcesoId, setApoderadosRegistradosByProcesoId] = useState<Record<string, boolean>>({});
  const [autoAdmisorioStateByProcesoId, setAutoAdmisorioStateByProcesoId] = useState<
    Record<string, AutoAdmisorioState>
  >({});
  const [guardando, setGuardando] = useState(false);
  const [destinoAsignadoId, setDestinoAsignadoId] = useState<string>("");
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState<GoogleCalendarStatus>({
    available: false,
    oauthConfigured: false,
    storageReady: false,
    connected: false,
    googleEmail: null,
    connectedAt: null,
    setupMessage: null,
  });
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(true);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(null);
  const [googleCalendarSuccess, setGoogleCalendarSuccess] = useState<string | null>(null);
  const [disconnectingGoogleCalendar, setDisconnectingGoogleCalendar] = useState(false);

  useEffect(() => {
    if (!user?.id || usuarios.length === 0) return;
    const currentUsuario = usuarios.find((u) => u.auth_id === user.id);
    if (!currentUsuario) return;
    getDestinoAsignado(currentUsuario.id).then((destino) => {
      setDestinoAsignadoId(destino ?? "");
    });
  }, [user?.id, usuarios]);

  const loadGoogleCalendarStatus = useCallback(async () => {
    if (!user?.id) {
      setGoogleCalendarStatus({
        available: false,
        oauthConfigured: false,
        storageReady: false,
        connected: false,
        googleEmail: null,
        connectedAt: null,
        setupMessage: null,
      });
      setGoogleCalendarLoading(false);
      return;
    }

    setGoogleCalendarLoading(true);
    setGoogleCalendarError(null);
    setGoogleCalendarSuccess(null);

    try {
      const response = await fetch("/api/google-calendar/status", {
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as
        | GoogleCalendarStatus
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : "No se pudo consultar el estado de Google Calendar.",
        );
      }

      setGoogleCalendarStatus({
        available: Boolean(json && "available" in json && json.available),
        oauthConfigured: Boolean(json && "oauthConfigured" in json && json.oauthConfigured),
        storageReady: Boolean(json && "storageReady" in json && json.storageReady),
        connected: Boolean(json && "connected" in json && json.connected),
        googleEmail: json && "googleEmail" in json ? json.googleEmail : null,
        connectedAt: json && "connectedAt" in json ? json.connectedAt : null,
        setupMessage: json && "setupMessage" in json ? json.setupMessage : null,
      });
    } catch (error) {
      setGoogleCalendarError(getErrorMessage(error, "No se pudo consultar Google Calendar."));
    } finally {
      setGoogleCalendarLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (modalAbierto && !nuevoUsuarioId && destinoAsignadoId) {
      setNuevoUsuarioId(destinoAsignadoId);
    }
  }, [destinoAsignadoId, modalAbierto, nuevoUsuarioId]);

  useEffect(() => {
    void loadGoogleCalendarStatus();
  }, [loadGoogleCalendarStatus]);

  const userColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    usuarios.forEach((usuario, index) => {
      map[usuario.id] = USER_COLOR_PALETTE[index % USER_COLOR_PALETTE.length];
    });
    return map;
  }, [usuarios]);

  const getEventoStyle = (usuarioId?: string) => {
    const color = userColorMap[usuarioId ?? ""] ?? DEFAULT_EVENT_COLOR;
    return {
      borderColor: color,
      backgroundColor: withAlpha(color, "20"),
    };
  };

  const usuarioColorChips = useMemo(() => {
    return [
      {
        id: "global",
        label: "Global (Todos)",
        color: DEFAULT_EVENT_COLOR,
      },
      ...usuarios.map((usuario) => ({
        id: usuario.id,
        label: usuario.nombre,
        color: userColorMap[usuario.id] ?? DEFAULT_EVENT_COLOR,
      })),
    ];
  }, [usuarios, userColorMap]);

  useEffect(() => {
    let nuevoViewDate: Date;
    if (viewType === "week") {
      nuevoViewDate = startOfWeek(diaSeleccionadoDate);
    } else if (viewType === "day") {
      nuevoViewDate = diaSeleccionadoDate;
    } else {
      nuevoViewDate = startOfMonth(diaSeleccionadoDate);
    }
    setViewDate((prev) => (prev.getTime() === nuevoViewDate.getTime() ? prev : nuevoViewDate));
  }, [viewType, diaSeleccionadoDate]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileScreen(event.matches);
    };
    setIsMobileScreen(mediaQuery.matches);
    mediaQuery.addEventListener?.("change", handleChange);
    mediaQuery.addListener?.(handleChange);
    return () => {
      mediaQuery.removeEventListener?.("change", handleChange);
      mediaQuery.removeListener?.(handleChange);
    };
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [usuariosData, procesosData, eventosData, progresosData, asignacionesResult] = await Promise.all([
          getUsuarios(),
          getProcesos(),
          getEventos(),
          getProgresos(),
          supabase
            .from("asignaciones_usuario")
            .select("usuario_destino_id")
            .eq("activo", true),
        ] as const);
        const destinoIds = new Set(
          (asignacionesResult.data ?? []).map((a) => a.usuario_destino_id)
        );
        const usuariosFiltrados = destinoIds.size > 0
          ? (usuariosData || []).filter((u) => destinoIds.has((u as unknown as Usuario).id))
          : (usuariosData || []);
        setUsuarios(usuariosFiltrados as unknown as Usuario[]);
        setProcesos((procesosData || []) as unknown as Proceso[]);
        setProgresos((progresosData || []) as unknown as Progreso[]);

        const eventosConvertidos: EventoCalendario[] = ((eventosData || []) as unknown as Evento[]).map(
          toEventoCalendario,
        );
        setEventos(eventosConvertidos);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setCargandoUsuarios(false);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    const procesoIds = procesos.map((p) => p.id).filter(Boolean);
    if (procesoIds.length === 0) {
      setApoderadosRegistradosByProcesoId({});
      return;
    }

    let canceled = false;
    (async () => {
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

        const registered = new Set<string>();
        (deudores ?? []).forEach((row) => {
          if (row.proceso_id && row.apoderado_id) registered.add(row.proceso_id);
        });
        (acreedores ?? []).forEach((row) => {
          if (row.proceso_id && row.apoderado_id) registered.add(row.proceso_id);
        });

        const next: Record<string, boolean> = {};
        procesoIds.forEach((id) => {
          next[id] = registered.has(id);
        });

        if (!canceled) {
          setApoderadosRegistradosByProcesoId(next);
        }
      } catch (error) {
        console.error("Error loading apoderados registrados por proceso:", error);
        if (!canceled) {
          setApoderadosRegistradosByProcesoId({});
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [procesos]);

  const vistaTexto = viewType === "week" ? "semanal" : viewType === "day" ? "diaria" : "mensual";
  const etiquetaPeriodo = useMemo(() => {
    if (viewType === "week") {
      const semanaprocesos = startOfWeek(viewDate);
      const semanaFin = endOfWeek(viewDate);
      const resumenSemana = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
      return `Semana del ${resumenSemana.format(semanaprocesos)} al ${resumenSemana.format(semanaFin)}`;
    }
    if (viewType === "day") {
      const labelDia = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
      return labelDia.format(new Date(diaSeleccionadoISO));
    }
    return `${MESES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
  }, [viewType, viewDate, diaSeleccionadoISO]);

  const diasDelMes = useMemo(() => {
    const first = startOfMonth(viewDate);
    const last = endOfMonth(viewDate);
    const firstWeekday = (first.getDay() + 6) % 7;
    const days: { date: Date; iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < firstWeekday; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() - (firstWeekday - i));
      days.push({ date: d, iso: toISODate(d), inMonth: false });
    }
    for (let day = 1; day <= last.getDate(); day++) {
      const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      days.push({ date: d, iso: toISODate(d), inMonth: true });
    }
    while (days.length % 7 !== 0) {
      const d = new Date(last);
      d.setDate(last.getDate() + (days.length % 7));
      days.push({ date: d, iso: toISODate(d), inMonth: false });
    }
    return days;
  }, [viewDate]);

  const semanaDias = useMemo(() => {
    const procesosSemana = startOfWeek(viewDate);
    return Array.from({ length: 7 }).map((_, index) => {
      const fecha = addDays(procesosSemana, index);
      return {
        date: fecha,
        iso: toISODate(fecha),
        inMonth: fecha.getMonth() === viewDate.getMonth(),
      };
    });
  }, [viewDate]);

  const displayWeekDays = useMemo(() => {
    if (!isMobileScreen) return semanaDias;
    const maxVisible = Math.min(semanaDias.length, MAX_MOBILE_WEEK_DAYS);
    const selectedIndex = semanaDias.findIndex((day) => day.iso === diaSeleccionadoISO);
    const normalizedIndex = selectedIndex === -1 ? 0 : selectedIndex;
    const windowStart = Math.max(0, Math.min(normalizedIndex - 2, semanaDias.length - maxVisible));
    return semanaDias.slice(windowStart, windowStart + maxVisible);
  }, [isMobileScreen, semanaDias, diaSeleccionadoISO]);

  const weekGridStyle = useMemo(() => {
    const columns = Math.max(displayWeekDays.length, 1);
    return { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
  }, [displayWeekDays.length]);

  const eventosFiltrados = useMemo(() => {
    if (usuarioFiltro === "global") return eventos;
    return eventos.filter((ev) => ev.usuarioId === usuarioFiltro);
  }, [eventos, usuarioFiltro]);

  const rangoVista = useMemo(() => {
    if (viewType === "day") {
      return { from: diaSeleccionadoISO, to: diaSeleccionadoISO };
    }
    if (viewType === "week") {
      return {
        from: toISODate(startOfWeek(viewDate)),
        to: toISODate(endOfWeek(viewDate)),
      };
    }
    return {
      from: toISODate(startOfMonth(viewDate)),
      to: toISODate(endOfMonth(viewDate)),
    };
  }, [viewType, viewDate, diaSeleccionadoISO]);

  const eventosEnVista = useMemo(
    () =>
      eventosFiltrados.filter(
        (evento) => evento.fechaISO >= rangoVista.from && evento.fechaISO <= rangoVista.to,
      ),
    [eventosFiltrados, rangoVista],
  );

  const eventosPorDia = useMemo(() => {
    const map: Record<string, EventoCalendario[]> = {};
    for (const ev of eventosFiltrados) {
      map[ev.fechaISO] = map[ev.fechaISO] || [];
      map[ev.fechaISO].push(ev);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.hora || "").localeCompare(b.hora || "") || a.titulo.localeCompare(b.titulo));
    }
    return map;
  }, [eventosFiltrados]);

  const eventosDelDia = eventosPorDia[diaSeleccionadoISO] || [];
  const searchParams = useSearchParams();
  const router = useRouter();
  const procesoIdDesdeQuery = searchParams.get("procesoId");
  const fechaDesdeQuery = searchParams.get("fecha");
  const googleCalendarResult = searchParams.get("googleCalendar");
  const googleCalendarMessage = searchParams.get("googleCalendarMessage");
  const hoyISO = toISODate(hoy);

  function handleConnectGoogleCalendar() {
    window.location.href = "/api/google-calendar/connect?next=/calendario";
  }

  async function handleDisconnectGoogleCalendar() {
    setDisconnectingGoogleCalendar(true);
    setGoogleCalendarError(null);
    setGoogleCalendarSuccess(null);

    try {
      const response = await fetch("/api/google-calendar/disconnect", {
        method: "POST",
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo desconectar Google Calendar.");
      }

      await loadGoogleCalendarStatus();
      setGoogleCalendarSuccess("Google Calendar desconectado.");
    } catch (error) {
      setGoogleCalendarError(getErrorMessage(error, "No se pudo desconectar Google Calendar."));
    } finally {
      setDisconnectingGoogleCalendar(false);
    }
  }

  function cambiarPeriodo(direccion: number) {
    if (viewType === "week") {
      const stepDays = isMobileScreen ? MAX_MOBILE_WEEK_DAYS : 7;
      const nuevaSeleccion = addDays(new Date(diaSeleccionadoISO), direccion * stepDays);
      setDiaSeleccionadoISO(toISODate(nuevaSeleccion));
      setViewDate(startOfWeek(nuevaSeleccion));
      return;
    }

    if (viewType === "day") {
      const siguiente = addDays(viewDate, direccion);
      setViewDate(siguiente);
      setDiaSeleccionadoISO(toISODate(siguiente));
      return;
    }

    const siguiente = addMonths(viewDate, direccion);
    setViewDate(siguiente);
    const diaPrevio = new Date(diaSeleccionadoISO);
    const diasMes = endOfMonth(siguiente).getDate();
    const diaDeseado = Math.min(diaPrevio.getDate(), diasMes);
    const nuevaSeleccion = new Date(siguiente.getFullYear(), siguiente.getMonth(), diaDeseado);
    setDiaSeleccionadoISO(toISODate(nuevaSeleccion));
  }

  function irPeriodoAnterior() {
    cambiarPeriodo(-1);
  }

  function irPeriodoSiguiente() {
    cambiarPeriodo(1);
  }

  function irHoy() {
    const fechaActual = new Date();
    setDiaSeleccionadoISO(toISODate(fechaActual));
    if (viewType === "week") {
      setViewDate(startOfWeek(fechaActual));
    } else if (viewType === "day") {
      setViewDate(fechaActual);
    } else {
      setViewDate(startOfMonth(fechaActual));
    }
  }

  const prepararModalAgregar = useCallback((diaISO: string, procesoId?: string) => {
    setDiaSeleccionadoISO(diaISO);
    setNuevoTitulo("");
    setNuevaFecha(diaISO);
    setNuevaHora("09:00");
    setNuevoUsuarioId(destinoAsignadoId);
    setNuevoProcesoId(procesoId ?? "");
    setTituloEditable(false);
    setModalAbierto(true);
  }, [destinoAsignadoId]);

  function abrirModalAgregar(diaISO: string) {
    prepararModalAgregar(diaISO);
  }

  async function buildProcesoEventoTitle(procesoId: string): Promise<string> {
    const [deudoresProceso, eventosProceso] = await Promise.all([
      getDeudoresByProceso(procesoId).catch((error) => {
        console.error("Error loading deudores for calendar title:", error);
        return [];
      }),
      getEventosByProceso(procesoId).catch((error) => {
        console.error("Error loading eventos for calendar title:", error);
        return null;
      }),
    ]);

    const deudorPrincipal = deudoresProceso.find((deudor) => (deudor.nombre ?? "").trim().length > 0);
    const deudorNombre = normalizeLabel(deudorPrincipal?.nombre, "SIN DEUDOR");

    let apoderadoNombre = "";
    if (deudorPrincipal?.apoderado_id) {
      try {
        const apoderado = await getApoderadoById(deudorPrincipal.apoderado_id);
        apoderadoNombre = apoderado?.nombre ?? "";
      } catch (error) {
        console.error("Error loading deudor apoderado for calendar title:", error);
      }
    }

    if (!apoderadoNombre) {
      try {
        const apoderadosProceso = await getApoderadosByProceso(procesoId);
        apoderadoNombre =
          apoderadosProceso.find((apoderado) => (apoderado.nombre ?? "").trim().length > 0)?.nombre ?? "";
      } catch (error) {
        console.error("Error loading proceso apoderado for calendar title:", error);
      }
    }

    const apoderadoAcronimo = buildAcronimo(apoderadoNombre);
    const eventosExistentes = Array.isArray(eventosProceso)
      ? eventosProceso.length
      : eventos.filter((ev) => ev.procesoId === procesoId).length;
    const numeroEvento = eventosExistentes + 1;

    return `AUD INSOLVENCIA ${deudorNombre}- ${apoderadoAcronimo}-${numeroEvento}`;
  }

  async function agregarEvento() {
    const tituloManual = nuevoTitulo.trim();
    const procesoId = nuevoProcesoId.trim();
    const shouldAutoNameByProceso = Boolean(procesoId);
    const horaNormalizada = normalizeHoraHHMM(nuevaHora);
    if (!nuevaFecha || guardando) return;
    if (!shouldAutoNameByProceso && !tituloManual) return;
    if (!horaNormalizada || !isWithinBusinessHours(horaNormalizada)) {
      alert("La hora debe estar entre 08:00 y 17:00.");
      return;
    }

    setGuardando(true);
    try {
      if (nuevoUsuarioId) {
        const conflict = await hasUserTimeConflict({
          userId: nuevoUsuarioId,
          fechaISO: nuevaFecha,
          horaHHMM: horaNormalizada,
        });
        if (conflict) {
          alert("Ese usuario ya tiene un evento en esa fecha y hora. Cambia la hora o asigna otro usuario.");
          return;
        }
      }

      const titulo = shouldAutoNameByProceso
        ? await buildProcesoEventoTitle(procesoId)
        : tituloManual;

      const [horaH, horaM] = horaNormalizada.split(":").map(Number);
      const totalMinFin = horaH * 60 + horaM + nuevaDuracion;
      const horaFin = minutesToHHMM(totalMinFin);

      const nuevoEvento = await createEvento({
        titulo,
        descripcion: null,
        fecha: nuevaFecha,
        hora: `${horaNormalizada}:00`,
        fecha_fin: null,
        hora_fin: `${horaFin}:00`,
        usuario_id: nuevoUsuarioId || null,
        proceso_id: procesoId || null,
        tipo: 'general',
        color: null,
        recordatorio: false,
        completado: false,
      });

      const eventoCalendario = toEventoCalendario(nuevoEvento);
      setEventos((prev) => [...prev, eventoCalendario]);
      setModalAbierto(false);
      notifyGoogleSyncIssue(eventoCalendario);
    } catch (error) {
      console.error("Error creating evento:", error);
      alert("Error al guardar el evento. Por favor intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  function getNombreUsuario(usuarioId: string | undefined): string | null {
    if (!usuarioId) return null;
    const usuario = usuarios.find((u) => u.id === usuarioId);
    return usuario ? usuario.nombre : null;
  }

  function getNumeroProceso(procesoId: string | undefined): string | null {
    if (!procesoId) return null;
    const proceso = procesos.find((p) => p.id === procesoId);
    return proceso ? proceso.numero_proceso : null;
  }

  function getProgresoEstado(procesoId: string | undefined): Progreso['estado'] | null {
    if (!procesoId) return null;
    const progreso = progresos.find((p) => p.proceso_id === procesoId);
    return progreso ? progreso.estado : null;
  }

  function tieneApoderadosRegistrados(procesoId: string | undefined): boolean {
    if (!procesoId) return false;
    return Boolean(apoderadosRegistradosByProcesoId[procesoId]);
  }

  function getProgresoActionUrl(
    procesoId: string | undefined,
    eventoId?: string | undefined
  ): ProgresoAction | null {
    if (!procesoId) return null;
    const estado = getProgresoEstado(procesoId);
    const qs = new URLSearchParams({ procesoId });
    if (eventoId) qs.set("eventoId", eventoId);
    const listaUrl = `/lista?${qs.toString()}`;

    // No iniciado keeps "Iniciar" label but now uses the same /lista flow.
    if (!estado || estado === 'no_iniciado') {
      return { url: listaUrl, label: "Iniciar", requiereIniciar: true };
    }
    if (estado === 'iniciado') {
      return { url: listaUrl, label: "Tomar asistencia", requiereIniciar: false };
    }
    // estado === 'finalizado' - no action needed
    return null;
  }

  async function iniciarProcesoYIrLista(procesoId: string | undefined, url: string) {
    if (!procesoId || iniciandoProcesoById[procesoId]) return;

    setIniciandoProcesoById((prev) => ({ ...prev, [procesoId]: true }));
    setIniciarProcesoErrorById((prev) => ({ ...prev, [procesoId]: "" }));

    try {
      const updated = await updateProgresoByProcesoId(procesoId, { estado: "iniciado" });
      setProgresos((prev) => {
        const index = prev.findIndex((item) => item.proceso_id === procesoId);
        if (index === -1) return [...prev, updated];
        const next = [...prev];
        next[index] = updated;
        return next;
      });
      router.push(url);
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo iniciar el proceso.");
      setIniciarProcesoErrorById((prev) => ({ ...prev, [procesoId]: message }));
    } finally {
      setIniciandoProcesoById((prev) => ({ ...prev, [procesoId]: false }));
    }
  }

  function getAutoAdmisorioState(procesoId: string | undefined): AutoAdmisorioState | null {
    if (!procesoId) return null;
    return (
      autoAdmisorioStateByProcesoId[procesoId] ?? {
        loading: false,
        error: null,
        result: null,
        emailSending: false,
        emailResult: null,
        emailError: null,
        adjuntosExtra: [],
      }
    );
  }

  async function crearAutoAdmisorioDesdeCalendario(procesoId: string | undefined) {
    if (!procesoId) return;

    setAutoAdmisorioStateByProcesoId((prev) => ({
      ...prev,
      [procesoId]: {
        loading: true,
        error: null,
        result: prev[procesoId]?.result ?? null,
        emailSending: false,
        emailResult: prev[procesoId]?.emailResult ?? null,
        emailError: null,
        adjuntosExtra: prev[procesoId]?.adjuntosExtra ?? [],
      },
    }));

    try {
      const res = await fetch("/api/crear-auto-admisorio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procesoId, authUserId: user?.id }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            fileId: string;
            fileName: string;
            webViewLink: string | null;
            apoderadoEmails?: string[];
            error?: string;
            detail?: string;
          }
        | null;

      if (!res.ok || !json?.fileId) {
        throw new Error(json?.detail || json?.error || "No se pudo crear el auto admisorio.");
      }

      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [procesoId]: {
          loading: false,
          error: null,
          result: {
            fileId: json.fileId,
            fileName: json.fileName,
            webViewLink: json.webViewLink ?? null,
            apoderadoEmails: json.apoderadoEmails,
          },
          emailSending: false,
          emailResult: null,
          emailError: null,
          adjuntosExtra: prev[procesoId]?.adjuntosExtra ?? [],
        },
      }));
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo crear el auto admisorio.");
      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [procesoId]: {
          loading: false,
          error: message,
          result: prev[procesoId]?.result ?? null,
          emailSending: prev[procesoId]?.emailSending ?? false,
          emailResult: prev[procesoId]?.emailResult ?? null,
          emailError: prev[procesoId]?.emailError ?? null,
          adjuntosExtra: prev[procesoId]?.adjuntosExtra ?? [],
        },
      }));
    }
  }

  function handleAgregarAdjuntosCalendario(procesoId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        setAutoAdmisorioStateByProcesoId((prev) => {
          const current = prev[procesoId];
          if (!current) return prev;
          return { ...prev, [procesoId]: { ...current, adjuntosExtra: [...(current.adjuntosExtra ?? []), { name: file.name, content: base64, contentType: file.type || "application/octet-stream" }] } };
        });
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  function handleQuitarAdjuntoCalendario(procesoId: string, index: number) {
    setAutoAdmisorioStateByProcesoId((prev) => {
      const current = prev[procesoId];
      if (!current) return prev;
      return { ...prev, [procesoId]: { ...current, adjuntosExtra: (current.adjuntosExtra ?? []).filter((_, i) => i !== index) } };
    });
  }

  async function enviarAutoAdmisorioApoderadosDesdeCalendario(procesoId: string | undefined) {
    if (!procesoId) return;
    const state = autoAdmisorioStateByProcesoId[procesoId];
    if (!state?.result?.webViewLink || state.emailSending) return;

    const emails = state.result.apoderadoEmails ?? [];
    if (emails.length === 0) {
      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [procesoId]: {
          ...prev[procesoId],
          emailError: "No hay apoderados con correo registrado.",
          emailResult: null,
        },
      }));
      return;
    }

    setAutoAdmisorioStateByProcesoId((prev) => ({
      ...prev,
      [procesoId]: {
        ...prev[procesoId],
        emailSending: true,
        emailError: null,
        emailResult: null,
      },
    }));

    try {
      const res = await fetch("/api/enviar-acta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apoderadoEmails: emails,
          numeroProceso: getNumeroProceso(procesoId) || procesoId,
          titulo: "Auto de Admision",
          fecha: new Date().toISOString().slice(0, 10),
          webViewLink: state.result.webViewLink,
          fileId: state.result.fileId,
          fileName: state.result.fileName,
          extraAttachments: (state.adjuntosExtra ?? []).map((a) => ({ filename: a.name, content: a.content, contentType: a.contentType })),
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { emailsSent: number; emailErrors?: string[]; error?: string; detail?: string }
        | null;

      if (!res.ok) {
        throw new Error(json?.detail || json?.error || "No se pudieron enviar los correos.");
      }

      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [procesoId]: {
          ...prev[procesoId],
          emailSending: false,
          emailError: null,
          emailResult: { sent: json?.emailsSent ?? 0, errors: json?.emailErrors },
        },
      }));
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo enviar el auto admisorio por correo.");
      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [procesoId]: {
          ...prev[procesoId],
          emailSending: false,
          emailError: message,
        },
      }));
    }
  }

  function abrirDetalleEvento(evento: EventoCalendario) {
    setEventoSeleccionado(evento);
    setHoraDetalleEditable(normalizeHoraHHMM(evento.hora) ?? "09:00");
  }

  function cerrarDetalleEvento() {
    setEventoSeleccionado(null);
    setHoraDetalleEditable("09:00");
    setGuardandoHoraDetalle(false);
    setSincronizandoGoogleDetalle(false);
  }

  async function guardarHoraEventoSeleccionado() {
    if (!eventoSeleccionado || guardandoHoraDetalle) return;
    const horaNormalizada = normalizeHoraHHMM(horaDetalleEditable);
    if (!horaNormalizada || !isWithinBusinessHours(horaNormalizada)) {
      alert("La hora debe estar entre 08:00 y 17:00.");
      return;
    }

    setGuardandoHoraDetalle(true);
    try {
      if (eventoSeleccionado.usuarioId) {
        const conflict = await hasUserTimeConflict({
          userId: eventoSeleccionado.usuarioId,
          fechaISO: eventoSeleccionado.fechaISO,
          horaHHMM: horaNormalizada,
          excludeEventoId: eventoSeleccionado.id,
        });
        if (conflict) {
          alert("Ese usuario ya tiene un evento en esa fecha y hora. Cambia la hora o asigna otro usuario.");
          return;
        }
      }

      const updated = await updateEventoApi(eventoSeleccionado.id, {
        hora: `${horaNormalizada}:00`,
      });

      const eventoActualizado = toEventoCalendario(updated);
      const horaActualizada = normalizeHoraHHMM(eventoActualizado.hora) ?? horaNormalizada;
      eventoActualizado.hora = horaActualizada;

      setEventos((prev) => prev.map((ev) => (ev.id === updated.id ? eventoActualizado : ev)));
      setEventoSeleccionado(eventoActualizado);
      setHoraDetalleEditable(horaActualizada);
      notifyGoogleSyncIssue(eventoActualizado);
    } catch (error) {
      console.error("Error updating evento hour:", error);
      alert("No se pudo actualizar la hora del evento.");
    } finally {
      setGuardandoHoraDetalle(false);
    }
  }

  async function eliminarEvento(id: string) {
    try {
      await deleteEventoApi(id);
      setEventos((prev) => prev.filter((e) => e.id !== id));
    } catch (error) {
      console.error("Error deleting evento:", error);
      alert("Error al eliminar el evento. Por favor intenta de nuevo.");
    }
  }

  async function resincronizarEventoSeleccionadoConGoogle() {
    if (!eventoSeleccionado || sincronizandoGoogleDetalle) return;

    setSincronizandoGoogleDetalle(true);
    try {
      const updated = await retryEventoGoogleSync(eventoSeleccionado.id);
      const eventoActualizado = toEventoCalendario(updated);
      setEventos((prev) => prev.map((ev) => (ev.id === updated.id ? eventoActualizado : ev)));
      setEventoSeleccionado(eventoActualizado);

      if (eventoActualizado.googleSyncStatus === "synced") {
        if (eventoActualizado.googleSyncError) {
          alert(`Evento sincronizado en Google Calendar, pero con advertencia: ${eventoActualizado.googleSyncError}`);
        } else {
          alert("Evento sincronizado correctamente con Google Calendar.");
        }
      } else if (eventoActualizado.googleSyncStatus === "error" && eventoActualizado.googleSyncError) {
        alert(`La resincronizacion con Google fallo: ${eventoActualizado.googleSyncError}`);
      } else if (eventoActualizado.googleSyncStatus === "disabled" && eventoActualizado.googleSyncError) {
        alert(`Google Calendar sigue deshabilitado. ${eventoActualizado.googleSyncError}`);
      }
    } catch (error) {
      console.error("Error retrying Google sync:", error);
      alert("No se pudo resincronizar el evento con Google.");
    } finally {
      setSincronizandoGoogleDetalle(false);
    }
  }

  useEffect(() => {
    if (!procesoIdDesdeQuery) return;
    const targetDate = fechaDesdeQuery || hoyISO;
    prepararModalAgregar(targetDate, procesoIdDesdeQuery);
    router.replace("/calendario");
  }, [procesoIdDesdeQuery, fechaDesdeQuery, hoyISO, prepararModalAgregar, router]);

  const totalEventosVista = eventosEnVista.length;
  const eventosHoy = eventosPorDia[hoyISO]?.length ?? 0;
  const procesosConEvento = new Set(
    eventosEnVista
      .map((evento) => evento.procesoId)
      .filter((procesoId): procesoId is string => Boolean(procesoId)),
  ).size;
  const filtroActivoLabel =
    usuarioColorChips.find((chip) => chip.id === usuarioFiltro)?.label ?? "Global (Todos)";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(226,232,240,0.65),transparent_55%),linear-gradient(to_bottom,#fafafa,#f4f4f5)] text-zinc-950 dark:bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.45),transparent_50%),linear-gradient(to_bottom,#000,#09090b)] dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-56 bg-gradient-to-b from-white/80 to-transparent dark:from-zinc-900/70" />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <header className="mb-8 space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Calendario
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Calendario</h1>
              <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
                Vista {vistaTexto} + eventos por día. Clic en un día para seleccionar, doble clic para agregar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-2">
                {VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setViewType(option.id)}
                    className={[
                      "h-9 rounded-2xl border px-4 text-xs font-semibold transition",
                      viewType === option.id
                        ? "border-zinc-950 bg-zinc-950 text-white shadow-sm dark:border-white/20 dark:bg-white dark:text-black"
                        : "border-zinc-200 bg-white text-zinc-600 shadow-sm hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <select
                  value={usuarioFiltro}
                  onChange={(e) => setUsuarioFiltro(e.target.value)}
                  disabled={cargandoUsuarios}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 sm:w-auto sm:min-w-[180px] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 dark:text-zinc-200 outline-none cursor-pointer"
                >
                  <option value="global">Global (Todos)</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-300">
                  {usuarioColorChips.map((chip) => (
                    <span
                      key={chip.id}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
                      style={{
                        borderColor: chip.color,
                        backgroundColor: withAlpha(chip.color, "10"),
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: chip.color }}
                      />
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <button onClick={irPeriodoAnterior} className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">←</button>
                <div className="w-full rounded-2xl border border-zinc-200 bg-white/70 px-4 py-2 text-left text-sm font-medium shadow-sm backdrop-blur sm:w-auto sm:min-w-[220px] sm:text-center dark:border-white/10 dark:bg-white/5">{etiquetaPeriodo}</div>
                <button onClick={irPeriodoSiguiente} className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">→</button>
              </div>
              <button onClick={irHoy} className="h-11 rounded-2xl bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black">Hoy</button>
            </div>
          </div>
          <div className="rounded-3xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                  Resumen de agenda
                </p>
                <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {etiquetaPeriodo}
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Filtro activo: {filtroActivoLabel}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <CalendarStatChip label="Eventos vista" value={totalEventosVista} tone="neutral" />
                <CalendarStatChip label="Eventos hoy" value={eventosHoy} tone="positive" />
                <CalendarStatChip label="Procesos vista" value={procesosConEvento} tone="neutral" />
                <CalendarStatChip label="Dia seleccionado" value={diaSeleccionadoISO} tone="neutral" />
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
                  Google Calendar y Meet
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Conecta tu Gmail desde aqui para que los eventos del calendario puedan crear enlaces de Google Meet.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    Estado:{" "}
                    {googleCalendarLoading
                      ? "Consultando..."
                      : googleCalendarStatus.connected
                        ? `Conectado como ${googleCalendarStatus.googleEmail ?? "sin correo"}`
                        : googleCalendarStatus.available
                          ? "No conectado"
                          : googleCalendarStatus.oauthConfigured && !googleCalendarStatus.storageReady
                            ? "Migracion pendiente en Supabase"
                            : "OAuth no configurado en el servidor"}
                  </span>
                  {formatGoogleSyncTimestamp(googleCalendarStatus.connectedAt ?? undefined) && (
                    <span>
                      Ultima conexion: {formatGoogleSyncTimestamp(googleCalendarStatus.connectedAt ?? undefined)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleConnectGoogleCalendar}
                  disabled={!googleCalendarStatus.available}
                  className="h-11 rounded-2xl bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  {googleCalendarStatus.connected
                    ? "Conectar otro Gmail con Google"
                    : "Conectar Gmail con Google"}
                </button>
                {googleCalendarStatus.connected && (
                  <button
                    type="button"
                    onClick={() => void handleDisconnectGoogleCalendar()}
                    disabled={disconnectingGoogleCalendar}
                    className="h-11 rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                  >
                    {disconnectingGoogleCalendar ? "Desconectando..." : "Desconectar Google"}
                  </button>
                )}
              </div>
            </div>

            {googleCalendarError && (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {googleCalendarError}
              </div>
            )}

            {!googleCalendarError && googleCalendarStatus.setupMessage && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                {googleCalendarStatus.setupMessage}
              </div>
            )}

            {googleCalendarResult === "connected" && (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                Google Calendar conectado correctamente.
              </div>
            )}

            {googleCalendarSuccess && (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {googleCalendarSuccess}
              </div>
            )}

            {googleCalendarResult === "error" && (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {googleCalendarMessage || "No se pudo completar la conexion con Google Calendar."}
              </div>
            )}
          </div>
        </header>

        <nav className="mb-8 flex flex-wrap items-center gap-2">
          <Link href="/procesos" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">Procesos</Link>
          <a href="#calendar-grid" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">Calendario</a>
          <a href="#day-agenda" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">Agenda dia</a>
        </nav>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section id="calendar-grid" className="scroll-mt-24 lg:col-span-2 rounded-[30px] border border-zinc-200/90 bg-white/85 p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
            {viewType === "month" && (
              <>
                <div className="overflow-x-auto pb-1">
                  <div className="min-w-[640px]">
                    <div className="grid grid-cols-7 gap-2 pb-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {DIAS_SEMANA.map((d) => (<div key={d} className="px-2">{d}</div>))}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {diasDelMes.map((day) => {
                        const selected = day.iso === diaSeleccionadoISO;
                        const inMonth = day.inMonth;
                        const dayEvents = eventosPorDia[day.iso] || [];
                        return (
                          <button
                            key={day.iso}
                            type="button"
                            onClick={() => setDiaSeleccionadoISO(day.iso)}
                            onDoubleClick={() => abrirModalAgregar(day.iso)}
                            className={[
                              "group relative flex h-24 flex-col rounded-2xl border p-2 text-left transition",
                              inMonth ? "border-zinc-200 bg-white/60 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10" : "border-zinc-200/60 bg-zinc-50/40 text-zinc-400 hover:bg-zinc-100 dark:border-white/5 dark:bg-white/5 dark:text-zinc-500",
                              selected ? "ring-4 ring-zinc-950/10 dark:ring-white/10" : "",
                            ].join(" ")}
                          >
                            <div className="flex items-center justify-between">
                              <div className={["inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium", day.iso === hoyISO ? "bg-zinc-950 text-white dark:bg-white dark:text-black" : "bg-transparent"].join(" ")}>{day.date.getDate()}</div>
                              <span onClick={(e) => { e.stopPropagation(); abrirModalAgregar(day.iso); }} className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-base font-medium text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-950 hover:text-white dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white dark:hover:text-black cursor-pointer">+</span>
                            </div>
                            <div className="mt-2 flex flex-1 flex-col gap-1 overflow-hidden">
                              {dayEvents.slice(0, 2).map((ev) => {
                                const eventStyle = getEventoStyle(ev.usuarioId);
                                return (
                                  <div
                                    key={ev.id}
                                    onClick={(e) => { e.stopPropagation(); abrirDetalleEvento(ev); }}
                                    className="truncate rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 shadow-sm cursor-pointer transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/20"
                                    style={eventStyle}
                                    title={ev.titulo}
                                  >
                                    {ev.hora ? `${ev.hora} · ` : ""}{ev.titulo}
                                  </div>
                                );
                              })}
                              {dayEvents.length > 2 && <div className="text-[11px] text-zinc-500 dark:text-zinc-400">+{dayEvents.length - 2} más</div>}
                            </div>
                            {dayEvents.length > 0 && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-full bg-zinc-950/70 dark:bg-white/70" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Tip: doble clic en un día para crear un evento rápido.</p>
              </>
            )}
            {viewType === "week" && (
              <>
                <div className="overflow-x-auto pb-1">
                  <div className="min-w-[680px]">
                    <div
                      className="grid gap-2 pb-3 text-xs font-medium text-zinc-500 dark:text-zinc-400"
                      style={weekGridStyle}
                    >
                      {displayWeekDays.map((day) => (
                        <div key={day.iso} className="text-center">
                          <p className="uppercase tracking-wide">
                            {day.date.toLocaleDateString("es-ES", { weekday: "short" })}
                          </p>
                          <p className="text-sm font-semibold">{day.date.getDate()}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-3" style={weekGridStyle}>
                      {displayWeekDays.map((day) => {
                        const selected = day.iso === diaSeleccionadoISO;
                        const dayEvents = eventosPorDia[day.iso] || [];
                        return (
                          <button
                            key={day.iso}
                            type="button"
                            onClick={() => setDiaSeleccionadoISO(day.iso)}
                            onDoubleClick={() => abrirModalAgregar(day.iso)}
                            className={[
                              "group relative flex min-h-[170px] flex-col rounded-2xl border p-3 text-left transition",
                              day.inMonth ? "border-zinc-200 bg-white/60 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10" : "border-zinc-200/60 bg-zinc-50/40 text-zinc-400 hover:bg-zinc-100 dark:border-white/5 dark:bg-white/5 dark:text-zinc-500",
                              selected ? "ring-4 ring-zinc-950/10 dark:ring-white/10" : "",
                            ].join(" ")}
                          >
                            <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                              <span className={["text-sm font-semibold", day.iso === hoyISO ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-200"].join(" ")}>{day.date.getDate()}</span>
                              <span onClick={(e) => { e.stopPropagation(); abrirModalAgregar(day.iso); }} className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-base font-medium text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-950 hover:text-white dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white dark:hover:text-black cursor-pointer">+</span>
                            </div>
                            <div className="mt-3 flex flex-1 flex-col gap-2 overflow-hidden">
                            {dayEvents.length === 0 ? (
                                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Sin eventos</p>
                              ) : (
                                dayEvents.slice(0, 3).map((ev) => {
                                  const eventStyle = getEventoStyle(ev.usuarioId);
                                  return (
                                    <div
                                      key={ev.id}
                                      onClick={(e) => { e.stopPropagation(); abrirDetalleEvento(ev); }}
                                      className="truncate rounded-xl border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 shadow-sm cursor-pointer transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/20"
                                      style={eventStyle}
                                      title={ev.titulo}
                                    >
                                      {ev.hora ? `${ev.hora} · ` : ""}{ev.titulo}
                                    </div>
                                  );
                                })
                              )}
                              {dayEvents.length > 3 && <div className="text-[11px] text-zinc-500 dark:text-zinc-400">+{dayEvents.length - 3} más</div>}
                            </div>
                            {dayEvents.length > 0 && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-full bg-zinc-950/70 dark:bg-white/70" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Tip: doble clic o usa el botón para sumar eventos rápido.</p>
              </>
            )}
            {viewType === "day" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Agenda del día</p>
                    <h2 className="text-lg font-semibold">{diaSeleccionadoISO}</h2>
                  </div>
                  <button type="button" onClick={() => abrirModalAgregar(diaSeleccionadoISO)} className="h-11 rounded-2xl bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black">+ Evento</button>
                </div>
                <div className="mt-4 space-y-3">
                  {eventosDelDia.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-200 bg-white/60 p-6 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">No hay eventos para este día.</div>
                  ) : (
                    eventosDelDia.map((ev) => {
                      const action = getProgresoActionUrl(ev.procesoId, ev.id);
                      const iniciandoProceso = ev.procesoId ? Boolean(iniciandoProcesoById[ev.procesoId]) : false;
                      const iniciarProcesoError = ev.procesoId ? iniciarProcesoErrorById[ev.procesoId] : null;
                      const autoState = getAutoAdmisorioState(ev.procesoId);
                      const canCrearAutoAdmisorio =
                        getProgresoEstado(ev.procesoId) === "no_iniciado" &&
                        tieneApoderadosRegistrados(ev.procesoId);
                      const eventStyle = getEventoStyle(ev.usuarioId);
                      return (
                        <div key={ev.id} style={eventStyle} className="rounded-2xl border border-zinc-200 bg-white/60 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
                          <div className="grid items-start gap-3 sm:grid-cols-[90px_1fr]">
                            <div className="text-xs text-zinc-500">{ev.hora ?? "Sin hora"}</div>
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm font-semibold">{ev.titulo}</p>
                                <button type="button" onClick={() => eliminarEvento(ev.id)} className="text-xs text-zinc-500 transition hover:text-zinc-950 dark:hover:text-white">Eliminar</button>
                              </div>
                              <p className="text-xs text-zinc-500">
                                {getNombreUsuario(ev.usuarioId) && <span className="mr-2">· {getNombreUsuario(ev.usuarioId)}</span>}
                                {getNumeroProceso(ev.procesoId) && <span className="mr-2">· {getNumeroProceso(ev.procesoId)}</span>}
                              </p>
                            </div>
                          </div>
                          {(action || canCrearAutoAdmisorio) && (
                            <div className="mt-3 flex flex-col gap-2">
                              {action && (
                                action.requiereIniciar ? (
                                  <button
                                    type="button"
                                    onClick={() => void iniciarProcesoYIrLista(ev.procesoId, action.url)}
                                    disabled={iniciandoProceso}
                                    className="flex h-9 w-full items-center justify-center rounded-xl bg-zinc-950 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
                                  >
                                    {iniciandoProceso ? "Iniciando..." : action.label}
                                  </button>
                                ) : (
                                  <Link
                                    href={action.url}
                                    className="flex h-9 w-full items-center justify-center rounded-xl bg-zinc-950 text-xs font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
                                  >
                                    {action.label}
                                  </Link>
                                )
                              )}
                              {action?.requiereIniciar && iniciarProcesoError && (
                                <p className="text-[11px] text-red-600 dark:text-red-400">{iniciarProcesoError}</p>
                              )}
                              {canCrearAutoAdmisorio && ev.procesoId && (
                                <button
                                  type="button"
                                  onClick={() => void crearAutoAdmisorioDesdeCalendario(ev.procesoId)}
                                  disabled={autoState?.loading}
                                  className="flex h-9 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-900 shadow-sm transition hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:border-amber-700 dark:hover:bg-amber-950/60"
                                >
                                  {autoState?.loading ? "Creando..." : "Crear auto admisorio"}
                                </button>
                              )}
                              {canCrearAutoAdmisorio && autoState?.error && (
                                <p className="text-[11px] text-red-600 dark:text-red-400">{autoState.error}</p>
                              )}
                              {canCrearAutoAdmisorio && autoState?.result?.webViewLink && (
                                <a
                                  href={autoState.result.webViewLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
                                >
                                  Editar en Google Docs
                                </a>
                              )}
                              {canCrearAutoAdmisorio && autoState?.result && ev.procesoId && (
                                <>
                                  <input type="file" multiple id={`adj-cal1-${ev.procesoId}`} className="hidden" onChange={(e) => handleAgregarAdjuntosCalendario(ev.procesoId!, e)} />
                                  <div className="flex flex-wrap gap-1">
                                    <label htmlFor={`adj-cal1-${ev.procesoId}`} className="cursor-pointer flex h-7 items-center rounded-lg border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">+ Adjuntar</label>
                                    {(autoState.adjuntosExtra ?? []).map((adj, idx) => (
                                      <span key={idx} className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:border-white/10 dark:bg-white/5">
                                        <span className="max-w-[80px] truncate">{adj.name}</span>
                                        <button onClick={() => handleQuitarAdjuntoCalendario(ev.procesoId!, idx)} className="text-zinc-400 hover:text-red-500">×</button>
                                      </span>
                                    ))}
                                  </div>
                                </>
                              )}
                              {canCrearAutoAdmisorio &&
                                autoState?.result?.apoderadoEmails &&
                                autoState.result.apoderadoEmails.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => void enviarAutoAdmisorioApoderadosDesdeCalendario(ev.procesoId)}
                                    disabled={autoState.emailSending}
                                    className="flex h-9 w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-500 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/60"
                                  >
                                    {autoState.emailSending ? "Enviando..." : "Enviar a apoderados"}
                                  </button>
                                )}
                              {canCrearAutoAdmisorio &&
                                autoState?.result?.apoderadoEmails &&
                                autoState.result.apoderadoEmails.length === 0 && (
                                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                    No hay apoderados con correo registrado
                                  </p>
                                )}
                              {canCrearAutoAdmisorio && autoState?.emailError && (
                                <p className="text-[11px] text-red-600 dark:text-red-400">{autoState.emailError}</p>
                              )}
                              {canCrearAutoAdmisorio && autoState?.emailResult && (
                                <p className="text-[11px] text-green-600 dark:text-green-400">
                                  Correos enviados: {autoState.emailResult.sent}
                                  {autoState.emailResult.errors && autoState.emailResult.errors.length > 0 && (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      {" "}
                                      ({autoState.emailResult.errors.length} fallidos)
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>

          <aside id="day-agenda" className="scroll-mt-24 rounded-[30px] border border-zinc-200/90 bg-white/85 p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Día seleccionado</p>
                <h2 className="text-lg font-semibold">{diaSeleccionadoISO}</h2>
              </div>
              <button type="button" onClick={() => abrirModalAgregar(diaSeleccionadoISO)} className="h-11 rounded-2xl bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black">+ Evento</button>
            </div>
            <div className="mt-4 space-y-2">
              {eventosDelDia.length === 0 ? (
                <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">No hay eventos para este día.</div>
              ) : (
                eventosDelDia.map((ev) => {
                  const action = getProgresoActionUrl(ev.procesoId, ev.id);
                  const iniciandoProceso = ev.procesoId ? Boolean(iniciandoProcesoById[ev.procesoId]) : false;
                  const iniciarProcesoError = ev.procesoId ? iniciarProcesoErrorById[ev.procesoId] : null;
                  const autoState = getAutoAdmisorioState(ev.procesoId);
                  const canCrearAutoAdmisorio =
                    getProgresoEstado(ev.procesoId) === "no_iniciado" &&
                    tieneApoderadosRegistrados(ev.procesoId);
                  const eventStyle = getEventoStyle(ev.usuarioId);
                  return (
                    <div
                      key={ev.id}
                      onClick={() => abrirDetalleEvento(ev)}
                      className="rounded-2xl border border-zinc-200 bg-white/60 p-3 shadow-sm cursor-pointer transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                      style={eventStyle}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{ev.titulo}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {ev.hora ? ev.hora : "Sin hora"}
                            {getNombreUsuario(ev.usuarioId) && <span className="ml-2">· {getNombreUsuario(ev.usuarioId)}</span>}
                            {getNumeroProceso(ev.procesoId) && <span className="ml-2">· {getNumeroProceso(ev.procesoId)}</span>}
                          </p>
                        </div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); eliminarEvento(ev.id); }} className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white">Eliminar</button>
                      </div>
                      {(action || canCrearAutoAdmisorio) && (
                        <div className="mt-2 flex flex-col gap-2">
                          {action && (
                            action.requiereIniciar ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void iniciarProcesoYIrLista(ev.procesoId, action.url);
                                }}
                                disabled={iniciandoProceso}
                                className="flex h-9 w-full items-center justify-center rounded-xl bg-zinc-950 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
                              >
                                {iniciandoProceso ? "Iniciando..." : action.label}
                              </button>
                            ) : (
                              <Link
                                href={action.url}
                                onClick={(e) => e.stopPropagation()}
                                className="flex h-9 w-full items-center justify-center rounded-xl bg-zinc-950 text-xs font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
                              >
                                {action.label}
                              </Link>
                            )
                          )}
                          {action?.requiereIniciar && iniciarProcesoError && (
                            <p className="text-[11px] text-red-600 dark:text-red-400">{iniciarProcesoError}</p>
                          )}
                          {canCrearAutoAdmisorio && ev.procesoId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void crearAutoAdmisorioDesdeCalendario(ev.procesoId);
                              }}
                              disabled={autoState?.loading}
                              className="flex h-9 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-900 shadow-sm transition hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:border-amber-700 dark:hover:bg-amber-950/60"
                            >
                              {autoState?.loading ? "Creando..." : "Crear auto admisorio"}
                            </button>
                          )}
                          {canCrearAutoAdmisorio && autoState?.error && (
                            <p className="text-[11px] text-red-600 dark:text-red-400">{autoState.error}</p>
                          )}
                          {canCrearAutoAdmisorio && autoState?.result?.webViewLink && (
                            <a
                              href={autoState.result.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
                            >
                              Editar en Google Docs
                            </a>
                          )}
                          {canCrearAutoAdmisorio && autoState?.result && ev.procesoId && (
                            <>
                              <input type="file" multiple id={`adj-cal2-${ev.procesoId}`} className="hidden" onChange={(e) => { e.stopPropagation(); handleAgregarAdjuntosCalendario(ev.procesoId!, e); }} />
                              <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                                <label htmlFor={`adj-cal2-${ev.procesoId}`} className="cursor-pointer flex h-7 items-center rounded-lg border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">+ Adjuntar</label>
                                {(autoState.adjuntosExtra ?? []).map((adj, idx) => (
                                  <span key={idx} className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:border-white/10 dark:bg-white/5">
                                    <span className="max-w-[80px] truncate">{adj.name}</span>
                                    <button onClick={(e) => { e.stopPropagation(); handleQuitarAdjuntoCalendario(ev.procesoId!, idx); }} className="text-zinc-400 hover:text-red-500">×</button>
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                          {canCrearAutoAdmisorio &&
                            autoState?.result?.apoderadoEmails &&
                            autoState.result.apoderadoEmails.length > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void enviarAutoAdmisorioApoderadosDesdeCalendario(ev.procesoId);
                                }}
                                disabled={autoState.emailSending}
                                className="flex h-9 w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-500 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/60"
                              >
                                {autoState.emailSending ? "Enviando..." : "Enviar a apoderados"}
                              </button>
                            )}
                          {canCrearAutoAdmisorio &&
                            autoState?.result?.apoderadoEmails &&
                            autoState.result.apoderadoEmails.length === 0 && (
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                No hay apoderados con correo registrado
                              </p>
                            )}
                          {canCrearAutoAdmisorio && autoState?.emailError && (
                            <p className="text-[11px] text-red-600 dark:text-red-400">{autoState.emailError}</p>
                          )}
                          {canCrearAutoAdmisorio && autoState?.emailResult && (
                            <p className="text-[11px] text-green-600 dark:text-green-400">
                              Correos enviados: {autoState.emailResult.sent}
                              {autoState.emailResult.errors && autoState.emailResult.errors.length > 0 && (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {" "}
                                  ({autoState.emailResult.errors.length} fallidos)
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      </main>

      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setModalAbierto(false)} />
          <div className="relative w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-950 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Nuevo evento</p>
                <h3 className="text-lg font-semibold">Crear evento</h3>
              </div>
              <button className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white" onClick={() => setModalAbierto(false)}>Cerrar</button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Fecha</label>
                <input type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Hora</label>
                <input
                  type="time"
                  value={nuevaHora}
                  onChange={(e) => setNuevaHora(e.target.value)}
                  min={minutesToHHMM(BUSINESS_START_MINUTES)}
                  max={minutesToHHMM(BUSINESS_END_MINUTES)}
                  step={60}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Duración</label>
              <select value={nuevaDuracion} onChange={(e) => setNuevaDuracion(Number(e.target.value))} className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer">
                <option value={30}>30 minutos</option>
                <option value={60}>1 hora</option>
                <option value={90}>1 hora 30 min</option>
                <option value={120}>2 horas</option>
                <option value={180}>3 horas</option>
              </select>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Asignar a usuario</label>
              <select value={nuevoUsuarioId} onChange={(e) => setNuevoUsuarioId(e.target.value)} className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer">
                <option value="">Seleccionar usuario</option>
                {usuarios.map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
              </select>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Proceso (opcional)</label>
              <select value={nuevoProcesoId} onChange={(e) => setNuevoProcesoId(e.target.value)} className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer">
                <option value="">Sin proceso</option>
                {procesos.map((p) => (<option key={p.id} value={p.id}>{p.numero_proceso}{p.tipo_proceso ? ` - ${p.tipo_proceso}` : ""}</option>))}
              </select>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">Título</label>
                {!nuevoProcesoId && (
                  <button
                    type="button"
                    onClick={() => setTituloEditable(!tituloEditable)}
                    className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    {tituloEditable ? "Bloquear" : "Editar"}
                  </button>
                )}
              </div>
              <input
                value={nuevoTitulo}
                onChange={(e) => setNuevoTitulo(e.target.value)}
                disabled={Boolean(nuevoProcesoId) || !tituloEditable}
                placeholder={
                  nuevoProcesoId
                    ? "Se genera automaticamente: AUD INSOLVENCIA [Deudor]- [Acronimo]-[#]"
                    : "Ej: Reunion con equipo"
                }
                className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 dark:disabled:bg-white/5 dark:disabled:text-zinc-500"
              />
              {nuevoProcesoId && (
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Para eventos vinculados a proceso, el titulo se genera automaticamente al guardar.
                </p>
              )}
            </div>
            <div className="mt-5 flex flex-col-reverse justify-end gap-3 sm:flex-row">
              <button onClick={() => setModalAbierto(false)} disabled={guardando} className="h-11 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 disabled:opacity-40">Cancelar</button>
              <button onClick={agregarEvento} disabled={(!nuevoProcesoId.trim() && !nuevoTitulo.trim()) || !nuevaFecha || !nuevoUsuarioId || guardando} className="h-11 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventoSeleccionado && (() => {
        const action = getProgresoActionUrl(eventoSeleccionado.procesoId, eventoSeleccionado.id);
        const estadoProgreso = getProgresoEstado(eventoSeleccionado.procesoId);
        const autoState = getAutoAdmisorioState(eventoSeleccionado.procesoId);
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={cerrarDetalleEvento} />
            <div className="relative w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-950 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Detalle del evento</p>
                  <h3 className="text-lg font-semibold">{eventoSeleccionado.titulo}</h3>
                </div>
                <button className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white" onClick={cerrarDetalleEvento}>Cerrar</button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Fecha</div>
                  <div className="text-sm font-medium">{eventoSeleccionado.fechaISO}</div>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Hora</div>
                  <div className="flex flex-1 min-w-[220px] flex-wrap items-center gap-2">
                    <input
                      type="time"
                      value={horaDetalleEditable}
                      onChange={(e) => setHoraDetalleEditable(e.target.value)}
                      min={minutesToHHMM(BUSINESS_START_MINUTES)}
                      max={minutesToHHMM(BUSINESS_END_MINUTES)}
                      step={60}
                      className="h-10 min-w-[130px] rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => void guardarHoraEventoSeleccionado()}
                      disabled={guardandoHoraDetalle}
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                    >
                      {guardandoHoraDetalle ? "Guardando..." : "Guardar hora"}
                    </button>
                  </div>
                </div>

                {getNombreUsuario(eventoSeleccionado.usuarioId) && (
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Usuario</div>
                    <div className="text-sm font-medium">{getNombreUsuario(eventoSeleccionado.usuarioId)}</div>
                  </div>
                )}

                {getNumeroProceso(eventoSeleccionado.procesoId) && (
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Proceso</div>
                    <div className="text-sm font-medium">{getNumeroProceso(eventoSeleccionado.procesoId)}</div>
                  </div>
                )}

                {eventoSeleccionado.procesoId && (
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Estado</div>
                    <div className="text-sm font-medium">
                      {estadoProgreso === 'no_iniciado' && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">No iniciado</span>}
                      {estadoProgreso === 'iniciado' && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Iniciado</span>}
                      {estadoProgreso === 'finalizado' && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">Finalizado</span>}
                      {!estadoProgreso && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Sin progreso</span>}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">Google</div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getGoogleSyncBadgeClassName(eventoSeleccionado.googleSyncStatus)}`}>
                        {getGoogleSyncLabel(eventoSeleccionado.googleSyncStatus)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {eventoSeleccionado.googleMeetUrl && (
                        <a
                          href={eventoSeleccionado.googleMeetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                        >
                          Abrir Meet
                        </a>
                      )}
                      {eventoSeleccionado.googleCalendarUrl && (
                        <a
                          href={eventoSeleccionado.googleCalendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                        >
                          Abrir en Calendar
                        </a>
                      )}
                    </div>
                  </div>
                  {eventoSeleccionado.googleSyncError && (
                    <p className="mt-3 text-xs text-red-600 dark:text-red-300">
                      {eventoSeleccionado.googleSyncError}
                    </p>
                  )}
                  {formatGoogleSyncTimestamp(eventoSeleccionado.googleSyncUpdatedAt) && (
                    <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Ultima sincronizacion: {formatGoogleSyncTimestamp(eventoSeleccionado.googleSyncUpdatedAt)}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => void resincronizarEventoSeleccionadoConGoogle()}
                  disabled={sincronizandoGoogleDetalle}
                  className="flex h-11 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                >
                  {sincronizandoGoogleDetalle ? "Sincronizando Google..." : "Resincronizar con Google"}
                </button>

                {action?.requiereIniciar && eventoSeleccionado.procesoId && (
                  <button
                    type="button"
                    onClick={() => void crearAutoAdmisorioDesdeCalendario(eventoSeleccionado.procesoId)}
                    disabled={autoState?.loading}
                    className="flex h-11 w-full items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 px-5 text-sm font-semibold text-amber-900 shadow-sm transition hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:border-amber-700 dark:hover:bg-amber-950/60"
                  >
                    {autoState?.loading ? "Creando..." : "Crear auto admisorio"}
                  </button>
                )}

                {action && !action.requiereIniciar && (
                  <Link
                    href={action.url}
                    className="flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-950 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
                    onClick={cerrarDetalleEvento}
                  >
                    {action.label}
                  </Link>
                )}

                {action?.requiereIniciar && autoState?.error && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {autoState.error}
                  </div>
                )}

                {action?.requiereIniciar && autoState?.result?.webViewLink && (
                  <a
                    href={autoState.result.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                  >
                    Abrir auto admisorio
                  </a>
                )}

                {action?.requiereIniciar && autoState?.result && eventoSeleccionado.procesoId && (
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="file"
                      multiple
                      id={`adjuntos-cal-${eventoSeleccionado.procesoId}`}
                      className="hidden"
                      onChange={(e) => handleAgregarAdjuntosCalendario(eventoSeleccionado.procesoId!, e)}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label
                        htmlFor={`adjuntos-cal-${eventoSeleccionado.procesoId}`}
                        className="cursor-pointer inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                      >
                        + Adjuntar documentos
                      </label>
                      {(autoState.adjuntosExtra ?? []).map((adj, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                          <span className="max-w-[160px] truncate">{adj.name}</span>
                          <button
                            onClick={() => handleQuitarAdjuntoCalendario(eventoSeleccionado.procesoId!, idx)}
                            className="ml-0.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                          >×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {action?.requiereIniciar && autoState?.result && (
                    <button
                      type="button"
                      onClick={() =>
                        void enviarAutoAdmisorioApoderadosDesdeCalendario(
                          eventoSeleccionado.procesoId,
                        )
                      }
                      disabled={autoState.emailSending || !((autoState.result.apoderadoEmails?.length ?? 0) > 0)}
                      title={!((autoState.result.apoderadoEmails?.length ?? 0) > 0) ? "No hay apoderados con correo registrado" : undefined}
                      className="flex h-11 w-full items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 px-5 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-500 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/60"
                    >
                      {autoState.emailSending ? "Enviando..." : "Enviar por correo a apoderados"}
                    </button>
                  )}

                {action?.requiereIniciar && autoState?.emailError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {autoState.emailError}
                  </div>
                )}

                {action?.requiereIniciar && autoState?.emailResult && (
                  <div className="rounded-2xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                    Correos enviados: {autoState.emailResult.sent}
                    {autoState.emailResult.errors && autoState.emailResult.errors.length > 0 && (
                      <span className="text-amber-700 dark:text-amber-300">
                        {" "}
                        ({autoState.emailResult.errors.length} fallidos)
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => {
                      eliminarEvento(eventoSeleccionado.id);
                      cerrarDetalleEvento();
                    }}
                    className="h-11 flex-1 rounded-2xl border border-red-200 bg-red-50 px-5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-100 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                  >
                    Eliminar evento
                  </button>
                  <button onClick={cerrarDetalleEvento} className="h-11 flex-1 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function CalendarStatChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "positive";
}) {
  const toneClassName =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
      : "border-zinc-200 bg-white text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200";
  const labelClassName =
    tone === "positive" ? "text-current/70" : "text-zinc-500 dark:text-zinc-300";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${toneClassName}`}>
      <span className={labelClassName}>{label}</span>
      <span>{value}</span>
    </span>
  );
}

export default function CalendarioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50 dark:bg-black flex items-center justify-center">Cargando...</div>}>
      <CalendarioContent />
    </Suspense>
  );
}
