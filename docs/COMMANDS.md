# Команды репозитория

Выполняй `bun run <команда>` из корня. Имена ниже — отдельные команды, не варианты для вставки одной строкой.

## Разработка и сборка

| Команда | Результат |
| --- | --- |
| `dev` | Все приложения параллельно, включая scheduler |
| `dev:backend`, `dev:webapp`, `dev:website`, `dev:mobile` | Одно приложение |
| `storybook:webapp`, `storybook:website` | Каталоги компонентов на `6006` / `6007` |
| `storybook:build`, `storybook:build:webapp`, `storybook:build:website` | Оба каталога или один |
| `build` | Production build/typecheck/export, где скрипты заданы |
| `dev:backend:s3` | Backend с локальным S3 |
| `storage:local:start`, `storage:local:status`, `storage:local:stop`, `storage:local:env` | Локальный S3; stop сохраняет том |
| `static:precompress` | `.br`/`.gz` рядом с текстовыми файлами в `webapp/dist` и `website/dist` для [Caddy/nginx](DEPLOYMENT.md#свой-сервер) |

Облачные релизы не читают локальный `dist`: Yandex собирает Git-архив в Docker, DigitalOcean — в App Platform. Там сжатие выполняет провайдер, если оно доступно.

## Проверки и тесты

| Команда | Проверка |
| --- | --- |
| `check` | [Полный локальный прогон](../README.md#checks) |
| `template:check` | Опрос, реестр возможностей, правила агентов, Markdown-ссылки и якоря |
| `typecheck`, `lint`, `architecture:check` | Типы всех проектов; ESLint webapp/mobile; границы модулей |
| `audit` | Зависимости; ошибка при непроверенной уязвимости; нужен реестр пакетов |
| `test` | Infra, contracts, backend, webapp, website, mobile; нужен Docker |
| `test:terraform` | Все Terraform-корни; нужен CLI; вне `check` |
| `test:infra`, `test:contracts` | Защита инфраструктуры без изменений облака; Zod-контракты |
| `test:backend` | Unit и integration |
| `test:backend:integration` | PostgreSQL; фильтр: путь относительно backend и `-t "name"` |
| `test:webapp`, `test:website`, `test:mobile` | Клиенты; без записи сборок |
| `test:build-contracts` | Собирает webapp/website; проверяет CSS без story-утилит и отдельный ленивый hero-chunk |
| `test:storage:s3` | Контракт с настоящим локальным S3; нужен Docker |
| `e2e:webapp` | Playwright, backend, Vite; фильтр: spec и `-g "name"` |
| `e2e:webapp:s3` | Аватар с локальным S3 |
| `e2e:mobile` | Maestro; нужны Expo development build и Metro |
| `--cwd mobile e2e:maestro:audit` | Правила сценариев и параметров запуска |

Из тестовых скриптов только `test:build-contracts` собирает приложения.

## База данных и фоновые задачи

Здесь выполняй `bun run --cwd backend <команда>`, кроме корневого `bun run dev:seed`.

| Команда | Действие |
| --- | --- |
| `prisma:migrate`, `prisma:deploy` | Создать и применить миграцию в разработке; применить готовые миграции |
| `db:deploy` | Миграции релиза, первый администратор при необходимости, проверка его входа |
| `db:adopt-owner` | Просмотр владельцев объектов старой БД; `-- --apply` — только после проверки и подтверждения по инструкции |
| `start:cron -- <job>` | Один запуск задания, например `outbox:drain` |
| `start:scheduler` | `job-schedules.json`: outbox/push каждую минуту, загрузки каждый час, maintenance каждые 15 минут |
| `start:worker` | Циклические задачи; пуст, пока они не добавлены |
| `start:worker:notifications` | Постоянный Expo Push worker для задержки меньше минуты |

`bun run dev:seed` создаёт или обновляет локальные демоаккаунты. Задания описаны в [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md).

## Инфраструктура и релизы

Здесь `<provider>` — `digitalocean` или `yandex`. Следуй [инструкции инфраструктуры](../infra/README.md).

| Команда для `bun run` | Действие |
| --- | --- |
| `infra:bootstrap -- <provider> --new` | Создать удалённый state; без `--new` — продолжить; потерянный доступ восстанавливай по инструкции |
| `infra:apply -- <provider>` | Применить проверенный сохранённый план основы с постоянными данными |
| `infra:import -- <provider> <root> <address> <id> [adoption flags]` | Импортировать ресурс и проверить сохранённый план |
| `infra:output -- <provider>` | Вывести безопасные эксплуатационные параметры |
| `infra:plan -- <provider>` | Проверить защищённый production-план без применения |
| `release -- <provider>` | Собрать, мигрировать, переключить релиз, опубликовать и проверить |
