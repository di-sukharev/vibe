# Terraform в Yandex Cloud

Используй этот путь для пользователей в России или требования хранить данные в России, согласно [CHECKLIST.md](../CHECKLIST.md). Общие правила — в [DEPLOYMENT.md](DEPLOYMENT.md), код — в [`infra/yandex`](../infra/yandex).

## Ресурсы Terraform

- Приватная сеть с подсетями `ru-central1-a`, `-b`, `-d`.
- Один приватный PostgreSQL 18, БД, владелец для миграций и DML-пользователи blue/green. Резервные копии на 7 дней, авторасширение диска, защита от удаления.
- Container Registry и log group на 7 дней.
- HTTP Serverless Container за API Gateway.
- Отдельный контейнер миграции и четыре HTTP-контейнера заданий с таймерами.
- Публичные website-бакеты Object Storage для `webapp` и `website`.
- Приватный media-бакет с версиями и ограниченными ключами в Lockbox. Старые версии удаляются через 30 дней, незавершённые multipart — через 7.
- Отдельные аккаунты миграции, runtime, gateway, таймеров, публикатора и управления хранилищем с узкими правами.
- Postbox и Cloud CDN по необходимости.
- Приватный state-бакет с версиями, ограниченным ключом и теми же сроками очистки 30/7 дней.
- Без уведомлений: закреплённый провайдер не умеет создавать Monitoring-alert и каналы. Два правила ниже создаются вручную один раз на folder.

По умолчанию `enable_cdn = false` и `route_static_through_cdn = false`. Статика доступна напрямую через HTTPS Object Storage. Первый флаг создаёт два CDN-ресурса и группы источников с gzip, не меняя DNS. Второй отдельно переключает трафик.

Прямой HTTPS бакета остаётся путём отката. Приватный media-бакет не входит в CDN.

## Подготовка аккаунта

Установи `yc`, выбери нужные cloud/folder. Скрипт релиза выполнит вход Docker. Активная цель CLI должна точно совпадать с `cloud_id` и `folder_id` в обоих tfvars. Это защищает от изменений чужого аккаунта действующим ключом.

Первый bootstrap временно выдаёт новому state-аккаунту folder-level `storage.admin`: бакета ещё нет, а настройка версий требует роли. Затем команда устанавливает политику только для этого аккаунта, снимает общую роль, проверяет доступ и переносит локальный state.

Политика привязана к аккаунту, не к одному ключу. Поэтому новый ключ того же аккаунта подходит для восстановления; другие личности запрещены. Deny для `s3:DeleteBucket` и `s3:PutBucketVersioning` имеет ограничения, описанные ниже.

Создай и подтверди три сертификата Certificate Manager: API, webapp, website. Имя каждого статического бакета должно совпадать с доменом. Прямой HTTPS остаётся настроенным и после CDN, чтобы пережить распространение DNS и обеспечить откат.

## Настройка

```bash
cp infra/yandex/bootstrap/terraform.tfvars.example infra/yandex/bootstrap/terraform.tfvars
cp infra/yandex/production/terraform.tfvars.example infra/yandex/production/terraform.tfvars
export TF_VAR_database_owner_password='<third strong random value, at least 24 characters>'
export TF_VAR_database_blue_password='<strong random value, at least 24 characters>'
export TF_VAR_database_green_password='<different strong random value, at least 24 characters>'
export TF_VAR_jwt_secret="$(openssl rand -hex 32)"
```

Заполни cloud, folder, опубликованную `git_branch`, домены, сертификаты и глобально уникальные имена бакетов. Digest релиза не хранится здесь: скрипт записывает его в игнорируемые migration/runtime-корни.

Сохрани три пароля БД и JWT в менеджере секретов. Передавай все четыре при каждом plan/apply. Начни версии паролей с `1`, задай `database_active_slot = "blue"`. Не меняй пароль или версию слота, который `infra:output` показывает активным.

Для Terraform DNS задай точный корень `dns_zone_domain` и `dns_zone_id` зоны Yandex Cloud DNS. Все три домена должны быть его поддоменами, не apex. Схема использует CNAME; apex требует другого решения с ANAME, а CDN требует CNAME.

Для внешнего DNS оставь `dns_zone_id` равным `null`. После первого релиза прочитай безопасные выходы:

```bash
bun run infra:output -- yandex
```

Используй `required_dns_records`.

Для Postbox нужен подтверждённый отправитель:

