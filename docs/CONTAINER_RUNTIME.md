# Развертывание BookOrbit без Docker Desktop (Windows + WSL2 Podman / Kiri)

Данное руководство описывает запуск и эксплуатацию BookOrbit на Windows без использования проприетарного Docker Desktop.

## Требования и предварительная настройка (Prerequisites)

1. **WSL2 с дистрибутивом Linux**:
   - Рекомендуется Ubuntu 22.04 / 24.04 (`wsl --install -d Ubuntu`).
   - Имя дистрибутива по умолчанию: `Ubuntu` (при использовании другого дистрибутива укажите `WSL_DISTRO=Имя` в `.env`).
2. **Конфигурация портов в `.env`**:
   - Убедитесь, что в файле `.env` в корне репозитория задан порт приложения:
     ```bash
     APP_PORT=3500
     PORT=3000
     APP_URL=http://localhost:3500
     ```
3. **Иконка приложения**:
   - Файл `bookorbit.ico` должен находиться в корне репозитория для компиляции и отображения в системном трее.

## Архитектура решения

1. **Базовый контейнерный рантайм (WSL2 Podman)**:
   - Внутри WSL2 используется бездемоновый рантайм `podman` с движком `crun`.
   - В `/etc/containers/containers.conf` задан параметр `cgroup_manager = "cgroupfs"` для корректной работы cgroups внутри WSL2:
     ```ini
     [engine]
     cgroup_manager = "cgroupfs"
     ```
   - Запуск осуществляется через `podman compose` / `docker-compose`.

2. **База данных PostgreSQL 18 и векторный поиск**:
   - Контейнер `bookorbit-db` запускает образ `pgvector/pgvector:pg18` с расширением pgvector.
   - Данные сохраняются в `./data/postgres`.

3. **Системная служба systemd**:
   - Жизненным циклом контейнеров управляет служба `bookorbit.service`.
   - Перед установкой скорректируйте путь `WorkingDirectory` в файле `tray/bookorbit.service` под расположение вашего репозитория:
     ```bash
     sudo cp tray/bookorbit.service /etc/systemd/system/
     sudo systemctl daemon-reload
     sudo systemctl enable bookorbit.service
     ```
   - Управление: `systemctl start bookorbit` / `systemctl stop bookorbit`.

4. **Нативный диспетчер Windows Tray (`BookOrbitTray.exe`)**:
   - Написан на C# (Windows Forms / .NET Framework 4.8), компилируется через `csc.exe` без дополнительных SDK:
     ```cmd
     tray\build-tray.cmd
     ```
   - Находится в системном трее Windows, динамически считывает порт из `.env` (по умолчанию 3500), опрашивает `/api/v1/health` и предоставляет:
     - открытие веб-интерфейса в браузере;
     - безопасный запуск, остановку и перезапуск сервера (с диалогом подтверждения);
     - быстрый доступ к папкам книг (`books`), данных (`data`) и быстрой загрузки (`book-dock`);
     - просмотр живых логов контейнеров в отдельных окнах консоли;
     - динамическое копирование LAN и ZeroTier IP-адресов при открытии меню;
     - автозапуск при входе в Windows.

5. **Удаленный доступ и туннелирование**:
   - Для стабильного мобильного доступа поддерживаются:
     - ZeroTier / Tailscale (прямой IP в виртуальной сети);
     - Kiri: `kiri share 3500` для публикации временного защищенного HTTPS-туннеля.
