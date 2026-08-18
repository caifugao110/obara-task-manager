using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Threading;

namespace ObaraServiceController.Utils
{
    public enum ServiceType
    {
        Backend,
        Frontend
    }

    public class ProcessEventArgs : EventArgs
    {
        public string Message { get; set; }
        public ServiceType ServiceType { get; set; }
        public int Port { get; set; }

        public ProcessEventArgs(ServiceType serviceType, string message, int port)
        {
            ServiceType = serviceType;
            Message = message;
            Port = port;
        }
    }

    public class ProcessManager : IDisposable
    {
        private Process _backendProcess;
        private Process _frontendProcess;
        private volatile bool _isDisposed;

        public event EventHandler<ProcessEventArgs> LogMessage;
        public event EventHandler<ProcessEventArgs> StatusChanged;

        public bool IsBackendRunning
        {
            get { return _backendProcess != null && !_backendProcess.HasExited; }
        }

        public bool IsFrontendRunning
        {
            get { return _frontendProcess != null && !_frontendProcess.HasExited; }
        }

        public int BackendPid
        {
            get { return IsBackendRunning ? _backendProcess.Id : 0; }
        }

        public int FrontendPid
        {
            get { return IsFrontendRunning ? _frontendProcess.Id : 0; }
        }

        public bool StartBackend(int port)
        {
            if (IsBackendRunning)
            {
                OnLogMessage(new ProcessEventArgs(ServiceType.Backend, "后端服务已在运行中", port));
                return false;
            }

            if (!PathResolver.BackendExists)
            {
                OnLogMessage(new ProcessEventArgs(ServiceType.Backend, "后端目录不存在", port));
                return false;
            }

            try
            {
                string backendPath = PathResolver.BackendPath;
                string nodeModulesPath = Path.Combine(backendPath, "node_modules");
                bool nodeModulesExists = Directory.Exists(nodeModulesPath);

                if (!nodeModulesExists)
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Backend, "后端依赖未安装，正在安装...", port));
                    RunNpmInstall(backendPath);
                }

                var startInfo = new ProcessStartInfo();
                startInfo.FileName = "cmd.exe";
                startInfo.Arguments = string.Format("/c \"set PORT={0}&& npm start\"", port);
                startInfo.WorkingDirectory = backendPath;
                startInfo.CreateNoWindow = true;
                startInfo.UseShellExecute = false;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;

