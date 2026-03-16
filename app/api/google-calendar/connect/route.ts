import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleCalendarOAuthClient,
  getGoogleCalendarOAuthRedirectUri,
  getGoogleCalendarOAuthScopes,
  isGoogleCalendarOAuthConfigured,
  isGoogleCalendarOAuthStorageReady,
  getGoogleCalendarOAuthStorageMissingMessage,
} from "@/lib/google-calendar-oauth";
import { createRouteHandlerSupabase } from "@/lib/supabase-route";

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "google_calendar_oauth_state";

export const runtime = "nodejs";

function redirectToPerfil(request: NextRequest, status: string, message?: string) {
  const url = new URL("/perfil", request.nextUrl.origin);
  url.searchParams.set("googleCalendar", status);
  if (message) url.searchParams.set("googleCalendarMessage", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToPerfil(request, "error", "Debes iniciar sesion para conectar Google Calendar.");
  }

  if (!isGoogleCalendarOAuthConfigured()) {
    return redirectToPerfil(
      request,
      "error",
      "Faltan GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET en el servidor.",
    );
  }

  if (!(await isGoogleCalendarOAuthStorageReady())) {
    return redirectToPerfil(request, "error", getGoogleCalendarOAuthStorageMissingMessage());
  }

  const redirectUri = getGoogleCalendarOAuthRedirectUri(request.nextUrl.origin);
  const client = createGoogleCalendarOAuthClient(redirectUri);
  const state = crypto.randomUUID();

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: getGoogleCalendarOAuthScopes(),
    state,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
