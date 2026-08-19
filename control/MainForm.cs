using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using ObaraServiceController.Models;
using ObaraServiceController.Utils;

namespace ObaraServiceController
{
    public partial class MainForm : Form
    {
        private readonly ProcessManager _processManager;
        private readonly ServiceConfig _config;
        private readonly System.Windows.Forms.Timer _monitorTimer;
        private readonly System.Windows.Forms.Timer _animationTimer;
        private readonly System.Windows.Forms.Timer _logFlushTimer;
        private readonly ConcurrentQueue<string> _logQueue = new ConcurrentQueue<string>();

        private ServiceStatus _backendStatus;
        private ServiceStatus _frontendStatus;
        private int _backendLatency;
        private int _frontendLatency;
        private int _animationFrame;

        private bool _isDragging;
        private Point _dragOffset;
        private bool _isMaximized;
        private Rectangle _normalBounds;
        private int _hoverButton;
        private bool _isMonitoring;

        // Layout panels
        private Panel _titleBar;
        private Panel _mainPanel;
        private Panel _statusBar;

        // Backend card controls
        private Panel _backendCard;
        private Panel _backendStatusDot;
        private Label _backendTitleLabel;
        private Label _backendSubtitleLabel;
        private Label _backendStatusLabel;
        private Label _backendPidLabel;
        private Label _backendLatencyLabel;
        private Label _backendUrlLabel;
        private TextBox _backendPortBox;
        private Button _backendToggleBtn;
        private Button _backendRestartBtn;

        // Frontend card controls
        private Panel _frontendCard;
        private Panel _frontendStatusDot;
        private Label _frontendTitleLabel;
        private Label _frontendSubtitleLabel;
        private Label _frontendStatusLabel;
        private Label _frontendPidLabel;
        private Label _frontendLatencyLabel;
        private Label _frontendUrlLabel;
        private TextBox _frontendPortBox;
        private Button _frontendToggleBtn;
        private Button _frontendRestartBtn;

        // Action buttons
        private Panel _actionPanel;
        private Button _startAllBtn;
        private Button _stopAllBtn;
        private Button _openBrowserBtn;
        private Button _refreshBtn;

        // Log
        private Panel _logPanel;
        private RichTextBox _logBox;
        private Button _clearLogBtn;

        // Status bar
        private Panel _statusDot;
        private Label _pathLabel;

        // Layout constants
        private const int TitleBarHeight = 46;
        private const int StatusBarHeight = 32;
        private const int MainPadding = 22;
        private const int CardTop = 16;
        private const int CardHeight = 224;
        private const int CardGap = 14;
        private const int ActionPanelY = CardTop + CardHeight + 12;
        private const int ActionPanelHeight = 48;
        private const int LogPanelY = ActionPanelY + ActionPanelHeight + 12;

        public MainForm()
        {
            InitializeComponent();
            _processManager = new ProcessManager();
            _config = new ServiceConfig();
            _backendStatus = ServiceStatus.Stopped;
            _frontendStatus = ServiceStatus.Stopped;
            _backendLatency = -1;
            _frontendLatency = -1;
            _hoverButton = -1;

            LoadConfig();
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            DoubleBuffered = true;
            BuildUi();
            EnableDoubleBufferingRecursive(this);

            _monitorTimer = new System.Windows.Forms.Timer();
            _monitorTimer.Interval = _config.MonitorInterval;
            _monitorTimer.Tick += MonitorTimer_Tick;
            _monitorTimer.Start();

            // Coalesce log output: drain the queue on the UI thread at most
            // every 120 ms so a chatty service can't flood the UI thread.
            _logFlushTimer = new System.Windows.Forms.Timer();
            _logFlushTimer.Interval = 120;
            _logFlushTimer.Tick += LogFlushTimer_Tick;
            _logFlushTimer.Start();

            _animationTimer = new System.Windows.Forms.Timer();
            _animationTimer.Interval = 80;
            _animationTimer.Tick += AnimationTimer_Tick;
            _animationTimer.Start();

            _processManager.LogMessage += OnLogMessage;
            _processManager.StatusChanged += OnStatusChanged;

            Shown += MainForm_Shown;
            FormClosing += MainForm_FormClosing;
        }

        // ==================================================================
        // Performance: enable DoubleBuffered on every control recursively
        // ==================================================================

        private static void EnableDoubleBufferingRecursive(Control control)
        {
            try
            {
                // DoubleBuffered on native edit controls (TextBox / RichTextBox)
                // breaks their text painting: text can be covered or not repainted.
                if (!(control is TextBoxBase) && !(control is ComboBox))
                {
                    typeof(Control).InvokeMember("DoubleBuffered",
                        BindingFlags.SetProperty | BindingFlags.Instance | BindingFlags.NonPublic,
                        null, control, new object[] { true });
                }
            }
            catch { }
            foreach (Control child in control.Controls)
                EnableDoubleBufferingRecursive(child);
        }

        private void AnimationTimer_Tick(object sender, EventArgs e)
        {
            _animationFrame = (_animationFrame + 1) % 60;

            // Only invalidate the small status dot panels (cheap), never whole cards/panels
            if (_backendStatusDot != null && _backendStatusDot.IsHandleCreated)
                _backendStatusDot.Invalidate();
            if (_frontendStatusDot != null && _frontendStatusDot.IsHandleCreated)
                _frontendStatusDot.Invalidate();
            if (_statusDot != null && _statusDot.IsHandleCreated)
                _statusDot.Invalidate();
        }

        private void MainForm_Shown(object sender, EventArgs e)
        {
            LogMessage("系统", "Obara任务管理系统服务控制台已启动");
            LogMessage("系统", string.Format("运行路径: {0}", PathResolver.RootPath));
            LogMessage("系统", string.Format("后端目录: {0}  前端目录: {1}",
                PathResolver.BackendPath, PathResolver.FrontendPath));
            CheckNodeEnvironment();
            UpdateAllStatusAsync();
        }

        private void LoadConfig()
        {
            try
            {
                string backendPort = System.Configuration.ConfigurationManager.AppSettings["BackendPort"];
                string frontendPort = System.Configuration.ConfigurationManager.AppSettings["FrontendPort"];
                string monitorInterval = System.Configuration.ConfigurationManager.AppSettings["MonitorInterval"];

                int bp;
                if (int.TryParse(backendPort, out bp)) _config.BackendPort = bp;
                int fp;
                if (int.TryParse(frontendPort, out fp)) _config.FrontendPort = fp;
                int mi;
                if (int.TryParse(monitorInterval, out mi) && mi >= 500) _config.MonitorInterval = mi;
            }
            catch { }
        }

        private void SaveConfig()
        {
            try
            {
                string configPath = Path.Combine(PathResolver.BasePath, "App.config");
                if (File.Exists(configPath))
                {
                    var doc = new System.Xml.XmlDocument();
                    doc.Load(configPath);
                    var settings = doc.SelectSingleNode("//appSettings");
                    if (settings != null)
                    {
                        SetAppSetting(doc, settings, "BackendPort", _config.BackendPort.ToString());
                        SetAppSetting(doc, settings, "FrontendPort", _config.FrontendPort.ToString());
                        SetAppSetting(doc, settings, "MonitorInterval", _config.MonitorInterval.ToString());
                        doc.Save(configPath);
                    }
                }
            }
            catch { }
        }

