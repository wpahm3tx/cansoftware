
import {
  authenticate,
  reserve,
  gemini,
  send,
  fail,
  onlyPost
} from './_lib.js';

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;

  try {
    const user = await authenticate(req);

    const query = String(
      req.body?.query ||
      req.body?.prompt ||
      req.body?.message ||
      ''
    ).trim();

    if (!query || query.length > 3000) {
      return send(res, 400, {
        success: false,
        error: 'Arama sorgusu gecersiz'
      });
    }

    const quota = await reserve(user, 'search');

    const result = await gemini(
      [
        {
          text:
            `Su konuyu internette arastir, kaynakli ve Turkce cevapla: ${query}`
        }
      ],
      {
        search: true
      }
    );

    return send(res, 200, {
      success: true,
      answer: result.text,
      response: result.text,
      text: result.text,
      sources: result.sources,
      quota
    });

  } catch (e) {
    return fail(res, e);
  }
}
