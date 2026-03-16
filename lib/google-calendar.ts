import type { SupabaseClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";
import type { Database } from "./database.types";
import {
  getGoogleCalendarOAuthAccessTokenByUsuarioId,
  isGoogleCalendarOAuthConfigured,
} from "./google-calendar-oauth";

type EventoRow = Database["public"]["Tables"]["eventos"]["Row"];

type GoogleCalendarConfig = {
  enabled: boolean;
  calendarId: string | null;
  clientEmail: string | null;
  privateKey: string | null;
  impersonateUserEmail: string | null;
  defaultDurationMinutes: number;
};

type GoogleCalendarAccessTokenResult = {
  accessToken: string;
  warningMessage: string | null;
};

type GoogleCalendarAuthorizationResult = {
  accessToken: string;
  warningMessage: string | null;
  manageAttendees: boolean;
  calendarId: string;
};

type GoogleCalendarContext = {
  procesoNumero: string | null;
  assignedUserName: string | null;
  assignedUserEmail: string | null;
  attendeeEmails: string[];
};

type GoogleCalendarEventPayload = {
  summary: string;
  description?: string;
  start: Record<string, string>;
  end: Record<string, string>;
  attendees?: Array<{ email: string }>;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: {
        type: "hangoutsMeet";
      };
    };
  };
};

type GoogleCalendarEventResponse = {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
    }>;
  };
};

export type GoogleCalendarSyncResult = {
  google_calendar_event_id: string | null;
  google_calendar_html_link: string | null;
  google_meet_url: string | null;
  google_sync_status: string | null;
  google_sync_error: string | null;
  google_sync_updated_at: string;
};

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_CALENDAR_TIMEZONE = "America/Bogota";

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw !== "string" || !raw.trim()) continue;
    return stripWrappingQuotes(raw);
  }
  return null;
}

function parsePrivateKey(raw: string | null) {
  return raw ? raw.replace(/\\n/g, "\n") : null;
}

function getGoogleCalendarConfig(): GoogleCalendarConfig {
  const defaultDurationRaw = readEnv("GOOGLE_CALENDAR_DEFAULT_DURATION_MINUTES");
  const defaultDurationMinutes = Number.parseInt(defaultDurationRaw ?? "60", 10);
  const calendarId = readEnv("GOOGLE_CALENDAR_ID");
  const clientEmail = readEnv("GOOGLE_CALENDAR_CLIENT_EMAIL", "GOOGLE_DRIVE_CLIENT_EMAIL");
  const privateKey = parsePrivateKey(
    readEnv("GOOGLE_CALENDAR_PRIVATE_KEY", "GOOGLE_DRIVE_PRIVATE_KEY"),
  );

  return {
    enabled: Boolean(calendarId && clientEmail && privateKey),
    calendarId,
    clientEmail,
    privateKey,
    impersonateUserEmail: readEnv("GOOGLE_CALENDAR_IMPERSONATE_USER_EMAIL"),
    defaultDurationMinutes:
      Number.isFinite(defaultDurationMinutes) && defaultDurationMinutes > 0
        ? defaultDurationMinutes
        : 60,
  };
}

export function isGoogleCalendarEnabled() {
  return getGoogleCalendarConfig().enabled;
}

function getGoogleCalendarDisabledReason(config: GoogleCalendarConfig) {
  const missing: string[] = [];
  if (!config.calendarId) missing.push("GOOGLE_CALENDAR_ID");
  if (!config.clientEmail) missing.push("GOOGLE_CALENDAR_CLIENT_EMAIL/GOOGLE_DRIVE_CLIENT_EMAIL");
  if (!config.privateKey) missing.push("GOOGLE_CALENDAR_PRIVATE_KEY/GOOGLE_DRIVE_PRIVATE_KEY");

  if (missing.length === 0) {
    return "La integracion con Google Calendar esta deshabilitada.";
  }

  return `La integracion con Google Calendar esta deshabilitada. Falta configurar: ${missing.join(", ")}.`;
}

function isValidEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeHoraHHMMSS(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const hhmmssMatch = trimmed.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (hhmmssMatch) return trimmed;

  const hhmmMatch = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (hhmmMatch) return `${trimmed}:00`;

  return null;
}

