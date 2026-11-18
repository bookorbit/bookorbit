using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BookOrbitTrayApp
{
    static class Program
    {
        private const string MutexName = "BookOrbitTrayApp_SingleInstance_Mutex_3500";

        [STAThread]
        static void Main()
        {
            bool isNewInstance;
            using (var mutex = new Mutex(true, MutexName, out isNewInstance))
            {
                if (!isNewInstance)
                {
                    try
                    {
                        Process.Start("http://localhost:3500");
                    }
                    catch { }
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new BookOrbitTrayContext());
            }
        }
    }

    public enum ServiceState
    {
        Unknown,
        Stopped,
        Starting,
        Running,
        Stopping
    }

    public class BookOrbitTrayContext : ApplicationContext
    {
        private readonly NotifyIcon _notifyIcon;
        private readonly System.Windows.Forms.Timer _pollTimer;
        private readonly SynchronizationContext _syncContext;

        private ToolStripMenuItem _itemStatusHeader;
        private ToolStripMenuItem _itemOpenBrowser;
        private ToolStripMenuItem _itemStart;
        private ToolStripMenuItem _itemStop;
        private ToolStripMenuItem _itemRestart;
        private ToolStripMenuItem _itemAutostart;

        private ServiceState _currentState = ServiceState.Unknown;
        private DateTime _stateChangeTime = DateTime.MinValue;
        private bool _isCheckingHealth = false;

        private const string BaseUrl = "http://localhost:3500";
        private const string HealthUrl = "http://127.0.0.1:3500/api/v1/health";
        private const string AppDir = @"E:\Program Files\bookorbit";
        private const string IconPath = @"E:\Program Files\bookorbit\bookorbit.ico";
        private const string RunRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string AppRegistryName = "BookOrbitTray";

        public BookOrbitTrayContext()
        {
            _syncContext = SynchronizationContext.Current ?? new SynchronizationContext();

            var menu = new ContextMenuStrip();
            menu.Font = new Font("Segoe UI", 9F, FontStyle.Regular);
            menu.RenderMode = ToolStripRenderMode.System;

            // 1. Статусный заголовок
            _itemStatusHeader = new ToolStripMenuItem("BookOrbit: Проверка статуса...")
            {
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Enabled = false
            };
            menu.Items.Add(_itemStatusHeader);

            menu.Items.Add(new ToolStripSeparator());

            // 2. Открыть в браузере (действие по умолчанию)
            _itemOpenBrowser = new ToolStripMenuItem("Открыть в браузере (localhost:3500)", null, OnOpenBrowserClicked)
            {
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };
            menu.Items.Add(_itemOpenBrowser);

            menu.Items.Add(new ToolStripSeparator());

            // 3. Управление службой: Запуск, Остановка, Перезагрузка
            _itemStart = new ToolStripMenuItem("Запустить сервер", null, OnStartClicked);
            _itemStop = new ToolStripMenuItem("Остановить сервер...", null, OnStopClicked);
            _itemRestart = new ToolStripMenuItem("Перезагрузить сервер...", null, OnRestartClicked);

            menu.Items.Add(_itemStart);
            menu.Items.Add(_itemStop);
            menu.Items.Add(_itemRestart);

            menu.Items.Add(new ToolStripSeparator());

            // 4. Подменю Настроек и папок
            var menuSettings = new ToolStripMenuItem("Настройки и файлы");

            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Папка библиотеки книг (books)", null, (s, e) => OpenFolder(Path.Combine(AppDir, "books"))));
            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Папка данных (data)", null, (s, e) => OpenFolder(Path.Combine(AppDir, "data"))));
            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Папка быстрой загрузки книг (book-dock)", null, (s, e) => OpenFolder(Path.Combine(AppDir, @"data\app\book-dock"))));
            menuSettings.DropDownItems.Add(new ToolStripSeparator());
            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Редактировать конфигурацию (.env)...", null, (s, e) => OpenFileWithNotepad(Path.Combine(AppDir, ".env"))));
            menuSettings.DropDownItems.Add(new ToolStripSeparator());
            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Логи приложения BookOrbit (live консоль)", null, (s, e) => OpenConsoleLogs("bookorbit-app")));
            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Логи базы данных PostgreSQL (live консоль)", null, (s, e) => OpenConsoleLogs("bookorbit-db")));
            menuSettings.DropDownItems.Add(new ToolStripSeparator());

            // Копирование сетевых адресов
            string lanIp = GetLocalIpAddress();
            string zeroTierIp = GetZeroTierIpAddress();

            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Скопировать LAN-адрес (" + lanIp + ":3500)", null, (s, e) => CopyToClipboard("http://" + lanIp + ":3500", "LAN-адрес для смартфона в домашней сети Wi-Fi")));
            if (!string.IsNullOrEmpty(zeroTierIp))
            {
                menuSettings.DropDownItems.Add(new ToolStripMenuItem("Скопировать ZeroTier-адрес (" + zeroTierIp + ":3500)", null, (s, e) => CopyToClipboard("http://" + zeroTierIp + ":3500", "Удаленный ZeroTier-адрес")));
            }
            menuSettings.DropDownItems.Add(new ToolStripMenuItem("Скопировать локальный адрес (localhost:3500)", null, (s, e) => CopyToClipboard(BaseUrl, "Локальный веб-адрес")));

            menuSettings.DropDownItems.Add(new ToolStripSeparator());

            // Автозапуск
            _itemAutostart = new ToolStripMenuItem("Автозапуск трея при входе в Windows", null, OnToggleAutostart);
            _itemAutostart.Checked = IsAutostartEnabled();
            menuSettings.DropDownItems.Add(_itemAutostart);

            menu.Items.Add(menuSettings);

            menu.Items.Add(new ToolStripSeparator());

            // 5. О программе и Выход
            menu.Items.Add(new ToolStripMenuItem("О программе BookOrbit", null, OnAboutClicked));
            menu.Items.Add(new ToolStripMenuItem("Выход из трея", null, OnExitClicked));

            // Инициализация NotifyIcon
            _notifyIcon = new NotifyIcon
            {
                Text = "BookOrbit: Проверка статуса...",
                ContextMenuStrip = menu,
                Visible = true
            };

            // Загрузка иконки
            try
            {
                if (File.Exists(IconPath))
                {
                    _notifyIcon.Icon = new Icon(IconPath);
                }
                else
                {
                    _notifyIcon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                }
            }
            catch
            {
                _notifyIcon.Icon = SystemIcons.Application;
            }

            _notifyIcon.DoubleClick += (s, e) => OnOpenBrowserClicked(s, e);

            // Таймер фонового опроса статуса (каждые 2.5 секунды)
            _pollTimer = new System.Windows.Forms.Timer { Interval = 2500 };
            _pollTimer.Tick += (s, e) => CheckHealthAsync();
            _pollTimer.Start();

            // Первый опрос сразу
            CheckHealthAsync();
        }

        private void CheckHealthAsync()
        {
            if (_isCheckingHealth) return;
            _isCheckingHealth = true;

            ThreadPool.QueueUserWorkItem(state =>
            {
                bool isHealthy = false;
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(HealthUrl);
                    req.Timeout = 1200;
                    req.ReadWriteTimeout = 1200;
                    req.Method = "GET";
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                        if (resp.StatusCode == HttpStatusCode.OK)
                        {
                            isHealthy = true;
                        }
                    }
                }
                catch
                {
                    isHealthy = false;
                }

                _syncContext.Post(s =>
                {
                    _isCheckingHealth = false;
                    UpdateStateFromHealth(isHealthy);
                }, null);
            });
        }

        private void UpdateStateFromHealth(bool isHealthy)
        {
            if (isHealthy)
            {
                _currentState = ServiceState.Running;
                _itemStatusHeader.Text = "[●] BookOrbit: Работает (порт 3500)";
                _notifyIcon.Text = "BookOrbit: Работает (порт 3500)";
                _itemStart.Enabled = false;
                _itemStop.Enabled = true;
                _itemRestart.Enabled = true;
            }
            else
            {
                if (_currentState == ServiceState.Starting && (DateTime.Now - _stateChangeTime).TotalSeconds < 25)
                {
                    _itemStatusHeader.Text = "[◌] BookOrbit: Запуск службы...";
                    _notifyIcon.Text = "BookOrbit: Запуск службы...";
                    _itemStart.Enabled = false;
                    _itemStop.Enabled = true;
                    _itemRestart.Enabled = false;
                }
                else if (_currentState == ServiceState.Stopping && (DateTime.Now - _stateChangeTime).TotalSeconds < 10)
                {
                    _itemStatusHeader.Text = "[◌] BookOrbit: Остановка...";
                    _notifyIcon.Text = "BookOrbit: Остановка...";
                    _itemStart.Enabled = false;
                    _itemStop.Enabled = false;
                    _itemRestart.Enabled = false;
                }
                else
                {
                    _currentState = ServiceState.Stopped;
                    _itemStatusHeader.Text = "[○] BookOrbit: Остановлен";
                    _notifyIcon.Text = "BookOrbit: Остановлен";
                    _itemStart.Enabled = true;
                    _itemStop.Enabled = false;
                    _itemRestart.Enabled = false;
                }
            }
        }

        private void OnOpenBrowserClicked(object sender, EventArgs e)
        {
            if (_currentState == ServiceState.Stopped)
            {
                var answer = MessageBox.Show(
                    "Сервер BookOrbit сейчас остановлен.\nЗапустить службу и открыть сайт?",
                    "BookOrbit остановлен",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (answer == DialogResult.Yes)
                {
                    StartService();
                    ThreadPool.QueueUserWorkItem(st =>
                    {
                        for (int i = 0; i < 20; i++)
                        {
                            Thread.Sleep(1000);
                            try
                            {
                                var req = (HttpWebRequest)WebRequest.Create(HealthUrl);
                                req.Timeout = 1000;
                                using (var resp = (HttpWebResponse)req.GetResponse())
                                {
                                    if (resp.StatusCode == HttpStatusCode.OK)
                                    {
                                        Process.Start(BaseUrl);
                                        return;
                                    }
                                }
                            }
                            catch { }
                        }
                    });
                    return;
                }
                return;
            }

            try
            {
                Process.Start(BaseUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось открыть браузер: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OnStartClicked(object sender, EventArgs e)
        {
            StartService();
        }

        private void StartService()
        {
            _currentState = ServiceState.Starting;
            _stateChangeTime = DateTime.Now;
            UpdateStateFromHealth(false);

            ShowBalloon("Запуск BookOrbit...", "Служба запускается в фоне, пожалуйста подождите.", ToolTipIcon.Info);

            ThreadPool.QueueUserWorkItem(s =>
            {
                RunWslCommand("systemctl start bookorbit.service", true);
                _syncContext.Post(st => CheckHealthAsync(), null);
            });
        }

        private void OnStopClicked(object sender, EventArgs e)
        {
            var confirm = MessageBox.Show(
                "Остановить сервер BookOrbit?\n\nВсе активные подключения и фоновые процессы будут остановлены.",
                "Остановка сервера BookOrbit",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );

            if (confirm != DialogResult.Yes)
            {
                return;
            }

            _currentState = ServiceState.Stopping;
            _stateChangeTime = DateTime.Now;
            UpdateStateFromHealth(false);

            ShowBalloon("Остановка BookOrbit...", "Служба останавливается.", ToolTipIcon.Info);

            ThreadPool.QueueUserWorkItem(s =>
            {
                RunWslCommand("systemctl stop bookorbit.service", true);
                _syncContext.Post(st =>
                {
                    _currentState = ServiceState.Stopped;
                    UpdateStateFromHealth(false);
                    ShowBalloon("BookOrbit остановлен", "Контейнеры BookOrbit успешно остановлены.", ToolTipIcon.None);
                }, null);
            });
        }

        private void OnRestartClicked(object sender, EventArgs e)
        {
            var confirm = MessageBox.Show(
                "Вы уверены, что хотите перезагрузить сервер BookOrbit?\n\nВсе активные сессии чтения и синхронизации будут временно приостановлены на несколько секунд.",
                "Подтверждение перезагрузки BookOrbit",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );

            if (confirm != DialogResult.Yes)
            {
                return;
            }

            _currentState = ServiceState.Starting;
            _stateChangeTime = DateTime.Now;
            UpdateStateFromHealth(false);

            ShowBalloon("Перезагрузка BookOrbit...", "Служба перезапускается, ожидаем готовности сервера.", ToolTipIcon.Info);

            ThreadPool.QueueUserWorkItem(s =>
            {
                RunWslCommand("systemctl restart bookorbit.service", true);
                for (int i = 0; i < 25; i++)
                {
                    Thread.Sleep(1000);
                    try
                    {
                        var req = (HttpWebRequest)WebRequest.Create(HealthUrl);
                        req.Timeout = 1000;
                        using (var resp = (HttpWebResponse)req.GetResponse())
                        {
                            if (resp.StatusCode == HttpStatusCode.OK)
                            {
                                _syncContext.Post(st =>
                                {
                                    UpdateStateFromHealth(true);
                                    ShowBalloon("BookOrbit перезагружен!", "Сервер успешно перезапущен и готов к работе на http://localhost:3500", ToolTipIcon.Info);
                                }, null);
                                return;
                            }
                        }
                    }
                    catch { }
                }

                _syncContext.Post(st => CheckHealthAsync(), null);
            });
        }

        private void OpenFolder(string path)
        {
            try
            {
                if (!Directory.Exists(path))
                {
                    Directory.CreateDirectory(path);
                }
                Process.Start("explorer.exe", "\"" + path + "\"");
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось открыть папку: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenOpenFileWithNotepad(string filePath)
        {
            try
            {
                if (File.Exists(filePath))
                {
                    Process.Start("notepad.exe", "\"" + filePath + "\"");
                }
                else
                {
                    MessageBox.Show("Файл не найден: " + filePath, "Внимание", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Ошибка открытия файла: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenFileWithNotepad(string filePath)
        {
            OpenOpenFileWithNotepad(filePath);
        }

        private void OpenConsoleLogs(string containerName)
        {
            try
            {
                string title = "Логи BookOrbit: " + containerName;
                string cmd = string.Format("/c \"title {0} && wsl.exe -d Ubuntu -u root -- podman logs -f {1}\"", title, containerName);
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = cmd,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось запустить окно логов: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void CopyToClipboard(string text, string description)
        {
            try
            {
                Clipboard.SetText(text);
                ShowBalloon("Адрес скопирован в буфер", description + ":\n" + text, ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось скопировать в буфер: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private bool IsAutostartEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunRegistryKey, false))
                {
                    if (key == null) return false;
                    var val = key.GetValue(AppRegistryName);
                    return val != null;
                }
            }
            catch
            {
                return false;
            }
        }

        private void OnToggleAutostart(object sender, EventArgs e)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunRegistryKey, true))
                {
                    if (key == null) return;

                    if (_itemAutostart.Checked)
                    {
                        key.DeleteValue(AppRegistryName, false);
                        _itemAutostart.Checked = false;
                        ShowBalloon("Автозапуск", "Автозапуск трея BookOrbit отключен.", ToolTipIcon.None);
                    }
                    else
                    {
                        string exePath = "\"" + Application.ExecutablePath + "\"";
                        key.SetValue(AppRegistryName, exePath);
                        _itemAutostart.Checked = true;
                        ShowBalloon("Автозапуск", "Автозапуск трея BookOrbit включен.", ToolTipIcon.Info);
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось изменить настройку автозапуска: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OnAboutClicked(object sender, EventArgs e)
        {
            MessageBox.Show(
                "BookOrbit Tray Manager\n\n" +
                "Управление локальным сервером чтения электронных книг BookOrbit.\n" +
                "Версия: 1.0.0\n" +
                "Порт веб-интерфейса: 3500\n" +
                "Путь установки: E:\\Program Files\\bookorbit\n\n" +
                "База данных: PostgreSQL 18 (pgvector)\n" +
                "Контейнеры: Podman (WSL2 Ubuntu)",
                "О программе BookOrbit",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
        }

        private void OnExitClicked(object sender, EventArgs e)
        {
            if (_currentState == ServiceState.Running)
            {
                var choice = MessageBox.Show(
                    "Остановить сервер BookOrbit перед выходом из трея?\n\n" +
                    "- 'Да' - остановить сервер и закрыть трей\n" +
                    "- 'Нет' - оставить сервер работать в фоне и закрыть только меню трея\n" +
                    "- 'Отмена' - остаться в трее",
                    "Выход из BookOrbit Tray",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Question
                );

                if (choice == DialogResult.Cancel)
                {
                    return;
                }

                if (choice == DialogResult.Yes)
                {
                    RunWslCommand("systemctl stop bookorbit.service", false);
                }
            }

            _pollTimer.Stop();
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            Application.Exit();
        }

        private void ShowBalloon(string title, string text, ToolTipIcon icon)
        {
            try
            {
                _notifyIcon.ShowBalloonTip(3000, title, text, icon);
            }
            catch { }
        }

        private static void RunWslCommand(string args, bool wait)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "wsl.exe",
                    Arguments = "-d Ubuntu -u root -- " + args,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                var p = Process.Start(psi);
                if (wait && p != null)
                {
                    p.WaitForExit(40000);
                }
            }
            catch { }
        }

        private static string GetLocalIpAddress()
        {
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up ||
                        ni.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                        continue;

                    var props = ni.GetIPProperties();
                    foreach (var addr in props.UnicastAddresses)
                    {
                        if (addr.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                        {
                            string ip = addr.Address.ToString();
                            if (ip.StartsWith("192.168.")) return ip;
                        }
                    }
                }

                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up ||
                        ni.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                        continue;

                    var props = ni.GetIPProperties();
                    foreach (var addr in props.UnicastAddresses)
                    {
                        if (addr.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                        {
                            string ip = addr.Address.ToString();
                            if (!ip.StartsWith("127.") && !ip.StartsWith("169.254.")) return ip;
                        }
                    }
                }
            }
            catch { }
            return "127.0.0.1";
        }

        private static string GetZeroTierIpAddress()
        {
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.Description.IndexOf("ZeroTier", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        ni.Name.IndexOf("ZeroTier", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        if (ni.OperationalStatus != OperationalStatus.Up) continue;
                        var props = ni.GetIPProperties();
                        foreach (var addr in props.UnicastAddresses)
                        {
                            if (addr.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                            {
                                return addr.Address.ToString();
                            }
                        }
                    }
                }
            }
            catch { }
            return null;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (_pollTimer != null) _pollTimer.Dispose();
                if (_notifyIcon != null) _notifyIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
