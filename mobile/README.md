# Мобильное приложение

Приложение Expo/React Native использует те же API-контракты, что webapp.

## Состояние приложения

При первой установке запиши здесь причину, если mobile отложен в корневом README. До начала мобильной разработки убери или обнови это пояснение.

## Экраны

- `/` — регистрация и вход без вкладок.
- Mobile предназначен для обычного пользователя. Администрирование и демоаккаунт администратора относятся к webapp.
- После входа открывается `/components` в оболочке нижних вкладок вместе с `/profile`.
- `/profile` позволяет добавить, заменить и удалить фотографию. Перед загрузкой изображение уменьшается и сохраняется как JPEG.
- `/details/[id]` — стековый экран вне вкладок с кнопкой назад сверху слева.
- `/paywall` содержит выключенную подписку. `IapProvider` не подключён; экран сообщает об этом вместо предложения покупки. Включение — в `docs/IAP.md`.
- После включения работают покупки App Store/Google Play и ввод offer code на iOS. Google Play redemption, подписанные promotional offers, alternative billing и внешние ссылки покупки отложены.
- Apple/Google sign-in также выключен: кнопки и backend-маршруты не подключены. См. `docs/SOCIAL_AUTH.md`.
- `src/components/dashboard/ScreenShell.tsx` владеет общим нативным заголовком. Низкоуровневый `Screen` управляет safe area, прокруткой, клавиатурой и возвратом.
- Телефоны используют нативные нижние вкладки. Широкий Expo Web переключается на общую боковую панель/inset.

## Платежи в разных клиентах

До работы прочитай [WEB_SURFACES.md](../docs/WEB_SURFACES.md). Mobile владеет нативной оплатой отдельно от браузерного checkout. Подписки магазинов включаются через реестр возможностей. По потребности добавляй карты, Apple Pay или Google Pay без перехода через `website`/`webapp`. Сначала проверь текущие правила магазина для продукта, витрины и региона.

## Локальный пользователь

Подготовь backend из корня репозитория:

```bash
docker compose --env-file backend/.env up -d postgres
bun run --cwd backend prisma:deploy
bun run dev:seed

```

Seed создаёт демоаккаунты без подписки или premium-доступа. Вход в приложение не зависит от оплаты:

| Email | Пароль | Экран после входа |
| --- | --- | --- |
| `user@example.com` | `local-user-password` | `/components` |

Запусти API и Expo в разных терминалах:

```bash
bun run dev:backend
bun run dev:mobile
```

Для физического устройства задай также URL хранилища. Filesystem подписывает ссылки через `PRIVATE_STORAGE_LOCAL_PUBLIC_URL`; по умолчанию это `http://127.0.0.1:<PORT>`. На телефоне такой адрес указывает на сам телефон. Рядом с настройкой `EXPO_PUBLIC_API_URL` клиента задай в backend:

```bash
# backend/.env — LAN-адрес компьютера или 10.0.2.2 для Android Emulator
PRIVATE_STORAGE_LOCAL_PUBLIC_URL="http://192.168.1.10:3000"
```

iOS Simulator может скрыть эту ошибку, поскольку loopback ведёт на компьютер. Мобильный интерфейс не использует администратора: backend seed создаёт его для webapp. Демопользователь не создаётся при деплое.

## Стек

- Expo SDK 57, React Native, TypeScript и Expo Router.
- TanStack Query/Form и общие Zod-контракты `@web-app-demo/contracts`.
- Expo SecureStore и Notifications.
- Expo ImagePicker, ImageManipulator и FileSystem для аватаров.
- Expo Apple Authentication и React Native Google Sign-In для необязательного социального входа.
- Expo IAP для подписок App Store/Google Play.
- Нативные UI-примитивы в стиле ShadCN, `src/components/ui`.
- Smoke-сценарий Maestro E2E.

## Команды

```bash
bun run dev
bun run android
bun run ios
bun run web
bun run typecheck
bun run lint
bun run build
bun run doctor
bun run e2e:maestro
```

Из корня: `bun run dev:mobile`, `bun run build:mobile`, `bun run typecheck:mobile`, `bun run e2e:mobile`.