        private void SetAppSetting(System.Xml.XmlDocument doc, System.Xml.XmlNode parent, string key, string value)
        {
            var existing = parent.SelectSingleNode(string.Format("add[@key='{0}']", key));
            if (existing != null)
            {
                existing.Attributes["value"].Value = value;
            }
            else
            {
                var attr = doc.CreateElement("add");
                attr.SetAttribute("key", key);
                attr.SetAttribute("value", value);
                parent.AppendChild(attr);
            }
        }

        private async void CheckNodeEnvironment()
        {
            try
            {
                // Run on a thread-pool thread so startup never blocks on node.exe.
                string version = await Task.Run(() =>
                {
                    var psi = new ProcessStartInfo();
                    psi.FileName = "node";
                    psi.Arguments = "--version";
                    psi.UseShellExecute = false;
                    psi.RedirectStandardOutput = true;
                    psi.CreateNoWindow = true;
                    using (var p = Process.Start(psi))
                    {
                        string v = p.StandardOutput.ReadToEnd().Trim();
                        p.WaitForExit();
                        return p.ExitCode == 0 ? v : null;
                    }
                });

                if (IsDisposed || Disposing) return;
                if (version != null)
                    LogMessage("系统", string.Format("Node.js 版本: {0}", version));
                else
                    LogMessage("警告", "Node.js 未安装或不在 PATH 中");
            }
            catch
            {
                LogMessage("警告", "无法检测 Node.js 环境");
            }
        }

        // ==================================================================
        // UI Building
        // ==================================================================

        private void BuildUi()
        {
            SuspendLayout();

            ClientSize = new Size(940, 700);
            MinimumSize = new Size(820, 600);
            Font = new Font("Segoe UI", 9F);

            // --- Title Bar ---
            _titleBar = new Panel();
            _titleBar.Dock = DockStyle.Top;
            _titleBar.Height = TitleBarHeight;
            _titleBar.BackColor = ThemeColors.TitleBarActive;
            _titleBar.Paint += TitleBar_Paint;
            _titleBar.MouseDown += TitleBar_MouseDown;
            _titleBar.MouseMove += TitleBar_MouseMove;
            _titleBar.MouseUp += TitleBar_MouseUp;
            _titleBar.MouseDoubleClick += TitleBar_MouseDoubleClick;
            _titleBar.MouseLeave += TitleBar_MouseLeave;
            Controls.Add(_titleBar);

            // --- Status Bar ---
            _statusBar = new Panel();
            _statusBar.Dock = DockStyle.Bottom;
            _statusBar.Height = StatusBarHeight;
            _statusBar.BackColor = ThemeColors.PanelBackground;
            _statusBar.Paint += StatusBar_Paint;

            _statusDot = new Panel();
            _statusDot.Size = new Size(12, 12);
            _statusDot.Location = new Point(20, 10);
            _statusDot.Paint += StatusDot_Paint;
            _statusDot.Tag = false;
            _statusBar.Controls.Add(_statusDot);

            var statusTextLabel = new Label();
            statusTextLabel.Text = "实时监控中";
            statusTextLabel.Font = new Font("Segoe UI", 8.5F);
            statusTextLabel.ForeColor = ThemeColors.Success;
            statusTextLabel.AutoSize = true;
            statusTextLabel.Location = new Point(40, 9);
            statusTextLabel.BackColor = ThemeColors.PanelBackground;
            _statusBar.Controls.Add(statusTextLabel);

            var sepLabel = new Label();
            sepLabel.Text = "·";
            sepLabel.Font = new Font("Segoe UI", 10F);
            sepLabel.ForeColor = ThemeColors.TextMuted;
            sepLabel.AutoSize = true;
            sepLabel.Location = new Point(118, 8);
            sepLabel.BackColor = ThemeColors.PanelBackground;
            _statusBar.Controls.Add(sepLabel);

            var authorLabel = new Label();
            authorLabel.Text = "作者 Tobin";
            authorLabel.Font = new Font("Segoe UI", 8.5F);
            authorLabel.ForeColor = ThemeColors.TextSecondary;
            authorLabel.AutoSize = true;
            authorLabel.Location = new Point(132, 9);
            authorLabel.BackColor = ThemeColors.PanelBackground;
            _statusBar.Controls.Add(authorLabel);

            _pathLabel = new Label();
            _pathLabel.Font = new Font("Segoe UI", 8.5F);
            _pathLabel.ForeColor = ThemeColors.TextMuted;
            _pathLabel.AutoSize = true;
            _pathLabel.BackColor = ThemeColors.PanelBackground;
            _statusBar.Controls.Add(_pathLabel);

            Resize += MainForm_Resize;
            KeyPreview = true;
            KeyDown += MainForm_KeyDown;

            Controls.Add(_statusBar);

            // --- Main Panel ---
            _mainPanel = new Panel();
            _mainPanel.Dock = DockStyle.Fill;
            _mainPanel.BackColor = ThemeColors.Background;
            _mainPanel.Paint += MainPanel_Paint;

            BuildServiceCards();
            BuildActionButtons();
            BuildLogArea();

            Controls.Add(_mainPanel);

            PositionPathLabel();
            RelayoutCards();
            RelayoutActionPanel();
            RelayoutLogArea();

            ResumeLayout(false);
        }

        private void MainForm_Resize(object sender, EventArgs e)
        {
            PositionPathLabel();
            RelayoutCards();
            RelayoutActionPanel();
            RelayoutLogArea();
        }

        private void MainForm_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
                Close();
            else if (e.Control && e.KeyCode == Keys.R)
                UpdateAllStatusAsync();
            else if (e.Control && e.KeyCode == Keys.B)
                OpenBrowser();
        }

        private void PositionPathLabel()
        {
            if (_pathLabel != null && _statusBar != null && _statusBar.Width > 0)
            {
                _pathLabel.Text = string.Format("路径  {0}", PathResolver.RootPath);
                _pathLabel.Location = new Point(Math.Max(0, _statusBar.Width - _pathLabel.Width - 20), 9);
            }
        }

        private void RelayoutCards()
        {
            if (_mainPanel == null || _backendCard == null) return;
            if (_mainPanel.Width <= 0) return;

            int availWidth = _mainPanel.Width - MainPadding * 2;
            int cardWidth = (availWidth - CardGap) / 2;
            if (cardWidth <= 0) return;

            _backendCard.Width = cardWidth;
            _backendCard.Location = new Point(MainPadding, CardTop);

            _frontendCard.Width = cardWidth;
            _frontendCard.Location = new Point(MainPadding + cardWidth + CardGap, CardTop);

            RepositionCardInternals(_backendCard, cardWidth, _backendStatusDot, _backendStatusLabel, _backendUrlLabel);
            RepositionCardInternals(_frontendCard, cardWidth, _frontendStatusDot, _frontendStatusLabel, _frontendUrlLabel);
        }

        private void RepositionCardInternals(Panel card, int cardWidth, Panel statusDot, Label statusLabel, Label urlLabel)
        {
            if (statusDot != null)
                statusDot.Location = new Point(cardWidth - 110, 22);
            if (statusLabel != null)
                statusLabel.Location = new Point(cardWidth - 92, 20);
            if (urlLabel != null)
            {
                // Resize the containing URL box and keep the label inside it so
                // the text never covers the globe icon on the right.
                Panel urlBox = urlLabel.Parent as Panel;
                if (urlBox != null)
                    urlBox.Width = cardWidth - 40;
                urlLabel.Width = Math.Max(60, cardWidth - 76);
            }
        }

