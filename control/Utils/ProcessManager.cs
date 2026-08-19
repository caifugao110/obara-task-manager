using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Text;
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

        // Ports used during cleanup when StopBackend/StopFrontend also needs
        // to kill any remaining orphan process listening on the service
        // port.  Kept in sync by MainForm whenever the user edits a port.
        public static int BackendCleanupPort = 5000;
        public static int FrontendCleanupPort = 5173;

        // Cached absolute paths to the real runtime executables.  Using
        // absolute paths and launching Node directly (instead of going
        // through npm.cmd / Corepack shims) eliminates two serious bugs:
        //   1. npm.cmd's %~dp0 resolution can be confused when the current
        //      working directory lives inside a project with package.json
        //      and NODE_PATHS/Prefix heuristics go looking for a "local" npm
        //      inside <project>\node_modules\npm\... (throwing
        //      MODULE_NOT_FOUND npm-cli.js when that local copy doesn't
        //      exist, which is exactly the user's new error report).
        //   2. Paths containing spaces (e.g. "My Trae") can defeat the
        //      cmd.exe PATH search when combined with CreateNoWindow and
        //      UseShellExecute=false.
        // Using explicit absolute filenames removes all shim ambiguity.
        private static string _cachedNodeExe;
        private static string _cachedNpmCliJs;
        private static string _cachedResolutionError;
        private static readonly object _pathCacheLock = new object();

        public event EventHandler<ProcessEventArgs> LogMessage;
        public event EventHandler<ProcessEventArgs> StatusChanged;

        // Run PATH resolution once.  Caches are never cleared for the
        // lifetime of the controller process.
        private static void EnsureNodeAndNpmResolved()
        {
            if (_cachedNodeExe != null) return;
            lock (_pathCacheLock)
            {
                if (_cachedNodeExe != null) return;
                string nodeExe = FindInPath("node.exe");
                string npmCmd  = FindInPath("npm.cmd");
                string npmCli  = null;

                // Standard Node.js MSI layout:
                //   C:\Program Files\nodejs\node.exe
                //   C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js
                if (nodeExe != null)
                {
                    string nodeDir = Path.GetDirectoryName(nodeExe);
                    if (nodeDir != null)
                    {
                        string candidate = Path.Combine(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
                        if (File.Exists(candidate)) npmCli = candidate;
                    }
                }

                // Fallback: parse the npm.cmd shim.  The standard npm.cmd
                // shipped with Node always contains a line that references
                // "...\node_modules\npm\bin\npm-cli.js" explicitly.  Reading
                // it gives us a second chance even if the layout differs.
                if (npmCli == null && npmCmd != null)
                {
                    try
                    {
                        string npmDir = Path.GetDirectoryName(npmCmd);
                        foreach (string line in File.ReadAllLines(npmCmd))
                        {
                            int idx = line.IndexOf("node_modules\\npm\\bin\\npm-cli.js",
                                StringComparison.OrdinalIgnoreCase);
                            if (idx >= 0)
                            {
                                // Find the quote-delimited token that ends
                                // with npm-cli.js on this line.
                                int start = line.LastIndexOf('"', idx) + 1;
                                int endQuote = line.IndexOf('"', idx);
                                if (endQuote < 0) endQuote = line.Length;
                                string tail = line.Substring(start, Math.Max(0, endQuote - start));
                                if (!Path.IsPathRooted(tail) && npmDir != null)
                                    tail = Path.Combine(npmDir, tail);
                                string full = Path.GetFullPath(tail);
                                if (File.Exists(full)) { npmCli = full; break; }
                            }
                        }
                    }
                    catch { /* swallow — npm.cmd unreadable is OK, we'll try fallback */ }
                }

                // Last-ditch fallback: scan the user's global npm prefix
                // cache (e.g. %APPDATA%\npm\node_modules\npm\bin\npm-cli.js)
                if (npmCli == null)
                {
                    try
                    {
                        string appDataNpm = Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                            "npm", "node_modules", "npm", "bin", "npm-cli.js");
                        if (File.Exists(appDataNpm)) npmCli = appDataNpm;
                    }
                    catch { }
                }

                // Ultimate fallback for node.exe: the PATH env var we read
                // from .NET can occasionally differ from the one the Win32
                // CreateProcess search uses.  Launching a tiny Node probe
                // (which lets the OS do the search) and asking it to print
                // process.execPath gives us a guaranteed correct absolute
                // path for the exact same node binary the OS would start.
                if (nodeExe == null)
                    nodeExe = ResolveNodeExeByProbe();

                if (nodeExe == null)
                    _cachedResolutionError =
                        "未在 PATH 中找到 node.exe，请确认 Node.js 已安装并加入系统 PATH。";
                else if (npmCli == null)
                {
                    // After a probe-based resolution we still know nodeDir,
                    // so give the standard npm layout lookup one last shot.
                    string nodeDir = Path.GetDirectoryName(nodeExe);
                    if (nodeDir != null)
                    {
                        string candidate = Path.Combine(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
                        if (File.Exists(candidate)) npmCli = candidate;
                    }
                    if (npmCli == null)
                        _cachedResolutionError =
                            string.Format(
                                "找到 node.exe ({0})，但无法定位全局 npm-cli.js 入口脚本。请重装 Node.js 或手动执行 npm install。",
                                nodeExe);
                }

                _cachedNodeExe = nodeExe;
                _cachedNpmCliJs = npmCli;
            }
        }

        // Ask the OS to find node.exe (via CreateProcess PATH search) and have
        // it report its own absolute path.  Used as the final fallback when
        // the Environment.GetEnvironmentVariable("PATH") string we manually
        // scan misses node.exe's real location.
        private static string ResolveNodeExeByProbe()
        {
            try
            {
                using (var probe = new Process())
                {
                    probe.StartInfo = new ProcessStartInfo
                    {
                        FileName = "node.exe",
                        Arguments = "-e \"console.log(process.execPath)\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        StandardOutputEncoding = Encoding.UTF8,
                        StandardErrorEncoding = Encoding.UTF8,
                    };
                    probe.Start();
                    string result = probe.StandardOutput.ReadLine();
                    probe.WaitForExit(5000);
                    if (probe.ExitCode == 0 && !string.IsNullOrEmpty(result))
                    {
                        result = result.Trim().Trim('"');
                        if (File.Exists(result)) return result;
                    }
                }
            }
            catch { /* CreateProcess failed → node not reachable at all */ }
            return null;
        }

        private static string FindInPath(string fileName)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string raw in pathEnv.Split(Path.PathSeparator))
            {
                string dir = raw.Trim();
                if (dir.Length == 0) continue;
                // Remove surrounding quotes if present (some PATH entries
                // come quoted when read through .NET).
                if (dir.StartsWith("\"") && dir.EndsWith("\""))
                    dir = dir.Substring(1, dir.Length - 2);
                try
                {
                    string candidate = Path.Combine(dir, fileName);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { /* skip malformed PATH entries */ }
            }
            // When everything else fails, let CreateProcess do the search
            // once more — sometimes the current process environment differs
            // from what Environment.GetEnvironmentVariable reads.  We use
            // this value as a non-absolute last-resort fallback.
            return null;
        }

        // A successful npm install always creates node_modules/.bin (for
        // package bin scripts).  If the directory exists but .bin is missing
        // the previous install was killed/corrupted and we must wipe and
        // reinstall from scratch — otherwise the naive "directory exists?"
        // check skips install entirely and the service can never boot.
        private static bool IsNodeModulesHealthy(string projectDir)
        {
            string nm = Path.Combine(projectDir, "node_modules");
            if (!Directory.Exists(nm)) return false;
            if (!Directory.Exists(Path.Combine(nm, ".bin"))) return false;
            return true;
        }

        // Recursively wipe node_modules.  Uses cmd /c rd because recursive
        // Directory.Delete on hundreds of small npm cache files throws
        // UnauthorizedAccessException 30% of the time on Windows.
        private static void SafeDeleteNodeModules(string projectDir,
            Action<ServiceType, string> log, ServiceType type)
        {
            string nm = Path.Combine(projectDir, "node_modules");
            if (!Directory.Exists(nm)) return;
            try
            {
                Directory.Delete(nm, true);
                log(type, "已清理损坏的 node_modules 目录");
                return;
            }
            catch { }

            try
            {
                using (var p = new Process())
                {
                    p.StartInfo = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = string.Format("/c rd /s /q \"{0}\"", nm),
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };
                    p.Start();
                    p.WaitForExit(15000);
                    if (!Directory.Exists(nm))
                        log(type, "已清理损坏的 node_modules 目录");
                    else
                        log(type, "[warn] 清理 node_modules 失败，请手动删除后重试");
                }
            }
            catch { }
        }

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
                EnsureNodeAndNpmResolved();
                if (_cachedResolutionError != null)
                    throw new Exception(_cachedResolutionError);

                string backendPath = PathResolver.BackendPath;

                // ---- node_modules health + install ----
                // Replace the naive "directory exists?" check with a real
                // integrity check.  The previous pipe-deadlocked npm install
                // could leave behind an empty node_modules shell that would
                // skip install forever if we only checked Directory.Exists.
                bool healthy = IsNodeModulesHealthy(backendPath);
                bool nmDirExisted = Directory.Exists(Path.Combine(backendPath, "node_modules"));
                if (nmDirExisted && !healthy)
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Backend,
                        "检测到遗留的损坏 node_modules，正在清理...", port));
                    Action<ServiceType, string> logAdapter = (svc, msg) =>
                        OnLogMessage(new ProcessEventArgs(svc, msg, port));
                    SafeDeleteNodeModules(backendPath, logAdapter, ServiceType.Backend);
                }
                if (!healthy)
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Backend,
                        nmDirExisted ? "后端依赖损坏，正在重新安装..." : "后端依赖未安装，正在安装...", port));
                    RunNpmInstall(backendPath, ServiceType.Backend);
                }

                // ---- Service startup: node.exe server.js (direct, no npm) ----
                // Going through "npm start" would spawn an extra npm.cmd → cmd
                // wrapper that (a) breaks stop (see the process-tree kill bug
                // we just fixed) and (b) re-exposes us to the very npm-path
                // resolution bug this fix is eliminating.  Launching node
                // directly with PORT injected in ProcessStartInfo's env block
                // is the cleanest and most predictable outcome — the tracked
                // PID IS the real backend Node process, port env is passed
                // through exactly how server.js expects it.
                string serverEntry = Path.Combine(backendPath, "server.js");
                if (!File.Exists(serverEntry))
                    throw new Exception("后端入口文件不存在 (server.js)，请检查目录结构。");

                var startInfo = new ProcessStartInfo();
                startInfo.FileName = _cachedNodeExe;
                startInfo.Arguments = string.Format("\"{0}\"", serverEntry);
                startInfo.WorkingDirectory = backendPath;
                startInfo.CreateNoWindow = true;
                startInfo.UseShellExecute = false;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;
                // Force UTF-8 decode on stdout/stderr so Chinese log lines
                // and UTF-8 glyphs (✓, ↻, ➜…) emitted by dotenv-vault, vite,
                // or the user's own server code never show up as the
                // "鈼? 鉃?" mojibake the user reported.
                startInfo.StandardOutputEncoding = Encoding.UTF8;
                startInfo.StandardErrorEncoding = Encoding.UTF8;
                try
                {
                    // Environment key names are case-insensitive on Windows,
                    // but Node server.js usually reads process.env.PORT so
                    // write it in the canonical UPPER-case-PORT spelling,
                    // and clear any prior value to avoid duplicates in the
                    // string dictionary.
                    if (startInfo.EnvironmentVariables.ContainsKey("PORT"))
                        startInfo.EnvironmentVariables["PORT"] = port.ToString();
                    else
                        startInfo.EnvironmentVariables.Add("PORT", port.ToString());
                }
                catch { /* Some .NET Framework SKUs throw on writing env —
                          start anyway, the script will fall back. */ }

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
                EnsureNodeAndNpmResolved();
                if (_cachedResolutionError != null)
                    throw new Exception(_cachedResolutionError);

                string frontendPath = PathResolver.FrontendPath;

                // Same node_modules health check as the backend path.
                bool healthy = IsNodeModulesHealthy(frontendPath);
                bool nmDirExisted = Directory.Exists(Path.Combine(frontendPath, "node_modules"));
                if (nmDirExisted && !healthy)
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Frontend,
                        "检测到遗留的损坏 node_modules，正在清理...", port));
                    Action<ServiceType, string> logAdapter = (svc, msg) =>
                        OnLogMessage(new ProcessEventArgs(svc, msg, port));
                    SafeDeleteNodeModules(frontendPath, logAdapter, ServiceType.Frontend);
                }
                if (!healthy)
                {
                    OnLogMessage(new ProcessEventArgs(ServiceType.Frontend,
                        nmDirExisted ? "前端依赖损坏，正在重新安装..." : "前端依赖未安装，正在安装...", port));
                    RunNpmInstall(frontendPath, ServiceType.Frontend);
                }

                // ---- Frontend startup: <node> <npm-cli.js> run dev ----
                // Unlike the backend which has a plain server.js entry, the
                // frontend uses Vite ("vite" in package.json scripts).  We
                // could resolve node_modules/vite/bin/vite.js directly after
                // install, but using the absolute node + global npm-cli.js is
                // more robust against different package managers and
                // alternative Vite entry points on user machines, AND it
                // still avoids the Corepack/npm.cmd shim bugs (we call
                // npm-cli.js directly, not npm.cmd).
                var startInfo = new ProcessStartInfo();
                startInfo.FileName = _cachedNodeExe;
                startInfo.Arguments = string.Format("\"{0}\" run dev", _cachedNpmCliJs);
                startInfo.WorkingDirectory = frontendPath;
                startInfo.CreateNoWindow = true;
                startInfo.UseShellExecute = false;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;
                startInfo.StandardOutputEncoding = Encoding.UTF8;
                startInfo.StandardErrorEncoding = Encoding.UTF8;
                try
                {
                    if (startInfo.EnvironmentVariables.ContainsKey("PORT"))
                        startInfo.EnvironmentVariables["PORT"] = port.ToString();
                    else
                        startInfo.EnvironmentVariables.Add("PORT", port.ToString());
                }
                catch { /* env write not critical — vite will fall back */ }

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

        // Kill an entire Win32 process tree (cmd.exe → npm.cmd → node.exe → ...)
        // using the OS-supplied "taskkill /T /F" command. Process.Kill() on the
        // wrapper cmd.exe only kills the shell, leaving the real Node service
        // running as an orphan (the user-reported "无法停止服务" bug).
        private static bool TryKillProcessTree(int pid, int timeoutMs)
        {
            if (pid <= 0) return false;
            try
            {
                using (var killer = new Process())
                {
                    killer.StartInfo = new ProcessStartInfo
                    {
                        FileName = "taskkill.exe",
                        Arguments = string.Format("/PID {0} /T /F", pid),
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };
                    killer.Start();
                    // Drain output so taskkill never blocks on a full pipe.
                    killer.BeginOutputReadLine();
                    killer.BeginErrorReadLine();
                    return killer.WaitForExit(timeoutMs) && killer.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        public void StopBackend()
        {
            ServiceType type = ServiceType.Backend;
            OnStatusChanged(new ProcessEventArgs(type, "stopping", 0));
            bool stoppedAny = false;

            if (_backendProcess != null)
            {
                int pid = 0;
                try { if (!_backendProcess.HasExited) pid = _backendProcess.Id; } catch { }

                if (pid > 0)
                {
                    stoppedAny = TryKillProcessTree(pid, 8000);
                    try
                    {
                        if (_backendProcess != null && !_backendProcess.HasExited)
                        {
                            // Last-resort direct Kill (handles cases where
                            // taskkill.exe is unavailable on trimmed Windows).
                            _backendProcess.Kill();
                            _backendProcess.WaitForExit(3000);
                        }
                    }
                    catch { }
                }

                try { if (_backendProcess != null) { _backendProcess.Dispose(); _backendProcess = null; } }
                catch { _backendProcess = null; }
            }

            // Always clean up orphans: if our cmd wrapper died its node.exe
            // child could still be listening on the service port.
            int port = BackendCleanupPort;
            try
            {
                int killed = KillProcessByPortInternal(port, type);
                if (killed > 0) stoppedAny = true;
            }
            catch { }

            OnLogMessage(new ProcessEventArgs(type, stoppedAny ? "后端服务已停止" : "后端服务已确认停止", port));
            OnStatusChanged(new ProcessEventArgs(type, "stopped", 0));
        }

        public void StopFrontend()
        {
            ServiceType type = ServiceType.Frontend;
            OnStatusChanged(new ProcessEventArgs(type, "stopping", 0));
            bool stoppedAny = false;

            if (_frontendProcess != null)
            {
                int pid = 0;
                try { if (!_frontendProcess.HasExited) pid = _frontendProcess.Id; } catch { }

                if (pid > 0)
                {
                    stoppedAny = TryKillProcessTree(pid, 8000);
                    try
                    {
                        if (_frontendProcess != null && !_frontendProcess.HasExited)
                        {
                            _frontendProcess.Kill();
                            _frontendProcess.WaitForExit(3000);
                        }
                    }
                    catch { }
                }

                try { if (_frontendProcess != null) { _frontendProcess.Dispose(); _frontendProcess = null; } }
                catch { _frontendProcess = null; }
            }

            int port = FrontendCleanupPort;
            try
            {
                int killed = KillProcessByPortInternal(port, type);
                if (killed > 0) stoppedAny = true;
            }
            catch { }

            OnLogMessage(new ProcessEventArgs(type, stoppedAny ? "前端服务已停止" : "前端服务已确认停止", port));
            OnStatusChanged(new ProcessEventArgs(type, "stopped", 0));
        }

        public void StopAll()
        {
            StopBackend();
            StopFrontend();
        }

        public void KillProcessByPort(int port)
        {
            KillProcessByPortInternal(port, ServiceType.Backend);
        }

        // Core "kill everything listening on this port" logic shared by stop
        // paths.  Uses taskkill /T /F so child processes are always cleaned up
        // (avoids orphan node.exe processes that would make the UI claim
        // "stopped" while the port is still occupied).
        private int KillProcessByPortInternal(int port, ServiceType logType)
        {
            int killedCount = 0;
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
                            if (int.TryParse(parts[4], out pid) && pid > 0)
                            {
                                pids.Add(pid);
                            }
                        }
                    }

                    foreach (int pid in pids)
                    {
                        try
                        {
                            // Terminate the process tree. Fall back to direct
                            // Process.Kill if taskkill cannot reach it (e.g.
                            // permission edge cases on some Windows SKUs).
                            bool killed = TryKillProcessTree(pid, 5000);
                            if (!killed)
                            {
                                try { Process.GetProcessById(pid).Kill(); killed = true; }
                                catch { }
                            }
                            if (killed)
                            {
                                killedCount++;
                                OnLogMessage(new ProcessEventArgs(logType,
                                    string.Format("已终止端口 {0} 上的进程树 PID: {1}", port, pid), port));
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }
            return killedCount;
        }

        private void RunNpmInstall(string workingDirectory, ServiceType serviceType)
        {
            // DO NOT use "npm.cmd" (the Corepack shim): when invoked from a
            // working directory containing package.json, Corepack looks for
            // a *local* copy of npm at <workingDir>\node_modules\npm\... and
            // fails with MODULE_NOT_FOUND if it isn't there (brand-new
            // project state = exactly the bug the user reported).
            // Use absolute paths: "<node.exe>" "<global-npm-cli.js>" install,
            // which invokes Node directly without any cmd shim in between.
            EnsureNodeAndNpmResolved();
            if (_cachedResolutionError != null)
                throw new Exception(_cachedResolutionError);

            // DO NOT read stdout synchronously while stderr is redirected but
            // never drained: npm writes real install warnings/errors to
            // stderr, and the 4KB OS pipe buffer fills up, which makes npm
            // block forever on WriteFile inside the child process.  We use
            // async event-based output + error handlers so both pipes are
            // drained concurrently and no deadlock can occur.
            var psi = new ProcessStartInfo();
            psi.FileName = _cachedNodeExe;
            psi.Arguments = string.Format("\"{0}\" install --no-audit --no-fund", _cachedNpmCliJs);
            psi.WorkingDirectory = workingDirectory;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            var lastErrorLines = new System.Collections.Generic.List<string>();
            // object doesn't implement IDisposable, so keep it outside the
            // using scope.  It only serves as a Monitor lock anchor.
            var outputLock = new object();
            using (var finished = new ManualResetEventSlim(false))
            using (var process = new Process())
            {
                process.StartInfo = psi;
                process.EnableRaisingEvents = true;

                DataReceivedEventHandler onOutput = (s, e) =>
                {
                    if (string.IsNullOrEmpty(e.Data)) return;
                    OnLogMessage(new ProcessEventArgs(serviceType, "[npm] " + e.Data, 0));
                };
                DataReceivedEventHandler onError = (s, e) =>
                {
                    if (string.IsNullOrEmpty(e.Data)) return;
                    // Capture last stderr lines so we can surface them on
                    // failure (ExitCode != 0) instead of the opaque
                    // "npm install 退出码: 1" message the user saw.
                    lock (outputLock)
                    {
                        lastErrorLines.Add(e.Data);
                        if (lastErrorLines.Count > 20)
                            lastErrorLines.RemoveAt(0);
                    }
                    OnLogMessage(new ProcessEventArgs(serviceType, "[npm err] " + e.Data, 0));
                };
                process.OutputDataReceived += onOutput;
                process.ErrorDataReceived += onError;
                process.Exited += (s, e) =>
                {
                    try { finished.Set(); }
                    catch { }
                };

                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                // Guard against a wedged npm install: give it up to 15 minutes
                // (node_modules downloads can be slow), but never forever.
                bool completed = finished.Wait(TimeSpan.FromMinutes(15));
                if (!completed)
                {
                    try { TryKillProcessTree(process.Id, 5000); } catch { }
                    string hint = lastErrorLines.Count > 0
                        ? string.Join(" | ", lastErrorLines)
                        : "npm install 超时，请手动在项目目录运行 npm install 查看详情。";
                    throw new Exception("npm install 超时: " + hint);
                }

                if (!process.HasExited)
                    process.WaitForExit(5000);

                if (process.ExitCode != 0)
                {
                    string detail = "";
                    lock (outputLock)
                    {
                        if (lastErrorLines.Count > 0)
                            detail = " 错误详情: " + string.Join(" | ", lastErrorLines);
                    }
                    throw new Exception(string.Format(
                        "npm install 失败 (退出码: {0}){1}",
                        process.ExitCode, detail));
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