## Окружение

Создай `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=
EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID=com.example.app.premium.monthly
EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID=com.example.app.premium.yearly
EXPO_PUBLIC_IAP_ANDROID_PACKAGE_NAME=com.example.app
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_MONTHLY_BASE_PLAN_ID=monthly
EXPO_PUBLIC_IAP_ANDROID_YEARLY_PRODUCT_ID=com.example.app.premium
EXPO_PUBLIC_IAP_ANDROID_YEARLY_BASE_PLAN_ID=yearly
EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=0
```

Для Android Emulator:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

Для Maestro с dev client предпочитай LAN-адрес. `EXPO_PUBLIC_E2E=1` задавай только для E2E-сессии Metro:

```bash
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000
EXPO_PUBLIC_E2E=1
```

`EXPO_PUBLIC_E2E=1` и `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1` отключают push-регистрацию: симулятор/E2E не спрашивает разрешение и не меняет токены backend. Все `EXPO_PUBLIC_*` входят в клиентскую сборку. Секреты здесь запрещены.

Настройка Apple/Google — в [SOCIAL_AUTH.md](../docs/SOCIAL_AUTH.md). После изменения Apple capability или Google iOS URL scheme нужна новая development build. Настройка магазинов, backend-ключей, sandbox/internal testing, восстановления и диагностики — в [IAP.md](../docs/IAP.md).

## Expo Push

Основа push включена, но Expo owner/project ID и ключи в шаблоне не заданы. Регистрация выключена на web, при `EXPO_PUBLIC_E2E=1`, `EXPO_PUBLIC_DISABLE_PUSH_NOTIFICATIONS=1` или без EAS `extra.eas.projectId`.

После входа на физическом iOS/Android клиент регистрирует токен через `POST /api/notifications/push-token`. При выходе или истечении сессии он пытается отозвать регистрацию. Уведомления открывают только безопасные внутренние `data.href`.

SecureStore сохраняет непрозрачный UUID установки, отдельный секрет и возрастающее поколение изменений. Backend хранит хеш секрета, принимает только новейшее разрешённое поколение, атомарно переносит владельца токена и оставляет неактивную запись после очистки. Задержанный запрос старого аккаунта не вернёт устройство. Знания Expo-токена недостаточно для удаления.

Старую token-only запись сначала закрепляет текущий авторизованный владелец. После этого установка безопасно меняет аккаунт, сохраняя сведения о незавершённой очистке. Провайдер повторно проверяет регистрацию один раз на область авторизации при запуске приложения. Токен, вытесненный лимитом аккаунта, восстанавливается при следующем открытии.

Настройка проекта:

1. Выбери личный аккаунт или организацию Expo. Задай `expo.owner`, slug, `ios.bundleIdentifier` и `android.package`.
2. Выполни `bunx eas-cli project:init` для получения `extra.eas.projectId`. Сам шаблон оставь без привязки.
3. Настрой APNs для iOS и FCM для Android через Expo/EAS. Не коммить `.p8`, `.p12`, `.keystore`, `google-services.json`, `GoogleService-Info.plist` и service-account JSON.
4. Собери и установи development/production build на физическое устройство. Expo Go, симулятор и web export не доказывают работу push проекта.
5. Запусти API и `bun run --cwd backend start:worker:notifications` либо расписание `bun run --cwd backend start:cron -- notifications:process`. При Expo Push Security передай `EXPO_PUSH_ACCESS_TOKEN` только исполнителю, который обращается в Expo. API лишь ставит сообщения в очередь.
6. Временно включи `ENABLE_TEST_PUSH=true`. Войди на устройстве и вызови авторизованный `POST /api/notifications/test-push`. Подтверди отправку и завершение ticket/receipt. Лимит — одно тестовое сообщение на пользователя в минуту. После проверки выключи endpoint.

Продуктовый код вызывает `enqueuePushNotification` со стабильным пользовательским `dedupeKey`, `title`, `body` и необязательным внутренним `data.href`.

## Development build

