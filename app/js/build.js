// Stamped by tools/build_site.sh with the commit id of this deploy. In a folder that was never built it reads "dev".
const stamped = '__BUILD__';
export const BUILD = stamped.startsWith('__') ? 'dev' : stamped;
