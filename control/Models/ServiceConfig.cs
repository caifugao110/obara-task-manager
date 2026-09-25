namespace ObaraServiceController.Models
{
    public class ServiceConfig
    {
        public int BackendPort { get; set; }
        public int FrontendPort { get; set; }
        public int MonitorInterval { get; set; }

        // WeKnora 知识库服务（Docker Compose 部署，控制台只做状态检测，
        // 不负责进程启停）：AppApiPort 为 WeKnora app 容器发布到宿主机的
        // API/健康检查端口（/health），ConsolePort 为 WeKnora 管理控制台端口。
        public int KbApiPort { get; set; }
        public int KbConsolePort { get; set; }

        public ServiceConfig()
        {
            BackendPort = 5000;
            FrontendPort = 5173;
            MonitorInterval = 2000;
            KbApiPort = 8080;
            KbConsolePort = 80;
        }

        public string FrontendUrl
        {
            get { return string.Format("http://localhost:{0}", FrontendPort); }
        }

        public string BackendUrl
        {
            get { return string.Format("http://localhost:{0}", BackendPort); }
        }
    }

    public enum ServiceStatus
    {
        Stopped,
        Starting,
        Running,
        Stopping,
        Error
    }
}