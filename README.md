This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Supabase

Create a local env file using `autoactas/.env.example` as a template:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public anon key only)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never use with `NEXT_PUBLIC_`)

If you ever exposed a Service Role key in a `NEXT_PUBLIC_` variable, rotate it in Supabase immediately and update your env vars.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Email proxy via Resend

To keep email sending logic off the client, the app now exposes a `POST /api/resend` route that forwards payloads to the Resend API. Use the helper in `lib/api/resend.ts` from client components to queue messages:

```ts
import { sendResendEmail } from "@/lib/api/resend";

await sendResendEmail({
  to: "recipient@example.com",
  subject: "Welcome",
  html: "<p>Hi!</p>",
});
```

The route validates `to`, `subject` and `html`, and requires these environment variables:

- `RESEND_API_KEY` (required) – the Resend server API key used by the server route.
- `RESEND_DEFAULT_FROM` (required unless every request passes a `from` value) – the sender address that shows up in outgoing emails.

If the Resend API responds with an error, the helper surfaces the HTTP status and message.

### Recordatorio de eventos

Para notificar a los apoderados 30 minutos antes de cada evento, la app expone `POST /api/event-reminders`. El endpoint usa la misma cuenta de Resend y marca cada evento como recordado (`eventos.recordatorio = true`) para evitar duplicados.

El endpoint requiere:

- `RESEND_API_KEY` y `RESEND_DEFAULT_FROM` (ya descritos arriba).
- `EVENT_REMINDER_SECRET` – un valor secreto que debes enviar dentro del encabezado `X-Event-Reminder-Secret` para autorizar la invocación.

Recomendamos configurar una tarea programada (por ejemplo, Vercel Cron Jobs) que haga `POST https://<tu-app>/api/event-reminders` cada minuto y que incluya el encabezado con el secreto. Cada llamada evalúa los eventos (hora en horario de Bogotá, UTC−05:00) con inicio en ~30 minutos y envía el recordatorio a todos los apoderados asociados al proceso.

Si necesitas exponer los datos de los eventos a otro sistema, configura `EVENT_REMINDER_WEBHOOK_URL` con la URL del receptor. Una vez que se detectan eventos en la ventana de 30 minutos, el endpoint hace un `POST` con el payload:

```json
{
  "timestamp": "2026-01-28T12:00:00.000Z",
  "window": {
    "start": "2026-01-28T12:27:00.000Z",
    "end": "2026-01-28T12:33:00.000Z"
  },
  "events": [
    {
      "id": "event-id",
      "titulo": "Audiencia",
      "fecha": "2026-01-28",
      "hora": "14:00",
      "procesoId": "proceso-id",
      "eventDate": "2026-01-28T19:00:00.000Z"
    }
  ]
}
```

El webhook se invoca incluso si se decide no enviar correos (por ejemplo, cuando no hay apoderados con email). Puedes filtrar los datos de entrada para tomar decisiones externas antes de cualquier envío.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
