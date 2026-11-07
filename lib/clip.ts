import type { PreTrainedModel, PreTrainedTokenizer } from "@huggingface/transformers";

/**
 * Server-only CLIP *text* encoder for search queries. This is the only ML that
 * runs in the site: the heavy image encoding is done offline by the containerized
 * Python service (embed/), which writes vectors into Postgres. Here we only turn a
 * short query string into a 512-d vector in the SAME space, so it can be compared
 * against the stored image vectors.
 *
 * MODEL PARITY: this MUST stay the OpenAI CLIP ViT-B/32 (512-d). The Python side
 * embeds images with the PyTorch build of the same model; the two only line up
 * because they are the same variant. Do not swap this without re-embedding images.
 *
 * Runtime-agnostic on purpose: no Vercel-only APIs, so it works in a serverless
 * function today and in a long-lived Node container later (where the one-time load
 * below stops mattering because the process stays warm).
 *
 * COLD-START COST: transformers.js has no default quantization on Node (only
 * the wasm backend defaults to int8 — see DEFAULT_DEVICE_DTYPE_MAPPING in
 * @huggingface/transformers), so every cold instance downloads the fp32 text
 * tower from the HuggingFace CDN: ~242 MB for onnx/text_model.onnx alone, plus
 * a few MB of tokenizer files (measured against the pinned revision below).
 * Quantizing would shift the query-vector space out of parity with the
 * image vectors (same reasoning as the MODEL PARITY note above), so it's not
 * an option here — and baking that fp32 weight into the function alongside
 * onnxruntime-node (~43 MB, see next.config.ts) would exceed Vercel's 250 MB
 * unzipped function limit on its own. Documented as an accepted cold-start
 * dependency on the HF CDN in docs/system-overview.md §8 and
 * docs/operations.md §1; the longer-term fix is moving query encoding into a
 * warm, long-lived container (see "Escape hatches" in system-overview.md §8),
 * consistent with this project's direction of containerizing services.
 */

const MODEL_ID = "Xenova/clip-vit-base-patch32";
// Pinned 2026-09-13 to the repo's current HEAD commit (checked via
// https://huggingface.co/api/models/Xenova/clip-vit-base-patch32). Previously
// unpinned (implicit "main"): if upstream ever repushes this repo, an unpinned
// load would silently start returning a DIFFERENT text tower than whatever
// PyTorch checkpoint embed/main.py used for the stored image vectors — no
// error, just query vectors that no longer line up with the image space
// (tech debt 2.3). Changing this value (or embed/main.py's MODEL_REVISION)
// requires re-embedding every artwork with the embedder afterward.
const MODEL_REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a";
export const EMBED_DIM = 512;
const CACHE_DIR = "/tmp/hf-cache"

interface TextEncoder {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

// Single in-flight init promise: concurrent first-requests await ONE load, never
// each spin up their own copy (which would blow memory / time out on a cold start).
let encoderPromise: Promise<TextEncoder> | null = null;

async function getEncoder(): Promise<TextEncoder> {
  if (!encoderPromise) {
    encoderPromise = (async () => {
      const { AutoTokenizer, CLIPTextModelWithProjection } = await import(
        "@huggingface/transformers"
      );
      // Load ONLY the text tower — the vision tower never runs in the site.
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL_ID, {
          cache_dir: CACHE_DIR,
          revision: MODEL_REVISION,
        }),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
          cache_dir: CACHE_DIR,
          revision: MODEL_REVISION,
        }),
      ]);
      return { tokenizer, model };
    })().catch((err) => {
      // Reset so a transient load failure can be retried on the next request
      // rather than being cached forever.
      encoderPromise = null;
      throw err;
    });
  }
  return encoderPromise;
}

/** L2-normalize in place so cosine similarity reduces to a dot product. */
function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/**
 * Encode a query string to a normalized 512-d CLIP text embedding. Callers should
 * gate/limit BEFORE calling this — it is the expensive step.
 */
export async function embedText(query: string): Promise<Float32Array> {
  const { tokenizer, model } = await getEncoder();
  const inputs = tokenizer([query], { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  // text_embeds: [1, 512]. Copy out of the tensor into a plain Float32Array.
  const data = text_embeds.data as Float32Array | number[];
  const vec = Float32Array.from(data).slice(0, EMBED_DIM);
  return l2normalize(vec);
}
