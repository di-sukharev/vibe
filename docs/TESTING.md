# Тестирование

Здесь описаны локальная настройка и команды. Выбор проверок и ограничения E2E заданы в [AGENTS.md](../AGENTS.md#тестирование-и-проверка).

Обычная задача требует узкой проверки. Полный `bun run check` нужен для явного релиза, аудита или сквозного изменения:

`template:check -> architecture:check -> audit -> typecheck -> lint -> test -> test:build-contracts`.

Аудиту нужен реестр пакетов, backend integration — Docker. Только последний тестовый скрипт собирает приложения и пишет `dist/`. Он проверяет production-результат `webapp` и `website`.

`bun run template:check` быстро проверяет `CHECKLIST.md`, реестр возможностей, импорт `AGENTS.md` из `CLAUDE.md` и Markdown-ссылки. Дополнительных зависимостей нет. `bun run test:terraform` выполняется отдельно и требует Terraform CLI.

## Уровни тестов

- Contracts/unit: чистые правила, Zod-контракты, env, JWT, хеши паролей, клиентский refresh/retry и очистка токенов.
- Контракты сборки: свойства только готового `dist/`, например CSS и отдельная hero-сцена. См. [контракты сборки](#контракты-сборки).
- Backend integration: реальные приложение/HTTP и изолированный PostgreSQL; вход, права, сохранение профиля, ошибки и конкуренция.
- Playwright: важные успешные пути через реальный webapp и backend.
- Maestro: нативные успешные пути установленной Expo development build.

## Проверка задачи

Следуй [правилам](../AGENTS.md#тестирование-и-проверка) и выбери узкую команду ниже. Изменение профиля в основном проверяет backend integration. Клиентский сценарий может доказать сохранение значения после перезагрузки, но не должен зависеть от текста уведомления.

Браузер запускай только по явному запросу. Для такого прогона запиши маршрут, исходное состояние, действие и результат.

## Backend

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
docker compose --env-file backend/.env up -d postgres
bun run test
bun run test:contracts
bun run test:backend
bun run test:backend:integration
bun run test:webapp
bun run test:mobile
bun run --cwd backend prisma:validate
bun run smoke:backend:docker

# Узкие проверки для обычных задач:
bun run test:backend:unit -- src/modules/auth/password-reset-cooldown.test.ts -t "outbox retry"
bun run test:backend:integration -- src/db.integration.test.ts -t "different jobs"
bun test packages/contracts/src/users.test.ts -t "profile updates"
```

Файлы в `backend/src` и `backend/scripts` обнаруживаются автоматически. `backend/scripts/test-files.mjs` выбирает исполнитель по имени:

| Имя | Исполнитель | Требования |
| --- | --- | --- |
| `*.integration.test.ts` | `test:integration` | Docker PostgreSQL |
| `*.live.test.ts` | `test:live` | Внешний сервис/аккаунт, который исполнитель сам не запускает |
| Остальные `*.test.ts` и `*.test.mjs` | `test:unit` | Без внешних сервисов |

Тесты выключенной возможности отмечены `@parked-test` в начальном комментарии. Они не запускаются до удаления маркера; сейчас это наборы `backend/src/modules/billing/`. В mobile маркера нет: каталог `mobile/tests/parked/` исключён через `--path-ignore-patterns`. Для включения перенеси файл из него.

Unit/integration принимают точные найденные пути относительно `backend/` и фильтр `-t`/`--test-name-pattern`. Без фильтров выполняется весь набор.

Integration даёт тесту 3 минуты вместо стандартных 5 секунд Bun. Хеширование пароля на загруженной машине может занять больше 5 секунд. После таймаута тело теста ещё может работать и мешать очистке следующего теста. Для узкого запуска срок меняется через `--timeout=<ms>`.

`bun run test:backend:unit` не требует Docker. Корневой `bun run test` требует, поскольку включает integration. Не помещай live-тест в unit-набор. Запускай его явно:

```bash
bun run test:storage:s3          # запускает локальный S3 и проверяет контракт
bun run --cwd backend test:live  # проверяет настроенные внешние сервисы
```

`backend/scripts/test-live.mjs` задаёт наборы storage, Postbox и Resend с нужными переменными. Полностью настроенные наборы запускаются. Частичная настройка вызывает ошибку с недостающими именами. Если ни один набор не настроен, команда также завершается ошибкой. См. [STORAGE](STORAGE.md) и [EMAIL](EMAIL.md).

Контракты проверяются в `packages/contracts/src/*.test.ts`: запросы, ответы и ошибки для backend/webapp/mobile. Unit-тесты клиентов в их `tests/` проверяют refresh/retry. Webapp также проверяет состояние `AuthProvider`, где полный E2E был бы дорогим и хрупким.

Тест провайдера использует реальный `react-dom/client`, React `act` и малые подставные root-container/`window`. В репозитории нет jsdom/happy-dom. Расширяй существующую подстановку, не добавляй DOM-библиотеку. Компоненты с HTML, например валидацию формы профиля, проверяй через `react-dom/server` и `renderToStaticMarkup`. Ветка `mobile` расширяет ту же модель для Expo.

Backend-тесты лежат рядом с модулями. Integration проверяет auth, users/admin RBAC и notifications через приложение/transport и настоящий PostgreSQL. Billing-тесты выключены вместе с возможностью и вернутся после включения таблиц по [IAP.md](IAP.md). Проверки охватывают ротацию сессий, права, профиль, последнего администратора, конкурирующее понижение ролей, отзыв сессий, идемпотентность seed, владение, повторы outbox, receipts и форматы ошибок.

Каждый управляемый запуск создаёт отдельный `${COMPOSE_PROJECT_NAME}-integration-<run>`, запускает `postgres_test`, ждёт готовности, применяет миграции и выполняет выбранные файлы. Без фильтра выполняются все найденные integration-тесты.

`finally` удаляет только сервис, том `<run-project>_postgres_18_test_data` и сеть этого запуска, в том числе после частичной ошибки старта. БД разработки и локальное хранилище не затрагиваются.

- `TEST_KEEP_DOCKER=1` сохраняет ресурсы для диагностики.
- Для внешней тестовой БД задай вместе `TEST_SKIP_DOCKER=1` и явный `TEST_DATABASE_URL`. Без URL skip запрещён. В этом режиме Docker не запускается и не очищается.
- По умолчанию порт определяется из абсолютного пути репозитория, а URL — из порта. Для фиксированной БД задай `POSTGRES_TEST_PORT` и `TEST_DATABASE_URL`.

Два запуска из одной копии получают разные Compose-проекты, но один вычисленный порт. Если он занят, второй запуск завершается без остановки первого. Для использования чужой управляемой БД укажи skip и её тестовый URL.

Integration и Docker smoke по умолчанию требуют имя БД с `_test`. Осознанное исключение задаётся отдельной переменной. Это защищает `web_app_demo` от тестовой записи. Подключение и сброс — в [LOCAL_DATABASE.md](LOCAL_DATABASE.md).

Docker smoke создаёт отдельные Compose-проект и порт, собирает backend и запускает его со своей `postgres_test`. Он ждёт `/health/ready`, проверяет token auth с БД и удаляет только свои контейнеры, сеть и том.

Ни один исполнитель не использует `docker compose down`: эта команда не ограничивается сервисом и может удалить хранилище загрузок. Удаление сервиса тестовой БД и его тома выполняется адресно.

В шаблоне нет GitHub Actions или другого облачного исполнителя проверок. Выполняй проверки задачи локально. Production-релиз и включённая автопересборка SSG следуют инструкции хостинга и не заменяют тесты задачи.

## Контракты сборки

```bash
bun run test:build-contracts
```

Скрипт собирает `webapp` и `website`, затем запускает `webapp/build-contracts/*.test.ts` и `website/build-contracts/*.test.ts`. Проверки читают свежие `dist/`:

- CSS не содержит утилиты, нужные только stories.
- Статический HTML содержит запасную hero-версию.
- R3F-сцена остаётся отдельной лениво загружаемой частью.

`bun run test:webapp` и `bun run test:website` только читают данные. Они не создают `dist/` и не наследуют окружение сборки разработчика. Поэтому `bun run check` собирает и проверяет результат один раз, после остальных тестов.

Отдельно запущенный файл контракта проверяет имеющийся `dist/`. Если его нет, ошибка указывает на команду сборки. Добавляй такие проверки только для свойств готового результата. Остальное проверяй unit-тестами.

## Webapp E2E

Настройки Playwright: `webapp/playwright.config.ts`. Первый запуск:

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
bun run --cwd webapp e2e:install
bun run --cwd webapp e2e -- auth.spec.ts -g "registers, restores"
```

Для задачи используй `spec -g "test name"`. Полный `bun run e2e:webapp` оставь для явной широкой проверки. Если Docker недоступен, следуй [LOCAL_DATABASE.md](LOCAL_DATABASE.md); не заменяй его нативной БД для новых пользователей.

Скрипт E2E:

- Запускает `docker compose up -d postgres_test`, кроме `E2E_SKIP_DOCKER=1`.
- Выбирает порты по репозиторию; при занятости берёт ближайшие свободные.
- Генерирует Prisma, применяет миграции и создаёт E2E-администратора. Его пароль не попадает в браузерную сборку.
- Передаёт `TEST_DATABASE_URL` в backend как `DATABASE_URL`.
- Запускает backend на `E2E_BACKEND_PORT`, Vite на `E2E_WEB_PORT`.
- После прогона удаляет только `postgres_test` и его том, кроме `E2E_KEEP_DOCKER=1`.
- Хранит тестовые файлы в `webapp/e2e/.artifacts/storage`, не в `backend/.storage`.
- Проверяет auth/profile, маршруты ролей и повышение роли, согласование сессий вкладок и аватар.

Аватар по умолчанию использует filesystem, без дополнительного контейнера. Для того же сценария с реальным S3:

```bash
bun run e2e:webapp:s3
```

Используй эту проверку при изменении хранения или его явном аудите. Она не повторяет остальные auth/RBAC-сценарии. Дополнительные аргументы могут задавать опции Playwright, но файл остаётся `avatar.spec.ts`.

Переменные:

```bash
TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:<test-port>/web_app_demo_test?schema=public"
POSTGRES_TEST_PORT=<test-port>
E2E_BACKEND_PORT=<backend-port>
E2E_WEB_PORT=<web-port>
E2E_SKIP_DOCKER=1
E2E_KEEP_DOCKER=1
E2E_ALLOW_NON_TEST_DATABASE=1
```

Playwright по умолчанию требует БД с `_test`. Только явный `E2E_ALLOW_NON_TEST_DATABASE=1` снимает это ограничение. Backend использует отдельный `TEST_ALLOW_NON_TEST_DATABASE`; переменные не заменяют друг друга.

Документированный вход — `TEST_DATABASE_URL`. `DATABASE_URL` оставь для низкоуровневого переопределения. Имена Compose-проекта, сервиса, тома и порт вычисляет `scripts/repo-env.mjs`, общий для E2E и backend integration.

Артефакты в `webapp/e2e/.artifacts/` не коммитятся. Для интерактивной отладки:

```bash
bun run --cwd webapp e2e:ui
```

## Mobile Maestro E2E

Сценарий: `mobile/.maestro/flows/auth-smoke.yaml`. Исполнитель: `mobile/scripts/e2e/run-maestro.mjs`.

Установи CLI:

```bash
bun run --cwd mobile e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version
```

Скрипт использует официальный установщик и закреплённую версию Maestro. Явное переопределение: `MAESTRO_VERSION=<version> bun run --cwd mobile e2e:maestro:setup`. Минимум исполнителя — `2.4.0+`. Меняй `MAESTRO_MIN_VERSION` только при проверке совместимой новой политики.

Требования:

- Java 17+.
- Xcode/iOS Simulator или Android Studio/emulator.
- Установленная Expo development build с `bundleIdentifier/package` = `com.webappdemo.mobile`. Expo Go не подходит.
- Backend с Docker Compose `postgres_test`, доступный по `EXPO_PUBLIC_API_URL` сборки Metro.
- Доступный с компьютера `E2E_API_HEALTH_URL`, например `http://<LAN_IP>:3000/health`.
- Доступный Metro в `MAESTRO_DEV_SERVER_URL`, например `http://<LAN_IP>:8081`.
- `EXPO_PUBLIC_E2E=1` при запуске Metro и исполнителя. Он отключает push-регистрацию и другие мешающие E2E интеграции. Для ввода пароля сценарий использует обычную кнопку показа пароля.

Создай `backend/.env` из `backend/.env.example`, если файла нет. При своём порте согласуй `POSTGRES_TEST_PORT` и `TEST_DATABASE_URL`. Запусти тестовую БД и API в отдельном терминале. LAN-адреса подходят симуляторам и реальным устройствам:

```bash
docker compose version
docker info
docker compose --env-file backend/.env up -d postgres_test
export TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public"
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
DATABASE_URL="$TEST_DATABASE_URL" bun run --cwd backend prisma:deploy
PORT="$BACKEND_PORT" DATABASE_URL="$TEST_DATABASE_URL" JWT_SECRET="mobile-e2e-secret-at-least-thirty-two-characters" CORS_ORIGINS="http://$LAN_IP:$METRO_PORT,http://localhost:$METRO_PORT" COOKIE_SECURE=false bun run --cwd backend start:raw
```

Порт в `TEST_DATABASE_URL` и `DATABASE_URL` должен совпадать с `POSTGRES_TEST_PORT`. Maestro не запускает backend: установленное приложение уже должно знать правильный API URL.

В другом терминале запусти Metro для установленной development build:

```bash
cd mobile
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://$LAN_IP:$BACKEND_PORT" bunx expo start --dev-client --host lan --port "$METRO_PORT"
```

Примеры сборки:

```bash
cd mobile
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx eas-cli build --profile development --platform ios
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx eas-cli build --profile development --platform android
```

Запусти smoke-сценарий:

```bash
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run --cwd mobile e2e:maestro
```

Доступные параметры:

```bash
MAESTRO_DEVICE="iPhone 16 Pro"
MAESTRO_APP_ID=com.webappdemo.mobile
MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081
MAESTRO_DEV_CLIENT_SCHEME=exp+mobile
MAESTRO_MIN_VERSION=2.4.0
E2E_DISPLAY_NAME="Mobile E2E User"
E2E_EMAIL="mobile-e2e@example.com"
E2E_PASSWORD=password123
E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health
EXPO_PUBLIC_E2E=1
MAESTRO_SKIP_API_PREFLIGHT=1
MAESTRO_SKIP_METRO_PREFLIGHT=1
MAESTRO_SKIP_E2E_ENV_PREFLIGHT=1
MAESTRO_DRY_RUN=1
```

Селекторы `testID` находятся в `mobile/src/constants/testIds.ts`. Для новых сценариев добавляй устойчивые ID. Проверяй данные и завершённые действия по [AGENTS.md](../AGENTS.md#тестирование-и-проверка). Auth smoke проверяет регистрацию, открытие кабинета, восстановление сессии после перезапуска и выход.

До продуктового сценария проверь нужные данные через backend API. Например, заказ требует доступный товар. Отсутствие данных должно дать понятную ошибку подготовки до запуска интерфейса.

До изменения запуска Maestro, селекторов или E2E-поведения выполни:

```bash
bun run --cwd mobile e2e:maestro:audit
```

Аудит проверяет исполнитель и активный auth-сценарий. Он отвергает `hideKeyboard`, нажатия по координатам, отсутствие dev-client `openLink`, устаревший `.maestro/.env.example` и ввод пароля в обход пользовательской кнопки видимости. Неактивные возможности в аудит не входят.

Штатный путь использует Expo dev client: нативные `ios`/`android` не хранятся в Git. Если продукт начнёт владеть ими, можно перейти на отдельное собранное iOS E2E-приложение. Ему нужны отдельный simulator bundle ID, сборка/установка исполнителем, общий запуск с `launchApp.clearState/clearKeychain`, отдельные порты, типизированный seed, проверки backend после сценария и блокировка симулятора на компьютере. Metro/dev-client в этом пути не нужен.

### Ограничения Expo Dev Client и Maestro

- Используй установленную development build. Expo Go может открыть свой launcher вместо приложения.
- `launchApp` только очищает состояние в начале. Затем `openLink` открывает `exp+<slug>://expo-development-client/?url=<metro-url>&disableOnboarding=1`. После `stopApp` открой ту же ссылку.
- Устройство должно видеть Metro и backend. Предпочитай `EXPO_PUBLIC_API_URL=http://<LAN_IP>:<BACKEND_PORT>`, `bunx expo start --dev-client --host lan --port <METRO_PORT>` и `MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:<METRO_PORT>`.
- `secureTextEntry` может мешать вводу на iOS при успешном отчёте Maestro. Сначала нажми обычную кнопку показа пароля. Каждый запуск приложения начинает со скрытого пароля.
- Вместо ненадёжного `hideKeyboard` используй `keyboardDismissMode="on-drag"`, прокрутку или нажатие на стабильный статический элемент.
- Сохраняй области нажатия около `44–48pt` или больше. Малые `Pressable` и checkbox могут пропускать нажатия.
- Для собственного checkbox не полагайся на `checked: true`. Доступное значение может быть `checkbox, checked`, пока поле иерархии false. Проверяй устойчивое видимое или доступное состояние.
- Перед важной кнопкой задай `scrollUntilVisible` параметры `visibilityPercentage: 100` и `centerElement: true`.
- После удаления стартовых маршрутов обнови нативные вкладки, web-вкладки и строковые `href`. Для динамических/query-маршрутов используй объектную навигацию с проверкой типов Expo Router.
- До UI проверь доступность backend, условия auth/сессии и seed. При проблеме заверши или пропусти сценарий с понятным сообщением.

## Официальная документация

Контракт репозитория описан выше. Поведение исполнителей проверяй по актуальной документации:

- [Playwright](https://playwright.dev/docs/intro)
- [Playwright webServer](https://playwright.dev/docs/test-webserver)
- [baseURL, трассировки, снимки и видео](https://playwright.dev/docs/test-use-options)
- [Playwright CLI](https://playwright.dev/docs/test-cli) и [установка браузеров](https://playwright.dev/docs/browsers)
- [Docker Compose](https://docs.docker.com/compose/)
- [Официальный образ PostgreSQL](https://hub.docker.com/_/postgres)

[Документация](https://docs.maestro.dev/)

[Документация](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli) [Документация](https://docs.maestro.dev/maestro-cli/run-your-first-test-with-the-maestro-cli)

[Документация](https://docs.maestro.dev/api-reference/selectors,) [Документация](https://docs.maestro.dev/reference/commands-available/launchapp,) [Документация](https://docs.maestro.dev/api-reference/commands/openlink,) [Документация](https://docs.maestro.dev/reference/commands-available/extendedwaituntil,) [Документация](https://docs.maestro.dev/reference/commands-available/scrolluntilvisible)

[Документация](https://docs.expo.dev/develop/development-builds/development-workflows/)