        private void RelayoutActionPanel()
        {
            if (_actionPanel == null || _mainPanel == null) return;
            _actionPanel.Width = _mainPanel.Width - MainPadding * 2;
            CenterActionButtons();
        }

        private void CenterActionButtons()
        {
            if (_actionPanel == null || _startAllBtn == null) return;
            int totalWidth = _startAllBtn.Width + 12 + _stopAllBtn.Width + 12 + _refreshBtn.Width + 12 + _openBrowserBtn.Width;
            int x = (_actionPanel.Width - totalWidth) / 2;
            if (x < 0) x = 0;
            int y = (_actionPanel.Height - _startAllBtn.Height) / 2;
            _startAllBtn.Location = new Point(x, y);
            _stopAllBtn.Location = new Point(x + _startAllBtn.Width + 12, y);
            _refreshBtn.Location = new Point(x + _startAllBtn.Width + 12 + _stopAllBtn.Width + 12, y);
            _openBrowserBtn.Location = new Point(x + _startAllBtn.Width + 12 + _stopAllBtn.Width + 12 + _refreshBtn.Width + 12, y);
        }

        private void RelayoutLogArea()
        {
            if (_mainPanel == null || _logPanel == null) return;
            if (_mainPanel.Width <= 0 || _mainPanel.Height <= 0) return;
            int y = LogPanelY;
            int h = _mainPanel.Height - y - MainPadding;
            if (h < 120) h = 120;
            _logPanel.Location = new Point(MainPadding, y);
            _logPanel.Size = new Size(_mainPanel.Width - MainPadding * 2, h);
        }

        // ==================================================================
        // Service Cards
        // ==================================================================

        private void BuildServiceCards()
        {
            int availWidth = _mainPanel.Width - MainPadding * 2;
            if (availWidth <= 0) availWidth = 900;
            int cardWidth = (availWidth - CardGap) / 2;
            if (cardWidth <= 0) cardWidth = 400;

            _backendCard = CreateServiceCard("后端服务", "Backend Server · Node.js", _config.BackendPort, true, cardWidth);
            _backendCard.Location = new Point(MainPadding, CardTop);

            _frontendCard = CreateServiceCard("前端服务", "Frontend Server · Vite", _config.FrontendPort, false, cardWidth);
            _frontendCard.Location = new Point(MainPadding + cardWidth + CardGap, CardTop);

            _mainPanel.Controls.Add(_backendCard);
            _mainPanel.Controls.Add(_frontendCard);
        }

        private Panel CreateServiceCard(string title, string subtitle, int port, bool isBackend, int cardWidth)
        {
            var card = new Panel();
            card.Height = CardHeight;
            card.BackColor = ThemeColors.CardBackground;
            card.Paint += Card_Paint;

            // --- Title (large, bold) ---
            var titleLabel = new Label();
            titleLabel.Text = title;
            titleLabel.Font = new Font("Segoe UI", 14F, FontStyle.Bold);
            titleLabel.ForeColor = ThemeColors.TextPrimary;
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(20, 16);
            titleLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(titleLabel);

            // --- Subtitle (small, muted) ---
            var subtitleLabel = new Label();
            subtitleLabel.Text = subtitle;
            subtitleLabel.Font = new Font("Segoe UI", 8.5F);
            subtitleLabel.ForeColor = ThemeColors.TextMuted;
            subtitleLabel.AutoSize = true;
            subtitleLabel.Location = new Point(20, 42);
            subtitleLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(subtitleLabel);

            // --- Status dot (animated, painted) ---
            var statusDot = new Panel();
            statusDot.Size = new Size(12, 12);
            statusDot.Location = new Point(cardWidth - 110, 22);
            statusDot.Paint += StatusDot_Paint;
            statusDot.Tag = isBackend;
            statusDot.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(statusDot);

            // --- Status text ---
            var statusLabel = new Label();
            statusLabel.Text = "已停止";
            statusLabel.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            statusLabel.ForeColor = ThemeColors.Error;
            statusLabel.AutoSize = true;
            statusLabel.Location = new Point(cardWidth - 92, 20);
            statusLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(statusLabel);

            // --- Section divider (gradient) ---
            var sepPanel = new Panel();
            sepPanel.Size = new Size(cardWidth - 40, 1);
            sepPanel.Location = new Point(20, 66);
            sepPanel.Paint += Separator_Paint;
            sepPanel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(sepPanel);

            // --- Metrics section labels ---
            var portTitleLabel = new Label();
            portTitleLabel.Text = "端口";
            portTitleLabel.Font = new Font("Segoe UI", 8F);
            portTitleLabel.ForeColor = ThemeColors.TextSecondary;
            portTitleLabel.AutoSize = true;
            portTitleLabel.Location = new Point(20, 78);
            portTitleLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(portTitleLabel);

            var pidTitleLabel = new Label();
            pidTitleLabel.Text = "PID";
            pidTitleLabel.Font = new Font("Segoe UI", 8F);
            pidTitleLabel.ForeColor = ThemeColors.TextSecondary;
            pidTitleLabel.AutoSize = true;
            pidTitleLabel.Location = new Point(120, 78);
            pidTitleLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(pidTitleLabel);

            var latencyTitleLabel = new Label();
            latencyTitleLabel.Text = "延迟";
            latencyTitleLabel.Font = new Font("Segoe UI", 8F);
            latencyTitleLabel.ForeColor = ThemeColors.TextSecondary;
            latencyTitleLabel.AutoSize = true;
            latencyTitleLabel.Location = new Point(220, 78);
            latencyTitleLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(latencyTitleLabel);

            // --- Port TextBox ---
            var portBox = new TextBox();
            portBox.Text = port.ToString();
            portBox.Font = new Font("Consolas", 11F, FontStyle.Bold);
            portBox.ForeColor = ThemeColors.Accent;
            portBox.BackColor = ThemeColors.Background;
            portBox.BorderStyle = BorderStyle.FixedSingle;
            portBox.Width = 76;
            portBox.Location = new Point(20, 96);
            portBox.TextAlign = HorizontalAlignment.Center;
            portBox.GotFocus += PortBox_GotFocus;
            portBox.KeyPress += PortBox_KeyPress;
            portBox.TextChanged += PortBox_TextChanged;
            portBox.Tag = isBackend;
            card.Controls.Add(portBox);

            // --- PID value ---
            var pidLabel = new Label();
            pidLabel.Text = "--";
            pidLabel.Font = new Font("Consolas", 11F, FontStyle.Bold);
            pidLabel.ForeColor = ThemeColors.TextMuted;
            pidLabel.AutoSize = true;
            pidLabel.Location = new Point(120, 98);
            pidLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(pidLabel);

            // --- Latency value ---
            var latencyLabel = new Label();
            latencyLabel.Text = "-- ms";
            latencyLabel.Font = new Font("Consolas", 11F, FontStyle.Bold);
            latencyLabel.ForeColor = ThemeColors.TextMuted;
            latencyLabel.AutoSize = true;
            latencyLabel.Location = new Point(220, 98);
            latencyLabel.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(latencyLabel);

            // --- URL bar (link styled) ---
            var urlBox = new Panel();
            urlBox.Size = new Size(cardWidth - 40, 26);
            urlBox.Location = new Point(20, 126);
            urlBox.Paint += UrlBox_Paint;
            urlBox.BackColor = ThemeColors.CardBackground;
            urlBox.Tag = port;
            urlBox.Cursor = Cursors.Hand;
            urlBox.Click += UrlBox_Click;

            var urlLabel = new Label();
            urlLabel.Text = string.Format("http://localhost:{0}", port);
            urlLabel.Font = new Font("Consolas", 9F);
            urlLabel.ForeColor = ThemeColors.Accent;
            urlLabel.AutoSize = false;
            urlLabel.Location = new Point(10, 5);
            urlLabel.Size = new Size(Math.Max(60, cardWidth - 76), 16);
            urlLabel.BackColor = Color.FromArgb(25, 35, 60);
            urlLabel.Cursor = Cursors.Hand;
            urlLabel.Click += UrlLabel_Click;
            urlLabel.Tag = port;
            urlBox.Controls.Add(urlLabel);
            card.Controls.Add(urlBox);

            // --- Action separator ---
            var actionSep = new Panel();
            actionSep.Size = new Size(cardWidth - 40, 1);
            actionSep.Location = new Point(20, 162);
            actionSep.Paint += Separator_Paint;
            actionSep.BackColor = ThemeColors.CardBackground;
            card.Controls.Add(actionSep);

            // --- Action buttons ---
            var toggleBtn = CreateStyledButton("启动", ThemeColors.Success, new Size(96, 32), "▶");
            toggleBtn.Location = new Point(20, 178);
            toggleBtn.Click += ToggleBtn_Click;
            toggleBtn.Tag = isBackend;
            card.Controls.Add(toggleBtn);

            var restartBtn = CreateStyledButton("重启", ThemeColors.SecondaryAccent, new Size(86, 32), "↻");
            restartBtn.Location = new Point(124, 178);
            restartBtn.Click += RestartBtn_Click;
            restartBtn.Tag = isBackend;
            card.Controls.Add(restartBtn);

            // --- Save references ---
            if (isBackend)
            {
                _backendStatusDot = statusDot;
                _backendTitleLabel = titleLabel;
                _backendSubtitleLabel = subtitleLabel;
                _backendStatusLabel = statusLabel;
                _backendPidLabel = pidLabel;
                _backendLatencyLabel = latencyLabel;
                _backendUrlLabel = urlLabel;
                _backendPortBox = portBox;
                _backendToggleBtn = toggleBtn;
                _backendRestartBtn = restartBtn;
            }
            else
            {
                _frontendStatusDot = statusDot;
                _frontendTitleLabel = titleLabel;
                _frontendSubtitleLabel = subtitleLabel;
                _frontendStatusLabel = statusLabel;
                _frontendPidLabel = pidLabel;
                _frontendLatencyLabel = latencyLabel;
                _frontendUrlLabel = urlLabel;
                _frontendPortBox = portBox;
                _frontendToggleBtn = toggleBtn;
                _frontendRestartBtn = restartBtn;
            }

            return card;
        }

