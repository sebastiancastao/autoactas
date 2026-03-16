import { NextResponse } from "next/server";
import {
  getGoogleCalendarOAuthAccountByUsuarioId,
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

export async function GET() {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const oauthConfigured = isGoogleCalendarOAuthConfigured();
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
  return NextResponse.json({
    available: oauthConfigured && storageReady,
    oauthConfigured,
    storageReady,
    setupMessage,
    connected: Boolean(account),
    googleEmail: account?.google_email ?? null,
    connectedAt: account?.updated_at ?? account?.created_at ?? null,
  });
}
