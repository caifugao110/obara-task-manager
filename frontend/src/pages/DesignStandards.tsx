import React, { useState, useMemo, useCallback, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  BookOpen,
  ExternalLink,
  Database,
  Search,
  FileText,
  Layers,
  Sparkles,
  AlertCircle,
  Github,
  Globe,
  Construction,
  Shield,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const defaultSettings = { enabled: true, allowAdmins: true, allowViewers: false };

/**
 * 设计规范与标准页面
 *
 * 该页面为预留界面，用于后续接入 WeKnora 本地知识库。
 * - GitHub 仓库: https://github.com/Tencent/WeKnora
 * - 官方网站:    https://weknora.weixin.qq.com/
 *
 * 当前阶段：界面预留，等待本地知识库搭建完成后接入实际功能。
 * 查看权限与 /work-hours 页面一致，超级管理员可在底部进行权限设置。
 */
const DesignStandards: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [settings, setSettings] = useState(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const isSuperAdmin = user?.role === 'superadmin';
  const authHeader = useMemo(() => (token ? { headers: { Authorization: `Bearer ${token}` } } : {}), [token]);

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const canViewDesignStandards = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!settings.enabled) return false;
    if (!user) return false;
    if (user.role === 'admin' && settings.allowAdmins) return true;
    if (user.role === 'user' && settings.allowViewers) return true;
    return false;
  }, [isSuperAdmin, settings, user]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/settings/design-standards');
      setSettings(res.data);
    } catch (err) {
      console.error('Error fetching design-standards settings:', err);
      addToast('无法加载设计规范与标准权限设置', 'error');
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (next: Partial<typeof settings>) => {
    const updated = { ...settings, ...next };
    if (next.enabled === false) {
      updated.allowAdmins = false;
      updated.allowViewers = false;
    }
    if (next.enabled === true) {
      updated.allowAdmins = true;
      updated.allowViewers = true;
    }
    if (next.allowAdmins === false && updated.allowViewers) {
      addToast('普通用户权限开启时，不能关闭一般管理员权限', 'error');
      return;
    }
    if (updated.allowViewers) updated.allowAdmins = true;
    setSettings(updated);
    if (!isSuperAdmin) return;

    try {
      await axios.put('/api/settings/design-standards', updated, authHeader);
      addToast('权限设置已保存', 'success');
    } catch (err) {
      console.error('Error saving design-standards settings:', err);
      addToast('保存设计规范与标准权限设置失败', 'error');
    }
  };

  const plannedFeatures = [
    {
      icon: Search,
      title: '规范检索',
      desc: '基于自然语言检索设计规范、技术标准与历史文档，快速定位关键条款。',
    },
    {
      icon: FileText,
      title: '标准文档库',
      desc: '集中管理国标、行标、企标及内部设计准则，统一版本与引用来源。',
    },
    {
      icon: Layers,
      title: '知识图谱',
      desc: '构建规范间的关联关系，自动推荐相关条款与相似案例。',
    },
    {
      icon: Sparkles,
      title: '智能问答',
      desc: '基于本地知识库的 RAG 问答，回答设计合规性问题并给出引用出处。',
    },
    {
      icon: Database,
      title: '本地化部署',
      desc: 'WeKnora 本地化运行，数据不出内网，满足保密性要求。',
    },
    {
      icon: BookOpen,
      title: '设计依据追溯',
      desc: '关联任务条目与规范条目，实现设计依据的可追溯管理。',
    },
  ];

  // 加载中
  if (!settingsLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
        <div className="text-gray-600 font-medium">正在加载设计规范与标准...</div>
      </div>
    );
  }

  // 无权限访问
  if (!canViewDesignStandards) {
    const isClosed = !settings.enabled;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="bg-white shadow-sm px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          {user && (
            <button onClick={logout} className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition">
              <LogOut size={18} />
              <span>退出</span>
            </button>
          )}
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <BookOpen size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">{isClosed ? '设计规范与标准已关闭' : '暂无权限访问设计规范与标准'}</h2>
            <p className="text-gray-400 mt-2">
              {isClosed ? '请联系超级管理员开启此功能' : '请联系超级管理员开启对应权限'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex flex-col">
      {/* 顶部 Toast */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${
              toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'
            }`}
          >
            {toast.type === 'error' ? <AlertCircle size={18} /> : <Shield size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 bg-white shadow-md px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <BookOpen className="text-blue-500 mr-2" size={24} />
            设计规范与标准
            <span className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-300">
              <Construction size={12} />
              待开发
            </span>
          </h2>
        </div>

        {user && (
          <div className="flex items-center space-x-4">
            <span className="text-sm font-bold text-red-600">{user.name}</span>
            <button
              onClick={logout}
              className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition"
            >
              <LogOut size={18} />
              <span>退出</span>
            </button>
          </div>
        )}
      </header>

      {/* 主体内容 */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10 pb-24">
        {/* 顶部说明卡 */}
        <section className="bg-white rounded-2xl shadow-sm border border-blue-100 p-8 mb-8">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
              <BookOpen className="text-white" size={28} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-800 mb-2">设计规范与标准知识库</h1>
              <p className="text-gray-600 leading-relaxed">
                本模块用于管理项目所引用的设计规范、技术标准与历史设计依据，后续将接入本地部署的
                <span className="mx-1 font-semibold text-blue-600">WeKnora</span>
                知识库，提供规范检索、智能问答与设计依据追溯能力。当前页面为预留界面，待本地知识库搭建完成后接入实际功能。
              </p>

              {/* 链接区 */}
              <div className="mt-5 flex flex-wrap gap-3">
                <a
                  href="https://github.com/Tencent/WeKnora"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium transition"
                >
                  <Github size={16} />
                  GitHub 仓库
                  <ExternalLink size={12} className="opacity-70" />
                </a>
                <a
                  href="https://weknora.weixin.qq.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition"
                >
                  <Globe size={16} />
                  官方网站
                  <ExternalLink size={12} className="opacity-70" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 待接入提示 */}
        <section className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 flex items-start gap-4">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center">
            <Construction className="text-amber-700" size={20} />
          </div>
          <div>
            <h3 className="font-bold text-amber-800 mb-1">模块正在筹备中</h3>
            <p className="text-sm text-amber-700 leading-relaxed">
              该界面为预留入口，等待本地 WeKnora 知识库部署完成后接入。届时将开放文档上传、规范检索与智能问答等功能。
            </p>
          </div>
        </section>

        {/* 规划能力概览 */}
        <section className="mb-4">
          <h3 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
            <Sparkles size={18} className="text-blue-500" />
            规划能力
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plannedFeatures.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <div
                  key={idx}
                  className="group relative bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition">
                      <Icon className="text-blue-600" size={18} />
                    </div>
                    <h4 className="font-semibold text-gray-800">{feature.title}</h4>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
                  <span className="absolute top-3 right-3 text-[10px] font-medium text-gray-300">待接入</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 接入路线图 */}
        <section className="mt-10 bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-700 mb-5 flex items-center gap-2">
            <Construction size={18} className="text-amber-500" />
            接入路线图
          </h3>
          <ol className="relative border-l-2 border-dashed border-blue-200 ml-3 space-y-6">
            {[
              { stage: '阶段一', title: '本地部署 WeKnora', desc: '克隆仓库、配置环境、启动本地知识库服务，验证可访问性。' },
              { stage: '阶段二', title: '文档导入与索引', desc: '整理设计规范、技术标准与历史文档，分批导入并完成向量索引。' },
              { stage: '阶段三', title: '功能接入本系统', desc: '在本页面接入检索、问答与依据追溯能力，打通任务与规范条目关联。' },
              { stage: '阶段四', title: '持续维护与扩展', desc: '建立规范更新流程、权限管理与使用反馈机制，逐步扩展场景。' },
            ].map((step, idx) => (
              <li key={idx} className="ml-6">
                <span className="absolute -left-[11px] flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold ring-4 ring-white">
                  {idx + 1}
                </span>
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold text-gray-800">{step.title}</h4>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{step.stage}</span>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 底部提示 */}
        <div className="mt-8 flex items-start gap-2 text-xs text-gray-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <p>
            本模块所有功能正在规划中，最终形态以本地知识库搭建完成后接入的实际能力为准。如有需求或建议，可向系统管理员反馈。
          </p>
        </div>

        {/* 超级管理员权限设置区域 */}
        {isSuperAdmin && (
          <section className="mt-10 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              设计规范与标准查看权限设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: '启用设计规范与标准', detail: 'Global Toggle', key: 'enabled' as const },
                { label: '一般管理员', detail: 'Admin Access', key: 'allowAdmins' as const },
                { label: '普通用户', detail: 'User Access', key: 'allowViewers' as const },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div>
                    <div className="font-bold text-gray-700">{item.label}</div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">{item.detail}</div>
                  </div>
                  <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                    <input
                      type="checkbox"
                      checked={settings[item.key]}
                      onChange={e => updateSettings({ [item.key]: e.target.checked })}
                      disabled={!settingsLoaded}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                    />
                    <label
                      className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${
                        settings[item.key] ? 'bg-blue-500' : 'bg-gray-300'
                      }`}
                    ></label>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-sm text-gray-500">
          <div>知识库预留模块 · 等待接入</div>
          <div className="flex items-center gap-2">
            <span className="font-medium">当前状态:</span>
            <span className="text-amber-600 flex items-center">
              <span className="w-2 h-2 bg-amber-500 rounded-full mr-1"></span>
              待开发
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default DesignStandards;
