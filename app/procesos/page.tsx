"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProcesos, createProceso } from "@/lib/api/proceso";
import { getApoderados, createApoderado } from "@/lib/api/apoderados";
import { createAcreedor } from "@/lib/api/acreedores";
import { createDeudor } from "@/lib/api/deudores";
import type { Apoderado, Proceso, ProcesoInsert } from "@/lib/database.types";

type DeudorFormRow = {
  id: string;
  nombre: string;
  identificacion: string;
  tipoIdentificacion: string;
  direccion: string;
  telefono: string;
  email: string;
  apoderadoId: string;
  apoderadoNombre: string;
};

type AcreedorFormRow = DeudorFormRow & {
  monto: string;
  tipoAcreencia: string;
};

type ApoderadoModalTarget = {
  tipo: "deudor" | "acreedor";
  id: string;
};

type ApoderadoForm = {
  nombre: string;
  identificacion: string;
  email: string;
  telefono: string;
  direccion: string;
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createDeudorRow(): DeudorFormRow {
  return {
    id: uid(),
    nombre: "",
    identificacion: "",
    tipoIdentificacion: "",
    direccion: "",
    telefono: "",
    email: "",
    apoderadoId: "",
    apoderadoNombre: "",
  };
}

function createAcreedorRow(): AcreedorFormRow {
  return {
    id: uid(),
    nombre: "",
    identificacion: "",
    tipoIdentificacion: "",
    direccion: "",
    telefono: "",
    email: "",
    apoderadoId: "",
    apoderadoNombre: "",
    monto: "",
    tipoAcreencia: "",
  };
}

function createApoderadoForm(): ApoderadoForm {
  return {
    nombre: "",
    identificacion: "",
    email: "",
    telefono: "",
    direccion: "",
  };
}

export default function ProcesosPage() {
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  // Form state
  const [numeroProceso, setNumeroProceso] = useState("");
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().split("T")[0]);
  const [estado, setEstado] = useState("Activo");
  const [descripcion, setDescripcion] = useState("");
  const [tipoProceso, setTipoProceso] = useState("");
  const [juzgado, setJuzgado] = useState("");
  const [apoderados, setApoderados] = useState<Apoderado[]>([]);
  const [apoderadoModalOpen, setApoderadoModalOpen] = useState(false);
  const [apoderadoModalTarget, setApoderadoModalTarget] = useState<ApoderadoModalTarget | null>(null);
  const [apoderadoForm, setApoderadoForm] = useState<ApoderadoForm>(() => createApoderadoForm());
  const [apoderadoGuardando, setApoderadoGuardando] = useState(false);

  const [deudoresForm, setDeudoresForm] = useState<DeudorFormRow[]>(() => [createDeudorRow()]);
  const [selectedDeudorId, setSelectedDeudorId] = useState<string>(() => deudoresForm[0]?.id ?? "");
  const [acreedoresForm, setAcreedoresForm] = useState<AcreedorFormRow[]>(() => [createAcreedorRow()]);
  const [selectedAcreedorId, setSelectedAcreedorId] = useState<string>(() => acreedoresForm[0]?.id ?? "");

  function agregarDeudorRow() {
    const nuevaFila = createDeudorRow();
    setDeudoresForm((prev) => [...prev, nuevaFila]);
    setSelectedDeudorId(nuevaFila.id);
  }

  function actualizarDeudorRow(id: string, patch: Partial<DeudorFormRow>) {
    setDeudoresForm((prev) =>
      prev.map((fila) => (fila.id === id ? { ...fila, ...patch } : fila))
    );
  }

  function eliminarDeudorRow(id: string) {
    setDeudoresForm((prev) => prev.filter((fila) => fila.id !== id));
  }

  function agregarAcreedorRow() {
    const nuevaFila = createAcreedorRow();
    setAcreedoresForm((prev) => [...prev, nuevaFila]);
    setSelectedAcreedorId(nuevaFila.id);
  }

  function actualizarAcreedorRow(id: string, patch: Partial<AcreedorFormRow>) {
    setAcreedoresForm((prev) =>
      prev.map((fila) => (fila.id === id ? { ...fila, ...patch } : fila))
    );
  }

  function eliminarAcreedorRow(id: string) {
    setAcreedoresForm((prev) => prev.filter((fila) => fila.id !== id));
  }

  function handleRowApoderadoInput(
    tipo: ApoderadoModalTarget["tipo"],
    rowId: string,
    value: string
  ) {
    const match = apoderados.find((a) => a.nombre === value);
    const patch = {
      apoderadoNombre: value,
      apoderadoId: match ? match.id : "",
    };
    if (tipo === "deudor") {
      actualizarDeudorRow(rowId, patch);
    } else {
      actualizarAcreedorRow(rowId, patch);
    }
  }

  function abrirModalApoderado(target: ApoderadoModalTarget) {
    setApoderadoModalTarget(target);
    setApoderadoForm(createApoderadoForm());
    setApoderadoModalOpen(true);
  }

  function cerrarModalApoderado() {
    setApoderadoModalOpen(false);
    setApoderadoModalTarget(null);
  }

  useEffect(() => {
    fetchProcesos();
  }, []);

  useEffect(() => {
    fetchApoderadosList();
  }, []);

  useEffect(() => {
    if (deudoresForm.length === 0) {
      setSelectedDeudorId("");
      return;
    }
    if (!deudoresForm.some((fila) => fila.id === selectedDeudorId)) {
      setSelectedDeudorId(deudoresForm[0].id);
    }
  }, [deudoresForm, selectedDeudorId]);

  useEffect(() => {
    if (acreedoresForm.length === 0) {
      setSelectedAcreedorId("");
      return;
    }
    if (!acreedoresForm.some((fila) => fila.id === selectedAcreedorId)) {
      setSelectedAcreedorId(acreedoresForm[0].id);
    }
  }, [acreedoresForm, selectedAcreedorId]);

  async function fetchProcesos() {
    try {
      setCargando(true);
      const data = await getProcesos();
      setProcesos(data || []);
    } catch (err) {
      console.error("Error fetching procesos:", err);
      setError("Error al cargar los procesos");
    } finally {
      setCargando(false);
    }
  }

  async function fetchApoderadosList() {
    try {
      const data = await getApoderados();
      setApoderados(data || []);
    } catch (err) {
      console.error("Error fetching apoderados:", err);
    } finally {
      setCargandoApoderados(false);
    }
  }

  async function guardarApoderado() {
    if (!apoderadoForm.nombre.trim() || apoderadoGuardando) return;
    if (!apoderadoModalTarget) return;

    try {
      setApoderadoGuardando(true);
      const created = await createApoderado({
        nombre: apoderadoForm.nombre.trim(),
        identificacion: apoderadoForm.identificacion.trim(),
        email: apoderadoForm.email.trim() || null,
        telefono: apoderadoForm.telefono.trim() || null,
        direccion: apoderadoForm.direccion.trim() || null,
      });
      setApoderados((prev) => [created, ...prev]);
      if (apoderadoModalTarget.tipo === "deudor") {
        actualizarDeudorRow(apoderadoModalTarget.id, {
          apoderadoId: created.id,
          apoderadoNombre: created.nombre,
        });
      } else {
        actualizarAcreedorRow(apoderadoModalTarget.id, {
          apoderadoId: created.id,
          apoderadoNombre: created.nombre,
        });
      }
    } catch (err) {
      console.error("Error creando apoderado:", err);
    } finally {
      setApoderadoGuardando(false);
      cerrarModalApoderado();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExito(null);

    if (!numeroProceso.trim()) {
      setError("El número de proceso es requerido");
      return;
    }

    try {
      setGuardando(true);
      const nuevoProceso: ProcesoInsert = {
        numero_proceso: numeroProceso.trim(),
        fecha_inicio: fechaInicio,
        estado: estado || null,
        descripcion: descripcion.trim() || null,
        tipo_proceso: tipoProceso.trim() || null,
        juzgado: juzgado.trim() || null,
      };

      const created = await createProceso(nuevoProceso);

      const deudoresPayload = deudoresForm
        .filter((deudor) => deudor.nombre.trim())
        .map((deudor) => ({
          proceso_id: created.id,
          nombre: deudor.nombre.trim(),
          identificacion: deudor.identificacion.trim(),
          tipo_identificacion: deudor.tipoIdentificacion.trim() || null,
          direccion: deudor.direccion.trim() || null,
          telefono: deudor.telefono.trim() || null,
          email: deudor.email.trim() || null,
        }));

      if (deudoresPayload.length > 0) {
        await Promise.all(deudoresPayload.map((payload) => createDeudor(payload)));
      }

      const acreedoresPayload = acreedoresForm
        .filter((acreedor) => acreedor.nombre.trim())
        .map((acreedor) => {
          const montoParsed = acreedor.monto.trim() ? Number(acreedor.monto) : null;
          const montoFinal =
            typeof montoParsed === "number" && !Number.isNaN(montoParsed) ? montoParsed : null;

        return {
          proceso_id: created.id,
          nombre: acreedor.nombre.trim(),
          identificacion: acreedor.identificacion.trim(),
          tipo_identificacion: acreedor.tipoIdentificacion.trim() || null,
          direccion: acreedor.direccion.trim() || null,
          telefono: acreedor.telefono.trim() || null,
          email: acreedor.email.trim() || null,
          apoderado_id: acreedor.apoderadoId || null,
          monto_acreencia: montoFinal,
          tipo_acreencia: acreedor.tipoAcreencia.trim() || null,
        };
        });

      if (acreedoresPayload.length > 0) {
        await Promise.all(acreedoresPayload.map((payload) => createAcreedor(payload)));
      }

      setProcesos((prev) => [created, ...prev]);
      setExito("Proceso creado exitosamente");

      // Reset form
      setNumeroProceso("");
      setFechaInicio(new Date().toISOString().split("T")[0]);
      setEstado("Activo");
      setDescripcion("");
      setTipoProceso("");
      setJuzgado("");

      const nuevaFilaDeudor = createDeudorRow();
      setDeudoresForm([nuevaFilaDeudor]);
      setSelectedDeudorId(nuevaFilaDeudor.id);

      const nuevaFilaAcreedor = createAcreedorRow();
      setAcreedoresForm([nuevaFilaAcreedor]);
      setSelectedAcreedorId(nuevaFilaAcreedor.id);
    } catch (err) {
      console.error("Error creating proceso:", err);
      setError("Error al crear el proceso");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Procesos
          </div>
          <div className="mt-4">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Procesos</h1>
            <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
              Gestiona los procesos judiciales. Crea nuevos procesos y visualiza los existentes.
            </p>
          </div>
        </header>

        <nav className="mb-8 flex flex-wrap gap-2">
          <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">
            ← Inicio
          </Link>
          <Link href="/calendario" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">
            Calendario
          </Link>
          <Link href="/lista" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">
            Asistencia
          </Link>
          <Link href="/finalizacion" className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white">
            Finalización
          </Link>
        </nav>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Form Section */}
          <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Crear Nuevo Proceso</h2>

            {error && (
              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
                {error}
              </div>
            )}

            {exito && (
              <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/50 dark:text-green-400">
                {exito}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Número de Proceso *
                </label>
                <input
                  type="text"
                  value={numeroProceso}
                  onChange={(e) => setNumeroProceso(e.target.value)}
                  placeholder="Ej: 2024-001234"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Fecha de Inicio
                  </label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Estado
                  </label>
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer"
                  >
                    <option value="Activo">Activo</option>
                    <option value="En trámite">En trámite</option>
                    <option value="Suspendido">Suspendido</option>
                    <option value="Finalizado">Finalizado</option>
                    <option value="Archivado">Archivado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Tipo de Proceso
                </label>
                <input
                  type="text"
                  value={tipoProceso}
                  onChange={(e) => setTipoProceso(e.target.value)}
                  placeholder="Ej: Liquidación, Reorganización"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Juzgado
                </label>
                <input
                  type="text"
                  value={juzgado}
                  onChange={(e) => setJuzgado(e.target.value)}
                  placeholder="Ej: Juzgado 1 Civil del Circuito"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Descripción
                </label>
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Descripción del proceso..."
                  rows={3}
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 resize-none"
                />
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        Deudores
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Agrega los deudores que participan en este proceso.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={agregarDeudorRow}
                      className="h-10 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                    >
                      + Agregar deudor
                    </button>
                  </div>

                  <div className="space-y-4 mt-4">
                    {deudoresForm.map((deudor, index) => (
                      <div
                        key={deudor.id}
                        className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Deudor {index + 1}
                          </p>
                          <button
                            type="button"
                            onClick={() => eliminarDeudorRow(deudor.id)}
                            disabled={deudoresForm.length === 1}
                            className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                            title={deudoresForm.length === 1 ? "Debe quedar al menos un deudor" : "Eliminar"}
                          >
                            Eliminar
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Nombre
                            </label>
                            <input
                              value={deudor.nombre}
                              onChange={(e) =>
                                actualizarDeudorRow(deudor.id, { nombre: e.target.value })
                              }
                              placeholder="Ej: Juan Pérez"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Identificación
                            </label>
                            <input
                              value={deudor.identificacion}
                              onChange={(e) =>
                                actualizarDeudorRow(deudor.id, { identificacion: e.target.value })
                              }
                              placeholder="Ej: 1.234.567.890"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Tipo de identificación
                            </label>
                            <input
                              value={deudor.tipoIdentificacion}
                              onChange={(e) =>
                                actualizarDeudorRow(deudor.id, { tipoIdentificacion: e.target.value })
                              }
                              placeholder="Ej: Cédula de ciudadanía"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Teléfono
                            </label>
                            <input
                              value={deudor.telefono}
                              onChange={(e) =>
                                actualizarDeudorRow(deudor.id, { telefono: e.target.value })
                              }
                              placeholder="Ej: +57 300 000 0000"
                              inputMode="tel"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Correo electrónico
                            </label>
                            <input
                              value={deudor.email}
                              onChange={(e) =>
                                actualizarDeudorRow(deudor.id, { email: e.target.value })
                              }
                              placeholder="Ej: ejemplo@correo.com"
                              inputMode="email"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Apoderado
                            </label>
                            <div className="flex gap-2">
                              <input
                                value={deudor.apoderadoNombre}
                                onChange={(e) =>
                                  handleRowApoderadoInput("deudor", deudor.id, e.target.value)
                                }
                                list="apoderados-list"
                                placeholder="Busca un apoderado existente"
                                className="flex-1 min-w-0 h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  abrirModalApoderado({ tipo: "deudor", id: deudor.id })
                                }
                                className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                              >
                                + Apoderado
                              </button>
                            </div>
                            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                              Opcional. Autocompleta con apoderados existentes o crea uno nuevo.
                            </p>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Dirección
                            </label>
                            <input
                              value={deudor.direccion}
                              onChange={(e) =>
                                actualizarDeudorRow(deudor.id, { direccion: e.target.value })
                              }
                              placeholder="Ej: Calle 123 #45-67"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {deudoresForm.length > 0 && (
                    <div className="mt-4 space-y-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Deudor principal
                      </label>
                      <select
                        value={selectedDeudorId}
                        onChange={(e) => setSelectedDeudorId(e.target.value)}
                        className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      >
                        {deudoresForm.map((deudor, index) => (
                          <option key={deudor.id} value={deudor.id}>
                            {deudor.nombre.trim() ? deudor.nombre : `Deudor ${index + 1}`}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Elige el deudor que figurará como principal en este proceso.
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        Acreedores
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Añade los acreedores relacionados con el proceso.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={agregarAcreedorRow}
                      className="h-10 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                    >
                      + Agregar acreedor
                    </button>
                  </div>

                  <div className="space-y-4 mt-4">
                    {acreedoresForm.map((acreedor, index) => (
                      <div
                        key={acreedor.id}
                        className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Acreedor {index + 1}
                          </p>
                          <button
                            type="button"
                            onClick={() => eliminarAcreedorRow(acreedor.id)}
                            disabled={acreedoresForm.length === 1}
                            className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                            title={acreedoresForm.length === 1 ? "Debe quedar al menos un acreedor" : "Eliminar"}
                          >
                            Eliminar
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Nombre
                            </label>
                            <input
                              value={acreedor.nombre}
                              onChange={(e) =>
                                actualizarAcreedorRow(acreedor.id, { nombre: e.target.value })
                              }
                              placeholder="Ej: Banco ABC"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Identificación
                            </label>
                            <input
                              value={acreedor.identificacion}
                              onChange={(e) =>
                                actualizarAcreedorRow(acreedor.id, { identificacion: e.target.value })
                              }
                              placeholder="Ej: 9.876.543.210"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Tipo de identificación
                            </label>
                            <input
                              value={acreedor.tipoIdentificacion}
                              onChange={(e) =>
                                actualizarAcreedorRow(acreedor.id, { tipoIdentificacion: e.target.value })
                              }
                              placeholder="Ej: NIT"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Teléfono
                            </label>
                            <input
                              value={acreedor.telefono}
                              onChange={(e) =>
                                actualizarAcreedorRow(acreedor.id, { telefono: e.target.value })
                              }
                              placeholder="Ej: +57 300 000 0000"
                              inputMode="tel"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Correo electrónico
                            </label>
                            <input
                              value={acreedor.email}
                              onChange={(e) =>
                                actualizarAcreedorRow(acreedor.id, { email: e.target.value })
                              }
                              placeholder="Ej: acreedor@empresa.com"
                              inputMode="email"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Apoderado
                            </label>
                            <div className="flex gap-2">
                              <input
                                value={acreedor.apoderadoNombre}
                                onChange={(e) =>
                                  handleRowApoderadoInput("acreedor", acreedor.id, e.target.value)
                                }
                                list="apoderados-list"
                                placeholder="Busca un apoderado existente"
                                className="flex-1 min-w-0 h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  abrirModalApoderado({ tipo: "acreedor", id: acreedor.id })
                                }
                                className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                              >
                                + Apoderado
                              </button>
                            </div>
                            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                              Opcional. Autocompleta con los apoderados disponibles o crea uno nuevo.
                            </p>
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Monto de acreencia
                            </label>
                            <input
                              type="number"
                              value={acreedor.monto}
                              onChange={(e) =>
                                actualizarAcreedorRow(acreedor.id, { monto: e.target.value })
                              }
                              placeholder="Ej: 300000"
                              min="0"
                              step="0.01"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Tipo de acreencia
                            </label>
                            <input
                              value={acreedor.tipoAcreencia}
                              onChange={(e) =>
                                actualizarAcreedorRow(acreedor.id, { tipoAcreencia: e.target.value })
                              }
                              placeholder="Ej: Ordinaria, Subordinada"
                              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {acreedoresForm.length > 0 && (
                    <div className="mt-4 space-y-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Acreedor principal
                      </label>
                      <select
                        value={selectedAcreedorId}
                        onChange={(e) => setSelectedAcreedorId(e.target.value)}
                        className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      >
                        {acreedoresForm.map((acreedor, index) => (
                          <option key={acreedor.id} value={acreedor.id}>
                            {acreedor.nombre.trim() ? acreedor.nombre : `Acreedor ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <datalist id="apoderados-list">
                {apoderados.map((apoderado) => (
                  <option
                    key={apoderado.id}
                    value={apoderado.nombre}
                    label={apoderado.identificacion ? `${apoderado.nombre} (${apoderado.identificacion})` : undefined}
                  />
                ))}
              </datalist>

              <button
                type="submit"
                disabled={guardando || !numeroProceso.trim()}
                className="h-11 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {guardando ? "Guardando..." : "Crear Proceso"}
              </button>
            </form>
          </section>

          {/* List Section */}
          <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Procesos Existentes</h2>

            {cargando ? (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Cargando procesos...</div>
            ) : procesos.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                No hay procesos registrados.
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {procesos.map((proceso) => (
                  <div
                    key={proceso.id}
                    className="rounded-2xl border border-zinc-200 bg-white/60 p-4 shadow-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{proceso.numero_proceso}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                          {proceso.tipo_proceso && <span>{proceso.tipo_proceso} · </span>}
                          <span>{proceso.fecha_inicio}</span>
                        </p>
                        {proceso.juzgado && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                            {proceso.juzgado}
                          </p>
                        )}
                        {proceso.descripcion && (
                          <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-2 line-clamp-2">
                            {proceso.descripcion}
                          </p>
                        )}
                      </div>
                      <span
                        className={[
                          "shrink-0 rounded-full px-2 py-1 text-xs font-medium",
                          proceso.estado === "Activo" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400" :
                          proceso.estado === "Finalizado" ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400" :
                          proceso.estado === "Suspendido" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400" :
                          "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                        ].join(" ")}
                      >
                        {proceso.estado || "Sin estado"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {apoderadoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={cerrarModalApoderado}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-950 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Nuevo apoderado</p>
                <h3 className="text-lg font-semibold dark:text-white">Asigna un apoderado</h3>
              </div>
              <button
                type="button"
                className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                onClick={cerrarModalApoderado}
              >
                Cerrar
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  Nombre *
                </label>
                <input
                  value={apoderadoForm.nombre}
                  onChange={(e) =>
                    setApoderadoForm((prev) => ({ ...prev, nombre: e.target.value }))
                  }
                  placeholder="Ej: Laura Gómez"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Identificación
                  </label>
                  <input
                    value={apoderadoForm.identificacion}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, identificacion: e.target.value }))
                    }
                    placeholder="Ej: 1.111.111.111"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Correo electrónico
                  </label>
                  <input
                    value={apoderadoForm.email}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    inputMode="email"
                    placeholder="Ej: apoderado@firma.com"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Teléfono
                  </label>
                  <input
                    value={apoderadoForm.telefono}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, telefono: e.target.value }))
                    }
                    inputMode="tel"
                    placeholder="Ej: +57 300 000 0000"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Dirección
                  </label>
                  <input
                    value={apoderadoForm.direccion}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, direccion: e.target.value }))
                    }
                    placeholder="Ej: Calle 8 #4-56"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={cerrarModalApoderado}
                className="h-11 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardarApoderado}
                disabled={apoderadoGuardando || !apoderadoForm.nombre.trim()}
                className="h-11 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {apoderadoGuardando ? "Guardando..." : "Agregar apoderado"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
