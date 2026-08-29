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
 */

const MODEL_ID = "Xenova/clip-vit-base-patch32";
export const EMBED_DIM = 512;

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
        AutoTokenizer.from_pretrained(MODEL_ID),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID),
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
