import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { cookies } from "next/headers";
import "./globals.css";
import Header from "@/app/components/Header";
import Footer from "@/app/components/Footer";
import ErrorBanner from "@/app/components/ErrorBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "igiari",
  description: "大切な人とおだやかに話し合える場所 — AI 裁判官が判決を下す",
  openGraph: {
    title: "igiari",
    description: "大切な人とおだやかに話し合える場所 — AI 裁判官が判決を下す",
    siteName: "igiari",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies()
  const flashError = cookieStore.get('flash_error')?.value ?? null

  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col bg-white text-stone-900">
        <Suspense fallback={<div className="h-14 bg-stone-50 border-b border-stone-200" />}>
          <Header />
        </Suspense>
        {flashError && <ErrorBanner errorCode={flashError} />}
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
