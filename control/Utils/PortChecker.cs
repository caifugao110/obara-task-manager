using System;
using System.Diagnostics;
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
    }
}