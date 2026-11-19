
import { Client } from "@gradio/client";

export const config = {
  maxDuration: 60
};

const SPACE =
  process.env.IMAGE_GENERATION_SPACE ||
  "black-forest-labs/FLUX.1-schnell";

function findImage(value) {
  if (!value) return null;

  if (typeof value === "string") {
    return /^https:\/\//.test(value) ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findImage(item);
      if (url) return url;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const key of ["url", "image", "path", "data"]) {
      const url = findImage(value[key]);
      if (url) return url;
    }
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST isteği gerekli."
    });
  }

  try {
    const { prompt } = req.body || {};

    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 2000
    ) {
      return res.status(400).json({
        error: "Görsel açıklaması 1-2000 karakter olmalı."
      });
    }

    const client = await Client.connect(
      SPACE,
      process.env.HF_TOKEN
        ? { token: process.env.HF_TOKEN }
        : {}
    );

    const result = await client.predict("/infer", {
      prompt: prompt.trim(),
      seed: 0,
      randomize_seed: true,
      width: 1024,
      height: 1024,
      num_inference_steps: 4
    });

    const url = findImage(result?.data);

    if (!url) {
      return res.status(502).json({
        error: "Servis geçerli bir görsel döndürmedi."
      });
    }

    return res.status(200).json({
      success: true,
      url,
      image: url
    });

  } catch (error) {
    console.error("CAN IMAGE GENERATE:", error);

    return res.status(503).json({
      error: "Fotoğraf oluşturma başarısız.",
      details: String(error?.message || error)
        .slice(0, 400)
    });
  }
}
