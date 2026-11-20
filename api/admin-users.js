
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
    throw new Error("Upstash ortam değişkenleri eksik");
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
    throw new Error(`Upstash HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Redis: ${data.error}`);
  }

  return data.result;
}

async function authenticate(req) {
  const token = (
    req.headers.authorization || ""
  ).replace(/^Bearer\s+/i, "");

  if (!token) return null;

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) return null;

  return response.json();
}

function proActive(record) {
  if (record?.is_pro !== true) return false;

  if (!record.pro_expires_at) return true;

  const time = Date.parse(record.pro_expires_at);

  return Number.isFinite(time) && time > Date.now();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Yalnızca GET desteklenir"
    });
  }

  try {
    const user = await authenticate(req);

    if (!user) {
      return res.status(401).json({
        error: "Geçerli oturum gerekli"
      });
    }

    const founder =
      (user.email || "").trim().toLowerCase() ===
        FOUNDER_EMAIL &&
      Boolean(user.email_confirmed_at);

    if (!founder) {
      return res.status(403).json({
        error: "Yalnızca kurucu erişebilir"
      });
    }

    const ids = await redis([
      "SMEMBERS",
      "membership:users"
    ]);

    const users = [];

    for (const id of ids || []) {
      const [email, raw] = await Promise.all([
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

      const isFounder =
        (email || "").trim().toLowerCase() ===
        FOUNDER_EMAIL;

      users.push({
        user_id: id,
        email: email || "",
        role: isFounder
          ? "admin"
          : (record?.role || "user"),
        is_pro: isFounder || proActive(record),
        pro_expires_at: isFounder
          ? null
          : (record?.pro_expires_at || null),
        founder: isFounder
      });
    }

    users.sort(
      (a, b) =>
        Number(b.founder) - Number(a.founder) ||
        a.email.localeCompare(b.email, "tr")
    );

    return res.status(200).json({
      success: true,
      total: users.length,
      users
    });

  } catch (error) {
    console.error("Admin users error:", error);

    return res.status(500).json({
      error:
        "Kullanıcılar yüklenemedi. Vercel loglarını kontrol et."
    });
  }
}
