export default function handler(req: Request): Response {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Mastra App</title></head><body><h1>Mastra App</h1><p>API が稼働中です。</p></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