```hcl
email_delivery = "postbox"
email_from     = "Product <hello@example.com>"
```

Terraform помещает ключ отправителя прямо в Lockbox, не в терминал или runtime env-файл.

## Команды

```bash
bun run infra:bootstrap -- yandex --new --dry-run
bun run infra:bootstrap -- yandex --new
bun run infra:apply -- yandex --dry-run
bun run infra:apply -- yandex
bun run infra:plan -- yandex
bun run infra:output -- yandex
bun run release -- yandex --dry-run
bun run release -- yandex
```

`infra:apply` меняет только постоянную основу. При создании бакетов он временно выдаёт storage-аккаунту folder-level `storage.admin`. После настройки оставляет эту роль только на webapp, website и media, снимая общую в той же команде.

Политики по точному access-key дают публикатору только синхронизацию двух статических бакетов без удаления бакетов/версий. Runtime получает чтение, запись и удаление обычных media-объектов.

Статические бакеты разрешают анонимное чтение объектов, но не список. Публикатор имеет `ListBucket` через политику ключа, без IAM-роли. Хостинг, CDN и проверка маркера читают объекты по пути.

Это осознанное отклонение от заявленной конфигурации Yandex: официальная инструкция хостинга требует также анонимный список. В будущем провайдер может перестать поддерживать чтение без списка. Поэтому каждый `bun run release -- yandex` проверяет:

- Синхронизацию с ключом публикатора, включая list.
- Маркер через публичные домены.
- Несуществующий путь webapp: должна вернуться index-оболочка при допустимом для неё 2xx/4xx.
- `/` обоих доменов.

От fallback зависят все глубокие SPA-ссылки, включая сброс пароля. После первого релиза те же публичные проверки завершает каждый `infra:apply`. До релиза проверять ещё нечего.

Если после apply исчезли страницы, sync получает `AccessDenied` на list, хостинг отвечает 403 или probe не прошёл, верни поддерживаемую конфигурацию:

1. Задай `list = true` в обоих статических `anonymous_access_flags`.
2. Верни анонимный `s3:ListBucket` на ARN обоих бакетов.
3. Измени соответствующие проверки в `infra/yandex/production/tests/production.tftest.hcl`.
4. Повтори `infra:apply`.

Sync идёт после runtime. До успешного повтора при его ошибке новый backend может работать со старой статикой. Пути каталогов без завершающего `/`, например переход `/docs` → `/docs/`, текущие проверки не покрывают. Проверь такой путь при его добавлении.

Media не имеет анонимного доступа. Публичное чтение статики допускает HTTP-запрос CDN к website-origin; пользовательский домен переводит на HTTPS.

IaC-аккаунт имеет `s3:*` только на ARN бакета для чтения/изменения конфигурации, не на объекты. Ему запрещены `s3:DeleteBucket`, `s3:PutBucketVersioning`; удаление версий не разрешено.

Yandex проверяет Deny первым и признаёт `s3:PutBucketVersioning` действием политики. Поэтому Terraform не может приостановить версии и убрать 30-дневное окно восстановления.

Но удаление бакета и управление политикой проверяются только через IAM. Для консоли достаточно `storage.configurer`, для S3 API сервисного аккаунта нужен `storage.admin`; `storage.editor` может удалить бакет. IaC-аккаунт имеет bucket-level `storage.admin`.

Поэтому Deny удаления — лишь дополнительная защита. Terraform перед удалением бакета снимает policy-ресурс. Его реальные ограничения — `force_destroy = false`, media `prevent_destroy` и список разрешённых удалений скрипта. Владелец IaC-ключа или folder-level `storage.admin` может переписать политику. Считай ключ операторским.

Обычный apply не блокируется: версии включаются при создании до политики, а `PutBucketVersioning` отправляется только при изменении блока. Правки политики разрешает IAM. Сохраняй `s3:*` на ARN бакета: ручной список не защитит от владельца ключа, но может сломать чтение нового атрибута провайдера.

Если нужно изменить версионирование, сначала сними Deny одним apply, затем измени версии следующим. Для старого media-бакета без версий возможен короткий путь от своей личности:

`yc storage bucket update --name <media bucket> --versioning versioning-enabled`.

`yc` использует Cloud API и IAM. S3 `put-bucket-versioning` другого ключа не совпадёт ни с одним Allow. Если Cloud API тоже отказал, используй два apply. После включения повтори `infra:apply`: refresh увидит нужное состояние и установит lifecycle без изменения версий.