function addDaysToISODate(isoDate: string, days: number) {
  const base = new Date(`${isoDate}T00:00:00`);
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function resolveEndDateTime(evento: EventoRow, defaultDurationMinutes: number) {
  const startTime = normalizeHoraHHMMSS(evento.hora);
  if (!startTime) return null;

  const explicitEndTime = normalizeHoraHHMMSS(evento.hora_fin);
  const endDate = evento.fecha_fin?.trim() || evento.fecha;
  if (explicitEndTime) {
    return {
      dateTime: `${endDate}T${explicitEndTime}`,
      timeZone: GOOGLE_CALENDAR_TIMEZONE,
    };
  }

  const start = new Date(`${evento.fecha}T${startTime}${GOOGLE_CALENDAR_TIMEZONE === "America/Bogota" ? "-05:00" : ""}`);
  start.setMinutes(start.getMinutes() + defaultDurationMinutes);
  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, "0");
  const dd = String(start.getDate()).padStart(2, "0");
  const hh = String(start.getHours()).padStart(2, "0");
  const min = String(start.getMinutes()).padStart(2, "0");

  return {
    dateTime: `${yyyy}-${mm}-${dd}T${hh}:${min}:00`,
    timeZone: GOOGLE_CALENDAR_TIMEZONE,
  };
}

function buildEventDescription(evento: EventoRow, context: GoogleCalendarContext) {
  const lines: string[] = [];
  const descripcion = evento.descripcion?.trim();
  if (descripcion) {
    lines.push(descripcion, "");
  }

  lines.push("Generado desde AutoActas.");
  if (context.procesoNumero) lines.push(`Proceso: ${context.procesoNumero}`);
  if (context.assignedUserName) {
    lines.push(
      context.assignedUserEmail
        ? `Responsable: ${context.assignedUserName} <${context.assignedUserEmail}>`
        : `Responsable: ${context.assignedUserName}`,
    );
  }

  return lines.join("\n").trim();
}

function resolveMeetUrl(event: GoogleCalendarEventResponse) {
  if (event.hangoutLink?.trim()) return event.hangoutLink.trim();

  return (
    event.conferenceData?.entryPoints?.find(
      (entryPoint) => entryPoint.entryPointType === "video" && entryPoint.uri?.trim(),
    )?.uri?.trim() ?? null
  );
}

async function getGoogleAccessToken(
  config: GoogleCalendarConfig,
): Promise<GoogleCalendarAccessTokenResult> {
  if (!config.enabled || !config.clientEmail || !config.privateKey) {
    throw new Error("Google Calendar is not configured.");
  }

  const clientEmail = config.clientEmail;
  const privateKey = config.privateKey;

  const authorize = async (subject?: string | null) => {
    const jwtClient = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: [GOOGLE_CALENDAR_SCOPE],
      subject: subject ?? undefined,
    });

    const auth = await jwtClient.authorize();
    const accessToken = auth?.access_token ?? jwtClient.credentials.access_token ?? null;
    if (!accessToken) throw new Error("Failed to obtain Google Calendar access token.");
    return accessToken;
  };

  if (!config.impersonateUserEmail) {
    return {
      accessToken: await authorize(),
      warningMessage: null,
    };
  }

  try {
    return {
      accessToken: await authorize(config.impersonateUserEmail),
      warningMessage: null,
    };
  } catch (error) {
    const message = buildGoogleSyncError(error);
    if (!isUnauthorizedClientError(message)) {
      throw error;
    }

    return {
      accessToken: await authorize(),
      warningMessage: buildImpersonationFallbackWarning(config.impersonateUserEmail),
    };
  }
}

