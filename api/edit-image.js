
import { Client } from "@gradio/client";

export const config = {
  maxDuration: 60
};

const SPACE = "kulkas2pintu/QWEN_EDIT_IMAGE";

function getImageUrl(output) {
  if (typeof output === "string") return output;

  if (output && typeof output === "object") {
    return (
      output.url ||
      output.path ||
      output.image?.url ||
      null
    );
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
    const { image, prompt } = req.body || {};

    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 1500
    ) {
      return res.status(400).json({
        error: "Fotoğraf düzenleme komutunu yaz."
      });
    }

    if (typeof image !== "string") {
      return res.status(400).json({
        error: "Fotoğraf yüklemelisin."
      });
    }

    const base64 = image.replace(
      /^data:image\/(?:png|jpeg|webp);base64,/i,
      ""
    );

    if (
      base64.length > 4500000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) ||
      !base64.length
    ) {
      return res.status(400).json({
        error: "Geçerli ve 3 MB'den küçük fotoğraf yükle."
      });
    }

    const buffer = Buffer.from(base64, "base64");

    let mime = "";

    if (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      mime = "image/jpeg";
    } else if (
      buffer.subarray(0, 8).equals(
        Buffer.from("89504e470d0a1a0a", "hex")
      )
    ) {
      mime = "image/png";
    } else if (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      mime = "image/webp";
    } else {
      return res.status(400).json({
        error: "Yalnızca JPG, PNG ve WEBP destekleniyor."
      });
    }

    const blob = new Blob([buffer], { type: mime });

    const client = await Client.connect(
      SPACE,
      process.env.HF_TOKEN
        ? { token: process.env.HF_TOKEN }
        : {}
    );

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

    console.log(
      "CAN IMAGE EDIT output:",
      JSON.stringify(result?.data).slice(0, 1000)
    );

    const url = getImageUrl(result?.data?.[0]);

    if (
      !url ||
      !/^https:\/\//i.test(url)
    ) {
      return res.status(502).json({
        error: "AI geçerli görsel bağlantısı döndürmedi.",
        outputType: typeof result?.data?.[0]
      });
    }

    return res.status(200).json({
      success: true,
      url,
      image: url
    });

  } catch (error) {
    console.error("CAN IMAGE EDIT:", error);

    return res.status(503).json({
      error:
        "Fotoğraf düzenleme servisi başarısız oldu.",
      details: String(error?.message || error)
        .slice(0, 400)
    });
  }
}
