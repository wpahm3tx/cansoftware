
const SUPABASE_URL = 'https://xllmhgabuzaledxqqufe.supabase.co';
const FOUNDER = 'ahmetbinarbasi64@gmail.com';

const limits = {
  chat: [10, 200],
  analyze: [2, 30],
  search: [3, 50]
};

export function send(res, status, data) {
  return res.status(status).json(data);
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw Error('Redis ayarlari eksik');
  }

  const r = await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  if (!r.ok) {
    throw Error('Redis istegi basarisiz');
  }

  const d = await r.json();

  if (d.error) {
    throw Error('Redis: ' + d.error);
  }

  return d.result;
}

export async function authenticate(req) {
  const token = (req.headers.authorization || '')
    .match(/^Bearer (.+)$/i)?.[1];

  if (!token) {
    throw Object.assign(
      Error('Oturum acman gerekiyor'),
      { status: 401 }
    );
  }

  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey:
          process.env.SUPABASE_ANON_KEY ||
          'sb_publishable_7BnfXFJWwC77ddC8jTXhfA_gvoMYDrL'
      }
    }
  );

  if (!r.ok) {
    throw Object.assign(
      Error('Oturum gecersiz'),
      { status: 401 }
    );
  }

  const user = await r.json();

  if (!user.id || !user.email) {
    throw Object.assign(
      Error('Kullanici bulunamadi'),
      { status: 401 }
    );
  }

  return user;
}

export async function membership(user) {
  const founder =
    user.email?.toLowerCase() === FOUNDER &&
    !!user.email_confirmed_at;

  if (founder) {
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
  } catch {}

  const expires = record.pro_expires_at;

  return {
    founder: false,
    pro:
      record.is_pro === true &&
      (!expires || new Date(expires).getTime() > Date.now())
  };
}

export async function reserve(user, feature) {
  const m = await membership(user);

  if (m.founder) {
    return {
      founder: true,
      pro: true,
      limit: null
    };
  }

  const max = limits[feature]?.[m.pro ? 1 : 0];

  if (!max) {
    throw Error('Gecersiz ozellik');
  }

  const day = new Date().toISOString().slice(0, 10);

  const key = `quota:${day}:${feature}:${user.id}`;

  const count = Number(
    await redis(['INCR', key])
  );

  if (count === 1) {
    await redis(['EXPIRE', key, 172800]);
  }

  if (count > max) {
    throw Object.assign(
      Error(
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
    pro: m.pro,
    limit: max,
    used: count
  };
}

export async function gemini(
  parts,
  {
    model = 'gemini-2.5-flash',
    search = false
  } = {}
) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw Object.assign(
      Error('GEMINI_API_KEY eksik'),
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

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify(body)
    }
  );

  const data = await r.json();

  if (!r.ok) {
    throw Object.assign(
      Error(data.error?.message || 'Gemini API hatasi'),
      {
        status: r.status === 429 ? 429 : 502
      }
    );
  }

  return {
    text:
      (data.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n'),

    sources:
      (
        data.candidates?.[0]
          ?.groundingMetadata
          ?.groundingChunks || []
      )
        .filter(x => x.web)
        .map(x => ({
          title: x.web.title,
          url: x.web.uri
        }))
  };
}

export function fail(res, e) {
  console.error('API:', e.message);

  return send(res, e.status || 500, {
    success: false,
    error: e.message || 'Sunucu hatasi'
  });
}

export function onlyPost(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    send(res, 405, {
      success: false,
      error: 'Yalnizca POST'
    });

    return false;
  }

  return true;
}
