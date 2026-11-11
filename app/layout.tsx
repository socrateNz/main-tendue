import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Parrainage scolaire",
    template: "%s · Parrainage scolaire",
  },
  description: "Gestion du programme de parrainage scolaire : enfants, sponsors, engagements, contributions et dépenses.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f8fafc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delay={300}>{children}</TooltipProvider>
        <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 5000 }} />
      </body>
    </html>
  );
}
