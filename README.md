# Forma · seguimiento personal

Aplicación web privada y mobile-first para organizar registros personales de peso y tratamiento. **No diagnostica ni prescribe.** No cambia dosis y no sustituye el criterio de un profesional de salud.

> La aplicación permite organizar registros personales. Incluye composición de báscula, peso, medidas, medicación/dosis, síntomas, actividad, laboratorios, fotos privadas, objetivos, revisiones, recordatorios por Telegram, análisis e historial. No diagnostica ni prescribe.

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

1. Copia `.env.example` como `.env`. Define `APP_DOMAIN` y usa el mismo origen HTTPS en `CORS_ORIGINS` y `PUBLIC_APP_URL`. Para la contraseña de PostgreSQL usa una cadena aleatoria URL-safe (letras, números, `-` y `_`) porque Compose la incorpora a la URL de conexión. No publiques `.env`.
2. Crea en Cloudflare un API Token limitado a la zona `albotero.com` con permiso **Zone / DNS / Edit**. En el servidor, ejecuta `mkdir -p secrets && chmod 700 secrets`, guarda `dns_cloudflare_api_token = TU_TOKEN` en `secrets/cloudflare.ini`, ejecuta `chmod 600 secrets/cloudflare.ini` y no lo guardes en Git ni lo compartas.
3. Ejecuta una vez desde la raíz para emitir el certificado Let's Encrypt por DNS-01 (no requiere abrir la app a Internet):

   ```sh
   docker compose run --rm --entrypoint certbot certbot certonly \\
       --dns-cloudflare \\
       --dns-cloudflare-credentials /run/secrets/cloudflare.ini \\
       --dns-cloudflare-propagation-seconds 60 \\
       --agree-tos --register-unsafely-without-email --non-interactive \\
      -d forma.albotero.com
   ```

4. Si cambiaste `APP_DOMAIN`, reemplaza `forma.albotero.com` en los pasos de emisión y permisos por ese mismo hostname. Permite al grupo de Nginx leer la clave privada (el worker no corre como root) y restringe su modo:

   ```sh
   docker compose run --rm --entrypoint sh certbot -c 'chgrp 101 /etc/letsencrypt/live /etc/letsencrypt/archive /etc/letsencrypt/live/forma.albotero.com/privkey.pem && chmod 710 /etc/letsencrypt/live /etc/letsencrypt/archive && chmod 640 /etc/letsencrypt/live/forma.albotero.com/privkey.pem'
   ```

5. Ejecuta `docker compose up --build -d` desde la raíz. Nginx sirve HTTPS en el puerto 443 y redirige HTTP a HTTPS; Certbot renueva el certificado automáticamente y vuelve a aplicar permisos restringidos a la clave.
6. Abre `https://forma.albotero.com`; la API se sirve en el mismo origen bajo `/api` y OpenAPI está en `/docs`.

Solo el frontend publica HTTP/HTTPS al host. Nginx reenvía `/api` al backend por una red privada; ni la API ni la base de datos publican puertos directamente. El backend tiene una red de salida para conectar con servicios externos como Telegram. Sin Telegram, puedes limitar HTTPS a la LAN. **Los webhooks de Telegram requieren que `PUBLIC_APP_URL/api/telegram/webhook` sea accesible desde los servidores de Telegram por HTTPS**; el Compose de este repositorio no configura un túnel. Si el sitio debe seguir siendo LAN-only, configura por separado un túnel/reverse proxy seguro para esa ruta; no expongas directamente backend ni PostgreSQL. La validación DNS-01 no crea esa ruta de entrada. No publiques `.env` ni `secrets/cloudflare.ini`.

## Módulos de seguimiento

- **Composición:** cada lectura de peso acepta opcionalmente grasa corporal, masa libre de grasa, grasa subcutánea, índice de grasa visceral, agua corporal, músculo esquelético, masa muscular, masa ósea, proteína, metabolismo basal y edad metabólica. Son estimaciones reportadas por la báscula; se guardan junto con el peso, la fecha/hora, y pueden editarse o borrarse.
- **Medidas, síntomas, actividad, laboratorios, objetivos, revisiones y recordatorios:** registros con fecha/hora, campos relevantes, notas y operaciones de edición/eliminación.
- **Fotos:** cargas privadas JPEG/PNG/WebP de hasta 10 MB, aisladas por usuario, con descripción y fecha editable.
- **Medicación e historial:** permite añadir/editar concentraciones, archivar o reactivar medicamentos y editar/eliminar dosis; archivar conserva el historial relacionado. Las cuentas nuevas empiezan sin medicamentos; cada persona registra solo los tratamientos que usa.
- Los recordatorios manuales y automáticos aparecen en Recordatorios. La app genera avisos para registrar la siguiente dosis (7 días tras la última dosis de una medicación activa), peso (1 día), composición (7 días tras una lectura que la incluya) y medidas (un mes); se recalculan al guardar una lectura nueva. Los automáticos se pueden activar/desactivar, pero no editar ni borrar. Si Telegram está vinculado, los avisos activos se envían también al chat privado. Cada usuario vincula ese chat con un enlace de un solo uso que caduca en 15 minutos; los tiempos respetan la zona horaria del perfil.
- **Análisis y seguimiento:** reúne checklists contextuales previos al inicio, semanales, cada cuatro semanas y periódicos. El estado solo indica si hay datos guardados; no valida su vigencia ni la idoneidad clínica. Los resúmenes de dosis describen el tiempo desde los registros disponibles, tendencia de peso y tolerancia/síntomas documentados; nunca indican subir, bajar, iniciar o suspender dosis.

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

