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
2. Este despliegue utiliza el certificado SSL ya emitido para `APP_DOMAIN`; debe estar disponible en el volumen Docker `letsencrypt`, que Nginx monta en `/etc/letsencrypt`. No es necesario emitir un certificado nuevo para instalar o actualizar la aplicación. El servicio Certbot renueva el certificado existente y requiere que la credencial de Cloudflare de renovación ya esté configurada en `secrets/cloudflare.ini`; no la guardes en Git.
3. Ejecuta `docker compose up --build -d` desde la raíz. Nginx sirve HTTPS en el puerto 443 y redirige HTTP a HTTPS.
4. Abre `https://forma.albotero.com`; la API se sirve en el mismo origen bajo `/api` y OpenAPI está en `/docs`.

Solo el frontend publica HTTP/HTTPS al host. Nginx reenvía `/api` al backend por una red privada; ni la API ni la base de datos publican puertos directamente. El backend tiene una red de salida para conectar con servicios externos como Telegram. Sin Telegram, puedes limitar HTTPS a la LAN. **Los webhooks de Telegram requieren que `PUBLIC_APP_URL/api/telegram/webhook` sea accesible desde los servidores de Telegram por HTTPS**; el Compose de este repositorio no configura un túnel. Si el sitio debe seguir siendo LAN-only, configura por separado un túnel/reverse proxy seguro para esa ruta; no expongas directamente backend ni PostgreSQL. No publiques `.env` ni `secrets/cloudflare.ini`.

## Módulos de seguimiento

- **Composición:** cada lectura de peso acepta opcionalmente grasa corporal, masa libre de grasa, grasa subcutánea, índice de grasa visceral, agua corporal, músculo esquelético, masa muscular, masa ósea, proteína, metabolismo basal y edad metabólica. Son estimaciones reportadas por la báscula; se guardan junto con el peso, la fecha/hora, y pueden editarse o borrarse.
- **Síntomas, objetivos y laboratorios:** catálogos personales permiten seleccionar varios elementos al registrar; síntomas y objetivos admiten intensidad de 0 a 10. Presión arterial está incluida como prueba protegida y guarda sistólica, diastólica y su media calculada. La app muestra gráficos de evolución para cada prueba.
- **Medidas, actividad, revisiones y recordatorios:** registros con fecha/hora, campos relevantes, notas y operaciones de edición/eliminación. Actividad grafica los totales semanales de pasos, kcal y km en series con escalas independientes.
- **Fotos:** cargas privadas JPEG/PNG/WebP de hasta 10 MB, aisladas por usuario, con descripción y fecha editable.
- **Medicación e historial:** permite añadir/editar concentraciones, archivar o reactivar medicamentos y editar/eliminar dosis; archivar conserva el historial relacionado. Las cuentas nuevas empiezan sin medicamentos; cada persona registra solo los tratamientos que usa.
- Los recordatorios manuales y automáticos aparecen en Recordatorios; Historial solo muestra registros realizados y excluye los recordatorios. Los manuales respetan la fecha y hora elegidas y permiten cambiar su repetición (no repetir, diario, semanal o mensual). Los automáticos tienen frecuencia fija: dosis (una semana después de la última dosis de una medicación activa), peso (un día), presión arterial (una semana después del último resultado registrado), composición corporal (un mes después de una lectura que incluya composición) y medidas corporales (un mes después de la última medición). Se programan a la hora local configurada en Perfil y ajustes (05:00 por defecto), no a la hora del último registro; el aviso indica la fecha y hora de ese registro anterior. La hora y zona horaria son configurables por cuenta. Los automáticos se pueden activar/desactivar, pero no editar ni borrar. Si varios vencen juntos y Telegram está vinculado, se agrupan en un mensaje; el botón **Ya lo cumplí** los marca como realizados y pregunta si quieres enviar el dato por el chat. Cada usuario vincula su chat privado con un enlace de un solo uso que caduca en 15 minutos.
- **Notificaciones:** el centro bajo la campana muestra recordatorios vencidos y avisos de checklist para el peso diario y la confirmación de medicamentos activos. Se pueden activar notificaciones nativas del navegador desde Perfil y ajustes. Requieren permiso y que la app esté abierta; la preferencia y los IDs ya avisados se guardan en ese navegador. No son notificaciones push y no llegan cuando la app está cerrada. Para avisos fuera de la app, usa Telegram.
- **Análisis y seguimiento:** reúne checklists contextuales previos al inicio, semanales, cada cuatro semanas y periódicos. El estado solo indica si hay datos guardados; no valida su vigencia ni la idoneidad clínica. Los resúmenes de dosis describen el tiempo desde los registros disponibles, tendencia de peso y tolerancia/síntomas documentados; nunca indican subir, bajar, iniciar o suspender dosis.

