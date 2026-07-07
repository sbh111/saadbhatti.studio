import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { content } from "@/lib/content";
import { imageUrl } from "@/lib/cloudinary";
import AppShell from "@/components/AppShell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://saadbhatti.studio"),
  title: content.site.title,
  description: content.site.intro,
  openGraph: {
    title: content.site.title,
    description: content.site.intro,
    images: [
      content.site.heroImage.startsWith("/")
        ? content.site.heroImage
        : imageUrl(content.site.heroImage, 1200),
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="h-screen overflow-hidden font-sans antialiased">
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
