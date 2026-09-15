import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "AI Study Companion",
    template: "%s · AI Study Companion",
  },
  description: "A persistent, contextual, and measurable AI learning companion.",
  applicationName: "AI Study Companion",
};

export const viewport: Viewport = {
  themeColor: "#022c22",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-stone-100 font-sans text-stone-900 antialiased">{children}</body>
    </html>
  );
}
