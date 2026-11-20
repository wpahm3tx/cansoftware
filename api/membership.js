
import { authenticate } from "./_lib.js";

const FOUNDER_EMAIL =
  "ahmetbinarbasi64@gmail.com";

// Redis baglantisi
async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Upstash ortam degiskenleri eksik.");
  }

  const response = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error(
      `Upstash baglanti hatasi: ${response.status}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error("Redis hatasi: " + data.error);
  }

  return data.result;
}

// Kurucu hesabi kontrolu
function isFounder(user) {
  return (
    (user.email || "").trim().toLowerCase() ===
      FOUNDER_EMAIL &&
    Boolean(user.email_confirmed_at)
  );
}

// Kullanici UID kontrolu
function isValidUUID(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

// PRO suresi kontrolu
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

// Ana API
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      success: false,
      error: "Desteklenmeyen islem."
    });
  }

  try {
    // Ortak Supabase oturum dogrulamasi
    const user = await authenticate(req);

    const founder = isFounder(user);

    // GET: Uyelik bilgilerini getir
    if (req.method === "GET") {
      await redis([
        "SADD",
        "membership:users",
        user.id
      ]);

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
        success: true,
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

    // POST: Sadece kurucu uye duzenleyebilir
    if (!founder) {
      return res.status(403).json({
        success: false,
        error: "Bu islem icin kurucu yetkisi gerekiyor."
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
        success: false,
        error: "Gecersiz kullanici UID."
      });
    }

    if (!["user", "moderator", "admin"].includes(new_role)) {
      return res.status(400).json({
        success: false,
        error: "Gecersiz kullanici rolu."
      });
    }

    if (typeof new_is_pro !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "PRO degeri true veya false olmali."
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
        success: false,
        error: "Gecersiz PRO bitis tarihi."
      });
    }

    if (target_user_id === user.id) {
      return res.status(403).json({
        success: false,
        error: "Kurucu hesabinin yetkileri degistirilemez."
      });
    }

    // Kayitli kullanici kontrolu
    const registered = await redis([
      "SISMEMBER",
      "membership:users",
      target_user_id
    ]);

    if (Number(registered) !== 1) {
      return res.status(404).json({
        success: false,
        error: "Kullanici kayitli degil. Once giris yapmali."
      });
    }

    // Hedef kullanicinin e-postasi
    const profileEmail = await redis([
      "HGET",
      `membership:profile:${target_user_id}`,
      "email"
    ]);

    if (
      (profileEmail || "").trim().toLowerCase() ===
      FOUNDER_EMAIL
    ) {
      return res.status(403).json({
        success: false,
        error: "Kurucu hesabinin yetkileri degistirilemez."
      });
    }

    // Uyelik kaydini olustur
    const record = {
      role: new_role,
      is_pro: new_is_pro,
      pro_expires_at: new_is_pro
        ? new_expires_at || null
        : null,
      updated_at: new Date().toISOString(),
      updated_by: user.id
    };

    // Redis'e kaydet
    await redis([
      "SET",
      `membership:${target_user_id}`,
      JSON.stringify(record)
    ]);

    return res.status(200).json({
      success: true,
      message: "Uyelik basariyla guncellendi.",
      user_id: target_user_id,
      ...record
    });

  } catch (error) {
    console.error("Membership API:", error);

    return res.status(error.status || 500).json({
      success: false,
      error: error.status
        ? error.message
        : "Uyelik islemi basarisiz. Vercel loglarini kontrol et."
    });
  }
}
