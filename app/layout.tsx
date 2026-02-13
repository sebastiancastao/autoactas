import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Header } from "@/components/header";
import { ProcessProgress } from "@/components/process-progress";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});





const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoActas - Sistema de Gestion",
  description: "Sistema de gestion de procesos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-zinc-950 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white dark:focus:bg-white dark:focus:text-black"
        >
          Saltar al contenido
        </a>
        <AuthProvider>
          <div className="app-shell min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
            <Header />
            <ProcessProgress />
            <div id="main-content">{children}</div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
