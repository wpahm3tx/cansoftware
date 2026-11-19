
export default async function handler(req, res) {
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
      message.length > 12000
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
          .slice(-12)
          .map(item => ({
            role: item.role,
            content: item.content.slice(0, 6000)
          }))
      : [];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            {
              role: "system",
              content: [
                "Sen CAN SOFTWARE AI isimli bir yapay zekâ asistanısın.",
                "Kullanıcıya Türkçe, doğru ve anlaşılır cevap ver.",
                "İstenen kodları eksiksiz ve çalıştırılabilir yaz.",
                "Uzun cevaplarda önemli bölümleri atlama.",
                "Kullanıcı fotoğraf düzenleme istediğinde",
                "gerçekte fotoğraf düzenlemediysen",
                "düzenlemiş gibi davranma.",
                "Gereksiz tekrar yapma.",
                "Bilmediğin konularda dürüst ol."
              ].join(" ")
            },
            ...safeHistory,
            {
              role: "user",
              content: message.trim()
            }
          ],
          temperature: 0.6,
          max_completion_tokens: 4096
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Groq API hatası:",
        response.status,
        JSON.stringify(data).slice(0, 500)
      );

      return res.status(502).json({
        error: response.status === 429
          ? "AI kullanım sınırına ulaşıldı. Biraz sonra tekrar dene."
          : "AI servisi yanıt veremedi.",
        providerStatus: response.status
      });
    }

    const choice = data.choices?.[0];
    const reply = choice?.message?.content;

    if (!reply || !reply.trim()) {
      return res.status(502).json({
        error: "Yapay zekâdan metin yanıtı alınamadı."
      });
    }

    return res.status(200).json({
      reply,
      truncated: choice.finish_reason === "length",
      finishReason: choice.finish_reason || null
    });

  } catch (error) {
    console.error("CAN SOFTWARE AI sohbet hatası:", error);

    return res.status(500).json({
      error: "Sohbet sırasında bağlantı hatası oluştu."
    });
  }
}