Las sesiones se restauran mediante un refresh token aleatorio almacenado como hash en la base de datos. El navegador solo recibe la cookie segura; los refresh tokens rotan y el cierre de sesión revoca la sesión del servidor.

## Desarrollo local

**PostgreSQL local** (desde la raíz del workspace, después de configurar `.env`):

```sh
docker compose up -d postgres
```

El servicio crea la base y el usuario indicados por `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`. Configura `DATABASE_URL` del backend con esos mismos valores y `localhost:5432`; no uses la contraseña de ejemplo en un entorno real.

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
cd frontend && npm test && npm run build && npm run lint
```

Las pruebas backend cubren cálculos, aislamiento de cuentas, exportación/restauración de datos, recuperación de contraseñas, migraciones, recordatorios y Telegram. Las pruebas frontend cubren conversiones de fecha/hora y las reglas de elegibilidad, destino y deduplicación de notificaciones.

## Privacidad y seguridad

- API protegida con token JWT de expiración corta y Argon2id para contraseñas.
- Límite de solicitudes por dirección de cliente para registro e inicio de sesión (10/min), confirmación de correo y recuperación (10/h), reenvío de verificación, solicitud de recuperación y cambio de correo (5/h), cambio de contraseña (5/min). Nginx sobrescribe `X-Real-IP`; no expongas el backend directamente. Al escalar, configura un almacenamiento compartido para los límites.
- El token de acceso solo vive en memoria; al recargar, la app intenta restaurar la sesión con la cookie segura y rotatoria de refresh. Los registros se guardan en PostgreSQL; solo preferencias de notificaciones e IDs de avisos ya mostrados se guardan en el almacenamiento local del navegador.
- No hay analytics externos. Telegram usa un bot configurado por el administrador, vinculación individual de un solo uso y secreto verificado para el webhook. Los avisos incluyen el título y, para los automáticos, la fecha/hora del registro anterior; evita incluir información médica sensible en títulos o datos enviados al chat.
- Los enlaces de recuperación se envían por SMTP, vencen en 30 minutos, se almacenan como hash y se consumen una sola vez. El cambio de contraseña incrementa la versión de autenticación y revoca tokens de acceso y sesiones persistentes.
- Las cuentas nuevas deben confirmar por correo antes de iniciar sesión; los enlaces de verificación vencen en 24 horas y son de un solo uso. El cambio de correo conserva la dirección actual hasta confirmar la nueva y luego revoca las sesiones.
- Las fotos se guardan en el volumen local `./storage`, fuera del directorio público y protegidas por la API autenticada. Restringe el acceso al host y cifra las copias fuera del servidor.
- Limita el acceso de red, usa HTTPS, rota secretos, actualiza dependencias y limita intentos mediante proxy/WAF antes de exponer el servicio públicamente. La protección contra fuerza bruta distribuida aún no está implementada.

## Recuperar acceso

Configura SMTP en `.env` para habilitar verificación de cuenta, cambio de correo y **¿Olvidaste tu contraseña?**. Las cuentas nuevas deben verificar su correo antes de iniciar sesión. En Perfil y ajustes se puede solicitar un cambio de correo, que solo se aplica después de confirmar el enlace enviado a la nueva dirección. El ejemplo usa `mail.albotero.com`, STARTTLS en el puerto `587` y `noreply-forma@albotero.com` como remitente. Si el servidor requiere autenticación, establece `SMTP_USERNAME` y `SMTP_PASSWORD` localmente; no guardes la contraseña en Git. Para SSL implícito usa el puerto `465` con `SMTP_USE_SSL=true`. En producción, `PUBLIC_APP_URL` debe ser la URL HTTPS pública. Para una prueba local, configúrala solo en el proceso backend como `http://localhost:5173` para que el enlace abra el frontend local; no uses esa dirección en producción. Los endpoints quedan deshabilitados si falta el host, remitente o URL pública. Las respuestas de reenvío no revelan si el correo está registrado; los enlaces usan un fragmento URL para que el token no se envíe en solicitudes HTTP ni aparezca en los logs del servidor.

