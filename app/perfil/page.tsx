"use client";

import { FormEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { Database } from "@/lib/database.types";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type UsuarioRow = Database["public"]["Tables"]["usuarios"]["Row"];

type SignaturePoint = {
  x: number;
  y: number;
};

type UsuarioUpdate = Database["public"]["Tables"]["usuarios"]["Update"];

type GoogleCalendarStatus = {
  available: boolean;
  oauthConfigured?: boolean;
  storageReady?: boolean;
  connected: boolean;
  googleEmail: string | null;
  connectedAt: string | null;
  setupMessage?: string | null;
};

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 240;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code,
      record.error_description,
      record.status,
      record.statusText,
    ]
      .map((value) => (value === undefined || value === null ? "" : String(value).trim()))
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

function getMissingColumnFromPgrst204(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  if (record.code !== "PGRST204") return null;
  const message = typeof record.message === "string" ? record.message : "";
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match ? match[1] : null;
}

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): SignaturePoint {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isCanvasBlank(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) return false;
  }
  return true;
}

function normalizeStrokePixelsToBlack(image: ImageData) {
  const normalized = new ImageData(image.width, image.height);
  const src = image.data;
  const out = normalized.data;

  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3];
    if (alpha === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = alpha;
  }

  return normalized;
}

function exportSignatureAsBlackPng(canvas: HTMLCanvasElement) {
  const sourceCtx = canvas.getContext("2d");
  if (!sourceCtx) return null;

  const sourceImage = sourceCtx.getImageData(0, 0, canvas.width, canvas.height);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = canvas.width;
  outputCanvas.height = canvas.height;
  const outputCtx = outputCanvas.getContext("2d");
  if (!outputCtx) return null;

  outputCtx.putImageData(normalizeStrokePixelsToBlack(sourceImage), 0, 0);
  return outputCanvas.toDataURL("image/png");
}