В обычном режиме IaC-ключ не имеет доступа к отдельному state-бакету.

Релиз требует чистый план основы. Он собирает один Linux AMD64-образ из `git archive` коммита, отправляет его и применяет отдельный migration-корень. Защищённый task endpoint должен вернуть HTTP 200 и `X-Task-Exit-Code: 0`. Только затем меняются API и задания. Подготовка миграции не меняет основу/runtime.

После переключения статика собирается из того же архива через `infra/yandex/static.Dockerfile`. Сначала загружаются хешированные `assets/` и `_astro/` с immutable-заголовками. Затем HTML с ревалидацией. Второй sync исключает хешированные каталоги и использует `--delete`, чтобы удалить старые маршруты, сохранив ресурсы клиентов со старым HTML.

Версии удалённого/заменённого HTML сохраняются 30 дней. Хешированные объекты остаются текущими. Удаляй их только по отдельной проверенной политике хранения, когда стоимость существенна.

Каждое приложение публикует ревалидируемый маркер с коммитом. Проверка читает его через публичный домен с обходом кэша и требует точное совпадение. Старый CDN или неверный DNS не могут дать ложный успех. Затем проверяется index-оболочка отсутствующего пути.

Ключ публикатора читается в память из sensitive output Terraform. Он не удаляет бакет или старые версии. Runtime использует другой ключ только для обычных media-объектов и получает его через Lockbox. Его удаление оставляет версию на 30 дней по [STORAGE.md](STORAGE.md).

Для восстановления версии нужен отдельный операторский доступ. Политика media разрешает IaC только действия бакета, runtime — только обычные объекты. Никто из них не читает старые версии и не снимает delete marker. Yandex сначала проверяет IAM, затем требует Allow политики; консольный доступ к бакету с политикой отключён.

Порядок восстановления:

1. Создай собственный сервисный аккаунт со статическим ключом. У пользователя такого ключа нет; `yc` не умеет перечислять версии.
2. Через консоль или Cloud API дай ему bucket-level `storage.editor` для восстановления версий.
3. Получи текущую policy из `yc storage bucket get <media bucket> --full --format json`; `| jq .policy` выделит поле.
4. Добавь временный Statement с `CanonicalUser` = ID аккаунта: `s3:ListBucketVersions` на ARN бакета, `s3:GetObjectVersion`, `s3:PutObject`, `s3:DeleteObjectVersion` на `<bucket>/*`.
5. Запиши весь документ через `yc storage bucket update --policy-from-file`. Команда заменяет, не объединяет политику. Один новый Statement отключил бы runtime до следующего apply. Личности, запускающей `yc`, достаточно `storage.configurer` на бакете.
6. S3-клиентом с новым ключом выполни `aws s3api list-object-versions --endpoint-url https://storage.yandexcloud.net --bucket <media bucket>`. Скопируй версию поверх ключа или удали marker.
7. Сними временную привязку и повтори `infra:apply`, чтобы убрать Statement. До этого release запрещён из-за расхождения основы.

Runtime читает Lockbox только по ссылкам на конкретные секреты, включая `extra_secret_bindings`. Общего folder-level доступа к payload нет; секрет владельца БД ему недоступен.

Миграция подключается отдельным владельцем схемы. API/задания — выбранным blue/green с управляемыми правами чтения/записи Yandex и `CONNECT`. После миграции `db:deploy` снимает опасные права `PUBLIC`: schema, temporary tables, objects, routines и defaults. Runtime не получает DDL или выполнение routines.

Owner URL хранится в отдельном Lockbox-секрете только для разовой migration-личности. Задание получает лишь этот URL и необязательный seed, без JWT, media, почты и runtime-паролей. У каждого runtime-слота постоянная точная версия секрета.

Импорт старой БД не переносит владельцев таблиц, sequences, routines и enum/domain. До миграции выполни просмотр и подтверждённый `db:adopt-owner -- --apply` по [DEPLOYMENT.md](DEPLOYMENT.md). Preflight до Prisma назовёт оставшиеся старые объекты.

## Задания и сеть

Таймеры используют UTC:

| Задание | Выражение | Блокировка / вызов | Работа |
| --- | --- | --- | --- |
| `outbox:drain` | `* * ? * * *` | 240 / 180 секунд | Письма и задачи каждую минуту |
| `uploads:pending:cleanup` | `15 * ? * * *` | 900 / 840 секунд | Незавершённые загрузки каждый час |
| `notifications:process` | `* * ? * * *` | 240 / 180 секунд | Отправка push и проверка Expo receipts каждую минуту |
| `maintenance:process` | `*/15 * ? * * *` | 240 / 180 секунд | Очистка auth, окон лимитов и содержимого уведомлений |

