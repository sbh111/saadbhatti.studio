"use client";

/**
 * Submit button for the delete form in the post editor, gated by a native
 * confirm — the components/DeleteInquiryButton.tsx pattern. Cancelling the
 * dialog prevents the enclosing form from submitting.
 *
 * A separate component from DeleteInquiryButton rather than a shared one: the
 * wording differs, and a post is a bigger loss than an inquiry, so the copy
 * says so.
 */
export default function DeletePostButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (
          !window.confirm(
            "Delete this post permanently? The text is only stored here — this can't be undone."
          )
        ) {
          e.preventDefault();
        }
      }}
      className="text-[13px] text-ink-faint hover:text-steel"
    >
      delete
    </button>
  );
}