export default function PerfilPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [perfil, setPerfil] = useState<UsuarioRow | null>(null);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [identificacion, setIdentificacion] = useState("");
  const [telefono, setTelefono] = useState("");
  const [tarjetaProfesional, setTarjetaProfesional] = useState("");
  const [rol, setRol] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
  const [disconnectingGoogleCalendar, setDisconnectingGoogleCalendar] = useState(false);

  const [hasSignature, setHasSignature] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<SignaturePoint | null>(null);

  const googleCalendarResult = searchParams.get("googleCalendar");
  const googleCalendarMessage = searchParams.get("googleCalendarMessage");

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
    } catch (err) {
      setGoogleCalendarError(toErrorMessage(err));
    } finally {
      setGoogleCalendarLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      setPerfil(null);
      return;
    }

    let canceled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from("usuarios")
          .select("*")
          .eq("auth_id", user.id)
          .maybeSingle();

        if (queryError) throw queryError;
        if (canceled) return;

        if (!data) {
          setPerfil(null);
          setError("No se encontro tu perfil en la tabla usuarios.");
          return;
        }

        setPerfil(data);
        setNombre(data.nombre ?? "");
        setEmail(data.email ?? user.email ?? "");
        setIdentificacion(data.identificacion ?? "");
        setTelefono(data.telefono ?? "");
        setTarjetaProfesional(data.tarjeta_profesional ?? "");
        setRol(data.rol ?? "");
        setHasSignature(Boolean(data.firma_data_url));
      } catch (err) {
        if (canceled) return;
        const message = toErrorMessage(err);
        setError(message || "No se pudo cargar el perfil.");
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [user?.id, user?.email]);

  useEffect(() => {
    void loadGoogleCalendarStatus();
  }, [loadGoogleCalendarStatus]);

  useEffect(() => {
    if (!googleCalendarResult) return;

    if (googleCalendarResult === "connected") {
      setSuccess("Google Calendar conectado correctamente.");
      setError(null);
      return;
    }

    if (googleCalendarResult === "error") {
      setError(googleCalendarMessage || "No se pudo completar la conexion con Google Calendar.");
      return;
    }

    if (googleCalendarResult === "disconnected") {
      setSuccess("Google Calendar desconectado.");
      setError(null);
    }
  }, [googleCalendarMessage, googleCalendarResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const firma = perfil?.firma_data_url;
    if (!firma) {
      setHasSignature(false);
      return;
    }

    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) return;

      tempCtx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const loadedImage = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
      ctx.putImageData(normalizeStrokePixelsToBlack(loadedImage), 0, 0);
      setHasSignature(true);
    };
    image.onerror = () => {
      if (!active) return;
      setHasSignature(false);
    };
    image.src = firma;

    return () => {
      active = false;
    };
  }, [perfil?.firma_data_url]);

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const point = getCanvasPoint(canvas, event.clientX, event.clientY);
    canvas.setPointerCapture(event.pointerId);

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);

    setIsDrawing(true);
    setLastPoint(point);
    setSuccess(null);
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPoint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const point = getCanvasPoint(canvas, event.clientX, event.clientY);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    setLastPoint(point);
    setHasSignature(true);
  };

  const stopDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    setIsDrawing(false);
    setLastPoint(null);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSuccess(null);
  };

  const handleConnectGoogleCalendar = () => {
    window.location.href = "/api/google-calendar/connect";
  };

  const handleDisconnectGoogleCalendar = async () => {
    setDisconnectingGoogleCalendar(true);
    setGoogleCalendarError(null);

    try {
      const response = await fetch("/api/google-calendar/disconnect", {
        method: "POST",
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error || "No se pudo desconectar Google Calendar.");
      }

      await loadGoogleCalendarStatus();
      setSuccess("Google Calendar desconectado.");
    } catch (err) {
      setGoogleCalendarError(toErrorMessage(err));
    } finally {
      setDisconnectingGoogleCalendar(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!perfil) return;

    const trimmedNombre = nombre.trim();
    if (!trimmedNombre) {
      setError("El nombre es obligatorio.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const canvas = canvasRef.current;
      const firmaDataUrl =
        canvas && !isCanvasBlank(canvas) ? exportSignatureAsBlackPng(canvas) : null;

      const payload: Record<string, unknown> = {
        nombre: trimmedNombre,
        identificacion: identificacion.trim() || null,
        telefono: telefono.trim() || null,
        tarjeta_profesional: tarjetaProfesional.trim() || null,
        firma_data_url: firmaDataUrl,
      };
      const omittedColumns: string[] = [];

      let updated: UsuarioRow | null = null;
      let latestError: unknown = null;

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data, error: updateError } = await supabase
          .from("usuarios")
          .update(payload as UsuarioUpdate)
          .eq("id", perfil.id)
          .select("*")
          .single();

        if (!updateError) {
          updated = data;
          latestError = null;
          break;
        }

        const missingColumn = getMissingColumnFromPgrst204(updateError);
        if (
          missingColumn &&
          Object.prototype.hasOwnProperty.call(payload, missingColumn) &&
          missingColumn !== "nombre"
        ) {
          delete payload[missingColumn];
          omittedColumns.push(missingColumn);
          latestError = updateError;
          continue;
        }

        latestError = updateError;
        break;
      }

      if (!updated) throw latestError ?? new Error("No se pudo guardar el perfil.");

      setPerfil(updated);
      setHasSignature(Boolean(updated.firma_data_url));
      if (omittedColumns.length > 0) {
        setSuccess(
          `Perfil guardado. Columnas pendientes en la base de datos: ${omittedColumns.join(
            ", "
          )}. Ejecuta las migraciones.`
        );
      } else {
        setSuccess("Perfil y firma guardados.");
      }
    } catch (err) {
      const message = toErrorMessage(err);
      setError(message || "No se pudo guardar el perfil.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Cargando perfil...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">No hay sesion activa.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 xl:max-w-[90rem] 2xl:max-w-[110rem]">
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
            Perfil de usuario
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Tus datos y firma
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Revisa y actualiza tus datos. Tambien puedes dibujar tu firma y guardarla.
          </p>
        </header>

        <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <form onSubmit={handleSave} className="space-y-6">
            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Google Calendar y Google Meet
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Para cuentas Gmail personales, conecta tu Google con OAuth. Esa conexion se usa
                    para crear eventos y, si tu cuenta lo permite, enlaces de Meet.
                  </p>
                  <div className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                    <p>
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
                    </p>
                    {formatDateTime(googleCalendarStatus.connectedAt) && (
                      <p>Ultima conexion: {formatDateTime(googleCalendarStatus.connectedAt)}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:items-end">
                  {googleCalendarStatus.connected ? (
                    <button
                      type="button"
                      onClick={() => void handleDisconnectGoogleCalendar()}
                      disabled={disconnectingGoogleCalendar}
                      className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                    >
                      {disconnectingGoogleCalendar ? "Desconectando..." : "Desconectar Google"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectGoogleCalendar}
                      disabled={!googleCalendarStatus.available}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
                    >
                      Conectar Gmail con Google
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
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Nombre
                </label>
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre completo"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Correo
                </label>
                <input
                  value={email}
                  readOnly
                  disabled
                  className="h-11 w-full cursor-not-allowed rounded-2xl border border-zinc-200 bg-zinc-100 px-4 text-sm text-zinc-600 outline-none dark:border-white/10 dark:bg-white/10 dark:text-zinc-300"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Identificacion
                </label>
                <input
                  value={identificacion}
                  onChange={(e) => setIdentificacion(e.target.value)}
                  placeholder="Numero de identificacion"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Telefono
                </label>
                <input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="Telefono de contacto"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Tarjeta profesional
                </label>
                <input
                  value={tarjetaProfesional}
                  onChange={(e) => setTarjetaProfesional(e.target.value)}
                  placeholder="Numero de tarjeta profesional"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Rol
                </label>
                <input
                  value={rol}
                  readOnly
                  disabled
                  className="h-11 w-full cursor-not-allowed rounded-2xl border border-zinc-200 bg-zinc-100 px-4 text-sm text-zinc-600 outline-none dark:border-white/10 dark:bg-white/10 dark:text-zinc-300"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Firma
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Dibuja tu firma dentro del recuadro.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Estado: {hasSignature ? "Con firma" : "Sin firma"}
                  </span>
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                className="h-56 w-full touch-none rounded-2xl border border-zinc-200 bg-white dark:border-white/20 dark:bg-white"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
                {success}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving || !perfil}
                className="h-11 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto dark:bg-white dark:text-black"
              >
                {saving ? "Guardando..." : "Guardar perfil"}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
