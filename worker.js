// =============================================================
// Cloudflare Worker - Proxy para ClickUp API
// =============================================================
// Este worker:
// 1. Oculta el API token de ClickUp (guardado como variable de entorno)
// 2. Resuelve problemas de CORS para que el frontend pueda hacer peticiones
// 3. Solo permite GET (leer) y POST a /comment (comentar)
// =============================================================

const CLICKUP_API = 'https://api.clickup.com/api/v2';

// Origenes permitidos - Agregar tu dominio de GitHub Pages
const ALLOWED_ORIGINS = [
  'https://agrosistemasweb.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null' // para archivos locales
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o)) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// Caché de lecturas: todos los paneles comparten el token de ClickUp (100 consultas/min).
// Sin caché, cada persona con un panel abierto relee todo y se pasa el límite (429).
// Una misma lectura se sirve desde memoria durante MEMO_TTL; si ClickUp devuelve 429
// o falla, se sirve la última lectura buena (hasta MEMO_STALE) en lugar del error.
// Las lecturas iguales que llegan a la vez esperan a la misma consulta.
// (La Cache API no funciona en *.workers.dev: por eso va en memoria del worker.)
const MEMO = new Map();          // url -> { ts, status, body } | { p:Promise, viejo }
const MEMO_TTL = 60 * 1000;
const MEMO_STALE = 15 * 60 * 1000;

async function cachedGet(clickupUrl, token) {
  const ahora = Date.now();
  const hit = MEMO.get(clickupUrl);
  if (hit && hit.p) return { ...(await hit.p), cache:'ESPERA' };
  if (hit && ahora - hit.ts < MEMO_TTL) return { ...hit, cache:'HIT' };

  const viejo = hit && ahora - hit.ts < MEMO_STALE ? hit : null;
  const p = (async () => {
    try {
      const resp = await fetch(clickupUrl, { headers: { 'Authorization': token } });
      const body = await resp.text();
      if (resp.status === 200) return { ts: Date.now(), status: 200, body };
      if (viejo) return { ...viejo, cache:'VIEJO' };
      return { ts: 0, status: resp.status, body };
    } catch (e) {
      if (viejo) return { ...viejo, cache:'VIEJO' };
      throw e;
    }
  })();
  MEMO.set(clickupUrl, { p });
  try {
    const r = await p;
    if (r.status === 200 && !r.cache) MEMO.set(clickupUrl, r);
    else if (viejo) MEMO.set(clickupUrl, viejo);
    else MEMO.delete(clickupUrl);
    if (MEMO.size > 2000) MEMO.delete(MEMO.keys().next().value);
    return { cache:'MISS', ...r };
  } catch (e) {
    MEMO.delete(clickupUrl);
    throw e;
  }
}

function cachedResponse(r, request) {
  return new Response(r.body, {
    status: r.status,
    headers: { 'Content-Type': 'application/json', 'X-Cache': r.cache, ...corsHeaders(request) }
  });
}

