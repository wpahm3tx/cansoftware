
const SUPABASE_URL =
  'https://xllmhgabuzaledxqqufe.supabase.co';

const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_7BnfXFJWwC77ddC8jTXhfA_gvoMYDrL';

const FOUNDER_EMAIL =
  'ahmetbinarbasi64@gmail.com';

const LIMITS = {
  chat: [10, 200],
  analyze: [2, 30],
  search: [3, 50],
  generate: [2, 50],
  edit: [2, 50]
};

// JSON yaniti
export function send(res, status, data) {
  return res.status(status).json(data);
}

// Sadece POST istekleri
export function onlyPost(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    send(res, 405, {
      success: false,
      error: 'Yalnizca POST istekleri destekleniyor.'
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
      new Error('Redis ayarlari eksik.'),
      { status: 503 }
    );
  }

  const response = await fetch(
    url.replace(/\/$/, ''),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Redis baglanti hatasi: ${response.status}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `Redis hatasi: ${data.error}`
    );
  }

  return data.result;
}

// Google / Supabase oturum kontrolu
export async function authenticate(req) {
  const authorization =
    req.headers.authorization || '';

  const match = authorization.match(
    /^Bearer\s+(.+)$/i
  );

  const accessToken = match?.[1]?.trim();

  if (!accessToken) {
    throw Object.assign(
      new Error('Oturum acman gerekiyor.'),
      { status: 401 }
    );
  }

  let response;

  try {
    response = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_KEY,
          Accept: 'application/json'
        },
        cache: 'no-store'
      }
    );
  } catch (error) {
    console.error(
      'Supabase baglanti hatasi:',
      error.message
    );

    throw Object.assign(
      new Error(
        'Supabase sunucusuna baglanilamadi.'
      ),
      { status: 502 }
    );
  }

  if (!response.ok) {
    const details = await response.text();

    console.error('Supabase auth failure:', {
      status: response.status,
      details: details.slice(0, 500)
    });

    throw Object.assign(
      new Error(
        'Oturum dogrulanamadi. Yeniden giris yap.'
      ),
      { status: 401 }
    );
  }

  const user = await response.json();

  if (!user?.id || !user?.email) {
    throw Object.assign(
      new Error(
        'Supabase kullanici bilgilerini dondurmedi.'
      ),
      { status: 401 }
    );
  }

  return user;
}

// PRO uyelik ve kurucu kontrolu
export async function membership(user) {
  const isFounder =
    user.email?.toLowerCase() === FOUNDER_EMAIL &&
    !!user.email_confirmed_at;

  if (isFounder) {
    return {
      founder: true,
      pro: true
    };
  }

  const raw = await redis([
    'GET',
    `membership:${user.id}`
  ]);

  let record = {};

  try {
    record = raw ? JSON.parse(raw) : {};
  } catch {
    record = {};
  }

  const expiresAt = record.pro_expires_at;

  const isActive =
    record.is_pro === true &&
    (
      !expiresAt ||
      new Date(expiresAt).getTime() > Date.now()
    );

  return {
    founder: false,
    pro: isActive
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
      new Error('Gecersiz ozellik.'),
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
    await redis(['INCR', key])
  );

  if (count === 1) {
    await redis([
      'EXPIRE',
      key,
      172800
    ]);
  }

  if (count > max) {
    throw Object.assign(
      new Error(
        `Gunluk ${feature} limitine ulastin (${max}).`
      ),
      {
        status: 429,
        limit: max
      }
    );
  }

  return {
    founder: false,
    pro: member.pro,
    limit: max,
    used: count
  };
}

// Gemini API
export async function gemini(
  parts,
  {
    model = 'gemini-3.8-flash',
    search = false
  } = {}
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw Object.assign(
      new Error('GEMINI_API_KEY eksik.'),
      { status: 503 }
    );
  }

  const body = {
    contents: [
      {
        role: 'user',
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('Gemini API failure:', {
      status: response.status,
      message: data.error?.message
    });

    throw Object.assign(
      new Error(
        data.error?.message ||
        'Gemini API hatasi.'
      ),
      {
        status:
          response.status === 429 ? 429 : 502
      }
    );
  }

  const candidate =
    data.candidates?.[0];

  const text = (
    candidate?.content?.parts || []
  )
    .map(part => part.text || '')
    .join('\n');

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

// Ortak hata yonetimi
export function fail(res, error) {
  console.error('API Error:', {
    message: error.message,
    status: error.status || 500
  });

  return send(
    res,
    error.status || 500,
    {
      success: false,
      error:
        error.message ||
        'Beklenmeyen sunucu hatasi.'
    }
  );
}
