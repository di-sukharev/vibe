# Backend

Backend управляет API, входом, интеграциями, хранением данных и серверной бизнес-логикой. Web и mobile используют общие контракты из `packages/contracts`.

## Стек

Bun, Hono, Prisma 7, PostgreSQL, Zod, jose JWT и TypeScript.

## Команды

Из корня репозитория:

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
docker compose --env-file backend/.env pull postgres
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend dev
bun run --cwd backend typecheck
bun run --cwd backend test
bun run --cwd backend test:unit
bun run --cwd backend test:integration
bun run --cwd backend test:unit -- src/modules/auth/password-reset-cooldown.test.ts -t "outbox retry"
bun run --cwd backend test:integration -- src/db.integration.test.ts -t "different jobs"
bun run --cwd backend start:api
bun run --cwd backend start:worker
bun run --cwd backend start:worker:notifications
bun run --cwd backend start:scheduler
bun run --cwd backend start:cron -- noop
bun run --cwd backend start:cron -- notifications:process
bun run --cwd backend smoke:docker
bun run --cwd backend prisma:validate
bun run --cwd backend prisma:generate
bun run --cwd backend prisma:migrate
bun run --cwd backend prisma:deploy
bun run --cwd backend prisma:seed
bun run --cwd backend db:deploy
```

В PowerShell вместо `cp` используй `Copy-Item backend/.env.example backend/.env`. Из корня также доступны `bun run dev:backend`, `bun run build:backend`, `bun run typecheck:backend` и `bun run test:backend`.

`test:unit` и `test:integration` принимают точные найденные пути относительно `backend/` и фильтр имени Bun `-t`. Без фильтров запускается весь набор.

`bun run test:integration` запускает `postgres_test` из `../docker-compose.yml`, применяет миграции к `web_app_demo_test` и выполняет выбранные тесты. Каждый запуск получает отдельный Compose-проект. Блок `finally` удаляет только его сервис, именованный том и сеть, в том числе после частичной ошибки запуска.

- `TEST_KEEP_DOCKER=1` сохраняет эти ресурсы для диагностики.
- Для внешнего Docker задай вместе `TEST_SKIP_DOCKER=1` и `TEST_DATABASE_URL`. В этом режиме скрипт не меняет Docker-ресурсы.
- Имя БД должно оканчиваться на `_test`. Исключение требует явного `TEST_ALLOW_NON_TEST_DATABASE=1`.

`bun run smoke:docker` собирает Docker-образ backend, запускает его с `postgres_test`, ждёт `/health/ready` и удаляет только свой smoke-контейнер.

## Переменные окружения

Скопируй `backend/.env.example` в `backend/.env`. Для ручных команд Compose передавай `docker compose --env-file backend/.env ...`.

| Переменная | Локальный сервис | БД | Пользователь / пароль | Порт |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | `postgres` | `web_app_demo` | `superuser` / `superpassword` | `54329` |
| `TEST_DATABASE_URL` | `postgres_test` | `web_app_demo_test` | `superuser` / `superpassword` | `54330` при ручном запуске |

Это публичные локальные значения из [инструкции PostgreSQL](../docs/LOCAL_DATABASE.md). Автоматические тесты могут выбрать порт по репозиторию, чтобы копии проекта не конфликтовали.

Всегда указывай имя и пароль в URL Prisma, даже для локального нативного PostgreSQL. URL без пользователя с peer-auth может вызвать непонятную ошибку schema engine в `migrate dev`, `migrate deploy` и `db push`.

Локальный `JWT_SECRET` содержит не менее 32 символов. Production принимает шестнадцатеричный результат `openssl rand -hex 32` длиной от 64 символов. Не используй заглушку `.env.example`, повторяющиеся символы или фразы.

`bun run prisma:seed` создаёт локального администратора и обычного пользователя без подписки или premium-доступа. Из корня доступна команда `bun run dev:seed`. Нужны пары email/пароль `DEV_SEED_ADMIN_*` и `DEV_SEED_USER_*` в `backend/.env`. Команда запрещает `NODE_ENV=production` и нелокальный URL PostgreSQL.

При повторе seed сохраняет хеши неизменённых паролей, сессии и push-регистрации. Если пароль изменён, команда обновляет Argon2id-хеш и отзывает прежние права auth и push. Публичные демопароли нельзя использовать в production.

Production использует отдельную команду `bun run db:deploy`. Она:

1. До Prisma проверяет владельцев объектов БД.
2. Применяет миграции и убирает опасные права `PUBLIC` в обоих облаках.
3. Возвращает отдельной runtime-роли DigitalOcean только DML-права.
4. При необходимости создаёт первого администратора из пары `ADMIN_SEED_EMAIL` и `ADMIN_SEED_PASSWORD`.
5. Требует хотя бы одного администратора с паролем для входа.

Пароль первого администратора должен содержать 12–128 символов. Пустые значения, известные заглушки и повторяющиеся шаблоны запрещены. Production не создаёт локального демопользователя или premium-доступ.

Для локального HTTP подходит `COOKIE_SECURE=false`. Production требует `COOKIE_SECURE=true`, refresh-cookie `SameSite=None; Secure` и точные HTTPS-origin в `CORS_ORIGINS`. Пустые значения, wildcard, HTTP и URL с путём запрещены. В cookie-режиме production операции `register`, `login`, `refresh` и `logout` также требуют доверенный `Origin`.

`WEBAPP_ORIGIN` задаёт origin приложения для ссылок, например сброса пароля. По умолчанию это первый `CORS_ORIGINS`.

Общая функция `createEmailDelivery` в `src/email` создаёт доставку для API и `outbox:drain`. `EMAIL_DELIVERY` выбирает `disabled`, `console`, `postbox` или `resend`. Без переменной схема выбирает `disabled`; локальный `.env.example` задаёт `console`, чтобы печатать ссылки сброса. Production запрещает `console`. При `disabled` запрос сброса возвращает обычный общий ответ, но не создаёт токен или задачу. Провайдеры, ошибки и проверки описаны в [docs/EMAIL.md](../docs/EMAIL.md).

Auth, IAP и webhooks имеют отдельные лимиты тела и частоты запросов. `AUTH_BODY_LIMIT_BYTES` ограничивает auth. `INGRESS_RATE_LIMIT_PROVIDER=local` включает локальные лимиты фиксированных окон. `yandex-sws` допустим только после замены этих лимитов описанной политикой Smart Web Security на границе сети. При `TRUST_PROXY=false` адрес берётся из соединения Bun. За доверенным прокси задай `TRUST_PROXY=true` и его `TRUSTED_PROXY_CLIENT_IP_HEADER`. Используй `TRUSTED_PROXY_CLIENT_IP_POSITION=last` только если провайдер дописывает клиента в конец цепочки. App Platform использует `do-connecting-ip`; описанный путь Yandex — последнее значение `X-Forwarded-For`.

`RATE_LIMIT_STORE` выбирает счётчики:

- `memory` — таблица одного процесса, до 10 000 ключей. Подходит, когда все запросы принимает один API-процесс.
- `database` — PostgreSQL, один upsert на ограничиваемый запрос через `src/rate-limit`. Все экземпляры делят лимит. Terraform включает этот режим для Yandex Serverless Containers.

`rate_limit_buckets` хранит адрес клиента или ID пользователя для каждого окна. Это временные персональные данные. Число строк не ограничено, как в memory-режиме. Отработанные окна удаляет auth-очистка в `maintenance:process` каждые 15 минут. Для `database` обязательно запускай scheduler; без него данные накапливаются. См. [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

`REFRESH_TOKEN_TTL_DAYS` задаёт продлеваемый срок refresh-токена. `SESSION_ABSOLUTE_TTL_DAYS` ограничивает весь срок логической сессии. `REFRESH_REUSE_GRACE_SECONDS` допускает краткую гонку refresh, по умолчанию 10 секунд. Повтор более старого токена семейства после этого окна отзывает сессию. Не увеличивай окно без необходимости.

Расписание запускает `maintenance:process`. Auth-очистка удаляет отозванные и просроченные сессии после `SESSION_RETENTION_DAYS`, истёкшие токены сброса и окна лимитов. Maintenance также удаляет содержимое завершённых уведомлений и после включения подписок выполняет ограниченную сверку Google Play.

Социальный вход выключен: маршруты и кнопки не подключены. Настраивай Apple/Google ID при включении по [SOCIAL_AUTH.md](../docs/SOCIAL_AUTH.md). Expo Push требует настройки EAS и ключей провайдеров. API регистрирует установки и ставит сообщения в очередь; `notifications:process` или `start:worker:notifications` отправляет их и проверяет receipts. Нативные подписки также выключены: включи или удали всю возможность по [IAP.md](../docs/IAP.md).

Приватное файловое хранилище включено по умолчанию: `PRIVATE_STORAGE_DRIVER=filesystem`, каталог `backend/.storage`. Само хранилище не требует облака или Docker. Для локального S3 используй `bun run storage:local:start` и драйвер `s3`; он же работает с реальным бакетом. Production запрещает filesystem. Контракт загрузок — в [docs/STORAGE.md](../docs/STORAGE.md).

## Точки запуска

У backend одна Prisma-схема и один Dockerfile, но несколько процессов:

- API: `bun run start:api`, файл `src/index.ts`.
- Задания: общий реестр `src/jobs.ts`. Включены `noop`, `db:ping`, `auth:sessions:cleanup`, `uploads:pending:cleanup`, `outbox:drain`, `notifications:process` и `maintenance:process`; см. [docs/BACKGROUND_JOBS.md](../docs/BACKGROUND_JOBS.md).
- Cron: `bun run start:cron -- <job>`, файл `src/cron.ts`. CLI выполняет одно задание и завершается. Yandex запускает тот же исполнитель по HTTP; ошибка задания возвращает non-2xx таймеру.
- Scheduler: `bun run start:scheduler`, файл `src/scheduler.ts`. Хранит расписание в репозитории. `bun run dev` запускает его рядом с API, поэтому письма уходят без второго терминала.
- Worker: `bun run start:worker`, файл `src/worker.ts`. Нужен для циклов чаще раза в минуту. По умолчанию пуст; не деплой пустой процесс, иначе он будет постоянно перезапускаться.

`src/job-schedules.json` задаёт task outbox и push каждую минуту, очистку загрузок каждый час, общее обслуживание auth/уведомлений каждые 15 минут. Terraform создаёт соответствующий production-исполнитель.

Все процессы используют `src/runtime.ts` для env, Prisma и завершения работы. Фоновые процессы используют `createBackgroundRuntime`, который не получает ключ подписи API. Не дублируй схему или подключение к БД.

Первичные ключи — UUIDv7, которые создаёт PostgreSQL: `@default(dbgenerated("uuidv7()")) @db.Uuid`. Используй UUIDv7 и для новых ключей, и для ссылок на них. Не вводи `cuid()`, `uuid()`, `serial` или `bigserial`. Для этой схемы везде нужен PostgreSQL 18+, включая raw SQL, импорт и запись без Prisma.

## API push-уведомлений

- `POST /api/notifications/push-token` регистрирует разрешённое поколение установки.
- `POST /api/notifications/push-token/unregister` оставляет неактивную запись с новым поколением.
- `POST /api/notifications/test-push` ставит ограниченное тестовое сообщение только при `ENABLE_TEST_PUSH=true`.

Очередь надёжная, доставка через границу отправки/ticket Expo — как минимум один раз. Переходы по ссылкам и эффекты уведомлений должны быть идемпотентными.

`bun run start:worker:notifications` непрерывно обрабатывает push и receipts с корректной отменой при завершении. Минутного задания `notifications:process` достаточно, если меньшая задержка не нужна.

## Деплой

Инфраструктура находится в [infra](../infra/README.md). Следуй [общей инструкции](../docs/DEPLOYMENT.md), затем выбранному в `CHECKLIST.md` провайдеру: [DigitalOcean](../docs/DIGITALOCEAN.md) или [Yandex Cloud](../docs/YANDEX_CLOUD.md).

`bun run release -- <provider>` собирает `backend/Dockerfile`, требует успешный `db:deploy`, запускает API и задания, затем проверяет готовность. Не коммить секреты в tfvars или backend-конфигурации.

Для старой БД сначала выполни `bun run db:adopt-owner`: команда только показывает владельцев public-схемы. Подтверждение и `-- --apply` описаны в [инструкции](../docs/DEPLOYMENT.md). Обычный деплой не передаёт владение автоматически.

## API входа и аккаунтов

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/token/register`
- `POST /api/auth/token/login`
- `POST /api/auth/token/social/apple` — только при включённом социальном входе
- `POST /api/auth/token/social/google` — только при включённом социальном входе
- `POST /api/auth/token/refresh`
- `POST /api/auth/token/logout`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`
- `PATCH /api/users/me`
- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId/role`
- `GET /openapi.json`
- `GET /health/live`
- `GET /health/ready`

