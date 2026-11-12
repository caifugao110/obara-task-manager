import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle,
  ChevronRight,
  Clock,
  Copy,
  Database,
  FileJson,
  FolderOpen,
  Info,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Undo2,
  Wrench,
  X,
  XCircle
} from 'lucide-react';
import { axiosInstance } from '../services/api';

// ==================== 类型 ====================

interface ArchiveFile {
  fileName: string;
  size: number;
  modifiedAt: string;
  cutoffYear: number;
}

interface ArchiveListResponse {
  dir: string;
  dirExists: boolean;
  files: ArchiveFile[];
}

interface ArchiveSheetPreview {
  id: string;
  designerId: string;
  designerName: string | null;
  month: number;
  year: number;
  taskItems: number;
  dates: number;
  status: 'new' | 'exists';
  existingId: string | null;
}

interface ArchiveDetail {
  fileName: string;
  filePath: string;
  size: number;
  modifiedAt: string;
  archivedAt: string | null;
  cutoff: string | null;
  declared: { taskSheets: number; taskItems: number };
  summary: {
    totalSheets: number;
    newSheets: number;
    existingSheets: number;
    invalidSheets: number;
    totalItems: number;
    years: number[];
  };
  sheets: ArchiveSheetPreview[];
}

interface RestoreResult {
  dryRun: boolean;
  overwrite: boolean;
  fileName: string;
  filePath: string;
  planned: {
    totalSheets: number;
    writeSheets: number;
    skippedSheets: number;
    invalidSheets: number;
    writeItems: number;
    overwriteSheets: number;
  };
  backup: { fileName: string; filePath: string; size: number } | null;
  restoredSheets: number;
  restoredItems: number;
  replacedSheets: number;
  removedOldSheets: number;
  failed: Array<{ id: string; designerName: string | null; designerId: string; year: number; month: number; message: string }>;
}

type Toast = { id: number; message: string; type: 'success' | 'error' };

// ==================== 工具函数 ====================

const formatBytes = (bytes: number) => {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'yyyy-MM-dd HH:mm:ss');
};

// 文件名里的时间戳比 mtime 更可靠（文件被复制过 mtime 会变）
const parseArchiveName = (fileName: string) => {
  const matched = fileName.match(/^yearly-archive-before-(\d{4})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/);
  if (!matched) return { cutoffYear: null as number | null, createdAtLabel: null as string | null };
  return {
    cutoffYear: Number(matched[1]),
    createdAtLabel: `${matched[2]}-${matched[3]}-${matched[4]} ${matched[5]}:${matched[6]}:${matched[7]}`
  };
};

const monthLabel = (month: number) => `${String(month).padStart(2, '0')} 月`;

// ==================== 组件 ====================

