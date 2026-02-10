"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type UploadResult = {
  fileId: string;
  fileName: string;
  webViewLink: string | null;
};

export default function OnboardingPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const onPickFile = (next: File | null) => {
    setError(null);
    setResult(null);
    setFile(next);
  };

  const upload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file, file.name);

      const res = await fetch("/api/upload-pdf", {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => null)) as
        | (UploadResult & { error?: string; detail?: string })
        | null;

      if (!res.ok) {
        throw new Error(json?.detail || json?.error || "Error subiendo el PDF.");
      }

      if (!json?.fileId) {
        throw new Error("Respuesta inválida del servidor.");
      }

      setResult({
        fileId: json.fileId,
        fileName: json.fileName,
        webViewLink: json.webViewLink ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-white">
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <nav className="mb-8 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            ← inicio
          </Link>
        </nav>

        <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <header className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight">
              Onboarding
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Sube un PDF para guardarlo en Google Drive.
            </p>
          </header>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              Elegir PDF
            </button>

            <button
              type="button"
              onClick={() => void upload()}
              disabled={!file || uploading}
              className="h-12 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {uploading ? "Subiendo..." : "Subir PDF"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                onPickFile(null);
              }}
              disabled={!file || uploading}
              className="h-12 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              Limpiar
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
            <p className="font-medium">Archivo seleccionado</p>
            <p className="mt-1 break-words text-zinc-600 dark:text-zinc-300">
              {file ? file.name : "Ninguno"}
            </p>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
              <p className="font-medium">PDF subido.</p>
              <p className="mt-1 break-words">
                Archivo: {result.fileName}
                {result.webViewLink ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={result.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Abrir en Drive
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

