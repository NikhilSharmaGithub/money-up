// Verifying an App Store purchase.
//
// StoreKit 2 hands the app a JWS-signed transaction. The signature chain is
// leaf -> Apple intermediate -> Apple root, so a receipt can be checked
// without ever trusting the client: we walk the x5c chain, confirm each link
// actually signed the next, confirm the root is Apple's own certificate, and
// only then read the payload.
//
// Nothing here mints coins on its own. If the chain cannot be proven — no
// network to fetch Apple's root, a broken signature, the wrong bundle — the
// call fails closed and the caller refuses the purchase.

import crypto from 'node:crypto';

/** Apple publishes its roots here; documented and stable. */
const APPLE_ROOT_URL = 'https://www.apple.com/appleca/AppleIncRootCertificate.cer';
const APPLE_ROOT_G3_URL = 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer';

let rootCache = null;      // Promise<X509Certificate[]> once fetched
let rootCachedAt = 0;
const ROOT_TTL_MS = 24 * 60 * 60 * 1000;

async function appleRoots() {
  if (rootCache && Date.now() - rootCachedAt < ROOT_TTL_MS) return rootCache;
  rootCache = (async () => {
    const certs = [];
    for (const url of [APPLE_ROOT_G3_URL, APPLE_ROOT_URL]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const der = Buffer.from(await res.arrayBuffer());
        certs.push(new crypto.X509Certificate(der));
      } catch {
        // A root we couldn't fetch simply isn't in the trust set this run.
      }
    }
    return certs;
  })();
  rootCachedAt = Date.now();
  const resolved = await rootCache;
  if (!resolved.length) { rootCache = null; rootCachedAt = 0; } // retry next call
  return resolved;
}

const b64url = (s) => Buffer.from(String(s), 'base64url');

/**
 * Verify a StoreKit 2 signed transaction.
 * @returns {Promise<{ok:true, payload:object} | {error:string}>}
 */
export async function verifySignedTransaction(jws, { bundleId } = {}) {
  if (typeof jws !== 'string' || jws.split('.').length !== 3) {
    return { error: 'Malformed receipt' };
  }
  const [headerB64, payloadB64, sigB64] = jws.split('.');

  let header;
  try {
    header = JSON.parse(b64url(headerB64).toString('utf8'));
  } catch {
    return { error: 'Malformed receipt header' };
  }
  if (header.alg !== 'ES256') return { error: 'Unexpected receipt algorithm' };
  const chain = Array.isArray(header.x5c) ? header.x5c : [];
  if (chain.length < 2) return { error: 'Receipt is missing its certificate chain' };

  let certs;
  try {
    certs = chain.map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  } catch {
    return { error: 'Receipt certificate chain is unreadable' };
  }

  // Each certificate must be signed by the next one up.
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].verify(certs[i + 1].publicKey)) return { error: 'Broken certificate chain' };
  }
  const now = new Date();
  for (const cert of certs) {
    if (new Date(cert.validTo) < now || new Date(cert.validFrom) > now) {
      return { error: 'Expired certificate in receipt chain' };
    }
  }

  // …and the top of the chain has to be Apple's own root.
  const roots = await appleRoots();
  if (!roots.length) return { error: 'Could not reach Apple to verify the purchase' };
  const top = certs[certs.length - 1];
  const trusted = roots.some((root) => root.raw.equals(top.raw) || top.verify(root.publicKey));
  if (!trusted) return { error: 'Receipt was not signed by Apple' };

  // ES256 signatures arrive raw (r||s); node wants that spelled out.
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    { key: certs[0].publicKey, dsaEncoding: 'ieee-p1363' },
    b64url(sigB64),
  );
  if (!ok) return { error: 'Receipt signature does not match' };

  let payload;
  try {
    payload = JSON.parse(b64url(payloadB64).toString('utf8'));
  } catch {
    return { error: 'Malformed receipt payload' };
  }
  if (bundleId && payload.bundleId && payload.bundleId !== bundleId) {
    return { error: 'Receipt belongs to a different app' };
  }
  if (payload.revocationDate) return { error: 'Purchase was revoked' };
  return { ok: true, payload };
}
