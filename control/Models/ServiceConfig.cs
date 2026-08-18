namespace ObaraServiceController.Models
{
    public class ServiceConfig
    {
        public int BackendPort { get; set; }
        public int FrontendPort { get; set; }
        public int MonitorInterval { get; set; }

        public ServiceConfig()
        {
            BackendPort = 5000;
            FrontendPort = 5173;
            MonitorInterval = 2000;
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