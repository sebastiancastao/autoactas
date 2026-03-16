import { NextResponse } from "next/server";
import { deleteGoogleCalendarOAuthAccountByUsuarioId } from "@/lib/google-calendar-oauth";
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

export async function POST() {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const usuarioId = await resolveUsuarioId(user.id);
  if (!usuarioId) {
    return NextResponse.json({ success: true });
  }

  await deleteGoogleCalendarOAuthAccountByUsuarioId(usuarioId);
  return NextResponse.json({ success: true });
}
