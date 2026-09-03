import { api } from './asc.mjs';
const r = await api('GET', '/v1/builds?filter[app]=6806881798&limit=5&sort=-uploadedDate');
for (const b of r.data || []) {
  console.log('build', b.attributes.version, '|', b.attributes.processingState, '| uploaded', b.attributes.uploadedDate);
}
