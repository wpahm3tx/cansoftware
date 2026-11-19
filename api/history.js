
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

async function request(path, token, options = {}) {
  const response = await fetch(`${URL}${path}`, {
    ...options,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || "Veritabanı işlemi başarısız."
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    return res.status(405).json({
      error: "Desteklenmeyen yöntem."
    });
  }

  if (!URL || !KEY) {
    return res.status(500).json({
      error: "Supabase yapılandırması eksik."
    });
  }

  try {
    const auth = req.headers.authorization || "";
    const token = auth.match(/^Bearer (.+)$/i)?.[1];

    if (!token) {
      return res.status(401).json({
        error: "Giriş yapmalısın."
      });
    }

    const user = await request("/auth/v1/user", token);

    if (!user?.id) {
      return res.status(401).json({
        error: "Geçersiz oturum."
      });
    }

    const userId = user.id;

    // Sohbetleri listele
    if (req.method === "GET" && !req.query?.id) {
      const conversations = await request(
        "/rest/v1/conversations" +
        "?select=id,title,created_at,updated_at" +
        "&order=updated_at.desc&limit=100",
        token
      );

      return res.status(200).json({ conversations });
    }

    // Tek sohbetin mesajlarını getir
    if (req.method === "GET" && req.query?.id) {
      const id = String(req.query.id);

      const messages = await request(
        "/rest/v1/messages" +
        "?conversation_id=eq." + encodeURIComponent(id) +
        "&select=id,role,content,created_at" +
        "&order=created_at.asc&limit=500",
        token
      );

      return res.status(200).json({ messages });
    }

    // Yeni sohbet oluştur
    if (req.method === "POST" &&
        req.body?.action === "create") {
      const title = String(
        req.body.title || "Yeni Sohbet"
      ).slice(0, 150);

      const result = await request(
        "/rest/v1/conversations",
        token,
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: userId,
            title
          })
        }
      );

      return res.status(201).json({
        conversation: result?.[0]
      });
    }

    // Mesaj kaydet
    if (req.method === "POST" &&
        req.body?.action === "message") {
      const { conversationId, role, content } = req.body;

      if (
        typeof conversationId !== "string" ||
        !["user", "assistant"].includes(role) ||
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 100000
      ) {
        return res.status(400).json({
          error: "Geçersiz mesaj."
        });
      }

      const result = await request(
        "/rest/v1/messages",
        token,
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: userId,
            conversation_id: conversationId,
            role,
            content
          })
        }
      );

      return res.status(201).json({
        message: result?.[0]
      });
    }

    // Sohbet sil
    if (req.method === "DELETE") {
      const id = req.body?.id;

      if (typeof id !== "string" || !id) {
        return res.status(400).json({
          error: "Sohbet ID gerekli."
        });
      }

      await request(
        "/rest/v1/conversations" +
        "?id=eq." + encodeURIComponent(id) +
        "&user_id=eq." + encodeURIComponent(userId),
        token,
        {
          method: "DELETE",
          headers: { Prefer: "return=minimal" }
        }
      );

      return res.status(200).json({
        success: true,
        message: "Sohbet silindi."
      });
    }

    return res.status(400).json({
      error: "Geçersiz işlem."
    });

  } catch (error) {
    console.error("CAN HISTORY:", error.message);

    return res.status(
      error.status === 401 ? 401 : 500
    ).json({
      error: "Sohbet geçmişi işlemi başarısız."
    });
  }
}
