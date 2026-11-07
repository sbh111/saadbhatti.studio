import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/clip.ts dynamically imports @huggingface/transformers inside getEncoder()
// (kept out of the module's top-level so tests never need the real onnxruntime
// native addon) — mock it here to verify BOTH from_pretrained calls are pinned
// to the same commit revision (tech debt 2.3: previously unpinned, so an
// upstream repush of the repo would silently swap in a different text tower).
const tokenizerFromPretrained = vi.fn();
const modelFromPretrained = vi.fn();

vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: {
    from_pretrained: (...args: unknown[]) => tokenizerFromPretrained(...args),
  },
  CLIPTextModelWithProjection: {
    from_pretrained: (...args: unknown[]) => modelFromPretrained(...args),
  },
}));

// Mirrors the literal pinned in lib/clip.ts — this test's whole point is to
// catch that literal ever silently reverting to an unpinned "main" load, so
// it intentionally does NOT import the constant from the module under test.
const PINNED_REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a";

describe("lib/clip.ts model pinning", () => {
  beforeEach(() => {
    vi.resetModules();
    tokenizerFromPretrained.mockReset();
    modelFromPretrained.mockReset();
  });

  it("pins the tokenizer and text model to the same commit revision", async () => {
    const fakeTokenizer = vi.fn(() => ({ input_ids: [], attention_mask: [] }));
    tokenizerFromPretrained.mockResolvedValue(fakeTokenizer);

    const fakeModel = vi.fn().mockResolvedValue({
      text_embeds: { data: new Float32Array(512).fill(1) },
    });
    modelFromPretrained.mockResolvedValue(fakeModel);

    const { embedText } = await import("@/lib/clip");
    await embedText("a photo of a cat");

    expect(tokenizerFromPretrained).toHaveBeenCalledWith(
      "Xenova/clip-vit-base-patch32",
      expect.objectContaining({ revision: PINNED_REVISION })
    );
    expect(modelFromPretrained).toHaveBeenCalledWith(
      "Xenova/clip-vit-base-patch32",
      expect.objectContaining({ revision: PINNED_REVISION })
    );
  });

  it("loads the encoder once and reuses it across concurrent calls", async () => {
    tokenizerFromPretrained.mockResolvedValue(
      vi.fn(() => ({ input_ids: [], attention_mask: [] }))
    );
    modelFromPretrained.mockResolvedValue(
      vi.fn().mockResolvedValue({ text_embeds: { data: new Float32Array(512).fill(1) } })
    );

    const { embedText } = await import("@/lib/clip");
    await Promise.all([embedText("a"), embedText("b")]);

    expect(tokenizerFromPretrained).toHaveBeenCalledTimes(1);
    expect(modelFromPretrained).toHaveBeenCalledTimes(1);
  });
});
