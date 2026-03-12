# AIDream Backend

NestJS backend для AIDream — сервис, который генерирует видео из пользовательских фотографий с помощью Google Vertex AI (модель Veo). Бэкенд стоит между React-фронтом и Google Cloud, управляя авторизацией, проектами, загрузкой фото, пайплайном генерации и кредитной системой.

## Что умеет текущая версия (MVP)

- **Авторизация** через Firebase Auth — проверка JWT-токена на каждом API-запросе
- **Управление проектами** — создание, просмотр, редактирование, удаление (CRUD)
- **Загрузка фотографий** — signed URL для прямой загрузки в Google Cloud Storage, подтверждение загрузки, изменение порядка фото
- **Генерация видео** — 5-шаговый пайплайн через Cloud Tasks:
  1. Препроцессинг (валидация фото, оценка качества)
  2. Storyboard (выбор лучших фото, генерация промптов для Veo)
  3. Генерация сцен (вызов Vertex AI Veo для каждой сцены параллельно)
  4. Поллинг операций (проверка статуса генерации каждые 30с)
  5. Сборка финального видео
- **3 стиля** с разными промптами: Memory (тёплый, ностальгический), Cinematic (кинематографичный), Dream (мечтательный, эфирный)
- **Кредитная система** — 20 бесплатных кредитов для новых пользователей, транзакционное списание
- **Health check** — `GET /health`

## Tech Stack

| Компонент | Технология |
|-----------|------------|
| Runtime | Node.js 18+ |
| Framework | NestJS 10 + TypeScript 5 |
| Auth | Firebase Admin SDK (JWT verification) |
| Database | Firestore (`@google-cloud/firestore`) |
| Storage | Google Cloud Storage (`@google-cloud/storage`) |
| AI | Vertex AI Veo (REST API + `google-auth-library`) |
| Queue | Google Cloud Tasks (`@google-cloud/tasks`) |
| Validation | class-validator + class-transformer |
| Config | `@nestjs/config` + `.env` |
| Container | Docker → Cloud Run |

## Структура модулей

```
src/
├── main.ts                          — bootstrap, CORS, ValidationPipe, глобальные фильтры
├── app.module.ts                    — корневой модуль
├── app.controller.ts                — GET /health
│
├── common/
│   ├── guards/
│   │   ├── firebase-auth.guard.ts   — проверка Firebase JWT для /api/* эндпоинтов
│   │   └── oidc-auth.guard.ts       — проверка OIDC токена для /internal/* (Cloud Tasks)
│   ├── decorators/
│   │   └── current-user.decorator.ts — @CurrentUser() для извлечения uid/email
│   ├── filters/
│   │   └── http-exception.filter.ts  — единый формат ошибок
│   └── interceptors/
│       └── logging.interceptor.ts    — логирование HTTP запросов
│
├── firebase/                         — Firebase Admin SDK init + Firestore instance
├── users/                            — auto-create пользователя при первом логине, 20 free credits
├── projects/                         — CRUD проектов + фото (subcollection)
├── upload/                           — signed URL генерация, подтверждение загрузки
├── storage/                          — GCS операции (upload/download URL, exists, delete, list, copy)
├── credits/                          — баланс, списание (Firestore transaction), история
├── queue/                            — Cloud Tasks enqueue (prod) / direct HTTP call (dev)
└── pipeline/
    ├── pipeline.service.ts           — оркестратор: связывает все шаги
    ├── pipeline.controller.ts        — публичные + internal эндпоинты
    └── services/
        ├── preprocess.service.ts     — валидация фото, quality score
        ├── storyboard.service.ts     — ранжирование, генерация промптов по стилю
        ├── vertex-ai.service.ts      — Veo API (image-to-video, poll operation)
        └── assembly.service.ts       — сборка клипов в финальное видео
```

## Быстрый старт (локально без GCP)

```bash
# 1. Установить зависимости
npm install

# 2. Создать файл конфигурации
cp .env.example .env

# 3. Запустить в dev-режиме
npm run start:dev
```

Сервер стартует на `http://localhost:8080`. Health check: `GET http://localhost:8080/health`.

**Важно:** без настроенного GCP-проекта и Firebase бэкенд запустится, но API-вызовы, требующие Firestore/GCS/Firebase Auth, вернут ошибки. Для полноценной работы нужна настройка GCP (см. ниже).

---

## Полная настройка GCP (пошагово)

