
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://xllmhgabuzaledxqqufe.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_7BnfXFJWwC77ddC8jTXhfA_gvoMYDrL";

function supabaseHeaders(token) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function supabaseRequest(path, token, options = {}) {
  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,
      headers: {
        ...supabaseHeaders(token),
        ...(options.headers || {})
      }
    }
  );

  const body = await response.text();
  let data;

  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Supabase hatası: ${response.status}`
    );
  }

  return data;
}

async function authenticate(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer (.+)$/i);

  if (!match) {
    const error = new Error("Önce giriş yapmalısın.");
    error.status = 401;
    throw error;
  }

  const token = match[1];

  const user = await supabaseRequest(
    "/auth/v1/user",
    token
  );

  if (!user?.id) {
    const error = new Error("Geçersiz oturum.");
    error.status = 401;
    throw error;
  }

  return { token, user };
}

async function getProfile(token, userId) {
  const profiles = await supabaseRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,plan,pro_expires_at`,
    token
  );

  return profiles?.[0] || null;
}

function requireAdmin(profile) {
  if (profile?.role !== "admin") {
    const error = new Error("Yönetici yetkisi gerekli.");
    error.status = 403;
    throw error;
  }
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "Desteklenmeyen istek yöntemi."
    });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const { token, user } = await authenticate(req);
    const profile = await getProfile(token, user.id);

    if (!profile) {
      return res.status(404).json({
        error: "Kullanıcı profili bulunamadı."
      });
    }

    const action =
      req.method === "GET"
        ? req.query?.action || "status"
        : req.body?.action;

    // Kullanıcının üyelik durumu
    if (action === "status" && req.method === "GET") {
      const expiresAt = profile.pro_expires_at;

      const isPro =
        profile.plan === "pro" &&
        Boolean(expiresAt) &&
        new Date(expiresAt).getTime() > Date.now();

      const requests = await supabaseRequest(
        "/rest/v1/payment_requests" +
        "?select=id,amount,currency,status,created_at" +
        "&order=created_at.desc&limit=10",
        token
      );

      return res.status(200).json({
        userId: user.id,
        role: profile.role,
        plan: isPro ? "pro" : "free",
        proExpiresAt: expiresAt,
        price: 150,
        currency: "TRY",
        requests
      });
    }

    // PRO başvurusu oluştur
    if (action === "apply" && req.method === "POST") {
      const note = req.body?.paymentNote;

      if (
        typeof note !== "string" ||
        note.trim().length < 5 ||
        note.length > 1000
      ) {
        return res.status(400).json({
          error: "5-1000 karakterlik ödeme açıklaması gerekli."
        });
      }

      const existing = await supabaseRequest(
        "/rest/v1/payment_requests" +
        "?select=id&status=eq.pending&limit=1",
        token
      );

      if (existing.length > 0) {
        return res.status(409).json({
          error: "Zaten bekleyen bir PRO başvurun var."
        });
      }

      const result = await supabaseRequest(
        "/rest/v1/payment_requests",
        token,
        {
          method: "POST",
          headers: {
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            user_id: user.id,
            amount: 150,
            currency: "TRY",
            status: "pending",
            payment_note: note.trim()
          })
        }
      );

      return res.status(201).json({
        success: true,
        message:
          "PRO başvurun alındı. Yönetici incelemesi bekleniyor.",
        request: result?.[0]
      });
    }

    // Yönetici: Başvuruları listele
    if (action === "list" && req.method === "GET") {
      requireAdmin(profile);

      const status = req.query?.status || "pending";

      if (
        !["pending", "approved", "rejected", "all"]
          .includes(status)
      ) {
        return res.status(400).json({
          error: "Geçersiz durum."
        });
      }

      const filter =
        status === "all"
          ? ""
          : `&status=eq.${status}`;

      const requests = await supabaseRequest(
        "/rest/v1/payment_requests" +
        "?select=id,user_id,amount,currency,status," +
        "payment_note,admin_note,created_at,reviewed_at" +
        filter +
        "&order=created_at.desc&limit=100",
        token
      );

      return res.status(200).json({ requests });
    }

    // Yönetici: Başvuruyu onayla / reddet
    if (action === "review" && req.method === "POST") {
      requireAdmin(profile);

      const { requestId, approve, adminNote } = req.body;

      if (
        typeof requestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          .test(requestId) ||
        typeof approve !== "boolean"
      ) {
        return res.status(400).json({
          error: "Geçersiz başvuru veya karar."
        });
      }

      if (
        adminNote !== undefined &&
        (typeof adminNote !== "string" ||
          adminNote.length > 1000)
      ) {
        return res.status(400).json({
          error: "Yönetici notu çok uzun."
        });
      }

      await supabaseRequest(
        "/rest/v1/rpc/review_pro_payment",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            p_request_id: requestId,
            p_approve: approve,
            p_admin_note: adminNote || null
          })
        }
      );

      return res.status(200).json({
        success: true,
        message: approve
          ? "PRO üyelik onaylandı."
          : "PRO başvurusu reddedildi."
      });
    }

    return res.status(400).json({
      error: "Geçersiz işlem."
    });

  } catch (error) {
    console.error("CAN PRO:", error.message);

    return res.status(error.status || 500).json({
      error:
        error.status === 401 || error.status === 403
          ? error.message
          : "İşlem gerçekleştirilemedi."
    });
  }
}
