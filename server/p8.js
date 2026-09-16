// Apple's .p8 keys, read the way operators actually hand them over.
//
// Two features sign things with a key Apple issued as a .p8 file: push
// notifications (APNs) and Sign in with Apple. Both keys are the same kind of
// thing — a P-256 private key in a PKCS#8 PEM — and both reach this server the
// same three ways: pasted into an environment variable, a path in one, or a
// Render secret file mounted at /etc/secrets/AuthKey_<key id>.p8, which is the
// name Apple gives the download. So they are read here, once, the same way.
//
// The part worth a file of its own is what a paste does to a key. The file
// Apple hands over parses as it is; the text that comes out of a dashboard's
// text box often does not — spaces in front of every line, a byte-order mark,
// Windows line endings, everything run into one line, dashes a text editor
// "smartened", the \n escapes of an environment variable left as typed. None
// of that changes the key: it is the same base64 between the same two marker
// lines. Render's secret file did exactly this to the Sign in with Apple key
// on 16 September 2026, and OpenSSL's only comment was "DECODER routines::
// unsupported". So when the text will not parse as given, the base64 is lifted
// out and read as the PKCS#8 bytes Apple issued, and a key that still will not
// read is described in the log by counts only — never by any part of itself.

import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * The key a feature signs with, or null (with one warning saying why).
 *
 * `value` is the environment variable's content: a pasted key (anything that
 * mentions PRIVATE KEY) or a path. When it is empty, or a path that cannot be
 * read, the Render secret file named after the key id is tried next — so an
 * old variable pointing at a file on somebody's laptop does not stop the
 * secret file from being found. `tag` starts each log line; `dark` says what
 * not having the key means.
 *
 * @returns {crypto.KeyObject|null}
 */
export function readP8({ value = '', varName, keyId = '', tag, dark }) {
  const secretFile = /^[A-Za-z0-9]{1,32}$/.test(keyId) ? `/etc/secrets/AuthKey_${keyId}.p8` : '';
  let text = '';
  let from = '';
  if (/PRIVATE\s+KEY/i.test(value)) {
    text = value;
    from = varName;
  } else {
    for (const candidate of [value, secretFile].filter(Boolean)) {
      try {
        text = fs.readFileSync(candidate, 'utf8');
        from = candidate === secretFile ? secretFile : `the file ${varName} names`;
        break;
      } catch { /* try the next place */ }
    }
  }
  if (!text) {
    // Nothing set anywhere is a feature somebody has not switched on yet, and
    // says nothing. Something set that led nowhere is worth a line.
    if (value || secretFile) {
      const looked = [value && `${varName} is neither a key nor a readable file`, secretFile && `no ${secretFile}`]
        .filter(Boolean).join('; ');
      console.warn(`${tag}: no key found (${looked}) — ${dark}`);
    }
    return null;
  }
  try {
    return loadP256(text);
  } catch (err) {
    console.warn(`${tag}: the key in ${from} would not load (${String(err.message).slice(0, 60)}; ${describePaste(text)}) — ${dark}`);
    return null;
  }
}

/**
 * Text to a P-256 private key: as given first, then as the base64 inside it.
 * Throws the first error when neither works, since that is the one that
 * describes the text as it arrived.
 */
export function loadP256(text) {
  const asP256 = (key) => {
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('not a P-256 key');
    }
    return key;
  };
  try {
    return asP256(crypto.createPrivateKey(String(text).replace(/\\n/g, '\n')));
  } catch (first) {
    const der = Buffer.from(pastedBase64(text), 'base64');
    if (der.length < 32) throw first;
    try {
      return asP256(crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
    } catch {
      throw first;
    }
  }
}

/** The base64 body of a pasted PEM, with markers, escapes and whitespace gone. */
function pastedBase64(text) {
  const dash = '-‐-―−';
  return String(text || '')
    .replace(/^﻿/, '')
    .replace(/\\[nr]/g, '\n')
    .replace(new RegExp(`[${dash}]{2,}\\s*(BEGIN|END)[^${dash}]*[${dash}]{2,}`, 'gi'), '\n')
    .replace(/[^A-Za-z0-9+/=]/g, '');
}

/**
 * What the text looked like, in counts only — enough to tell a truncated
 * paste from a mangled one, and nothing that is any part of the key.
 */
function describePaste(text) {
  const t = String(text || '');
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).length;
  const begin = /BEGIN\s+PRIVATE\s+KEY/i.test(t);
  const end = /END\s+PRIVATE\s+KEY/i.test(t);
  const odd = (t.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
  return `${t.length} chars, ${lines} lines, begin marker ${begin ? 'yes' : 'no'}, end marker ${end ? 'yes' : 'no'}, `
    + `${pastedBase64(t).length} base64 chars (a .p8 has 200), ${odd} unusual characters`;
}
