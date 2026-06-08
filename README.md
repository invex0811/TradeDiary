# Trade Diary

Тёмный трейд-дневник с Google Auth, серверной интеграцией BingX и демо-данными для разработки.

## Запуск

1. Скопируй `.env.example` в `.env`.
2. Добавь Firebase web config и новые BingX API ключи.
3. В Firebase Console включи `Authentication -> Sign-in method -> Google`.
4. Добавь `localhost` и домен приложения в `Authentication -> Settings -> Authorized domains`.
5. Установи зависимости и запусти проект:

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`  
API: `http://localhost:8787`

## GitHub Pages

GitHub Pages хостит только frontend. Express API из `server/index.ts` нужно деплоить отдельно
на Render, Railway, Fly.io, VPS или другой Node.js-хостинг. После деплоя backend добавь его URL
в `VITE_API_BASE_URL`.

1. В GitHub репозитории открой `Settings -> Pages -> Build and deployment`.
2. Выбери `Source: GitHub Actions`.
3. В `Settings -> Secrets and variables -> Actions -> Variables` добавь:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_API_BASE_URL
```

4. Добавь GitHub Pages домен в Firebase:
   `Authentication -> Settings -> Authorized domains`.
5. Запушь `master` или `main` - workflow `.github/workflows/pages.yml` соберёт `dist`
   и опубликует сайт.

## Безопасность

- BingX API Key и Secret Key используются только на сервере.
- Не добавляй секреты в переменные с префиксом `VITE_`.
- Создай BingX ключ только с правами чтения и IP whitelist.
- Ключи, отправленные в чате, следует отозвать и перевыпустить.
- Для отображения сделок включи у ключа права чтения Futures/Perpetual Swap: баланс, позиции, история сделок.

## API

Сервер подписывает запросы HMAC SHA256 и запрашивает:

- `/openApi/swap/v2/user/balance`
- `/openApi/swap/v2/user/positions`
- `/openApi/swap/v2/trade/allFillOrders`
- `/openApi/swap/v2/trade/allOrders` как fallback

Frontend запрашивает `/api/dashboard?days=730`. Сервер режет Futures историю на 7-дневные окна, затем объединяет и дедуплицирует сделки.

## Подключение BingX

1. В BingX создай новый API key.
2. Разрешения: read-only, без торговли и вывода средств.
3. Если включён IP whitelist, добавь IP машины, где запущен сервер.
4. В `.env` добавь:

```env
BINGX_API_KEY=новый_api_key
BINGX_SECRET_KEY=новый_secret_key
```

5. Перезапусти сервер: `npm run dev`.
6. Войди через Google и нажми `Синхронизировать BingX`.

## Firestore cache

Сайт читает сделки из Firestore, а BingX API вызывается только при ручной синхронизации.

Структура:

```text
users/{uid}/trades/{tradeId}
users/{uid}/meta/bingx
```

Минимальные Firestore rules:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
