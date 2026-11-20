
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

    const prompt = String(
      req.body?.prompt ||
      req.body?.question ||
      'Bu dosyayi Turkce analiz et ve ozetle.'
    );

    const text = String(
      req.body?.text ||
      req.body?.content ||
      ''
    );

    const base64 =
      req.body?.base64 ||
      req.body?.fileBase64;

    const mime =
      req.body?.mimeType ||
      req.body?.mime_type ||
      'application/pdf';

    const parts = [
      { text: prompt }
    ];

    if (base64) {
      if (![
        'application/pdf',
        'text/plain',
        'image/png',
        'image/jpeg'
      ].includes(mime)) {
        return send(res, 400, {
          success: false,
          error: 'Bu dosya turu desteklenmiyor'
        });
      }

      if (base64.length > 9_000_000) {
        return send(res, 413, {
          success: false,
          error: 'Dosya cok buyuk'
        });
      }

      parts.push({
        inline_data: {
          mime_type: mime,
          data: String(base64)
            .replace(/^data:[^,]+,/, '')
        }
      });

    } else if (text) {
      parts.push({
        text: text.slice(0, 80000)
      });

    } else {
      return send(res, 400, {
        success: false,
        error: 'Dosya icerigi veya metin gonder'
      });
    }

    const quota = await reserve(user, 'analyze');

    const result = await gemini(parts);

    return send(res, 200, {
      success: true,
      analysis: result.text,
      response: result.text,
      text: result.text,
      quota
    });

  } catch (e) {
    return fail(res, e);
  }
}
