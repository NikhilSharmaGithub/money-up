// Verifying an App Store purchase.
//
// StoreKit 2 hands the app a JWS-signed transaction. The signature chain is
// leaf -> Apple intermediate -> Apple root, so a receipt can be checked
// without ever trusting the client. "Chains to an Apple root" is not enough on
// its own, though: every Apple developer holds the private key of a
// certificate that chains to one (a free "Apple Development" certificate
// does), and could sign any transaction they liked with it. So the chain has
// to be exactly the App Store's: Apple Root CA - G3, pinned here rather than
// fetched, then an Apple intermediate that is a CA and carries Apple's
// intermediate marker, then a leaf carrying the App Store receipt-signing
// marker, holding the P-256 key that ES256 means. Only then is the payload
// believed. Every certificate is judged as of the transaction's signedDate,
// not today: Apple rotates its signing leaf weeks before the old one lapses,
// and a purchase signed under the old leaf has to redeem after it does. That
// is the check Apple's own App Store Server Library makes with its online
// checks off.
//
// Nothing here mints coins on its own. If any of that cannot be proven the
// call fails closed and the caller refuses the purchase.

import crypto from 'node:crypto';

/**
 * Apple Root CA - G3, the root every StoreKit 2 transaction is signed under.
 * Pinned by its bytes (SHA-256 63:34:3A:BF:…:3E:91:79, as in Apple's own
 * trust store), so verifying a purchase needs no network and trusts no
 * other root — the old Apple Inc. Root signs a great deal that is not the
 * App Store.
 */
const APPLE_ROOT_CA_G3 = new crypto.X509Certificate(`-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`);

/** Apple's marker on the certificate that signs App Store receipts. */
const OID_RECEIPT_SIGNING = '1.2.840.113635.100.6.11.1';
/** Apple's marker on its Worldwide Developer Relations intermediates. */
const OID_APPLE_INTERMEDIATE = '1.2.840.113635.100.6.2.1';

// ------------------------------------------------------- reading a cert --
// Node reads a certificate's subject, key and CA flag but not its extension
// list, and searching the raw bytes for an OID is not good enough: whoever
// requested a certificate chose its public key, and an RSA modulus can be
// made to contain any bytes at all. So the extension list is walked properly.

/** One DER element at `off`: its tag and where its contents start and end. */
function tlv(der, off) {
  const tag = der[off];
  let len = der[off + 1];
  let start = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) throw new Error('unsupported length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[start + i];
    start += n;
  }
  const end = start + len;
  if (tag === undefined || end > der.length) throw new Error('truncated');
  return { tag, start, end };
}

/** The elements directly inside a constructed one. */
function children(der, { start, end }) {
  const out = [];
  for (let off = start; off < end;) {
    const el = tlv(der, off);
    out.push(el);
    off = el.end;
  }
  return out;
}

/** Dotted text of an OBJECT IDENTIFIER's contents. */
function oidText(bytes) {
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let v = 0;
  for (let i = 1; i < bytes.length; i++) {
    v = v * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join('.');
}

/** The OIDs of every extension a certificate carries; empty if it has none. */
export function extensionOids(cert) {
  const der = cert.raw;
  const tbs = children(der, tlv(der, 0))[0];
  // extensions [3] EXPLICIT SEQUENCE OF Extension, the last field of TBSCertificate
  const wrapper = children(der, tbs).find((el) => el.tag === 0xa3);
  if (!wrapper) return [];
  const list = children(der, wrapper)[0];
  return children(der, list).map((ext) => {
    const id = children(der, ext)[0];
    if (id?.tag !== 0x06) throw new Error('extension without an id');
    return oidText(der.subarray(id.start, id.end));
  });
}

const hasOid = (cert, oid) => {
  try { return extensionOids(cert).includes(oid); } catch { return false; }
};

const inDate = (cert, now) => new Date(cert.validFrom) <= now && now <= new Date(cert.validTo);

/**
 * Is this x5c chain the App Store's? `root` is the anchor the intermediate
 * must be signed by — always Apple Root CA - G3 in the server; a test passes
 * a stand-in of its own, because nobody but Apple can sign under the real one.
 * The root a receipt carries in its own chain is never what is trusted.
 * `now` is the moment the chain has to hold at: a receipt's signedDate.
 * @returns {{ok:true} | {error:string}}
 */
export function checkAppleChain(certs, root = APPLE_ROOT_CA_G3, now = new Date()) {
  if (!Array.isArray(certs) || certs.length !== 3) return { error: 'Receipt certificate chain is the wrong length' };
  const [leaf, intermediate] = certs;

  if (!intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) {
    return { error: 'Receipt was not signed by Apple' };
  }
  if (!intermediate.ca || !hasOid(intermediate, OID_APPLE_INTERMEDIATE)) {
    return { error: 'Receipt was not signed by Apple' };
  }
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) {
    return { error: 'Broken certificate chain' };
  }
  // Signed by Apple is not the same as signed by the App Store: this is the
  // line a developer's own Apple-issued certificate fails.
  if (!hasOid(leaf, OID_RECEIPT_SIGNING)) return { error: 'Receipt was not signed by the App Store' };
  // ES256 is a P-256 key. Node will happily check an RSA signature against
  // an RSA key under the same call, so the header's "ES256" proves nothing.
  const key = leaf.publicKey;
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    return { error: 'Unexpected receipt key' };
  }
  if (![leaf, intermediate, root].every((c) => inDate(c, now))) {
    return { error: 'Expired certificate in receipt chain' };
  }
  return { ok: true };
}

const b64url = (s) => Buffer.from(String(s), 'base64url');

/**
 * Verify a StoreKit 2 signed transaction. `root` and `now` (the server's
 * clock) are for tests, as in checkAppleChain; the server passes neither.
 * @returns {Promise<{ok:true, payload:object} | {error:string}>}
 */
export async function verifySignedTransaction(jws, { bundleId, root = APPLE_ROOT_CA_G3, now = new Date() } = {}) {
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
    certs = chain.map((c) => new crypto.X509Certificate(Buffer.from(String(c), 'base64')));
  } catch {
    return { error: 'Receipt certificate chain is unreadable' };
  }

  // ES256 signatures arrive raw (r||s); node wants that spelled out.
  let ok = false;
  try {
    ok = crypto.verify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: certs[0].publicKey, dsaEncoding: 'ieee-p1363' },
      b64url(sigB64),
    );
  } catch { ok = false; }
  if (!ok) return { error: 'Receipt signature does not match' };

  let payload;
  try {
    payload = JSON.parse(b64url(payloadB64).toString('utf8'));
  } catch {
    return { error: 'Malformed receipt payload' };
  }
  // The chain has to hold at the moment Apple signed: the signedDate under
  // the signature just checked. One ahead of the server's clock is not
  // believed, since it would let a leaf count before it was valid.
  const signedAt = new Date(Number(payload?.signedDate));
  if (Number.isNaN(signedAt.getTime()) || signedAt - now > 5 * 60 * 1000) {
    return { error: 'Receipt has no believable signing date' };
  }
  const trusted = checkAppleChain(certs, root, signedAt);
  if (trusted.error) return trusted;

  // A transaction that does not say which app it is for is not one of ours.
  if (bundleId && payload?.bundleId !== bundleId) {
    return { error: 'Receipt belongs to a different app' };
  }
  if (payload.revocationDate) return { error: 'Purchase was revoked' };
  return { ok: true, payload };
}
