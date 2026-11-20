
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
    throw new Error("Upstash ortam değişkenleri eksik.");
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
    const error = new Error(
      "Oturum geçersiz. Tekrar Google ile giriş yap."
    );
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

function isValidUUID(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
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

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      error: "Desteklenmeyen işlem."
    });
  }

  try {
    const user = await authenticate(req);
    const founder = isFounder(user);

    if (req.method === "GET") {
      // Kullanıcıyı yönetici listesine kaydet.
      await redis([
        "SADD",
        "membership:users",
        user.id
      ]);

      // Kullanıcının e-posta adresini sakla.
      await redis([
        "HSET",
        `membership:profile:${user.id}`,
        "email",
        user.email || ""
      ]);

      const raw = await redis([
        "GET",
        `membership:${user.id}`
      ]);

      let record = null;

      if (raw) {
        try {
          record = JSON.parse(raw);
        } catch {
          record = null;
        }
      }

      const pro = founder || activePro(record);

      return res.status(200).json({
        user_id: user.id,
        email: user.email || "",
        role: founder
          ? "admin"
          : record?.role || "user",
        is_pro: pro,
        pro_expires_at: founder
          ? null
          : record?.pro_expires_at || null,
        founder
      });
    }

    // POST: Yalnızca kurucu üyelik değiştirebilir.
    if (!founder) {
      return res.status(403).json({
        error: "Bu işlem için kurucu yetkisi gerekiyor."
      });
    }

    const {
      target_user_id,
      new_role,
      new_is_pro,
      new_expires_at
    } = req.body || {};

    if (!isValidUUID(target_user_id)) {
      return res.status(400).json({
        error: "Geçersiz kullanıcı UID."
      });
    }

    if (!["user", "moderator", "admin"].includes(new_role)) {
      return res.status(400).json({
        error: "Geçersiz kullanıcı rolü."
      });
    }

    if (typeof new_is_pro !== "boolean") {
      return res.status(400).json({
        error: "PRO değeri true veya false olmalı."
      });
    }

    if (
      new_expires_at !== null &&
      new_expires_at !== undefined &&
      (
        typeof new_expires_at !== "string" ||
        !Number.isFinite(Date.parse(new_expires_at))
      )
    ) {
      return res.status(400).json({
        error: "Geçersiz PRO bitiş tarihi."
      });
    }

    if (target_user_id === user.id) {
      return res.status(403).json({
        error: "Kurucu hesabının yetkileri değiştirilemez."
      });
    }

    // Sadece daha önce sisteme giriş yapmış
    // ve kayıt edilmiş kullanıcılar değiştirilebilir.
    const registered = await redis([
      "SISMEMBER",
      "membership:users",
      target_user_id
    ]);

    if (Number(registered) !== 1) {
      return res.status(404).json({
        error: "Kullanıcı kayıtlı değil. Önce giriş yapmalı."
      });
    }

    const profileEmail = await redis([
      "HGET",
      `membership:profile:${target_user_id}`,
      "email"
    ]);

    // Kurucunun ikinci bir hesabına yetki verilmesini
    // veya kurucu kaydının değiştirilmesini engelle.
    if (
      (profileEmail || "").trim().toLowerCase() ===
      FOUNDER_EMAIL
    ) {
      return res.status(403).json({
        error: "Kurucu hesabının yetkileri değiştirilemez."
      });
    }

    const record = {
      role: new_role,
      is_pro: new_is_pro,
      pro_expires_at: new_is_pro
        ? new_expires_at || null
        : null,
      updated_at: new Date().toISOString(),
      updated_by: user.id
    };

    await redis([
      "SET",
      `membership:${target_user_id}`,
      JSON.stringify(record)
    ]);

    return res.status(200).json({
      success: true,
      message: "Üyelik başarıyla güncellendi.",
      user_id: target_user_id,
      ...record
    });

  } catch (error) {
    console.error("Membership API:", error);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : "Üyelik işlemi başarısız. Vercel loglarını kontrol et."
    });
  }
}
