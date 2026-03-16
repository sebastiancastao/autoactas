import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleCalendarOAuthClient,
  getGoogleCalendarOAuthRedirectUri,
  upsertGoogleCalendarOAuthAccount,
} from "@/lib/google-calendar-oauth";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { createRouteHandlerSupabase } from "@/lib/supabase-route";

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "google_calendar_oauth_state";
const GOOGLE_CALENDAR_OAUTH_RETURN_TO_COOKIE = "google_calendar_oauth_return_to";

export const runtime = "nodejs";

function normalizeReturnTo(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/perfil";
  return raw;
}

function redirectToTarget(
  request: NextRequest,
  returnTo: string,
  status: string,
  message?: string,
) {
  const url = new URL(normalizeReturnTo(returnTo), request.nextUrl.origin);
  url.searchParams.set("googleCalendar", status);
  if (message) url.searchParams.set("googleCalendarMessage", message);
  return NextResponse.redirect(url);
}

async function resolveUsuarioId(authUserId: string) {
  const adminSupabase = createAdminSupabase();
  const { data, error } = await adminSupabase
    .from("usuarios")
    .select("id")
    .eq("auth_id", authUserId)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value ?? null;
  const returnTo = normalizeReturnTo(
    request.cookies.get(GOOGLE_CALENDAR_OAUTH_RETURN_TO_COOKIE)?.value ?? "/perfil",
  );

  if (!code || !state || !storedState || state !== storedState) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      "La respuesta de Google no coincide con la solicitud iniciada.",
    );
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      "Tu sesion expiro antes de completar la conexion.",
    );
  }

  const usuarioId = await resolveUsuarioId(user.id);
  if (!usuarioId) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      "No se encontro el perfil interno del usuario.",
    );
  }

  try {
    const redirectUri = getGoogleCalendarOAuthRedirectUri(request.nextUrl.origin);
    const client = createGoogleCalendarOAuthClient(redirectUri);
    const { tokens } = await client.getToken(code);
    const refreshToken = tokens.refresh_token?.trim() ?? null;
    const accessToken = tokens.access_token?.trim() ?? null;

    if (!refreshToken || !accessToken) {
      return redirectToTarget(
        request,
        returnTo,
        "error",
        "Google no devolvio refresh token. Intenta desconectar y conectar de nuevo.",
      );
    }

    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const userInfo = (await userInfoResponse.json().catch(() => null)) as { email?: string } | null;
    const googleEmail = userInfo?.email?.trim() ?? user.email ?? "";

    if (!googleEmail) {
      return redirectToTarget(
        request,
        returnTo,
        "error",
        "No se pudo identificar el correo de Google conectado.",
      );
    }

    await upsertGoogleCalendarOAuthAccount({
      usuarioId,
      googleEmail,
      refreshToken,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null,
    });

    const response = redirectToTarget(request, returnTo, "connected");
    response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
    response.cookies.delete(GOOGLE_CALENDAR_OAUTH_RETURN_TO_COOKIE);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la conexion con Google.";
    return redirectToTarget(request, returnTo, "error", message);
  }
}
