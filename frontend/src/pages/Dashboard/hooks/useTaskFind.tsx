import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { axiosInstance } from '../../../services/api';
import type { BatchReplaceMatch } from '../types';

/**
 * 左下角「查找」弹窗：状态 + 请求 + 关键字高亮
 *
 * 抽出来的理由与剪贴板/选中态一致——这块状态原先散在 6600 行页面的四个位置
 * （顶部 state、月份切换时清空结果、页脚入口、弹窗 JSX），改一次要通读上下文。
 * 现在状态与请求都在这里，页面只负责「点结果时定位到表格」（那部分要碰月份切换、
 * 分组折叠、人员筛选，耦合度高，留在页面里更安全）。
 *
 * 注意两处刻意的设计：
 *   1. 请求带自增 reqId：弹窗关闭或再次查找后，迟到的响应必须丢弃，否则旧结果会写回空白窗口；
 *   2. 关键字前后空格不参与匹配：用户从别处粘过来常带空格，留着会把结果搜成 0 条。
 */

interface UseTaskFindParams {
  addToast: (message: string, type: 'success' | 'error') => void;
  /** 查找范围默认当前月份；由页面传入以免这里依赖 Date 状态 */
  currentMonth: number;
  currentYear: number;
}

export const useTaskFind = ({ addToast, currentMonth, currentYear }: UseTaskFindParams) => {
  /** 弹窗开关（页脚入口 / 快捷键共用） */
  const [open, setOpen] = useState(false);
  const [findText, setFindText] = useState('');
  /** true = 跨全部月份查找，false = 只查当前月份 */
  const [allTable, setAllTable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<BatchReplaceMatch[]>([]);
  const [matchCount, setMatchCount] = useState(0);
  const [searchDone, setSearchDone] = useState(false);
  /** 请求序号：用于丢弃迟到响应，也供页面在切月份时作废在途请求 */
  const reqRef = useRef(0);

  const resetResults = useCallback(() => {
    setMatches([]);
    setMatchCount(0);
    setSearchDone(false);
  }, []);

  /** 关闭弹窗时整体复位：作废在途请求，清空关键字/结果/加载态 */
  const resetAll = useCallback(() => {
    reqRef.current += 1;
    setFindText('');
    setMatches([]);
    setMatchCount(0);
    setSearchDone(false);
    setLoading(false);
  }, []);

  /**
   * 发起查找。offline 由页面传入而不是从参数读：页面的 isOfflineMode 声明位置在这块状态之后，
   * 在 hook 调用处引用会命中「块级变量提前使用」；改成调用时传值最直接。
   */
  const search = useCallback(async (offline: boolean) => {
    if (offline) {
      addToast('当前离线，无法查找任务', 'error');
      return;
    }
    if (!findText.trim()) {
      addToast('请输入查找关键字', 'error');
      return;
    }

    setLoading(true);
    const reqId = ++reqRef.current;
    try {
      const res = await axiosInstance.post('/tasks/batch-replace/search', {
        // 前后空格不参与匹配
        findText: findText.trim(),
        allTable,
        month: currentMonth,
        year: currentYear,
      });
      // 弹窗已关闭（或又发起了新的一次查找）时丢弃这次响应，避免旧结果被写回空白窗口
      if (reqId !== reqRef.current) return;
      setMatches(Array.isArray(res.data.matches) ? res.data.matches : []);
      setMatchCount(res.data.matchCount || 0);
      setSearchDone(true);
    } catch (err) {
      const response = (err as { response?: { data?: { message?: string }; status?: number } });
      const message = response.response?.data?.message
        || (response.response?.status === 404
          ? '查找失败：接口不存在，请重启后端服务后重试'
          : `查找失败：${(err as Error).message || ''}`);
      if (reqId !== reqRef.current) return;
      addToast(message, 'error');
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, [addToast, findText, allTable, currentMonth, currentYear]);

  /**
   * 关键字高亮：与后端同口径——英文不区分大小写，中文按字面；
   * 高亮片段用原文切片（保留任务名里原有的大小写），不把关键字直接写进 mark 内容。
   */
  const highlight = (text: string): ReactNode => {
    const source = String(text);
    const keyword = findText.trim();
    if (!keyword) return source;
    const haystack = source.toLowerCase();
    const needle = keyword.toLowerCase();
    const nodes: ReactNode[] = [];
    let from = 0;
    let key = 0;
    for (;;) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) break;
      if (index > from) {
        nodes.push(<span key={`t${key++}`}>{source.slice(from, index)}</span>);
      }
      nodes.push(
        <mark key={`m${key++}`} className="bg-amber-200/80 text-amber-900 rounded px-0.5">
          {source.slice(index, index + keyword.length)}
        </mark>
      );
      from = index + keyword.length;
    }
    if (nodes.length === 0) return source;
    if (from < source.length) {
      nodes.push(<span key={`t${key++}`}>{source.slice(from)}</span>);
    }
    return <>{nodes}</>;
  };

  return {
    open, setOpen,
    findText, setFindText,
    allTable, setAllTable,
    loading,
    matches,
    matchCount,
    searchDone,
    reqRef,
    resetResults,
    resetAll,
    search,
    highlight,
  };
};
