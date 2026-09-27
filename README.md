# Forma · seguimiento personal

Aplicación web privada y mobile-first para organizar registros personales de peso y tratamiento. **No diagnostica ni prescribe.** No cambia dosis y no sustituye el criterio de un profesional de salud.

> Esta entrega inicial implementa el cimiento funcional (cuenta, perfil, peso, medicación, dosis, medidas corporales básicas y panel). Fotos privadas, laboratorios, síntomas, actividad, recordatorios y Telegram todavía no están conectados; se incorporarán incrementalmente. La interfaz los identifica como secciones en preparación para no insinuar funcionalidades que aún no existen.

## Arquitectura

```text
Navegador móvil/desktop → React + TypeScript + Vite → FastAPI REST / OpenAPI
                                                  └→ PostgreSQL
```

- **Frontend:** React, TypeScript estricto, Vite, Tailwind, React Router, Recharts y Lucide.
- **Backend:** FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, JWT de corta duración y contraseñas con Argon2.
- **Persistencia:** PostgreSQL. El navegador mantiene el token de acceso únicamente en memoria; no persiste registros médicos en localStorage.
- **Aislamiento:** las consultas de registros siempre se limitan al usuario autenticado. Fechas se normalizan a UTC; el perfil parte de `America/Bogota`.

## Requisitos

- Docker Engine + Docker Compose plugin **o** Node.js 22+, Python 3.11+ y PostgreSQL 16+.

## Docker

1. Copia `.env.example` como `.env`.
2. Sustituye `POSTGRES_PASSWORD` y `SECRET_KEY` por valores aleatorios únicos. No publiques `.env`.
3. Ejecuta `docker compose up --build` desde la raíz.
4. Abre `http://localhost:8080`; la API y OpenAPI están en `http://localhost:8000/docs`.

La base de datos no publica su puerto al host. En despliegue público utiliza HTTPS detrás de un reverse proxy, un dominio/origen CORS explícito, secretos dedicados y almacenamiento/backup cifrado.

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

Vite arranca en `http://localhost:5173`. Para cuentas nuevas la contraseña debe tener al menos 12 caracteres. El perfil inicia con 180 cm, 106 kg y zona `America/Bogota`; la concentración predeterminada de tirzepatida es 10 mg / 0.5 mL y se crea al abrir por primera vez. Las equivalencias se calculan dinámicamente; U-100 es opcional.

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