API и задания подключены к VPC; PostgreSQL не имеет публичного IP. Serverless Containers получают адреса `198.19.0.0/16`, поэтому группа БД разрешает TCP/6432 именно оттуда. Пользовательские `10.20.*` — подсети БД/сети, не исходные адреса контейнеров.

Только API Gateway вызывает HTTP API-контейнер. Личность таймера вызывает только задания.

`cron.ts --http <job>` возвращает 204 после успешной работы под блокировкой, 503 при ошибке задания/очистки. Это включает три повтора таймера. Только `POST /` выполняет задание: другой метод — 405, путь — 404. Проверки и случайный `GET /favicon.ico` не запускают очистку.

Command/task-режим используется только для явной миграции. Yandex всегда возвращает для него 200, а результат — в `X-Task-Exit-Code`. Скрипт проверяет заголовок до переключения.

## Уведомления

Провайдер из `infra/yandex/*/versions.tf` поддерживает только `yandex_monitoring_dashboard`, без alert/channel. После первого релиза создай правила вручную один раз на folder. Они переживают релизы, пока ID контейнеров прежние. После пересоздания folder/контейнеров создай их снова.

Задания: `<project_slug>-prod-outbox`, `-notifications`, `-uploads`, `-maintenance`. Найди ID для метки `container`:

```bash
yc serverless container list --folder-id <folder_id>
```

1. **Канал.** Monitoring → Notification channels → Create channel, метод `Email`, имя `prod-alerts`. Получатели — аккаунты Yandex Cloud, не любые адреса. Каждому нужны `monitoring.viewer` на folder и email в настройках профиля консоли, раздел Monitoring.
2. **`outbox drain stopped`.** Monitoring → Alerts → Create alert. Запрос: `series_sum(drop_empty_series("serverless.containers.started_per_second"{folderId="<folder_id>", service="serverless-containers", container="<outbox container id>"}))`. Агрегация `Maximum`, окно `10m`, Alarm при значении меньше `0.001`. Для `No selector metrics` и `No points in evaluation window` задай `Alarm`. Канал — `prod-alerts`.
3. **`job failed`.** Запрос: `"serverless.containers.errors_per_second"{folderId="<folder_id>", service="serverless-containers", container="<outbox id>|<notifications id>|<uploads id>|<maintenance id>"}`. Агрегация `Maximum`, окно `5m`, Alarm выше `0`. Обе политики отсутствия данных — `OK`, канал `prod-alerts`. Список через `|` включает только задания, не `<project_slug>-prod-api`.

В первом запросе важны обе функции. Метрика имеет `revision`: после релиза старая серия пуста. Голый selector может навсегда оставить Alarm из-за худшего состояния старой ревизии. Сначала удаляются пустые серии, затем суммируются остальные. Пока таймер работает, остаётся одна линия; после остановки — ни одной.

Эта схема ещё не проверена на живом folder. Проверь OK после первого и второго релиза, когда появится старая ревизия. Затем останови таймер через `yc serverless trigger pause <timer id>`, подожди больше окна, проверь Alarm и email, верни `yc serverless trigger resume <timer id>`. Таймер `<project_slug>-prod-outbox-timer` виден в `yc serverless trigger list`.

Если остановленный таймер оставляет OK, пустой результат не попал под no-data-политику. Замени запрос на `"serverless.triggers.read_events_per_second"{folderId="<folder_id>", service="serverless-functions", trigger="<timer id>"}`. Здесь нет `revision`; оставь обе политики `Alarm` и повтори проверку остановки.

`job failed` также не проверен на живом folder. HTTP 503 должен учитываться как ошибка вызова. Если 503 в логах не меняет alert, используй `"serverless.triggers.error_per_second"{folderId="<folder_id>", service="serverless-functions", trigger="<timer id>"}`. Эта метрика считает вызовы, которые таймер повторил.

Оба alert не читают числа `Job outbox:drain completed.`. Cloud Logging даёт `group.saved_records_per_second` по `level`, но обычные строки drain имеют `LEVEL_UNSPECIFIED`. Нельзя отличить `terminalFailed: 3` от другой строки. Для такого alert потребуются JSON-логи с `level` и `message`.

