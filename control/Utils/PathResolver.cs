using System;
using System.IO;

namespace ObaraServiceController.Utils
{
    public static class PathResolver
    {
        private static string _basePath;

        public static string BasePath
        {
            get
            {
                if (_basePath == null)
                {
                    _basePath = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
                }
                return _basePath;
            }
        }

        public static string BackendPath
        {
            get { return Path.Combine(BasePath, "backend"); }
        }

        public static string FrontendPath
        {
            get { return Path.Combine(BasePath, "frontend"); }
        }

        public static string LogsPath
        {
            get { return Path.Combine(BasePath, "logs"); }
        }

        public static string ResolveRelativePath(string relativePath)
        {
            return Path.Combine(BasePath, relativePath);
        }

        public static bool BackendExists
        {
            get { return Directory.Exists(BackendPath); }
        }

        public static bool FrontendExists
        {
            get { return Directory.Exists(FrontendPath); }
        }

        public static void EnsureLogsDirectory()
        {
            if (!Directory.Exists(LogsPath))
            {
                Directory.CreateDirectory(LogsPath);
            }
        }
    }
}