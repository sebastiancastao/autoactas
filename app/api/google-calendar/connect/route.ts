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

export async function GET(request: NextRequest) {
  const returnTo = normalizeReturnTo(request.nextUrl.searchParams.get("next"));
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      "Debes iniciar sesion para conectar Google Calendar.",
    );
  }

  if (!isGoogleCalendarOAuthConfigured()) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      "Faltan GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET en el servidor.",
    );
  }

  if (!(await isGoogleCalendarOAuthStorageReady())) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      getGoogleCalendarOAuthStorageMissingMessage(),
    );
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
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_RETURN_TO_COOKIE, returnTo, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
