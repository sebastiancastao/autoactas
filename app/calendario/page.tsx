"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getApoderados } from "@/lib/api/apoderados";
import { getAcreedores } from "@/lib/api/acreedores";
import { getDeudores } from "@/lib/api/deudores";
import { getProcesos } from "@/lib/api/proceso";
import type { Apoderado, Acreedor, Deudor, Proceso } from "@/lib/database.types";

type CategoriaUsuario = "Apoderado" | "Acreedor" | "Deudor";

type Usuario = {
  id: string;
  nombre: string;
  categoria: CategoriaUsuario;
};

type EventoCalendario = {
  id: string;
  titulo: string;
  fechaISO: string;
  hora?: string;
  usuarioId?: string;
  procesoId?: string;
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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

export default function CalendarioPage() {
  const hoy = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [diaSeleccionadoISO, setDiaSeleccionadoISO] = useState(() => toISODate(new Date()));

  const [eventos, setEventos] = useState<EventoCalendario[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState("");
  const [nuevaHora, setNuevaHora] = useState("09:00");
  const [nuevoUsuarioId, setNuevoUsuarioId] = useState<string>("");
  const [nuevoProcesoId, setNuevoProcesoId] = useState<string>("");

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioFiltro, setUsuarioFiltro] = useState<string>("global");
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [procesos, setProcesos] = useState<Proceso[]>([]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [apoderados, acreedores, deudores, procesosData] = await Promise.all([
          getApoderados(), getAcreedores(), getDeudores(), getProcesos(),
        ]);
        const usuariosCombinados: Usuario[] = [
          ...(apoderados || []).map((a: Apoderado) => ({ id: a.id, nombre: a.nombre, categoria: "Apoderado" as CategoriaUsuario })),
          ...(acreedores || []).map((a: Acreedor) => ({ id: a.id, nombre: a.nombre, categoria: "Acreedor" as CategoriaUsuario })),
          ...(deudores || []).map((d: Deudor) => ({ id: d.id, nombre: d.nombre, categoria: "Deudor" as CategoriaUsuario })),
        ];
        setUsuarios(usuariosCombinados);
        setProcesos(procesosData || []);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setCargandoUsuarios(false);
      }
    }
    fetchData();
  }, []);

  const etiquetaMes = `${MESES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

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

  function irMesAnterior() { setViewDate((d) => addMonths(d, -1)); }
  function irMesSiguiente() { setViewDate((d) => addMonths(d, 1)); }
  function irHoy() { setViewDate(startOfMonth(hoy)); setDiaSeleccionadoISO(toISODate(hoy)); }

  function abrirModalAgregar(diaISO: string) {
    setDiaSeleccionadoISO(diaISO);
    setNuevoTitulo("");
    setNuevaHora("09:00");
    setNuevoUsuarioId("");
    setNuevoProcesoId("");
    setModalAbierto(true);
  }

  function agregarEvento() {
    const titulo = nuevoTitulo.trim();
    if (!titulo) return;
    setEventos((prev) => [...prev, {
      id: uid(), titulo, fechaISO: diaSeleccionadoISO,
      hora: nuevaHora || undefined, usuarioId: nuevoUsuarioId || undefined, procesoId: nuevoProcesoId || undefined,
    }]);
    setModalAbierto(false);
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

  function eliminarEvento(id: string) { setEventos((prev) => prev.filter((e) => e.id !== id)); }

  const hoyISO = toISODate(hoy);

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
                Vista mensual + eventos por día. Clic en un día para seleccionar, doble clic para agregar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={usuarioFiltro}
                onChange={(e) => setUsuarioFiltro(e.target.value)}
                disabled={cargandoUsuarios}
                className="h-11 min-w-[180px] rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 dark:text-zinc-200 outline-none cursor-pointer"
              >
                <option value="global">Global (Todos)</option>
                {usuarios.length > 0 && (
                  <>
                    <optgroup label="Apoderados">
                      {usuarios.filter((u) => u.categoria === "Apoderado").map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Acreedores">
                      {usuarios.filter((u) => u.categoria === "Acreedor").map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Deudores">
                      {usuarios.filter((u) => u.categoria === "Deudor").map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>
              <button onClick={irMesAnterior} className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">←</button>
              <div className="min-w-[220px] rounded-2xl border border-zinc-200 bg-white/70 px-4 py-2 text-center text-sm font-medium shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">{etiquetaMes}</div>
              <button onClick={irMesSiguiente} className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">→</button>
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
                      <span className="opacity-0 transition group-hover:opacity-100 text-xs text-zinc-500 dark:text-zinc-300">+</span>
                    </div>
                    <div className="mt-2 flex flex-1 flex-col gap-1 overflow-hidden">
                      {dayEvents.slice(0, 2).map((ev) => (
                        <div key={ev.id} className="truncate rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-zinc-200" title={ev.titulo}>
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
                eventosDelDia.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/60 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{ev.titulo}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {ev.hora ? ev.hora : "Sin hora"}
                        {getNombreUsuario(ev.usuarioId) && <span className="ml-2">· {getNombreUsuario(ev.usuarioId)}</span>}
                        {getNumeroProceso(ev.procesoId) && <span className="ml-2">· {getNumeroProceso(ev.procesoId)}</span>}
                      </p>
                    </div>
                    <button type="button" onClick={() => eliminarEvento(ev.id)} className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white">Eliminar</button>
                  </div>
                ))
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
                <h3 className="text-lg font-semibold">{diaSeleccionadoISO}</h3>
              </div>
              <button className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white" onClick={() => setModalAbierto(false)}>Cerrar</button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Título</label>
                <input value={nuevoTitulo} onChange={(e) => setNuevoTitulo(e.target.value)} placeholder="Ej: Reunión con equipo" className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10" />
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
                {usuarios.length > 0 && (
                  <>
                    <optgroup label="Apoderados">{usuarios.filter((u) => u.categoria === "Apoderado").map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}</optgroup>
                    <optgroup label="Acreedores">{usuarios.filter((u) => u.categoria === "Acreedor").map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}</optgroup>
                    <optgroup label="Deudores">{usuarios.filter((u) => u.categoria === "Deudor").map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}</optgroup>
                  </>
                )}
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
              <button onClick={() => setModalAbierto(false)} className="h-11 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">Cancelar</button>
              <button onClick={agregarEvento} disabled={!nuevoTitulo.trim()} className="h-11 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
