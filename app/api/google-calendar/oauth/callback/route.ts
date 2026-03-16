import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleCalendarOAuthClient,
  getGoogleCalendarOAuthRedirectUri,
  upsertGoogleCalendarOAuthAccount,
} from "@/lib/google-calendar-oauth";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { createRouteHandlerSupabase } from "@/lib/supabase-route";

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "google_calendar_oauth_state";

export const runtime = "nodejs";

function redirectToPerfil(request: NextRequest, status: string, message?: string) {
  const url = new URL("/perfil", request.nextUrl.origin);
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

  if (!code || !state || !storedState || state !== storedState) {
    return redirectToPerfil(request, "error", "La respuesta de Google no coincide con la solicitud iniciada.");
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToPerfil(request, "error", "Tu sesion expiro antes de completar la conexion.");
  }

  const usuarioId = await resolveUsuarioId(user.id);
  if (!usuarioId) {
    return redirectToPerfil(request, "error", "No se encontro el perfil interno del usuario.");
  }

  try {
    const redirectUri = getGoogleCalendarOAuthRedirectUri(request.nextUrl.origin);
    const client = createGoogleCalendarOAuthClient(redirectUri);
    const { tokens } = await client.getToken(code);
    const refreshToken = tokens.refresh_token?.trim() ?? null;
    const accessToken = tokens.access_token?.trim() ?? null;

    if (!refreshToken || !accessToken) {
      return redirectToPerfil(
        request,
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
      return redirectToPerfil(request, "error", "No se pudo identificar el correo de Google conectado.");
    }

    await upsertGoogleCalendarOAuthAccount({
      usuarioId,
      googleEmail,
      refreshToken,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null,
    });

    const response = redirectToPerfil(request, "connected");
    response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la conexion con Google.";
    return redirectToPerfil(request, "error", message);
  }
}
