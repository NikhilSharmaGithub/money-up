// What makes an App Store receipt the App Store's.
//
// /api/store/redeem pays out whatever verifySignedTransaction calls genuine,
// and it used to call genuine anything whose certificate chain reached an
// Apple root. Every Apple developer holds the key to a certificate like that,
// so anybody with a free developer account could sign their own "large coin
// pack" with a fresh transaction id each time and be paid for it, again and
// again. This builds the forgeries that used to pass — a developer-style leaf,
// an RSA leaf, a leaf under a non-CA intermediate — and checks each is turned
// away, along with the chain shape the real App Store does use.
//
// Nobody but Apple can sign under the real root, so the chain rules are run
// against a stand-in root built here, and the full receipt check against the
// real pinned root, where every forgery has to fail.
//
//   node test/appstore-verify.mjs
//
// Needs the openssl command line to mint certificates; without it the run
// says so and passes, since there is nothing it could prove.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkAppleChain, extensionOids, verifySignedTransaction } from '../server/appstore.js';

let failed = 0;
let passed = 0;
const PASS = (ok, label, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const section = (t) => console.log(`\n── ${t}`);

if (spawnSync('openssl', ['version']).status !== 0) {
  console.log('openssl is not on PATH — nothing to mint certificates with, skipping');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-appstore-'));
const at = (f) => path.join(dir, f);
const ssl = (...args) => {
  const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl ${args.join(' ')}:\n${r.stderr}`);
};
const ecKey = (name, curve = 'prime256v1') => ssl('ecparam', '-name', curve, '-genkey', '-noout', '-out', at(`${name}.key`));
const rsaKey = (name) => ssl('genrsa', '-out', at(`${name}.key`), '2048');

/**
 * One certificate: `name`.pem, signed by `issuer` (or by itself), carrying
 * exactly the extensions given.
 */
function mint(name, { issuer = null, ext }) {
  fs.writeFileSync(at(`${name}.ext`), `${ext.join('\n')}\n`);
  ssl('req', '-new', '-key', at(`${name}.key`), '-subj', `/CN=${name}`, '-out', at(`${name}.csr`));
  const signer = issuer
    ? ['-CA', at(`${issuer}.pem`), '-CAkey', at(`${issuer}.key`), '-set_serial', String(Date.now() % 1e9 + Math.floor(Math.random() * 1000))]
    : ['-signkey', at(`${name}.key`)];
  ssl('x509', '-req', '-in', at(`${name}.csr`), '-days', '30', ...signer,
    '-extfile', at(`${name}.ext`), '-sha256', '-out', at(`${name}.pem`));
  return new crypto.X509Certificate(fs.readFileSync(at(`${name}.pem`)));
}

const CA = ['basicConstraints=critical,CA:TRUE', 'keyUsage=critical,keyCertSign,cRLSign', 'subjectKeyIdentifier=hash'];
const LEAF = ['basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', 'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid'];
const INTERMEDIATE_MARK = '1.2.840.113635.100.6.2.1=ASN1:NULL';
const RECEIPT_MARK = '1.2.840.113635.100.6.11.1=ASN1:NULL';
const DEVELOPER_MARK = '1.2.840.113635.100.6.1.2=ASN1:NULL';   // what an "Apple Development" certificate carries

let root;
let inter;
let leaf;
let devLeaf;
let rsaLeaf;
let plainInter;
let unmarkedInter;
let leafUnderPlain;
try {
  ecKey('root', 'secp384r1');
  root = mint('root', { ext: CA });
  ecKey('inter');
  inter = mint('inter', { issuer: 'root', ext: [...CA, 'authorityKeyIdentifier=keyid', INTERMEDIATE_MARK] });
  ecKey('leaf');
  leaf = mint('leaf', { issuer: 'inter', ext: [...LEAF, RECEIPT_MARK] });
  ecKey('devLeaf');
  devLeaf = mint('devLeaf', { issuer: 'inter', ext: [...LEAF, DEVELOPER_MARK] });
  rsaKey('rsaLeaf');
  rsaLeaf = mint('rsaLeaf', { issuer: 'inter', ext: [...LEAF, RECEIPT_MARK] });
  // An intermediate that is not a CA at all — what a leaf posing as one is.
  ecKey('plainInter');
  plainInter = mint('plainInter', { issuer: 'root', ext: [...LEAF, INTERMEDIATE_MARK] });
  ecKey('leafUnderPlain');
  leafUnderPlain = mint('leafUnderPlain', { issuer: 'plainInter', ext: [...LEAF, RECEIPT_MARK] });
  // A CA without Apple's intermediate marker.
  ecKey('unmarkedInter');
  unmarkedInter = mint('unmarkedInter', { issuer: 'root', ext: [...CA, 'authorityKeyIdentifier=keyid'] });
} catch (err) {
  console.log(`could not mint test certificates — ${err.message}`);
  process.exit(1);
}

section('reading a certificate\'s extensions');
{
  PASS(extensionOids(leaf).includes('1.2.840.113635.100.6.11.1'), 'the receipt-signing marker is found on the leaf');
  PASS(!extensionOids(devLeaf).includes('1.2.840.113635.100.6.11.1'), 'and not on a developer certificate');
  PASS(extensionOids(inter).includes('1.2.840.113635.100.6.2.1'), 'the intermediate marker is found on the intermediate');
}

section('the chain the App Store signs with');
{
  const good = checkAppleChain([leaf, inter, root], root);
  PASS(good.ok === true, 'receipt leaf → Apple CA intermediate → root is accepted', good.error || '');
  // The root a receipt carries is never the one trusted: a chain that names
  // the right root but was not signed under it is refused all the same.
  const wrongTop = checkAppleChain([leaf, inter, leaf], root);
  PASS(wrongTop.ok === true, 'the root a receipt carries itself is not what is checked');
}

section('the forgeries that used to pass');
{
  const cases = [
    ['a developer certificate signing its own "receipt"', [devLeaf, inter, root]],
    ['an RSA leaf, under a header that says ES256', [rsaLeaf, inter, root]],
    ['a leaf under an intermediate that is no CA', [leafUnderPlain, plainInter, root]],
    ['a CA without Apple\'s intermediate marker', [leaf, unmarkedInter, root]],
    ['a chain one certificate short', [leaf, inter]],
    ['a chain one certificate long', [leaf, inter, root, root]],
  ];
  for (const [label, chain] of cases) {
    const out = checkAppleChain(chain, root);
    PASS(!!out.error, `${label}: refused`, out.error || 'ACCEPTED');
  }
}

// A well-formed JWS, signed with the leaf's own key, for the big coin pack
// and a transaction id nobody has seen — the shape of the attack.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const der = (c) => c.raw.toString('base64');
const forge = (chain, keyName, extra = {}) => {
  const header = b64({ alg: 'ES256', x5c: chain.map(der) });
  const payload = b64({
    bundleId: 'com.moneymove.game',
    productId: 'com.moneymove.game.coins.large',
    transactionId: `forged-${crypto.randomUUID()}`,
    signedDate: Date.now(),
    ...extra,
  });
  const key = crypto.createPrivateKey(fs.readFileSync(at(`${keyName}.key`)));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`),
    key.asymmetricKeyType === 'ec' ? { key, dsaEncoding: 'ieee-p1363' } : key);
  return `${header}.${payload}.${sig.toString('base64url')}`;
};