После изменения нативного модуля собери новый dev client. Перезагрузки JavaScript недостаточно: старый клиент может упасть при импорте. Аватар использует `expo-image-picker`, `expo-image-manipulator`, `expo-file-system` и config plugin с `NSPhotoLibraryUsageDescription`. После получения этих изменений пересобери приложение до открытия профиля. После изменения Expo-зависимостей выполни `bun run --cwd mobile doctor`.

1. Создай аккаунт Expo или войди в него.
2. Проверь CLI: `bunx eas-cli --version`.
3. Авторизуйся: `bunx eas-cli login`.
4. Привяжи проект: `bunx eas-cli project:init`.
5. Собери приложение:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

`expo-dev-client` установлен. Каталоги `ios`/`android` генерируются через Expo prebuild/development build и не хранятся в шаблоне.

Google Sign-In и покупки/восстановление через `expo-iap` требуют custom development build. Expo Go не подходит. После изменения IAP plugin или нативной настройки пересобери dev client. EAS сам выполняет prebuild; для локального native-проекта выполни `npx expo prebuild --clean` перед сборкой. Реальные покупки проверяй на устройстве или в тестовой сборке магазина с аккаунтом тестировщика.

## Maestro E2E

Auth smoke проверяет регистрацию, авторизованный экран, восстановление сессии и выход в установленной development build. Используй `postgres_test`, не БД разработки.

Создай `backend/.env` из `backend/.env.example`. При своём порте согласуй `POSTGRES_TEST_PORT` и `TEST_DATABASE_URL`. Запусти БД и API в отдельном терминале:

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

Запусти Metro в другом терминале:

```bash
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://$LAN_IP:$BACKEND_PORT" bunx expo start --dev-client --host lan --port "$METRO_PORT"
```

Установи Maestro и выполни сценарий:

```bash
bun run e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run e2e:maestro
```

После изменения сценариев или параметров запуска выполни аудит:

```bash
bun run e2e:maestro:audit
```

Backend должен быть доступен по `EXPO_PUBLIC_API_URL` сборки Metro, сам Metro — по `MAESTRO_DEV_SERVER_URL`. После сброса и перезапуска исполнитель открывает `exp+mobile://expo-development-client/?url=<metro-url>`, чтобы попасть в приложение. При смене slug задай `MAESTRO_DEV_CLIENT_SCHEME=exp+<slug>`.

Селекторы: `src/constants/testIds.ts`. Сценарий: `.maestro/flows/auth-smoke.yaml`. Исполнитель: `scripts/e2e/run-maestro.mjs`. Полная инструкция — [TESTING.md](../docs/TESTING.md).

## Правила реализации

Для фотографии нет Maestro-сценария: системный picker находится вне иерархии приложения. Unit-тесты с picker за портом проверяют протокол, успех при `412`, нормализацию и ошибки.

Web E2E проверяет передачу, сохранение после перезагрузки, замену, удаление и повтор прерванной загрузки на filesystem/S3. Владение и изоляция аккаунтов проверяются backend integration. Нативный путь целиком не проверен автоматически: проверь на устройстве `expo-file-system`, системный picker и LAN-настройку `PRIVATE_STORAGE_LOCAL_PUBLIC_URL`.

`src/platform/uploads` владеет общим протоколом, `src/features/avatar` — endpoint, picker и UI. `UploadFileAccess` объединяет измерение и отправку байтов. `AppProviders` выбирает `nativeFileAccess`/`webFileAccess` через `Platform.OS`. Пара нужна для совпадения реального размера с билетом; смешение reader/sender даёт `403`. На web `expo-file-system` — заглушка, хотя picker/manipulator работают.

Используй TanStack Query для серверных данных, TanStack Form для форм и общие Zod-схемы. Нативный auth использует `/api/auth/token/*`, refresh в `expo-secure-store`, access только в памяти. Logout сначала записывает несекретный pending-маркер, затем очищает локальный access/query. Успешный отзыв или окончательно устаревшие права удаляют refresh, затем маркер. Временная ошибка сохраняет оба. Bootstrap обрабатывает маркер до refresh и ограниченно повторяет отзыв с сохранёнными данными очистки push. Интерфейс остаётся анонимным.

