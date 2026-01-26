"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getProcesos } from "@/lib/api/proceso";
import { getUsuarios, type Usuario } from "@/lib/api/usuarios";
import { getEventos, createEvento, deleteEvento as deleteEventoApi, type Evento } from "@/lib/api/eventos";
import { getProgresos, type Progreso } from "@/lib/api/progreso";
import type { Proceso } from "@/lib/database.types";

type EventoCalendario = {
  id: string;
  titulo: string;
  fechaISO: string;
  hora?: string;
  usuarioId?: string;
  procesoId?: string;
};

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

export default function CalendarioPage() {
  const hoy = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [diaSeleccionadoISO, setDiaSeleccionadoISO] = useState(() => toISODate(new Date()));
  const [viewType, setViewType] = useState<"month" | "week" | "day">("month");
  const diaSeleccionadoDate = useMemo(() => new Date(diaSeleccionadoISO), [diaSeleccionadoISO]);

  const [eventos, setEventos] = useState<EventoCalendario[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState("");
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [nuevaHora, setNuevaHora] = useState("09:00");
  const [nuevoUsuarioId, setNuevoUsuarioId] = useState<string>("");
  const [nuevoProcesoId, setNuevoProcesoId] = useState<string>("");
  const [eventoSeleccionado, setEventoSeleccionado] = useState<EventoCalendario | null>(null);

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioFiltro, setUsuarioFiltro] = useState<string>("global");
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [progresos, setProgresos] = useState<Progreso[]>([]);
  const [guardando, setGuardando] = useState(false);

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
    async function fetchData() {
      try {
        const [usuariosData, procesosData, eventosData, progresosData] = await Promise.all([
          getUsuarios(),
          getProcesos(),
          getEventos(),
          getProgresos(),
        ] as const);
        setUsuarios((usuariosData || []) as unknown as Usuario[]);
        setProcesos((procesosData || []) as unknown as Proceso[]);
        setProgresos((progresosData || []) as unknown as Progreso[]);

        // Convert database eventos to EventoCalendario format
        const eventosConvertidos: EventoCalendario[] = ((eventosData || []) as unknown as Evento[]).map((ev) => ({
          id: ev.id,
          titulo: ev.titulo,
          fechaISO: ev.fecha,
          hora: ev.hora?.slice(0, 5) || undefined,
          usuarioId: ev.usuario_id || undefined,
          procesoId: ev.proceso_id || undefined,
        }));
        setEventos(eventosConvertidos);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setCargandoUsuarios(false);
      }
    }
    fetchData();
  }, []);

  const vistaTexto = viewType === "week" ? "semanal" : viewType === "day" ? "diaria" : "mensual";
  const etiquetaPeriodo = useMemo(() => {
    if (viewType === "week") {
      const semanaInicio = startOfWeek(viewDate);
      const semanaFin = endOfWeek(viewDate);
      const resumenSemana = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
      return `Semana del ${resumenSemana.format(semanaInicio)} al ${resumenSemana.format(semanaFin)}`;
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
    const inicioSemana = startOfWeek(viewDate);
    return Array.from({ length: 7 }).map((_, index) => {
      const fecha = addDays(inicioSemana, index);
      return {
        date: fecha,
        iso: toISODate(fecha),
        inMonth: fecha.getMonth() === viewDate.getMonth(),
      };
    });
  }, [viewDate]);

  const eventosFiltrados = useMemo(() => {
    if (usuarioFiltro === "global") return eventos;
    return eventos.filter((ev) => ev.usuarioId === usuarioFiltro);
  }, [eventos, usuarioFiltro]);

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
  const hoyISO = toISODate(hoy);

  function cambiarPeriodo(direccion: number) {
    const actual = viewDate;
    let siguiente: Date;
    if (viewType === "week") {
      siguiente = addDays(actual, direccion * 7);
    } else if (viewType === "day") {
      siguiente = addDays(actual, direccion);
    } else {
      siguiente = addMonths(actual, direccion);
    }
    setViewDate(siguiente);
    if (viewType === "day") {
      setDiaSeleccionadoISO(toISODate(siguiente));
      return;
    }
    if (viewType === "week") {
      const offset = (new Date(diaSeleccionadoISO).getDay() + 6) % 7;
      const nuevoSeleccion = addDays(siguiente, offset);
      setDiaSeleccionadoISO(toISODate(nuevoSeleccion));
      return;
    }
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

  function prepararModalAgregar(diaISO: string, procesoId?: string) {
    setDiaSeleccionadoISO(diaISO);
    setNuevoTitulo("");
    setNuevaFecha(diaISO);
    setNuevaHora("09:00");
    setNuevoUsuarioId("");
    setNuevoProcesoId(procesoId ?? "");
    setModalAbierto(true);
  }

  function abrirModalAgregar(diaISO: string) {
    prepararModalAgregar(diaISO);
  }

  async function agregarEvento() {
    const titulo = nuevoTitulo.trim();
    if (!titulo || !nuevaFecha || guardando) return;

    setGuardando(true);
    try {
      const nuevoEvento = await createEvento({
        titulo,
        descripcion: null,
        fecha: nuevaFecha,
        hora: nuevaHora ? `${nuevaHora}:00` : null,
        fecha_fin: null,
        hora_fin: null,
        usuario_id: nuevoUsuarioId || null,
        proceso_id: nuevoProcesoId || null,
        tipo: 'general',
        color: null,
        recordatorio: false,
        completado: false,
      });

      setEventos((prev) => [...prev, {
        id: nuevoEvento.id,
        titulo: nuevoEvento.titulo,
        fechaISO: nuevoEvento.fecha,
        hora: nuevoEvento.hora?.slice(0, 5) || undefined,
        usuarioId: nuevoEvento.usuario_id || undefined,
        procesoId: nuevoEvento.proceso_id || undefined,
      }]);
      setModalAbierto(false);
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

  function getProgresoActionUrl(procesoId: string | undefined): { url: string; label: string } | null {
    const estado = getProgresoEstado(procesoId);
    if (!estado || estado === 'finalizado' || !procesoId) return null;

    if (estado === 'no_iniciado') {
      return { url: `/?procesoId=${procesoId}`, label: 'Iniciar proceso' };
    }
    if (estado === 'iniciado') {
      return { url: `/lista?procesoId=${procesoId}`, label: 'Tomar asistencia' };
    }
    return null;
  }

  function abrirDetalleEvento(evento: EventoCalendario) {
    setEventoSeleccionado(evento);
  }

  function cerrarDetalleEvento() {
    setEventoSeleccionado(null);
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

  useEffect(() => {
    if (!procesoIdDesdeQuery) return;
    const targetDate = fechaDesdeQuery || hoyISO;
    prepararModalAgregar(targetDate, procesoIdDesdeQuery);
    router.replace("/calendario");
  }, [procesoIdDesdeQuery, fechaDesdeQuery, hoyISO, router]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <header className="mb-8">
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
              <select
                value={usuarioFiltro}
                onChange={(e) => setUsuarioFiltro(e.target.value)}
                disabled={cargandoUsuarios}
                className="h-11 min-w-[180px] rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 dark:text-zinc-200 outline-none cursor-pointer"
              >
                <option value="global">Global (Todos)</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <button onClick={irPeriodoAnterior} className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">←</button>
                <div className="min-w-[220px] rounded-2xl border border-zinc-200 bg-white/70 px-4 py-2 text-center text-sm font-medium shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">{etiquetaPeriodo}</div>
                <button onClick={irPeriodoSiguiente} className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">→</button>
              </div>
              <button onClick={irHoy} className="h-11 rounded-2xl bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black">Hoy</button>
            </div>
          </div>
        </header>

        <nav className="mb-8 flex flex-wrap gap-2">
          <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">← Inicio</Link>
          <Link href="/lista" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">Asistencia</Link>
          <Link href="/finalizacion" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">Finalización</Link>
        </nav>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            {viewType === "month" && (
              <>
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
                          {dayEvents.slice(0, 2).map((ev) => (
                            <div
                              key={ev.id}
                              onClick={(e) => { e.stopPropagation(); abrirDetalleEvento(ev); }}
                              className="truncate rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 shadow-sm cursor-pointer transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/20"
                              title={ev.titulo}
                            >
                              {ev.hora ? `${ev.hora} · ` : ""}{ev.titulo}
                            </div>
                          ))}
                          {dayEvents.length > 2 && <div className="text-[11px] text-zinc-500 dark:text-zinc-400">+{dayEvents.length - 2} más</div>}
                        </div>
                        {dayEvents.length > 0 && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-full bg-zinc-950/70 dark:bg-white/70" />}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Tip: doble clic en un día para crear un evento rápido.</p>
              </>
            )}
            {viewType === "week" && (
              <>
                <div className="grid grid-cols-7 gap-2 pb-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {semanaDias.map((day) => (
                    <div key={day.iso} className="text-center">
                      <p className="uppercase tracking-wide">{day.date.toLocaleDateString("es-ES", { weekday: "short" })}</p>
                      <p className="text-sm font-semibold">{day.date.getDate()}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-3">
                  {semanaDias.map((day) => {
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
                            dayEvents.slice(0, 3).map((ev) => (
                              <div
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); abrirDetalleEvento(ev); }}
                                className="truncate rounded-xl border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 shadow-sm cursor-pointer transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/20"
                                title={ev.titulo}
                              >
                                {ev.hora ? `${ev.hora} · ` : ""}{ev.titulo}
                              </div>
                            ))
                          )}
                          {dayEvents.length > 3 && <div className="text-[11px] text-zinc-500 dark:text-zinc-400">+{dayEvents.length - 3} más</div>}
                        </div>
                        {dayEvents.length > 0 && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-full bg-zinc-950/70 dark:bg-white/70" />}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Tip: doble clic o usa el botón para sumar eventos rápido.</p>
              </>
            )}
            {viewType === "day" && (
              <>
                <div className="flex items-center justify-between">
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
                      const action = getProgresoActionUrl(ev.procesoId);
                      return (
                        <div key={ev.id} className="rounded-2xl border border-zinc-200 bg-white/60 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
                          <div className="grid items-start gap-3 sm:grid-cols-[90px_1fr]">
                            <div className="text-xs text-zinc-500">{ev.hora ?? "Sin hora"}</div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold">{ev.titulo}</p>
                                <button type="button" onClick={() => eliminarEvento(ev.id)} className="text-xs text-zinc-500 transition hover:text-zinc-950 dark:hover:text-white">Eliminar</button>
                              </div>
                              <p className="text-xs text-zinc-500">
                                {getNombreUsuario(ev.usuarioId) && <span className="mr-2">· {getNombreUsuario(ev.usuarioId)}</span>}
                                {getNumeroProceso(ev.procesoId) && <span className="mr-2">· {getNumeroProceso(ev.procesoId)}</span>}
                              </p>
                            </div>
                          </div>
                          {action && (
                            <Link
                              href={action.url}
                              className="mt-3 flex h-9 w-full items-center justify-center rounded-xl bg-zinc-950 text-xs font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
                            >
                              {action.label}
                            </Link>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <div className="flex items-center justify-between">
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
                  const action = getProgresoActionUrl(ev.procesoId);
                  return (
                    <div
                      key={ev.id}
                      onClick={() => abrirDetalleEvento(ev)}
                      className="rounded-2xl border border-zinc-200 bg-white/60 p-3 shadow-sm cursor-pointer transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      <div className="flex items-center justify-between gap-3">
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
                      {action && (
                        <Link
                          href={action.url}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-2 flex h-9 w-full items-center justify-center rounded-xl bg-zinc-950 text-xs font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
                        >
                          {action.label}
                        </Link>
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
            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Título</label>
              <input value={nuevoTitulo} onChange={(e) => setNuevoTitulo(e.target.value)} placeholder="Ej: Reunión con equipo" className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Fecha</label>
                <input type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Hora</label>
                <input type="time" value={nuevaHora} onChange={(e) => setNuevaHora(e.target.value)} className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10" />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Asignar a usuario (opcional)</label>
              <select value={nuevoUsuarioId} onChange={(e) => setNuevoUsuarioId(e.target.value)} className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer">
                <option value="">Sin asignar</option>
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
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setModalAbierto(false)} disabled={guardando} className="h-11 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 disabled:opacity-40">Cancelar</button>
              <button onClick={agregarEvento} disabled={!nuevoTitulo.trim() || !nuevaFecha || guardando} className="h-11 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventoSeleccionado && (() => {
        const action = getProgresoActionUrl(eventoSeleccionado.procesoId);
        const estadoProgreso = getProgresoEstado(eventoSeleccionado.procesoId);
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
                <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Fecha</div>
                  <div className="text-sm font-medium">{eventoSeleccionado.fechaISO}</div>
                </div>

                <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Hora</div>
                  <div className="text-sm font-medium">{eventoSeleccionado.hora || "Sin hora"}</div>
                </div>

                {getNombreUsuario(eventoSeleccionado.usuarioId) && (
                  <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Usuario</div>
                    <div className="text-sm font-medium">{getNombreUsuario(eventoSeleccionado.usuarioId)}</div>
                  </div>
                )}

                {getNumeroProceso(eventoSeleccionado.procesoId) && (
                  <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Proceso</div>
                    <div className="text-sm font-medium">{getNumeroProceso(eventoSeleccionado.procesoId)}</div>
                  </div>
                )}

                {eventoSeleccionado.procesoId && (
                  <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Estado</div>
                    <div className="text-sm font-medium">
                      {estadoProgreso === 'no_iniciado' && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">No iniciado</span>}
                      {estadoProgreso === 'iniciado' && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Iniciado</span>}
                      {estadoProgreso === 'finalizado' && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">Finalizado</span>}
                      {!estadoProgreso && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Sin progreso</span>}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-col gap-3">
                {action && (
                  <Link
                    href={action.url}
                    className="flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-950 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
                    onClick={cerrarDetalleEvento}
                  >
                    {action.label}
                  </Link>
                )}

                <div className="flex gap-3">
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