section('a forged receipt, end to end');
{
  const real = await verifySignedTransaction(forge([leaf, inter, root], 'leaf'), { bundleId: 'com.moneymove.game' });
  PASS(real.error === 'Receipt was not signed by Apple', 'a perfectly signed receipt under any root but Apple\'s is refused', real.error || 'ACCEPTED');
  const rsa = await verifySignedTransaction(forge([rsaLeaf, inter, root], 'rsaLeaf'), { bundleId: 'com.moneymove.game' });
  PASS(!!rsa.error, 'an RSA-signed one is refused', rsa.error || 'ACCEPTED');
  const short = await verifySignedTransaction(forge([leaf, inter], 'leaf'), { bundleId: 'com.moneymove.game' });
  PASS(!!short.error, 'a two-certificate chain is refused', short.error || 'ACCEPTED');
  const junk = await verifySignedTransaction('a.b.c', { bundleId: 'com.moneymove.game' });
  PASS(!!junk.error, 'and so is noise', junk.error || 'ACCEPTED');
}

section('a receipt signed before Apple rotated its leaf');
{
  // Apple signs under a leaf until a few weeks before it lapses. A purchase
  // whose redeem has not got through by then (an outage, an app killed
  // mid-redeem) is retried with the same signed transaction, so the chain has
  // to be judged as of when Apple signed it, or the player paid for nothing.
  // The test certificates last 30 days, so "40 days on" is after they lapse.
  const DAY = 24 * 60 * 60 * 1000;
  const later = new Date(Date.now() + 40 * DAY);
  const opts = (now) => ({ bundleId: 'com.moneymove.game', root, now });
  const fresh = await verifySignedTransaction(forge([leaf, inter, root], 'leaf'), opts(new Date()));
  PASS(fresh.ok === true, 'a receipt under the App Store\'s chain is accepted', fresh.error || '');
  const old = await verifySignedTransaction(forge([leaf, inter, root], 'leaf'), opts(later));
  PASS(old.ok === true, 'and still is after its leaf has expired, since it was signed while the leaf was good', old.error || '');
  const lapsed = await verifySignedTransaction(
    forge([leaf, inter, root], 'leaf', { signedDate: Date.now() + 35 * DAY }), opts(later));
  PASS(lapsed.error === 'Expired certificate in receipt chain', 'one signed after its leaf expired is refused', lapsed.error || 'ACCEPTED');
  const undated = await verifySignedTransaction(forge([leaf, inter, root], 'leaf', { signedDate: undefined }), opts(new Date()));
  PASS(!!undated.error, 'one with no signedDate is refused', undated.error || 'ACCEPTED');
  const ahead = await verifySignedTransaction(
    forge([leaf, inter, root], 'leaf', { signedDate: Date.now() + 60 * 60 * 1000 }), opts(new Date()));
  PASS(!!ahead.error, 'one dated an hour ahead of the server\'s clock is refused', ahead.error || 'ACCEPTED');
  // The date is under the signature: backdating it after the fact breaks it.
  const [h, p, sig] = forge([leaf, inter, root], 'leaf', { signedDate: Date.now() + 35 * DAY }).split('.');
  const body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  const backdated = `${h}.${b64({ ...body, signedDate: Date.now() })}.${sig}`;
  const moved = await verifySignedTransaction(backdated, opts(later));
  PASS(moved.error === 'Receipt signature does not match', 'and backdating a signedDate breaks the signature', moved.error || 'ACCEPTED');
  // The real pinned root is still what the server trusts without a stand-in.
  const pinned = await verifySignedTransaction(forge([leaf, inter, root], 'leaf'), { bundleId: 'com.moneymove.game', now: later });
  PASS(pinned.error === 'Receipt was not signed by Apple', 'without a stand-in root the same receipt is refused', pinned.error || 'ACCEPTED');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
