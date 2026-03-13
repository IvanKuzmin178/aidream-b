# Debugging Vertex AI (Veo) Video Generation

Руководство по отладке, мониторингу и ручному тестированию интеграции с Vertex AI Veo 2.0.

## Содержание

- [Архитектура pipeline](#архитектура-pipeline)
- [Ручной запрос к Veo через curl](#ручной-запрос-к-veo-через-curl)
- [Проверка статуса операции](#проверка-статуса-операции)
- [Получение результата (видео)](#получение-результата-видео)
- [Мониторинг в GCP Console](#мониторинг-в-gcp-console)
- [Дебаг pipeline через Firestore](#дебаг-pipeline-через-firestore)
- [Типичные ошибки и их причины](#типичные-ошибки-и-их-причины)
- [Сброс failed проекта](#сброс-failed-проекта)
- [Полезные ссылки](#полезные-ссылки)

---

## Архитектура pipeline

```
POST /api/projects/:id/generate
  │
  ├─ startGeneration()          → списание кредитов, создание job
  │
  ├─ [Cloud Tasks] preprocess   → проверка фото в GCS, quality scoring
  │
  ├─ [Cloud Tasks] storyboard   → разбиение на сцены, генерация промптов
  │
  ├─ [Cloud Tasks] generate-scene (×N параллельно)
  │   └─ predictLongRunning → Veo 2.0 API
  │
  ├─ [Cloud Tasks] check-generation (polling каждые 30 сек)
  │   └─ fetchPredictOperation → проверка статуса
  │   └─ при done=true → копирование видео в clips/
  │
  └─ [Cloud Tasks] assemble     → сборка финального видео
```

---

## Ручной запрос к Veo через curl

### Подготовка

```bash
# Убедиться что авторизован
gcloud auth list

# Получить токен (действует ~1 час)
gcloud auth print-access-token
```

### Переменные (подставь свои)

```bash
PROJECT_ID="aidream-dev"
REGION="us-central1"
MODEL="veo-2.0-generate-001"
BUCKET="aidream-media-aidream-dev"
```

### Text-to-video (самый простой тест)

```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL}:predictLongRunning" \
  -d '{
    "instances": [
      {
        "prompt": "A golden retriever playing in a sunlit meadow, slow motion, cinematic"
      }
    ],
    "parameters": {
      "sampleCount": 1,
      "durationSeconds": 5,
      "storageUri": "gs://'"${BUCKET}"'/veo-test-output"
    }
  }'
```

Ответ:
```json
{
  "name": "projects/123456789/locations/us-central1/publishers/google/models/veo-2.0-generate-001/operations/a1b07c8e-7b5a-4aba-bb34-3e1ccb8afcc8"
}
```

Сохрани `name` целиком -- это operation ID для следующего шага.

### Image-to-video (с base64 изображением)

```bash
# Закодировать изображение в base64
IMG_B64=$(base64 -i /path/to/test-image.jpg)

# Создать файл запроса (base64 может быть большим)
cat > /tmp/veo-img2vid.json << EOF
{
  "instances": [
    {
      "prompt": "Bring this photo to life with gentle camera movement and warm light",
      "image": {
        "bytesBase64Encoded": "${IMG_B64}",
        "mimeType": "image/jpeg"
      }
    }
  ],
  "parameters": {
    "sampleCount": 1,
    "durationSeconds": 5,
    "storageUri": "gs://${BUCKET}/veo-test-output"
  }
}
EOF

# Отправить
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d @/tmp/veo-img2vid.json \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL}:predictLongRunning"
```

### First-last-frame (два фото → переход)

```bash
IMG1_B64=$(base64 -i /path/to/first.jpg)
IMG2_B64=$(base64 -i /path/to/last.jpg)

cat > /tmp/veo-flf.json << EOF
{
  "instances": [
    {
      "prompt": "Smooth cinematic transition between two moments",
      "image": {
        "bytesBase64Encoded": "${IMG1_B64}",
        "mimeType": "image/jpeg"
      },
      "lastFrame": {
        "bytesBase64Encoded": "${IMG2_B64}",
        "mimeType": "image/jpeg"
      }
    }
  ],
  "parameters": {
    "sampleCount": 1,
    "durationSeconds": 5,
    "storageUri": "gs://${BUCKET}/veo-test-output"
  }
}
EOF

curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d @/tmp/veo-flf.json \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL}:predictLongRunning"
```

---

## Проверка статуса операции

**ВАЖНО:** Для Veo используется **POST** к `fetchPredictOperation`, а не GET на URL операции.

```bash
OPERATION_NAME="projects/123456789/locations/us-central1/publishers/google/models/veo-2.0-generate-001/operations/a1b07c8e-..."

curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL}:fetchPredictOperation" \
  -d '{
    "operationName": "'"${OPERATION_NAME}"'"
  }'
```

### Ответ: операция в процессе

```json
{
  "name": "projects/.../operations/...",
  "done": false
}
```

### Ответ: операция завершена

```json
{
  "name": "projects/.../operations/...",
  "done": true,
  "response": {
    "@type": "type.googleapis.com/cloud.ai.large_models.vision.GenerateVideoResponse",
    "raiMediaFilteredCount": 0,
    "videos": [
      {
        "gcsUri": "gs://aidream-media-aidream-dev/veo-test-output/1234567890/sample_0.mp4",
        "mimeType": "video/mp4"
      }
    ]
  }
}
```

### Ответ: ошибка

```json
{
  "name": "projects/.../operations/...",
  "done": true,
  "error": {
    "code": 3,
    "message": "Video generation failed due to content policy violations"
  }
}
```

### Автоматический polling (bash-скрипт)

```bash
OPERATION_NAME="projects/.../operations/..."

while true; do
  RESULT=$(curl -s -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL}:fetchPredictOperation" \
    -d '{"operationName": "'"${OPERATION_NAME}"'"}')

  DONE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('done', False))")

  echo "$(date +%H:%M:%S) done=$DONE"

  if [ "$DONE" = "True" ]; then
    echo "$RESULT" | python3 -m json.tool
    break
  fi

  sleep 20
done
```

---

## Получение результата (видео)

Если в `parameters` был указан `storageUri`, видео будет в GCS:

```bash
# Посмотреть файлы в output-директории
gsutil ls gs://${BUCKET}/veo-output/
gsutil ls gs://${BUCKET}/veo-test-output/

# Скачать видео
gsutil cp "gs://${BUCKET}/veo-test-output/TIMESTAMP_FOLDER/sample_0.mp4" ./output.mp4

# Или скачать всё разом
gsutil -m cp -r "gs://${BUCKET}/veo-output/" ./local-output/
```

Если `storageUri` не был указан, видео вернётся в ответе как base64:
```json
{
  "videos": [{ "bytesBase64Encoded": "AAAAIGZ0eXBp...", "mimeType": "video/mp4" }]
}
```

Декодирование:
```bash
echo "$RESULT" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
video = data['response']['videos'][0]
with open('output.mp4', 'wb') as f:
    f.write(base64.b64decode(video['bytesBase64Encoded']))
print('Saved output.mp4')
"
```

---

## Мониторинг в GCP Console

### 1. Vertex AI Studio (попробовать генерацию руками)

Прямая ссылка:
```
https://console.cloud.google.com/vertex-ai/studio/media?project=aidream-dev
```

Здесь можно:
- Загрузить фото и сгенерировать видео через UI
- Выбрать модель (veo-2.0-generate-001)
- Протестировать промпты
- Посмотреть результат прямо в браузере

### 2. Model Observability (метрики API)

```
https://console.cloud.google.com/vertex-ai/dashboard?project=aidream-dev
```

Показывает:
- Количество запросов (QPS)
- Latency (задержка ответа)
- Error rate (процент ошибок)
- Фильтр по модели и региону

### 3. Billing & Cost Management

```
https://console.cloud.google.com/billing?project=aidream-dev
```

Для детального разбора:
```
https://console.cloud.google.com/billing/linkedaccount/reports?project=aidream-dev
```

Фильтруй по:
- **Service**: "Vertex AI"
- **SKU**: ищи "Veo" или "Video Generation"
- **Period**: нужный диапазон дат

**Стоимость Veo 2.0** (ориентировочно):
- ~$0.35 за секунду сгенерированного видео
- 5-секундное видео ≈ $1.75
- 8-секундное видео ≈ $2.80

### 4. Cloud Storage (проверка файлов)

```
https://console.cloud.google.com/storage/browser/aidream-media-aidream-dev?project=aidream-dev
```

Ключевые пути:
- `projects/<id>/photos/` — загруженные фото
- `projects/<id>/clips/` — сгенерированные клипы
- `projects/<id>/output/` — финальное видео
- `veo-output/` — raw output от Veo (с timestamp-подпапками)

### 5. Cloud Logging (логи бэкенда в проде)

```
https://console.cloud.google.com/logs/query?project=aidream-dev
```

Полезные фильтры:
```
resource.type="cloud_run_revision"
jsonPayload.message=~"Veo|Vertex|Pipeline|generation"
```

---

## Дебаг pipeline через Firestore

### Firestore Console

```
https://console.cloud.google.com/firestore/databases/(default)/data?project=aidream-dev
```

### Структура данных

```
projects/{projectId}
  ├─ status: "draft" | "uploaded" | "processing" | "completed" | "failed"
  ├─ currentStep: "queued" | "preprocessing" | "building storyboard" | "generating 1/2" | "assembling" | "completed" | "failed"
  ├─ error: "..." (если failed)
  ├─ resultVideoPath: "projects/.../output/final.mp4"
  │
  ├─ photos/{photoId}
  │   ├─ objectPath: "projects/.../photos/uuid-filename.jpg"
  │   ├─ order: 0
  │   └─ size: 1234567
  │
  └─ jobs/{jobId}
      ├─ type: "preprocess" | "storyboard" | "generate_scene" | "check_generation" | "assemble"
      ├─ status: "queued" | "running" | "completed" | "failed"
      ├─ sceneIndex: 0
      ├─ prompt: "A warm, nostalgic memory of..."
      ├─ inputPaths: ["projects/.../photos/uuid.jpg"]
      ├─ vertexOperationId: "projects/.../operations/..."
      ├─ outputPath: "projects/.../clips/scene-0.mp4"
      ├─ error: "..." (если failed)
      ├─ createdAt: timestamp
      └─ completedAt: timestamp
```

### Проверка через gcloud CLI

```bash
# Посмотреть статус проекта
gcloud firestore documents get \
  projects/aidream-dev/databases/'(default)'/documents/projects/PROJECT_ID

# Посмотреть все jobs проекта
gcloud firestore documents list \
  projects/aidream-dev/databases/'(default)'/documents/projects/PROJECT_ID/jobs

# Посмотреть конкретный job
gcloud firestore documents get \
  projects/aidream-dev/databases/'(default)'/documents/projects/PROJECT_ID/jobs/JOB_ID
```

### Что искать при дебаге

1. **Проект в статусе `failed`** → смотри поле `error`
2. **Job с `type: "generate_scene"` в `failed`** → ошибка Veo API
3. **Job с `type: "check_generation"` в `failed`** → ошибка polling
4. **`vertexOperationId` в job** → используй для ручной проверки через `fetchPredictOperation`

---

## Типичные ошибки и их причины

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `image is empty` (400) | Vertex AI не может прочитать изображение по gcsUri | Отправлять изображения как base64 (уже исправлено) |
| `Operation check failed: 404` | Использовался GET вместо POST fetchPredictOperation | Исправлено на POST fetchPredictOperation |
| `INVALID_ARGUMENT` (400) | Неверный формат запроса (например, durationSeconds < 5 для Veo 2) | Проверить тело запроса, duration >= 5 |
| `PERMISSION_DENIED` (403) | Нет доступа к Vertex AI API | Проверить IAM роли, включить API |
| `RESOURCE_EXHAUSTED` (429) | Превышен лимит запросов | Подождать, настроить retry с backoff |
| `content policy violation` | Veo отклонил промпт/изображение по RAI policy | Изменить промпт, использовать другое фото |
| `Insufficient credits` | Мало кредитов в приложении | Проверить баланс через `GET /api/users/me` |

---

## Сброс failed проекта

### Через gcloud

```bash
PROJECT_DOC="projects/aidream-dev/databases/(default)/documents/projects/YOUR_PROJECT_ID"

gcloud firestore documents update "$PROJECT_DOC" \
  --update-fields='status=uploaded,currentStep=ready,error='
```

### Через Firebase Admin SDK (Node.js скрипт)

```javascript
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

async function resetProject(projectId) {
  await db.doc(`projects/${projectId}`).update({
    status: 'uploaded',
    currentStep: 'ready',
    error: admin.firestore.FieldValue.delete(),
  });

  // Удалить старые jobs
  const jobs = await db.collection(`projects/${projectId}/jobs`).get();
  const batch = db.batch();
  jobs.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  console.log(`Project ${projectId} reset to 'uploaded'`);
}

resetProject('YOUR_PROJECT_ID');
```

---

## Полезные ссылки

- [Veo API Reference](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation)
- [Image-to-Video Guide](https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-an-image)
- [First-Last Frame Guide](https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-first-and-last-frames)
- [Veo 2 Model Card](https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo/2-0-generate)
- [Model Observability](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-observability)
- [Vertex AI Studio](https://console.cloud.google.com/vertex-ai/studio/media)
- [Vertex AI Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
