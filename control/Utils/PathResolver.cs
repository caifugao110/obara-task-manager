using System;
using System.IO;

namespace ObaraServiceController.Utils
{
    public static class PathResolver
    {
        private static string _basePath;
        private static string _rootPath;

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

        /// <summary>
        /// Directory that contains the backend/ and frontend/ service folders.
        /// The console may be deployed next to the services (exe in the same
        /// folder as backend/ and frontend/) or run from a build output folder
        /// (e.g. control\bin\Release), so we search from the exe directory
        /// upward until a folder containing both backend/ and frontend/ is found.
        /// </summary>
        public static string RootPath
        {
            get
            {
                if (_rootPath == null)
                {
                    _rootPath = FindRootPath();
                }
                return _rootPath;
            }
        }

        private static string FindRootPath()
        {
            string dir = BasePath;
            while (!string.IsNullOrEmpty(dir))
            {
                if (Directory.Exists(Path.Combine(dir, "backend")) &&
                    Directory.Exists(Path.Combine(dir, "frontend")))
                {
                    return dir;
                }
                string parent = Path.GetDirectoryName(dir);
                if (parent == dir) break;
                dir = parent;
            }
            // Fall back to the exe directory if nothing was found.
            return BasePath;
        }

        public static string BackendPath
        {
            get { return Path.Combine(RootPath, "backend"); }
        }

        public static string FrontendPath
        {
            get { return Path.Combine(RootPath, "frontend"); }
        }

        public static string LogsPath
        {
            get { return Path.Combine(RootPath, "logs"); }
        }

        public static string ResolveRelativePath(string relativePath)
        {
            return Path.Combine(RootPath, relativePath);
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