                _backendProcess = new Process();
                _backendProcess.StartInfo = startInfo;
                _backendProcess.EnableRaisingEvents = true;
                _backendProcess.OutputDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                        OnLogMessage(new ProcessEventArgs(ServiceType.Backend, e.Data, port));
                };
                _backendProcess.ErrorDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                        OnLogMessage(new ProcessEventArgs(ServiceType.Backend, "[ERROR] " + e.Data, port));
                };
                _backendProcess.Exited += (s, e) =>
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Backend, string.Format("后端进程已退出 (PID: {0})", _backendProcess != null ? _backendProcess.Id : 0), port));
                    OnStatusChanged(new ProcessEventArgs(ServiceType.Backend, "stopped", port));
                };

                _backendProcess.Start();
                _backendProcess.BeginOutputReadLine();
                _backendProcess.BeginErrorReadLine();

                OnLogMessage(new ProcessEventArgs(ServiceType.Backend, string.Format("后端服务启动中... (PID: {0}, 端口: {1})", _backendProcess.Id, port), port));
                OnStatusChanged(new ProcessEventArgs(ServiceType.Backend, "starting", port));
                return true;
            }
            catch (Exception ex)
            {
                OnLogMessage(new ProcessEventArgs(ServiceType.Backend, string.Format("后端启动失败: {0}", ex.Message), port));
                return false;
            }
        }

        public bool StartFrontend(int port)
        {
            if (IsFrontendRunning)
            {
                OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, "前端服务已在运行中", port));
                return false;
            }

            if (!PathResolver.FrontendExists)
            {
                OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, "前端目录不存在", port));
                return false;
            }

            try
            {
                string frontendPath = PathResolver.FrontendPath;
                string nodeModulesPath = Path.Combine(frontendPath, "node_modules");
                bool nodeModulesExists = Directory.Exists(nodeModulesPath);

                if (!nodeModulesExists)
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, "前端依赖未安装，正在安装...", port));
                    RunNpmInstall(frontendPath);
                }

                var startInfo = new ProcessStartInfo();
                startInfo.FileName = "cmd.exe";
                startInfo.Arguments = string.Format("/c \"set PORT={0}&& npm run dev\"", port);
                startInfo.WorkingDirectory = frontendPath;
                startInfo.CreateNoWindow = true;
                startInfo.UseShellExecute = false;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;

                _frontendProcess = new Process();
                _frontendProcess.StartInfo = startInfo;
                _frontendProcess.EnableRaisingEvents = true;
                _frontendProcess.OutputDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                        OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, e.Data, port));
                };
                _frontendProcess.ErrorDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                        OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, "[ERROR] " + e.Data, port));
                };
                _frontendProcess.Exited += (s, e) =>
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, string.Format("前端进程已退出 (PID: {0})", _frontendProcess != null ? _frontendProcess.Id : 0), port));
                    OnStatusChanged(new ProcessEventArgs(ServiceType.Frontend, "stopped", port));
                };

                _frontendProcess.Start();
                _frontendProcess.BeginOutputReadLine();
                _frontendProcess.BeginErrorReadLine();

                OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, string.Format("前端服务启动中... (PID: {0}, 端口: {1})", _frontendProcess.Id, port), port));
                OnStatusChanged(new ProcessEventArgs(ServiceType.Frontend, "starting", port));
                return true;
            }
            catch (Exception ex)
            {
                OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, string.Format("前端启动失败: {0}", ex.Message), port));
                return false;
            }
        }

        public void StopBackend()
        {
            if (_backendProcess != null && !_backendProcess.HasExited)
            {
                try
                {
                    _backendProcess.Kill();
                    _backendProcess.WaitForExit(5000);
                    OnLogMessage(new ProcessEventArgs(ServiceType.Backend, "后端服务已停止", 0));
                }
                catch { }
                finally
                {
                    if (_backendProcess != null)
                    {
                        _backendProcess.Dispose();
                        _backendProcess = null;
                    }
                }
            }
            OnStatusChanged(new ProcessEventArgs(ServiceType.Backend, "stopped", 0));
        }

        public void StopFrontend()
        {
            if (_frontendProcess != null && !_frontendProcess.HasExited)
            {
                try
                {
                    _frontendProcess.Kill();
                    _frontendProcess.WaitForExit(5000);
                    OnLogMessage(new ProcessEventArgs(ServiceType.Frontend, "前端服务已停止", 0));
                }
                catch { }
                finally
                {
                    if (_frontendProcess != null)
                    {
                        _frontendProcess.Dispose();
                        _frontendProcess = null;
                    }
                }
            }
            OnStatusChanged(new ProcessEventArgs(ServiceType.Frontend, "stopped", 0));
        }

        public void StopAll()
        {
            StopBackend();
            StopFrontend();
        }

        public void KillProcessByPort(int port)
        {
            try
            {
                var psi = new ProcessStartInfo();
                psi.FileName = "cmd.exe";
                psi.Arguments = string.Format("/c netstat -ano | findstr :{0} | findstr LISTENING", port);
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.CreateNoWindow = true;

                using (var process = Process.Start(psi))
                {
                    string output = process.StandardOutput.ReadToEnd();
                    process.WaitForExit();

                    var pids = new HashSet<int>();
                    foreach (var line in output.Split('\n'))
                    {
                        string[] parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 5)
                        {
                            int pid;
                            if (int.TryParse(parts[4], out pid))
                            {
                                pids.Add(pid);
                            }
                        }
                    }

                    foreach (int pid in pids)
                    {
                        try
                        {
                            if (pid != (_backendProcess != null ? _backendProcess.Id : 0) &&
                                pid != (_frontendProcess != null ? _frontendProcess.Id : 0))
                            {
                                Process.GetProcessById(pid).Kill();
                                OnLogMessage(new ProcessEventArgs(ServiceType.Backend, string.Format("已终止端口 {0} 上的进程 PID: {1}", port, pid), port));
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }
        }

        private void RunNpmInstall(string workingDirectory)
        {
            var psi = new ProcessStartInfo();
            psi.FileName = "npm.cmd";
            psi.Arguments = "install";
            psi.WorkingDirectory = workingDirectory;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;

            using (var process = Process.Start(psi))
            {
                while (!process.StandardOutput.EndOfStream)
                {
                    string line = process.StandardOutput.ReadLine();
                    if (!string.IsNullOrEmpty(line))
                        OnLogMessage(new ProcessEventArgs(ServiceType.Backend, "[npm] " + line, 0));
                }
                process.WaitForExit();

                if (process.ExitCode != 0)
                {
                    throw new Exception(string.Format("npm install 退出码: {0}", process.ExitCode));
                }
            }
        }

        protected virtual void OnLogMessage(ProcessEventArgs e)
        {
            var handler = LogMessage;
            if (handler != null)
                handler(this, e);
        }

        protected virtual void OnStatusChanged(ProcessEventArgs e)
        {
            var handler = StatusChanged;
            if (handler != null)
                handler(this, e);
        }

        public void Dispose()
        {
            if (_isDisposed) return;
            _isDisposed = true;
            StopAll();
        }
    }
}