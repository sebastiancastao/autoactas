

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
import { updateProgresoByProcesoId } from "@/lib/api/progreso";
import type { Proceso, ProcesoInsert, Apoderado } from "@/lib/database.types";
import { getApoderados, updateApoderado } from "@/lib/api/apoderados";
import ProcesoForm from "@/components/proceso-form";
import { useProcesoForm } from "@/lib/hooks/useProcesoForm";
import { useRouter } from "next/navigation";
import { sendResendEmail } from "@/lib/api/resend";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

function esEmailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
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

function formatErrorForLog(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      return String(error);
    }
  }

  return String(error);
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

const createPanelApoderadoRow = (
  categoria: PanelApoderadoRow["categoria"] = "acreedor",
): PanelApoderadoRow => ({
  id: generateId(),
  categoria,
  apoderadoId: "",
  nombre: "",
  email: "",
});

const createDefaultPanelApoderados = (): PanelApoderadoRow[] => [
  createPanelApoderadoRow("acreedor"),
  createPanelApoderadoRow("deudor"),
];

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

type ExcelUploadResult = {
  id?: string;
  fileId: string;
  fileName: string;
  webViewLink: string | null;
  webContentLink: string | null;
  createdAt?: string;
};

type UsuarioCreatorMeta = {
  nombre: string;
  email: string;
};

type CreatorFilterOption = {
  authId: string;
  label: string;
  count: number;
};


