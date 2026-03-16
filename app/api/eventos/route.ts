import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { createRouteHandlerSupabase } from "@/lib/supabase-route";
import { createAdminSupabase } from "@/lib/supabase-admin";
import {
  isGoogleCalendarEnabled,
  syncEventoWithGoogleCalendar,
} from "@/lib/google-calendar";

type EventoInsert = Database["public"]["Tables"]["eventos"]["Insert"];

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
  return "No se pudo crear el evento.";
}

function sanitizeEventoInsert(payload: unknown): EventoInsert {
  const input = (payload ?? {}) as Partial<EventoInsert>;
  return {
    titulo: input.titulo?.trim() ?? "",
    descripcion: input.descripcion ?? null,
    fecha: input.fecha?.trim() ?? "",
    hora: input.hora ?? null,
    fecha_fin: input.fecha_fin ?? null,
    hora_fin: input.hora_fin ?? null,
    usuario_id: input.usuario_id ?? null,
    proceso_id: input.proceso_id ?? null,
    tipo: input.tipo ?? null,
    color: input.color ?? null,
    recordatorio: input.recordatorio ?? false,
    completado: input.completado ?? false,
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerSupabase();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const payload = sanitizeEventoInsert(await request.json());
    if (!payload.titulo || !payload.fecha) {
      return NextResponse.json(
        { error: "Los campos titulo y fecha son obligatorios." },
        { status: 400 },
      );
    }

    const initialPayload: EventoInsert = {
      ...payload,
      google_sync_status: isGoogleCalendarEnabled() ? "pending" : "disabled",
      google_sync_error: null,
      google_sync_updated_at: new Date().toISOString(),
    };

    const { data: created, error: insertError } = await supabase
      .from("eventos")
      .insert(initialPayload)
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    const authUsuarioId = await resolveUsuarioId(user.id);
    const syncResult = await syncEventoWithGoogleCalendar({
      supabase,
      evento: created,
      fallbackUsuarioId: authUsuarioId,
    });
    const { data: updated, error: updateError } = await supabase
      .from("eventos")
      .update(syncResult)
      .eq("id", created.id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ evento: updated }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
