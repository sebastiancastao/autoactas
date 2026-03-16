import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import {
  deleteEventoFromGoogleCalendar,
  syncEventoWithGoogleCalendar,
} from "@/lib/google-calendar";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { createRouteHandlerSupabase } from "@/lib/supabase-route";

type EventoUpdate = Database["public"]["Tables"]["eventos"]["Update"];

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

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function sanitizeEventoUpdate(payload: unknown): EventoUpdate {
  const input = (payload ?? {}) as Partial<EventoUpdate>;
  const output: EventoUpdate = {};

  if ("titulo" in input) output.titulo = input.titulo?.trim() ?? "";
  if ("descripcion" in input) output.descripcion = input.descripcion ?? null;
  if ("fecha" in input) output.fecha = input.fecha?.trim() ?? "";
  if ("hora" in input) output.hora = input.hora ?? null;
  if ("fecha_fin" in input) output.fecha_fin = input.fecha_fin ?? null;
  if ("hora_fin" in input) output.hora_fin = input.hora_fin ?? null;
  if ("usuario_id" in input) output.usuario_id = input.usuario_id ?? null;
  if ("proceso_id" in input) output.proceso_id = input.proceso_id ?? null;
  if ("tipo" in input) output.tipo = input.tipo ?? null;
  if ("color" in input) output.color = input.color ?? null;
  if ("recordatorio" in input) output.recordatorio = input.recordatorio ?? false;
  if ("completado" in input) output.completado = input.completado ?? false;

  return output;
}

async function requireEventAccess(id: string) {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      supabase,
      errorResponse: NextResponse.json({ error: "No autenticado." }, { status: 401 }),
    };
  }

  const { data: evento, error } = await supabase
    .from("eventos")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return {
      supabase,
      errorResponse: NextResponse.json({ error: error.message }, { status: 404 }),
    };
  }

  return {
    supabase,
    evento,
    authUserId: user.id,
    errorResponse: null as NextResponse | null,
  };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const access = await requireEventAccess(id);
    if (access.errorResponse || !access.evento) return access.errorResponse!;
    const authUsuarioId = await resolveUsuarioId(access.authUserId);

    const changes = sanitizeEventoUpdate(await request.json());
    if ("titulo" in changes && !changes.titulo) {
      return NextResponse.json({ error: "El titulo no puede estar vacio." }, { status: 400 });
    }
    if ("fecha" in changes && !changes.fecha) {
      return NextResponse.json({ error: "La fecha no puede estar vacia." }, { status: 400 });
    }

    const { data: updated, error: updateError } = await access.supabase
      .from("eventos")
      .update({
        ...changes,
        google_sync_status: "pending",
        google_sync_error: null,
        google_sync_updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    const syncResult = await syncEventoWithGoogleCalendar({
      supabase: access.supabase,
      evento: updated,
      fallbackUsuarioId: authUsuarioId,
    });
    const { data: synced, error: syncSaveError } = await access.supabase
      .from("eventos")
      .update(syncResult)
      .eq("id", id)
      .select("*")
      .single();

    if (syncSaveError) {
      return NextResponse.json({ error: syncSaveError.message }, { status: 500 });
    }

    return NextResponse.json({ evento: synced });
  } catch (error) {
    return NextResponse.json(
      { error: toErrorMessage(error, "No se pudo actualizar el evento.") },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const access = await requireEventAccess(id);
    if (access.errorResponse || !access.evento) return access.errorResponse!;
    const authUsuarioId = await resolveUsuarioId(access.authUserId);

    let googleDeleteWarning: string | null = null;
    try {
      await deleteEventoFromGoogleCalendar({
        evento: access.evento,
        fallbackUsuarioId: authUsuarioId,
      });
    } catch (error) {
      googleDeleteWarning = toErrorMessage(
        error,
        "No se pudo eliminar el evento en Google Calendar.",
      );
      console.warn("[eventos.delete] Google Calendar delete warning:", googleDeleteWarning);
    }

    const { error } = await access.supabase.from("eventos").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, warning: googleDeleteWarning });
  } catch (error) {
    return NextResponse.json(
      { error: toErrorMessage(error, "No se pudo eliminar el evento.") },
      { status: 500 },
    );
  }
}
