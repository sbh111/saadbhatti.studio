"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Alert affordance on a comment-log row whose notification email did not send.
 * The icon states the outcome; clicking it opens a small popup (anchored to the
 * icon) with the stored error and a one-click resend. Resend is a Server Action
 * form (passed in from the server page); on success the row re-renders as SENT
 * and this alert disappears, on failure the fresh error replaces the old one.
 */

type EmailStatus = "PENDING" | "SKIPPED" | "FAILED";

const LABEL: Record<EmailStatus, string> = {
  PENDING: "email pending",
  SKIPPED: "email not sent",
  FAILED: "email failed",
};

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-[12px] text-steel hover:underline disabled:opacity-50"
    >
      {pending ? "sending…" : "resend email"}
    </button>
  );
}

export default function InquiryEmailAlert({
  inquiryId,
  status,
  error,
  resendAction,
}: {
  inquiryId: string;
  status: EmailStatus;
  error: string | null;
  resendAction: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const detail = error ?? "This inquiry hasn’t been emailed yet.";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Notification ${LABEL[status]} — details and resend`}
        className="flex items-center gap-1 text-[13px] text-[#b45309] hover:text-[#92400e]"
      >
        <span aria-hidden>⚠</span>
        {LABEL[status]}
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-10 w-64 animate-fadein rounded-[2px] border border-hairline bg-panel p-3 shadow-lg">
          <p className="text-[12px] font-medium text-ink">
            Notification email not sent
          </p>
          <p className="mt-1 break-words text-[12px] text-ink-muted">{detail}</p>
          <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2">
            <form action={resendAction}>
              <input type="hidden" name="id" value={inquiryId} />
              <ResendButton />
            </form>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[12px] text-ink-faint hover:text-steel"
            >
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
