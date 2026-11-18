"use client";

/**
 * A submit button that asks first.
 *
 * Generic because there are now three of these. `DeleteInquiryButton` and
 * `DeletePostButton` are the same twenty lines with a different sentence in
 * the `confirm()`, and a third copy for comments would have made the pattern
 * undeniable. New destructive buttons should use this; the two existing ones
 * are left alone rather than refactored in a commit about something else.
 *
 * `window.confirm` rather than a modal, matching those two: it is synchronous,
 * unstylable, and impossible to dismiss by accident — which for an
 * irreversible action is a feature.
 */
export default function ConfirmSubmitButton({
  label,
  confirm,
  className,
}: {
  label: string;
  /** The question. Phrase it so "cancel" is the safe answer. */
  confirm: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      onClick={(event) => {
        // preventDefault on cancel, so the form does not submit. The button is
        // inside a <form action={serverAction}>, so this is the only thing
        // standing between a mis-click and a deletion.
        if (!window.confirm(confirm)) event.preventDefault();
      }}
      className={
        className ??
        "rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-steel hover:text-ink"
      }
    >
      {label}
    </button>
  );
}
