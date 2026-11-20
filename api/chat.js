
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

    const message = String(
      req.body?.message ||
      req.body?.prompt ||
      ''
    ).trim();

    if (!message || message.length > 12000) {
      return send(res, 400, {
        success: false,
        error: 'Mesaj 1-12000 karakter olmali'
      });
    }

    const quota = await reserve(user, 'chat');

    const result = await gemini([
      {
        text:
          `Turkce yanit ver. Kullanici mesaji:\n${message}`
      }
    ]);

    return send(res, 200, {
      success: true,
      reply: result.text,
      response: result.text,
      text: result.text,
      quota
    });

  } catch (e) {
    return fail(res, e);
  }
}
