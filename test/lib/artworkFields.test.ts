import { describe, expect, it } from "vitest";
import {
  fieldsFromContext,
  FIELD_KEYS,
  METADATA_FIELDS,
  type FieldKey,
} from "@/lib/artworkFields";

// Pins the property tech debt 3.1 exists for: everything derives structurally
// from METADATA_FIELDS, so adding a field there — without touching any other
// file — must flow all the way to FIELD_KEYS (the admin form/save payload)
// and to fieldsFromContext (the read path feeding the form). None of these
// tests special-case a field by name; if they still pass after a hypothetical
// fifth entry is appended to METADATA_FIELDS, the one-line-change property
// holds.

describe("lib/artworkFields", () => {
  it("FIELD_KEYS is exactly title + every METADATA_FIELDS label, in order", () => {
    expect(FIELD_KEYS).toEqual(["title", ...METADATA_FIELDS.map((f) => f.label)]);
  });

  it("every field's canonical (write) key is the first entry in its own read chain", () => {
    // lib/cloudinaryAdmin.ts's mergeContext writes only keys[0] on a non-empty
    // value — if a label and its chain's first key ever diverged, setting a
    // field would silently write under the wrong key.
    for (const { label, keys } of METADATA_FIELDS) {
      expect(keys[0]).toBe(label);
    }
  });

  it("fieldsFromContext derives one Fields entry per METADATA_FIELDS entry, nothing more or less", () => {
    const metaFields = Object.fromEntries(
      METADATA_FIELDS.map((f, i) => [f.label, `value-${i}`])
    );

    const fields = fieldsFromContext("My Title", metaFields);

    expect(fields.title).toBe("My Title");
    for (const { label } of METADATA_FIELDS) {
      expect(fields[label as FieldKey]).toBe(metaFields[label]);
    }
    expect(Object.keys(fields).sort()).toEqual([...FIELD_KEYS].sort());
  });

  it('fieldsFromContext defaults a missing metadata value to "", never undefined', () => {
    // This is what used to wipe a field on save: an admin form that never
    // shows an input for a field submits "" for it, and the write path
    // treats "" as "clear this key." A newly-added field must still resolve
    // to "" here (a real, present key) rather than leaving it out of the
    // object entirely — the shape the old three-copies bug would produce.
    const fields = fieldsFromContext("", {});
    for (const { label } of METADATA_FIELDS) {
      expect(fields[label as FieldKey]).toBe("");
    }
  });
});
