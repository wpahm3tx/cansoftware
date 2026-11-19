
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST gerekli."
    });
  }

  const token = process.env.HF_TOKEN;

  if (!token) {
    return res.status(503).json({
      error: "Vercel'e HF_TOKEN eklenmeli."
    });
  }

  const prompt =
    typeof req.body?.prompt === "string"
      ? req.body.prompt.trim()
      : "";

  if (!prompt || prompt.length > 1500) {
    return res.status(400).json({
      error: "Görsel açıklaması 1-1500 karakter olmalı."
    });
  }

  try {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      55000
    );

    let response;

    try {
      response = await fetch(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "image/png"
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              num_inference_steps: 4
            }
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 350);

      console.error(
        "Hugging Face hatası:",
        response.status,
        detail
      );

      let error = "Görsel oluşturulamadı.";

      if ([401, 403].includes(response.status)) {
        error = "API anahtarı geçersiz veya model erişimi yok.";
      } else if (response.status === 402) {
        error = "Görsel üretim kredisi yetersiz.";
      } else if (response.status === 429) {
        error = "Görsel oluşturma kotası doldu.";
      } else {
        error = `Görsel servisi hatası (${response.status}).`;
      }

      return res.status(502).json({ error });
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.startsWith("image/")) {
      return res.status(502).json({
        error: "Servis geçerli bir görsel döndürmedi."
      });
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(502).json({
        error: "Oluşturulan görsel çok büyük."
      });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(buffer);

  } catch (error) {
    console.error("Görsel üretim hatası:", error);

    return res.status(502).json({
      error:
        error.name === "AbortError"
          ? "Görsel oluşturma zaman aşımına uğradı."
          : "Görsel servisine bağlanılamadı."
    });
  }
}
