
const SUPABASE_URL =
  "https://xllmhgabuzaledxqqufe.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_7BnfXFJWwC77ddC8jTXhfA_gvoMYDrL";

const FOUNDER_EMAIL =
  "ahmetbinarbasi64@gmail.com";

const LIMITS = {
  chat: [10, 200],
  analyze: [2, 30],
  search: [3, 50],
  generate: [2, 50],
  edit: [2, 50]
};

const AI_MODEL = "gemini-3.8-flash";
const MAX_ATTEMPTS = 3;

export function send(res, status, data) {
  return res.status(status).json(data);
}

export function onlyPost(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    send(res, 405, {
      success: false,
      error: "Yalnizca POST istekleri destekleniyor."
    });

    return false;
  }

  return true;
}

// Redis baglantisi
async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw Object.assign(
      new Error("Veritabani ayarlari eksik."),
      { status: 503 }
    );
  }

  const response = await fetch(
    url.replace(/\/$/, ""),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    }
  );

  if (!response.ok) {
    throw new Error(
      "Veritabani baglantisi basarisiz."
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      "Veritabani islemi basarisiz."
    );
  }

  return data.result;
}

// Kullanici oturumunu dogrula
export async function authenticate(req) {
  const authorization =
    req.headers.authorization || "";

  const token = authorization.match(
    /^Bearer\s+(.+)$/i
  )?.[1]?.trim();

  if (!token) {
    throw Object.assign(
      new Error("Lutfen hesabina giris yap."),
      { status: 401 }
    );
  }

  let response;

  try {
    response = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );
  } catch {
    throw Object.assign(
      new Error(
        "Oturum servisine baglanilamadi."
      ),
      { status: 502 }
    );
  }

  if (!response.ok) {
    console.error(
      "Auth verification failed:",
      response.status
    );

    throw Object.assign(
      new Error(
        "Oturum dogrulanamadi. Tekrar giris yap."
      ),
      { status: 401 }
    );
  }

  const user = await response.json();

  if (!user?.id || !user?.email) {
    throw Object.assign(
      new Error("Kullanici bilgileri alinamadi."),
      { status: 401 }
    );
  }

  return user;
}

// Kurucu ve PRO uyelik kontrolu
export async function membership(user) {
  const founder =
    user.email?.trim().toLowerCase() ===
      FOUNDER_EMAIL &&
    Boolean(user.email_confirmed_at);

  if (founder) {
    return {
      founder: true,
      pro: true
    };
  }

  const raw = await redis([
    "GET",
    `membership:${user.id}`
  ]);

  let record = {};

  try {
    record = raw ? JSON.parse(raw) : {};
  } catch {
    record = {};
  }

  const expiry = record.pro_expires_at;

  return {
    founder: false,
    pro:
      record.is_pro === true &&
      (
        !expiry ||
        (
          Number.isFinite(Date.parse(expiry)) &&
          Date.parse(expiry) > Date.now()
        )
      )
  };
}

// Gunluk kullanim limitleri
export async function reserve(user, feature) {
  const member = await membership(user);

  if (member.founder) {
    return {
      founder: true,
      pro: true,
      limit: null,
      used: 0
    };
  }

  const limits = LIMITS[feature];

  if (!limits) {
    throw Object.assign(
      new Error("Gecersiz islem."),
      { status: 400 }
    );
  }

  const max = limits[member.pro ? 1 : 0];

  const day = new Date()
    .toISOString()
    .slice(0, 10);

  const key =
    `quota:${day}:${feature}:${user.id}`;

  const count = Number(
    await redis(["INCR", key])
  );

  if (count === 1) {
    await redis([
      "EXPIRE",
      key,
      172800
    ]);
  }

  if (count > max) {
    throw Object.assign(
      new Error(
        `Gunluk kullanim limitine ulastin (${max}).`
      ),
      { status: 429 }
    );
  }

  return {
    founder: false,
    pro: member.pro,
    limit: max,
    used: count
  };
}

// Bekleme fonksiyonu
function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

// Yapay zeka motoru
export async function gemini(
  parts,
  {
    model = AI_MODEL,
    search = false
  } = {}
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw Object.assign(
      new Error(
        "Yapay zeka servisi yapilandirilmamis."
      ),
      { status: 503 }
    );
  }

  const body = {
    contents: [
      {
        role: "user",
        parts
      }
    ],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048
    }
  };

  if (search) {
    body.tools = [
      {
        google_search: {}
      }
    ];
  }

  const url =
    "https://generativelanguage.googleapis.com" +
    `/v1beta/models/${model}:generateContent`;

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
      });

      const data = await response.json();

      if (response.ok) {
        const candidate = data.candidates?.[0];

        const text = (
          candidate?.content?.parts || []
        )
          .map(part => part.text || "")
          .join("\n");

        const sources = (
          candidate?.groundingMetadata
            ?.groundingChunks || []
        )
          .filter(item => item.web)
          .map(item => ({
            title: item.web.title,
            url: item.web.uri
          }));

        return {
          text,
          sources
        };
      }

      const message =
        data.error?.message ||
        `AI HTTP ${response.status}`;

      const retryable = [
        429,
        500,
        502,
        503,
        504
      ].includes(response.status);

      if (!retryable) {
        throw Object.assign(
          new Error(
            "Yapay zeka istegi islenemedi."
          ),
          { status: 502 }
        );
      }

      lastError = new Error(message);

      console.warn(
        `AI deneme ${attempt}/${MAX_ATTEMPTS}:`,
        response.status
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(
          1000 * Math.pow(2, attempt - 1)
        );
      }

    } catch (error) {
      if (error.status) {
        throw error;
      }

      lastError = error;

      console.warn(
        `AI baglanti denemesi ${attempt}/${MAX_ATTEMPTS}:`,
        error.message
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(
          1000 * Math.pow(2, attempt - 1)
        );
      }
    }
  }

  console.error(
    "AI service unavailable:",
    lastError?.message
  );

  throw Object.assign(
    new Error(
      "CAN SOFTWARE AI PRO su anda yogun. " +
      "Lutfen biraz sonra tekrar dene."
    ),
    { status: 503 }
  );
}

// Ortak hata yonetimi
export function fail(res, error) {
  console.error(
    "API error:",
    error.message
  );

  return send(
    res,
    error.status || 500,
    {
      success: false,
      error:
        error.message ||
        "CAN SOFTWARE AI PRO islem sirasinda hata olustu."
    }
  );
}