`GET /health/live` проверяет только ответ процесса. `GET /health/ready` выполняет `SELECT 1` и возвращает `200` или `503`. Этот маршрут не ограничивает частоту запросов, но объединяет параллельные проверки и хранит результат одну секунду. Изменение доступности БД видно в пределах секунды.

`GET /api/admin/users` имеет отдельный лимит по ID администратора: по умолчанию 120 запросов за 60 секунд через `ADMIN_USERS_READ_RATE_LIMIT_*`. Его делят все сессии и фильтры поиска администратора. Лимит не расходует бюджет изменений аккаунта. Хранилище общее с auth; при `RATE_LIMIT_STORE=database` бюджет един для всех процессов.

Пароли хеширует `Bun.password` через Argon2id. Короткие access JWT создаёт `jose`. Первый refresh-токен случаен. При ротации следующий непрозрачный токен выводится через HMAC с серверным секретом и отдельным доменом. Поэтому конкурентные запросы с одним токеном получают одного преемника. БД хранит только SHA-256-хеши текущего и предыдущего токенов.

Refresh атомарно меняет токен в той же логической сессии. Действующий access-токен соседней вкладки сохраняется. Повтор предыдущего refresh-токена после окна гонки отзывает сессию как потенциально скомпрометированную.

Сброс пароля использует случайный 32-байтовый токен на 30 минут; БД хранит только SHA-256-хеш. При настроенной почте запрос сначала фиксирует задачу `auth:password-reset` по переданному адресу, затем возвращает общий ответ. Поиск аккаунта, создание токена и отправка идут позже в `outbox:drain`. Ответ не раскрывает существование аккаунта.

