# Права токена для автоматической публикации

Проверка 6 ноября 2026 подтвердила: секрет GitHub подключён и Supabase распознаёт его, но `POST /projects` возвращает **403 — отказ по правам доступа**. Существующих доступных проектов в выбранной организации: **0**. Создать базу с текущими разрешениями невозможно.

Согласие на настройку уже дано. Осталось выдать технические права ключу; сам ключ не может повысить свои разрешения. Интерфейс Supabase показывает выданные права существующего scoped-токена для просмотра; для другого набора прав создайте новый токен.

1. Откройте https://supabase.com/dashboard/account/tokens и нажмите **Generate new token**.
2. Выберите **Organization** и только ту организацию, которую вы подготовили для форума.
3. Оставьте **Preset · No access**, затем задайте указанные ниже значения. Названия сверены с официальным исходным кодом формы Supabase.

| Раздел                   | Поле                      | Значение       |
| ------------------------ | ------------------------- | -------------- |
| Account and organization | Organizations             | Read           |
| Account and organization | Projects (account-wide)   | Read           |
| Account and organization | Organization Settings     | Read           |
| Account and organization | Organization Members      | Read           |
| Account and organization | **Organization Projects** | **Read-write** |
| Project                  | Project Settings          | Read-write     |
| Database                 | Database                  | Read-write     |
| Application services     | Auth Config               | Read-write     |
| Application services     | API Keys                  | Read           |
| Application services     | API Key Secrets           | Read           |

**Все остальные поля оставьте None**, включая Infrastructure and delivery. Полный доступ к аккаунту и Legacy token не требуются. Read-write нужен для создания проекта, схемы базы и настройки входа. Read у API Key Secrets необходим автоматизации для получения серверного ключа: он используется только в защищённом runner и проверяется на отсутствие в клиентском bundle.

4. Нажмите **Review access**, проверьте выбранную организацию, задайте имя `forumdialog`, срок 30 дней и подтвердите создание.
5. Скопируйте токен в защищённое поле обновления существующего секрета GitHub:
   https://github.com/iriniLou/forumdialog/settings/secrets/actions/SUPABASE_ACCESS_TOKEN
   Нажмите **Update secret**. Если ссылка не открывает форму, откройте https://github.com/iriniLou/forumdialog/settings/secrets/actions и нажмите карандаш рядом с `SUPABASE_ACCESS_TOKEN`.

Не отправляйте токен в переписку. Предыдущий токен можно отозвать после успешной замены. После сообщения об обновлении агент запускает публикацию с уже полученным согласием; повторно разрешать коммит или развёртывание не требуется.

Работа сайта ещё не подтверждена. QR и три ссылки выдаются после успешной проверки опубликованного приложения с общей базой.