const OpsToolsPanel: React.FC = () => {
  const [list, setList] = useState<ArchiveListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [overwrite, setOverwrite] = useState(false);
  const [backup, setBackup] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<RestoreResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [copied, setCopied] = useState(false);

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3600);
  }, []);

  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await axiosInstance.get<ArchiveListResponse>('/system/maintenance/archives');
      setList(res.data);
      // 选中的文件如果已经不存在（被手工清理），清空右侧
      setSelected(prev => (prev && res.data.files.some(f => f.fileName === prev) ? prev : null));
    } catch (err: any) {
      setListError(err.response?.data?.message || '读取年度归档目录失败');
    } finally {
      setListLoading(false);
    }
  }, []);

  // preserveOutcome=true 时保留「预演/恢复结果」面板（恢复成功后刷新列表用）
  const inspect = useCallback(async (fileName: string, preserveOutcome = false) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    if (!preserveOutcome) {
      setPreview(null);
      setRestoreResult(null);
    }
    try {
      const res = await axiosInstance.get<ArchiveDetail>('/system/maintenance/archives/inspect', { params: { file: fileName } });
      setDetail(res.data);
    } catch (err: any) {
      setDetailError(err.response?.data?.message || '解析归档文件失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleSelect = (fileName: string) => {
    if (selected === fileName) return;
    setSelected(fileName);
    inspect(fileName);
  };

  const writableCount = useMemo(() => {
    if (!detail) return 0;
    return detail.sheets.filter(sheet => overwrite || sheet.status === 'new').length;
  }, [detail, overwrite]);

  const writableItems = useMemo(() => {
    if (!detail) return 0;
    return detail.sheets
      .filter(sheet => overwrite || sheet.status === 'new')
      .reduce((sum, sheet) => sum + sheet.taskItems, 0);
  }, [detail, overwrite]);

  const runRestore = async (dryRun: boolean) => {
    if (!selected || running) return;
    setRunning(true);
    try {
      const res = await axiosInstance.post<{ message: string; restore: RestoreResult }>(
        '/system/maintenance/archives/restore',
        { file: selected, dryRun, overwrite, backup },
        { timeout: 180000 }
      );
      if (dryRun) {
        setPreview(res.data.restore);
        addToast(res.data.message, 'success');
      } else {
        setRestoreResult(res.data.restore);
        setPreview(null);
        addToast(res.data.message, res.data.restore.failed.length > 0 ? 'error' : 'success');
        await fetchList();
        await inspect(selected, true);
      }
    } catch (err: any) {
      addToast(err.response?.data?.message || '恢复失败，请查看后端日志', 'error');
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  };

  const copyPath = async () => {
    if (!detail?.filePath) return;
    try {
      await navigator.clipboard.writeText(detail.filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      addToast('浏览器不允许访问剪贴板，请手动选中路径复制', 'error');
    }
  };

  const selectedFile = list?.files.find(file => file.fileName === selected) || null;

  return (
    <div className="space-y-6">
      {/* 顶部标题 */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-r from-slate-50 via-white to-cyan-50/60" />
        <div className="relative p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center shadow-md">
              <Wrench size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                运维工具
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  仅超级管理员
                </span>
              </h3>
              <p className="text-sm text-gray-500 mt-1 max-w-2xl leading-relaxed">
                处理「不可恢复」操作留下的现场：把年度清理归档的 JSON 快照重新写回数据库。
                这里只做一件事——把归档里的任务工作表按原样恢复，不改动、不推断、不覆盖你没确认的数据。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex flex-col items-end mr-1">
              <span className="text-[11px] text-gray-400">归档文件</span>
              <span className="text-sm font-bold text-gray-700">
                {listLoading ? '读取中…' : `${list?.files.length ?? 0} 个`}
              </span>
            </div>
            <button
              onClick={fetchList}
              disabled={listLoading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 text-gray-700 font-bold rounded-lg transition shadow-sm"
            >
              <RefreshCw size={16} className={listLoading ? 'animate-spin' : ''} />
              刷新目录
            </button>
          </div>
        </div>
      </div>

      {/* 安全提示 */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[13px] text-amber-900 leading-relaxed">
          <span className="font-bold">恢复不等于回滚。</span>
          它只把归档里存在的任务工作表写回数据库；归档之后新建的任务、修改过的工时、状态跟踪与焊枪台账都不会被还原。
          执行前请先「预演」，确认待写入的月份与条目数符合预期；如果不确定，先勾选「恢复前备份整库」再执行。
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* 左：归档文件列表 */}
        <div className="xl:col-span-5 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-gray-800">
              <span className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 text-[11px] font-bold flex items-center justify-center">1</span>
              选择归档文件
            </div>
            {list?.dirExists && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <FolderOpen size={12} />
                backups/{list.dir.split(/[\\/]/).slice(-1)[0]}
              </span>
            )}
          </div>

          <div className="px-5 py-3 bg-gray-50/70 border-b border-gray-100">
            <div className="text-[11px] text-gray-500">
              <span className="font-bold text-gray-600">归档目录：</span>
              <span className="font-mono break-all">{list?.dir || '读取中…'}</span>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-50">
            {listLoading && (
              <div className="px-5 py-10 flex flex-col items-center gap-2 text-gray-400 text-sm">
                <Loader2 size={22} className="animate-spin text-blue-500" />
                正在扫描归档目录…
              </div>
            )}

            {!listLoading && listError && (
              <div className="px-5 py-8 text-center">
                <XCircle size={26} className="mx-auto text-red-400" />
                <p className="text-sm font-bold text-red-600 mt-2">读取失败</p>
                <p className="text-xs text-gray-500 mt-1">{listError}</p>
              </div>
            )}

            {!listLoading && !listError && (list?.files.length ?? 0) === 0 && (
              <div className="px-5 py-8">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center">
                    <FileJson size={22} className="text-gray-300" />
                  </div>
                  <p className="text-sm font-bold text-gray-600 mt-3">还没有可恢复的归档文件</p>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-xs">
                    {list?.dirExists
                      ? '归档目录存在但里面没有符合命名规则的 .json 文件。'
                      : '归档目录尚未创建——说明这台服务器还没有产生过需要归档的历史数据，或者年度清理每次都判定「无数据可归档」。'}
                  </p>
                </div>
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-[11px] text-blue-900 leading-relaxed">
                  <span className="font-bold">生成条件：</span>
                  只有当数据库里存在「年份早于 当前年份 − 任务保留年数」的任务工作表，并成功执行年度清理（自动或强制）时，
                  才会在这里写入一个 <span className="font-mono">yearly-archive-before-YYYY-*.json</span>。
                  「无数据可归档」时只写一条历史记录，不产生文件。
                </div>
              </div>
            )}

            {!listLoading && !listError && list?.files.map(file => {
              const isActive = file.fileName === selected;
              const parsed = parseArchiveName(file.fileName);
              return (
                <button
                  key={file.fileName}
                  onClick={() => handleSelect(file.fileName)}
                  className={`w-full text-left px-5 py-3.5 transition flex items-center gap-3 ${
                    isActive ? 'bg-blue-50/70' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${
                    isActive ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-400'
                  }`}>
                    <FileJson size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-bold truncate ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>
                      {parsed.cutoffYear ? `${parsed.cutoffYear} 年之前的数据` : file.fileName}
                    </span>
                    <span className="block text-[11px] text-gray-400 truncate font-mono">{file.fileName}</span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                      <Clock size={11} />
                      {parsed.createdAtLabel || formatDateTime(file.modifiedAt)}
                      <span className="text-gray-300">|</span>
                      {formatBytes(file.size)}
                    </span>
                  </span>
                  <ChevronRight size={16} className={isActive ? 'text-blue-600' : 'text-gray-300'} />
                </button>
              );
            })}
          </div>

          <div className="px-5 py-2.5 bg-gray-50/80 border-t border-gray-100 text-[11px] text-gray-400 flex items-center gap-1.5">
            <Info size={12} />
            归档目录不在「清理过期备份」的扫描范围内，文件不会被按保留天数自动删除。
          </div>
        </div>

        {/* 右：预览与恢复 */}
        <div className="xl:col-span-7 space-y-6">
          {!selected && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                <ArchiveRestore size={26} className="text-slate-300" />
              </div>
              <p className="text-sm font-bold text-gray-600 mt-3">先在左侧选择一个归档文件</p>
              <p className="text-xs text-gray-400 mt-1.5 max-w-md leading-relaxed">
                选中后会自动解析文件内容，列出每张工作表的设计员、年月、任务条目数，并标出「库里已有」还是「需要新增」。
                解析过程只读，不会写任何数据。
              </p>
            </div>
          )}

          {selected && detailLoading && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-12 flex flex-col items-center gap-3">
              <Loader2 size={26} className="animate-spin text-blue-500" />
              <p className="text-sm text-gray-500">正在解析归档文件…</p>
            </div>
          )}

          {selected && !detailLoading && detailError && (
            <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 text-center">
              <XCircle size={30} className="mx-auto text-red-400" />
              <p className="text-sm font-bold text-red-600 mt-2">归档文件无法解析</p>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{detailError}</p>
              <p className="text-[11px] text-gray-400 mt-3">
                出于安全考虑，只有命名符合 <span className="font-mono">yearly-archive-before-YYYY-YYYYMMDD-HHmmss.json</span>
                {' '}且结构为年度清理归档的文件才会被接受。
              </p>
            </div>
          )}

          {selected && !detailLoading && detail && (
            <>
              {/* 概览 */}
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-gray-800">
                    <span className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 text-[11px] font-bold flex items-center justify-center">2</span>
                    归档内容预览
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                    detail.summary.invalidSheets > 0
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-green-50 text-green-700 border-green-200'
                  }`}>
                    {detail.summary.invalidSheets > 0 ? `${detail.summary.invalidSheets} 张表结构异常` : '结构校验通过'}
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: '归档时间', value: formatDateTime(detail.archivedAt), icon: <Clock size={14} />, tone: 'text-slate-600' },
                      { label: '临界年月', value: detail.cutoff ? `${detail.cutoff}-01 之前` : '—', icon: <FileJson size={14} />, tone: 'text-blue-600' },
                      { label: '工作表', value: `${detail.summary.totalSheets} 张`, icon: <Database size={14} />, tone: 'text-emerald-600' },
                      { label: '任务条目', value: `${detail.summary.totalItems} 条`, icon: <ArchiveRestore size={14} />, tone: 'text-indigo-600' }
                    ].map(item => (
                      <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                        <div className={`flex items-center gap-1.5 text-[11px] font-bold ${item.tone}`}>
                          {item.icon}
                          {item.label}
                        </div>
                        <div className="text-[13px] font-bold text-gray-800 mt-1 break-all">{item.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="px-2 py-1 rounded-md bg-green-50 text-green-700 border border-green-100 font-bold">
                      可新增 {detail.summary.newSheets} 张
                    </span>
                    <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-100 font-bold">
                      库里已存在 {detail.summary.existingSheets} 张
                    </span>
                    {detail.summary.invalidSheets > 0 && (
                      <span className="px-2 py-1 rounded-md bg-red-50 text-red-700 border border-red-100 font-bold">
                        不可恢复 {detail.summary.invalidSheets} 张
                      </span>
                    )}
                    {detail.summary.years.length > 0 && (
                      <span className="px-2 py-1 rounded-md bg-gray-50 text-gray-600 border border-gray-200">
                        覆盖年份 {detail.summary.years.join('、')}
                      </span>
                    )}
                    <button
                      onClick={copyPath}
                      className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition font-bold"
                      title={detail.filePath}
                    >
                      <Copy size={11} />
                      {copied ? '已复制' : '复制完整路径'}
                    </button>
                  </div>

                  {/* 明细表 */}
                  <div className="rounded-xl border border-gray-100 overflow-hidden">
                    <div className="max-h-[280px] overflow-y-auto">
                      <table className="w-full text-[12px]">
                        <thead className="sticky top-0 bg-gray-50 text-gray-500">
                          <tr>
                            <th className="text-left font-bold px-3 py-2">设计员</th>
                            <th className="text-left font-bold px-3 py-2 whitespace-nowrap">年月</th>
                            <th className="text-right font-bold px-3 py-2 whitespace-nowrap">条目</th>
                            <th className="text-right font-bold px-3 py-2 whitespace-nowrap">天数</th>
                            <th className="text-right font-bold px-3 py-2 whitespace-nowrap">状态</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {detail.sheets.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                                文件里没有可恢复的工作表（tasks 为空或字段全部不合法）
                              </td>
                            </tr>
                          )}
                          {detail.sheets.map(sheet => {
                            const willWrite = overwrite || sheet.status === 'new';
                            return (
                              <tr key={`${sheet.id}-${sheet.year}-${sheet.month}`} className={willWrite ? '' : 'bg-gray-50/50'}>
                                <td className="px-3 py-2">
                                  <span className="font-bold text-gray-700">{sheet.designerName || `未匹配（${sheet.designerId}）`}</span>
                                  {!sheet.designerName && (
                                    <span className="block text-[10px] text-gray-400">设计员可能已被删除，恢复后仅按 ID 落库</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{sheet.year}-{monthLabel(sheet.month)}</td>
                                <td className="px-3 py-2 text-right font-mono text-gray-700">{sheet.taskItems}</td>
                                <td className="px-3 py-2 text-right font-mono text-gray-500">{sheet.dates}</td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  {sheet.status === 'new' ? (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-100">新增</span>
                                  ) : willWrite ? (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">覆盖</span>
                                  ) : (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">跳过</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              {/* 执行 */}
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 font-bold text-gray-800">
                  <span className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 text-[11px] font-bold flex items-center justify-center">3</span>
                  执行恢复
                </div>

                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className={`rounded-xl border px-3.5 py-3 cursor-pointer transition ${
                      backup ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-white'
                    }`}>
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={backup}
                          onChange={(e) => setBackup(e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-emerald-600"
                        />
                        <div>
                          <div className="text-[13px] font-bold text-gray-800 flex items-center gap-1.5">
                            <ShieldCheck size={14} className="text-emerald-600" />
                            恢复前备份整库
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                            写入前调用 SQLite 在线备份 API 生成一份 .db 快照，恢复本身也可逆。建议始终勾选。
                          </p>
                        </div>
                      </div>
                    </label>

                    <label className={`rounded-xl border px-3.5 py-3 cursor-pointer transition ${
                      overwrite ? 'border-red-300 bg-red-50/50' : 'border-gray-200 bg-white'
                    }`}>
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={overwrite}
                          onChange={(e) => setOverwrite(e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-red-600"
                        />
                        <div>
                          <div className="text-[13px] font-bold text-gray-800 flex items-center gap-1.5">
                            <AlertTriangle size={14} className="text-red-500" />
                            覆盖库里已存在的月份
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                            默认跳过已存在的月表，防止把当前数据冲掉。勾选后会用归档内容整体替换该月任务（先删旧条目再写入）。
                          </p>
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-600">
                    <span className="font-bold text-gray-700">本次将处理</span>
                    <span>工作表 <b className="text-gray-900">{writableCount}</b> 张</span>
                    <span>任务条目 <b className="text-gray-900">{writableItems}</b> 条</span>
                    <span>跳过 <b className="text-gray-900">{detail.sheets.filter(s => !(overwrite || s.status === 'new')).length}</b> 张</span>
                    {overwrite && detail.summary.existingSheets > 0 && (
                      <span className="text-red-600 font-bold">其中覆盖 {detail.summary.existingSheets} 张已存在的工作表</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => runRestore(true)}
                      disabled={running || writableCount === 0}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-bold hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {running ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                      预演（不写库）
                    </button>
                    <button
                      onClick={() => setConfirming(true)}
                      disabled={running || writableCount === 0}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
                    >
                      <ArchiveRestore size={16} />
                      执行恢复
                    </button>
                    {writableCount === 0 && (
                      <span className="text-[11px] text-gray-400">
                        该归档中的工作表在库里都已存在；如需还原到归档状态，请勾选「覆盖」。
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 预演结果 */}
              {preview && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
                  <div className="flex items-center gap-2 font-bold text-blue-800 text-sm">
                    <PlayCircle size={16} />
                    预演结果（未写入任何数据）
                  </div>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    {[
                      { label: '可写入工作表', value: preview.planned.writeSheets, tone: 'text-blue-700' },
                      { label: '可写入条目', value: preview.planned.writeItems, tone: 'text-blue-700' },
                      { label: '跳过已存在', value: preview.planned.skippedSheets, tone: 'text-gray-600' },
                      { label: '结构异常', value: preview.planned.invalidSheets, tone: 'text-amber-700' }
                    ].map(item => (
                      <div key={item.label} className="rounded-lg bg-white/80 border border-blue-100 py-2">
                        <div className={`text-lg font-bold ${item.tone}`}>{item.value}</div>
                        <div className="text-[11px] text-gray-500">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-blue-800/70 mt-3 leading-relaxed">
                    预演只做结构校验与库内冲突比对，不会生成备份、不会写库。确认无误后再点「执行恢复」。
                  </p>
                </div>
              )}

              {/* 恢复结果 */}
              {restoreResult && !restoreResult.dryRun && (
                <div className={`rounded-2xl border p-5 ${
                  restoreResult.failed.length > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-green-200 bg-green-50/60'
                }`}>
                  <div className={`flex items-center gap-2 font-bold text-sm ${
                    restoreResult.failed.length > 0 ? 'text-amber-800' : 'text-green-800'
                  }`}>
                    {restoreResult.failed.length > 0 ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
                    恢复完成：写入 {restoreResult.restoredSheets} 个工作表、{restoreResult.restoredItems} 条任务记录
                  </div>

                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    {[
                      { label: '写入工作表', value: restoreResult.restoredSheets },
                      { label: '写入条目', value: restoreResult.restoredItems },
                      { label: '覆盖替换', value: restoreResult.replacedSheets },
                      { label: '失败', value: restoreResult.failed.length }
                    ].map(item => (
                      <div key={item.label} className="rounded-lg bg-white/80 border border-white py-2">
                        <div className="text-lg font-bold text-gray-800">{item.value}</div>
                        <div className="text-[11px] text-gray-500">{item.label}</div>
                      </div>
                    ))}
                  </div>

                  {restoreResult.backup && (
                    <div className="mt-3 flex items-start gap-2 text-[11px] text-gray-600">
                      <ShieldCheck size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                      <span>
                        恢复前已生成备份：
                        <span className="font-mono">{restoreResult.backup.fileName}</span>
                        {' '}（{formatBytes(restoreResult.backup.size)}），如有问题可从「数据库维护」的备份目录取回。
                      </span>
                    </div>
                  )}

                  {restoreResult.failed.length > 0 && (
                    <div className="mt-3 rounded-lg bg-white/80 border border-amber-100 p-3">
                      <div className="text-[11px] font-bold text-amber-800 mb-1.5">以下工作表写入失败，其余已成功</div>
                      <ul className="space-y-1">
                        {restoreResult.failed.map(item => (
                          <li key={item.id} className="text-[11px] text-gray-600">
                            <span className="font-bold text-gray-700">{item.designerName || item.designerId}</span>
                            {' '}{item.year}-{monthLabel(item.month)}：{item.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
                    恢复后其他在线用户的任务视图会自动刷新。若某个月份显示的数据不完整，请先核对归档文件是否就是那一次清理产生的快照。
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 功能说明 */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 font-bold text-gray-800">
          <Info size={18} className="text-blue-600" />
          年度归档说明
        </div>
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div>
              <h4 className="text-[13px] font-bold text-gray-800 flex items-center gap-1.5">
                <FileJson size={14} className="text-blue-600" />
                文件在哪里、什么时候生成
              </h4>
              <ul className="mt-2 space-y-1.5 text-[12px] text-gray-600 leading-relaxed">
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span>目录由「数据库维护 → 年度归档目录」决定，默认 <span className="font-mono text-[11px]">backend/backups/yearly-archives/</span>，限制在后端目录内。</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span>文件名固定为 <span className="font-mono text-[11px]">yearly-archive-before-&lt;临界年份&gt;-&lt;YYYYMMDD-HHmmss&gt;.json</span>。</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span>只有真正删除了工作表才会落文件：先写 JSON 成功，再按 id 删除数据库记录；写文件失败则整次清理中止。</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span>没有可归档数据时只更新 <span className="font-mono text-[11px]">yearlyCleanupHistory</span>，不产生文件——也就是本页空列表的常见原因。</span>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-[13px] font-bold text-gray-800 flex items-center gap-1.5">
                <Database size={14} className="text-emerald-600" />
                文件里包含什么
              </h4>
              <ul className="mt-2 space-y-1.5 text-[12px] text-gray-600 leading-relaxed">
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span>元信息：<span className="font-mono text-[11px]">archivedAt / type / neverCleanup / cutoff / taskSheets / taskItems</span>。</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span><span className="font-mono text-[11px]">tasks[]</span>：每项是一张任务工作表（设计员 ID、年、月、按日期分组的条目）。</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span>条目字段与库内一致：任务名、工时、颜色标记、枪分配明细、请假类型、紧急/暂停、字体样式、创建人。</span>
                </li>
                <li className="flex gap-1.5">
                  <span className="text-gray-300">•</span>
                  <span className="text-amber-700">不含状态跟踪、焊枪编号台账、用户与设置；这些数据需要靠数据库备份（.db）恢复。</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="text-[13px] font-bold text-gray-800 flex items-center gap-1.5">
                <Undo2 size={14} className="text-indigo-600" />
                恢复是怎么执行的
              </h4>
              <ol className="mt-2 space-y-1.5 text-[12px] text-gray-600 leading-relaxed">
                {[
                  '校验文件名与路径：只接受归档目录内、命名符合规则、type 为 yearly-cleanup-archive 的文件。',
                  '逐张校验工作表：设计员 ID 必填，月份 1–12，年份 2000–2100，日期必须是 YYYY-MM-DD，条目必须是对象。',
                  '与库内比对：同一设计员 + 年 + 月已存在则标记「已存在」，默认跳过；勾选覆盖才替换。',
                  '写入前备份整库（可选，默认开启），再按表调用 saveSheet，单表失败不影响其他表。',
                  '写入完成后广播刷新事件，其他在线用户的任务视图同步更新；本次操作记入「操作日志」。'
                ].map((text, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold flex items-center justify-center mt-0.5">{index + 1}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3.5 py-3">
              <h4 className="text-[13px] font-bold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={14} />
                注意事项
              </h4>
              <ul className="mt-1.5 space-y-1 text-[12px] text-amber-900/90 leading-relaxed">
                <li>恢复只增加 / 替换归档里存在的月份，不会删除归档之后新建的数据。</li>
                <li>设计员被删除时仍会按 ID 写入，页面上可能显示为未匹配姓名。</li>
                <li>先预演、再执行；数据量大时恢复可能持续数秒到数十秒，期间请勿重复点击。</li>
                <li>不确定归档是否最新时，优先用「数据库维护 → 立即备份数据库」里的整库快照回滚。</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* 二次确认 */}
      {confirming && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !running && setConfirming(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[480px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <ArchiveRestore size={20} />
                确认从归档恢复
              </div>
              <button
                className="p-1 rounded hover:bg-white/20 transition disabled:opacity-50"
                onClick={() => setConfirming(false)}
                disabled={running}
                title="关闭"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-red-50 border-red-200">
                <AlertTriangle size={22} className="text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className="font-bold mb-1 text-red-700">此操作会写入正式数据库</div>
                  <div>
                    将把 <span className="font-bold">{selectedFile ? (parseArchiveName(selectedFile.fileName).cutoffYear ? `${parseArchiveName(selectedFile.fileName).cutoffYear} 年之前` : selectedFile.fileName) : detail.fileName}</span>
                    {' '}的 {writableCount} 个工作表、{writableItems} 条任务记录写回数据库
                    {overwrite ? '，并整体替换库内已存在的同月任务表' : '；库内已存在的月份会被跳过'}。
                    {backup ? '写入前会自动备份整库。' : '当前未勾选备份整库，写入结果将无法通过本次操作撤销。'}
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-500 font-mono break-all">
                {detail.fileName}
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={() => setConfirming(false)}
                disabled={running}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg text-white font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 bg-red-600 hover:bg-red-700"
                onClick={() => runRestore(false)}
                disabled={running}
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
                {running ? '恢复中…' : '确认恢复'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 轻提示 */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-bold text-white ${
              toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OpsToolsPanel;