export default {
  async fetch(request, env) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // API Token desde variable de entorno de Cloudflare
    const API_TOKEN = env.CLICKUP_API_TOKEN;
    if (!API_TOKEN) {
      return jsonResponse({ error: 'API token no configurado en el worker' }, 500, request);
    }

    try {
      // ---- GET /api/tasks?list_id=XXX&page=0&include_closed=true ----
      if (path === '/api/tasks' && request.method === 'GET') {
        const listId = url.searchParams.get('list_id');
        if (!listId) return jsonResponse({ error: 'list_id requerido' }, 400, request);

        const page = url.searchParams.get('page') || '0';
        const includeClosed = url.searchParams.get('include_closed') || 'true';
        const subtasks = url.searchParams.get('subtasks') || 'true';

        const r = await cachedGet(
          `${CLICKUP_API}/list/${listId}/task?include_closed=${includeClosed}&subtasks=${subtasks}&page=${page}`,
          API_TOKEN
        );
        return cachedResponse(r, request);
      }

      // ---- GET /api/task/:id (detalle con attachments) ----
      if (path.match(/^\/api\/task\/[^/]+$/) && !path.includes('/comment') && request.method === 'GET') {
        const taskId = path.split('/')[3];
        const resp = await fetch(
          `${CLICKUP_API}/task/${taskId}?include_subtasks=true`,
          { headers: { 'Authorization': API_TOKEN } }
        );
        const data = await resp.json();
        return jsonResponse(data, resp.status, request);
      }

      // ---- GET /api/task/:id/comment ----
      if (path.match(/^\/api\/task\/[^/]+\/comment$/) && request.method === 'GET') {
        const taskId = path.split('/')[3];
        const resp = await fetch(
          `${CLICKUP_API}/task/${taskId}/comment`,
          { headers: { 'Authorization': API_TOKEN } }
        );
        const data = await resp.json();
        return jsonResponse(data, resp.status, request);
      }

      // ---- POST /api/task/:id/comment ----
      if (path.match(/^\/api\/task\/[^/]+\/comment$/) && request.method === 'POST') {
        const taskId = path.split('/')[3];
        const body = await request.json();

        // Solo permitir comment_text por seguridad
        const safeBody = {
          comment_text: String(body.comment_text || '').slice(0, 5000),
          notify_all: false
        };

        const resp = await fetch(
          `${CLICKUP_API}/task/${taskId}/comment`,
          {
            method: 'POST',
            headers: {
              'Authorization': API_TOKEN,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(safeBody)
          }
        );
        const data = await resp.json();
        return jsonResponse(data, resp.status, request);
      }

      // ---- GET /api/state/:key (leer estado del panel desde KV) ----
      if (path.match(/^\/api\/state\/[^/]+$/) && request.method === 'GET') {
        const key = path.split('/')[3];
        if (!env.PANEL_STATE) return jsonResponse({ error:'KV no configurado' }, 500, request);
        const data = await env.PANEL_STATE.get(key, { type: 'json' });
        return jsonResponse(data || {}, 200, request);
      }

      // ---- POST /api/state/:key (escribir estado del panel a KV) ----
      if (path.match(/^\/api\/state\/[^/]+$/) && request.method === 'POST') {
        const key = path.split('/')[3];
        if (!env.PANEL_STATE) return jsonResponse({ error:'KV no configurado' }, 500, request);
        const body = await request.json();
        // limite de tamano razonable (~25KB)
        const str = JSON.stringify(body);
        if (str.length > 25000) return jsonResponse({ error:'payload demasiado grande' }, 413, request);
        await env.PANEL_STATE.put(key, str);
        return jsonResponse({ ok:true, size: str.length }, 200, request);
      }

      // ---- GET /api/folder/:id/list (listar listas de un folder) ----
      if (path.match(/^\/api\/folder\/[^/]+\/list$/) && request.method === 'GET') {
        const folderId = path.split('/')[3];
        const r = await cachedGet(`${CLICKUP_API}/folder/${folderId}/list`, API_TOKEN);
        return cachedResponse(r, request);
      }

      // ---- GET /api/list/:id/field ----
      if (path.match(/^\/api\/list\/[^/]+\/field$/) && request.method === 'GET') {
        const listId = path.split('/')[3];
        const resp = await fetch(
          `${CLICKUP_API}/list/${listId}/field`,
          { headers: { 'Authorization': API_TOKEN } }
        );
        const data = await resp.json();
        return jsonResponse(data, resp.status, request);
      }

      // Ruta no encontrada
      return jsonResponse({ error: 'Ruta no encontrada', rutas: [
        'GET /api/tasks?list_id=XXX',
        'GET /api/task/:id',
        'GET /api/task/:id/comment',
        'POST /api/task/:id/comment',
        'GET /api/list/:id/field'
      ]}, 404, request);

    } catch (err) {
      return jsonResponse({ error: err.message }, 500, request);
    }
  }
};

function jsonResponse(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request)
    }
  });
}
