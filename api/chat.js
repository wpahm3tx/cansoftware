
export default async function handler(req, res) {
  // Yalnızca POST isteklerine izin ver
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Yalnızca POST isteği kullanılabilir."
    });
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GROQ_API_KEY Vercel'de bulunamadı."
    });
  }

  try {
    const { message, history = [] } = req.body || {};

    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 4000
    ) {
      return res.status(400).json({
        error: "Geçerli bir mesaj yazmalısın."
      });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter(item =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
          )
          .slice(-10)
          .map(item => ({
            role: item.role,
            content: item.content.slice(0, 4000)
          }))
      : [];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content:
                "Sen BRDX AI isimli yardımcı bir yapay zekasın. " +
                "Türkçe konuş. Kullanıcıya doğal, anlaşılır, " +
                "doğru ve faydalı cevaplar ver. " +
                "Kod yazabilir, soruları yanıtlayabilir, " +
                "fikir ve öneriler sunabilirsin. " +
                "Bilmediğin konularda dürüst ol."
            },
            ...safeHistory,
            {
              role: "user",
              content: message.trim()
            }
          ],
          temperature: 0.7,
          max_completion_tokens: 1024
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq API hatası:", response.status);

      return res.status(502).json({
        error:
          response.status === 429
            ? "AI kullanım sınırına ulaşıldı. Biraz sonra tekrar dene."
            : "AI servisi yanıt veremedi.",
        providerStatus: response.status
      });
    }

    const reply =
      data.choices?.[0]?.message?.content;

    if (!reply) {
      return res.status(502).json({
        error: "Yapay zekadan cevap alınamadı."
      });
    }

    return res.status(200).json({
      reply
    });

  } catch (error) {
    console.error("BRDX AI sohbet hatası:", error);

    return res.status(500).json({
      error: "Sohbet sırasında bağlantı hatası oluştu."
    });
  }
}
