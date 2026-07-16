"use client";

/**
 * Submit button for the delete form on the comment log, gated by a native
 * confirm (matches the saveAll flow's use of window primitives). Cancelling the
 * dialog prevents the enclosing form from submitting.
 */
export default function DeleteInquiryButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm("Delete this inquiry? This can't be undone.")) {
          e.preventDefault();
        }
      }}
      className="text-[13px] text-ink-faint hover:text-steel"
    >
      delete
    </button>
  );
}
