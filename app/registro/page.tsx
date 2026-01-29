import { Suspense } from "react";
import type { Metadata } from "next";

import RegistroForm from "@/components/registro-form";

type RegistroPageProps = {
  searchParams?: {
    procesoId?: string;
    tipo?: "deudores" | "acreedores" | "deudor" | "acreedor";
  };
};

export const metadata: Metadata = {
  title: "Registro de procesos | AutoActas",
  description: "Registra o edita procesos judiciales desde un formulario dedicado.",
};

export default function RegistroPage({ searchParams }: RegistroPageProps) {
  const procesoId = searchParams?.procesoId;
  const tipo = searchParams?.tipo?.toLowerCase();
  const focusSection =
    tipo === "acreedores" || tipo === "acreedor"
      ? "acreedores"
      : tipo === "deudores" || tipo === "deudor"
      ? "deudores"
      : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <Suspense
        fallback={
          <div className="text-sm text-zinc-500">Cargando formulario...</div>
        }
      >
        <RegistroForm initialProcesoId={procesoId ?? null} focusSection={focusSection} />
      </Suspense>
    </main>
  );
}
