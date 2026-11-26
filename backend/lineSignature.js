import crypto from 'crypto';

// LINE signs every webhook request: x-line-signature is the base64 HMAC-SHA256
// of the exact request bytes, keyed with the channel secret.  Shared by the
// Express server and the Vercel function so both accept the same requests.

export function isValidLineSignature(rawBody, signature, channelSecret) {
    if (!rawBody || !signature || !channelSecret) return false;
    const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest();
    const received = Buffer.from(String(signature), 'base64');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

/**
 * Decides whether a webhook request may be processed.  Without a configured
 * secret nothing can be verified, so every request is refused.
 */
export function checkLineSignature(rawBody, signature, channelSecret = process.env.LINE_CHANNEL_SECRET) {
    if (!channelSecret) {
        return { ok: false, status: 503, message: 'LINE_CHANNEL_SECRET is not configured' };
    }
    if (!isValidLineSignature(rawBody, signature, channelSecret)) {
        return { ok: false, status: 401, message: 'Invalid LINE signature' };
    }
    return { ok: true };
}

/** express.json({ verify }) hook: keeps the bytes the signature was made from. */
export function captureRawBody(req, res, buffer) {
    req.rawBody = buffer;
}
