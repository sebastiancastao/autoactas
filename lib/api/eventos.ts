import type { Database } from "../database.types";
import { supabase } from "../supabase";

export type Evento = Database["public"]["Tables"]["eventos"]["Row"];
export type EventoInsert = Database["public"]["Tables"]["eventos"]["Insert"];
export type EventoUpdate = Database["public"]["Tables"]["eventos"]["Update"];

type EventoApiResponse = {
  evento: Evento;
};

async function parseEventoApiResponse(response: Response) {
  const json = (await response.json().catch(() => null)) as
    | EventoApiResponse
    | { error?: string }
    | null;
  const errorMessage =
    json && "error" in json && typeof json.error === "string" ? json.error : null;

  if (!response.ok) {
    throw new Error(errorMessage || "No se pudo completar la operacion del evento.");
  }

  if (!json || !("evento" in json) || !json.evento) {
    throw new Error("La respuesta del servidor para eventos no es valida.");
  }

  return json.evento;
}

export async function getEventos() {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventoById(id: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function getEventosByFecha(fecha: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('fecha', fecha)
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventosByRangoFechas(fechaprocesos: string, fechaFin: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .gte('fecha', fechaprocesos)
    .lte('fecha', fechaFin)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventosByUsuario(usuarioId: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('usuario_id', usuarioId)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventosByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('proceso_id', procesoId)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function createEvento(evento: EventoInsert) {
  const response = await fetch("/api/eventos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(evento),
  });

  return parseEventoApiResponse(response);
}

export async function updateEvento(id: string, evento: EventoUpdate) {
  const response = await fetch(`/api/eventos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(evento),
  });

  return parseEventoApiResponse(response);
}

export async function deleteEvento(id: string) {
  const response = await fetch(`/api/eventos/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error || "No se pudo eliminar el evento.");
  }
}

export async function retryEventoGoogleSync(id: string) {
  const response = await fetch(`/api/eventos/${encodeURIComponent(id)}/sync-google`, {
    method: "POST",
  });

  return parseEventoApiResponse(response);
}

export async function marcarEventoCompletado(id: string, completado: boolean) {
  const { data, error } = await supabase
    .from('eventos')
    .update({ completado })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}