## Copias de seguridad

Desde **Perfil y ajustes → Exportar y restaurar datos** puedes descargar un archivo ZIP versionado con el perfil, registros, catálogos y fotos. Antes de importar, la app valida la estructura y muestra un resumen; la restauración reemplaza los datos de la cuenta autenticada y solo acepta copias del mismo correo. Se revocan las sesiones y hay que volver a vincular Telegram; las preferencias locales de notificaciones no forman parte del archivo. Trata las copias como datos médicos sensibles.

La exportación de la app no sustituye respaldos automáticos del servidor. Para desarrollo, `docker compose exec -T postgres pg_dump -U tracker tracker > backup.sql`; restauración sobre una base vacía: `docker compose exec -T postgres psql -U tracker tracker < backup.sql`. Los respaldos del servidor también deben incluir `./storage`, cifrarse fuera del host y probarse mediante restauraciones periódicas.

## Configurar Telegram

1. Crea un bot con BotFather y establece `TELEGRAM_BOT_TOKEN` y el nombre sin `@` en `TELEGRAM_BOT_USERNAME` dentro de `.env`. No añadas el token al repositorio ni a mensajes.
2. Genera un secreto aleatorio exclusivo para `TELEGRAM_WEBHOOK_SECRET`; no lo publiques ni lo reutilices. Configura `PUBLIC_APP_URL` como la URL HTTPS pública de la aplicación.
3. Asegura que el backend tenga salida HTTPS a `api.telegram.org` y que la URL pública del webhook llegue por HTTPS a Nginx. Ejecuta `docker compose up --build -d`. Al arrancar, el backend registra el webhook y aplica `alembic upgrade head`.
4. En Recordatorios, el usuario elige **Vincular Telegram**, abre el enlace y pulsa **Iniciar** en el bot. Los avisos vencidos a la misma hora se agrupan en un mensaje e incluyen el botón **Ya lo cumplí**. Al pulsarlo, el bot guarda el cumplimiento y pregunta si quieres registrar el dato por el chat; al confirmar, muestra los comandos aplicables. Para recordatorios manuales recurrentes, la siguiente fecha se programa automáticamente.
5. Desde el chat privado vinculado también se pueden guardar registros usando `/peso 82.35`, `/dosis 2.5`, `/cintura 90`, `/sintoma 5 náuseas`, `/presion 120/80` o `/recordatorio 2026-09-28 08:00 Texto`. `/ayuda` muestra la lista. El registro de dosis solo se acepta si hay exactamente un medicamento activo; el bot guarda lo que la persona indica y no sugiere cantidades.

El envío periódico se ejecuta cada 30 segundos dentro del backend. Se omiten avisos con más de dos minutos de retraso para no enviar notificaciones antiguas después de una caída. Mantén una sola réplica del backend; aunque la fila se bloquea durante la reclamación, Telegram y PostgreSQL no comparten una transacción y un reinicio justo durante un envío aún puede producir una repetición. Al escalar, sustituye el sondeo por una cola/worker con idempotencia distribuida. Los recordatorios manuales únicos se desactivan tras enviarse; los automáticos conservan su política de frecuencia. El botón permite confirmar el cumplimiento y, opcionalmente, abrir la captura de datos por chat. Solo se procesan comandos explícitos en el chat privado ya vinculado; otros mensajes no se guardan. Seed de datos ficticios, fotos, ZIP de exportación e importación siguen sin estar implementados. El servidor no incluye datos demo con el perfil real.
