
const SUPABASE_URL =
  "https://xllmhgabuzaledxqqufe.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_7BnfXFJWwC77ddC8jTXhfA_gvoMYDrL";

const FOUNDER_EMAIL =
  "ahmetbinarbasi64@gmail.com";

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Upstash ayarları eksik");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error("Redis bağlantısı başarısız");
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}

async function getUser(req) {
  const token = (
    req.headers.authorization || ""
  ).replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new Error("Oturum bulunamadı");
  }

  const response = await fetch(
    SUPABASE_URL + "/auth/v1/user",
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + token
      }
    }
  );

  if (!response.ok) {
    throw new Error("Geçersiz oturum");
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Geçersiz istek"
    });
  }

  try {
    const user = await getUser(req);

    const founder =
      user.email?.trim().toLowerCase() ===
        FOUNDER_EMAIL &&
      Boolean(user.email_confirmed_at);

    if (!founder) {
      return res.status(403).json({
        error: "Yalnızca kurucu kullanıcıları görebilir"
      });
    }

    const ids = await redis([
      "SMEMBERS",
      "membership:users"
    ]);

    const users = [];

    for (const id of ids || []) {
      const saved = await redis([
        "GET",
        "membership:" + id
      ]);

      const record = saved
        ? JSON.parse(saved)
        : {};

      users.push({
        user_id: id,
        email: record.email || "",
        role: record.role || "user",
        is_pro: Boolean(record.is_pro),
        pro_expires_at:
          record.pro_expires_at || null
      });
    }

    return res.status(200).json({
      users
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Kullanıcı listesi alınamadı"
    });
  }
}
