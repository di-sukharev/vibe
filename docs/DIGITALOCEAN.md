# Terraform в DigitalOcean

Выбирай этот путь для аудитории вне России без требования хранить данные в России, согласно [CHECKLIST.md](../CHECKLIST.md). Общие правила — в [DEPLOYMENT.md](DEPLOYMENT.md), код — в [`infra/digitalocean`](../infra/digitalocean).

## Ресурсы Terraform

- Один Project и региональный VPC.
- Один Container Registry на аккаунт с защитой от удаления.
- PostgreSQL 18, БД приложения, отдельная runtime-роль и firewall доверенных источников.
- Приватный media Space с версиями и ограниченным ключом. Старые версии удаляются через 30 дней, незавершённые multipart — через 7.
- API-приложение App Platform: API-сервис, постоянный scheduler worker и миграция `PRE_DEPLOY`.
- Отдельные Static Sites для `webapp` и `website`.
- Уведомления API о сбоях деплоя/домена и scheduler о рестартах, памяти и CPU. Получатель — email команды по умолчанию.
- Приватный Space для state с версиями и отдельным ключом. Те же сроки очистки: 30 и 7 дней.

Scheduler запускает `outbox:drain` и `notifications:process` каждую минуту, очистку загрузок каждый час на 15-й минуте, auth/уведомлений — каждые 15 минут. Миграция использует тот же неизменяемый digest backend и должна завершиться до переключения API.

## Выбор ресурсов

Начни с одного API `apps-s-1vcpu-1gb` и минимального production-кластера БД. До согласования расходов проверь цены.

Предсобранные webapp/website размещай в App Platform Static Sites, без `instance_size_slug` и `instance_count`. SSR и server islands требуют runtime. Встроенного CDN достаточно, кроме необходимых внешних фильтров ботов, лимитов или геоправил.

Файлы пользователей храни в приватном Spaces Standard Storage. Backend запрещает filesystem в production.

## Подготовка аккаунта

Установи `doctl` 1.164+ и войди в аккаунт. Разреши App Platform читать нужный GitHub-репозиторий. Создай ключ аккаунта Spaces для управления бакетами. Bootstrap создаст отдельный узкий ключ для state.

Передай ключи и защиту аккаунта без вывода секретов:

```bash
export DO_EXPECTED_TEAM_UUID='<immutable Team UUID from doctl account get --output json>'
export DIGITALOCEAN_TOKEN='<API token>'
export SPACES_ACCESS_KEY_ID='<account Spaces key id>'
export SPACES_SECRET_ACCESS_KEY='<account Spaces secret>'
```

API-токен требует `spaces_key:read` кроме прав Terraform. Скрипт передаёт один `DIGITALOCEAN_TOKEN` в Terraform и `doctl`, выбирает default-контекст CLI и сверяет неизменяемый `DO_EXPECTED_TEAM_UUID`. Затем проверяет доступ токена к точному `SPACES_ACCESS_KEY_ID`.

Это защищает от похожих имён команд, старого CLI-контекста и ключей другого аккаунта. Ключ управления бакетами не передаётся приложению. Для API/scheduler Terraform создаёт отдельный media-ключ и задаёт его как secret-переменные App Platform.

## Настройка

```bash
cp infra/digitalocean/bootstrap/terraform.tfvars.example \
  infra/digitalocean/bootstrap/terraform.tfvars
cp infra/digitalocean/production/terraform.tfvars.example \
  infra/digitalocean/production/terraform.tfvars
export TF_VAR_jwt_secret="$(openssl rand -hex 32)"
```

Выбирай совместимые регионы: в примере `fra` для App Platform, `fra1` для VPC/БД/Spaces. Имена state/media Space должны быть глобально уникальны. Репозиторий задаётся как `owner/repository`, ветка — точная и уже отправленная.

`registry_name` действует на весь аккаунт. Если registry уже есть, укажи его имя и импортируй до первого apply. S3-backend использует `fra1` в endpoint, но регион подписи — `us-east-1`. Не заменяй его регионом Spaces.

Нужны три production-домена. Для DNS в DigitalOcean задай `dns_zone`; иначе оставь `null` и создай записи App Platform у внешнего DNS-провайдера.

