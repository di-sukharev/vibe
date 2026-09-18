# Локальный PostgreSQL

Используй Docker Compose в Windows, macOS и Linux. Нативная установка допустима только по явному выбору пользователя.

Шаблон использует официальный `postgres:18-alpine`. Major-версия закреплена: обновления патчей не должны случайно менять формат тома. PostgreSQL 18 также нужен схеме Prisma для UUIDv7 через `uuidv7()`.

Для Prisma всегда задавай полный URL `postgresql://user:password@host:port/db?schema=public`, даже при нативной установке. Peer-auth URL без пользователя может вызвать общую ошибку schema engine вместо понятной диагностики соединения.

## Drift после отключения возможности

Если локальная БД уже применила удалённые миграции подписок, `prisma migrate dev` обнаружит оставшиеся таблицы. Подписки сейчас закомментированы; см. `docs/IAP.md`. Включи их снова или сбрось локальную БД, если данные не нужны. Рабочую БД не сбрасывай: создай миграцию удаления.

## Требования

- Windows: Docker Desktop с WSL 2.
- macOS: Docker Desktop или Docker Engine с Compose v2.
- Linux: Docker Engine и плагин Docker Compose.

Из корня репозитория проверь Compose и Docker daemon:

```bash
docker compose version
docker info
```

## Если Docker недоступен

До настройки БД или E2E выполни обе проверки выше. При ошибке:

1. Объясни, что Docker запускает локальный PostgreSQL шаблона. Не предлагай нативную БД.
2. Попроси установить и запустить Docker для ОС пользователя по требованиям выше.
3. Повтори `docker compose version` и `docker info`.
4. Продолжай только после успеха обеих команд. Создай `backend/.env`, затем запусти БД.

Если Docker установить нельзя, локальная работа и проверки с БД заблокированы. Не переходи самовольно на облачную БД или другой локальный PostgreSQL.

Создай файл окружения:

```bash
# macOS, Linux или Git Bash в Windows
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

## Запуск БД разработки

Передавай env backend явно. Compose автоматически ищет его только в корне, где шаблон не хранит файлы окружения.

```bash
docker compose --env-file backend/.env pull postgres
docker compose --env-file backend/.env up -d postgres
docker compose --env-file backend/.env ps postgres
docker compose --env-file backend/.env exec postgres pg_isready -U superuser -d web_app_demo
```

Локальное подключение:

```text
host: localhost
port: 54329
database: web_app_demo
user: superuser
password: superpassword
DATABASE_URL: postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public
```

Примени миграции:

```bash
bun run --cwd backend prisma:deploy
```

При необходимости создай локальные аккаунты из `DEV_SEED_ADMIN_*` и `DEV_SEED_USER_*` в `backend/.env`:

```bash
bun run dev:seed
```

Seed запрещает production и нелокальные URL БД. В ветке `mobile` демопользователь получает локальный доступ к основному экрану без покупки в магазине. Деплой запускает `db:deploy`, а не локальный seed.

## Изменение порта

Если `54329` занят, поменяй `POSTGRES_PORT` и порт в `DATABASE_URL` файла `backend/.env`. Продолжай передавать `docker compose --env-file backend/.env ...`.

## Тестовая БД

`postgres_test` предназначен для integration, Docker smoke и Playwright:

```bash
docker compose --env-file backend/.env up -d postgres_test
```

Ручное подключение по умолчанию:

```text
host: localhost
port: 54330
database: web_app_demo_test
user: superuser
password: superpassword
TEST_DATABASE_URL: postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public
```

Автоматические скрипты выбирают `POSTGRES_TEST_PORT` по репозиторию и формируют `TEST_DATABASE_URL`. Это позволяет запускать копии проекта параллельно. Задавай порт вручную только при необходимости фиксированного значения.

Имя БД должно оканчиваться на `_test`. Integration, smoke и E2E по умолчанию отвергают другие имена, чтобы не менять данные разработки.

## Сброс локальных данных

Остановить контейнеры, сохранив данные:

```bash
docker compose --env-file backend/.env down
```

Следующая команда удаляет локальные данные PostgreSQL. Выполняй её только для намеренного сброса:

```bash
docker compose --env-file backend/.env down -v
```

Смена major-версии PostgreSQL не переносит данные автоматически. Экспортируй и импортируй их либо удали ненужные локальные тома через `docker compose --env-file backend/.env down -v`.

### Если история миграций изменилась

Ошибка `P3018` с `type "user_role" already exists` означает, что БД содержит другую историю миграций. Возможные причины — объединение миграций или работа на другой ветке. Prisma записывает неудачу; следующие запуски возвращают `P3009`.

Для локальной БД с ненужными данными удали тома, затем повтори миграции и seed. Не исправляй историю вручную. Если данные нужны, сначала сохрани их и согласуй удаление.

```bash
docker compose --env-file backend/.env down -v
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend prisma:deploy
bun run dev:seed
```

Переход `mobile` → `master` требует такого же сброса. В mobile есть дополнительные таблицы: `prisma migrate deploy` не видит новых миграций, а `prisma migrate dev` сообщает drift. Переход `master` → `mobile` не требует сброса: mobile добавляет одну миграцию к истории master.

## Официальная документация

- [Docker Compose](https://docs.docker.com/compose/)
- [Официальный образ PostgreSQL](https://hub.docker.com/_/postgres)
- [PostgreSQL](https://www.postgresql.org/docs/)