async function resolveGoogleCalendarAuthorization(
  config: GoogleCalendarConfig,
  usuarioId: string | null,
  fallbackUsuarioId: string | null = null,
): Promise<GoogleCalendarAuthorizationResult | null> {
  let oauthWarning: string | null = null;
  const candidateUsuarioIds = [usuarioId, fallbackUsuarioId].filter(
    (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index,
  );

  for (const candidateUsuarioId of candidateUsuarioIds) {
    try {
      const oauthAccount = await getGoogleCalendarOAuthAccessTokenByUsuarioId(candidateUsuarioId);
      if (oauthAccount) {
        return {
          accessToken: oauthAccount.accessToken,
          warningMessage: null,
          manageAttendees: true,
          calendarId: config.calendarId ?? "primary",
        };
      }
    } catch (error) {
      oauthWarning =
        "No se pudo usar la cuenta Google conectada del usuario y se utilizo la cuenta de servicio como respaldo.";
      console.warn(
        "[google-calendar] Unable to use Google OAuth account for usuario:",
        buildGoogleSyncError(error),
      );
    }
  }

  if (!config.enabled || !config.calendarId) {
    return null;
  }

  const authResult = await getGoogleAccessToken(config);
  return {
    accessToken: authResult.accessToken,
    warningMessage: appendWarningMessage(oauthWarning, authResult.warningMessage),
    manageAttendees: Boolean(config.impersonateUserEmail),
    calendarId: config.calendarId,
  };
}

async function loadGoogleCalendarContext(
  supabase: SupabaseClient<Database>,
  evento: EventoRow,
  manageAttendees: boolean,
): Promise<GoogleCalendarContext> {
  let procesoNumero: string | null = null;
  if (evento.proceso_id) {
    const { data, error } = await supabase
      .from("proceso")
      .select("numero_proceso")
      .eq("id", evento.proceso_id)
      .maybeSingle();
    if (!error) {
      procesoNumero = data?.numero_proceso ?? null;
    } else {
      console.warn("[google-calendar] Unable to load proceso for event:", error.message);
    }
  }

  let assignedUserName: string | null = null;
  let assignedUserEmail: string | null = null;
  if (evento.usuario_id) {
    const { data, error } = await supabase
      .from("usuarios")
      .select("nombre, email")
      .eq("id", evento.usuario_id)
      .maybeSingle();
    if (!error) {
      assignedUserName = data?.nombre ?? null;
      assignedUserEmail = data?.email?.trim() ?? null;
    } else {
      console.warn("[google-calendar] Unable to load assigned user for event:", error.message);
    }
  }

  const attendeeSet = new Set<string>();
  if (manageAttendees && evento.proceso_id) {
    const { data, error } = await supabase
      .from("apoderados")
      .select("email")
      .eq("proceso_id", evento.proceso_id)
      .not("email", "is", null);
    if (!error) {
      (data ?? []).forEach((row) => {
        const email = row.email?.trim().toLowerCase();
        if (isValidEmail(email)) attendeeSet.add(email);
      });
    } else {
      console.warn("[google-calendar] Unable to load apoderados for event:", error.message);
    }
  }

  if (manageAttendees && isValidEmail(assignedUserEmail)) {
    attendeeSet.add(assignedUserEmail.trim().toLowerCase());
  }

  return {
    procesoNumero,
    assignedUserName,
    assignedUserEmail,
    attendeeEmails: Array.from(attendeeSet),
  };
}

function buildGoogleCalendarPayload(
  evento: EventoRow,
  context: GoogleCalendarContext,
  config: GoogleCalendarConfig,
  manageAttendees: boolean,
): GoogleCalendarEventPayload {
  const startTime = normalizeHoraHHMMSS(evento.hora);
  const payload: GoogleCalendarEventPayload = {
    summary: evento.titulo,
    description: buildEventDescription(evento, context),
    start: startTime
      ? {
          dateTime: `${evento.fecha}T${startTime}`,
          timeZone: GOOGLE_CALENDAR_TIMEZONE,
        }
      : {
          date: evento.fecha,
        },
    end: startTime
      ? (resolveEndDateTime(evento, config.defaultDurationMinutes) ?? {
          dateTime: `${evento.fecha}T${startTime}`,
          timeZone: GOOGLE_CALENDAR_TIMEZONE,
        })
      : {
          date: addDaysToISODate(evento.fecha, 1),
        },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
  };

  if (manageAttendees) {
    payload.attendees = context.attendeeEmails.map((email) => ({ email }));
  }

  if (startTime && !evento.google_meet_url) {
    payload.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: {
          type: "hangoutsMeet",
        },
      },
    };
  }

  return payload;
}

function buildGoogleSyncError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "No se pudo sincronizar el evento con Google Calendar.";
}

function appendWarningMessage(base: string | null, next: string | null) {
  if (!base) return next;
  if (!next) return base;
  return `${base} ${next}`;
}

function isUnauthorizedClientError(message: string) {
  return message.toLowerCase().includes("unauthorized_client");
}

function buildImpersonationFallbackWarning(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const isPersonalGmail =
    normalizedEmail.endsWith("@gmail.com") || normalizedEmail.endsWith("@googlemail.com");

  if (isPersonalGmail) {
    return "GOOGLE_CALENDAR_IMPERSONATE_USER_EMAIL apunta a una cuenta personal de Gmail. La impersonacion solo funciona con usuarios de Google Workspace del dominio administrado, asi que se uso la cuenta de servicio sin impersonacion.";
  }

  return "La impersonacion configurada en GOOGLE_CALENDAR_IMPERSONATE_USER_EMAIL no esta autorizada. Revisa Domain-wide Delegation en Google Workspace; mientras tanto, se uso la cuenta de servicio sin impersonacion.";
}

function buildMeetFallbackWarning() {
  if (isGoogleCalendarOAuthConfigured()) {
    return "El evento se sincronizo en Google Calendar, pero esta cuenta no puede generar Google Meet. Para Gmail personal, conecta tu cuenta en Perfil > Google Calendar y vuelve a resincronizar el evento.";
  }

  return "El evento se sincronizo en Google Calendar, pero esta cuenta no puede generar Google Meet. Para Gmail personal debes configurar GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET, aplicar la migracion google_calendar_accounts y luego conectar tu cuenta desde Perfil > Google Calendar.";
}

