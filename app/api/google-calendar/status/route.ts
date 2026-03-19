import { NextResponse } from "next/server";
import {
  getGoogleCalendarOAuthAccountByUsuarioId,
  hasGoogleDriveOAuthScope,
  isGoogleCalendarOAuthConfigured,
  isGoogleCalendarOAuthStorageReady,
  getGoogleCalendarOAuthStorageMissingMessage,
} from "@/lib/google-calendar-oauth";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { createRouteHandlerSupabase } from "@/lib/supabase-route";

export const runtime = "nodejs";

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

function getStatusFallbackMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Missing Supabase admin environment variables")) {
    return "Falta SUPABASE_SERVICE_ROLE_KEY en el deployment para consultar la conexion de Google.";
  }
  return "No se pudo consultar el estado de Google Calendar en el servidor.";
}

export async function GET() {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const oauthConfigured = isGoogleCalendarOAuthConfigured();

  try {
    const storageReady = oauthConfigured ? await isGoogleCalendarOAuthStorageReady() : false;
    const setupMessage =
      oauthConfigured && !storageReady ? getGoogleCalendarOAuthStorageMissingMessage() : null;

    const usuarioId = await resolveUsuarioId(user.id);
    if (!usuarioId) {
      return NextResponse.json(
        {
          connected: false,
          available: oauthConfigured && storageReady,
          oauthConfigured,
          storageReady,
          setupMessage,
        },
        { status: 200 },
      );
    }

    const account = await getGoogleCalendarOAuthAccountByUsuarioId(usuarioId);
    const driveReady = hasGoogleDriveOAuthScope(account?.scope ?? null);
    const accountSetupMessage =
      account && !driveReady
        ? "Tu conexion de Google no incluye permisos de Drive. Desconecta y conecta de nuevo para editar documentos en Google Docs."
        : setupMessage;
    return NextResponse.json({
      available: oauthConfigured && storageReady,
      oauthConfigured,
      storageReady,
      setupMessage: accountSetupMessage,
      connected: Boolean(account),
      googleEmail: account?.google_email ?? null,
      connectedAt: account?.updated_at ?? account?.created_at ?? null,
      driveReady,
    });
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        oauthConfigured,
        storageReady: false,
        connected: false,
        googleEmail: null,
        connectedAt: null,
        driveReady: false,
        setupMessage: getStatusFallbackMessage(error),
      },
      { status: 200 },
    );
  }
}
