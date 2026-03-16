import { OAuth2Client } from "google-auth-library";
import type { Database } from "./database.types";
import { createAdminSupabase } from "./supabase-admin";

type GoogleCalendarAccountRow = Database["public"]["Tables"]["google_calendar_accounts"]["Row"];

type GoogleCalendarOAuthConfig = {
  clientId: string | null;
  clientSecret: string | null;
};

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive";

export type GoogleCalendarOAuthAccount = Pick<
  GoogleCalendarAccountRow,
  "google_email" | "created_at" | "updated_at" | "scope"
>;

const GOOGLE_CALENDAR_ACCOUNTS_TABLE = "public.google_calendar_accounts";

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

function readEnv(name: string) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return null;
  return stripWrappingQuotes(raw);
}

export function getGoogleCalendarOAuthConfig(): GoogleCalendarOAuthConfig {
  return {
    clientId: readEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: readEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
  };
}

export function isGoogleCalendarOAuthConfigured() {
  const config = getGoogleCalendarOAuthConfig();
  return Boolean(config.clientId && config.clientSecret);
}

export function isMissingGoogleCalendarAccountsTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return (
    (code === "PGRST205" || code === "42P01") &&
    message.toLowerCase().includes(GOOGLE_CALENDAR_ACCOUNTS_TABLE.toLowerCase())
  );
}

export function getGoogleCalendarOAuthStorageMissingMessage() {
  return "Falta aplicar la migracion google_calendar_accounts antes de conectar Gmail con Google Calendar.";
}

export function getGoogleCalendarOAuthScopes() {
  return [
    GOOGLE_CALENDAR_SCOPE,
    GOOGLE_DRIVE_FILE_SCOPE,
    "openid",
    "email",
  ];
}

function parseGrantedScopes(scope: string | null | undefined) {
  return new Set(
    String(scope ?? "")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function hasGoogleDriveOAuthScope(scope: string | null | undefined) {
  const grantedScopes = parseGrantedScopes(scope);
  return (
    grantedScopes.has(GOOGLE_DRIVE_FILE_SCOPE) ||
    grantedScopes.has(GOOGLE_DRIVE_FULL_SCOPE)
  );
}

export function createGoogleCalendarOAuthClient(redirectUri?: string) {
  const config = getGoogleCalendarOAuthConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Missing Google OAuth client configuration.");
  }

  return new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
}

export function getGoogleCalendarOAuthRedirectUri(origin: string) {
  const configuredRedirectUri = readEnv("GOOGLE_OAUTH_REDIRECT_URI");
  if (configuredRedirectUri) return configuredRedirectUri;
  return new URL("/api/google-calendar/oauth/callback", origin).toString();
}

export async function getGoogleCalendarOAuthAccountByUsuarioId(usuarioId: string) {
  const adminSupabase = createAdminSupabase();
  const { data, error } = await adminSupabase
    .from("google_calendar_accounts")
    .select("google_email, created_at, updated_at, scope")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (error) {
    if (isMissingGoogleCalendarAccountsTableError(error)) return null;
    throw error;
  }
  return (data ?? null) as GoogleCalendarOAuthAccount | null;
}

export async function getGoogleCalendarOAuthAccessTokenByUsuarioId(usuarioId: string) {
  if (!isGoogleCalendarOAuthConfigured()) return null;

  const adminSupabase = createAdminSupabase();
  const { data, error } = await adminSupabase
    .from("google_calendar_accounts")
    .select("refresh_token, google_email, scope")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (error) {
    if (isMissingGoogleCalendarAccountsTableError(error)) return null;
    throw error;
  }
  if (!data?.refresh_token) return null;

  const client = createGoogleCalendarOAuthClient();
  client.setCredentials({ refresh_token: data.refresh_token });
  const accessTokenResult = await client.getAccessToken();
  const accessToken = accessTokenResult.token?.trim() ?? null;
  if (!accessToken) {
    throw new Error("Failed to obtain Google OAuth access token.");
  }

  return {
    accessToken,
    googleEmail: data.google_email,
    scope: data.scope ?? null,
  };
}

export async function getGoogleDriveOAuthAccessTokenByUsuarioId(usuarioId: string) {
  const authorization = await getGoogleCalendarOAuthAccessTokenByUsuarioId(usuarioId);
  if (!authorization) return null;
  if (!hasGoogleDriveOAuthScope(authorization.scope)) return null;
  return authorization;
}

export async function upsertGoogleCalendarOAuthAccount(params: {
  usuarioId: string;
  googleEmail: string;
  refreshToken: string;
  scope?: string | null;
  tokenType?: string | null;
}) {
  const adminSupabase = createAdminSupabase();
  const timestamp = new Date().toISOString();

  const { error } = await adminSupabase
    .from("google_calendar_accounts")
    .upsert(
      {
        usuario_id: params.usuarioId,
        google_email: params.googleEmail,
        refresh_token: params.refreshToken,
        scope: params.scope ?? null,
        token_type: params.tokenType ?? null,
        updated_at: timestamp,
      },
      {
        onConflict: "usuario_id",
      },
    );

  if (error) {
    if (isMissingGoogleCalendarAccountsTableError(error)) {
      throw new Error(getGoogleCalendarOAuthStorageMissingMessage());
    }
    throw error;
  }
}

export async function deleteGoogleCalendarOAuthAccountByUsuarioId(usuarioId: string) {
  const adminSupabase = createAdminSupabase();
  const { error } = await adminSupabase
    .from("google_calendar_accounts")
    .delete()
    .eq("usuario_id", usuarioId);

  if (error) {
    if (isMissingGoogleCalendarAccountsTableError(error)) return;
    throw error;
  }
}

export async function isGoogleCalendarOAuthStorageReady() {
  const adminSupabase = createAdminSupabase();
  const { error } = await adminSupabase
    .from("google_calendar_accounts")
    .select("id", { head: true, count: "exact" });

  if (!error) return true;
  if (isMissingGoogleCalendarAccountsTableError(error)) return false;
  throw error;
}
