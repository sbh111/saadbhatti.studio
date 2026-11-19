import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SubscriberStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { content } from "@/lib/content";
import { prisma } from "@/lib/db";
import { isSegmentConfigured } from "@/lib/resendSegment";
import LocalTime from "@/components/LocalTime";

/**
 * The subscriber list, and the drift panel that keeps the consent record
 * honest.
 *
 * ── Why a drift panel is necessary rather than defensive ──────────────────
 * Two systems hold overlapping facts: Postgres owns CONSENT, Resend owns
 * DELIVERABILITY. One class of divergence is unavoidable by design — a
 * broadcast unsubscribe goes through Resend's own link, which updates Resend
 * and not Postgres. That is safe, because a broadcast can only reach Resend
 * contacts, so leaving that way works whatever Postgres believes. But it does
 * mean **Postgres over-reports consent over time**, and the only honest
 * response is to show the number rather than pretend the two agree.
 *
 * The other class — a CONFIRMED row with no Resend contact — is the dangerous
 * one, because that person consented and will silently receive nothing. Every
 * publish heals it before sending (lib/notifyPost.ts); this surfaces it in
 * between.
 */

export const metadata: Metadata = {
  title: `subscribers - ${content.site.title}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function SubscribersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { page: rawPage } = await searchParams;
  const requested = Number(rawPage);
  const wanted = Number.isInteger(requested) && requested >= 1 ? requested : 1;

  // Deliberate full scans over a table Resend's free plan caps at ~1,000 rows
  // — the same call schema-design.md §4 makes for every admin aggregate.
  const [grouped, total, missingContact] = await Promise.all([
    prisma.subscriber.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.subscriber.count(),
    prisma.subscriber.count({
      where: { status: SubscriberStatus.CONFIRMED, resendContactId: null },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const row of grouped) counts[row.status] = row._count.status;
  const confirmed = counts[SubscriberStatus.CONFIRMED] ?? 0;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(wanted, pageCount);

  const subscribers = await prisma.subscriber.findMany({
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      email: true,
      status: true,
      confirmedAt: true,
      createdAt: true,
      resendContactId: true,
    },
  });

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">
        subscribers
      </h1>
      <p className="mt-1 text-[13px] text-ink-faint">
        {confirmed} confirmed
        {counts[SubscriberStatus.PENDING]
          ? ` · ${counts[SubscriberStatus.PENDING]} awaiting confirmation`
          : ""}
        {counts[SubscriberStatus.UNSUBSCRIBED]
          ? ` · ${counts[SubscriberStatus.UNSUBSCRIBED]} unsubscribed`
          : ""}
        {" · "}
        {/* Resend's free marketing plan caps contacts at 1,000. Shown BEFORE
            it bites, because hitting it makes contact creation fail in a way
            that looks exactly like the drift below. */}
        {confirmed} of 1,000 on the free plan
      </p>

      {!isSegmentConfigured() && (
        <p className="mt-4 rounded-[2px] border border-hairline bg-panel p-3 text-[13px] text-steel">
          Subscriber mail is not configured — set <code>RESEND_API_KEY</code>,{" "}
          <code>RESEND_SEGMENT_ID</code> and <code>BLOG_NOTIFY_FROM</code>.
          Signups and confirmations still record here; publishing records
          &ldquo;skipped&rdquo; and mails nobody.
        </p>
      )}

      {missingContact > 0 && (
        <p className="mt-4 rounded-[2px] border border-hairline bg-panel p-3 text-[13px] text-steel">
          {missingContact} confirmed {missingContact === 1 ? "person" : "people"}{" "}
          {missingContact === 1 ? "is" : "are"} not in the Resend segment and
          would miss a broadcast. The next publish adds them automatically
          before sending.
        </p>
      )}

      {subscribers.length === 0 ? (
        <p className="mt-6 text-[13px] text-ink-faint">Nobody yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-1.5">
          {subscribers.map((subscriber) => (
            <li
              key={subscriber.id}
              className="flex flex-wrap items-baseline gap-2 rounded-[2px] border border-hairline bg-panel px-3 py-2 text-[13px]"
            >
              <span className="font-pixel text-[10px] text-steel">
                {subscriber.status}
              </span>
              <span className="text-ink">{subscriber.email}</span>
              <span className="text-ink-faint">
                {subscriber.confirmedAt ? "confirmed " : "signed up "}
                <LocalTime
                  date={subscriber.confirmedAt ?? subscriber.createdAt}
                />
              </span>
              {subscriber.status === SubscriberStatus.CONFIRMED &&
                !subscriber.resendContactId && (
                  <span className="text-steel">not in segment</span>
                )}
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <p className="mt-6 text-[13px] text-ink-faint">
          page {page} of {pageCount}
        </p>
      )}
    </div>
  );
}
