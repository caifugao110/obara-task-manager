using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using ObaraServiceController.Utils;

namespace ObaraServiceController
{
    public enum ConfirmResult
    {
        Yes,
        No,
        Cancel
    }

    public class ConfirmDialog : Form
    {
        private readonly string _title;
        private readonly string _message;
        private readonly string _yesText;
        private readonly string _noText;
        private readonly string _cancelText;

        private Panel _titleBar;
        private Panel _iconPanel;
        private Label _titleLabel;
        private Label _messageLabel;
        private Button _yesBtn;
        private Button _noBtn;
        private Button _cancelBtn;

        public ConfirmResult Result { get; private set; }

        // Layout constants — tuned so the dialog reads naturally on 100% /
        // 125% / 150% DPI without Chinese text ever getting clipped by the
        // rounded icon panel or the button row.
        private const int TitleBarHeight = 44;
        private const int ContentPadding = 28;
        private const int IconSize = 56;
        private const int ButtonWidth = 112;
        private const int ButtonHeight = 40;
        private const int ButtonGap = 16;
        private const int DialogMinWidth = 520;
        private const int DialogMinHeight = 236;

        public ConfirmDialog(string title, string message, string yesText, string noText, string cancelText)
        {
            _title = title;
            _message = message;
            _yesText = yesText;
            _noText = noText;
            _cancelText = cancelText;
            Result = ConfirmResult.Cancel;

            InitializeDialog();
        }

        // CJK-aware font helper, shared with MainForm.
        private static Font CreateUiFont(float size, FontStyle style)
        {
            try { return new Font("Microsoft YaHei UI", size, style); }
            catch { try { return new Font("Microsoft YaHei", size, style); } catch { return new Font("Segoe UI", size, style); } }
        }

