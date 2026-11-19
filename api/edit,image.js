
const SPACE = "kulkas2pintu/QWEN_EDIT_IMAGE";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Yalnızca POST isteği destekleniyor."
    });
  }

  try {
    const { image, prompt } = req.body || {};

    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        error: "Fotoğraf düzenleme komutu yazmalısın."
      });
    }

    if (
      typeof image !== "string" ||
      image.length > 4500000 ||
      !/^[A-Za-z0-9+/=]+$/.test(image)
    ) {
      return res.status(400).json({
        error: "Geçerli bir fotoğraf yüklemelisin."
      });
    }

    const buffer = Buffer.from(image, "base64");

    if (buffer.length > 3200000 || buffer.length < 100) {
      return res.status(413).json({
        error: "Fotoğraf boyutu desteklenmiyor."
      });
    }

    const { Client, handle_file } = await import("@gradio/client");

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

    const item = result?.data?.[0];

    const url = typeof item === "string"
      ? item
      : item?.url;

    if (!url || !/^https:\/\//i.test(url)) {
      throw new Error("Servis geçerli görsel adresi döndürmedi.");
    }

    return res.status(200).json({ url });

  } catch (error) {
    console.error("AI edit error:", error);

    return res.status(503).json({
      error: "Fotoğraf düzenleme servisi isteği tamamlayamadı.",
      detail: String(error?.message || "Bilinmeyen hata").slice(0, 250)
    });
  }
};
