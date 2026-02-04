

"use client";



import Link from "next/link";

import {
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
import type { Proceso, ProcesoInsert, Apoderado } from "@/lib/database.types";
import { getApoderados } from "@/lib/api/apoderados";
import ProcesoForm from "@/components/proceso-form";
import { useProcesoForm } from "@/lib/hooks/useProcesoForm";
import { useRouter } from "next/navigation";
import { sendResendEmail } from "@/lib/api/resend";

function esEmailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

type PanelApoderadoRow = {
  id: string;
  categoria: "acreedor" | "deudor";
  apoderadoId: string;
  nombre: string;
  email: string;
};

const generateId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const createPanelApoderadoRow = (): PanelApoderadoRow => ({
  id: generateId(),
  categoria: "acreedor",
  apoderadoId: "",
  nombre: "",
  email: "",
});

type RegistroEmailHtmlProps = {
  recipientName: string;
  link: string;
  tipoLabel: string;
  totalProcesos: number;
};

const buildRegistroEmailHtml = ({
  recipientName,
  link,
  tipoLabel,
  totalProcesos,
}: RegistroEmailHtmlProps) => `
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Registro de proceso</title>
  </head>
  <body style="margin:0;background-color:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;background-color:#f8fafc;">
      <tr>
        <td align="center" style="padding:24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-radius:28px;background:linear-gradient(180deg,#ffffff,#f4f4f5);border:1px solid rgba(15,23,42,0.08);box-shadow:0 20px 45px rgba(15,23,42,0.18);">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;font-size:16px;color:#0f172a;font-weight:600;">Hola ${recipientName},</p>
                <p style="margin:0 0 16px;font-size:15px;color:#475467;line-height:1.6;">
                  en orden para registrar el registro al proceso de insolvencia, accede a este enlace:
                </p>
                <p style="margin:0 0 24px;">
                  <a href="${link}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border-radius:999px;background:#047857;color:#f8fafc;font-weight:600;text-decoration:none;font-size:14px;">
                    Abrir registro
                  </a>
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#475467;line-height:1.4;">
                  <strong>Sección</strong>: ${tipoLabel}
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#475467;line-height:1.4;">
                  <strong>Procesos registrados</strong>: ${totalProcesos}
                </p>
                <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:<br />
                  <span style="word-break:break-all;">${link}</span>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const buildRegistroEmailText = ({
  recipientName,
  link,
}: Pick<RegistroEmailHtmlProps, "recipientName" | "link">) =>
  `Hola ${recipientName}, en orden para registrar el registro al proceso de insolvencia, accede a este enlace: ${link}`;

type EnviarRegistroOptions = {
  procesoLabel?: string;
  totalProcesos?: number;
  procesoId?: string;
};

type EnviarRegistroResult = {
  success: boolean;
  recipientsCount?: number;
  errorMessage?: string;
};


export default function ProcesosPage() {

  const [procesos, setProcesos] = useState<Proceso[]>([]);

  const [cargando, setCargando] = useState(true);

  const [listError, setListError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [formVisible, setFormVisible] = useState(false);
  const [mostrarPanelEnvio, setMostrarPanelEnvio] = useState(false);
  const [enviandoRegistro, setEnviandoRegistro] = useState(false);
  const [envioMensaje, setEnvioMensaje] = useState<string | null>(null);
  const [envioError, setEnvioError] = useState<string | null>(null);
  const [apoderadoOptions, setApoderadoOptions] = useState<Apoderado[]>([]);
  const [panelApoderados, setPanelApoderados] = useState<PanelApoderadoRow[]>([
    createPanelApoderadoRow(),
  ]);
  const updatePanelApoderadoRow = (
    id: string,
    patch: Partial<PanelApoderadoRow>,
  ) => {
    setPanelApoderados((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const handlePanelApoderadoNombreChange = (id: string, value: string) => {
    const normalized = value.trim().toLowerCase();
    setPanelApoderados((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const match = apoderadoOptions.find(
          (option) =>
            option.nombre?.trim().toLowerCase() === normalized && normalized !== "",
        );
        return {
          ...row,
          nombre: value,
          apoderadoId: match?.id ?? "",
          email: match?.email ?? row.email,
        };
      }),
    );
  };

  const handlePanelApoderadoEmailChange = (id: string, value: string) => {
    updatePanelApoderadoRow(id, { email: value });
  };

  const handlePanelApoderadoCategoriaChange = (
    id: string,
    value: PanelApoderadoRow["categoria"],
  ) => {
    updatePanelApoderadoRow(id, { categoria: value });
  };

  const addPanelApoderadoRow = () => {
    setPanelApoderados((prev) => [...prev, createPanelApoderadoRow()]);
  };

  const removePanelApoderadoRow = (id: string) => {
    setPanelApoderados((prev) =>
      prev.length === 1 ? prev : prev.filter((row) => row.id !== id),
    );
  };
  const [nuevoProceso, setNuevoProceso] = useState({
    numero: "",
    fecha: new Date().toISOString().slice(0, 10),
    estado: "Activo",
    tipo: "",
    juzgado: "",
    descripcion: "",
  });
  const [creandoProceso, setCreandoProceso] = useState(false);
  const [mensajeProceso, setMensajeProceso] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");



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
      const totalProcesos = procesos.length + 1;
      setProcesos((prev) => [nuevo, ...prev]);
      setNuevoProceso({
        numero: "",
        fecha: new Date().toISOString().slice(0, 10),
        estado: "Activo",
        tipo: "",
        juzgado: "",
        descripcion: "",
      });
      const envioResultado = await enviarRegistroPorCorreo({
        procesoLabel: nuevo.numero_proceso,
        totalProcesos,
        procesoId: nuevo.id,
      });
      let mensaje = `Proceso ${nuevo.numero_proceso} creado correctamente.`;
      if (envioResultado.success && typeof envioResultado.recipientsCount === "number") {
        mensaje += ` Correos enviados a ${envioResultado.recipientsCount} apoderado${
          envioResultado.recipientsCount === 1 ? "" : "s"
        }.`;
      } else if (envioResultado.errorMessage) {
        mensaje += ` No se pudo notificar a los apoderados: ${envioResultado.errorMessage}`;
      }
      setMensajeProceso(mensaje);
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

  const trimmedSearchQuery = searchQuery.trim();
  const normalizedSearchQuery = trimmedSearchQuery.toLowerCase();
  const searchLabel = trimmedSearchQuery ? `"${trimmedSearchQuery}"` : "esta búsqueda";
  const filteredProcesos = useMemo(() => {
    if (!normalizedSearchQuery) return procesos;
    return procesos.filter((proceso) => {
      const haystack = [
        proceso.numero_proceso,
        proceso.tipo_proceso,
        proceso.juzgado,
        proceso.descripcion,
        proceso.estado,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearchQuery);
    });
  }, [procesos, normalizedSearchQuery]);

  const selectedProceso = useMemo(
    () => procesos.find((proceso) => proceso.id === editingProcesoId),
    [procesos, editingProcesoId],
  );

  async function enviarRegistroPorCorreo(
    options?: EnviarRegistroOptions,
  ): Promise<EnviarRegistroResult> {
    if (enviandoRegistro) {
      const message = "Ya se está enviando un correo. Intenta nuevamente en unos segundos.";
      setEnvioError(message);
      return { success: false, errorMessage: message };
    }

    const normalizedRows = panelApoderados.map((row) => ({
      ...row,
      email: row.email.trim(),
    }));
    const recipients = normalizedRows.filter((row) => row.email);
    if (recipients.length === 0) {
      const message = "Agrega al menos un correo válido de apoderado.";
      setEnvioError(message);
      setEnvioMensaje(null);
      return { success: false, errorMessage: message };
    }

    const invalidRow = recipients.find((row) => row.email && !esEmailValido(row.email));
    if (invalidRow) {
      const message = `El correo de ${invalidRow.nombre || "el apoderado seleccionado"} no es válido.`;
      setEnvioError(message);
      setEnvioMensaje(null);
      return { success: false, errorMessage: message };
    }

    setEnvioError(null);
    setEnvioMensaje(null);
    setEnviandoRegistro(true);
    try {
      const procesoLabel =
        options?.procesoLabel ?? selectedProceso?.numero_proceso ?? "registro general";
      const totalProcesos = options?.totalProcesos ?? procesos.length;
      const procesoId = options?.procesoId ?? selectedProceso?.id;
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "https://autoactas.vercel.app";
      const subject = `Registro de procesos › ${procesoLabel}`;
      for (const recipient of recipients) {
        const tipoParam = recipient.categoria === "acreedor" ? "acreedor" : "deudor";
        const linkUrl = new URL("/registro", origin);
        if (procesoId) {
          linkUrl.searchParams.set("procesoId", procesoId);
        }
        linkUrl.searchParams.set("tipo", tipoParam);
        if (recipient.apoderadoId) {
          linkUrl.searchParams.set("apoderadoId", recipient.apoderadoId);
        } else if (recipient.nombre?.trim()) {
          linkUrl.searchParams.set("apoderadoName", recipient.nombre.trim());
        }
        const recipientFullName = recipient.nombre?.trim() || "apoderado";
        const recipientGreetingName = recipientFullName.split(" ")[0] || recipientFullName;
        const tipoLabel = tipoParam === "acreedor" ? "acreedores" : "deudores";
        const linkString = linkUrl.toString();
        const html = buildRegistroEmailHtml({
          recipientName: recipientGreetingName,
          link: linkString,
          tipoLabel,
          totalProcesos,
        });
        const text = buildRegistroEmailText({
          recipientName: recipientGreetingName,
          link: linkString,
        });
        await sendResendEmail({
          to: recipient.email,
          subject,
          html,
          text,
        });
      }

      const message = `Correos enviados a ${recipients.length} apoderado${
        recipients.length === 1 ? "" : "s"
      }.`;
      setEnvioMensaje(message);
      return {
        success: true,
        recipientsCount: recipients.length,
      };
    } catch (error) {
      console.error("Error enviando registro:", error);
      const message = error instanceof Error ? error.message : "No se pudo enviar el correo.";
      setEnvioError(message);
      return {
        success: false,
        errorMessage: message,
      };
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

          <Link

            href="/procesos/export"

            className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-100/60 px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-200/70 dark:border-indigo-400/60 dark:bg-indigo-500/10 dark:text-indigo-50 dark:hover:border-indigo-200 dark:hover:bg-indigo-500/20"

          >

            Exportar Word

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
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Indica si el apoderado representa a un acreedor o un deudor, luego escribe o busca su nombre.
                  Si el nombre coincide con uno existente se completará el correo automáticamente.
                </p>
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                    <span>Apoderados</span>
                    <button
                      type="button"
                      onClick={addPanelApoderadoRow}
                      className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10px]"
                    >
                      + agregar
                    </button>
                  </div>
                  <div className="space-y-3">
                    {panelApoderados.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex-1 min-w-[140px]">
                            <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Relación
                            </label>
                            <select
                              value={row.categoria}
                              onChange={(e) =>
                                handlePanelApoderadoCategoriaChange(
                                  row.id,
                                  e.target.value as PanelApoderadoRow["categoria"],
                                )
                              }
                              className="mt-1 h-9 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-3 text-xs outline-none dark:border-white/10 dark:bg-black/20"
                            >
                              <option value="acreedor">Acreedor</option>
                              <option value="deudor">Deudor</option>
                            </select>
                          </div>
                          {panelApoderados.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removePanelApoderadoRow(row.id)}
                              className="rounded-full bg-red-50 px-2 text-[11px] text-red-600 dark:bg-red-900/40 dark:text-red-300"
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Apoderado
                            </label>
                            <input
                              list="panel-apoderado-names"
                              value={row.nombre}
                              onChange={(e) =>
                                handlePanelApoderadoNombreChange(row.id, e.target.value)
                              }
                              placeholder="Nombre o búsqueda"
                              className="mt-1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none dark:border-white/10 dark:bg-black/20"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                              Correo
                            </label>
                            <input
                              value={row.email}
                              onChange={(e) =>
                                handlePanelApoderadoEmailChange(row.id, e.target.value)
                              }
                              placeholder="correo@firma.com"
                              className="mt-1 h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none dark:border-white/10 dark:bg-black/20"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <datalist id="panel-apoderado-names">
                      {apoderadoOptions.map((option) => (
                        <option key={option.id} value={option.nombre ?? ""} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  
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
                      className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-zinc-950 dark:text-zinc-950 outline-none"
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
                      className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-zinc-950 dark:text-zinc-950 outline-none"
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
                      className="h-10 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-zinc-950 dark:text-zinc-950 outline-none"
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
                      className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-zinc-950 dark:text-zinc-950 outline-none"
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
                    className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-zinc-950 dark:text-zinc-950 outline-none"
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
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 dark:text-zinc-950 outline-none"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={crearProcesoDesdePanel}
                    disabled={creandoProceso}
                    className="h-12 rounded-2xl bg-emerald-600 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-400 dark:text-black"
                  >
                    {creandoProceso ? "Creando proceso..." : "Guardar proceso y enviar correos a los apoderados"}
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

            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">Procesos Existentes</h2>
              <div className="w-full max-w-sm flex-1 sm:flex-none">
                <label htmlFor="procesos-search" className="sr-only">
                  Buscar procesos
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-zinc-400 dark:text-zinc-500">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      className="h-3.5 w-3.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12.5 13.5 17 18m-4.5-4.5a5 5 0 1 1-1.06-1.06L17 18"
                      />
                      <circle cx="8" cy="8" r="4.5" />
                    </svg>
                  </span>
                  <input
                    id="procesos-search"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar número, estado o juzgado"
                    className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-10 text-xs text-zinc-950 outline-none transition focus:border-zinc-950/30 focus:ring-2 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-zinc-50 dark:focus:border-white/30 dark:focus:ring-white/20"
                  />
                </div>
              </div>
            </div>

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

            ) : filteredProcesos.length === 0 ? (

              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">

                No se encontraron procesos que coincidan con {searchLabel}.

              </div>

            ) : (

              <div className="space-y-3 max-h-[600px] overflow-y-auto">

                {filteredProcesos.map((proceso) => {

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

