// App Store Connect API helper — JWT + JSON verbs + the review-screenshot
// upload dance (reserve, PUT the bytes, commit with a checksum).
import crypto from 'node:crypto'; import fs from 'node:fs'; import os from 'node:os';
const KEY_ID='93SKS9929V', ISSUER='c3ae2bc3-9b35-461b-a365-4d76ed708d07';
export const APP='6806881798';
const key=fs.readFileSync(`${os.homedir()}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`,'utf8');
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(){
  const now=Math.floor(Date.now()/1000);
  const h=b64({alg:'ES256',kid:KEY_ID,typ:'JWT'}), p=b64({iss:ISSUER,iat:now,exp:now+1100,aud:'appstoreconnect-v1'});
  const sig=crypto.sign('sha256',Buffer.from(`${h}.${p}`),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return `${h}.${p}.${sig}`;
}
export async function api(method, path, body){
  const r=await fetch(`https://api.appstoreconnect.apple.com${path.startsWith('/')?path:'/v1/'+path}`,{
    method, headers:{Authorization:`Bearer ${jwt()}`, 'Content-Type':'application/json'},
    body: body?JSON.stringify(body):undefined});
  const text=await r.text();
  let json; try{json=JSON.parse(text);}catch{json={raw:text};}
  if(!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0,3000)}`);
  return json;
}
export async function uploadScreenshot(iapId, file){
  const bytes=fs.readFileSync(file);
  const md5=crypto.createHash('md5').update(bytes).digest('hex');
  const reserved=await api('POST','/v1/inAppPurchaseAppStoreReviewScreenshots',{data:{
    type:'inAppPurchaseAppStoreReviewScreenshots',
    attributes:{fileName:'store.png',fileSize:bytes.length},
    relationships:{inAppPurchaseV2:{data:{type:'inAppPurchases',id:iapId}}}}});
  for(const op of reserved.data.attributes.uploadOperations){
    const headers={}; for(const h of op.requestHeaders||[]) headers[h.name]=h.value;
    const chunk=bytes.subarray(op.offset,op.offset+op.length);
    const u=await fetch(op.url,{method:op.method,headers,body:chunk});
    if(!u.ok) throw new Error(`upload chunk -> ${u.status}`);
  }
  await api('PATCH',`/v1/inAppPurchaseAppStoreReviewScreenshots/${reserved.data.id}`,{data:{
    type:'inAppPurchaseAppStoreReviewScreenshots', id:reserved.data.id,
    attributes:{uploaded:true, sourceFileChecksum:md5}}});
  return reserved.data.id;
}
