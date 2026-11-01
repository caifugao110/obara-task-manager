import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

// 复制枪名按钮：放在拖动手柄左侧，所有已登录用户都可用（不做管理员权限限制）
const GunNameCopyButton = ({ gunName }: { gunName?: string | null }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    // 阻止冒泡到枪名行/主任务行的拖拽、选中、双击编辑等逻辑
    e.stopPropagation();
    const text = String(gunName ?? '').trim();
    if (!text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // 非 HTTPS / 浏览器不支持异步剪贴板时降级为临时 textarea 选中复制
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, [gunName]);

  // 未命名枪名没有可复制内容
  if (!String(gunName ?? '').trim()) return null;

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleCopy}
      onDoubleClick={(e) => e.stopPropagation()}
      draggable={false}
      className={`shrink-0 h-[18px] w-[18px] flex items-center justify-center rounded border shadow-sm transition-colors ${
        copied
          ? 'bg-emerald-600 text-white border-emerald-700'
          : 'bg-emerald-100 text-emerald-600 border-emerald-300 opacity-0 group-hover/gun-row:opacity-100 hover:bg-emerald-600 hover:text-white hover:border-emerald-700'
      }`}
      title={copied ? '已复制枪名' : '复制枪名'}
      tabIndex={-1}
    >
      {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={3} />}
    </button>
  );
};

export default GunNameCopyButton;
