import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { content } from "@/lib/content";
import { getCatalog } from "@/lib/catalog";
import { buildNavTree } from "@/lib/nav";
import { imageUrl } from "@/lib/cloudinary";
import AppShell from "@/components/AppShell";
import "./globals.css";

/** Re-check Cloudinary for new/changed artwork at most hourly */
export const revalidate = 3600;

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = buildNavTree(await getCatalog());
  return (
    <html lang="en" className={inter.variable}>
      <body className="h-screen overflow-hidden font-sans antialiased">
        <AppShell tree={tree}>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
