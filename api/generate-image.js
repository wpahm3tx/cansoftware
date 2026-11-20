
import {
  authenticate,
  membership,
  send,
  fail,
  onlyPost
} from './_lib.js';

const MODEL = 'gemini-2.5-flash-image';

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('Upstash Redis ayarlari eksik.');
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
    throw new Error('Redis baglanti hatasi.');
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}

async function checkQuota(user) {
  const member = await membership(user);

  if (member.founder) {
    return {
      pro: true,
      founder: true,
      limit: null
    };
  }

  const limit = member.pro ? 50 : 2;
  const date = new Date().toISOString().slice(0, 10);
  const key = `quota:${date}:generate:${user.id}`;

  const used = Number(await redis(['INCR', key]));

  if (used === 1) {
    await redis(['EXPIRE', key, 172800]);
  }

  if (used > limit) {
    throw Object.assign(
      new Error(
        `Gunluk gorsel limitin doldu (${limit}).`
      ),
      { status: 429 }
    );
  }

  return {
    pro: member.pro,
    founder: false,
    limit,
    used
  };
}

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const user = await authenticate(req);

    const prompt = String(
      req.body?.prompt ||
      req.body?.message ||
      ''
    ).trim();

    if (!prompt || prompt.length > 5000) {
      return send(res, 400, {
        success: false,
        error: 'Gorsel aciklamasi 1-5000 karakter olmali.'
      });
    }

    const key = process.env.GEMINI_API_KEY;

    if (!key) {
      return send(res, 503, {
        success: false,
        error: 'GEMINI_API_KEY bulunamadi.'
      });
    }

    const quota = await checkQuota(user);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE']
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data.error?.message ||
        'Gemini gorsel olusturma hatasi.';

      return send(
        res,
        response.status === 429 ? 429 : 502,
        {
          success: false,
          error: message
        }
      );
    }

    const parts =
      data.candidates?.[0]?.content?.parts || [];

    const imagePart = parts.find(
      part => part.inlineData?.data
    );

    if (!imagePart) {
      const explanation = parts
        .map(part => part.text || '')
        .join('\n');

      return send(res, 502, {
        success: false,
        error:
          explanation ||
          'Gemini bu istekte gorsel dondurmedi.'
      });
    }

    const mime =
      imagePart.inlineData.mimeType ||
      'image/png';

    const image =
      `data:${mime};base64,${imagePart.inlineData.data}`;

    return send(res, 200, {
      success: true,
      image,
      imageUrl: image,
      text: 'Gorsel basariyla olusturuldu.',
      quota
    });

  } catch (error) {
    return fail(res, error);
  }
}
