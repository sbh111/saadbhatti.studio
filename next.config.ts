import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // transformers.js pulls in onnxruntime-node (a native addon); keep it external so
  // Next bundles a require() rather than trying to trace/bundle the binary. Used by
  // the CLIP text encoder in lib/clip.ts (app/api/search).
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
