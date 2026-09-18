# Vibe Coding Template

<p align="center">
  <img src="docs/assets/vibe_tmpl_schema.png" alt="Схема архитектуры Vibe Coding Template" width="100%">
</p>

Шаблон web/mobile-продукта: backend на Bun/Hono, `webapp` на React, `website` на Astro, приложение Expo и общие API-контракты. Ветка `mobile` расширяет `master` нативным приложением и необязательными подписками, push и социальным входом.

## Задание для копирования агенту

Скопируйте этот текст в новый диалог с агентом:

```text
Установи https://github.com/di-sukharev/vibe как основу нового проекта.
Перед клонированием спроси, нужно ли мобильное приложение сейчас. Если нужно,
используй ветку mobile и проверь её готовность до настройки.

Прочитай README.md, CHECKLIST.md, AGENTS.md и инструкции для выбранных приложений.
Выполни раздел README «Инструкции для агента-установщика». До разработки проведи
опрос из CHECKLIST.md на моём языке и запиши решения в этот файл.

Считай это новым проектом, если я явно не сказал, что дорабатываю сам шаблон.
Отключи origin шаблона. Подключай мой репозиторий только по моему запросу
или предоставленному адресу. Для локального PostgreSQL используй Docker Compose.
Не требуй облачные учётные данные для локальной работы.

Настраивай только выбранные приложения и возможности. Если нужен деплой,
уточни аудиторию и требования к размещению данных. Сам выбери хостинг по README,
запиши решение и следуй docs/DEPLOYMENT.md. Не публикуй секреты и не выполняй
деплой из грязной, неопубликованной, неверной ветки или detached HEAD.

После настройки удали блок Только для первой установки из AGENTS.md.
Проверь выбранные приложения. Сообщи локальные адреса, результаты проверок
и точные действия, которые ещё нужны от меня для доступа, аккаунтов и доменов.
```

## Инструкции для агента-установщика

Этот раздел задаёт порядок первой установки. Правила дальнейшей разработки — в [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md) импортирует их. До завершения установки не начинай разработку функций.

### Опрос и выбор приложений

