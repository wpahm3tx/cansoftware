
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://xllmhgabuzaledxqqufe.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY;

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

async function supabaseFetch(path, token, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.error_description ||
      "Supabase işlemi başarısız."
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    return sendError(res, 405, "Desteklenmeyen yöntem.");
  }

  if (!SUPABASE_KEY) {
    return sendError(res, 500, "Supabase anahtarı eksik.");
  }

  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : "";

    if (!token) {
      return sendError(res, 401, "Önce giriş yapmalısın.");
    }

    // Kullanıcıyı Supabase üzerinden doğrula
    const user = await supabaseFetch(
      "/auth/v1/user",
      token
    );

    if (!user?.id) {
      return sendError(res, 401, "Geçersiz oturum.");
    }

    const userId = user.id;

    // Hafızayı listele
    if (req.method === "GET") {
      const memories = await supabaseFetch(
        "/rest/v1/user_memories" +
        "?select=id,memory_key,memory_value,created_at,updated_at" +
        "&order=updated_at.desc&limit=100",
        token
      );

      return res.status(200).json({
        success: true,
        memories
      });
    }

    // Hafıza kaydet veya güncelle
    if (req.method === "POST") {
      const { key, value } = req.body || {};

      if (
        typeof key !== "string" ||
        typeof value !== "string" ||
        !key.trim() ||
        !value.trim()
      ) {
        return sendError(
          res,
          400,
          "Hafıza anahtarı ve değeri gerekli."
        );
      }

      if (key.length > 100 || value.length > 5000) {
        return sendError(
          res,
          400,
          "Hafıza kaydı çok uzun."
        );
      }

      const result = await supabaseFetch(
        "/rest/v1/user_memories" +
        "?on_conflict=user_id,memory_key",
        token,
        {
          method: "POST",
          headers: {
            Prefer:
              "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify({
            user_id: userId,
            memory_key: key.trim(),
            memory_value: value.trim(),
            updated_at: new Date().toISOString()
          })
        }
      );

      return res.status(200).json({
        success: true,
        message: "Hafıza kaydedildi.",
        memory: result?.[0] || null
      });
    }

    // Hafızayı sil
    if (req.method === "DELETE") {
      const key = req.body?.key;

      if (typeof key !== "string" || !key.trim()) {
        return sendError(res, 400, "Silinecek kayıt gerekli.");
      }

      await supabaseFetch(
        "/rest/v1/user_memories" +
        "?memory_key=eq." + encodeURIComponent(key.trim()) +
        "&user_id=eq." + encodeURIComponent(userId),
        token,
        {
          method: "DELETE",
          headers: {
            Prefer: "return=minimal"
          }
        }
      );

      return res.status(200).json({
        success: true,
        message: "Hafıza silme işlemi tamamlandı."
      });
    }

  } catch (error) {
    console.error("CAN MEMORY:", error.message);

    return sendError(
      res,
      error.status === 401 ? 401 : 500,
      error.status === 401
        ? "Oturum geçersiz."
        : "Hafıza işlemi gerçekleştirilemedi."
    );
  }
}