function buildGoogleSyncResult(
  event: GoogleCalendarEventResponse,
  timestamp: string,
  googleSyncError: string | null = null,
): GoogleCalendarSyncResult {
  return {
    google_calendar_event_id: event.id?.trim() ?? null,
    google_calendar_html_link: event.htmlLink?.trim() ?? null,
    google_meet_url: resolveMeetUrl(event),
    google_sync_status: "synced",
    google_sync_error: googleSyncError,
    google_sync_updated_at: timestamp,
  };
}

function canRetryWithoutConference(detail: string) {
  const normalized = detail.toLowerCase();
  return normalized.includes("conference") || normalized.includes("hangout") || normalized.includes("meet");
}

function canRetryAsCreate(status: number, detail: string) {
  const normalized = detail.toLowerCase();
  return (
    status === 404 ||
    status === 410 ||
    normalized.includes("not found") ||
    normalized.includes("notfound")
  );
}

export async function syncEventoWithGoogleCalendar(params: {
  supabase: SupabaseClient<Database>;
  evento: EventoRow;
  fallbackUsuarioId?: string | null;
}): Promise<GoogleCalendarSyncResult> {
  const timestamp = new Date().toISOString();
  const config = getGoogleCalendarConfig();

  try {
    const authorization = await resolveGoogleCalendarAuthorization(
      config,
      params.evento.usuario_id ?? null,
      params.fallbackUsuarioId ?? null,
    );

    if (!authorization) {
      return {
        google_calendar_event_id: params.evento.google_calendar_event_id,
        google_calendar_html_link: params.evento.google_calendar_html_link,
        google_meet_url: params.evento.google_meet_url,
        google_sync_status: "disabled",
        google_sync_error: getGoogleCalendarDisabledReason(config),
        google_sync_updated_at: timestamp,
      };
    }

    const context = await loadGoogleCalendarContext(
      params.supabase,
      params.evento,
      authorization.manageAttendees,
    );
    const body = buildGoogleCalendarPayload(
      params.evento,
      context,
      config,
      authorization.manageAttendees,
    );
    const accessToken = authorization.accessToken;

    const doRequest = async (
      requestBody: GoogleCalendarEventPayload,
      method: "POST" | "PATCH",
      eventId: string | null,
    ) => {
      const targetUrl = eventId
        ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(authorization.calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=all`
        : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(authorization.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
      const response = await fetch(targetUrl, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const detail = await response.text().catch(() => "");
      return { response, detail };
    };

    let eventId = params.evento.google_calendar_event_id?.trim() || null;
    let method: "POST" | "PATCH" = eventId ? "PATCH" : "POST";
    let { response, detail } = await doRequest(body, method, eventId);
    let warningMessage: string | null = authorization.warningMessage;

    if (!response.ok && eventId && canRetryAsCreate(response.status, detail)) {
      eventId = null;
      method = "POST";
      ({ response, detail } = await doRequest(body, method, eventId));
      if (response.ok) {
        warningMessage = appendWarningMessage(
          warningMessage,
          "El evento anterior no existia en el calendario activo, asi que se creo uno nuevo en Google Calendar.",
        );
      }
    }

    if (!response.ok && body.conferenceData && canRetryWithoutConference(detail)) {
      const bodyWithoutConference: GoogleCalendarEventPayload = { ...body };
      delete bodyWithoutConference.conferenceData;
      ({ response, detail } = await doRequest(bodyWithoutConference, method, eventId));
      if (response.ok) {
        warningMessage = appendWarningMessage(
          warningMessage,
          buildMeetFallbackWarning(),
        );
      }
    }

    if (!response.ok) {
      throw new Error(
        `Google Calendar ${method === "POST" ? "insert" : "update"} failed (${response.status}): ${detail || response.statusText}`,
      );
    }

    const data = JSON.parse(detail) as GoogleCalendarEventResponse;
    return buildGoogleSyncResult(data, timestamp, warningMessage);
  } catch (error) {
    return {
      google_calendar_event_id: params.evento.google_calendar_event_id,
      google_calendar_html_link: params.evento.google_calendar_html_link,
      google_meet_url: params.evento.google_meet_url,
      google_sync_status: "error",
      google_sync_error: buildGoogleSyncError(error),
      google_sync_updated_at: timestamp,
    };
  }
}

export async function deleteEventoFromGoogleCalendar(params: {
  evento: EventoRow;
  fallbackUsuarioId?: string | null;
}) {
  const config = getGoogleCalendarConfig();
  const eventId = params.evento.google_calendar_event_id?.trim() || null;

  if (!eventId) return;

  const authorization = await resolveGoogleCalendarAuthorization(
    config,
    params.evento.usuario_id ?? null,
    params.fallbackUsuarioId ?? null,
  );
  if (!authorization) return;

  const accessToken = authorization.accessToken;
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(authorization.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.status === 404 || response.status === 410) return;

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Google Calendar delete failed (${response.status}): ${detail || response.statusText}`,
    );
  }
}
