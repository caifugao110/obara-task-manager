namespace ObaraServiceController
{
    partial class MainForm
    {
        private System.ComponentModel.IContainer components = null;

        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();
            // The whole UI is laid out with explicit pixel coordinates in
            // MainForm.BuildUi(), so Font-based auto-scaling must be disabled.
            // AutoScaleMode.Font was scaling the form to ~1097x875 on this
            // machine (vs the designed 940x700), distorting every control and
            // causing text to be covered/overlapped.
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 12F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.None;
            this.BackColor = System.Drawing.Color.FromArgb(15, 15, 26);
            this.ClientSize = new System.Drawing.Size(900, 650);
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.None;
            using (var stream = typeof(MainForm).Assembly.GetManifestResourceStream("ObaraServiceController.Resources.app.ico"))
            {
                if (stream != null)
                {
                    this.Icon = new System.Drawing.Icon(stream);
                }
            }
            this.Name = "MainForm";
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.Text = "Obara任务管理系统服务控制台";
            this.MinimumSize = new System.Drawing.Size(800, 550);
            this.ResumeLayout(false);
            this.ResizeEnd += (s, e) => this.Invalidate();
        }
    }
}