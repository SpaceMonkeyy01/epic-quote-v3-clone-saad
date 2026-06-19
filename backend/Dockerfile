FROM php:8.3-cli

# System deps + PHP extensions (pdo_mysql for the eventual MySQL; pdo_sqlite ships enabled)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libzip-dev zip unzip git \
 && docker-php-ext-install pdo pdo_mysql zip \
 && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY . .
# Runtime dirs MUST exist before composer install — package:discover writes bootstrap/cache,
# and .gitignore/.dockerignore strip these (empty) dirs from the build context.
RUN mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views \
            storage/logs storage/app/public bootstrap/cache \
 && chmod -R 775 storage bootstrap/cache

RUN composer install --no-dev --optimize-autoloader --no-interaction

ENV APP_ENV=production
ENV APP_DEBUG=false

EXPOSE 8000

# On boot: ensure the sqlite file exists (fresh persistent disk), migrate, seed
# (idempotent updateOrCreate), link storage, then serve on Render's $PORT.
CMD mkdir -p "$(dirname "${DB_DATABASE:-/app/database/database.sqlite}")" \
 && touch "${DB_DATABASE:-/app/database/database.sqlite}" \
 && php artisan migrate --force \
 && php artisan db:seed --force \
 && (php artisan storage:link || true) \
 && php artisan serve --host 0.0.0.0 --port "${PORT:-8000}"