> Все шаги ниже выполняются из Google Cloud Shell или локального терминала с установленным `gcloud CLI`.
> Если используете существующий GCP-проект, пропустите создание нового и подставьте свой Project ID.

### Предварительные требования

1. **Node.js 18+** (рекомендуется 20 LTS)
2. **Google-аккаунт** с доступом к Google Cloud Console
3. **gcloud CLI** — для работы с GCP из терминала ([установка](https://cloud.google.com/sdk/docs/install))
4. **Firebase CLI** — для настройки Firebase (`npm install -g firebase-tools`)

---

### Шаг 1: Создание GCP-проекта

GCP-проект — это контейнер для всех облачных ресурсов (базы данных, хранилища, очередей, AI-моделей). Все сервисы AIDream живут внутри одного проекта.

```bash
# Посмотреть существующие проекты (может у вас уже есть подходящий)
gcloud projects list

# Создать новый проект (или использовать существующий)
# Project ID глобально уникален и НЕ может быть изменён после создания
gcloud projects create aidream-dev --name="AIDream Dev"

# Переключиться на этот проект (все последующие команды будут работать в его контексте)
gcloud config set project aidream-dev
```

> **Если используете существующий проект:** просто выполните `gcloud config set project YOUR_PROJECT_ID` и подставляйте ваш ID во всех командах ниже.

**Проверка:**
```bash
# Убедиться, что проект создан и активен
gcloud projects describe aidream-dev
# Поле lifecycleState должно быть ACTIVE

# Убедиться, что вы в контексте нужного проекта
gcloud config get-value project
# Должно вывести: aidream-dev

# Проверить, что проект виден в списке
gcloud projects list --filter="projectId=aidream-dev"
```

### Шаг 2: Подключение биллинга

Биллинг **обязателен** для использования Cloud Storage, Cloud Tasks, Vertex AI и других платных API. Без него большинство сервисов не будет работать.

Google предоставляет **бесплатный trial на $300** для новых аккаунтов — его достаточно для разработки.

```bash
# Посмотреть доступные billing accounts
gcloud billing accounts list

# Привязать billing account к проекту
# BILLING_ACCOUNT_ID — из вывода предыдущей команды (формат: 01XXXX-XXXXXX-XXXXXX)
gcloud billing projects link aidream-dev --billing-account=BILLING_ACCOUNT_ID
```

Если billing accounts нет — создайте через [Cloud Console Billing](https://console.cloud.google.com/billing) (требуется привязка карты).

**Проверка:**
```bash
# Убедиться, что биллинг привязан
gcloud billing projects describe aidream-dev
# Должно показать billingEnabled: true

# Если billingEnabled: false — значит привязка не прошла
# Проверить доступные billing accounts
gcloud billing accounts list
# Если список пустой — нужно создать billing account через UI
```

### Шаг 3: Включение GCP API

Каждый GCP-сервис имеет свой API, который нужно явно включить. Без включения API вызовы к сервису будут возвращать 403.

```bash
gcloud services enable \
  firestore.googleapis.com \
  storage.googleapis.com \
  cloudtasks.googleapis.com \
  aiplatform.googleapis.com \
  firebase.googleapis.com
```

| API | Для чего нужен |
|-----|---------------|
| `firestore.googleapis.com` | База данных для пользователей, проектов, jobs |
| `storage.googleapis.com` | Хранилище фотографий и сгенерированных видео |
| `cloudtasks.googleapis.com` | Очередь задач для асинхронного пайплайна генерации |
| `aiplatform.googleapis.com` | **Vertex AI** — доступ к модели Veo для генерации видео |
| `firebase.googleapis.com` | Firebase Management API — управление Firebase-проектом |

> После включения API может потребоваться **1-5 минут** на пропагацию. Если следующая команда выдаёт ошибку "API not enabled", подождите и повторите.

**Проверка:**
```bash
# Посмотреть все включённые API в проекте
gcloud services list --enabled

# Проверить конкретные API по отдельности
gcloud services list --enabled | grep -E "firestore|storage|cloudtasks|aiplatform|firebase"
# Должно вывести все 5 сервисов

# Если какой-то API отсутствует — включить отдельно
gcloud services enable aiplatform.googleapis.com
```

### Шаг 4: Создание Firestore

Firestore — NoSQL база данных, в которой хранятся пользователи, проекты, фотографии, jobs пайплайна и транзакции кредитов.

```bash
# Проверить, нет ли уже созданной базы (повторное создание выдаст ошибку)
gcloud firestore databases list

# Создать базу данных Firestore в режиме Native (не Datastore!)
# Регион нельзя изменить после создания
gcloud firestore databases create --location=us-central1
```

**Проверка:**
```bash
# Убедиться, что база создана
gcloud firestore databases list
# Должна показать базу (default) с type: FIRESTORE_NATIVE

# Детальная информация о базе
gcloud firestore databases describe --database="(default)"
# Проверить: type = FIRESTORE_NATIVE, locationId = us-central1
```

> **Если получаете "already exists":** база уже создана, это нормально — переходите к следующему шагу.

### Шаг 5: Создание Cloud Storage bucket

Cloud Storage хранит загруженные пользователем фотографии и сгенерированные видео. Бэкенд выдаёт фронтенду signed URL для прямой загрузки файлов в bucket (минуя сервер).

```bash
# Посмотреть существующие bucket'ы в проекте (может уже есть нужный)
gsutil ls

# Создать bucket. Имя глобально уникально (как домен). Если занято — добавьте суффикс
gsutil mb -l us-central1 gs://aidream-media-YOUR_PROJECT_ID
```

> **Важно:** имя bucket должно быть **глобально уникальным** среди всех GCP-проектов в мире. Рекомендуется использовать формат `aidream-media-<project-id>`.

**Проверка создания:**
```bash
# Убедиться, что bucket создан в вашем проекте
gsutil ls
# Должен показать: gs://aidream-media-YOUR_PROJECT_ID/

# Посмотреть детали bucket (регион, класс хранения)
gsutil ls -L -b gs://aidream-media-YOUR_PROJECT_ID | head -10
```

Настройка CORS — нужна для того, чтобы фронтенд (localhost:3000) мог загружать файлы напрямую в bucket через signed URL из браузера:

```bash
cat > /tmp/cors.json << 'EOF'
[{
  "origin": ["http://localhost:3000"],
  "method": ["PUT", "GET"],
  "responseHeader": ["Content-Type"],
  "maxAgeSeconds": 3600
}]
EOF
gsutil cors set /tmp/cors.json gs://aidream-media-YOUR_PROJECT_ID
```

> Для production добавьте домен фронтенда в массив `origin` (например `"https://aidream.app"`).

**Проверка CORS:**
```bash
gsutil cors get gs://aidream-media-YOUR_PROJECT_ID
# Должно показать JSON с origin, method, responseHeader
```

> **Если получаете 409 "bucket already exists":** это значит имя занято. Попробуйте `gs://aidream-media-aidream-dev-2026` или другой суффикс.
> **Если получаете 403 "billing account is disabled":** вернитесь к шагу 2 и привяжите биллинг.

### Шаг 6: Создание Cloud Tasks очереди

Cloud Tasks — управляемая очередь задач. Бэкенд ставит в очередь каждый шаг пайплайна генерации видео. Cloud Tasks гарантирует доставку, retry при ошибках и позволяет задавать delay между шагами (например, поллинг Vertex AI каждые 30 секунд).

В dev-режиме (`NODE_ENV=development`) Cloud Tasks не используются — бэкенд вызывает внутренние эндпоинты напрямую по HTTP. Очередь нужна для production-деплоя на Cloud Run.

```bash
# Посмотреть существующие очереди (может уже есть)
gcloud tasks queues list --location=us-central1

# Создать очередь
gcloud tasks queues create aidream-pipeline --location=us-central1
```

**Проверка:**
```bash
# Убедиться, что очередь создана
gcloud tasks queues list --location=us-central1
# Должна показать: aidream-pipeline

# Детали очереди (лимиты, retry policy)
gcloud tasks queues describe aidream-pipeline --location=us-central1
```

### Шаг 7: Firebase

Firebase Auth обеспечивает аутентификацию пользователей через Google Sign-In. Фронтенд использует Firebase JS SDK для логина, получает JWT-токен и отправляет его на бэкенд. Бэкенд проверяет токен через Firebase Admin SDK.

```bash
# Установить Firebase CLI (если ещё не установлен)
npm install -g firebase-tools

# Проверить версию Firebase CLI
firebase --version

# Залогиниться в Firebase CLI (отдельный логин от gcloud!)
firebase login

# Проверить, под каким аккаунтом залогинены
firebase login:list

# Проверить, не добавлен ли уже Firebase в проект
firebase projects:list

# Добавить Firebase в GCP-проект
# Если команда выдаёт 403 — добавьте проект через Firebase Console UI (см. ниже)
firebase projects:addfirebase aidream-dev
```

> **Если `firebase projects:addfirebase` выдаёт 403:**
> 1. Откройте [Firebase Console](https://console.firebase.google.com/)
> 2. Нажмите **"Create a project"** / **"Add project"**
> 3. В поле ввода имени начните вводить `aidream-dev` — появится подсказка с существующим GCP-проектом
> 4. Выберите его и пройдите визард (примите Terms of Service)
>
> Это требуется для первого использования Firebase — после принятия ToS команда CLI будет работать.

**Проверка Firebase:**
```bash
# Убедиться, что Firebase добавлен в проект
firebase projects:list
# Должен показать aidream-dev в списке

# Или через REST API
curl -s "https://firebase.googleapis.com/v1beta1/projects/aidream-dev" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" | python3 -m json.tool
# Поле state должно быть ACTIVE
```

**Включение Google Sign-In:**

1. Откройте [Firebase Console](https://console.firebase.google.com/) → выберите проект
2. Перейдите в **Authentication** → **Sign-in method**
3. Нажмите **Google** → **Enable** → **Save**

Это позволит пользователям входить через Google-аккаунт на фронтенде.

---

### Шаг 8: Vertex AI и модель Veo

Vertex AI — платформа Google Cloud для ML/AI. AIDream использует модель **Veo** (image-to-video генерация), которая принимает фотографию + текстовый промпт и создаёт короткое видео (4-5 секунд).

#### Что такое Veo

**Veo** — генеративная модель Google для создания видео. Поддерживает два режима:

| Режим | Описание | Когда используется |
|-------|----------|-------------------|
| `image_to_video` | Одно фото → видео с движением | Последняя сцена (одно фото) |
| `first_last_frame` | Два фото → видео-переход между ними | Переходы между сценами |

Бэкенд автоматически выбирает режим в зависимости от количества фото в сцене (см. `storyboard.service.ts`).

#### Доступные модели Veo

| Модель | Описание |
|--------|----------|
| `veo-2.0-generate-001` | Стабильная версия Veo 2 (рекомендуется) |
| `veo-2.0-generate-exp` | Экспериментальная версия Veo 2 |
| `veo-3.0-generate-001` | Veo 3.0 (новее, дороже) |
| `veo-3.0-fast-generate-001` | Veo 3.0 Fast (быстрее, ниже качество) |

> **Важно:** имя модели в `.env` должно быть **полным** (например `veo-2.0-generate-001`), а не сокращённым (`veo-2.0`). Сокращённое имя приведёт к ошибке 404.

#### Как работает вызов Veo

1. Бэкенд отправляет POST-запрос к Vertex AI REST API (`predictLongRunning`)
2. API возвращает `operationId` (генерация занимает 1-3 минуты)
3. Бэкенд ставит в очередь задачу проверки (через Cloud Tasks с delay 30 сек)
4. Проверка поллит `GET /v1/{operationId}` — если `done: false`, перезапланирует себя
5. Когда `done: true` — скачивает видео по `videoUri` и сохраняет в GCS

#### Endpoint Vertex AI

```
POST https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{REGION}/publishers/google/models/{MODEL}:predictLongRunning
```

#### Тело запроса (image-to-video)

```json
{
  "instances": [{
    "prompt": "A warm, nostalgic memory of the scene. Slow gentle pan...",
    "image": {
      "gcsUri": "gs://your-bucket/projects/{id}/photos/photo1.jpg"
    }
  }],
  "parameters": {
    "sampleCount": 1,
    "durationSeconds": 4
  }
}
```

#### Тело запроса (first_last_frame — переход между фото)

```json
{
  "instances": [{
    "prompt": "Smooth transition between two moments...",
    "image": {
      "gcsUri": "gs://your-bucket/projects/{id}/photos/photo1.jpg"
    },
    "lastFrame": {
      "image": {
        "gcsUri": "gs://your-bucket/projects/{id}/photos/photo2.jpg"
      }
    }
  }],
  "parameters": {
    "sampleCount": 1,
    "durationSeconds": 4
  }
}
```

#### Настройка Vertex AI

API `aiplatform.googleapis.com` уже включён на шаге 3. Дополнительная настройка:

```bash
# Проверить, что Vertex AI API активен
gcloud services list --enabled | grep aiplatform
# Должно показать: aiplatform.googleapis.com

# Тестовый запрос к Veo (отправляет минимальный запрос на генерацию)
curl -s -w "\nHTTP_CODE: %{http_code}\n" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/$(gcloud config get-value project)/locations/us-central1/publishers/google/models/veo-2.0-generate-001:predictLongRunning" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"instances": [{"prompt": "test"}], "parameters": {"sampleCount": 1}}'
# 200 + operation name = модель доступна и работает
# 403 = нет прав или API не включён
# 429 = квота исчерпана
```

> **Внимание:** тестовый запрос выше запустит реальную генерацию (тарифицируется). Это одноразовая проверка доступа.

> **Доступность Veo:** модель Veo доступна не во всех регионах. Рекомендуемый регион — `us-central1`. Если при генерации видео вы получаете ошибку 404 или "model not found", проверьте [документацию по доступности](https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-videos).

> **Квоты:** Vertex AI имеет лимиты на количество запросов. Для нового проекта лимит может быть низким. Проверьте и при необходимости запросите увеличение: [IAM & Admin → Quotas](https://console.cloud.google.com/iam-admin/quotas) → фильтр по `aiplatform`.

> **Стоимость:** каждый вызов Veo тарифицируется. Актуальные цены: [Vertex AI Pricing](https://cloud.google.com/vertex-ai/pricing). Для разработки рекомендуется использовать минимум фото (5 штук) — это сгенерирует ~3-4 сцены.

#### Стили генерации и промпты

Бэкенд поддерживает 3 стиля, каждый с уникальным набором промптов:

| Стиль | Длительность сцены | Промпт | Камера | Цветокоррекция |
|-------|-------------------|--------|--------|---------------|
| **Memory** | 4 сек | "A warm, nostalgic memory of..." | slow gentle pan | warm vintage tones, soft golden light |
| **Cinematic** | 5 сек | "A cinematic, dramatic shot of..." | smooth dolly forward | high contrast, cool shadows |
| **Dream** | 4 сек | "A dreamy, ethereal sequence of..." | floating, slow orbit | soft focus, pastel tones, light bloom |

Storyboard выбирает до 8 лучших фото (по `qualityScore` и `order`), генерируя одну сцену на каждое фото. Соседние фото используют режим `first_last_frame` для плавных переходов.

---

### Шаг 9: Аутентификация для локальной разработки

Для локального запуска бэкенда нужны credentials, чтобы GCP SDK (Firestore, Cloud Storage, Vertex AI) мог авторизоваться. Есть два способа:

#### Способ A: Service Account Key (рекомендуется)

Service Account — это «технический аккаунт» для вашего приложения. JSON-ключ содержит `client_email`, который нужен для подписи Signed URL (загрузка/скачивание файлов из Cloud Storage). Без него `getSignedUrl()` выдаст ошибку `SigningError: Cannot sign data without client_email`.

**В Cloud Shell** создайте service account и скачайте ключ:

```bash
# Создать service account
gcloud iam service-accounts create aidream-backend \
  --display-name="AIDream Backend" \
  --project=aidream-dev

# Выдать нужные роли
gcloud projects add-iam-policy-binding aidream-dev \
  --member="serviceAccount:aidream-backend@aidream-dev.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding aidream-dev \
  --member="serviceAccount:aidream-backend@aidream-dev.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding aidream-dev \
  --member="serviceAccount:aidream-backend@aidream-dev.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Скачать JSON-ключ
gcloud iam service-accounts keys create ~/aidream-sa-key.json \
  --iam-account=aidream-backend@aidream-dev.iam.gserviceaccount.com
```

**Проверка создания:**
```bash
# Убедиться, что service account создан
gcloud iam service-accounts list --project=aidream-dev

# Убедиться, что ключ создан
ls -la ~/aidream-sa-key.json

# Посмотреть роли service account
gcloud projects get-iam-policy aidream-dev \
  --format="table(bindings.role,bindings.members)" | grep aidream-backend
```

| Роль | Зачем нужна |
|------|------------|
| `roles/storage.admin` | Загрузка/скачивание файлов, генерация Signed URL |
| `roles/datastore.user` | Чтение/запись в Firestore |
| `roles/aiplatform.user` | Вызовы Vertex AI Veo |

Затем скачайте `aidream-sa-key.json` из Cloud Shell на свой компьютер:
- В Cloud Shell нажмите **⋮** (три точки) → **Download file** → укажите путь `aidream-sa-key.json`
- Или выполните: `cloudshell download ~/aidream-sa-key.json`

Положите файл на Mac (например в `/Users/YOUR_NAME/aidream-sa-key.json`) и укажите путь в `.env`:

```env
GOOGLE_APPLICATION_CREDENTIALS=/Users/YOUR_NAME/aidream-sa-key.json
```

> **Важно:** НЕ коммитьте JSON-ключ в git! Убедитесь, что `*.json` или `*-sa-key.json` есть в `.gitignore`.

#### Способ B: Application Default Credentials (ADC)

ADC — более простой способ, но **не поддерживает подпись Signed URL** (ошибка `SigningError`). Подходит только если вы не используете `getSignedUrl()`.

```bash
# Требуется gcloud CLI на вашем компьютере
gcloud auth application-default login
```

> **Отличие от `gcloud auth login`:** `gcloud auth login` авторизует CLI-команды (`gcloud`, `gsutil`). `gcloud auth application-default login` авторизует ваш **код** (NestJS-приложение, которое использует GCP SDK).

**Проверка ADC:**
```bash
# Убедиться, что файл credentials создан
ls -la ~/.config/gcloud/application_default_credentials.json

# Проверить, что токен рабочий
gcloud auth application-default print-access-token > /dev/null 2>&1 && echo "OK: ADC работает" || echo "FAIL: ADC не настроен"

# Посмотреть текущий аккаунт gcloud
gcloud auth list
```

> **Рекомендация:** используйте **Способ A** (Service Account Key) — он работает для всех GCP-сервисов включая Signed URL, и не требует установки gcloud CLI на Mac.

### Шаг 10: Настроить .env

Скопируйте шаблон и заполните реальными значениями:

```bash
cp .env.example .env
```

```env
PORT=8080
NODE_ENV=development

# GCP — ID вашего проекта и регион
GCP_PROJECT_ID=aidream-dev
GCP_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/Users/YOUR_NAME/aidream-sa-key.json  # путь к JSON-ключу из шага 9

# Cloud Storage — имя bucket, который вы создали на шаге 5
GCS_BUCKET=aidream-media-YOUR_PROJECT_ID

# Cloud Tasks — имя очереди из шага 6 (используется только в production)
CLOUD_TASKS_QUEUE=aidream-pipeline
CLOUD_TASKS_LOCATION=us-central1

# URL бэкенда — нужен для Cloud Tasks callbacks (куда отправлять результаты задач)
BACKEND_URL=http://localhost:8080

# Firebase — обычно совпадает с GCP_PROJECT_ID
FIREBASE_PROJECT_ID=aidream-dev

# Vertex AI — модель для генерации видео
VERTEX_AI_MODEL=veo-2.0-generate-001

# Лимиты приложения
FREE_CREDITS=20                 # кредиты для новых пользователей
MAX_PHOTOS_PER_PROJECT=20       # макс. фото в одном проекте
MIN_PHOTOS_PER_PROJECT=5        # мин. фото для запуска генерации
MAX_CONCURRENT_PROJECTS=3       # макс. активных проектов на пользователя

# CORS — URL фронтенда (React dev server)
CORS_ORIGIN=http://localhost:3000
```

### Шаг 11: Запуск

```bash
npm install
npm run start:dev
```

Сервер стартует на `http://localhost:8080`.

**Проверка:**
```bash
# Health check
curl http://localhost:8080/health
# Должен вернуть: {"status":"ok"} или аналогичный ответ

# Проверить, что сервер слушает порт
lsof -i :8080 | head -5
# Или: curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health
# 200 = всё ок
```

---

## Связь с фронтендом

Фронтенд (React SPA) подключается к бэкенду по следующей схеме:

1. **Авторизация:** фронтенд получает Firebase ID token через Firebase Auth SDK и отправляет его в заголовке `Authorization: Bearer <token>` на каждый API-запрос
2. **Создание проекта:** `POST /api/projects` → возвращает `projectId`
3. **Загрузка фото:** `POST /api/projects/:id/upload-urls` → получает signed URLs → фронтенд загружает файлы напрямую в GCS по этим URL → `POST /api/projects/:id/upload-complete`
4. **Генерация:** `POST /api/projects/:id/generate` → запускает пайплайн
5. **Поллинг статуса:** `GET /api/projects/:id` → поле `status` (`processing`, `completed`, `failed`) и `currentStep` (`preprocessing`, `generating 2/5`, `assembling`)
6. **Получение результата:** `GET /api/projects/:id/result` → signed download URL для видео

Фронтенд ожидает бэкенд на `VITE_API_URL` (по умолчанию `http://localhost:8080`). В `.env` фронтенда:

```
VITE_API_URL=http://localhost:8080
```

## Переменные окружения

| Переменная | Описание | Пример |
|------------|----------|--------|
| `PORT` | Порт сервера | `8080` |
| `NODE_ENV` | Окружение (`development` / `production`) | `development` |
| `GCP_PROJECT_ID` | ID Google Cloud проекта | `aidream-dev` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Путь к JSON-ключу service account (шаг 9) | `/Users/me/aidream-sa-key.json` |
| `GCP_REGION` | Регион GCP | `us-central1` |
| `GCS_BUCKET` | Имя Cloud Storage bucket | `aidream-media-aidream-dev` |
| `CLOUD_TASKS_QUEUE` | Имя Cloud Tasks очереди | `aidream-pipeline` |
| `CLOUD_TASKS_LOCATION` | Регион Cloud Tasks | `us-central1` |
| `BACKEND_URL` | Публичный URL бэкенда (для Cloud Tasks callbacks) | `http://localhost:8080` |
| `FIREBASE_PROJECT_ID` | ID Firebase проекта | `aidream-dev` |
| `VERTEX_AI_MODEL` | Модель Vertex AI для генерации видео | `veo-2.0-generate-001` |
| `FREE_CREDITS` | Кредиты для новых пользователей | `20` |
| `MAX_PHOTOS_PER_PROJECT` | Макс. фото в проекте | `20` |
| `MIN_PHOTOS_PER_PROJECT` | Мин. фото для генерации | `5` |
| `MAX_CONCURRENT_PROJECTS` | Макс. активных проектов | `3` |
| `CORS_ORIGIN` | Разрешённый origin для CORS | `http://localhost:3000` |

## API Endpoints

### Публичные (требуют Firebase Auth token)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/projects` | Создать проект (`title`, `style`) |
| GET | `/api/projects` | Список проектов пользователя |
| GET | `/api/projects/:id` | Детали проекта + статус |
| PATCH | `/api/projects/:id` | Обновить title/style (только в статусе draft/uploaded) |
| DELETE | `/api/projects/:id` | Удалить проект (нельзя в статусе processing) |
| POST | `/api/projects/:id/upload-urls` | Получить signed URLs для загрузки фото |
| POST | `/api/projects/:id/upload-complete` | Подтвердить, что фото загружены в GCS |
| POST | `/api/projects/:id/photos/reorder` | Изменить порядок фото |
| POST | `/api/projects/:id/generate` | Запустить пайплайн генерации видео |
| GET | `/api/projects/:id/result` | Получить signed URL для скачивания видео |
| GET | `/api/users/me` | Профиль пользователя + кредиты |
| GET | `/api/users/me/credits` | Баланс кредитов + история транзакций |

### Внутренние (вызываются Cloud Tasks, защищены OIDC)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/internal/pipeline/preprocess` | Шаг 1: валидация фото |
| POST | `/internal/pipeline/storyboard` | Шаг 2: построение storyboard |
| POST | `/internal/pipeline/generate-scene` | Шаг 3: генерация одной сцены через Veo |
| POST | `/internal/pipeline/check-generation` | Шаг 4: проверка статуса операции Veo |
| POST | `/internal/pipeline/assemble` | Шаг 5: сборка финального видео |

## Пайплайн генерации видео

```
POST /api/projects/:id/generate
        │
        ▼
 [Проверка кредитов] → [Списание кредитов] → [Enqueue preprocess]
        │
        ▼
 [1. Preprocess]
 Валидация фото в GCS: проверка существования файлов, оценка quality score.
 Результат: список валидных фото с оценками.
        │
        ▼
 [2. Storyboard]
 Ранжирование фото по order и qualityScore. Выбор до 8 лучших.
 Генерация текстовых промптов для каждой сцены на основе стиля (Memory/Cinematic/Dream).
 Определение режима генерации: image_to_video или first_last_frame.
        │
        ▼
 [3. Generate Scene ×N] (параллельно)
 Для каждой сцены — POST-запрос к Vertex AI Veo.
 Передаётся: фото из GCS (gcsUri), промпт, параметры (duration, sampleCount).
 Veo возвращает operationId (генерация асинхронная, занимает 1-3 мин).
        │
        ▼
 [4. Check Generation] (поллинг каждые 30 сек)
 GET-запрос к Vertex AI для проверки статуса операции.
 Если done: false → перепланирование через Cloud Tasks с delay 30 сек.
 Если done: true → скачивание видео по videoUri, сохранение клипа в GCS.
 Когда все сцены готовы → переход к сборке.
        │
        ▼
 [5. Assemble]
 Объединение клипов в финальное видео, сохранение в GCS.
 project.status = 'completed', resultVideoPath заполнен.
```

В dev-режиме (`NODE_ENV=development`) Cloud Tasks не используются — внутренние эндпоинты вызываются напрямую по HTTP.

## Кредитная система

| Стиль | Базовая стоимость | + стоимость сцен |
|-------|-------------------|------------------|
| Memory | 5 | `min(8, ceil(photoCount × 0.6))` |
| Cinematic | 8 | `min(8, ceil(photoCount × 0.6))` |
| Dream | 7 | `min(8, ceil(photoCount × 0.6))` |

Новые пользователи получают **20 бесплатных кредитов** при первом логине. Списание происходит атомарно через Firestore Transaction.

## Локальная разработка с Docker

```bash
docker-compose up
```

Поднимает:
- **Firestore эмулятор** на порту 8081
- **Приложение** на порту 8080 (подключается к эмулятору)

Для GCS и Vertex AI в dev-режиме используется реальный GCP-проект (через Application Default Credentials).

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm run start:dev` | Запуск в dev-режиме с hot reload |
| `npm run start:debug` | Запуск с debug-портом |
| `npm run build` | Сборка в `dist/` |
| `npm run start:prod` | Запуск production-сборки |
| `npm test` | Юнит-тесты |
| `npm run test:e2e` | E2E тесты |

## Деплой на Cloud Run

```bash
# Сборка Docker-образа
docker build -t gcr.io/YOUR_PROJECT_ID/aidream-backend .

# Пуш в Container Registry
docker push gcr.io/YOUR_PROJECT_ID/aidream-backend

# Деплой на Cloud Run
gcloud run deploy aidream-backend \
  --image gcr.io/YOUR_PROJECT_ID/aidream-backend \
  --region us-central1 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars="NODE_ENV=production,GCP_PROJECT_ID=YOUR_PROJECT_ID,..."
```

Service account для Cloud Run должен иметь роли:
- `roles/datastore.user` (Firestore)
- `roles/storage.admin` (Cloud Storage)
- `roles/cloudtasks.enqueuer` (Cloud Tasks)
- `roles/aiplatform.user` (Vertex AI)

## Firestore Data Model

```
users/{uid}
  ├── email, displayName, credits (default: 20), createdAt
  └── transactions/ (subcollection)
      └── {txId}: { type, amount, projectId?, createdAt }

projects/{projectId}
  ├── userId, title, style, status, photoCount, creditsCost,
  │   currentStep, createdAt, updatedAt, resultVideoPath?, error?
  ├── photos/ (subcollection)
  │   └── {photoId}: { objectPath, originalName, contentType, size, order, qualityScore? }
  └── jobs/ (subcollection)
      └── {jobId}: { type, status, sceneIndex?, prompt?, inputPaths, outputPath?,
                      vertexOperationId?, retryCount, createdAt, completedAt?, error? }
```

## Troubleshooting

### Firebase: "The caller does not have permission" (403)

При первом использовании Firebase нужно принять Terms of Service через UI. Зайдите в [Firebase Console](https://console.firebase.google.com/), нажмите "Create a project" и выберите ваш существующий GCP-проект.

### Cloud Storage: "bucket already exists" (409)

Имена bucket глобально уникальны. Используйте формат `aidream-media-<your-project-id>`.

### Vertex AI: "model not found" (404)

Модель Veo доступна не во всех регионах. Используйте `us-central1`. Проверьте [документацию по доступности](https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-videos).

### API: "API not enabled" (403)

После включения API (`gcloud services enable ...`) подождите 1-5 минут на пропагацию.

### Billing: "billing account is disabled" (403)

Привяжите billing account: `gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID`.