1. **До клонирования** спроси, нужно ли мобильное приложение сейчас: от ответа зависит ветка.
2. Если нужно, клонируй полный репозиторий, переключись на `mobile`, получи обе ветки (`master` и `mobile`) и установи зависимости по lockfile. До настройки выполни `bun run mobile:template:check -- --published`. Если команды нет или она завершилась с ошибкой, остановись. Владелец шаблона должен синхронизировать изменения `master` с `mobile`, сохранив мобильное приложение и реестр возможностей.
3. Прочитай этот README, [CHECKLIST.md](CHECKLIST.md), [AGENTS.md](AGENTS.md) и инструкции выбранных приложений. До команд настройки изучи их скрипты и `.env.example`.
4. Проведи опрос [CHECKLIST.md](CHECKLIST.md) на языке пользователя, в терминах продукта. Заполни всё до раздела *Возможности первой версии* включительно и все применимые условные разделы.
5. Запиши имя/slug проекта, выбранные и отложенные приложения, функции первой версии и границы работ по деплою. Обновляй *Реестр возможностей* при добавлении или удалении возможностей. Развёрнутые пояснения храни в README/docs.
6. Решения из *Решения агента* принимай сам. Объясняй результат пользователю, не предлагай ему выбирать техническую архитектуру. В частности, сам [выбери между `webapp` и `website`](#выбор-между-webapp-и-website).

### Репозиторий и имя проекта

- Перед работой с ветками, коммитами, push или PR проверь `git remote -v` и `git status --short --branch`.
- При установке нового проекта отключи `origin` шаблона командой `git remote remove origin`. Исключение — явный запрос на доработку самого шаблона.
- Подключи новый `origin`, только если пользователь дал адрес репозитория или попросил опубликовать проект. Иначе оставь `origin` пустым и сообщи, что публикация не настроена.
- Не открывай PR в репозиторий шаблона при установке нового проекта. Обсуждать такой PR можно только при явной работе над шаблоном.
- Для переименования найди `rg -n "web_app_demo|web-app-demo|vibecoding-template|Vibe Coding Template"`: имена пакетов, БД, cookies, Docker/Compose, образов, алиасы проверки архитектуры и заголовок `webapp/index.html`. Меняй исходники адресно, без слепой глобальной замены. Пересоздай `bun.lock` закреплённой версией Bun. Выполни установку зависимостей, typecheck, проверку архитектуры и backend integration для выбранных приложений. Web E2E запускай по явному запросу, как требует `AGENTS.md`.

### Активные и отложенные приложения

- Настраивай только выбранные приложения. Если нужен только `webapp`, оставь mobile отложенным в основной ветке: без Expo/EAS/Maestro и мобильных функций. При последующем запросе mobile сначала перейди на ветку `mobile`.
- Если нужен только mobile, сохрани `webapp` и `website`, но отложи их настройку. Не добавляй браузерные функции и Playwright-сценарии, кроме необходимых для активных mobile/backend. Отметь это в README соответствующего приложения. При последующем подключении `webapp` обнови заметку, настрой и проверь приложение.
- Пиши об отложенных приложениях в README. Комментарий в коде нужен только там, где неактивный код может ввести в заблуждение.
- В шаблоне ветки `mobile` не фиксируй `expo.owner` и `extra.eas.projectId`. В установленном проекте настрой владельца и EAS project init после выбора пользователем личного аккаунта или организации Expo.
- Для Maestro используй установленную Expo development build, не Expo Go. Сначала прочитай мобильный README этой ветки.

### Локальная настройка и завершение

- Если деплой пока не нужен, ограничься локальной настройкой. Облачные учётные данные, включая DigitalOcean, для неё не нужны.
- Для backend/API, full-stack, загрузок файлов и проверок с БД сначала проверь Docker Compose и Docker daemon. Используй [локальный PostgreSQL через Docker Compose](docs/LOCAL_DATABASE.md) и `docker-compose.yml`, не нативную установку.
- Можно создавать локальные `.env` из `.env.example` каждого приложения и генерировать локальный `JWT_SECRET`. Не коммить секреты и не выводи их значения в отчёт.
- Выполни [быстрый старт](#быстрый-старт) и минимальные проверки выбранных приложений. Удали отмеченный блок `Только для первой установки` из `AGENTS.md`.
- Сообщи локальные URL, выполненные команды, результаты и точные действия, которые ещё требуют участия пользователя.

### Хостинг и деплой

Если деплой нужен, прочитай [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [infra/README.md](infra/README.md) и инструкцию выбранного провайдера. Выбери хостинг по аудитории и требованиям из `CHECKLIST.md`:

| Условие | Хостинг | Инструкция |
| --- | --- | --- |
| Аудитория в России или данные должны оставаться в России | Yandex Cloud | [docs/YANDEX_CLOUD.md](docs/YANDEX_CLOUD.md) |
| Остальные случаи | DigitalOcean | [docs/DIGITALOCEAN.md](docs/DIGITALOCEAN.md) |
| Пользователь явно требует полного контроля | Свой сервер | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#свой-сервер) |

Запиши выбор. В установленном проекте удали каталог и инструкцию неиспользуемого облачного провайдера. Источник production-конфигурации — выбранный Terraform-стек.

- **Yandex Cloud:** используй Serverless Containers, Managed Service for PostgreSQL, Object Storage и при необходимости Cloud CDN из `infra/yandex`.
- **DigitalOcean:** используй App Platform, Managed PostgreSQL, DOCR и приватный Space из `infra/digitalocean`. Начни с одного API-контейнера `apps-s-1vcpu-1gb` и минимального production-кластера PostgreSQL. До согласования расходов проверь текущие цены.
- Размещай `webapp` и полностью предсобранный `website` как App Platform Static Sites, без `instance_size_slug` и `instance_count`. Для SSR, рендеринга по запросу или server islands нужен runtime-сервис. Static Sites уже используют глобальный CDN. Внешний CDN добавляй только ради необходимых фильтров ботов, лимитов запросов или географических правил.
- Храни загружаемые файлы в приватном объектном хранилище: Spaces Standard Storage или S3-совместимом бакете. Не используй файловую систему контейнера: backend запрещает этот драйвер в production.
- Скопируй `terraform.tfvars.example` для bootstrap и production выбранного провайдера. Заполни параметры проекта. Не коммить реальные `.tfvars`, секреты и доступ к Terraform state.
- Создай удалённый state один раз: `bun run infra:bootstrap -- <provider> --new`. Применяй изменения базовой инфраструктуры явно: `bun run infra:apply -- <provider>`. Проверь `bun run infra:plan -- <provider>`. После проверки плана без неожиданных изменений выполни `bun run release -- <provider>` для приложений релиза.
- Размеры ресурсов и состав сервисов задавай в Terraform. Существенные изменения эксплуатации отражай в инструкции провайдера.
- Перед деплоем или изменением облачных ресурсов проверь remote, рабочее дерево и целевую ветку/коммит. Работай только из нужной, отправленной на сервер ветки с чистым деревом. При локальных изменениях, untracked-файлах, рассинхронизации или detached HEAD остановись. Не используй stash, reset, очистку или переключение поверх чужой работы.
- Объясняй только необходимые ручные шаги: аккаунт и биллинг облака, вход в CLI, домены, сертификаты, DNS и права, которые не создаёт Terraform. Настройка Expo/EAS/App Store/Google Play описана в ветке `mobile`.

## Состав репозитория

| Путь | Назначение |
| --- | --- |
| `backend` | Bun, Hono, Prisma, PostgreSQL, JWT-аутентификация, Zod и OpenAPI |
| `webapp` | React, Vite, TanStack Query/Form/Router; CSR-приложение с регистрацией и входом |
| `website` | Astro; публичные SSG/SSR-страницы, лендинги, контент и витрина маркетплейса |
| `mobile` | Expo Router, token auth, загрузки, основа push/social/IAP и сценарии Maestro |
| `packages/contracts` | Общие Zod-схемы и TypeScript-типы API |
| `CHECKLIST.md` | Опрос, решения о продукте и реестр возможностей, включая удалённые |
| `infra` | Terraform для DigitalOcean и Yandex Cloud: bootstrap, базовая инфраструктура, миграции/runtime и статика |
| `docker-compose.yml` | Локальный PostgreSQL 18 (`postgres:18-alpine`), порт `54329` |
| `docs` | [Инструкции](#документация) по архитектуре, проверкам и эксплуатации |

PostgreSQL 18 нужен для UUIDv7, которые генерирует БД. Порт тестовой БД определяется по репозиторию; его можно задать через `POSTGRES_TEST_PORT`.

## Выбор между `webapp` и `website`

| Требование | Приложение |
| --- | --- |
| Публичные страницы, SEO, превью ссылок: лендинг, блог, документация, категории, поиск и карточки товаров | `website`: Astro, по умолчанию статика; SSR/hybrid по необходимости |
| Экраны после входа без SEO: кабинет, панели продавца/администратора, checkout, настройки и инструменты | `webapp`: React CSR |

Маркетплейсу обычно нужны оба приложения: публичный каталог в `website`, личные кабинеты в `webapp`. Оба используют `@web-app-demo/contracts`. Не переноси SEO-страницы в CSR ради одного приложения или весь личный кабинет в Astro ради публичного сайта.

До работы с данными сайта, корзиной, заказами, подписками, правами доступа и платежами прочитай [docs/WEB_SURFACES.md](docs/WEB_SURFACES.md). В браузере один checkout: `website` может хранить анонимный локальный выбор, а оформление и оплата принадлежат авторизованному `webapp`. Источник истины — backend.

У mobile отдельный нативный платёжный интерфейс. В ветке `mobile` есть отключённые пути подписок App Store/Google Play. Карты, Apple Pay и Google Pay можно добавить по требованиям продукта и правилам платформ.

Astro — стандартный выбор для сайта: мало клиентского JavaScript, статика по умолчанию, явное разделение SEO и приложения. Next.js нужен только при явном требовании платформы ISR/кэширования под Vercel. TanStack Start — возможный будущий вариант для единого React-приложения с выборочным SSR, а не исходный выбор для проекта без команды разработчиков.

## Быстрый старт

Установи зависимости:

```bash
bun install
```

Ветка `mobile` использует `linker = "isolated"` в `bunfig.toml`. Это разделяет версии React для webapp и Expo. После перехода с `hoisted` удали только каталоги `node_modules` в корне и рабочих пакетах, затем выполни `bun install --frozen-lockfile`. Не удаляй `bun.lock`.

Для backend/API, full-stack и других задач с БД проверь Docker:

```bash
docker compose version
docker info
```

Если проверка не прошла, установи и запусти Docker, затем повтори команды:

- **Windows:** Docker Desktop с WSL 2.
- **macOS:** Docker Desktop или Docker Engine с Compose v2.
- **Linux:** Docker Engine и плагин Docker Compose; запусти службу Docker.

Локальный PostgreSQL запускается через Docker Compose. Не переводи новых пользователей на нативную установку БД.

### Backend и база данных

Выполняй этот раздел только для backend/API, full-stack или проверок с БД.

Создай `backend/.env`:

```bash
# macOS, Linux или Git Bash в Windows
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

Запусти PostgreSQL и примени миграции:

```bash
docker compose --env-file backend/.env pull postgres
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend prisma:deploy
```

Создай локальные аккаунты из `DEV_SEED_ADMIN_*` и `DEV_SEED_USER_*` в `backend/.env`:

```bash
bun run dev:seed
```

| Роль | Email | Пароль | Страница после входа |
| --- | --- | --- | --- |
| Администратор | `admin@example.com` | `local-admin-password` | `/admin` |
| Пользователь | `user@example.com` | `local-user-password` | `/app` |

Это публичные демонстрационные данные из `.env.example`. Не используй их в production.

Повторный запуск seed безопасен. Команда запрещает `NODE_ENV=production` и принимает только локальный loopback-адрес PostgreSQL. Вход в mobile и основной экран компонентов не требуют подписки; seed не выдаёт premium-доступ. Админского интерфейса в mobile нет.

Деплой использует `db:deploy` и отдельные `ADMIN_SEED_*` для первого production-администратора. Локальный seed при деплое не запускается.

### Запуск приложений

Запускай только нужные приложения, каждое в отдельном терминале:

```bash
bun run dev:backend
bun run dev:webapp
bun run dev:website
bun run dev:mobile
```

### Вход и адрес локального API

Встроенные регистрация, вход и проверка сессии `webapp` требуют backend и PostgreSQL. До открытия приложения запусти БД, примени миграции и запусти `dev:backend`. Для одного `website` они не нужны. Для одного `webapp` отказаться от них можно лишь после замены или удаления встроенной авторизации.

Адрес браузера должен точно совпадать с origin в `CORS_ORIGINS` файла `backend/.env`. `http://localhost:5173` и `http://127.0.0.1:5173` — разные origin. При запуске Vite с `--host 127.0.0.1` добавь второй адрес в `CORS_ORIGINS` и перезапусти backend. Иначе `/api/auth/refresh` вернёт `CORS Missing Allow Origin`, а интерфейс сообщит о недоступной проверке сессии, хотя страница загрузится.

Если на компьютере несколько копий проекта, запускай backend и клиент из нужной копии. Старый сервер может занимать `3000` или `5173` и отдавать чужой код или настройки.

Для другого адреса API создай `webapp/.env`:

```dotenv
VITE_API_URL=http://localhost:3000
```

Для mobile создай `mobile/.env` с `EXPO_PUBLIC_API_URL`. Android Emulator обычно использует `http://10.0.2.2:3000`; устройствам и Maestro нужен LAN-адрес. Задавай `EXPO_PUBLIC_E2E=1` только для E2E-сессии Metro. ID продуктов и настройка Expo/EAS описаны в [mobile/README.md](mobile/README.md).

### Проверки

Тесты используют отдельный сервис `postgres_test` и формат `TEST_DATABASE_URL` из `backend/.env.example`. Playwright запускает этот сервис, применяет миграции к `web_app_demo_test`, выполняет сценарий и по умолчанию удаляет том тестовой БД.

Для обычной задачи выбери узкую проверку по [AGENTS.md](AGENTS.md#тестирование-и-проверка) и [docs/TESTING.md](docs/TESTING.md). Браузерные проверки запускай только по явному запросу пользователя.

`bun run check` — полный локальный прогон для релиза, аудита или сквозного изменения. Он проверяет шаблон, архитектуру, зависимости, типы, lint, тесты и production-сборки. Нужны работающий Docker для backend integration и доступ к реестру пакетов для аудита. Terraform проверяется отдельно: `bun run test:terraform` требует его CLI.

## Команды

### Разработка и сборка

- `bun run dev` — все проекты в режиме разработки параллельно, включая scheduler.
- `bun run dev:backend`, `bun run dev:webapp`, `bun run dev:website`, `bun run dev:mobile` — отдельные приложения.
- `bun run storybook:webapp`, `bun run storybook:website` — локальные каталоги компонентов на портах `6006` и `6007`.
- `bun run storybook:build` — статическая сборка обоих каталогов. Для одного: `storybook:build:webapp` или `storybook:build:website`.
- `bun run build` — production build/typecheck/export в проектах, где эти скрипты заданы.
- `bun run dev:backend:s3` — backend с локальным S3 вместо диска.
- `bun run storage:local:start|status|stop|env` — управление локальным S3; `stop` сохраняет том.
- `bun run static:precompress` — создать `.br` и `.gz` рядом с текстовыми файлами в собранных `webapp/dist` и `website/dist`. Это отдельный шаг только для [своего сервера](docs/DEPLOYMENT.md#свой-сервер): файлы читает Caddy/nginx. Облачный релиз их не использует: Yandex собирает статику в Docker из Git-архива, DigitalOcean — в App Platform. Локальный `dist` туда не попадает; сжатие выполняет инфраструктура провайдера, если оно доступно.

### Проверки и тесты

- `bun run check` — полный прогон, описанный [выше](#проверки).
- `bun run template:check` — состояние опроса и реестра возможностей, общие инструкции агентов, локальные Markdown-ссылки на файлы, каталоги и заголовки.
- `bun run typecheck` — TypeScript во всех проектах.
- `bun run lint` — ESLint для `webapp` и `mobile`.
- `bun run architecture:check` — границы зависимостей модулей и функций.
- `bun run audit` — аудит зависимостей; ошибка при непроверенных уязвимостях. Входит в `check` и требует реестра пакетов.
- `bun run test` — тесты инфраструктуры, контрактов, backend, webapp, website и mobile. Нужен Docker для PostgreSQL.
- `bun run test:terraform` — все Terraform-корни; нужен Terraform CLI. Не входит в `check`.
- `bun run test:infra` — управление релизами и защита инфраструктуры, без изменений в облаке.
- `bun run test:contracts` — общие Zod-контракты.
- `bun run test:backend` — unit- и integration-тесты backend.
- `bun run test:backend:integration` — тесты с `postgres_test`. Для одного теста добавь путь относительно `backend/` и `-t "name"`.
- `bun run test:webapp`, `bun run test:website` — тесты клиентов, без записи сборок.
- `bun run test:build-contracts` — сборка `webapp` и `website`, затем проверки production-результата: CSS без утилит только для stories, hero-сцена сайта в отдельном ленивом chunk. Только этот тестовый скрипт собирает приложения.
- `bun run test:mobile` — тесты мобильного клиента.
- `bun run test:storage:s3` — контракт хранилища с настоящим локальным S3; нужен Docker.
- `bun run e2e:webapp` — весь набор Playwright через backend и Vite. Для одного сценария добавь spec и `-g "name"`.
- `bun run e2e:webapp:s3` — Playwright-сценарий аватара с локальным S3.

- `bun run e2e:mobile` — Maestro с установленной Expo development build и доступным Metro.
- `bun run --cwd mobile e2e:maestro:audit` — проверка правил сценариев и параметров запуска.

### База данных и фоновые задачи

- `bun run --cwd backend prisma:migrate` — создать и применить миграцию в разработке.
- `bun run --cwd backend prisma:deploy` — применить готовые миграции на сервере.
- `bun run dev:seed` — создать или обновить локальные демоаккаунты.
- `bun run --cwd backend db:deploy` — миграции перед релизом, при необходимости первый администратор и проверка возможности входа администратора.
- `bun run --cwd backend db:adopt-owner` — просмотр владельцев объектов старой БД. Документированное подтверждение и `-- --apply` добавляй только для проверенной разовой передачи владения.
- `bun run --cwd backend start:cron -- <job>` — выполнить задание один раз, например `outbox:drain`; см. [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md).
- `bun run --cwd backend start:scheduler` — расписание `job-schedules.json`: task outbox и push каждую минуту, загрузки каждый час, maintenance каждые 15 минут.
- `bun run --cwd backend start:worker` — процесс циклических задач; пуст, пока задачи не добавлены.

- `bun run --cwd backend start:worker:notifications` — постоянный Expo Push worker для задержки меньше минуты.

### Инфраструктура и релизы

- `bun run infra:bootstrap -- <digitalocean|yandex> --new` — создать и перенести удалённый Terraform state. Убирай `--new` только при продолжении; для повторного подключения используй флаги восстановления из инструкции.
- `bun run infra:apply -- <digitalocean|yandex>` — применить проверенный сохранённый план только к базовой инфраструктуре с постоянными данными.
- `bun run infra:import -- <provider> <root> <address> <id> [adoption flags]` — импортировать ресурс в нужный state и проверить сохранённый план.
- `bun run infra:output -- <digitalocean|yandex>` — вывести только безопасные эксплуатационные параметры Terraform.
- `bun run infra:plan -- <digitalocean|yandex>` — проверить защищённый production-план без применения.
- `bun run release -- <digitalocean|yandex>` — собрать, выполнить миграции, переключить релиз, опубликовать и проверить результат.

### Обновление зависимостей

`overrides` в корневом `package.json` задаёт минимальные безопасные версии транзитивных зависимостей, которые код не импортирует напрямую. После обновления зависимостей удаляй ограничения по одному и повторяй `bun run audit`. Если аудит проходит, ограничение больше не нужно. `bun update` обновляет пакеты в этих пределах.

Если исправленной версии ещё нет, нужна узкая временная запись `temporaryAuditExceptions` в `scripts/dependency-audit.mjs`. Она фиксирует уязвимость, версии из lockfile, прямых потребителей, затронутые проекты и срок действия. Исключение не разрешает прямую зависимость приложения или импорт пакета из кода.

В мобильной ветке записаны три временных исключения. Два относятся к `image-size@1.2.1` в локальной сборке ресурсов Metro: `GHSA-w3rx-r6r6-pgpr` и `GHSA-5p2g-fcmc-qvqq`, пересмотр до 2026-09-24. См. [upstream issue](https://github.com/github/advisory-database/issues/9028). Третье — `decode-uri-component@0.2.2` через `query-string` в deep links `expo-router`: `GHSA-vcc3-ghjq-m6fr`, пересмотр до 2026-12-05. Исправленная `0.5.0` использует только ESM, а `query-string` требует `^0.2.2`; прямой override ломает Metro. Удали исключение после выхода совместимого исправления.

Prisma закреплена на `7.9.0` в `backend/package.json` из-за обнаруженного сбоя установки `7.9.1`. При `bun add @prisma/client@7.9.1` в пустом каталоге получались 3 файла и 12 КБ вместо 17 файлов и 78 МБ. Каталог `runtime/` оставался пустым при исправном опубликованном архиве. Поэтому импорт `@prisma/client/runtime/client` не находился, что вызывало около 180 ошибок типов.

`bun update` сохраняет точную версию, а `bun update --latest` может её изменить. После него проверь Prisma. Снять ограничение можно после проверки следующего исправления, начиная с `7.9.2`.

## Документация

Открывай инструкцию по нужной области; не копируй её правила в другие README.

| Документ | Содержание |
| --- | --- |
| [CHECKLIST.md](CHECKLIST.md) | Опрос, приложения, хостинг и реестр возможностей |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Границы модулей, runtime, auth, клиенты, Prisma и локальная инфраструктура |
| [docs/WEB_SURFACES.md](docs/WEB_SURFACES.md) | Публичные данные, пересборка SSG, браузерный checkout и мобильные платежи |
| [docs/TESTING.md](docs/TESTING.md) | Выбор проверок, backend, Playwright и mobile E2E |
| [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md) | Расписание, задачи внутри процесса и надёжная очередь outbox |
| [docs/LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md) | Docker Compose, тестовая БД и локальный сброс |
| [docs/EMAIL.md](docs/EMAIL.md) | Транзакционные письма, доставка, повторы и проверка отправки |
| [docs/STORAGE.md](docs/STORAGE.md) | Приватное filesystem/S3-хранилище, загрузки, доступ и очистка |
| [docs/SOCIAL_AUTH.md](docs/SOCIAL_AUTH.md) | Настройка Apple/Google |
| [docs/IAP.md](docs/IAP.md) | Включение или удаление подписок App Store/Google Play |
| [infra/README.md](infra/README.md) | Terraform-корни, state, параметры релиза и владение инфраструктурой |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production, bootstrap, релиз, откат и восстановление |
| [docs/DIGITALOCEAN.md](docs/DIGITALOCEAN.md) | Настройка и эксплуатация DigitalOcean |
| [docs/YANDEX_CLOUD.md](docs/YANDEX_CLOUD.md) | Настройка и эксплуатация Yandex Cloud |
| [backend/README.md](backend/README.md) | API, auth, Prisma, точки запуска и проверки backend |
| [webapp/README.md](webapp/README.md) | Настройка CSR-клиента, архитектура и Playwright |
| [website/README.md](website/README.md) | Astro, рендеринг и публикация |
| [mobile/README.md](mobile/README.md) | Expo, EAS, push, development build и Maestro |
| [packages/contracts/README.md](packages/contracts/README.md) | Общие схемы и DTO |

## Архитектура

Все активные приложения используют API-контракты из `packages/contracts`. Backend проверяет вход через Zod; `webapp` и `mobile` используют те же схемы в формах и API. `UserDto.role` задаёт роли `user | admin`. Права определяются текущей записью в БД, не ролью из JWT.

Путь запроса: `route -> validation -> auth/session guard -> service -> Prisma -> DTO`. Маршруты остаются тонкими; бизнес-логика auth находится в сервисе модуля. API, worker и cron используют общий `src/runtime.ts` для окружения и Prisma.

Сохраняй монолитный backend. Добавляй worker и задания из того же Docker-образа только под конкретную фоновую работу. Готовый scheduler уже обрабатывает outbox и пригоден для деплоя.

Один backend может держать локальные WebSocket-соединения. Если несколько экземпляров должны передавать общие сообщения, статусы присутствия или события, добавь управляемый Redis-совместимый Pub/Sub. Выбирай DigitalOcean Managed Valkey или Yandex Managed Service for Valkey по хостингу из `CHECKLIST.md`.

Мобильные возможности:

- [docs/SOCIAL_AUTH.md](docs/SOCIAL_AUTH.md) — настройка Apple/Google.
- [docs/IAP.md](docs/IAP.md) — выключенные подписки App Store/Google Play.

## Лицензия

Apache License 2.0. При распространении копии, форка или производного проекта сохраняй [LICENSE](LICENSE) и [NOTICE](NOTICE) с указанием Dima Sukharev, его GitHub и исходного репозитория.

## Официальная документация

Правила шаблона находятся в этом репозитории. Поведение инструментов и изменения провайдеров проверяй по актуальной официальной документации:

- Среда выполнения и пакеты: [Bun](https://bun.sh/docs).
- Backend: [Hono](https://hono.dev/docs).
- ORM и БД: [Prisma](https://www.prisma.io/docs), [PostgreSQL](https://www.postgresql.org/docs/).
- Валидация: [Zod](https://zod.dev/).
- JWT: [jose](https://github.com/panva/jose).
- Веб-приложение: [React](https://react.dev/reference/react), [Vite](https://vite.dev/guide/), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview), [TanStack Form](https://tanstack.com/form/latest/docs/framework/react/quick-start), [TanStack Router](https://tanstack.com/router/latest/docs/overview).
- Тесты: [Playwright](https://playwright.dev/docs/intro), [Maestro](https://docs.maestro.dev/).
- Mobile: [Expo](https://docs.expo.dev/), [Expo Router](https://docs.expo.dev/router/introduction/), [EAS Build](https://docs.expo.dev/build/introduction/), [React Native](https://reactnative.dev/docs/getting-started).
- Сайт: [Astro](https://docs.astro.build/en/getting-started/).
- Локальная инфраструктура: [Docker Compose](https://docs.docker.com/compose/), [официальный образ PostgreSQL](https://hub.docker.com/_/postgres).
- DigitalOcean: [Terraform](https://docs.digitalocean.com/reference/terraform/), [App Platform](https://docs.digitalocean.com/products/app-platform/), [Static Sites](https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/), [Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/), [Container Registry](https://docs.digitalocean.com/products/container-registry/), [Spaces](https://docs.digitalocean.com/products/spaces/), [doctl](https://docs.digitalocean.com/reference/doctl/).
- Yandex Cloud: [CLI](https://yandex.cloud/en/docs/cli/quickstart), [Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/), [Container Registry](https://yandex.cloud/en/docs/container-registry/quickstart), [Managed PostgreSQL](https://yandex.cloud/en/docs/managed-postgresql/), [Managed Valkey](https://yandex.cloud/en/docs/managed-redis/), [статический хостинг Object Storage](https://yandex.cloud/en/docs/storage/operations/hosting/setup), [AWS CLI для Object Storage](https://yandex.cloud/en/docs/storage/tools/aws-cli), [Cloud CDN](https://yandex.cloud/en/docs/cdn/concepts/), [Image Resizer](https://yandex.cloud/en/marketplace/products/yc/image-resizer).
