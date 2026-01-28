

"use client";



import Link from "next/link";

import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getProcesos,
  deleteProceso,
  createProceso,
} from "@/lib/api/proceso";
import type {
  Proceso,
  ProcesoInsert,
  AcreedorInsert,
  DeudorInsert,
  ApoderadoInsert,
  Apoderado,
} from "@/lib/database.types";
import { createAcreedor } from "@/lib/api/acreedores";
import { createDeudor } from "@/lib/api/deudores";
import { createApoderado, getApoderados } from "@/lib/api/apoderados";
import ProcesoForm from "@/components/proceso-form";
import { useProcesoForm } from "@/lib/hooks/useProcesoForm";
import { useRouter } from "next/navigation";
import { sendResendEmail } from "@/lib/api/resend";

function limpiarEmail(valor: string) {
  return valor.trim().toLowerCase();
}

function esEmailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function parseEmailList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/)
        .map((email) => limpiarEmail(email))
        .filter((email) => email && esEmailValido(email))
    )
  );
}

type PersonaRow = {
  nombre: string;
  email: string;
  relacion?: string;
};

const createPersonaRow = (): PersonaRow => ({
  nombre: "",
  email: "",
  relacion: "",
});



export default function ProcesosPage() {

  const [procesos, setProcesos] = useState<Proceso[]>([]);

  const [cargando, setCargando] = useState(true);

  const [listError, setListError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [formVisible, setFormVisible] = useState(false);
  const [mostrarPanelEnvio, setMostrarPanelEnvio] = useState(false);
  const [apoderadoEmailsInput, setApoderadoEmailsInput] = useState("");
  const [acreedorEmail, setAcreedorEmail] = useState("");
  const [enviandoRegistro, setEnviandoRegistro] = useState(false);
  const [envioMensaje, setEnvioMensaje] = useState<string | null>(null);
  const [envioError, setEnvioError] = useState<string | null>(null);
  const [apoderadoOptions, setApoderadoOptions] = useState<Apoderado[]>([]);
  const [nuevoProceso, setNuevoProceso] = useState({
    numero: "",
    fecha: new Date().toISOString().slice(0, 10),
    estado: "Activo",
    tipo: "",
    juzgado: "",
    descripcion: "",
  });
  const [nuevosAcreedores, setNuevosAcreedores] = useState<PersonaRow[]>([
    createPersonaRow(),
  ]);
  const [nuevosDeudores, setNuevosDeudores] = useState<PersonaRow[]>([
    createPersonaRow(),
  ]);
  const [nuevosApoderados, setNuevosApoderados] = useState<PersonaRow[]>([
    createPersonaRow(),
  ]);
  const [creandoProceso, setCreandoProceso] = useState(false);
  const [mensajeProceso, setMensajeProceso] = useState<string | null>(null);



  const router = useRouter();

  const handleSaveSuccess = useCallback(
    (savedProceso: Proceso, context?: { isEditing: boolean }) => {
      setProcesos((prev) => {
        const exists = prev.some((proceso) => proceso.id === savedProceso.id);
        if (exists) {
          return prev.map((proceso) =>
            proceso.id === savedProceso.id ? savedProceso : proceso
          );
        }
        return [savedProceso, ...prev];
      });

      if (context?.isEditing) {
        router.push(`/calendario?procesoId=${savedProceso.id}`);
      }
    },
    [router]
  );



  const handleDeleteProceso = useCallback(async (id: string, numeroProcess: string) => {

    if (!confirm(`¿Estás seguro de que deseas eliminar el proceso "${numeroProcess}"? Esta acción no se puede deshacer.`)) {

      return;

    }



    setDeletingId(id);

    try {

      await deleteProceso(id);

      setProcesos((prev) => prev.filter((proceso) => proceso.id !== id));

    } catch (err) {

      console.error("Error deleting proceso:", err);

      alert("Error al eliminar el proceso. Por favor intenta de nuevo.");

    } finally {

      setDeletingId(null);

    }

  }, []);



  const form = useProcesoForm({ onSaveSuccess: handleSaveSuccess });

  const {
    editingProcesoId,
    cargandoDetalle,
    cargarProcesoDetalle,
    resetFormFields,
  } = form;

  const shouldShowForm = formVisible || Boolean(editingProcesoId);



  useEffect(() => {
    if (editingProcesoId) {
      setFormVisible(true);
    }
  }, [editingProcesoId]);

  useEffect(() => {

    async function loadProcesos() {

      setCargando(true);

      setListError(null);

      try {

        const data = await getProcesos();

        setProcesos(data || []);

      } catch (err) {

        console.error("Error fetching procesos:", err);

        setListError("Error al cargar los procesos");

      } finally {

        setCargando(false);

      }

    }

    loadProcesos();

  }, []);

  useEffect(() => {
    let active = true;
    const cargarApoderados = async () => {
      try {
        const data = await getApoderados();
        if (active) {
          setApoderadoOptions(data ?? []);
        }
      } catch (error) {
        console.error("Error cargando apoderados para autocomplete:", error);
      }
    };
    cargarApoderados();
    return () => {
      active = false;
    };
  }, []);

  const updatePersonaRow = (
    setRows: Dispatch<SetStateAction<PersonaRow[]>>,
    index: number,
    field: keyof PersonaRow,
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const removePersonaRow = (
    setRows: Dispatch<SetStateAction<PersonaRow[]>>,
    index: number,
  ) => {
    setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const addPersonaRow = (setRows: Dispatch<SetStateAction<PersonaRow[]>>) => {
    setRows((prev) => [...prev, createPersonaRow()]);
  };

  async function crearProcesoDesdePanel() {
    if (creandoProceso) return;
    if (!nuevoProceso.numero.trim()) {
      setMensajeProceso("El número de proceso es obligatorio.");
      return;
    }
    setCreandoProceso(true);
    setMensajeProceso(null);
    try {
      const payload: ProcesoInsert = {
        numero_proceso: nuevoProceso.numero.trim(),
        fecha_procesos: nuevoProceso.fecha || new Date().toISOString().slice(0, 10),
        estado: nuevoProceso.estado || "Activo",
        tipo_proceso: nuevoProceso.tipo || null,
        juzgado: nuevoProceso.juzgado || null,
        descripcion: nuevoProceso.descripcion || null,
      };
      const nuevo = await createProceso(payload);
      setProcesos((prev) => [nuevo, ...prev]);
      const promises: Promise<void>[] = [];
      nuevosAcreedores
        .filter((row) => row.nombre.trim())
        .forEach((row) => {
          const data: AcreedorInsert = {
            nombre: row.nombre.trim(),
            email: row.email.trim() || null,
            proceso_id: nuevo.id,
          };
          promises.push(createAcreedor(data).then(() => undefined));
        });
      nuevosDeudores
        .filter((row) => row.nombre.trim())
        .forEach((row) => {
          const data: DeudorInsert = {
            nombre: row.nombre.trim(),
            email: row.email.trim() || null,
            proceso_id: nuevo.id,
          };
          promises.push(createDeudor(data).then(() => undefined));
        });
      nuevosApoderados
        .filter((row) => row.nombre.trim())
        .forEach((row) => {
          const data: ApoderadoInsert = {
            nombre: row.nombre.trim(),
            email: row.email.trim() || null,
            proceso_id: nuevo.id,
          };
          promises.push(createApoderado(data).then(() => undefined));
        });
      await Promise.all(promises);
      const refreshedApoderados = await getApoderados();
      setApoderadoOptions(refreshedApoderados ?? []);
      setNuevoProceso({
        numero: "",
        fecha: new Date().toISOString().slice(0, 10),
        estado: "Activo",
        tipo: "",
        juzgado: "",
        descripcion: "",
      });
      setNuevosAcreedores([createPersonaRow()]);
      setNuevosDeudores([createPersonaRow()]);
      setNuevosApoderados([createPersonaRow()]);
      setMensajeProceso(`Proceso ${nuevo.numero_proceso} creado correctamente.`);
    } catch (error) {
      console.error("Error creando proceso desde panel:", error);
      setMensajeProceso(
        error instanceof Error ? error.message : "No se pudo crear el proceso.",
      );
    } finally {
      setCreandoProceso(false);
    }
  }

  useEffect(() => {
    if (!mostrarPanelEnvio) {
      setEnvioError(null);
      setEnvioMensaje(null);
    }
  }, [mostrarPanelEnvio]);

  const selectedProceso = useMemo(
    () => procesos.find((proceso) => proceso.id === editingProcesoId),
    [procesos, editingProcesoId],
  );

  async function enviarRegistroPorCorreo() {
    if (enviandoRegistro) return;
    const recipients = parseEmailList(apoderadoEmailsInput);
    if (recipients.length === 0) {
      setEnvioError("Agrega al menos un correo válido de apoderado.");
      setEnvioMensaje(null);
      return;
    }
    const cleanedAcreedorEmail = acreedorEmail.trim();
    if (cleanedAcreedorEmail && !esEmailValido(cleanedAcreedorEmail)) {
      setEnvioError("El correo del acreedor no es válido.");
      setEnvioMensaje(null);
      return;
    }
    setEnvioError(null);
    setEnvioMensaje(null);
    setEnviandoRegistro(true);
    try {
      const procesoLabel = selectedProceso?.numero_proceso ?? "registro general";
      const html = `
        <p>Hola,</p>
        <p>
          Te compartimos el registro de procesos <strong>${procesoLabel}</strong> creado el día <strong>${new Date().toLocaleDateString("es-CO")}</strong>.
        </p>
        <p>
          Hay ${procesos.length} procesos registrados actualmente.
        </p>
        <p>Quedamos atentos a cualquier comentario.</p>
      `;

      await sendResendEmail({
        to: recipients,
        subject: `Registro de procesos › ${procesoLabel}`,
        html,
        ...(cleanedAcreedorEmail ? { cc: cleanedAcreedorEmail } : {}),
      });

      setEnvioMensaje(`Correos enviados a ${recipients.length} apoderado${recipients.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("Error enviando registro:", error);
      const message = error instanceof Error ? error.message : "No se pudo enviar el correo.";
      setEnvioError(message);
    } finally {
      setEnviandoRegistro(false);
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
          

          <Link

            href="/calendario"

            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"

          >

            Calendario

          </Link>

          <button
            type="button"
            onClick={() => setMostrarPanelEnvio((prev) => !prev)}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-500 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-500/20 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20"
          >
            {mostrarPanelEnvio ? "Ocultar envío" : "Enviar registro"}
          </button>

          {!shouldShowForm && (
            <button
              type="button"
              onClick={() => {
                resetFormFields();
                setFormVisible(true);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-900 dark:border-white/10 dark:bg-white dark:text-black dark:hover:bg-white/80"
            >
              Crear proceso
            </button>
          )}


        </nav>

        {mostrarPanelEnvio && (
          <section className="mb-8 rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Enviar registro</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Completa los correos y administra los datos del proceso antes de notificar a los apoderados.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMostrarPanelEnvio(false)}
                className="rounded-full px-3 py-1 text-xs font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
              >
                Cerrar
              </button>
            </div>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Correo del acreedor
                  </label>
                  <input
                    list="acreedor-suggestions"
                    value={acreedorEmail}
                    onChange={(e) => setAcreedorEmail(e.target.value)}
                    placeholder="Ej: acreedor@firma.com"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                  <datalist id="acreedor-suggestions">
                    {apoderadoOptions
                      .filter((ap) => ap.email)
                      .map((ap) => (
                        <option key={ap.id} value={ap.email ?? ""}>
                          {ap.nombre}
                        </option>
                      ))}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Correos de apoderados
                  </label>
                  <textarea
                    value={apoderadoEmailsInput}
                    onChange={(e) => setApoderadoEmailsInput(e.target.value)}
                    rows={4}
                    placeholder="Un correo por línea o separado por comas"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Puedes copiar los correos desde el listado de procesos o agregarlos manualmente.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={enviarRegistroPorCorreo}
                    disabled={enviandoRegistro}
                    className="h-12 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                  >
                    {enviandoRegistro ? "Enviando..." : "Enviar correos a los apoderados"}
                  </button>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Procesos disponibles: {procesos.length}
                  </p>
                </div>
                {envioError && (
                  <p className="text-sm text-red-600 dark:text-red-300">{envioError}</p>
                )}
                {envioMensaje && (
                  <p className="text-sm text-green-600 dark:text-green-300">{envioMensaje}</p>
                )}
              </div>
              <div className="space-y-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-white/10 dark:bg-white/10">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                  Nuevo proceso
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Número de proceso
                    </label>
                    <input
                      value={nuevoProceso.numero}
                      onChange={(e) =>
                        setNuevoProceso((prev) => ({ ...prev, numero: e.target.value }))
                      }
                      className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Fecha
                    </label>
                    <input
                      type="date"
                      value={nuevoProceso.fecha}
                      onChange={(e) =>
                        setNuevoProceso((prev) => ({ ...prev, fecha: e.target.value }))
                      }
                      className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Estado
                    </label>
                    <select
                      value={nuevoProceso.estado}
                      onChange={(e) =>
                        setNuevoProceso((prev) => ({ ...prev, estado: e.target.value }))
                      }
                      className="h-10 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                    >
                      {["Activo", "En trámite", "Suspendido", "Finalizado"].map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Tipo de proceso
                    </label>
                    <input
                      value={nuevoProceso.tipo}
                      onChange={(e) =>
                        setNuevoProceso((prev) => ({ ...prev, tipo: e.target.value }))
                      }
                      className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                    Juzgado
                  </label>
                  <input
                    value={nuevoProceso.juzgado}
                    onChange={(e) =>
                      setNuevoProceso((prev) => ({ ...prev, juzgado: e.target.value }))
                    }
                    className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                    Descripción
                  </label>
                  <textarea
                    value={nuevoProceso.descripcion}
                    onChange={(e) =>
                      setNuevoProceso((prev) => ({ ...prev, descripcion: e.target.value }))
                    }
                    rows={2}
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs outline-none"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase text-zinc-500">
                    <span>Acreedores</span>
                    <button
                      type="button"
                      onClick={() => addPersonaRow(setNuevosAcreedores)}
                      className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10px]"
                    >
                      + agregar
                    </button>
                  </div>
                  {nuevosAcreedores.map((row, index) => (
                    <div key={`acreedor-${index}`} className="flex gap-2">
                      <input
                        value={row.nombre}
                        onChange={(e) =>
                          updatePersonaRow(setNuevosAcreedores, index, "nombre", e.target.value)
                        }
                        placeholder="Nombre"
                        className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                      />
                      <input
                        value={row.email}
                        onChange={(e) =>
                          updatePersonaRow(setNuevosAcreedores, index, "email", e.target.value)
                        }
                        placeholder="Correo"
                        className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                      />
                      {nuevosAcreedores.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePersonaRow(setNuevosAcreedores, index)}
                          className="rounded-full bg-red-50 px-2 text-xs text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase text-zinc-500">
                    <span>Deudores</span>
                    <button
                      type="button"
                      onClick={() => addPersonaRow(setNuevosDeudores)}
                      className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10px]"
                    >
                      + agregar
                    </button>
                  </div>
                  {nuevosDeudores.map((row, index) => (
                    <div key={`deudor-${index}`} className="flex gap-2">
                      <input
                        value={row.nombre}
                        onChange={(e) =>
                          updatePersonaRow(setNuevosDeudores, index, "nombre", e.target.value)
                        }
                        placeholder="Nombre"
                        className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                      />
                      <input
                        value={row.email}
                        onChange={(e) =>
                          updatePersonaRow(setNuevosDeudores, index, "email", e.target.value)
                        }
                        placeholder="Correo"
                        className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                      />
                      {nuevosDeudores.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePersonaRow(setNuevosDeudores, index)}
                          className="rounded-full bg-red-50 px-2 text-xs text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase text-zinc-500">
                    <span>Apoderados</span>
                    <button
                      type="button"
                      onClick={() => addPersonaRow(setNuevosApoderados)}
                      className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10px]"
                    >
                      + agregar
                    </button>
                  </div>
                  {nuevosApoderados.map((row, index) => (
                    <div key={`apoderado-${index}`} className="flex gap-2">
                      <input
                        value={row.nombre}
                        onChange={(e) =>
                          updatePersonaRow(setNuevosApoderados, index, "nombre", e.target.value)
                        }
                        placeholder="Nombre"
                        className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                      />
                      <input
                        list="apoderado-suggestions"
                        value={row.email}
                        onChange={(e) =>
                          updatePersonaRow(setNuevosApoderados, index, "email", e.target.value)
                        }
                        placeholder="Correo"
                        className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none"
                      />
                      {nuevosApoderados.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePersonaRow(setNuevosApoderados, index)}
                          className="rounded-full bg-red-50 px-2 text-xs text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <datalist id="apoderado-suggestions">
                    {apoderadoOptions
                      .filter((option) => option.email)
                      .map((option) => (
                        <option key={option.id} value={option.email ?? ""}>
                          {option.nombre}
                        </option>
                      ))}
                  </datalist>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={crearProcesoDesdePanel}
                    disabled={creandoProceso}
                    className="h-12 rounded-2xl bg-emerald-600 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-400 dark:text-black"
                  >
                    {creandoProceso ? "Creando proceso..." : "Guardar proceso y apoderados"}
                  </button>
                  {mensajeProceso && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{mensajeProceso}</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}



        <div className={`grid grid-cols-1 gap-6 ${shouldShowForm ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>

          {shouldShowForm && <ProcesoForm form={form} />}



          <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">

            <h2 className="text-lg font-semibold mb-4">Procesos Existentes</h2>

            {listError && (

              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">

                {listError}

              </div>

            )}



            {cargando ? (

              <div className="text-sm text-zinc-500 dark:text-zinc-400">Cargando procesos...</div>

            ) : procesos.length === 0 ? (

              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">

                No hay procesos registrados.

              </div>

            ) : (

              <div className="space-y-3 max-h-[600px] overflow-y-auto">

                {procesos.map((proceso) => {

                  const isSelected = editingProcesoId === proceso.id;

                  return (

                    <div

                      key={proceso.id}

                      onClick={() => cargarProcesoDetalle(proceso.id)}

                      className={[

                        "w-full text-left transition cursor-pointer",

                        "rounded-2xl border p-4 shadow-sm",

                        isSelected

                          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"

                          : "border-zinc-200 bg-white/60 hover:border-zinc-800 dark:border-white/10 dark:bg-white/5",

                        cargandoDetalle && !isSelected ? "opacity-50 pointer-events-none" : "",

                      ].join(" ")}

                    >

                      <div className="flex items-start justify-between gap-3">

                        <div className="min-w-0 flex-1">

                          <p className="font-medium truncate">{proceso.numero_proceso}</p>

                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">

                            {proceso.tipo_proceso && <span>{proceso.tipo_proceso} · </span>}

                            <span>{proceso.fecha_procesos}</span>

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

                        <div className="flex flex-col items-end gap-2">

                          <span

                            className={[

                              "shrink-0 rounded-full px-2 py-1 text-xs font-medium",

                              proceso.estado === "Activo"

                                ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"

                                : proceso.estado === "Finalizado"

                                ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"

                                : proceso.estado === "Suspendido"

                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"

                                : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",

                            ].join(" ")}

                          >

                            {proceso.estado || "Sin estado"}

                          </span>

                          {isSelected && cargandoDetalle && (

                            <span className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">

                              cargando¦

                            </span>

                          )}

                        </div>

                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">

                        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">

                          {isSelected ? "Editando este proceso" : "Haz clic para cargar y editar"}

                        </p>

                        <div className="flex gap-2">

                          <Link

                            href={`/calendario?procesoId=${proceso.id}`}

                            className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200 dark:hover:border-white"

                            onClick={(e) => e.stopPropagation()}

                          >

                            Programar en calendario

                          </Link>

                          <button

                            onClick={(e) => {

                              e.stopPropagation();

                              handleDeleteProceso(proceso.id, proceso.numero_proceso);

                            }}

                            disabled={deletingId === proceso.id}

                            className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 transition hover:border-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-red-900 dark:bg-red-950/40 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-950/60"

                          >

                            {deletingId === proceso.id ? "Eliminando..." : "Eliminar"}

                          </button>

                        </div>

                      </div>

                    </div>

                  );

                })}

              </div>

            )}

          </section>

        </div>

      </main>

    </div>

  );

}

