
const SUPABASE_URL =
  "https://xllmhgabuzaledxqqufe.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_7BnfXFJWwC77ddC8jTXhfA_gvoMYDrL";

const FOUNDER_EMAIL = "ahmetbinarbasi64@gmail.com";

async function redis(command) {
  const response = await fetch(
    process.env.UPSTASH_REDIS_REST_URL,
    {
      method: "POST",
      headers: {
        Authorization:
          "Bearer " + process.env.UPSTASH_REDIS_REST_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    }
  );

  if (!response.ok) {
    throw new Error("Üyelik veritabanına bağlanılamadı");
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function getUser(req) {
  const token = (
    req.headers.authorization || ""
  ).replace(/^Bearer\s+/i, "");

  if (!token) throw new Error("Giriş gerekli");

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
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({error:"Geçersiz işlem"});
  }

  try {
    const user = await getUser(req);
    const email = (user.email || "").toLowerCase();
    const founder =
      email === FOUNDER_EMAIL &&
      Boolean(user.email_confirmed_at);

    if (req.method === "GET") {
      const saved = await redis(["GET", "membership:" + user.id]);
      const record = saved ? JSON.parse(saved) : null;

      const active = record?.is_pro &&
        (!record.pro_expires_at ||
          new Date(record.pro_expires_at) > new Date());

      await redis(["SADD", "membership:users", user.id]);

      return res.status(200).json({
        user_id: user.id,
        email: user.email,
        role: founder ? "admin" : (record?.role || "user"),
        is_pro: founder ? true : Boolean(active),
        pro_expires_at: founder ? null : (record?.pro_expires_at || null),
        founder
      });
    }

    if (!founder) {
      return res.status(403).json({
        error: "Yalnızca kurucu yetki verebilir"
      });
    }

    const {
      target_user_id,
      new_role,
      new_is_pro,
      new_expires_at
    } = req.body || {};

    if (
      typeof target_user_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(target_user_id) ||
      !["user","moderator","admin"].includes(new_role) ||
      typeof new_is_pro !== "boolean" ||
      (new_expires_at != null &&
        (typeof new_expires_at !== "string" ||
         !Number.isFinite(Date.parse(new_expires_at))))
    ) {
      return res.status(400).json({error:"Geçersiz üyelik bilgileri"});
    }

    if (target_user_id === user.id) {
      return res.status(403).json({
        error:"Kurucu yetkisi değiştirilemez"
      });
    }

    await redis([
      "SET",
      "membership:" + target_user_id,
      JSON.stringify({
        role:new_role,
        is_pro:new_is_pro,
        pro_expires_at:new_is_pro ? (new_expires_at || null) : null
      })
    ]);

    return res.status(200).json({success:true});
  } catch (error) {
    return res.status(500).json({
      error:error.message
    });
  }
}
