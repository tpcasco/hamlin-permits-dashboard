import type { Adapter } from '../types';
/** Paywalled: no direct fetch. Its headlines are reached through the reconcile step's web search (trusted domain list). */
const adapter: Adapter = { id: 'growthspotter', async run() { return []; } };
export default adapter;
