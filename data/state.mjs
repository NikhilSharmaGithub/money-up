import { api } from './asc.mjs';
const subs = await api('GET', '/v1/reviewSubmissions?filter[app]=6806881798&limit=6');
for (const s of subs.data) {
  const items = await api('GET', `/v1/reviewSubmissions/${s.id}/items`);
  console.log(s.id, '|', s.attributes.state, '| items:', items.data.length, '| submitted', s.attributes.submittedDate || '-');
}
const v = await api('GET', '/v1/appStoreVersions/5f64c974-9214-445f-a602-a0b9b1b3e958');
const b = await api('GET', '/v1/appStoreVersions/5f64c974-9214-445f-a602-a0b9b1b3e958/build');
console.log('\nversion 1.0:', v.data.attributes.appStoreState, '| build', b.data?.attributes?.version);
const iaps = await api('GET', '/v1/apps/6806881798/inAppPurchasesV2?limit=5');
for (const i of iaps.data) console.log('iap', i.attributes.productId, '→', i.attributes.state);
