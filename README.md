# Forma · seguimiento personal

Aplicación web privada y mobile-first para organizar registros personales de peso y tratamiento. **No diagnostica ni prescribe.** No cambia dosis y no sustituye el criterio de un profesional de salud.

> La aplicación permite organizar registros personales. Incluye composición de báscula, peso, medidas, medicación/dosis, síntomas, actividad, laboratorios, fotos privadas, objetivos, revisiones, recordatorios guardados, análisis e historial. No diagnostica ni prescribe. Los recordatorios todavía no envían notificaciones externas; Telegram no está integrado.

## Arquitectura

```text
Navegador móvil/desktop → React + TypeScript + Vite → FastAPI REST / OpenAPI
                                                  └→ PostgreSQL
```

- **Frontend:** React, TypeScript estricto, Vite, Tailwind, React Router, Recharts y Lucide.
- **Backend:** FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, JWT de corta duración y contraseñas con Argon2.
- **Persistencia:** PostgreSQL. El token de acceso vive en memoria; una cookie `Secure`, `HttpOnly`, `SameSite=Strict` mantiene una sesión revocable de 30 días y restaura la sesión al volver a abrir la app. Las fotos se guardan como archivos privados bajo `storage/`.
- **Aislamiento:** las consultas de registros siempre se limitan al usuario autenticado. Fechas se normalizan a UTC; el perfil parte de `America/Bogota`. Los formularios de peso y dosis proponen la fecha/hora actual y permiten editarla antes de guardar.

## Requisitos

- Docker Engine + Docker Compose plugin **o** Node.js 22+, Python 3.11+ y PostgreSQL 16+.

## Docker

1. Copia `.env.example` como `.env` y ajusta `APP_DOMAIN` al hostname LAN que quieras usar. Configura el DNS de tu LAN para que ese nombre resuelva a la IP LAN de este servidor.
2. Sustituye `POSTGRES_PASSWORD` y `SECRET_KEY` por valores aleatorios únicos. No publiques `.env`.
3. Crea en Cloudflare un API Token limitado a la zona `albotero.com` con permiso **Zone / DNS / Edit**. En el servidor, ejecuta `mkdir -p secrets && chmod 700 secrets`, guarda `dns_cloudflare_api_token = TU_TOKEN` en `secrets/cloudflare.ini`, ejecuta `chmod 600 secrets/cloudflare.ini` y no lo guardes en Git ni lo compartas.
4. Ejecuta una vez desde la raíz para emitir el certificado Let's Encrypt por DNS-01 (no requiere abrir la app a Internet):

   ```sh
   docker compose run --rm --entrypoint certbot certbot certonly \\
       --dns-cloudflare \\
       --dns-cloudflare-credentials /run/secrets/cloudflare.ini \\
       --dns-cloudflare-propagation-seconds 60 \\
       --agree-tos --register-unsafely-without-email --non-interactive \\
       -d forma.albotero.com
   ```

5. Permite al grupo de Nginx leer la clave privada (el worker no corre como root) y restringe su modo:

   ```sh
   docker compose run --rm --entrypoint sh certbot -c 'chgrp 101 /etc/letsencrypt/live /etc/letsencrypt/archive /etc/letsencrypt/live/forma.albotero.com/privkey.pem && chmod 710 /etc/letsencrypt/live /etc/letsencrypt/archive && chmod 640 /etc/letsencrypt/live/forma.albotero.com/privkey.pem'
   ```

6. Ejecuta `docker compose up --build -d` desde la raíz. Nginx sirve HTTPS en el puerto 443 y redirige HTTP a HTTPS; Certbot renueva el certificado automáticamente y vuelve a aplicar permisos restringidos a la clave.
7. Abre `https://forma.albotero.com`; la API se sirve en el mismo origen bajo `/api` y OpenAPI está en `/docs`.

Solo el frontend publica HTTP/HTTPS al host. Nginx reenvía `/api` al backend por la red privada de Compose; ni la API ni la base de datos publican puertos directamente. Limita TCP 443 (y opcionalmente TCP 80 para la redirección) a la LAN en el firewall del host/router. La validación DNS-01 usa el token de Cloudflare; no publiques `.env` ni `secrets/cloudflare.ini`.

## Módulos de seguimiento