        private void UrlBox_Paint(object sender, PaintEventArgs e)
        {
            var panel = sender as Panel;
            if (panel == null) return;

            var g = e.Graphics;
            using (var brush = new SolidBrush(Color.FromArgb(25, 35, 60)))
            using (var pen = new Pen(Color.FromArgb(60, ThemeColors.Accent), 1))
            {
                g.FillRectangle(brush, 0, 0, panel.Width, panel.Height);
                g.DrawRectangle(pen, 0, 0, panel.Width - 1, panel.Height - 1);
            }
            // Link icon (small globe)
            using (var pen = new Pen(Color.FromArgb(180, ThemeColors.Accent), 1.2f))
            {
                int ix = panel.Width - 18;
                int iy = (panel.Height - 10) / 2;
                g.DrawEllipse(pen, ix, iy, 10, 10);
                g.DrawLine(pen, ix, iy + 5, ix + 10, iy + 5);
                g.DrawEllipse(pen, ix + 2, iy, 6, 10);
            }
        }

        private void UrlBox_Click(object sender, EventArgs e)
        {
            var panel = sender as Panel;
            if (panel == null) return;
            int port = (int)panel.Tag;
            OpenUrl(port);
        }

        private void UrlLabel_Click(object sender, EventArgs e)
        {
            var label = sender as Label;
            if (label == null) return;
            int port = (int)label.Tag;
            OpenUrl(port);
        }

