import type { NextConfig } from "next";

// Native ONNX runtime files the CLIP text encoder needs at runtime. Tracing picks
// up the .node addon but not the shared libraries it dlopen()s, which is why the
// function died with "libonnxruntime.so.1: cannot open shared object file".
const ORT_LINUX_X64 = "./node_modules/onnxruntime-node/bin/napi-v3/linux/x64";

const nextConfig: NextConfig = {
  // transformers.js pulls in onnxruntime-node (a native addon); keep it external so
  // Next bundles a require() rather than trying to trace/bundle the binary. Used by
  // the CLIP text encoder in lib/clip.ts (app/api/search).
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],

  // Ship the CPU runtime with the search function (~43 MB).
  outputFileTracingIncludes: {
    "/api/search": [
      `${ORT_LINUX_X64}/onnxruntime_binding.node`,
      `${ORT_LINUX_X64}/libonnxruntime.so.1`,
      `${ORT_LINUX_X64}/libonnxruntime.so.1.21.0`,
      `${ORT_LINUX_X64}/libonnxruntime_providers_shared.so`,
    ],
  },

  // Keep everything else OUT. The GPU providers and the other platforms' binaries
  // are useless on Vercel and enormous — the CUDA provider alone is 327 MB, which
  // would blow the 250 MB unzipped function limit on its own.
  outputFileTracingExcludes: {
    "/api/search": [
      `${ORT_LINUX_X64}/libonnxruntime_providers_cuda.so`,
      `${ORT_LINUX_X64}/libonnxruntime_providers_tensorrt.so`,
      "./node_modules/onnxruntime-node/bin/napi-v3/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v3/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/**",
    ],
  },
};

export default nextConfig;