        private void InitializeDialog()
        {
            SuspendLayout();

            // Compute size from content so the message area never clips and
            // the three buttons always fit with even spacing on either side.
            using (var measureFont = CreateUiFont(9.5F, FontStyle.Regular))
            {
                Size proposed = TextRenderer.MeasureText(_message, measureFont,
                    new Size(DialogMinWidth - ContentPadding * 2 - IconSize - 20, 0),
                    TextFormatFlags.WordBreak | TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
                int contentHeight = Math.Max(IconSize, proposed.Height + 12);
                int height = TitleBarHeight + ContentPadding + contentHeight + ContentPadding + ButtonHeight + ContentPadding;
                height = Math.Max(height, DialogMinHeight);
                Size = new Size(DialogMinWidth, height);
            }

            StartPosition = FormStartPosition.CenterParent;
            BackColor = ThemeColors.PanelBackground;
            FormBorderStyle = FormBorderStyle.None;
            ControlBox = false;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowInTaskbar = false;
            DoubleBuffered = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);

            // -------- Title bar --------
            _titleBar = new Panel();
            _titleBar.Dock = DockStyle.Top;
            _titleBar.Height = TitleBarHeight;
            _titleBar.BackColor = ThemeColors.TitleBarActive;
            _titleBar.Paint += TitleBar_Paint;
            Controls.Add(_titleBar);

            _titleLabel = new Label();
            _titleLabel.Text = _title;
            _titleLabel.Font = CreateUiFont(11F, FontStyle.Bold);
            _titleLabel.ForeColor = ThemeColors.TextPrimary;
            _titleLabel.AutoSize = true;
            _titleLabel.Location = new Point(20, 13);
            _titleLabel.BackColor = Color.Transparent;
            _titleBar.Controls.Add(_titleLabel);

            // Close button (X) — bigger hit target, cleaner hover highlight.
            var closeBtn = new Label();
            closeBtn.Text = "✕";
            closeBtn.Font = new Font("Segoe UI Symbol", 11F);
            closeBtn.ForeColor = ThemeColors.TextSecondary;
            closeBtn.Size = new Size(44, TitleBarHeight - 8);
            closeBtn.Location = new Point(Width - closeBtn.Width - 4, 4);
            closeBtn.TextAlign = ContentAlignment.MiddleCenter;
            closeBtn.Cursor = Cursors.Hand;
            closeBtn.MouseEnter += (s, e) =>
            {
                closeBtn.BackColor = ThemeColors.Error;
                closeBtn.ForeColor = Color.White;
            };
            closeBtn.MouseLeave += (s, e) =>
            {
                closeBtn.BackColor = Color.Transparent;
                closeBtn.ForeColor = ThemeColors.TextSecondary;
            };
            closeBtn.Click += (s, e) => { Result = ConfirmResult.Cancel; Close(); };
            _titleBar.Controls.Add(closeBtn);

            // -------- Icon + message body --------
            int bodyY = TitleBarHeight + ContentPadding;
            int iconX = ContentPadding;
            int iconY = bodyY;

            _iconPanel = new Panel();
            _iconPanel.Size = new Size(IconSize, IconSize);
            _iconPanel.Location = new Point(iconX, iconY);
            _iconPanel.Paint += IconPanel_Paint;
            Controls.Add(_iconPanel);

            _messageLabel = new Label();
            _messageLabel.Text = _message;
            _messageLabel.Font = CreateUiFont(9.8F, FontStyle.Regular);
            _messageLabel.ForeColor = ThemeColors.TextPrimary;
            _messageLabel.AutoSize = false;
            int msgX = iconX + IconSize + 20;
            int msgWidth = Width - msgX - ContentPadding;
            int msgHeight = Height - bodyY - ButtonHeight - ContentPadding * 2;
            _messageLabel.Location = new Point(msgX, bodyY);
            _messageLabel.Size = new Size(msgWidth, Math.Max(IconSize, msgHeight));
            _messageLabel.TextAlign = ContentAlignment.MiddleLeft;
            _messageLabel.BackColor = Color.Transparent;
            Controls.Add(_messageLabel);

            // -------- Buttons (horizontally centered, equal gap) --------
            int totalBtnWidth = ButtonWidth * 3 + ButtonGap * 2;
            int btnStartX = (Width - totalBtnWidth) / 2;
            int btnY = Height - ButtonHeight - ContentPadding;

            _yesBtn = CreateDialogButton(_yesText, ThemeColors.Success);
            _yesBtn.Size = new Size(ButtonWidth, ButtonHeight);
            _yesBtn.Location = new Point(btnStartX, btnY);
            _yesBtn.Click += (s, e) => { Result = ConfirmResult.Yes; Close(); };
            Controls.Add(_yesBtn);

            _noBtn = CreateDialogButton(_noText, ThemeColors.Accent);
            _noBtn.Size = new Size(ButtonWidth, ButtonHeight);
            _noBtn.Location = new Point(btnStartX + ButtonWidth + ButtonGap, btnY);
            _noBtn.Click += (s, e) => { Result = ConfirmResult.No; Close(); };
            Controls.Add(_noBtn);

            _cancelBtn = CreateDialogButton(_cancelText, ThemeColors.TextSecondary);
            _cancelBtn.Size = new Size(ButtonWidth, ButtonHeight);
            _cancelBtn.Location = new Point(btnStartX + (ButtonWidth + ButtonGap) * 2, btnY);
            _cancelBtn.Click += (s, e) => { Result = ConfirmResult.Cancel; Close(); };
            Controls.Add(_cancelBtn);

            // Default focus goes to the safe, non-destructive middle button
            // ("否") rather than "是", so hitting Enter by accident never
            // kills the running services.
            _noBtn.Select();
            AcceptButton = _noBtn;
            CancelButton = _cancelBtn;

            Paint += Dialog_Paint;
            KeyPreview = true;
            KeyDown += Dialog_KeyDown;

            ResumeLayout(false);
        }

        private Button CreateDialogButton(string text, Color accentColor)
        {
            var btn = new Button();
            btn.Text = text;
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderColor = Color.FromArgb(130, accentColor);
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.MouseOverBackColor = ThemeColors.ButtonPressed;
            btn.FlatAppearance.MouseDownBackColor = ThemeColors.ButtonHover;
            btn.BackColor = Color.FromArgb(32, 36, 66);
            btn.ForeColor = accentColor;
            btn.Font = CreateUiFont(9.5F, FontStyle.Bold);
            btn.Cursor = Cursors.Hand;
            return btn;
        }