        private void OpenUrl(int port)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = string.Format("http://localhost:{0}", port),
                    UseShellExecute = true
                });
            }
            catch { }
        }

        private void Card_Paint(object sender, PaintEventArgs e)
        {
            var card = sender as Panel;
            if (card == null) return;

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, card.Width - 1, card.Height - 1);

            // Rounded card body with subtle fill
            // Use ThemeColors.CardBackground so the body exactly matches the
            // BackColor of the child labels; a different shade made every
            // label look like a covered/overlaid rectangle.
            using (var path = RoundedRect(rect, 10))
            using (var bodyBrush = new SolidBrush(ThemeColors.CardBackground))
            using (var borderPen = new Pen(Color.FromArgb(70, ThemeColors.Border), 1))
            {
                g.FillPath(bodyBrush, path);
                g.DrawPath(borderPen, path);
            }

            // Top accent gradient bar
            Color accentLeft = Color.FromArgb(120, ThemeColors.Accent);
            Color accentRight = Color.FromArgb(120, ThemeColors.SecondaryAccent);
            using (var path = RoundedRect(new Rectangle(0, 0, card.Width - 1, 4), 2))
            using (var glowBrush = new LinearGradientBrush(
                new Rectangle(0, 0, card.Width, 4),
                accentLeft, accentRight, LinearGradientMode.Horizontal))
            {
                g.FillPath(glowBrush, path);
            }
        }

        private void Separator_Paint(object sender, PaintEventArgs e)
        {
            var panel = sender as Panel;
            if (panel == null) return;

            var g = e.Graphics;
            Color left = Color.FromArgb(20, ThemeColors.Border);
            Color mid = Color.FromArgb(80, ThemeColors.Border);
            Color right = Color.FromArgb(20, ThemeColors.Border);
            using (var brush = new LinearGradientBrush(
                new Rectangle(0, 0, panel.Width, 1),
                left, right, LinearGradientMode.Horizontal))
            {
                var blend = new ColorBlend(3);
                blend.Colors = new[] { left, mid, right };
                blend.Positions = new[] { 0f, 0.5f, 1f };
                brush.InterpolationColors = blend;
                g.FillRectangle(brush, 0, 0, panel.Width, 1);
            }
        }

        private void StatusDot_Paint(object sender, PaintEventArgs e)
        {
            var panel = sender as Panel;
            if (panel == null) return;

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            bool isBackend = panel.Tag is bool && (bool)panel.Tag;
            ServiceStatus status = isBackend ? _backendStatus : _frontendStatus;
            Color color = StatusToColor(status);
            int size = panel.Width;

            if (status == ServiceStatus.Running || status == ServiceStatus.Starting)
            {
                int glowAlpha = (int)(40 + 35 * Math.Sin(_animationFrame * Math.PI * 2 / 60.0));
                using (var glowBrush = new SolidBrush(Color.FromArgb(glowAlpha, color)))
                {
                    g.FillEllipse(glowBrush, -4, -4, size + 8, size + 8);
                }
            }

            using (var brush = new SolidBrush(color))
            {
                g.FillEllipse(brush, 0, 0, size, size);
            }

            if (status == ServiceStatus.Running)
            {
                using (var innerBrush = new SolidBrush(Color.FromArgb(200, Color.White)))
                {
                    g.FillEllipse(innerBrush, size / 2 - 2, size / 2 - 2, 4, 4);
                }
            }
        }

        private void PortBox_GotFocus(object sender, EventArgs e)
        {
            ((TextBox)sender).SelectAll();
        }

        private void PortBox_KeyPress(object sender, KeyPressEventArgs e)
        {
            if (!char.IsControl(e.KeyChar) && !char.IsDigit(e.KeyChar))
                e.Handled = true;
        }

        private void PortBox_TextChanged(object sender, EventArgs e)
        {
            var box = sender as TextBox;
            bool isBackend = (bool)box.Tag;
            int p;
            if (int.TryParse(box.Text, out p) && p >= 1 && p <= 65535)
            {
                if (isBackend)
                {
                    _config.BackendPort = p;
                    if (_backendUrlLabel != null)
                        _backendUrlLabel.Text = string.Format("http://localhost:{0}", p);
                }
                else
                {
                    _config.FrontendPort = p;
                    if (_frontendUrlLabel != null)
                        _frontendUrlLabel.Text = string.Format("http://localhost:{0}", p);
                }
            }
        }

        private void ToggleBtn_Click(object sender, EventArgs e)
        {
            var btn = sender as Button;
            bool isBackend = (bool)btn.Tag;
            if (isBackend) ToggleBackend();
            else ToggleFrontend();
        }

        private void RestartBtn_Click(object sender, EventArgs e)
        {
            var btn = sender as Button;
            bool isBackend = (bool)btn.Tag;
            if (isBackend) RestartBackend();
            else RestartFrontend();
        }

        // ==================================================================
        // Action Buttons
        // ==================================================================

        private void BuildActionButtons()
        {
            _actionPanel = new Panel();
            _actionPanel.Height = ActionPanelHeight;
            _actionPanel.BackColor = ThemeColors.Background;
            _actionPanel.Location = new Point(MainPadding, ActionPanelY);
            int actionWidth = _mainPanel.Width - MainPadding * 2;
            if (actionWidth <= 0) actionWidth = 900;
            _actionPanel.Width = actionWidth;

            _startAllBtn = CreateStyledButton("启动全部服务", ThemeColors.Success, new Size(140, 36), "▶");
            _startAllBtn.Click += StartAllBtn_Click;

            _stopAllBtn = CreateStyledButton("停止全部服务", ThemeColors.Error, new Size(140, 36), "■");
            _stopAllBtn.Click += StopAllBtn_Click;

            _refreshBtn = CreateStyledButton("刷新状态", ThemeColors.Warning, new Size(110, 36), "↻");
            _refreshBtn.Click += RefreshBtn_Click;

            _openBrowserBtn = CreateStyledButton("打开浏览器", ThemeColors.Accent, new Size(130, 36), "◎");
            _openBrowserBtn.Click += OpenBrowserBtn_Click;

            _actionPanel.Controls.AddRange(new Control[] { _startAllBtn, _stopAllBtn, _refreshBtn, _openBrowserBtn });
            _mainPanel.Controls.Add(_actionPanel);
        }

        private void StartAllBtn_Click(object sender, EventArgs e) { StartAll(); }
        private void StopAllBtn_Click(object sender, EventArgs e) { StopAll(); }
        private void RefreshBtn_Click(object sender, EventArgs e) { UpdateAllStatusAsync(); }
        private void OpenBrowserBtn_Click(object sender, EventArgs e) { OpenBrowser(); }

        // ==================================================================
        // Log Area
        // ==================================================================

        private void BuildLogArea()
        {
            _logPanel = new Panel();
            _logPanel.BackColor = ThemeColors.LogBackground;

            // Log header
            var logHeader = new Panel();
            logHeader.Dock = DockStyle.Top;
            logHeader.Height = 32;
            logHeader.BackColor = ThemeColors.PanelBackground;
            logHeader.Paint += LogHeader_Paint;

            var logTitle = new Label();
            logTitle.Text = "运行日志";
            logTitle.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            logTitle.ForeColor = ThemeColors.Accent;
            logTitle.AutoSize = true;
            logTitle.Location = new Point(16, 8);
            logTitle.BackColor = ThemeColors.PanelBackground;
            logHeader.Controls.Add(logTitle);

            _clearLogBtn = new Button();
            _clearLogBtn.Text = "清空";
            _clearLogBtn.Size = new Size(56, 22);
            _clearLogBtn.BackColor = Color.FromArgb(35, 35, 60);
            _clearLogBtn.ForeColor = ThemeColors.TextSecondary;
            _clearLogBtn.FlatStyle = FlatStyle.Flat;
            _clearLogBtn.Font = new Font("Segoe UI", 8F);
            _clearLogBtn.FlatAppearance.BorderColor = ThemeColors.Border;
            _clearLogBtn.Cursor = Cursors.Hand;
            _clearLogBtn.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _clearLogBtn.Click += ClearBtn_Click;
            logHeader.Controls.Add(_clearLogBtn);

            _logBox = new RichTextBox();
            _logBox.Dock = DockStyle.Fill;
            _logBox.BackColor = ThemeColors.LogBackground;
            _logBox.ForeColor = ThemeColors.LogText;
            _logBox.Font = new Font("Consolas", 9F);
            _logBox.BorderStyle = BorderStyle.None;
            _logBox.ReadOnly = true;
            _logBox.WordWrap = false;
            _logBox.ScrollBars = RichTextBoxScrollBars.Vertical;
            _logBox.DetectUrls = false;

            _logPanel.Controls.Add(_logBox);
            _logPanel.Controls.Add(logHeader);

            logHeader.Resize += (s, e) =>
            {
                _clearLogBtn.Location = new Point(logHeader.Width - 66, 5);
            };

            _mainPanel.Controls.Add(_logPanel);
        }

        private void LogHeader_Paint(object sender, PaintEventArgs e)
        {
            var panel = sender as Panel;
            if (panel == null) return;

            var g = e.Graphics;
            // Accent bar on left
            using (var brush = new LinearGradientBrush(
                new Rectangle(0, 0, 3, panel.Height),
                ThemeColors.Accent, ThemeColors.SecondaryAccent, LinearGradientMode.Vertical))
            {
                g.FillRectangle(brush, 0, 0, 3, panel.Height);
            }
            // Bottom border
            using (var pen = new Pen(ThemeColors.Border, 1))
            {
                g.DrawLine(pen, 0, panel.Height - 1, panel.Width, panel.Height - 1);
            }
        }

        private void ClearBtn_Click(object sender, EventArgs e)
        {
            if (_logBox != null) _logBox.Clear();
        }

        // ==================================================================
        // Helpers
        // ==================================================================

        private Button CreateStyledButton(string text, Color accentColor, Size size, string icon)
        {
            var btn = new Button();
            btn.Text = icon != null ? icon + "  " + text : text;
            btn.Size = size;
            btn.FlatStyle = FlatStyle.Flat;
            btn.BackColor = Color.FromArgb(28, 32, 58);
            btn.ForeColor = accentColor;
            btn.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            btn.Cursor = Cursors.Hand;
            btn.TextAlign = ContentAlignment.MiddleCenter;
            btn.FlatAppearance.BorderColor = Color.FromArgb(100, accentColor);
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.MouseOverBackColor = Color.FromArgb(45, 50, 85);
            btn.FlatAppearance.MouseDownBackColor = Color.FromArgb(20, 24, 50);
            return btn;
        }

        private GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            int diameter = radius * 2;
            if (diameter > rect.Width) diameter = rect.Width;
            if (diameter > rect.Height) diameter = rect.Height;
            path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        private Color StatusToColor(ServiceStatus status)
        {
            switch (status)
            {
                case ServiceStatus.Running: return ThemeColors.Success;
                case ServiceStatus.Starting: return ThemeColors.Warning;
                case ServiceStatus.Stopping: return ThemeColors.Warning;
                case ServiceStatus.Error: return ThemeColors.Error;
                default: return Color.FromArgb(120, 120, 140);
            }
        }

        private string StatusToText(ServiceStatus status)
        {
            switch (status)
            {
                case ServiceStatus.Running: return "运行中";
                case ServiceStatus.Starting: return "启动中";
                case ServiceStatus.Stopping: return "停止中";
                case ServiceStatus.Error: return "错误";
                default: return "已停止";
            }
        }

        // ==================================================================
        // Title Bar
        // ==================================================================

        private void TitleBar_Paint(object sender, PaintEventArgs e)
        {
            if (_titleBar == null) return;

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            using (var brush = new LinearGradientBrush(
                new Rectangle(0, 0, _titleBar.Width, _titleBar.Height),
                ThemeColors.TitleBarActive,
                Color.FromArgb(28, 28, 52),
                LinearGradientMode.Horizontal))
            {
                g.FillRectangle(brush, _titleBar.ClientRectangle);
            }

            // Logo badge
            var logoRect = new Rectangle(16, 10, 26, 26);
            using (var path = RoundedRect(logoRect, 6))
            using (var brush = new LinearGradientBrush(logoRect, ThemeColors.Accent, ThemeColors.SecondaryAccent, 45f))
            {
                g.FillPath(brush, path);
            }
            // Logo glyph (stylized "O")
            using (var pen = new Pen(Color.White, 1.8f))
            {
                g.DrawEllipse(pen, 22, 16, 14, 14);
                g.DrawLine(pen, 26, 23, 32, 23);
            }

            // Title text
            using (var font = new Font("Segoe UI", 11F, FontStyle.Bold))
            using (var brush = new SolidBrush(ThemeColors.TextPrimary))
            {
                g.DrawString("Obara任务管理系统服务控制台", font, brush, 52, 13);
            }

            // Subtitle (small)
            using (var font = new Font("Segoe UI", 7.5F))
            using (var brush = new SolidBrush(ThemeColors.TextMuted))
            {
                g.DrawString("SERVICE CONTROL CONSOLE · v1.0", font, brush, 52, 30);
            }

            // Bottom accent line
            Color accentLeft = Color.FromArgb(120, ThemeColors.Accent);
            Color accentRight = Color.FromArgb(120, ThemeColors.SecondaryAccent);
            using (var brush = new LinearGradientBrush(
                new Rectangle(0, _titleBar.Height - 2, _titleBar.Width, 2),
                accentLeft, accentRight, LinearGradientMode.Horizontal))
            {
                g.FillRectangle(brush, 0, _titleBar.Height - 2, _titleBar.Width, 2);
            }

            DrawTitleBarButtons(g);
        }

        private void DrawTitleBarButtons(Graphics g)
        {
            if (_titleBar == null) return;
            int btnWidth = 46;
            int btnHeight = 32;
            int y = (_titleBar.Height - btnHeight) / 2;
            Color[] btnColors = { ThemeColors.TextSecondary, ThemeColors.TextSecondary, ThemeColors.Error };

            for (int i = 0; i < 3; i++)
            {
                int x = _titleBar.Width - (3 - i) * btnWidth;
                var rect = new Rectangle(x, y, btnWidth, btnHeight);

                Color bgColor = Color.Transparent;
                if (_hoverButton == i)
                    bgColor = (i == 2) ? ThemeColors.Error : ThemeColors.ButtonHover;

                if (bgColor != Color.Transparent)
                {
                    using (var brush = new SolidBrush(bgColor))
                        g.FillRectangle(brush, rect);
                }

                Color iconColor = (i == 2 && _hoverButton == 2) ? Color.White : btnColors[i];
                using (var pen = new Pen(iconColor, 1.6f))
                {
                    switch (i)
                    {
                        case 0: // minimize
                            g.DrawLine(pen, x + 15, y + btnHeight / 2, x + 31, y + btnHeight / 2);
                            break;
                        case 1: // maximize/restore
                            if (_isMaximized)
                            {
                                g.DrawRectangle(pen, x + 14, y + 10, 14, 10);
                                g.DrawRectangle(pen, x + 17, y + 13, 14, 10);
                            }
                            else
                            {
                                g.DrawRectangle(pen, x + 15, y + 10, 16, 12);
                            }
                            break;
                        case 2: // close
                            g.DrawLine(pen, x + 15, y + 10, x + 31, y + 22);
                            g.DrawLine(pen, x + 31, y + 10, x + 15, y + 22);
                            break;
                    }
                }
            }
        }

        private Rectangle GetTitleBarButtonRect(int index)
        {
            int btnWidth = 46;
            int btnHeight = 32;
            int y = (_titleBar.Height - btnHeight) / 2;
            int x = _titleBar.Width - (3 - index) * btnWidth;
            return new Rectangle(x, y, btnWidth, btnHeight);
        }

        private int HitTestTitleBarButtons(int x, int y)
        {
            int btnWidth = 46;
            int btnHeight = 32;
            int by = (_titleBar.Height - btnHeight) / 2;
            for (int i = 0; i < 3; i++)
            {
                int bx = _titleBar.Width - (3 - i) * btnWidth;
                if (x >= bx && x <= bx + btnWidth && y >= by && y <= by + btnHeight)
                    return i;
            }
            return -1;
        }

        private void TitleBar_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                _isDragging = true;
                _dragOffset = e.Location;
            }
        }

        private void TitleBar_MouseMove(object sender, MouseEventArgs e)
        {
            int hoverBtn = HitTestTitleBarButtons(e.X, e.Y);

            if (hoverBtn != _hoverButton)
            {
                // Only invalidate the affected button rects (cheap)
                if (_hoverButton >= 0)
                {
                    var r = GetTitleBarButtonRect(_hoverButton);
                    _titleBar.Invalidate(r);
                }
                if (hoverBtn >= 0)
                {
                    var r = GetTitleBarButtonRect(hoverBtn);
                    _titleBar.Invalidate(r);
                }
                _hoverButton = hoverBtn;
            }

            if (_isDragging)
            {
                Point screenPoint = _titleBar.PointToScreen(e.Location);
                Location = new Point(screenPoint.X - _dragOffset.X, screenPoint.Y - _dragOffset.Y);
            }
        }

        private void TitleBar_MouseUp(object sender, MouseEventArgs e)
        {
            if (_isDragging)
            {
                _isDragging = false;
                if (_hoverButton >= 0)
                {
                    switch (_hoverButton)
                    {
                        case 0: WindowState = FormWindowState.Minimized; break;
                        case 1: ToggleMaximize(); break;
                        case 2: Close(); break;
                    }
                    _hoverButton = -1;
                    _titleBar.Invalidate();
                }
            }
        }

        private void TitleBar_MouseLeave(object sender, EventArgs e)
        {
            if (_hoverButton >= 0)
            {
                var r = GetTitleBarButtonRect(_hoverButton);
                _hoverButton = -1;
                _titleBar.Invalidate(r);
            }
        }

        private void TitleBar_MouseDoubleClick(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && HitTestTitleBarButtons(e.X, e.Y) < 0)
                ToggleMaximize();
        }

        private void ToggleMaximize()
        {
            if (_isMaximized)
            {
                _isMaximized = false;
                Bounds = _normalBounds;
            }
            else
            {
                _normalBounds = Bounds;
                _isMaximized = true;
                Bounds = Screen.FromControl(this).WorkingArea;
            }
            _titleBar.Invalidate();
        }

        // ==================================================================
        // Panel Painting
        // ==================================================================

        private void MainPanel_Paint(object sender, PaintEventArgs e)
        {
            if (_mainPanel == null) return;
            // Subtle top separator under title bar
            using (var pen = new Pen(Color.FromArgb(40, ThemeColors.Border), 1))
            {
                e.Graphics.DrawLine(pen, 0, 0, _mainPanel.Width, 0);
            }
        }

        private void StatusBar_Paint(object sender, PaintEventArgs e)
        {
            if (_statusBar == null) return;
            var g = e.Graphics;
            using (var pen = new Pen(ThemeColors.Border, 1))
            {
                g.DrawLine(pen, 0, 0, _statusBar.Width, 0);
            }
        }

        // ==================================================================
        // Service Control
        // ==================================================================

        private void ToggleBackend()
        {
            if (_backendStatus == ServiceStatus.Running || _backendStatus == ServiceStatus.Starting)
            {
                _processManager.StopBackend();
            }
            else
            {
                if (PortChecker.IsPortListening(_config.BackendPort))
                {
                    ConfirmResult result = ConfirmDialog.Show(this,
                        "端口冲突",
                        string.Format("端口 {0} 已被占用，是否强制释放？", _config.BackendPort),
                        "释放端口", "取消", "取消");
                    if (result == ConfirmResult.Yes)
                    {
                        _processManager.KillProcessByPort(_config.BackendPort);
                        System.Threading.Thread.Sleep(500);
                    }
                    else return;
                }
                _processManager.StartBackend(_config.BackendPort);
            }
        }

        private void ToggleFrontend()
        {
            if (_frontendStatus == ServiceStatus.Running || _frontendStatus == ServiceStatus.Starting)
            {
                _processManager.StopFrontend();
            }
            else
            {
                if (PortChecker.IsPortListening(_config.FrontendPort))
                {
                    ConfirmResult result = ConfirmDialog.Show(this,
                        "端口冲突",
                        string.Format("端口 {0} 已被占用，是否强制释放？", _config.FrontendPort),
                        "释放端口", "取消", "取消");
                    if (result == ConfirmResult.Yes)
                    {
                        _processManager.KillProcessByPort(_config.FrontendPort);
                        System.Threading.Thread.Sleep(500);
                    }
                    else return;
                }
                _processManager.StartFrontend(_config.FrontendPort);
            }
        }

        private void RestartBackend()
        {
            if (_backendStatus == ServiceStatus.Running)
            {
                _processManager.StopBackend();
                System.Threading.Thread.Sleep(1000);
            }
            _processManager.StartBackend(_config.BackendPort);
        }

        private void RestartFrontend()
        {
            if (_frontendStatus == ServiceStatus.Running)
            {
                _processManager.StopFrontend();
                System.Threading.Thread.Sleep(1000);
            }
            _processManager.StartFrontend(_config.FrontendPort);
        }

        private void StartAll()
        {
            if (!_processManager.IsBackendRunning && !PortChecker.IsPortListening(_config.BackendPort))
            {
                _processManager.StartBackend(_config.BackendPort);
            }
            else if (PortChecker.IsPortListening(_config.BackendPort) && !_processManager.IsBackendRunning)
            {
                _processManager.KillProcessByPort(_config.BackendPort);
                System.Threading.Thread.Sleep(500);
                _processManager.StartBackend(_config.BackendPort);
            }

            if (!_processManager.IsFrontendRunning && !PortChecker.IsPortListening(_config.FrontendPort))
            {
                _processManager.StartFrontend(_config.FrontendPort);
            }
            else if (PortChecker.IsPortListening(_config.FrontendPort) && !_processManager.IsFrontendRunning)
            {
                _processManager.KillProcessByPort(_config.FrontendPort);
                System.Threading.Thread.Sleep(500);
                _processManager.StartFrontend(_config.FrontendPort);
            }
        }

        private void StopAll()
        {
            _processManager.StopAll();
        }

        private void OpenBrowser()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = _config.FrontendUrl,
                    UseShellExecute = true
                });
                LogMessage("系统", string.Format("已打开浏览器: {0}", _config.FrontendUrl));
            }
            catch (Exception ex)
            {
                MessageBox.Show(string.Format("无法打开浏览器: {0}", ex.Message), "错误",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // ==================================================================
        // Monitoring
        // ==================================================================

        private void MonitorTimer_Tick(object sender, EventArgs e)
        {
            UpdateAllStatusAsync();
        }

        private async void UpdateAllStatusAsync()
        {
            // Guard against overlapping runs (checks can take longer than the interval).
            if (_isMonitoring) return;
            _isMonitoring = true;
            try
            {
                // Run the blocking TCP probes on thread-pool threads so the UI
                // thread never freezes while waiting for connect timeouts.
                Task<bool> backendProbe = Task.Run(() => PortChecker.IsPortListening(_config.BackendPort));
                Task<bool> frontendProbe = Task.Run(() => PortChecker.IsPortListening(_config.FrontendPort));
                await Task.WhenAll(backendProbe, frontendProbe);
                if (IsDisposed || Disposing) return;

                bool backendListening = backendProbe.Result;
                bool frontendListening = frontendProbe.Result;

                // Measure latency only for listening ports, off the UI thread.
                Task<int> backendLatency = backendListening
                    ? Task.Run(() => PortChecker.MeasureLatency(_config.BackendPort))
                    : Task.FromResult(-1);
                Task<int> frontendLatency = frontendListening
                    ? Task.Run(() => PortChecker.MeasureLatency(_config.FrontendPort))
                    : Task.FromResult(-1);
                await Task.WhenAll(backendLatency, frontendLatency);
                if (IsDisposed || Disposing) return;

                ApplyStatusResult(true, backendListening, backendLatency.Result);
                ApplyStatusResult(false, frontendListening, frontendLatency.Result);
            }
            catch { }
            finally
            {
                _isMonitoring = false;
            }
        }

        private void ApplyStatusResult(bool isBackend, bool portListening, int latency)
        {
            if (isBackend)
            {
                _backendLatency = latency;
                if (portListening && _backendStatus != ServiceStatus.Running)
                {
                    _backendStatus = ServiceStatus.Running;
                    LogMessage("后端", string.Format("服务已在端口 {0} 上响应", _config.BackendPort));
                }
                else if (!portListening && _backendStatus == ServiceStatus.Running)
                {
                    _backendStatus = ServiceStatus.Stopped;
                    LogMessage("后端", string.Format("端口 {0} 无响应", _config.BackendPort));
                }
            }
            else
            {
                _frontendLatency = latency;
                if (portListening && _frontendStatus != ServiceStatus.Running)
                {
                    _frontendStatus = ServiceStatus.Running;
                    LogMessage("前端", string.Format("服务已在端口 {0} 上响应", _config.FrontendPort));
                }
                else if (!portListening && _frontendStatus == ServiceStatus.Running)
                {
                    _frontendStatus = ServiceStatus.Stopped;
                    LogMessage("前端", string.Format("端口 {0} 无响应", _config.FrontendPort));
                }
            }

            UpdateCardDisplay(isBackend);
        }

        private void UpdateCardDisplay(bool isBackend)
        {
            try
            {
                if (IsDisposed || Disposing) return;

                if (InvokeRequired)
                {
                    Invoke(new MethodInvoker(delegate { UpdateCardDisplay(isBackend); }));
                    return;
                }
            }
            catch { return; }

            ServiceStatus status = isBackend ? _backendStatus : _frontendStatus;
            string statusText = StatusToText(status);
            Color statusColor = StatusToColor(status);
            int pid = isBackend ? _processManager.BackendPid : _processManager.FrontendPid;
            int latency = isBackend ? _backendLatency : _frontendLatency;
            Button toggleBtn = isBackend ? _backendToggleBtn : _frontendToggleBtn;
            Panel statusDot = isBackend ? _backendStatusDot : _frontendStatusDot;

            Label statusLabel = isBackend ? _backendStatusLabel : _frontendStatusLabel;
            Label pidLabel = isBackend ? _backendPidLabel : _frontendPidLabel;
            Label latencyLabel = isBackend ? _backendLatencyLabel : _frontendLatencyLabel;

            if (statusLabel != null)
            {
                statusLabel.Text = statusText;
                statusLabel.ForeColor = statusColor;
            }

            if (pidLabel != null)
            {
                pidLabel.Text = pid > 0 ? pid.ToString() : "--";
                pidLabel.ForeColor = pid > 0 ? ThemeColors.TextSecondary : ThemeColors.TextMuted;
            }

            if (latencyLabel != null)
            {
                latencyLabel.Text = latency >= 0 ? string.Format("{0} ms", latency) : "-- ms";
                latencyLabel.ForeColor = latency >= 0 ? ThemeColors.Success : ThemeColors.TextMuted;
            }

            if (toggleBtn != null)
            {
                if (status == ServiceStatus.Running || status == ServiceStatus.Starting)
                {
                    toggleBtn.Text = "■  停止";
                    toggleBtn.ForeColor = ThemeColors.Error;
                    toggleBtn.FlatAppearance.BorderColor = Color.FromArgb(100, ThemeColors.Error);
                }
                else
                {
                    toggleBtn.Text = "▶  启动";
                    toggleBtn.ForeColor = ThemeColors.Success;
                    toggleBtn.FlatAppearance.BorderColor = Color.FromArgb(100, ThemeColors.Success);
                }
            }

            if (statusDot != null && statusDot.IsHandleCreated)
                statusDot.Invalidate();
        }

        // ==================================================================
        // Events
        // ==================================================================

        private void OnLogMessage(object sender, ProcessEventArgs e)
        {
            LogMessage(e.ServiceType.ToString(), e.Message);
        }

        private void OnStatusChanged(object sender, ProcessEventArgs e)
        {
            if (e.ServiceType == ServiceType.Backend)
            {
                if (e.Message == "stopped") _backendStatus = ServiceStatus.Stopped;
                else if (e.Message == "starting") _backendStatus = ServiceStatus.Starting;
            }
            else
            {
                if (e.Message == "stopped") _frontendStatus = ServiceStatus.Stopped;
                else if (e.Message == "starting") _frontendStatus = ServiceStatus.Starting;
            }
            UpdateCardDisplay(e.ServiceType == ServiceType.Backend);
        }

        private void LogMessage(string category, string message)
        {
            if (IsDisposed || Disposing) return;
            // Thread-safe enqueue; the UI thread drains the queue on the flush
            // timer, so a chatty process can never flood the UI thread.
            _logQueue.Enqueue(string.Format("[{0}] [{1}] {2}", DateTime.Now.ToString("HH:mm:ss"), category, message));
        }

        private const int MaxLogChars = 300000;

        private void LogFlushTimer_Tick(object sender, EventArgs e)
        {
            if (_logBox == null) return;
            if (IsDisposed || Disposing) return;

            _logBox.SuspendLayout();
            try
            {
                int appended = 0;
                string line;
                // Drain at most 60 lines per tick to keep the UI responsive
                // while still coalescing bursts of output.
                while (appended < 60 && _logQueue.TryDequeue(out line))
                {
                    Color color = ThemeColors.TextSecondary;
                    if (line.Contains("[后端]") || line.Contains("[Backend]")) color = ThemeColors.Success;
                    else if (line.Contains("[前端]") || line.Contains("[Frontend]")) color = ThemeColors.Accent;
                    else if (line.Contains("[警告]") || line.Contains("[WARN]")) color = ThemeColors.Warning;
                    else if (line.Contains("[错误]") || line.Contains("[ERROR]")) color = ThemeColors.Error;

                    _logBox.SelectionStart = _logBox.TextLength;
                    _logBox.SelectionLength = 0;
                    _logBox.SelectionColor = color;
                    _logBox.AppendText(line + "\n");
                    appended++;
                }

                if (appended > 0)
                {
                    // Keep the log bounded so appends stay fast over time.
                    if (_logBox.TextLength > MaxLogChars)
                    {
                        int excess = _logBox.TextLength - MaxLogChars;
                        _logBox.Select(0, excess);
                        _logBox.SelectedText = "";
                        _logBox.SelectionStart = _logBox.TextLength;
                        _logBox.SelectionLength = 0;
                    }
                    _logBox.SelectionStart = _logBox.TextLength;
                    _logBox.ScrollToCaret();
                }
            }
            finally
            {
                _logBox.ResumeLayout();
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                bool anyRunning = _processManager.IsBackendRunning || _processManager.IsFrontendRunning;

                if (anyRunning)
                {
                    ConfirmResult result = ConfirmDialog.Show(this,
                        "确认退出",
                        "服务仍在运行，是否停止后退出？\n点击【否】保留服务运行并退出界面。",
                        "是(Y)", "否(N)", "取消");

                    if (result == ConfirmResult.Cancel)
                    {
                        e.Cancel = true;
                        return;
                    }
                    else if (result == ConfirmResult.Yes)
                    {
                        _processManager.StopAll();
                    }
                }
                else
                {
                    ConfirmResult result = ConfirmDialog.Show(this,
                        "确认退出",
                        "确定要退出 Obara任务管理系统服务控制台 吗？",
                        "是(Y)", "否(N)", "取消");

                    if (result == ConfirmResult.Cancel || result == ConfirmResult.No)
                    {
                        e.Cancel = true;
                        return;
                    }
                }

                _monitorTimer.Stop();
                _animationTimer.Stop();
                _logFlushTimer.Stop();
                _processManager.Dispose();
                SaveConfig();
            }
        }

        // ==================================================================
        // Overrides
        // ==================================================================

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                // NOTE: WS_EX_COMPOSITED (0x02000000) was removed on purpose.
                // It forces software compositing of the whole window on every
                // repaint, which makes the UI stutter badly with the many
                // custom-painted child panels, and it can hide/cover text of
                // child controls (RichTextBox/TextBox). DoubleBuffered on the
                // form + per-control double buffering already prevent flicker.
                return cp;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            // Only draw the outer border; everything else is handled by child panels.
            var g = e.Graphics;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var pen = new Pen(Color.FromArgb(60, ThemeColors.Border), 1))
            {
                g.DrawRectangle(pen, rect);
            }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            PositionPathLabel();
        }
    }
}
