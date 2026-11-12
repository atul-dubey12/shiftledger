/** Default GitHub Pages build: every device reads and writes the same hosted API + database. */
export const STORAGE: { mode: 'api' | 'device'; apiBaseUrl: string } = { mode: 'api', apiBaseUrl: 'https://shiftledger-api.onrender.com' };
