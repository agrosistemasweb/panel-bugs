# Panel de Bugs - Instrucciones de Deploy

## Arquitectura

```
[Testers] --> [GitHub Pages: index.html] --> [Cloudflare Worker: proxy] --> [ClickUp API]
                  (publico)                    (oculta el token)
```

---

## PASO 1: Crear el Cloudflare Worker (proxy)

1. Ir a https://dash.cloudflare.com/ y crear una cuenta gratuita (si no tenes)
2. En el menu izquierdo, click en **"Workers & Pages"**
3. Click en **"Create"** > **"Create Worker"**
4. Ponerle nombre: `panel-bugs-proxy`
5. Click **"Deploy"** (con el codigo default)
6. Despues del deploy, click en **"Edit Code"**
7. **Borrar todo** y pegar el contenido del archivo `worker.js` de este proyecto
8. **IMPORTANTE:** En la linea de `ALLOWED_ORIGINS`, cambiar `TU-USUARIO` por tu usuario de GitHub
9. Click en **"Deploy"** de nuevo

### Configurar el API Token como variable de entorno:
1. Volver al dashboard del worker
2. Click en **"Settings"** > **"Variables and Secrets"**
3. Click en **"Add"**
4. Nombre: `CLICKUP_API_TOKEN`
5. Valor: `pk_174607180_S9C9W7ZLISP63DP08BYRL46EHXWMD78C`
6. Click en **"Encrypt"** (para que quede seguro)
7. Click en **"Deploy"**

Tu Worker ya esta corriendo en: `https://panel-bugs-proxy.TU-SUBDOMINIO.workers.dev`

---

## PASO 2: Subir a GitHub Pages

### Opcion A: Desde la web de GitHub
1. Ir a https://github.com/new
2. Nombre del repo: `panel-bugs` (puede ser publico o privado)
3. Crear el repositorio
4. Click en **"uploading an existing file"**
5. Arrastrar el archivo `index.html` de este proyecto
6. Click **"Commit changes"**
7. Ir a **Settings** > **Pages**
8. En "Source" seleccionar **"Deploy from a branch"**
9. Branch: `main`, carpeta: `/ (root)`
10. Click **"Save"**
11. Esperar 1-2 minutos. Tu link sera: `https://TU-USUARIO.github.io/panel-bugs/`

### Opcion B: Desde Git (linea de comandos)
```bash
cd panel-bugs-clickup
git init
git add index.html
git commit -m "Panel de bugs ClickUp"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/panel-bugs.git
git push -u origin main
```
Luego activar Pages como en la Opcion A, paso 7-10.

---

## PASO 3: Conectar el frontend con el Worker

1. Abrir `index.html`
2. Buscar la linea:
   ```js
   const WORKER_URL = 'https://panel-bugs-proxy.TU-SUBDOMINIO.workers.dev';
   ```
3. Cambiar `TU-SUBDOMINIO` por tu subdominio de Cloudflare Workers
   (lo ves en el dashboard del worker, arriba)
4. Commitear y pushear el cambio

---

## PASO 4: Actualizar el CORS en el Worker

1. Ir al editor del Worker en Cloudflare
2. En `ALLOWED_ORIGINS`, poner tu URL real de GitHub Pages:
   ```js
   const ALLOWED_ORIGINS = [
     'https://TU-USUARIO.github.io',
     'http://localhost',
     'http://127.0.0.1',
   ];
   ```
3. Deploy

---

## Listo!

Compartir el link `https://TU-USUARIO.github.io/panel-bugs/` con los testers.

- No necesitan cuenta de ClickUp
- No necesitan instalar nada
- Pueden ver todos los bugs y agregar comentarios
- El token de ClickUp queda oculto en Cloudflare

---

## Costos

Todo es **100% gratuito**:
- GitHub Pages: gratis para repos publicos y privados
- Cloudflare Workers: 100,000 peticiones/dia gratis (mas que suficiente)
- Sin tarjeta de credito requerida

---

## Cambiar de Sprint

Si necesitas apuntar a otro sprint, cambiar el `LIST_ID` en `index.html`:
```js
const LIST_ID = '901324539845'; // Sprint 3 Modulo Contable
```

IDs de tus sprints:
- Sprint 1: `901323690606` (17 tareas)
- Sprint 2: `901324230121` (20 tareas)
- Sprint 3: `901324539845` (74 tareas) <-- actual
- Sprint 4: `901325316130` (46 tareas)
