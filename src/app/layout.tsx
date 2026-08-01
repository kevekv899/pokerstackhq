import type { Metadata } from "next";
import { ViewTransition } from "react";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "PokerStack – Play Real Poker. Win Real Money.",
  description:
    "Join over 2 million players at PokerStack. Real money Texas Hold'em, Omaha, and tournaments. Secure, fair, and instant withdrawals.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-white">
        {/* Route navigations are React Transitions, so this crossfades every
            page change. The animation itself lives in globals.css under
            ::view-transition-old/new(root). */}
        <ViewTransition>{children}</ViewTransition>
      </body>
    </html>
  );
}