Очередь ограничена объёмом одного прохода drain. При заполнении новые запросы получают тот же ответ без задачи для любых адресов. Принятая задача переживает потерю процесса и повторяет временные ошибки. Поэтому остановка drain требует уведомления: при полной очереди и отсутствии обработки новые запросы теряются.

Постоянная ошибка доставки или исчерпание повторов аннулирует неотправленный токен до завершения задачи. Допускается один токен на аккаунт в минуту. Успешное подтверждение атомарно меняет Argon2id-хеш, погашает все токены сброса, отзывает все сессии и удаляет refresh-cookie. Автоматического входа нет.

Ссылка хранит токен во фрагменте URL: он не попадает в первый HTTP-запрос или referrer. Истёкшие токены удаляет auth cleanup. Контракты доставки и повторов — в [EMAIL](../docs/EMAIL.md) и [BACKGROUND_JOBS](../docs/BACKGROUND_JOBS.md).

Новые аккаунты с паролем или социальным входом получают роль `user`; клиент не задаёт роль. `UserDto` содержит текущую роль `user | admin`, access JWT — нет. Каждый авторизованный запрос читает сессию и пользователя из PostgreSQL. Поэтому смена роли действует сразу. Все `/api/admin/*` используют серверную проверку `403 FORBIDDEN`.

