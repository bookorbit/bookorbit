# Развертывание BookOrbit без Docker Desktop (Windows + WSL2 Podman / Kiri)

Данное руководство описывает запуск и эксплуатацию BookOrbit на Windows без использования проприетарного и тяжелого Docker Desktop.

## Архитектура решения

1. **Базовый контейнерный рантайм (WSL2 Podman)**:
   - Внутри WSL2 (Ubuntu 24.04) используется бездемоновый (daemonless) рантайм `podman` с низкоуровневым движком `crun`.
   - В `/etc/containers/containers.conf` задан параметр `cgroup_manager = "cgroupfs"` для устранения несовместимости делегирования cgroups v2 внутри виртуальной машины WSL2.
   - Поддерживаются стандартные команды `podman compose` / `docker compose`.

2. **База данных PostgreSQL 18 и векторный поиск**:
   - Контейнер `bookorbit-db` запускает образ `pgvector/pgvector:pg18` с расширением pgvector для семантического поиска книг.
   - Данные монтируются в локальную директорию `./data/postgres`.

3. **Системная служба systemd**:
   - Жизненным циклом контейнеров управляет служба `bookorbit.service`:
     ```bash
     sudo cp tray/bookorbit.service /etc/systemd/system/
     sudo systemctl daemon-reload
     sudo systemctl enable bookorbit.service
     ```
   - Запуск и остановка выполняются стандартно: `systemctl start bookorbit` / `systemctl stop bookorbit`.

4. **Нативный диспетчер Windows Tray (`BookOrbitTray.exe`)**:
   - Написан на C# (Windows Forms / .NET Framework 4.8), компилируется системным `csc.exe` без установки внешних SDK:
     ```cmd
     tray\build-tray.cmd
     ```
   - Находится в области уведомлений Windows (системный трей), динамически отслеживает состояние через `/api/v1/health` (порт 3500) и позволяет:
     - открывать веб-интерфейс в один клик;
     - безопасно останавливать и перезапускать сервер (с диалогом подтверждения);
     - открывать папки библиотеки книг (`books`) и данных (`data`);
     - просматривать живые логи контейнеров в реальном времени;
     - копировать локальный IP-адрес для доступа со смартфона по Wi-Fi;
     - включать/выключать автозапуск при входе в Windows.

5. **Удаленный доступ и туннелирование**:
   - Для доступа за пределами домашней сети (динамический IP / мобильный интернет) поддерживаются:
     - ZeroTier / Tailscale (прямой IP-адрес);
     - легковесный Rust-рантайм Kiri: `kiri share 3500` для публикации временного HTTPS-туннеля.
