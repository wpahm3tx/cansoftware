
import { Client, handle_file } from "@gradio/client";

export const config = {
  maxDuration: 60
};

const SPACE = "kulkas2pintu/QWEN_EDIT_IMAGE";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
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
        error: "Düzenleme komutu yaz."
      });
    }

    if (
      typeof image !== "string" ||
      image.length > 4500000 ||
      !/^[A-Za-z0-9+/=]+$/.test(image)
    ) {
      return res.status(400).json({
        error: "Geçerli ve 3 MB'den küçük fotoğraf yükle."
      });
    }

    const buffer = Buffer.from(image, "base64");

    const client = await Client.connect(SPACE);

    const result = await client.predict("/edit", {
      image: handle_file(buffer),
      prompt: prompt.trim(),
      lora_adapter: "",
      guidance_scale: 2.5,
      steps: 6,
      output_size: 1024,
      fix_hands: true
    });

    const output = result?.data?.[0];

    const url =
      typeof output === "string"
        ? output
        : output?.url;

    if (!url || !url.startsWith("https://")) {
      throw new Error("AI geçerli görsel döndürmedi.");
    }

    return res.status(200).json({ url });

  } catch (error) {
    console.error("AI edit error:", error);

    return res.status(503).json({
      error:
        "Ücretsiz AI düzenleme servisi yanıt vermedi. " +
        "Servis kapalı, yoğun veya API değişmiş olabilir."
    });
  }
}