Для Resend передай секрет вне HCL:

```bash
export TF_VAR_extra_runtime_secret_env='{"EMAIL_RESEND_API_KEY":"<secret>"}'
```

В production tfvars задай `email_delivery = "resend"` и `email_from`.

Уведомления отправляются на email команды без настройки. Для конкретных получателей открой API-приложение → Settings → Alert Policies → Edit, раскрой правило и задай способ уведомления.

Получатели намеренно не задаются в Terraform. Провайдер 2.99.1 не читает их обратно: объявленный список создаёт вечное изменение плана, а удаление списка не возвращает defaults. При отсутствии списка провайдер не синхронизирует получателей. Сохраняет ли их сама App Platform при повторе spec, не проверено. Проверь после первого релиза, следующего за ручной правкой.

## Команды

```bash
bun run infra:bootstrap -- digitalocean --new --dry-run
bun run infra:bootstrap -- digitalocean --new
bun run infra:apply -- digitalocean --dry-run
bun run infra:apply -- digitalocean
bun run infra:plan -- digitalocean
bun run infra:output -- digitalocean
bun run release -- digitalocean --dry-run
bun run release -- digitalocean
```

`infra:apply` меняет только постоянную основу. Релиз запрещён при расхождении её плана. Затем он входит в DOCR, собирает `backend/Dockerfile` из `git archive` опубликованного коммита, отправляет образ и получает `sha256` digest.

Runtime-корень применяет API. Terraform ждёт успешные `PRE_DEPLOY` и API-деплой. Только затем меняется отдельный static-корень.

Spec подключает кластер дважды без копирования паролей. API/scheduler используют ограниченную роль; только PRE_DEPLOY получает административное подключение для Prisma DDL.

После миграции `db:deploy` выдаёт runtime доступ к БД/схеме, DML текущих таблиц, sequences и default privileges владельца для будущих объектов. Сначала он снимает опасные права `PUBLIC` и прямые лишние права runtime. Наследуемые/повышенные роли и владение объектами запрещены. Это часть миграции, не ручная настройка консоли.

Для импортированного кластера сначала проверяются владельцы public-схемы. При старом владельце выполни проверенный `db:adopt-owner` по [DEPLOYMENT.md](DEPLOYMENT.md). Изменение ресурса БД/пользователя в Terraform не передаёт владение объектами.

Источник образа задаёт `registry_type = "DOCR"`, repository и digest, но не `registry`: DOCR отвергает имя registry в этом поле.

App Platform принимает ветку, не SHA коммита. Скрипт создаёт неизменяемую `infra-release/<40-character-sha>`, задаёт её обоим статическим приложениям с `deploy_on_push = false` и проверяет `source_commit_hash`. Новый push в `master` не меняет текущий релиз.

Если переданы `ADMIN_SEED_*`, первая миграция создаёт администратора. После успеха скрипт удаляет эти переменные и повторяет apply. Вторая миграция идемпотентна и проверяет готовность администратора.

## Уведомления

Terraform создаёт правила API в `infra/digitalocean/runtime/main.tf`. Они отправляют email команды. Настройка других получателей описана выше.

| Правило | Условие | Значение |
| --- | --- | --- |
| `DEPLOYMENT_FAILED` | Ошибка деплоя | Сбой миграции или компонента; прежний релиз остаётся активным |
| `DOMAIN_FAILED` | Не настроен `api_domain` | Ошибка DNS или сертификата |
| `RESTART_COUNT` > 1 за 5 минут | Scheduler перезапустился больше раза | Цикл падений; outbox и очистка не работают. Один рестарт после релиза не тревожит |
| `MEM_UTILIZATION` > 85% за 10 минут | Память выше 85% `worker_instance_size` | Риск остановки из-за нехватки памяти |
| `CPU_UTILIZATION` > 90% за 30 минут | Высокий CPU полчаса | Вероятно, задание зависло. Нормальный scheduler ждёт между тиками; backlog здесь не виден |

