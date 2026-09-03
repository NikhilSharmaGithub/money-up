// One look at the App Store queue: what state is v1.0 and its submission in?
import { api, APP } from './asc.mjs';
const vers = await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=2`);
for (const v of vers.data || []) console.log('version', v.attributes.versionString, v.attributes.appStoreState, v.id);
const subs = await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=3`);
for (const s of subs.data || []) console.log('submission', s.attributes.state, s.id);
const iaps = await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=5`);
for (const i of iaps.data || []) console.log('iap', i.attributes.productId, i.attributes.state);
