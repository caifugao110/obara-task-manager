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
        private Label _messageLabel;
        private Button _yesBtn;
        private Button _noBtn;
        private Button _cancelBtn;

        public ConfirmResult Result { get; private set; }

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

        private void InitializeDialog()
        {
            SuspendLayout();

            Size = new Size(440, 200);
            StartPosition = FormStartPosition.CenterParent;
            BackColor = ThemeColors.PanelBackground;
            FormBorderStyle = FormBorderStyle.None;
            ControlBox = false;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowInTaskbar = false;

            _titleBar = new Panel();
            _titleBar.Dock = DockStyle.Top;
            _titleBar.Height = 36;
            _titleBar.BackColor = ThemeColors.TitleBarActive;
            _titleBar.Paint += TitleBar_Paint;
            Controls.Add(_titleBar);

            var titleLabel = new Label();
            titleLabel.Text = _title;
            titleLabel.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
            titleLabel.ForeColor = ThemeColors.TextPrimary;
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(16, 9);
            _titleBar.Controls.Add(titleLabel);

            _iconPanel = new Panel();
            _iconPanel.Size = new Size(48, 48);
            _iconPanel.Location = new Point(20, 58);
            _iconPanel.Paint += IconPanel_Paint;
            Controls.Add(_iconPanel);

            _messageLabel = new Label();
            _messageLabel.Text = _message;
            _messageLabel.Font = new Font("Segoe UI", 9.5F);
            _messageLabel.ForeColor = ThemeColors.TextPrimary;
            _messageLabel.AutoSize = false;
            _messageLabel.Location = new Point(80, 55);
            _messageLabel.Size = new Size(Width - 110, 60);
            _messageLabel.TextAlign = ContentAlignment.MiddleLeft;
            Controls.Add(_messageLabel);

            _yesBtn = CreateDialogButton(_yesText, ThemeColors.Success);
            _yesBtn.Size = new Size(90, 32);
            _yesBtn.Location = new Point(Width - 290, Height - 56);
            _yesBtn.Click += (s, e) => { Result = ConfirmResult.Yes; Close(); };
            Controls.Add(_yesBtn);

            _noBtn = CreateDialogButton(_noText, ThemeColors.Accent);
            _noBtn.Size = new Size(90, 32);
            _noBtn.Location = new Point(Width - 195, Height - 56);
            _noBtn.Click += (s, e) => { Result = ConfirmResult.No; Close(); };
            Controls.Add(_noBtn);

            _cancelBtn = CreateDialogButton(_cancelText, ThemeColors.TextSecondary);
            _cancelBtn.Size = new Size(90, 32);
            _cancelBtn.Location = new Point(Width - 100, Height - 56);
            _cancelBtn.Click += (s, e) => { Result = ConfirmResult.Cancel; Close(); };
            Controls.Add(_cancelBtn);

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
            btn.FlatAppearance.BorderColor = accentColor;
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.MouseOverBackColor = ThemeColors.ButtonPressed;
            btn.FlatAppearance.MouseDownBackColor = ThemeColors.ButtonHover;
            btn.BackColor = ThemeColors.ButtonHover;
            btn.ForeColor = accentColor;
            btn.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
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
                ThemeColors.PanelBackground,
                LinearGradientMode.Horizontal))
            {
                g.FillRectangle(brush, _titleBar.ClientRectangle);
            }
            using (var pen = new Pen(ThemeColors.Border, 1))
            {
                g.DrawLine(pen, 0, _titleBar.Height - 1, _titleBar.Width, _titleBar.Height - 1);
            }
        }

        private void IconPanel_Paint(object sender, PaintEventArgs e)
        {
            if (_iconPanel == null) return;

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            var circleRect = new Rectangle(0, 0, 48, 48);
            using (var path = RoundedRect(circleRect, 24))
            using (var brush = new LinearGradientBrush(circleRect, Color.FromArgb(0, 150, 220), Color.FromArgb(0, 212, 255), 135f))
            {
                g.FillPath(brush, path);
            }

            using (var pen = new Pen(Color.White, 2))
            {
                g.DrawEllipse(pen, 16, 8, 16, 16);
            }

            using (var brush = new SolidBrush(Color.White))
            using (var font = new Font("Segoe UI", 16F, FontStyle.Bold))
            {
                var sf = new StringFormat
                {
                    Alignment = StringAlignment.Center,
                    LineAlignment = StringAlignment.Center
                };
                g.DrawString("?", font, brush, new RectangleF(12, 22, 24, 22), sf);
            }
        }

        private GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            int diameter = radius * 2;
            path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        private void Dialog_Paint(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var pen = new Pen(ThemeColors.Border, 1.5f))
            {
                g.DrawRectangle(pen, rect);
            }
            Color accentLeft = Color.FromArgb(80, ThemeColors.Accent);
            Color accentRight = Color.FromArgb(80, ThemeColors.SecondaryAccent);
            using (var brush = new LinearGradientBrush(
                new Rectangle(0, 36, Width, 2),
                accentLeft, accentRight, LinearGradientMode.Horizontal))
            {
                g.FillRectangle(brush, 0, 36, Width, 2);
            }
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