        private void TitleBar_Paint(object sender, PaintEventArgs e)
        {
            if (_titleBar == null) return;

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var brush = new LinearGradientBrush(
                new Rectangle(0, 0, _titleBar.Width, _titleBar.Height),
                ThemeColors.TitleBarActive,
                Color.FromArgb(30, 30, 56),
                LinearGradientMode.Horizontal))
            {
                g.FillRectangle(brush, _titleBar.ClientRectangle);
            }
            // Bottom accent stripe (matches MainForm style)
            Color accentLeft = Color.FromArgb(120, ThemeColors.Accent);
            Color accentRight = Color.FromArgb(120, ThemeColors.SecondaryAccent);
            using (var brush = new LinearGradientBrush(
                new Rectangle(0, _titleBar.Height - 2, _titleBar.Width, 2),
                accentLeft, accentRight, LinearGradientMode.Horizontal))
            {
                g.FillRectangle(brush, 0, _titleBar.Height - 2, _titleBar.Width, 2);
            }
        }

        private void IconPanel_Paint(object sender, PaintEventArgs e)
        {
            if (_iconPanel == null) return;

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            // Glow behind the circular badge so it pops on the dark panel.
            var glowRect = new Rectangle(-4, -4, IconSize + 8, IconSize + 8);
            using (var glowPath = RoundedRect(glowRect, (IconSize + 8) / 2))
            using (var glowBrush = new SolidBrush(Color.FromArgb(28, ThemeColors.Accent)))
                g.FillPath(glowBrush, glowPath);

            // Badge circle with accent gradient.
            var badgeRect = new Rectangle(0, 0, IconSize, IconSize);
            using (var badgePath = RoundedRect(badgeRect, IconSize / 2))
            using (var badgeBrush = new LinearGradientBrush(badgeRect,
                Color.FromArgb(0, 150, 220), Color.FromArgb(123, 47, 247), 135f))
            {
                g.FillPath(badgeBrush, badgePath);
            }
            // Subtle inner highlight to give the badge a little depth.
            using (var highlightPen = new Pen(Color.FromArgb(80, Color.White), 1.2f))
                g.DrawEllipse(highlightPen, 3, 3, IconSize - 6, IconSize - 6);

            // Centered "?" glyph — sized so the ascender + descender never
            // touches the badge border even at 150% DPI.
            using (var qBrush = new SolidBrush(Color.White))
            using (var qFont = new Font("Segoe UI", 22F, FontStyle.Bold))
            {
                var sf = new StringFormat
                {
                    Alignment = StringAlignment.Center,
                    LineAlignment = StringAlignment.Center
                };
                g.DrawString("?", qFont, qBrush,
                    new RectangleF(0, 2, IconSize, IconSize), sf);
            }
        }

        private static GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            int d = radius * 2;
            if (d > rect.Width) d = rect.Width;
            if (d > rect.Height) d = rect.Height;
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private void Dialog_Paint(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var pen = new Pen(ThemeColors.Border, 1.5f))
                g.DrawRectangle(pen, rect);
        }

        private void Dialog_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                Result = ConfirmResult.Cancel;
                Close();
            }
        }

        public static ConfirmResult Show(string title, string message)
        {
            return Show(title, message, "是(Y)", "否(N)", "取消");
        }

        public static ConfirmResult Show(string title, string message, string yesText, string noText, string cancelText)
        {
            using (var dialog = new ConfirmDialog(title, message, yesText, noText, cancelText))
            {
                dialog.ShowDialog();
                return dialog.Result;
            }
        }

        public static ConfirmResult Show(IWin32Window owner, string title, string message)
        {
            return Show(owner, title, message, "是(Y)", "否(N)", "取消");
        }

        public static ConfirmResult Show(IWin32Window owner, string title, string message, string yesText, string noText, string cancelText)
        {
            using (var dialog = new ConfirmDialog(title, message, yesText, noText, cancelText))
            {
                dialog.ShowDialog(owner);
                return dialog.Result;
            }
        }
    }
}