Пока читай `backlog`, `terminalFailed`, `claimed`/`skipped`, `unhandled` в log group на 7 дней. Здесь тоже нужна живая проверка: контейнеры задают `log_options { min_level = "INFO" }`, а уровень stdout/stderr — `UNSPECIFIED`. Документация не уточняет, отбрасывает ли их этот минимум.

Если работающие контейнеры не дают строк ниже, убери `min_level` из `infra/yandex/runtime/containers.tf`, `infra/yandex/runtime/ingress.tf` и `infra/yandex/migration/main.tf`. Выполни релиз и запиши результат в `CHECKLIST.md`.

Фильтруй по контейнеру, не тексту сообщения: метрики идут следующими отдельными строками после `Job outbox:drain completed.`.

```bash
yc logging read --folder-id <folder_id> --group-name <project_slug>-prod-containers \
  --resource-ids <outbox container id> --since 10m
```

Значения и действия описаны в разделе наблюдения `docs/BACKGROUND_JOBS.md`.

## Доступ оператора к БД

Для `psql` используй личный IAM через CLI. `yc managed-postgresql connect` запускает локальный PostgreSQL-proxy и работает с приватным кластером. Не выдавай публичный IP, не открывай `0.0.0.0/0`, не скачивай пароль из Lockbox и не создавай bastion ради обычного просмотра.

Кластер — `<project_slug>-prod-postgres`. В имени БД дефисы slug заменены подчёркиваниями: `example-app` → `example_app`.

Установи `psql`, войди в `yc` от своего имени и проверь цель:

```bash
yc version
yc managed-postgresql connect --help
yc config get cloud-id
yc config get folder-id
yc iam whoami
yc managed-postgresql cluster list
```

Если команды connect нет, выполни `yc components update`. Не используй migration/runtime-аккаунты: доступ оператора должен быть личным и проверяемым.

### Первичная выдача доступа

Передай тип и ID из `yc iam whoami` администратору облака. Он выдаёт connector на конкретный кластер. Для Yandex-аккаунта или локального пользователя организации:

```bash
yc managed-postgresql cluster add-access-binding \
  --name <project_slug>-prod-postgres \
  --role managed-postgresql.clusters.connector \
  --user-account-id <iam_subject_id>
```

Для федеративного пользователя замени последний аргумент:

```bash
--subject federatedUser:<iam_subject_id>
```

Затем создай IAM-пользователя PostgreSQL с именем, равным subject ID. Начни с чтения: `mdb_read_all_data` разрешает SELECT данных приложения, но не общее чтение системных каталогов или DML/DDL.

```bash
yc managed-postgresql user create <iam_subject_id> \
  --cluster-name <project_slug>-prod-postgres \
  --auth-method auth-method-iam \
  --permissions <project_slug_with_underscores> \
  --grants mdb_read_all_data
```

CLI наследует защиту удаления кластера (`Same as cluster`). В консоли открой Users, настрой личного пользователя и задай Deletion protection → Disabled. Это не меняет защиту кластера или приложений, но позволяет удалить личный доступ при уходе сотрудника.

Один IAM-пользователь БД соответствует одному человеку. Не дели владельца миграций, blue/green или `mdb_admin`/`mdb_superuser` для обычного просмотра. Схему меняет `bun run release -- yandex`. Прямая production-запись требует отдельно проверенного временного доступа.

### Подключение и проверка

Подключись без пароля БД и CA-файла:

```bash
yc managed-postgresql connect <project_slug>-prod-postgres \
  --db <project_slug_with_underscores>
```

До чтения проверь личность, БД и роль:

```sql
SELECT current_user, current_database();
SELECT pg_has_role(current_user, 'mdb_read_all_data', 'member') AS can_read_application_data;
```

`\q` закрывает сессию и proxy. Если локальный порт занят, повтори connect с `--port <free_local_port>`.

Этот личный доступ не входит в Terraform-ключи приложения. При отзыве удали пользователя БД и connector, используя тот же `--user-account-id` или федеративный `--subject`:

```bash
yc managed-postgresql user delete <iam_subject_id> \
  --cluster-name <project_slug>-prod-postgres

yc managed-postgresql cluster remove-access-binding \
  --name <project_slug>-prod-postgres \
  --role managed-postgresql.clusters.connector \
  --user-account-id <iam_subject_id>
```

## Ротация паролей БД