Модуль users управляет профилем, безопасным списком администратору, счётчиками и ролями. Смена роли сериализована в PostgreSQL. Нельзя понизить себя или оставить систему без администратора. При реальной смене роли отзываются все сессии пользователя.

Смена роли, bootstrap и выдача сессии существующему аккаунту используют общую блокировку по пользователю. До записи сессии login повторно читает пользователя и проверяет пароль. Список администратора возвращает только `id`, `email`, `displayName`, `role` и `createdAt`.

## Архитектура

`src/index.ts` запускает API. `src/runtime.ts` создаёт окружение и Prisma для всех процессов. `src/app.ts` связывает зависимости.

Контексты находятся в `src/modules/<context>` и доступны друг другу только через `index.ts`. Auth управляет входом и текущим пользователем; users — профилями, списком пользователей и политикой ролей.

- `transport`: Hono и HTTP.
- `application`: сценарии и порты.
- Необязательный `domain`: чистые бизнес-правила.
- `infrastructure`: Prisma, токены и пароли.

Фабрики маршрутов получают зависимости через замыкания. Контекст запроса содержит только авторизованного пользователя. Проверяй границы командой `bun run architecture:check`.

`src/db.ts` нормализует URL DigitalOcean PostgreSQL с `sslmode=require`, чтобы адаптер Prisma использовал TLS как libpq.

`src/storage` управляет приватным S3-хранилищем. Маршрут загрузки проверяет владельца и права, затем поручает сервису ключ объекта, подписанные URL и удаление. Terraform создаёт приватный бакет и ограниченные runtime-ключи в обоих облаках.

Не пиши Prisma SQL вручную. Измени `prisma/schema.prisma`, затем выполни `bun run prisma:migrate`.

## Официальная документация

Правила backend описаны выше. Поведение API проверяй по актуальной документации:

- [Bun](https://bun.sh/docs)
- [Hono](https://hono.dev/docs)
- [Пример Hono Zod OpenAPI](https://hono.dev/examples/zod-openapi)
- [Prisma](https://www.prisma.io/docs)
- [Миграции Prisma](https://www.prisma.io/docs/orm/prisma-migrate)
- [PostgreSQL](https://www.postgresql.org/docs/)
- [Zod](https://zod.dev/)
- [jose](https://github.com/panva/jose)
- [Docker Compose](https://docs.docker.com/compose/)
- [Официальный образ PostgreSQL](https://hub.docker.com/_/postgres)
- [DigitalOcean Spaces](https://docs.digitalocean.com/products/spaces/)
- [CDN для Spaces](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/)
