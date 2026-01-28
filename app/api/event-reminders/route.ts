import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import type { Evento } from "@/lib/database.types";

const REMINDER_SECRET_HEADER = "x-event-reminder-secret";
const LOOKAHEAD_MINUTES = 30;
const WINDOW_TOLERANCE_MINUTES = 2;

const formatDateKey = (date: Date) => date.toISOString().split("T")[0];

const BOGOTA_OFFSET = "-05:00";

const getEventDateTime = (evento: Evento): Date | null => {
  if (!evento.fecha || !evento.hora) return null;
  const sanitizedHora = evento.hora.length === 5 ? `${evento.hora}:00` : evento.hora;
  const combined = `${evento.fecha}T${sanitizedHora}${BOGOTA_OFFSET}`;
  const parsed = new Date(combined);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const humanizeDate = (date: Date) =>
  date.toLocaleString("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
  });

const createSupabase = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
};

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const reminderSecret = process.env.EVENT_REMINDER_SECRET?.trim();
  const incomingSecret = request.headers.get(REMINDER_SECRET_HEADER)?.trim();
  if (!reminderSecret) {
    return NextResponse.json({ message: "Reminder secret is not configured." }, { status: 500 });
  }
  if (incomingSecret !== reminderSecret) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabase();
  if (!supabase) {
    return NextResponse.json({ message: "Missing Supabase server configuration." }, { status: 500 });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const resendFrom = process.env.RESEND_DEFAULT_FROM?.trim();
  if (!resendKey || !resendFrom) {
    return NextResponse.json({ message: "Missing Resend configuration." }, { status: 500 });
  }

  const resendClient = new Resend(resendKey);
  const now = new Date();
  const windowStart = new Date(now.getTime() + (LOOKAHEAD_MINUTES - WINDOW_TOLERANCE_MINUTES) * 60_000);
  const windowEnd = new Date(now.getTime() + (LOOKAHEAD_MINUTES + WINDOW_TOLERANCE_MINUTES) * 60_000);
  const earliestDate = formatDateKey(windowStart);
  const latestDate = formatDateKey(windowEnd);

  const { data: events, error: eventsError } = await supabase
    .from("eventos")
    .select("id, titulo, fecha, hora, proceso_id")
    .eq("recordatorio", false)
    .gte("fecha", earliestDate)
    .lte("fecha", latestDate)
    .not("proceso_id", "is", null)
    .not("hora", "is", null);

  if (eventsError) {
    console.error("Event reminder lookup error:", eventsError);
    return NextResponse.json({ message: "Unable to load upcoming events." }, { status: 500 });
  }

  const relevantEvents = (events ?? [])
    .map((evt) => ({ ...evt, eventDate: getEventDateTime(evt as Evento) }))
    .filter((evt) => evt.eventDate && evt.eventDate >= windowStart && evt.eventDate <= windowEnd);

  let remindersSent = 0;
  let skippedNoRecipients = 0;
  for (const evt of relevantEvents) {
    const procesoId = evt.proceso_id;
    if (!procesoId) continue;

    const { data: apoderados, error: apError } = await supabase
      .from("apoderados")
      .select("id, nombre, email")
      .eq("proceso_id", procesoId)
      .not("email", "is", null);

    if (apError) {
      console.error("Unable to load apoderados for proceso:", apError);
      continue;
    }

    const recipients = Array.from(
      new Set(
        (apoderados ?? [])
          .map((a) => a.email?.trim())
          .filter((email): email is string => Boolean(email))
      )
    );

    if (recipients.length === 0) {
      skippedNoRecipients++;
      continue;
    }

    const procesoResponse = await supabase
      .from("proceso")
      .select("numero_proceso")
      .eq("id", procesoId)
      .maybeSingle();
    const procesoNumero = procesoResponse.data?.numero_proceso ?? "sin numero";

    const eventDate = evt.eventDate!;
    const html = `
      <p>Hola,</p>
      <p>
        Te recordamos que el evento <strong>${evt.titulo}</strong> del proceso <strong>${procesoNumero}</strong>
        inicia el ${humanizeDate(eventDate)}.
      </p>
      <p>Te esperamos 30 minutos antes para continuar con el flujo.</p>
      <p>Atentamente,<br />El equipo de autoactas</p>
    `;

    try {
      await resendClient.emails.send({
        to: recipients,
        from: resendFrom,
        subject: `Recordatorio: ${evt.titulo}`,
        html,
      });
      remindersSent++;
      await supabase.from("eventos").update({ recordatorio: true }).eq("id", evt.id);
    } catch (sendError) {
      console.error("Failed to send reminder for event:", evt.id, sendError);
    }
  }

  return NextResponse.json({
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    eventsChecked: relevantEvents.length,
    remindersSent,
    skippedNoRecipients,
  });
}
