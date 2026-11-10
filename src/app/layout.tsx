import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Shell } from "@/components/shell";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Desk · Aayush",
  description: "Paper-first crypto desk for OKX spot and GMGN on-chain markets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