- **Composición:** cada lectura de peso acepta opcionalmente grasa corporal, masa libre de grasa, grasa subcutánea, índice de grasa visceral, agua corporal, músculo esquelético, masa muscular, masa ósea, proteína, metabolismo basal y edad metabólica. Son estimaciones reportadas por la báscula; se guardan junto con el peso, la fecha/hora, y pueden editarse o borrarse.
- **Medidas, síntomas, actividad, laboratorios, objetivos, revisiones y recordatorios:** registros con fecha/hora, campos relevantes, notas y operaciones de edición/eliminación.
- **Fotos:** cargas privadas JPEG/PNG/WebP de hasta 10 MB, aisladas por usuario, con descripción y fecha editable.
- **Medicación e historial:** permite añadir/editar concentraciones, archivar o reactivar medicamentos y editar/eliminar dosis; archivar conserva el historial relacionado.
- Los recordatorios se almacenan y editan dentro de la app, pero no disparan notificaciones mientras está cerrada ni se envían por correo/Telegram.

Las sesiones se restauran mediante un refresh token aleatorio almacenado como hash en la base de datos. El navegador solo recibe la cookie segura; los refresh tokens rotan y el cierre de sesión revoca la sesión del servidor.

## Desarrollo local

**Backend** (desde `backend/`):

```sh
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]' alembic
export DATABASE_URL='postgresql+psycopg://tracker:tracker@localhost:5432/tracker'
export SECRET_KEY='local-development-secret-replace-before-deploying'
alembic upgrade head
uvicorn app.main:app --reload
```

**Frontend** (desde `frontend/`):

```sh
npm install
cp .env.example .env
npm run dev
```

Vite arranca en `http://localhost:5173` y reenvía `/api` al backend local en `http://localhost:8000`. Para cuentas nuevas la contraseña debe tener al menos 12 caracteres. El perfil inicia con 180 cm, 106 kg y zona `America/Bogota`; la concentración predeterminada de tirzepatida es 10 mg / 0.5 mL y se crea al abrir por primera vez. Las equivalencias se calculan dinámicamente; U-100 es opcional.

## Migraciones

`alembic upgrade head` aplica la revisión inicial. Para la siguiente revisión de esquema: `alembic revision --autogenerate -m 'descripcion'` y revisa siempre el script generado antes de aplicarlo.

## Pruebas y build

```sh
cd backend && pip install -e '.[dev]' alembic && pytest
cd frontend && npm run build && npm run lint
```

La suite cubre IMC, objetivos, pérdida porcentual, promedio móvil, velocidad semanal, conversiones mg/mL/U-100 y aislamiento de cuentas.

## Privacidad y seguridad

- API protegida con token JWT de expiración corta y Argon2id para contraseñas.
- Límite de solicitudes por IP para registro (10/min) e inicio de sesión (10/min); usa un reverse proxy consciente de `X-Forwarded-For` y un almacenamiento compartido al escalar a varias réplicas.
- El token no se persiste al recargar la página; inicia sesión nuevamente. Los registros se guardan en PostgreSQL, no en almacenamiento local del navegador.
- No hay analytics externos. No se incluye Telegram en esta fase; cuando se integre se requerirá vinculación de un solo uso y verificación del secreto del webhook.
- Limita el acceso de red, usa HTTPS, rota secretos, actualiza dependencias y limita intentos mediante proxy/WAF antes de exponer el servicio públicamente. La protección contra fuerza bruta distribuida y recuperación de cuenta aún no están implementadas.
- Para producción, configura almacenamiento de fotos privado (todavía no implementado) y cifra respaldos fuera del host.

## Copias de seguridad

La exportación JSON/CSV y restauración desde la app aún no están implementadas. Para desarrollo, `docker compose exec -T postgres pg_dump -U tracker tracker > backup.sql`; restauración sobre una base vacía: `docker compose exec -T postgres psql -U tracker tracker < backup.sql`. Protege el archivo como dato médico sensible y verifica restauraciones periódicamente.

## Telegram, seed y producción

El bot, recordatorios, seed de datos ficticios, fotos, ZIP de exportación, importación y configuración de webhook **no forman parte de esta fase**. No se debe configurar un webhook productivo todavía. El servidor no incluye datos demo con el perfil real.
