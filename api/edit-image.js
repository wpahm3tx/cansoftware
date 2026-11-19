
import { Client } from "@gradio/client";

export const config = {
  maxDuration: 60
};

const SPACE =
  process.env.IMAGE_EDIT_SPACE ||
  "kulkas2pintu/QWEN_EDIT_IMAGE";

const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

function findImage(value) {
  if (!value) return null;

  if (typeof value === "string") {
    if (
      value.startsWith("https://") ||
      value.startsWith("data:image/")
    ) {
      return value;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImage(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const key of [
      "url",
      "image",
      "path",
      "data",
      "value"
    ]) {
      const found = findImage(value[key]);
      if (found) return found;
    }
  }

  return null;
}

function detectMime(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from("89504e470d0a1a0a", "hex")
    )
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function parseImage(input) {
  if (typeof input !== "string") {
    throw new Error("Fotoğraf yüklenmedi.");
  }

  const base64 = input.replace(
    /^data:image\/(?:png|jpeg|jpg|webp);base64,/i,
    ""
  );

  if (
    !base64 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new Error("Geçersiz Base64 fotoğraf.");
  }

  const buffer = Buffer.from(base64, "base64");

  if (
    buffer.length === 0 ||
    buffer.length > MAX_INPUT_BYTES
  ) {
    throw new Error(
      "Fotoğraf 3 MB'den küçük olmalı."
    );
  }

  const mime = detectMime(buffer);

  if (!mime) {
    throw new Error(
      "Yalnızca JPG, PNG ve WEBP destekleniyor."
    );
  }

  return { buffer, mime };
}

async function downloadImage(url) {
  if (url.startsWith("data:image/")) {
    const match = url.match(
      /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s
    );

    if (!match) {
      throw new Error("Geçersiz görsel verisi.");
    }

    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length > MAX_OUTPUT_BYTES) {
      throw new Error("Çıktı görseli çok büyük.");
    }

    return {
      buffer,
      mime: detectMime(buffer)
    };
  }

  const parsed = new URL(url);

  if (parsed.protocol !== "https:") {
    throw new Error("Güvensiz görsel adresi.");
  }

  const allowedHosts = [
    "huggingface.co",
    "hf.space",
    "gradio.live"
  ];

  const allowed = allowedHosts.some(
    host =>
      parsed.hostname === host ||
      parsed.hostname.endsWith("." + host)
  );

  if (!allowed) {
    throw new Error(
      "Görsel beklenmeyen bir sunucudan geldi."
    );
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: "error"
  });

  if (!response.ok) {
    throw new Error(
      `Görsel indirilemedi: HTTP ${response.status}`
    );
  }

  const length = Number(
    response.headers.get("content-length") || 0
  );

  if (length > MAX_OUTPUT_BYTES) {
    throw new Error("Çıktı görseli çok büyük.");
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  if (buffer.length > MAX_OUTPUT_BYTES) {
    throw new Error("Çıktı görseli çok büyük.");
  }

  const mime = detectMime(buffer);

  if (!mime) {
    throw new Error(
      "Servis görsel yerine başka veri döndürdü."
    );
  }

  return { buffer, mime };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "POST isteği gerekli."
    });
  }

  try {
    const { image, prompt } = req.body || {};

    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 1500
    ) {
      return res.status(400).json({
        success: false,
        error: "Geçerli düzenleme komutu yaz."
      });
    }

    const { buffer, mime } = parseImage(image);

    const client = await Client.connect(
      SPACE,
      process.env.HF_TOKEN
        ? { token: process.env.HF_TOKEN }
        : {}
    );

    const blob = new Blob([buffer], {
      type: mime
    });

    const result = await client.predict("/edit", {
      image: blob,
      prompt: prompt.trim(),
      lora_adapter: "",
      image2: null,
      seed: 0,
      randomize_seed: true,
      guidance_scale: 1.0,
      steps: 4,
      preserve_identity: true,
      identity_strength: 80,
      output_size: 1024,
      fix_hands: false
    });

    const imageUrl = findImage(result?.data);

    if (!imageUrl) {
      throw new Error(
        "AI geçerli görsel çıktısı döndürmedi."
      );
    }

    const output = await downloadImage(imageUrl);

    if (!output.mime) {
      throw new Error(
        "Oluşturulan görselin biçimi geçersiz."
      );
    }

    const base64 = output.buffer.toString("base64");

    const dataUrl =
      `data:${output.mime};base64,${base64}`;

    return res.status(200).json({
      success: true,
      url: dataUrl,
      image: dataUrl,
      message: "Fotoğraf başarıyla düzenlendi."
    });

  } catch (error) {
    console.error(
      "CAN SOFTWARE IMAGE EDIT:",
      error
    );

    return res.status(503).json({
      success: false,
      error: "Fotoğraf düzenleme başarısız.",
      details: String(error?.message || error)
        .slice(0, 400)
    });
  }
}

