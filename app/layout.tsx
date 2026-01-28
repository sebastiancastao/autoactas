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
        <AuthProvider>
          <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
            <Header />
            <ProcessProgress />
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
