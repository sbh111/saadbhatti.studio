import type { Metadata } from "next";
import { Inter, Press_Start_2P } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { content } from "@/lib/content";
import { getCatalog } from "@/lib/catalog";
import { buildNavTree, type NavNode } from "@/lib/nav";
import { imageUrl } from "@/lib/cloudinary";
import { SITE_ORIGIN } from "@/lib/constants";
import AppShell from "@/components/AppShell";
import AdminProvider from "@/components/AdminProvider";
import "./globals.css";

/**
 * Re-check Cloudinary for new/changed artwork at most hourly. Must stay a
 * static literal (Next reads route segment config at build time and can't
 * resolve an import here) — kept in sync by hand with
 * CATALOG_REVALIDATE_SECONDS in lib/constants.ts, which the fetch-level cache
 * in lib/cloudinaryAdmin.ts uses for the same window.
 */
export const revalidate = 3600;

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

const pressStart = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-press-start",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
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
  // A Cloudinary outage/misconfiguration must not take down EVERY route with
  // it, including the admin pages the owner would need to respond to the
  // outage (tech debt 1.4) — there were no error boundaries anywhere in the
  // app, so this unguarded call used to throw the ENTIRE layout. Degrading to
  // an empty nav tree (rather than crashing) is safe: it only ever removes
  // navigation, never a page's own content.
  //
  // ISR trade-off, worth being explicit about: public pages are ISR
  // (`revalidate` above), and a background regeneration that THROWS keeps
  // serving the last good cached page — the visitor never sees an error. A
  // regeneration that instead returns a DEGRADED render (this catch) gets
  // cached as the new "good" page. For a page whose own body also needs the
  // catalog (app/[medium]/page.tsx, app/[medium]/[collection]/page.tsx — both
  // call getCatalog*() again, deeper in the tree), that page's OWN fetch
  // still throws on the same outage, so ISR still serves its last good
  // render; only a page that needs nothing else from the catalog (app/
  // page.tsx, app/about/page.tsx — verified by reading both) could get stuck
  // serving a nav-less version for up to one revalidate window. That's a
  // strict improvement over today, where the same outage takes those pages
  // (and every force-dynamic admin page) down completely, with no retry.
  let tree: NavNode[] = [];
  try {
    tree = buildNavTree(await getCatalog());
  } catch (err) {
    console.error("[layout] catalog unavailable — rendering an empty nav:", err);
  }
  return (
    <html lang="en" className={`${inter.variable} ${pressStart.variable}`}>
      {/* The carpet frame lives on <body> as a border-image (see globals.css);
          the shell fills the content box inside it. */}
      <body className="h-screen overflow-hidden font-sans antialiased">
        <AdminProvider>
          <AppShell tree={tree}>{children}</AppShell>
        </AdminProvider>
        <Analytics />
      </body>
    </html>
  );
}
