
import { Client } from "@gradio/client";
import sharp from "sharp";

export const config = {
  maxDuration: 60
};

const SPACE =
  process.env.IMAGE_EDIT_SPACE ||
  "kulkas2pintu/QWEN_EDIT_IMAGE";

const MAX_INPUT = 3 * 1024 * 1024;
const MAX_OUTPUT = 8 * 1024 * 1024;

function getMime(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) return "image/jpeg";

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from("89504e470d0a1a0a", "hex")
    )
  ) return "image/png";

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";

  return null;
}

function readInput(image) {
  if (typeof image !== "string") {
    throw new Error("Fotoğraf yüklenmedi.");
  }

  const base64 = image.replace(
    /^data:image\/(?:png|jpeg|jpg|webp);base64,/i,
    ""
  );

  if (
    !base64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new Error("Geçersiz fotoğraf verisi.");
  }

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length || buffer.length > MAX_INPUT) {
    throw new Error(
      "Fotoğraf en fazla 3 MB olabilir."
    );
  }

  const mime = getMime(buffer);

  if (!mime) {
    throw new Error(
      "Yalnızca PNG, JPG veya WEBP yükle."
    );
  }

  return { buffer, mime };
}

function findOutput(value) {
  if (!value) return null;

  if (typeof value === "string") {
    if (
      value.startsWith("https://") ||
      value.startsWith("data:image/")
    ) return value;

    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOutput(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const key of [
      "url",
      "image",
      "path",
      "value",
      "data"
    ]) {
      const found = findOutput(value[key]);
      if (found) return found;
    }
  }

  return null;
}

function allowedUrl(value) {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("Güvensiz görsel adresi.");
  }

  const hosts = [
    "huggingface.co",
    "hf.space",
    "gradio.live"
  ];

  const allowed = hosts.some(
    host =>
      url.hostname === host ||
      url.hostname.endsWith("." + host)
  );

  if (!allowed) {
    throw new Error(
      "Beklenmeyen görsel sunucusu."
    );
  }

  return url.toString();
}

async function loadOutput(value) {
  if (value.startsWith("data:image/")) {
    const match = value.match(
      /^data:image\/(?:png|jpeg|webp);base64,(.+)$/s
    );

    if (!match) {
      throw new Error("Geçersiz görsel çıktısı.");
    }

    const buffer = Buffer.from(match[1], "base64");

    if (buffer.length > MAX_OUTPUT) {
      throw new Error("Çıktı çok büyük.");
    }

    return buffer;
  }

  const url = allowedUrl(value);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: "error"
  });

  if (!response.ok) {
    throw new Error(
      `Görsel indirilemedi: HTTP ${response.status}`
    );
  }

  const size = Number(
    response.headers.get("content-length") || 0
  );

  if (size > MAX_OUTPUT) {
    throw new Error("Çıktı çok büyük.");
  }

  const chunks = [];
  let total = 0;

  if (!response.body) {
    throw new Error("Boş görsel yanıtı.");
  }

  for await (const chunk of response.body) {
    total += chunk.length;

    if (total > MAX_OUTPUT) {
      throw new Error("Çıktı çok büyük.");
    }

    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  if (!getMime(buffer)) {
    throw new Error(
      "Servis geçerli görsel dosyası döndürmedi."
    );
  }

  return buffer;
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
        error: "Düzenleme komutu yaz."
      });
    }

    const input = readInput(image);

    const client = await Client.connect(
      SPACE,
      process.env.HF_TOKEN
        ? { token: process.env.HF_TOKEN }
        : {}
    );

    const result = await client.predict("/edit", {
      image: new Blob(
        [input.buffer],
        { type: input.mime }
      ),
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

    const outputUrl = findOutput(result?.data);

    if (!outputUrl) {
      throw new Error(
        "Düzenlenmiş görsel çıktısı bulunamadı."
      );
    }

    const outputBuffer = await loadOutput(outputUrl);

    const png = await sharp(outputBuffer)
      .rotate()
      .png()
      .toBuffer();

    if (png.length > MAX_OUTPUT) {
      throw new Error(
        "PNG dosyası izin verilen boyutu aşıyor."
      );
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="edited-image.png"'
    );
    res.setHeader("Content-Length", png.length);

    return res.status(200).send(png);

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

