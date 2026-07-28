import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { content } from "@/lib/content";
import { EVENT_STREAMING_KEY, getSetting } from "@/lib/settings";
import { setEventStreamingAction } from "./actions";

export const metadata: Metadata = {
  title: `settings - ${content.site.title}`,
  robots: { index: false },
};

// Reads the session + a DB row on every request — nothing here is cacheable.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const enabled = (await getSetting(EVENT_STREAMING_KEY)) === "true";

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">settings</h1>

      <section className="mt-6 rounded-[2px] border border-hairline bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[15px] font-medium text-ink">
              Event streaming
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Stream anonymized page views, artwork views, and likes to the Kafka
              collector. A learning feature — safe to leave off; the site behaves
              identically either way, and likes are recorded regardless.
            </p>
            <div className="mt-2 text-[12px] text-ink-faint">
              Status:{" "}
              <span className={enabled ? "text-steel" : ""}>
                streaming {enabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
          <form action={setEventStreamingAction}>
            <input type="hidden" name="to" value={enabled ? "off" : "on"} />
            <button
              type="submit"
              className="shrink-0 rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink hover:border-steel hover:text-steel"
            >
              {enabled ? "Turn off" : "Turn on"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
