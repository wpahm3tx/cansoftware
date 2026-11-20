
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
    throw new Error("Upstash ayarları eksik.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error("Upstash bağlantı hatası.");
  }

  const data = await response.json();

  if (data.error) {
    throw new Error("Redis hatası: " + data.error);
  }

  return data.result;
}

async function authenticate(req) {
  const token = (
    req.headers.authorization || ""
  ).replace(/^Bearer\s+/i, "");

  if (!token) {
    const error = new Error("Giriş yapmalısın.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    const error = new Error("Oturum geçersiz.");
    error.status = 401;
    throw error;
  }

  return response.json();
}

function isFounder(user) {
  return (
    (user.email || "").trim().toLowerCase() ===
      FOUNDER_EMAIL &&
    Boolean(user.email_confirmed_at)
  );
}

function activePro(record) {
  if (!record || record.is_pro !== true) {
    return false;
  }

  if (!record.pro_expires_at) {
    return true;
  }

  const expiry = Date.parse(record.pro_expires_at);

  return Number.isFinite(expiry) &&
    expiry > Date.now();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Yalnızca GET isteği kullanılabilir."
    });
  }

  try {
    const user = await authenticate(req);

    if (!isFounder(user)) {
      return res.status(403).json({
        error: "Bu paneli yalnızca kurucu açabilir."
      });
    }

    const ids = await redis([
      "SMEMBERS",
      "membership:users"
    ]);

    const users = [];

    for (const id of ids || []) {
      const [
        email,
        raw
      ] = await Promise.all([
        redis([
          "HGET",
          `membership:profile:${id}`,
          "email"
        ]),
        redis([
          "GET",
          `membership:${id}`
        ])
      ]);

      let record = null;

      if (raw) {
        try {
          record = JSON.parse(raw);
        } catch {
          record = null;
        }
      }

      const founder =
        (email || "").trim().toLowerCase() ===
        FOUNDER_EMAIL;

      users.push({
        user_id: id,
        email: email || "",
        role: founder
          ? "admin"
          : record?.role || "user",
        is_pro: founder
          ? true
          : activePro(record),
        pro_expires_at: founder
          ? null
          : record?.pro_expires_at || null,
        founder
      });
    }

    users.sort((a, b) => {
      if (a.founder !== b.founder) {
        return a.founder ? -1 : 1;
      }

      return a.email.localeCompare(
        b.email,
        "tr"
      );
    });

    return res.status(200).json({
      success: true,
      total: users.length,
      users
    });

  } catch (error) {
    console.error("Admin Users API:", error);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : "Kullanıcı listesi alınamadı. Vercel loglarını kontrol et."
    });
  }
}

  }
}