Два runtime-слота позволяют безопасный expand/contract между независимыми state:

1. Выполни `bun run infra:output -- yandex`, запиши `database_credential_slot`.
2. Не меняй пароль и версию активного слота. Для неактивного создай пароль, передай его в env, увеличь только его версию и выбери его в `database_active_slot`.
3. Выполни `bun run infra:apply -- yandex --dry-run`, затем `bun run infra:apply -- yandex`. Второй логин и точная версия Lockbox готовы; старый runtime ещё работает.
4. Выполни `bun run release -- yandex` для миграции и переключения.
5. Меняй прежний слот только после подтверждения нового активного слота в `infra:output`.

Sensitive output основы хранит отпечатки паролей. Перед каждым plan/apply скрипт сравнивает активный слот и запрещает изменение его пароля/версии, в том числе после неудачного релиза.

После появления runtime также запрещена замена JWT-секрета. Приложение принимает один ключ; безопасная ротация требует будущей поддержки нескольких ключей и переходного периода, а не сброса всех сессий.

Если runtime-state потерял слот, скрипт ищет существующие API/job-контейнеры у провайдера и останавливается. Восстанови или импортируй state, не считай это первым релизом. Не обходи скрипт сырым `terraform apply`.

## Эксплуатация

- Один узел БД `s3-c2-m8` — экономный старт. Добавляй HA/узлы, когда требования оправдывают стоимость.
- Повторы безопасны благодаря advisory locks заданий и построчному захвату outbox. Scheduler и HTTP cron используют один исполнитель и лимиты одного файла расписания.
- Включай CDN в два релиза. Сначала только `enable_cdn = true`, затем `infra:apply` и `release`. DNS остаётся прямым; проверь `cdn_dns_records`. Затем задай `route_static_through_cdn = true` и повтори apply/release. Для внешнего DNS переключи CNAME между фазами и также запиши флаг.
- Отключай CDN в обратном порядке. Для управляемого DNS сначала `route_static_through_cdn = false`, apply/release, ожидание не менее TTL 300 секунд плюс фактическое распространение, затем проверка прямого Object Storage. Для внешнего DNS сначала перейди на `direct_static_dns_records`, дождись и проверь, затем запиши false.
- Только после отвода трафика задай `enable_cdn = false`, выполни apply/release с точными `--allow-destroy` для двух CDN-ресурсов и двух origin groups из плана. Не удаляй CDN в том же релизе, который отводит DNS.
- Не помещай приватные media за CDN.
- API доверяет последнему `X-Forwarded-For` от ingress Yandex. Не открывай контейнер через недоверенную цепочку прокси.

## Официальная документация

- [Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/)
- [Terraform Yandex Cloud](https://yandex.cloud/en/docs/tutorials/infrastructure-management/terraform-quickstart)
- [Режимы Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/concepts/container)
- [Повторы таймеров](https://yandex.cloud/en/docs/serverless-containers/concepts/trigger/)
- [Managed PostgreSQL](https://yandex.cloud/en/docs/managed-postgresql/)
- [Подключение через IAM](https://yandex.cloud/en/docs/managed-postgresql/operations/connect/clients#iam-auth)
- [Команда connect](https://yandex.cloud/en/docs/managed-postgresql/cli-ref/connect)
- [Пользователи PostgreSQL](https://yandex.cloud/en/docs/managed-postgresql/operations/cluster-users)
- [Роли PostgreSQL](https://yandex.cloud/en/docs/managed-postgresql/concepts/roles)
- [Статический хостинг Object Storage](https://yandex.cloud/en/docs/storage/operations/hosting/setup)
- [Cloud CDN](https://yandex.cloud/en/docs/cdn/)
- [Lockbox](https://yandex.cloud/en/docs/lockbox/)
- [Monitoring-alert](https://yandex.cloud/en/docs/monitoring/concepts/alerting/alert)
- [Метрики Serverless Containers](https://yandex.cloud/en/docs/monitoring/metrics-ref/serverless-containers-ref)
- [CLI](https://yandex.cloud/en/docs/cli/quickstart)
- [Container Registry](https://yandex.cloud/en/docs/container-registry/quickstart)
- [AWS CLI для Object Storage](https://yandex.cloud/en/docs/storage/tools/aws-cli)
- [Концепции Cloud CDN](https://yandex.cloud/en/docs/cdn/concepts/)
- [Image Resizer](https://yandex.cloud/en/marketplace/products/yc/image-resizer)