export default function ProcesosPage() {

  const { user } = useAuth();

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
  const apoderadosByProcesoId = useMemo(() => {
    const byId: Record<string, Apoderado[]> = {};
    apoderadoOptions.forEach((ap) => {
      const pid = ap.proceso_id ?? "";
      if (!pid) return;
      if (!byId[pid]) byId[pid] = [];
      byId[pid].push(ap);
    });
    return byId;
  }, [apoderadoOptions]);

  const apoderadoById = useMemo(() => {
    const map: Record<string, Apoderado> = {};
    apoderadoOptions.forEach((ap) => {
      map[ap.id] = ap;
    });
    return map;
  }, [apoderadoOptions]);

  const [apoderadoSubmissionByProcesoId, setApoderadoSubmissionByProcesoId] = useState<
    Record<string, { deudorIds: string[]; acreedorIds: string[] }>
  >({});
  const [apoderadoSubmissionLoading, setApoderadoSubmissionLoading] = useState(false);

  const [autoAdmisorioStateByProcesoId, setAutoAdmisorioStateByProcesoId] = useState<
    Record<
      string,
      {
        loading: boolean;
        error: string | null;
        result: { fileId: string; fileName: string; webViewLink: string | null; apoderadoEmails?: string[] } | null;
        emailSending?: boolean;
        emailResult?: { sent: number; errors?: string[] } | null;
        emailError?: string | null;
      }
    >
  >({});

  const [panelApoderados, setPanelApoderados] = useState<PanelApoderadoRow[]>(
    () => createDefaultPanelApoderados(),
  );
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
  const [creatorFilter, setCreatorFilter] = useState<string>("all");
  const [usuariosByAuthId, setUsuariosByAuthId] = useState<Record<string, UsuarioCreatorMeta>>(
    {},
  );
  const [excelUploadModal, setExcelUploadModal] = useState<{
    procesoId: string;
    procesoNumero: string;
  } | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelUploadLoading, setExcelUploadLoading] = useState(false);
  const [excelUploadError, setExcelUploadError] = useState<string | null>(null);
  const [excelUploadByProcesoId, setExcelUploadByProcesoId] = useState<
    Record<string, ExcelUploadResult>
  >({});



  const router = useRouter();

  const refreshApoderadoOptions = useCallback(async () => {
    try {
      const data = await getApoderados();
      setApoderadoOptions(data ?? []);
    } catch (error) {
      console.error("Error refrescando apoderados:", error);
    }
  }, []);

  const handleSaveSuccess = useCallback(
    async (savedProceso: Proceso, context?: { isEditing: boolean }) => {
      setProcesos((prev) => {
        const exists = prev.some((proceso) => proceso.id === savedProceso.id);
        if (exists) {
          return prev.map((proceso) =>
            proceso.id === savedProceso.id ? savedProceso : proceso
          );
        }
        return [savedProceso, ...prev];
      });

      await refreshApoderadoOptions();

      if (context?.isEditing) {
        router.push(`/calendario?procesoId=${savedProceso.id}`);
      }
    },
    [router, refreshApoderadoOptions]
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

  const abrirModalExcel = (proceso: Proceso) => {
    setExcelUploadModal({
      procesoId: proceso.id,
      procesoNumero: proceso.numero_proceso || proceso.id,
    });
    setExcelFile(null);
    setExcelUploadError(null);
  };

  const cerrarModalExcel = () => {
    if (excelUploadLoading) return;
    setExcelUploadModal(null);
    setExcelFile(null);
    setExcelUploadError(null);
  };

  const subirExcelProceso = async () => {
    if (!excelUploadModal || !excelFile) return;

    setExcelUploadLoading(true);
    setExcelUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", excelFile);
      formData.append("procesoId", excelUploadModal.procesoId);
      formData.append("procesoNumero", excelUploadModal.procesoNumero);
      if (user?.id) {
        formData.append("authUserId", user.id);
      }

      const response = await fetch("/api/upload-excel", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as
        | ({
            id: string;
            procesoId: string;
            fileId: string;
            fileName: string;
            webViewLink: string | null;
            webContentLink: string | null;
            createdAt: string;
            error?: string;
            detail?: string;
          })
        | null;

      if (!response.ok || !payload?.fileId) {
        throw new Error(
          payload?.detail || payload?.error || "No se pudo subir el archivo de Excel."
        );
      }

      setExcelUploadByProcesoId((prev) => ({
        ...prev,
        [excelUploadModal.procesoId]: {
          id: payload.id,
          fileId: payload.fileId,
          fileName: payload.fileName,
          webViewLink: payload.webViewLink ?? null,
          webContentLink: payload.webContentLink ?? null,
          createdAt: payload.createdAt,
        },
      }));
      setExcelUploadModal(null);
      setExcelFile(null);
    } catch (error) {
      setExcelUploadError(
        error instanceof Error ? error.message : "No se pudo subir el archivo de Excel."
      );
    } finally {
      setExcelUploadLoading(false);
    }
  };



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
    (async () => {
      try {
        const { data, error } = await supabase
          .from("usuarios")
          .select("auth_id, nombre, email")
          .not("auth_id", "is", null);
        if (error) throw error;
        if (!active) return;

        const map: Record<string, UsuarioCreatorMeta> = {};
        (data ?? []).forEach((row) => {
          const authId = row.auth_id?.trim();
          if (!authId) return;
          map[authId] = {
            nombre: row.nombre?.trim() || row.email?.trim() || authId,
            email: row.email?.trim() || "",
          };
        });
        setUsuariosByAuthId(map);
      } catch (error) {
        console.error("Error loading usuarios for creator filter:", error);
      }
    })();

    return () => {
      active = false;
    };
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

  useEffect(() => {
    const ids = (procesos ?? []).map((p) => p.id).filter(Boolean);
    if (ids.length === 0) {
      setApoderadoSubmissionByProcesoId({});
      return;
    }

    let canceled = false;
    (async () => {
      setApoderadoSubmissionLoading(true);
      try {
        const { data: deudores, error: deudorError } = await supabase
          .from("deudores")
          .select("proceso_id, apoderado_id")
          .in("proceso_id", ids)
          .not("apoderado_id", "is", null);
        if (deudorError) throw deudorError;

        const { data: acreedores, error: acreedorError } = await supabase
          .from("acreedores")
          .select("proceso_id, apoderado_id")
          .in("proceso_id", ids)
          .not("apoderado_id", "is", null);
        if (acreedorError) throw acreedorError;

        const map = new Map<string, { deudor: Set<string>; acreedor: Set<string> }>();
        const ensure = (pid: string) => {
          const existing = map.get(pid);
          if (existing) return existing;
          const created = { deudor: new Set<string>(), acreedor: new Set<string>() };
          map.set(pid, created);
          return created;
        };

        (deudores ?? []).forEach((row: { proceso_id: string | null; apoderado_id: string | null }) => {
          const pid = row.proceso_id;
          const aid = row.apoderado_id;
          if (!pid || !aid) return;
          ensure(pid).deudor.add(aid);
        });

        (acreedores ?? []).forEach((row: { proceso_id: string | null; apoderado_id: string | null }) => {
          const pid = row.proceso_id;
          const aid = row.apoderado_id;
          if (!pid || !aid) return;
          ensure(pid).acreedor.add(aid);
        });

        const out: Record<string, { deudorIds: string[]; acreedorIds: string[] }> = {};
        ids.forEach((pid) => {
          const sets = map.get(pid);
          out[pid] = {
            deudorIds: sets ? Array.from(sets.deudor) : [],
            acreedorIds: sets ? Array.from(sets.acreedor) : [],
          };
        });

        if (!canceled) setApoderadoSubmissionByProcesoId(out);
      } catch (err) {
        console.error("Error loading apoderado submission summary:", err);
        if (!canceled) setApoderadoSubmissionByProcesoId({});
      } finally {
        if (!canceled) setApoderadoSubmissionLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [procesos]);

  useEffect(() => {
    const procesoIds = (procesos ?? []).map((p) => p.id).filter(Boolean);
    if (procesoIds.length === 0) {
      setExcelUploadByProcesoId({});
      return;
    }

    let canceled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          procesoIds: procesoIds.join(","),
        });
        const response = await fetch(`/api/upload-excel?${params.toString()}`);
        const payload = (await response.json().catch(() => null)) as
          | {
              files?: Array<{
                id: string;
                proceso_id: string;
                drive_file_id: string;
                drive_file_name: string;
                drive_web_view_link: string | null;
                drive_web_content_link: string | null;
                created_at: string;
              }>;
              error?: string;
              detail?: string;
            }
          | null;

        if (!response.ok) {
          throw new Error(payload?.detail || payload?.error || "No se pudieron cargar los Excel.");
        }

        const nextByProcesoId: Record<string, ExcelUploadResult> = {};
        (payload?.files ?? []).forEach((row) => {
          nextByProcesoId[row.proceso_id] = {
            id: row.id,
            fileId: row.drive_file_id,
            fileName: row.drive_file_name,
            webViewLink: row.drive_web_view_link ?? null,
            webContentLink: row.drive_web_content_link ?? null,
            createdAt: row.created_at,
          };
        });

        if (!canceled) {
          setExcelUploadByProcesoId(nextByProcesoId);
        }
      } catch (error) {
        console.error("Error loading persisted Excel files:", error);
        if (!canceled) {
          setExcelUploadByProcesoId({});
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [procesos]);

  async function crearAutoAdmisorioDesdeProceso(proceso: Proceso) {
    const pid = proceso.id;
    setAutoAdmisorioStateByProcesoId((prev) => ({
      ...prev,
      [pid]: { loading: true, error: null, result: prev[pid]?.result ?? null },
    }));

    try {
      const res = await fetch("/api/crear-auto-admisorio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procesoId: pid, authUserId: user?.id }),
      });
      const json = (await res.json().catch(() => null)) as
        | { fileId: string; fileName: string; webViewLink: string | null; apoderadoEmails?: string[]; error?: string; detail?: string }
        | null;

      if (!res.ok || !json?.fileId) {
        throw new Error(json?.detail || json?.error || "No se pudo crear el auto admisorio.");
      }

      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [pid]: {
          loading: false,
          error: null,
          result: { fileId: json.fileId, fileName: json.fileName, webViewLink: json.webViewLink ?? null, apoderadoEmails: json.apoderadoEmails },
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [pid]: { loading: false, error: msg, result: prev[pid]?.result ?? null },
      }));
    }
  }

  async function enviarAutoAdmisorioApoderados(procesoId: string, proceso: Proceso) {
    const state = autoAdmisorioStateByProcesoId[procesoId];
    if (!state?.result?.webViewLink || state.emailSending) return;

    const emails = state.result.apoderadoEmails ?? [];
    if (emails.length === 0) return;

    setAutoAdmisorioStateByProcesoId((prev) => ({
      ...prev,
      [procesoId]: { ...prev[procesoId], emailSending: true, emailError: null, emailResult: null },
    }));

    try {
      const res = await fetch("/api/enviar-acta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apoderadoEmails: emails,
          numeroProceso: proceso.numero_proceso || procesoId,
          titulo: "Auto de Admisión",
          fecha: new Date().toISOString().slice(0, 10),
          webViewLink: state.result.webViewLink,
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
          emailResult: { sent: json?.emailsSent ?? 0, errors: json?.emailErrors },
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAutoAdmisorioStateByProcesoId((prev) => ({
        ...prev,
        [procesoId]: { ...prev[procesoId], emailSending: false, emailError: msg },
      }));
    }
  }

  async function crearProcesoDesdePanel() {
    if (creandoProceso) return;
    if (!nuevoProceso.numero.trim()) {
      setMensajeProceso("El número de proceso es obligatorio.");
      return;
    }
    setCreandoProceso(true);
    setMensajeProceso(null);
    try {
      let currentUsuarioId: string | null = null;
      if (user?.id) {
        try {
          const { data: usuarioPerfil } = await supabase
            .from("usuarios")
            .select("id")
            .eq("auth_id", user.id)
            .maybeSingle();
          currentUsuarioId = usuarioPerfil?.id ?? null;
        } catch (lookupError) {
          console.warn("No se pudo resolver usuario_id para proceso:", lookupError);
        }
      }

      let apoderadoSyncWarning: string | null = null;
      const payload: ProcesoInsert = {
        numero_proceso: nuevoProceso.numero.trim(),
        fecha_procesos: nuevoProceso.fecha || new Date().toISOString().slice(0, 10),
        estado: nuevoProceso.estado || "Activo",
        tipo_proceso: nuevoProceso.tipo || null,
        juzgado: nuevoProceso.juzgado || null,
        descripcion: nuevoProceso.descripcion || null,
        created_by_auth_id: user?.id ?? null,
        usuario_id: currentUsuarioId,
      };
      const nuevo = await createProceso(payload);
      const panelApoderadoIds = Array.from(
        new Set(
          panelApoderados
            .map((row) => row.apoderadoId.trim())
            .filter((id) => id.length > 0),
        ),
      );
      if (panelApoderadoIds.length > 0) {
        const updateResults = await Promise.allSettled(
          panelApoderadoIds.map((apoderadoId) =>
            updateApoderado(apoderadoId, { proceso_id: nuevo.id }),
          ),
        );
        const updatedIds: string[] = [];
        const failedCount = updateResults.reduce((count, result, index) => {
          if (result.status === "fulfilled") {
            updatedIds.push(panelApoderadoIds[index]);
            return count;
          }
          return count + 1;
        }, 0);
        if (updatedIds.length > 0) {
          const panelApoderadoIdSet = new Set(updatedIds);
          setApoderadoOptions((prev) =>
            prev.map((apoderado) =>
              panelApoderadoIdSet.has(apoderado.id)
                ? { ...apoderado, proceso_id: nuevo.id }
                : apoderado,
            ),
          );
        }
        if (failedCount > 0) {
          apoderadoSyncWarning = `No se pudo actualizar el proceso de ${failedCount} apoderado${
            failedCount === 1 ? "" : "s"
          }.`;
        }
      }
      // Ensure progreso exists for the new proceso and starts as "no_iniciado".
      try {
        await updateProgresoByProcesoId(nuevo.id, { estado: "no_iniciado" });
      } catch (err) {
        console.error("Error initializing progreso for new proceso:", err);
      }
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
      if (apoderadoSyncWarning) {
        mensaje += ` ${apoderadoSyncWarning}`;
      }
      setMensajeProceso(mensaje);
    } catch (error) {
      const errorMessage = getErrorMessage(error, "No se pudo crear el proceso.");
      console.warn("No se pudo crear proceso desde panel:", formatErrorForLog(error));
      setMensajeProceso(errorMessage);
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

  const creatorStats = useMemo(() => {
    const countByAuthId = new Map<string, number>();
    let unassignedCount = 0;

    for (const proceso of procesos) {
      const authId = proceso.created_by_auth_id?.trim();
      if (!authId) {
        unassignedCount += 1;
        continue;
      }
      countByAuthId.set(authId, (countByAuthId.get(authId) ?? 0) + 1);
    }

    const options: CreatorFilterOption[] = Array.from(countByAuthId.entries())
      .map(([authId, count]) => {
        const usuario = usuariosByAuthId[authId];
        return {
          authId,
          label: usuario?.nombre || usuario?.email || authId,
          count,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

    const myCount = user?.id ? countByAuthId.get(user.id) ?? 0 : 0;

    return {
      options,
      myCount,
      unassignedCount,
    };
  }, [procesos, usuariosByAuthId, user?.id]);

  useEffect(() => {
    if (creatorFilter === "all" || creatorFilter === "mine" || creatorFilter === "none") return;
    const exists = creatorStats.options.some((option) => option.authId === creatorFilter);
    if (!exists) {
      setCreatorFilter("all");
    }
  }, [creatorFilter, creatorStats.options]);

  const creatorFilterLabel = useMemo(() => {
    if (creatorFilter === "all") return "todos los usuarios";
    if (creatorFilter === "mine") return "tu usuario";
    if (creatorFilter === "none") return "sin usuario creador";
    const option = creatorStats.options.find((item) => item.authId === creatorFilter);
    return option?.label ?? "el usuario seleccionado";
  }, [creatorFilter, creatorStats.options]);

  const visibleProcesos = useMemo(() => {
    if (creatorFilter === "all") return filteredProcesos;
    if (creatorFilter === "mine") {
      if (!user?.id) return [];
      return filteredProcesos.filter((proceso) => proceso.created_by_auth_id === user.id);
    }
    if (creatorFilter === "none") {
      return filteredProcesos.filter((proceso) => !proceso.created_by_auth_id);
    }
    return filteredProcesos.filter((proceso) => proceso.created_by_auth_id === creatorFilter);
  }, [creatorFilter, filteredProcesos, user?.id]);

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



      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">

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
            <div className="flex flex-wrap items-start justify-between gap-3">
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
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
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
                          <div className="min-w-0 flex-1 sm:min-w-[140px]">
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



          <section className="h-full min-h-0 rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6 flex flex-col">

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
              <div className="w-full max-w-sm flex-1 sm:flex-none">
                <label htmlFor="procesos-creator-filter" className="sr-only">
                  Filtrar por usuario creador
                </label>
                <select
                  id="procesos-creator-filter"
                  value={creatorFilter}
                  onChange={(e) => setCreatorFilter(e.target.value)}
                  className="h-10 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-zinc-950 outline-none transition focus:border-zinc-950/30 focus:ring-2 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:text-zinc-50 dark:focus:border-white/30 dark:focus:ring-white/20"
                >
                  <option value="all">Todos los usuarios ({procesos.length})</option>
                  {user?.id && <option value="mine">Mis procesos ({creatorStats.myCount})</option>}
                  {creatorStats.options.map((option) => (
                    <option key={option.authId} value={option.authId}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                  {creatorStats.unassignedCount > 0 && (
                    <option value="none">
                      Sin usuario creador ({creatorStats.unassignedCount})
                    </option>
                  )}
                </select>
              </div>
            </div>

            {listError && (

              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">

                {listError}

              </div>

            )}



            <div className="min-h-0 flex-1">
              {cargando ? (

                <div className="text-sm text-zinc-500 dark:text-zinc-400">Cargando procesos...</div>

              ) : procesos.length === 0 ? (

                <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">

                  No hay procesos registrados.

                </div>

              ) : visibleProcesos.length === 0 ? (

                <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">

                  No se encontraron procesos que coincidan con {searchLabel} para {creatorFilterLabel}.

                </div>

              ) : (

                <div className="h-full space-y-3 overflow-y-auto pr-1">

                {visibleProcesos.map((proceso) => {

                  const isSelected = editingProcesoId === proceso.id;
                  const submission = apoderadoSubmissionByProcesoId[proceso.id] ?? { deudorIds: [], acreedorIds: [] };
                  // Merge apoderados from proceso_id ownership AND from actual submissions
                  const apoderadosDelProceso = (() => {
                    const seen = new Set<string>();
                    const result: Apoderado[] = [];
                    const addUnique = (ap: Apoderado) => {
                      if (!seen.has(ap.id)) {
                        seen.add(ap.id);
                        result.push(ap);
                      }
                    };
                    (apoderadosByProcesoId[proceso.id] ?? []).forEach(addUnique);
                    for (const aid of submission.deudorIds) {
                      const ap = apoderadoById[aid];
                      if (ap) addUnique(ap);
                    }
                    for (const aid of submission.acreedorIds) {
                      const ap = apoderadoById[aid];
                      if (ap) addUnique(ap);
                    }
                    return result;
                  })();
                  const deudorSet = new Set(submission.deudorIds);
                  const acreedorSet = new Set(submission.acreedorIds);
                  const submittedAnyCount = apoderadosDelProceso.filter((ap) => deudorSet.has(ap.id) || acreedorSet.has(ap.id)).length;
                  const hasApoderadosIncompletos =
                    apoderadosDelProceso.length > 0 && submittedAnyCount < apoderadosDelProceso.length;
                  const autoState = autoAdmisorioStateByProcesoId[proceso.id] ?? { loading: false, error: null, result: null };
                  const excelUpload = excelUploadByProcesoId[proceso.id] ?? null;

                  return (

                    <div

                      key={proceso.id}

                      onClick={() => {
                        setFormVisible(true);
                        void cargarProcesoDetalle(proceso.id);
                      }}

                      className={[

                        "w-full text-left transition cursor-pointer",

                        "rounded-2xl border p-4 shadow-sm",

                        isSelected

                          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"

                          : "border-zinc-200 bg-white/60 hover:border-zinc-800 dark:border-white/10 dark:bg-white/5",

                        cargandoDetalle && !isSelected ? "opacity-50 pointer-events-none" : "",

                      ].join(" ")}

                    >

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

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

                          <div className="mt-3 flex flex-col gap-2">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">
                              Apoderados:{" "}
                              <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                                {submittedAnyCount}/{apoderadosDelProceso.length}
                              </span>{" "}
                              {apoderadoSubmissionLoading ? "(cargando...)" : "registrados"}
                            </div>
                            {apoderadosDelProceso.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {apoderadosDelProceso.slice(0, 6).map((ap) => {
                                  const didD = deudorSet.has(ap.id);
                                  const didA = acreedorSet.has(ap.id);
                                  const ok = didD || didA;
                                  const flags = `${didD ? "D" : ""}${didA ? "A" : ""}`;
                                  return (
                                    <span
                                      key={ap.id}
                                      className={[
                                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                        ok
                                          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
                                          : "border-zinc-200 bg-white/60 text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300",
                                      ].join(" ")}
                                    >
                                      <span className={ok ? "h-1.5 w-1.5 rounded-full bg-green-500" : "h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600"} />
                                      <span className="truncate max-w-[160px]">{ap.nombre}</span>
                                      {flags ? <span className="opacity-70">{flags}</span> : null}
                                    </span>
                                  );
                                })}
                                {apoderadosDelProceso.length > 6 && (
                                  <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                                    +{apoderadosDelProceso.length - 6}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

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

                      <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">

                        {autoState.error && (
                          <div className="mr-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                            {autoState.error}
                          </div>
                        )}

                        {autoState.result?.webViewLink && (
                          <div className="mr-3 flex flex-col gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                            <div>
                              Auto admisorio:{" "}
                              <a
                                href={autoState.result.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold underline underline-offset-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Abrir en Drive
                              </a>
                            </div>

                            {autoState.result.apoderadoEmails && autoState.result.apoderadoEmails.length > 0 && !autoState.emailResult && (
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500 dark:text-zinc-400">
                                  {autoState.result.apoderadoEmails.length} apoderado{autoState.result.apoderadoEmails.length > 1 ? "s" : ""} con correo
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void enviarAutoAdmisorioApoderados(proceso.id, proceso);
                                  }}
                                  disabled={autoState.emailSending}
                                  className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 transition hover:border-blue-500 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/60"
                                >
                                  {autoState.emailSending ? "Enviando..." : "Enviar a apoderados"}
                                </button>
                              </div>
                            )}

                            {autoState.result.apoderadoEmails && autoState.result.apoderadoEmails.length === 0 && (
                              <span className="text-zinc-400 dark:text-zinc-500">No hay apoderados con correo registrado</span>
                            )}

                            {autoState.emailError && (
                              <span className="text-red-600 dark:text-red-400">{autoState.emailError}</span>
                            )}

                            {autoState.emailResult && (
                              <span className="text-green-600 dark:text-green-400">
                                Correos enviados: {autoState.emailResult.sent}
                                {autoState.emailResult.errors && autoState.emailResult.errors.length > 0 && (
                                  <span className="text-amber-600 dark:text-amber-400"> ({autoState.emailResult.errors.length} fallidos)</span>
                                )}
                              </span>
                            )}
                          </div>
                        )}

                        {excelUpload && (
                          <div className="mr-3 flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                            <span className="font-medium">Excel: {excelUpload.fileName}</span>
                            {excelUpload.webViewLink && (
                              <a
                                href={excelUpload.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold underline underline-offset-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Abrir en Drive
                              </a>
                            )}
                          </div>
                        )}
 
                        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
 
                          {isSelected ? "Editando este proceso" : "Haz clic para cargar y editar"}
 
                        </p>

                        <div className="flex flex-wrap gap-2">

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
                              if (hasApoderadosIncompletos) {
                                const continuar = window.confirm(
                                  `Este proceso tiene apoderados sin registrar (${submittedAnyCount}/${apoderadosDelProceso.length}). ¿Deseas crear el auto admisorio de todas formas?`,
                                );
                                if (!continuar) return;
                              }
                              void crearAutoAdmisorioDesdeProceso(proceso);
                            }}
                            disabled={autoState.loading}
                            className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:border-amber-500 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:border-amber-700 dark:hover:bg-amber-950/60"
                          >
                            {autoState.loading ? "Creando..." : "Crear auto admisorio"}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirModalExcel(proceso);
                            }}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/60"
                          >
                            {excelUpload ? "Reemplazar Excel" : "Subir Proyección de Pagos"}
                          </button>

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
            </div>

          </section>

        </div>

        {excelUploadModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
            <div
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={cerrarModalExcel}
            />
            <div className="relative z-10 w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-900 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Subir Proyección de Pagos
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Proceso: {excelUploadModal.procesoNumero}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cerrarModalExcel}
                  disabled={excelUploadLoading}
                  className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Archivo Excel (.xlsx o .xls)
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)}
                    className="block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-white"
                  />
                  {excelFile && (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Seleccionado: {excelFile.name}
                    </p>
                  )}
                </div>

                {excelUploadError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {excelUploadError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={cerrarModalExcel}
                    disabled={excelUploadLoading}
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void subirExcelProceso()}
                    disabled={!excelFile || excelUploadLoading}
                    className="h-10 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400 dark:text-black dark:hover:bg-emerald-300"
                  >
                    {excelUploadLoading ? "Subiendo..." : "Subir Proyección de Pagos"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

    </div>

  );

}


