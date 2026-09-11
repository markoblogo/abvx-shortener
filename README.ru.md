# ABVX Shortener

[English README](README.md)

Самостоятельно размещаемый сервис коротких ссылок на Cloudflare Workers + KV. Вы сохраняете собственный домен и контроль над данными, а клиенты получают web-форму, CLI и Chrome-расширение.

## Возможности

- одинаковый нормализованный URL получает одинаковый короткий slug;
- собственные alias, срок действия, fallback и редиректы `301`/`302`;
- просмотр, изменение, отключение и экспорт ссылок;
- роли `reader`, `writer`, `admin` и смена API-ключей;
- собственные операционные счётчики без сторонней аналитики.

## Быстрый запуск

```bash
git clone https://github.com/markoblogo/abvx-shortener.git
cd abvx-shortener/worker
npm ci
npx wrangler login
npx wrangler kv namespace create LINKS
```

Вставьте полученный ID namespace в `worker/wrangler.toml`, затем сохраните секрет и разверните Worker:

```bash
npx wrangler secret put API_KEY
npm run deploy
curl --fail https://ваш-домен.example/health
```

Все переменные перечислены в [docs/configuration.md](docs/configuration.md), API — в [docs/api.md](docs/api.md), обновление и миграция — в [docs/ops.md](docs/ops.md) и [docs/migration.md](docs/migration.md).

## Локальная проверка

```bash
cd worker
npm run check
npx wrangler dev
```

Версия `v0.3.1` использует Wrangler 4, нативный Cloudflare rate limiter, SHA-256 для хешированных API-ключей и fail-closed разбор конфигурации ключей.
