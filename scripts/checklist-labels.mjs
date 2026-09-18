// Русские подписи приводятся к прежним ключам проверки. Английские чеклисты
// остаются совместимыми, в том числе в отдельной мобильной ветке шаблона.
const headings = new Map([
  ['Проект', 'Project identity'],
  ['Продукт', 'Product'],
  ['Активные приложения', 'Active surfaces'],
  ['Возможности первой версии', 'First-version capabilities'],
  ['Файлы, изображения и медиа', 'Files, images, and media'],
  ['Данные сайта и частота обновления', 'Website data and freshness'],
  ['Платежи', 'Payments'],
  ['Деплой', 'Deployment'],
  ['Решения агента', 'Decided by the agent - do not ask the user'],
  ['Реестр возможностей', 'Capability ledger'],
  ['Проверка окружения', 'Environment checks'],
  ['После установки', 'After setup'],
])

const rowLabels = new Map([
  ['Новый проект из шаблона или доработка самого шаблона?', 'New project from this template, or work on the template itself?'],
  ['Название проекта / slug', 'Project name / slug'],
  ['Адрес своего репозитория GitHub, если он есть', 'Your own GitHub repository URL, if you have one'],
  ['Какой продукт нужно создать сначала?', 'What product do you want to build first?'],
  ['Какой пользовательский путь должен первым работать от начала до конца?', 'What is the first user journey that must work end to end?'],
  ['Почему остальные приложения отложены, если нужно пояснение', 'Why the unmarked surfaces are deferred, if it needs explaining'],
  ['Для активного `mobile`: нужны ли сейчас сборки Expo/EAS, Expo Push и Maestro E2E?', 'If `mobile` is active: are Expo/EAS builds, Expo Push, and Maestro E2E needed now, or left unconfigured until later?'],
  ['Что первая версия НЕ должна делать? Если запретов нет, запиши «ничего не исключено»', 'What the first version explicitly should NOT do (write "nothing ruled out" if that is the answer)'],
  ['Что загружают пользователи?', 'What do users upload?'],
  ['Доступ: всем, владельцу, выбранным людям или смешанный?', 'Public, private, shared with selected people, or mixed?'],
  ['Кто может загружать, смотреть, заменять и удалять файлы?', 'Who can upload, view, replace, and delete?'],
  ['Максимальный размер и допустимые типы файлов', 'Maximum file size and allowed file types'],
  ['Нужны ли миниатюры, изменение размера/формата, сжатие, обрезка или модерация?', 'Do images need thumbnails, resizing, format conversion, compression, cropping, or moderation?'],
  ['Сколько хранить файл после удаления связанной записи?', 'How long do files live after the owning record is deleted?'],
  ['Нужно ли показывать имена файлов пользователям или скрывать их за идентификаторами?', 'Should filenames be visible to users, or opaque?'],
  ['Какие публичные данные нужно брать из backend/БД при сборке сайта?', 'Which public product or content data comes from the backend/database at website build time?'],
  ['Как быстро сайт должен показывать изменение данных?', 'How soon after that data changes must the public website show the change?'],
  ['Какие изменения требуют автоматической пересборки и публикации?', 'Which changes require an automatic rebuild/redeploy rather than a manual release?'],
  ['За что платят пользователи?', 'What exactly do users pay for?'],
  ['Подписка, разовая покупка или оба варианта?', 'Recurring subscription, one-off purchase, or both?'],
  ['Нужны ли на публичном сайте корзина или выбор предложения до входа?', 'Does the public website need a local cart or offer selection before registration/sign-in?'],
  ['Где нужна оплата: браузер, App Store / Google Play, нативный ввод карты, Apple Pay или Google Pay?', 'Which active surfaces need payment: browser checkout, App Store / Google Play, native card entry, Apple Pay, or Google Pay?'],
  ['Что недоступно без оплаты?', 'What stops working when someone does not pay?'],
  ['Нужен деплой сейчас или пока достаточно локального запуска?', 'Is deployment needed now, or local-only for the moment?'],
  ['Где находятся пользователи? Должны ли данные оставаться в России?', 'Where are your users, and must the data stay in Russia?'],
  ['Выбор агента по аудитории и данным: DigitalOcean / Yandex Cloud / свой сервер', 'Hosting, picked by the agent from the answer above: DigitalOcean / Yandex Cloud / own server'],
  ['Рабочие домены / URL для API, webapp и website; нужен ли сейчас Yandex CDN?', 'Production domains / URLs for API, webapp, and website; is Yandex CDN needed now?'],
  ['Какие приложения публикуем первыми', 'Which surfaces are released first'],
  ['Свой сервер', 'Own server'],
])
const tableHeaders = new Set(['Вопрос', 'Хостинг', 'Возможность'])
const headerLabels = new Map([
  ['Вопрос', 'Question'], ['Ответ', 'Answer'],
  ['Хостинг', 'Hosting'], ['Когда выбрать', 'Chosen when'],
  ['Что даёт шаблон', 'What the template gives you'],
  ['Возможность', 'Capability'], ['Состояние', 'State'], ['Примечание', 'Note'],
])

export function normalizeChecklistLabels(source) {
  return source.split('\n').map((line) => {
    const heading = line.match(/^(##\s+(?:\d+\.\s*)?)(.+?)(\s*)$/)
    if (heading) return heading[1] + (headings.get(heading[2]) ?? heading[2]) + heading[3]
    if (line.startsWith('**Статус установки:**')) {
      return line.replace('**Статус установки:**', '**Install status:**')
    }
    if (line === '- [ ] Внешние интеграции (какие: _unanswered_)') {
      return '- [ ] External integrations (which: _unanswered_)'
    }
    if (line === '- [ ] Проверки перед завершением задачи записаны (какие: _unanswered_)') {
      return '- [ ] Validation scope recorded for this project (which suites run before a change is called done): _unanswered_'
    }
    const row = line.match(/^(\s*\|\s*)([^|]+?)(\s*\|)(.*)$/)
    if (!row) return line
    const firstCell = row[2].trim()
    if (tableHeaders.has(firstCell)) {
      // Переводим только заголовок таблицы. Ответы и примечания не меняем.
      return line.replace(/[^|]+/g, (cell) => cell.replace(/\S(?:.*\S)?/, (label) => headerLabels.get(label) ?? label))
    }
    return row[1] + (rowLabels.get(firstCell) ?? row[2]) + row[3] + row[4]
  }).join('\n')
}
