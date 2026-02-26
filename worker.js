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
  'https://TU-USUARIO.github.io',   // <-- CAMBIAR por tu usuario de GitHub
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

        const resp = await fetch(
          `${CLICKUP_API}/list/${listId}/task?include_closed=${includeClosed}&subtasks=${subtasks}&page=${page}`,
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