Числа `backlog`, `terminalFailed`, `claimed`/`skipped` и `unhandled` из `Job outbox:drain completed.` не вызывают уведомлений. Для этого App Platform потребовала бы внешнюю пересылку логов, которой здесь нет.

Читай runtime-лог worker приложения `<project_slug>-prod-api`. Объект метрик идёт после строки сообщения:

```bash
doctl apps list --format ID,Spec.Name
doctl apps logs <app id> scheduler --type run --tail 500 | grep -A 11 'outbox:drain completed'
```

Значения и действия описаны в разделе наблюдения `docs/BACKGROUND_JOBS.md`. Ошибка прохода без падения процесса видна как `Scheduler job outbox:drain failed.`, но не как alert.

## Эксплуатация

- Один узел PostgreSQL снижает стартовую цену. Сервис делает резервные копии; проверка восстановления и переход к HA остаются оператору.
- До появления App ID БД доверяет только выделенному VPC CIDR. После успешной миграции и API-деплоя скрипт передаёт App ID в foundation и заменяет правило точным источником. Если runtime-state потерял ID, но приложение существует, plan/apply останавливаются. Сначала восстанови или импортируй state; не расширяй доступ обратно до VPC.
- Внешний администратор БД требует явного firewall-правила Terraform, не общего разрешения в консоли.
- Static Sites используют встроенную доставку DigitalOcean. Отдельный Spaces CDN не создаётся.
- Приватные media доступны только по коротким подписанным URL, не через публичный CDN.
- Не включай `deploy_on_push`: только защищённый release управляет переключением.
- Не меняй `infra-release/*`. Удалять старую ветку можно, только когда её релиз больше не нужен для отката.
- GitHub-подключение App Platform — право аккаунта, не переносимая часть репозитория. Проверь его до первого релиза.

Поддержку удаления старых версий Spaces нужно проверить отдельно. DigitalOcean документирует expiration объектов и незавершённые multipart, но не гарантирует `NoncurrentVersionExpiration`, который отправляет провайдер.

После настройки state (`infra:bootstrap -- digitalocean --new`) и media (`infra:apply -- digitalocean`), либо их повторов, прочитай правило S3-клиентом. Передай ключ аккаунта как `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`:

`aws s3api get-bucket-lifecycle-configuration --endpoint-url https://<spaces_region>.digitaloceanspaces.com --bucket <Space>`.

Ожидается `NoncurrentVersionExpiration` на 30 дней. Если элемент отсутствует, считай это отказом: провайдер принял запрос, но не сохранил правило, и каждый план будет повторять изменение. Явный отказ остановит apply на lifecycle.

При первом отказе убери `noncurrent_version_expiration` из обоих правил и проверок в `infra/digitalocean/bootstrap/tests/bootstrap.tftest.hcl` и `infra/digitalocean/production/tests/production.tftest.hcl`. State упадёт первым; media иначе повторит ошибку позже. Запиши ограничение в `CHECKLIST.md`. Повтори `infra:bootstrap` без `--new`, затем `infra:apply`.

Для media это означает, что окно восстановления из [STORAGE.md](STORAGE.md) не закрывается через 30 дней. Старые версии будут копиться до ручной очистки.

Первый отказ может оставить Space tainted. `prevent_destroy` запретит замену. Сними taint командой `terraform untaint digitalocean_spaces_bucket.terraform_state` в локальном bootstrap-state либо `terraform untaint digitalocean_spaces_bucket.media` в инициализированном foundation.

Для foundation передай backend-ключи `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` из `TF_STATE_*` файла `infra/digitalocean/.env.terraform-state`. Затем повтори команду. Не удаляй Space или state ради обхода ошибки.

## Официальная документация

- [Terraform DigitalOcean](https://docs.digitalocean.com/reference/terraform/)
- [App Platform](https://docs.digitalocean.com/products/app-platform/)
- [Уведомления App Platform](https://docs.digitalocean.com/products/app-platform/how-to/create-alerts/)
- [Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/)
- [Container Registry](https://docs.digitalocean.com/products/container-registry/)
- [Spaces](https://docs.digitalocean.com/products/spaces/)
- [Static Sites](https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/)
- [doctl](https://docs.digitalocean.com/reference/doctl/)
