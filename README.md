# Forma · seguimiento personal

Aplicación web privada para organizar registros de peso, composición corporal y seguimiento de tratamientos. Puedes usarla desde el navegador del móvil o escritorio, o desplegar una instancia propia.

## ¿Solo quieres usar Forma?

Abre [https://forma.albotero.com](https://forma.albotero.com) para usar la instancia disponible. Crea una cuenta y confirma tu correo; no necesitas clonar este repositorio ni configurar un servidor o dominio propio.

> [!IMPORTANT]
> Forma organiza datos y muestra tendencias descriptivas. No diagnostica, no prescribe ni recomienda iniciar, cambiar o suspender tratamientos.

## ¿Quieres desplegar tu propia instancia?

Sigue las instrucciones de [instalación](#instalar-tu-propia-instancia). Para publicarla en Internet necesitas un dominio que controles y debes configurar DNS, HTTPS, correo y secretos para ese dominio. No uses los valores de ejemplo como si fueran los del autor del proyecto.

## Contenido

- [Qué puedes hacer](#qué-puedes-hacer)
- [Instalar tu propia instancia](#instalar-tu-propia-instancia)
- [Usar la aplicación](#usar-la-aplicación)
- [Telegram](#telegram)
- [Copias de seguridad](#copias-de-seguridad)
- [Desarrollo y pruebas](#desarrollo-y-pruebas)
- [Arquitectura y seguridad](#arquitectura-y-seguridad)

## Qué puedes hacer

| Área               | Uso                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Peso y composición | Registra peso y métricas opcionales de báscula; consulta gráficos de evolución.                  |
| Medidas corporales | Registra cintura, cuello, pecho, abdomen, cadera, brazo y muslo.                                 |
| Seguimiento        | Guarda síntomas, actividad, presión arterial, laboratorios, objetivos y revisiones.              |
| Tratamiento        | Mantén tu lista de medicamentos y registra dosis. La aplicación no sugiere dosis.                |
| Recordatorios      | Crea avisos manuales o usa los checklists automáticos; opcionalmente recibe avisos por Telegram. |
| Fotos              | Guarda imágenes privadas asociadas a tu cuenta.                                                  |
| Datos              | Exporta o restaura los registros de tu cuenta.                                                   |

## Instalar tu propia instancia

### Antes de empezar

| Requisito                                         | Para qué                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| Servidor Linux con Docker Engine y Docker Compose | Ejecutar los servicios.                                                   |
| Dominio propio, por ejemplo `app.example.com`     | Acceder a tu instancia con HTTPS.                                         |
| Registro DNS A/AAAA apuntando al servidor         | Dirigir el dominio al host.                                               |
| Certificado TLS para ese dominio                  | Nginx espera un certificado antes de iniciar HTTPS.                       |
| SMTP                                              | Verificación de correo, cambio de dirección y recuperación de contraseña. |
| Token de Cloudflare                               | La renovación automática incluida usa el desafío DNS de Cloudflare.       |

La configuración no depende de `forma.albotero.com`. Sustituye `app.example.com` por tu propio nombre en todos los pasos. Si tu DNS no está en Cloudflare, adapta el servicio Certbot y su método de renovación antes de desplegar.

Crea un registro DNS A (y AAAA si tu servidor ofrece IPv6) para `app.example.com`, apuntando a la IP pública del servidor. Permite tráfico entrante en los puertos 80 y 443; no abras los puertos de PostgreSQL ni del backend.

### 1. Configura dominio y secretos

Clona el repositorio en el servidor y crea tus archivos locales de configuración:

```sh
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
```

Edita `.env`. `APP_DOMAIN` es solo el hostname; `PUBLIC_APP_URL` y `CORS_ORIGINS` llevan el origen HTTPS completo.

| Variable            | Ejemplo                          | Nota                                                                   |
| ------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `APP_DOMAIN`        | `app.example.com`                | Sin `https://` ni ruta.                                                |
| `PUBLIC_APP_URL`    | `https://app.example.com`        | Debe ser accesible públicamente para correo y Telegram.                |
| `CORS_ORIGINS`      | `https://app.example.com`        | Origen del frontend; sin barra final.                                  |
| `POSTGRES_PASSWORD` | salida de `openssl rand -hex 24` | Valor hexadecimal aleatorio para evitar escapes en la URL de conexión. |
| `SECRET_KEY`        | salida de `openssl rand -hex 32` | Secreto exclusivo; no uses el valor de ejemplo.                        |
| `TIMEZONE`          | `America/Bogota`                 | Zona horaria inicial; cada usuario puede elegir la suya.               |
| `SMTP_*`            | datos de tu proveedor            | Necesario para entregar verificación y recuperación de cuenta.         |

Configura SMTP antes de abrir el registro de cuentas. Una cuenta nueva debe confirmar su correo antes de iniciar sesión.

Para crear el token de Cloudflare, usa permisos de lectura de zona y edición DNS. Guarda las credenciales en `secrets/cloudflare.ini` y protege el archivo:

```ini
dns_cloudflare_api_token = TU_TOKEN_DE_CLOUDFLARE
```

```sh
chmod 600 secrets/cloudflare.ini
```

No subas `.env` ni `secrets/cloudflare.ini` a Git ni los compartas en mensajes.

### 2. Emite el certificado inicial

El Compose de este repositorio **no emite el certificado inicial**: Nginx requiere que ya exista en el volumen Docker `letsencrypt`. El servicio Certbot renueva certificados existentes usando Cloudflare.

Cuando el DNS ya apunte al servidor, ejecuta desde la raíz del repositorio y reemplaza dominio y correo:

```sh
docker compose run --rm --entrypoint certbot certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials /run/secrets/cloudflare.ini \
    --cert-name app.example.com \
    -d app.example.com \
    --agree-tos --non-interactive -m admin@example.com
```

Si ya existe un certificado válido en el volumen `letsencrypt` para el mismo `APP_DOMAIN`, puedes omitir este paso.

### 3. Comprueba y arranca los servicios

Valida la configuración y construye los contenedores:

```sh
docker compose config -q
docker compose up --build -d
docker compose ps
```

El backend aplica las migraciones de base de datos al iniciar. La aplicación quedará en `https://app.example.com`; la documentación OpenAPI está en `/docs`.

Para revisar el arranque:

```sh
docker compose logs -f backend frontend
```

> [!NOTE]
> Solo Nginx publica puertos al host. El backend y PostgreSQL permanecen en redes Docker privadas. No abras ni publiques sus puertos directamente.

### Actualizar una instalación

Después de obtener una versión nueva del código:

```sh
git pull --ff-only
docker compose config -q
docker compose up --build -d
docker compose ps
```

Haz primero una copia de seguridad, especialmente antes de cambios de esquema o actualizaciones mayores.

## Usar la aplicación

### Primera cuenta

1. Abre el dominio que configuraste y crea una cuenta con una contraseña de al menos 12 caracteres.
2. Confirma el correo desde el mensaje de verificación.
3. En **Perfil y ajustes**, revisa zona horaria, altura y peso inicial.
4. Añade una medicación solo si forma parte de tu tratamiento real; la aplicación no crea medicamentos ni indica cantidades automáticamente.
5. Registra datos desde la sección correspondiente. Puedes corregir o eliminar registros propios.

### Secciones principales

| Sección       | Qué registrar                                                                     |
| ------------- | --------------------------------------------------------------------------------- |
| Peso          | Peso, fecha y hora; las métricas de composición son opcionales.                   |
| Composición   | Evolución de métricas estimadas por la báscula.                                   |
| Medidas       | Cintura, cuello, pecho, abdomen, cadera, brazo y muslo.                           |
| Síntomas      | Elementos de tu catálogo, intensidad, tolerancia, hidratación y check-in semanal. |
| Actividad     | Actividad individual o totales semanales de pasos, calorías y distancia.          |
| Laboratorios  | Resultados de laboratorio y presión arterial.                                     |
| Medicación    | Medicamentos activos/archivados e historial de dosis.                             |
| Análisis      | Tendencias descriptivas y checklists contextuales.                                |
| Recordatorios | Recordatorios manuales y automáticos.                                             |

### Checklists y recordatorios

Los checklists muestran si hay datos registrados en el periodo; **no validan vigencia ni idoneidad clínica**.

| Frecuencia                   | Elementos orientativos                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Diario                       | Peso.                                                                                                                                         |
| Semanal                      | Dosis (si hay medicación activa), presión arterial, síntomas y tolerancia, apetito y saciedad, hidratación, actividad y composición corporal. |
| Cada 4 semanas               | Tendencia de peso, medidas corporales, fotos, síntomas, tratamiento y objetivos cuando correspondan.                                          |
| Según indicación profesional | Laboratorios y revisiones clínicas.                                                                                                           |

Los recordatorios automáticos se crean aunque todavía no exista un registro de referencia, salvo el de dosis, que requiere una medicación activa. Cuando hay un registro, el siguiente aviso se calcula desde su fecha. Se envían a la hora local configurada en el perfil (05:00 por defecto). Puedes activarlos o desactivarlos, pero no editar su texto ni eliminarlos.

Los recordatorios manuales permiten elegir fecha, hora y repetición. Las notificaciones del navegador requieren permiso y que la aplicación esté abierta; no son notificaciones push.

### Cuenta y privacidad de datos

- Las cuentas nuevas requieren verificación de correo. Los enlaces de verificación vencen a las 24 horas; los de recuperación de contraseña, a los 30 minutos.
- Exportar/restaurar está en **Perfil y ajustes → Exportar y restaurar datos**. La restauración reemplaza los datos de esa cuenta, acepta solo una exportación del mismo correo y revoca sesiones y la vinculación con Telegram.
- Fotos admitidas: JPEG, PNG y WebP, hasta 10 MB. Se guardan fuera del directorio público y solo se sirven mediante la API autenticada.
- Los datos de salud son sensibles. Protege la cuenta, el servidor y las copias de seguridad.

## Telegram

Telegram es opcional. Para habilitarlo, configura `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` y un `TELEGRAM_WEBHOOK_SECRET` aleatorio en `.env`, y usa una `PUBLIC_APP_URL` pública con HTTPS. Al iniciar el backend se registra el webhook. Telegram debe poder acceder a:

```text
https://app.example.com/api/telegram/webhook
```

Vincula el chat privado desde **Recordatorios → Vincular Telegram**. Solo se procesan comandos explícitos en el chat privado vinculado. `/ayuda` muestra la lista.

| Comando         | Ejemplo                                    | Resultado                                                      |
| --------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `/peso`         | `/peso 82.35`                              | Registra peso en kg.                                           |
| `/composicion`  | `/composicion 82.35 grasa=24.5 agua=50`    | Registra peso y uno o más campos de composición.               |
| `/medidas`      | `/medidas cintura=90 cuello=38 cadera=100` | Registra una o más medidas en cm.                              |
| `/cintura`      | `/cintura 90`                              | Atajo compatible para registrar cintura.                       |
| `/sintoma`      | `/sintoma 5 náuseas`                       | Registra un síntoma con intensidad de 0 a 10.                  |
| `/presion`      | `/presion 120/80`                          | Registra sistólica y diastólica en mmHg.                       |
| `/dosis`        | `/dosis 2.5`                               | Registra lo indicado si hay exactamente un medicamento activo. |
| `/recordatorio` | `/recordatorio AAAA-MM-DD HH:MM texto`     | Crea un aviso futuro en la hora local del perfil.              |

Campos aceptados por `/composicion`:

| Campo                                                          | Unidad / rango máximo  |
| -------------------------------------------------------------- | ---------------------- |
| `grasa`, `grasa_subcutanea`, `musculo_esqueletico`, `proteina` | Porcentaje, 0–100      |
| `masa_libre`, `masa_muscular`                                  | kg, hasta 500          |
| `grasa_visceral`                                               | Índice, hasta 1000     |
| `agua`                                                         | Porcentaje, 0–100      |
| `masa_osea`                                                    | kg, hasta 100          |
| `metabolismo_basal`                                            | kcal, hasta 20000      |
| `edad_metabolica`                                              | Años, entero hasta 150 |

El peso es obligatorio para `/composicion`, porque la base de datos guarda estas métricas en una lectura de peso. Todos los campos adicionales son opcionales; puedes usar espacios o punto y coma para separarlos y `=` o `:` entre nombre y valor.

El bot comprueba mensajes cada 30 segundos y omite recordatorios con más de dos minutos de retraso. Los avisos que vencen a la vez se agrupan. El botón **Ya lo cumplí** confirma el aviso y permite enviar el dato por el chat. Mantén una sola réplica del backend: un reinicio durante un envío puede ocasionar una repetición.

## Copias de seguridad

La exportación desde la app no sustituye las copias del servidor. Guarda tanto PostgreSQL como `storage/`, que contiene las fotos.

Con los valores predeterminados (`tracker`), crea una copia de la base así:

```sh
docker compose exec -T postgres pg_dump -U tracker tracker > backup.sql
```

Restaura sobre una base vacía:

```sh
docker compose exec -T postgres psql -U tracker tracker < backup.sql
```

Si cambiaste `POSTGRES_USER` o `POSTGRES_DB`, sustituye los valores del comando. Cifra las copias fuera del servidor y prueba la restauración periódicamente. No almacenes `backup.sql` ni fotos en un directorio público.

## Desarrollo y pruebas

### Vista previa local

`scripts/local-preview.sh` inicia una vista previa que ya debe estar preparada. Requiere `.venv/bin/python`, `storage/local-preview/preview.sqlite` y `frontend/.env.development.local`; aplica migraciones, inicia FastAPI en `http://127.0.0.1:8000` y Vite en `http://127.0.0.1:5173`. La base y las fotos se conservan bajo `storage/local-preview/`. El script no crea usuarios, credenciales ni datos de demostración. Detén ambos procesos con Ctrl+C.

### Entorno de desarrollo

Requisitos: Node.js 22 o superior, Python 3.11 o superior y PostgreSQL 16 o superior. Para backend con PostgreSQL local, configura `.env` y arranca la base:

```sh
docker compose up -d postgres
```

Desde `backend/`, crea el entorno e inicia la API:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]' alembic
export DATABASE_URL='postgresql+psycopg://tracker:TU_PASSWORD@localhost:5432/tracker'
export SECRET_KEY="$(openssl rand -hex 32)"
alembic upgrade head
uvicorn app.main:app --reload
```

En otra terminal, desde `frontend/`:

```sh
npm install
cp .env.example .env
npm run dev
```

Vite usa `http://localhost:5173` y envía `/api` al backend en `http://localhost:8000`. Para correo, añade la configuración SMTP al entorno del backend.

### Migraciones y pruebas

El contenedor backend ejecuta `alembic upgrade head` al iniciar. Para crear una migración durante el desarrollo, desde `backend/`:

```sh
alembic revision --autogenerate -m "descripcion"
```

Revisa siempre el archivo generado antes de aplicarlo. Ejecuta las verificaciones desde la raíz:

```sh
(cd backend && pip install -e '.[dev]' alembic && pytest)
(cd frontend && npm test && npm run build && npm run lint)
```

## Arquitectura y seguridad

```text
Navegador
    │ HTTPS
    ▼
Nginx / frontend ── /api por red privada ──> FastAPI ──> PostgreSQL
                                                                └──────> storage/ (fotos)
```

| Componente    | Tecnología / responsabilidad                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | React, TypeScript, Vite, Recharts y Lucide.                                                                                                   |
| Backend       | FastAPI, Pydantic 2, SQLAlchemy 2 y Alembic. API bajo `/api`; OpenAPI en `/docs`.                                                             |
| Base de datos | PostgreSQL 16; registros separados por cuenta.                                                                                                |
| Sesión        | JWT de acceso en memoria y refresh token rotatorio en cookie `Secure`, `HttpOnly`, `SameSite=Strict`; las sesiones se revocan en el servidor. |
| Contraseñas   | Hash con Argon2.                                                                                                                              |

- No se incluyen analytics externos.
- Nginx sobrescribe `X-Real-IP`; no expongas el backend ni PostgreSQL directamente.
- Se aplican límites a rutas sensibles, pero la protección frente a fuerza bruta distribuida aún no está implementada.
- Telegram requiere un webhook HTTPS público. Si la instancia es solo para LAN, no habilites Telegram sin un túnel o proxy seguro para esa ruta.
- Las fotos, `.env`, tokens, credenciales SMTP/Cloudflare y copias de seguridad deben mantenerse privadas.
- Las métricas de composición son estimaciones de báscula. Revisa resultados y decisiones de tratamiento con un profesional de salud.
