import { NextRequest, NextResponse } from "next/server";
import { syncEventoWithGoogleCalendar } from "@/lib/google-calendar";
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

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "No se pudo resincronizar el evento con Google.";
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabase = await createRouteHandlerSupabase();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const { data: evento, error } = await supabase
      .from("eventos")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const authUsuarioId = await resolveUsuarioId(user.id);
    const syncResult = await syncEventoWithGoogleCalendar({
      supabase,
      evento,
      fallbackUsuarioId: authUsuarioId,
    });
    const { data: updated, error: updateError } = await supabase
      .from("eventos")
      .update(syncResult)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ evento: updated });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
