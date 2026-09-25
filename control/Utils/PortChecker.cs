using System;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace ObaraServiceController.Utils
{
    public static class PortChecker
    {
        public static bool IsPortListening(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var connectTask = client.BeginConnect("127.0.0.1", port, null, null);
                    var waitHandle = connectTask.AsyncWaitHandle;
                    if (!waitHandle.WaitOne(1000, false))
                    {
                        client.Close();
                        return false;
                    }

                    try
                    {
                        client.EndConnect(connectTask);
                        return true;
                    }
                    catch
                    {
                        return false;
                    }
                }
            }
            catch
            {
                return false;
            }
        }

        public static int GetProcessIdByPort(int port)
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

                    foreach (var line in output.Split('\n'))
                    {
                        string[] parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 5)
                        {
                            int pid;
                            if (int.TryParse(parts[4], out pid))
                            {
                                return pid;
                            }
                        }
                    }
                }
            }
            catch { }

            return 0;
        }

        public static int MeasureLatency(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var sw = Stopwatch.StartNew();
                    var connectTask = client.BeginConnect("127.0.0.1", port, null, null);
                    var waitHandle = connectTask.AsyncWaitHandle;
                    if (!waitHandle.WaitOne(3000, false))
                    {
                        client.Close();
                        return -1;
                    }

                    try
                    {
                        client.EndConnect(connectTask);
                        sw.Stop();
                        return (int)sw.ElapsedMilliseconds;
                    }
                    catch
                    {
                        return -1;
                    }
                }
            }
            catch
            {
                return -1;
            }
        }

        /// <summary>
        /// 对 HTTP 服务发起 GET 健康探测（如 WeKnora 的 /health）。
        /// 只要服务端返回了任何 HTTP 响应（含 4xx/5xx）都认为进程存活，
        /// 仅在连接失败/超时时返回 false；同时输出往返延迟（毫秒）。
        /// </summary>
        public static bool CheckHttpHealth(string url, int timeoutMs, out int latencyMs)
        {
            latencyMs = -1;
            var sw = Stopwatch.StartNew();
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                request.AllowAutoRedirect = false;
                request.KeepAlive = false;
                request.UserAgent = "ObaraServiceController/1.0";

                try
                {
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        sw.Stop();
                        latencyMs = (int)sw.ElapsedMilliseconds;
                        return true;
                    }
                }
                catch (WebException ex)
                {
                    // 能收到 HTTP 错误响应（401/404/500 等）同样说明 HTTP 服务在线，
                    // 只有连接被拒绝/DNS 失败/超时才视为不可用。
                    using (var response = ex.Response as HttpWebResponse)
                    {
                        if (response != null)
                        {
                            sw.Stop();
                            latencyMs = (int)sw.ElapsedMilliseconds;
                            return true;
                        }
                    }
                    return false;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}