Expo Web сохраняет тот же протокол маркера, но refresh остаётся только в HttpOnly-cookie. Изменения cookies требуют исключительной Web Lock; без поддержки клиент отказывает до запроса. Успешные register/login/logout увеличивают browser epoch внутри блокировки. События storage/BroadcastChannel уведомляют другие вкладки. До повтора запроса refresh сверяет epoch и `{ userId, sessionId }` из access-токенов. По таймауту logout отменяет запрос и освобождает блокировку. Нативный транспорт не использует браузерный координатор.

Продуктовый код находится в `src/features/auth`, `src/features/avatar`, `src/features/billing`, `src/features/notifications`. `src/composition` создаёт API и передаёт провайдеру только его интерфейс. `src/platform/api` управляет fetch, повторами auth, base URL и ошибками без знания endpoint. Пути и схемы принадлежат API функции. Маршруты используют только публичные index. После изменения границ выполни `bun run architecture:check`, после Expo-зависимостей — `bun run doctor` с закреплённым Expo Doctor 1.20.0.

`src/components/ui` повторяет имена локального Web ShadCN registry нативными реализациями. Используй native style props, controlled/uncontrolled значения и touch-поведение вместо DOM/Radix `className`/`asChild`. Защищённый `/components` — локальный каталог и smoke-экран после входа.

Токены цвета, радиуса, расстояний, текста и взаимодействия находятся в `src/components/ui/theme-tokens.ts` и `src/components/ui/theme.ts`. `src/components/dashboard` владеет `ScreenShell`, `SiteHeader`, карточками, навигацией, строками и loading/empty/error состояниями. Auth/billing принимают данные, состояния и callbacks без `style`/`className`. Маршруты только размещают компоненты.

Видимый текст выводи через `src/components/ui/typography.tsx`. `Typography` владеет `h1`–`h6`, body, caption, label, button, link и code. Не импортируй React Native `Text` напрямую в экраны/примитивы и не используй старые обёртки текста.

## Синхронизация мобильной ветки

Владелец шаблона сливает `master` в `mobile`. Сохрани мобильный код и состояния `available` для payments, push и social. До push проверь чистый коммит:

```bash
git fetch origin
bun install --frozen-lockfile
bun run mobile:template:check
```

После push проверь опубликованную ветку:

```bash
git fetch origin
bun run mobile:template:check -- --published
```

Обычный режим допускает чистый коммит впереди `origin/mobile`. `--published` требует равенства `HEAD` и удалённой ветки. Оба режима требуют актуальный `origin/master` в истории mobile, рабочие файлы mobile/IAP, общие контракты, согласованные правила агентов и ровно три указанные возможности `available`.

Проверка запускает `bun run check`: шаблон, архитектуру, аудит зависимостей, типы, lint, тесты с backend integration и контракты сборки. Затем выполняет аудит Maestro. Если команды нет или она упала, останови установку/публикацию шаблона. Исправление синхронизации принадлежит владельцу шаблона, не новому продуктовому проекту.

После установки возможности могут стать `included`/`removed`. Этот контроль шаблона больше не подходит. Следуй записанным проверкам активных функций: локальные тесты, типы, песочницы магазинов и релиз.

## Официальная документация

Конвенции проекта описаны выше. Поведение платформ проверяй по официальным источникам:

- [Expo docs](https://docs.expo.dev/)
- [Expo SDK 57 docs](https://docs.expo.dev/versions/latest/)
- [Expo Router docs](https://docs.expo.dev/router/introduction/)
- [Expo SecureStore docs](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo AppleAuthentication docs](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [React Native Google Sign-In Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo)
- [Expo Notifications docs](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo Push Notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo Push Notifications sending API](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Expo EAS docs](https://docs.expo.dev/eas/)
- [EAS Build docs](https://docs.expo.dev/build/introduction/)
- [React Native docs](https://reactnative.dev/docs/getting-started)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [Zod docs](https://zod.dev/)
- [Maestro docs](https://docs.maestro.dev/)
