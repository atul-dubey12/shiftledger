/** Fallback static build: entries stay in this browser's localStorage. Deploy with `MODE=device npm run deploy`. */
export const STORAGE: { mode: 'api' | 'device'; apiBaseUrl: string } = { mode: 'device', apiBaseUrl: '' };
