// Links from before the public site opened the app at the root (#/?s=…), and the old domain's redirect
// brings them here with their hash kept. This sends them on to /app before the landing page shows. It is a
// file of its own, loaded from the landing's <head>, because the CSP runs no inline script (server/src/app.ts).
if (location.hash.startsWith('#/')) location.replace('/app' + location.hash);
