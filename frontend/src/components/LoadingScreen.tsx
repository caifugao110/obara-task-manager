import { useEffect, useId, useState } from 'react';
import { SKELETONS, type SkeletonKind } from './LoadingSkeleton';

interface LoadingScreenProps {
  /** 加载提示文案 */
  text?: string;
  /** 副标题，可选 */
  hint?: string;
  /** 是否铺满全屏（固定定位覆盖层），默认 true */
  fullscreen?: boolean;
  /**
   * 底层骨架屏形态：传 true 等同 'dashboard'（兼容旧用法）；
   * 不传则只显示中心的加载卡片
   */
  skeleton?: boolean | SkeletonKind;
}

/**
 * 全站统一的加载态：浅色底 + 中心白色卡片动画；
 * 传 skeleton 时底部铺一层与目标页面版式一致的骨架屏。
 */
export default function LoadingScreen({
  text = '正在加载数据',
  hint,
  fullscreen = true,
  skeleton = false,
}: LoadingScreenProps) {
  const gradId = `ls-grad-${useId().replace(/:/g, '')}`;
  // 数据加载很快时不闪一下：延迟 120ms 才让内容出现
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const Skeleton = skeleton
    ? SKELETONS[skeleton === true ? 'dashboard' : skeleton]
    : null;

  return (
    <div
      className={fullscreen ? 'loading-screen loading-screen--fixed' : 'loading-screen'}
      role="status"
      aria-label={text}
    >
      {ready && Skeleton && (
        <div className="loading-skeleton-layer loading-fade">
          <Skeleton />
        </div>
      )}

      {ready && (
        <div className="loading-center">
          <div className="loading-card">
            <div className="loading-visual" aria-hidden="true">
              {/* 向外扩散的脉冲环 */}
              <span className="loading-ripple" />

              <svg className="loading-spinner" viewBox="0 0 64 64">
                <defs>
                  <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#60a5fa" />
                    <stop offset="48%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#1e40af" />
                  </linearGradient>
                </defs>
                {/* 外圈轨道 */}
                <circle className="loading-spinner__track" cx="32" cy="32" r="26" />
                {/* 外圈：顺时针 */}
                <circle
                  className="loading-spinner__outer"
                  cx="32"
                  cy="32"
                  r="26"
                  stroke={`url(#${gradId})`}
                />
                {/* 内圈：逆时针，速度更快 */}
                <circle
                  className="loading-spinner__inner"
                  cx="32"
                  cy="32"
                  r="17"
                  stroke="#3b82f6"
                />
              </svg>

              <span className="loading-dot" />
            </div>

            <div className="loading-text">{text}</div>
            {hint && <div className="loading-hint">{hint}</div>}

            {/* 进度条：不确定进度，光带循环推进 */}
            <div className="loading-progress" aria-hidden="true">
              <span className="loading-progress__bar" />
              <span className="loading-progress__glow" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