Vite arranca en `http://localhost:5173` y reenvía `/api` al backend local en `http://localhost:8000`. Para cuentas nuevas la contraseña debe tener al menos 12 caracteres. El perfil inicial propone 180 cm, 106 kg y zona `America/Bogota`; actualiza altura y peso inicial en Perfil y ajustes. No se crea automáticamente una medicación: registra el medicamento y la concentración reales antes de cargar dosis. Las equivalencias se calculan dinámicamente; U-100 es opcional.

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
- Límite de solicitudes por dirección de cliente para registro (10/min), inicio de sesión (10/min) y cambio de contraseña (5/min). Nginx sobrescribe `X-Real-IP`; no expongas el backend directamente. Al escalar, configura un almacenamiento compartido para los límites.
- El token no se persiste al recargar la página; inicia sesión nuevamente. Los registros se guardan en PostgreSQL, no en almacenamiento local del navegador.
- No hay analytics externos. Telegram usa un bot configurado por el administrador, vinculación individual de un solo uso y secreto verificado para el webhook. Evita guardar información médica sensible en texto de recordatorios: el mensaje solo contiene el título y la hora.
- Limita el acceso de red, usa HTTPS, rota secretos, actualiza dependencias y limita intentos mediante proxy/WAF antes de exponer el servicio públicamente. La protección contra fuerza bruta distribuida y recuperación de cuenta aún no están implementadas.
- Para producción, configura almacenamiento de fotos privado (todavía no implementado) y cifra respaldos fuera del host.

## Copias de seguridad

La exportación JSON/CSV y restauración desde la app aún no están implementadas. Para desarrollo, `docker compose exec -T postgres pg_dump -U tracker tracker > backup.sql`; restauración sobre una base vacía: `docker compose exec -T postgres psql -U tracker tracker < backup.sql`. Protege el archivo como dato médico sensible y verifica restauraciones periódicamente.

## Configurar Telegram

1. Crea un bot con BotFather y establece `TELEGRAM_BOT_TOKEN` y el nombre sin `@` en `TELEGRAM_BOT_USERNAME` dentro de `.env`. No añadas el token al repositorio ni a mensajes.
2. Genera un secreto aleatorio exclusivo para `TELEGRAM_WEBHOOK_SECRET`; no lo publiques ni lo reutilices. Configura `PUBLIC_APP_URL` como la URL HTTPS pública de la aplicación.
3. Asegura que el backend tenga salida HTTPS a `api.telegram.org` y que la URL pública del webhook llegue por HTTPS a Nginx. Ejecuta `docker compose up --build -d`. Al arrancar, el backend registra el webhook y aplica `alembic upgrade head`.
4. En Recordatorios, el usuario elige **Vincular Telegram**, abre el enlace y pulsa **Iniciar** en el bot. Los avisos se envían cuando vence un recordatorio activo; incluyen el botón **Ya lo cumplí** y, al pulsarlo, el bot confirma y guarda el cumplimiento. Para recurrencias, la siguiente fecha se programa automáticamente.
5. Desde el chat privado vinculado también se pueden guardar registros usando `/peso 82.35`, `/dosis 2.5`, `/cintura 90`, `/sintoma 5 náuseas`, `/presion 120/80` o `/recordatorio 2026-09-28 08:00 Texto`. `/ayuda` muestra la lista. El registro de dosis solo se acepta si hay exactamente un medicamento activo; el bot guarda lo que la persona indica y no sugiere cantidades.

El envío periódico se ejecuta cada 30 segundos dentro del backend. Se omiten avisos con más de dos minutos de retraso para no enviar notificaciones antiguas después de una caída. Mantén una sola réplica del backend; aunque la fila se bloquea durante la reclamación, Telegram y PostgreSQL no comparten una transacción y un reinicio justo durante un envío aún puede producir una repetición. Al escalar, sustituye el sondeo por una cola/worker con idempotencia distribuida. Los recordatorios únicos se desactivan tras enviarse y su botón permite registrar el cumplimiento posterior. Solo se procesan comandos explícitos en el chat privado ya vinculado; otros mensajes no se guardan. Seed de datos ficticios, fotos, ZIP de exportación e importación siguen sin estar implementados. El servidor no incluye datos demo con el perfil real.
