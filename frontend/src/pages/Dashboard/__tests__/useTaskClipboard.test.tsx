import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskClipboard } from '../hooks/useTaskClipboard'
import type { TaskItem, TaskSheet } from '../types'

/**
 * 从 Dashboard 页面里抽出来的复制/剪切/粘贴，行为必须和原来完全一致：
 * 这三个动作都会写库 + 登记撤销历史，出错的表现是「数据被改了但撤销不回去」，
 * 而这种问题在页面上很难复现（依赖多选、锁、离线状态），所以在这里用事件直接驱动。
 */
const { post, del } = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn() }));
vi.mock('../../../services/api', () => ({
  axiosInstance: { post, delete: del },
}));

const task = (id: string, name: string): TaskItem => ({ id, taskName: name, hours: 1 });
const sheet = { id: 's1', designerId: 'd1', month: 11, year: 2026, days: {} } as TaskSheet;

const setup = (overrides: Record<string, unknown> = {}) => {
  const spies = {
    addToast: vi.fn(),
    addToHistory: vi.fn(),
    fetchSheets: vi.fn(),
    upsertSheet: vi.fn(),
    emitTaskUpdated: vi.fn(),
    stopEditingCell: vi.fn(),
    setSelectedTasks: vi.fn(),
    setSelectedCell: vi.fn(),
    warnIfOfflineEdit: vi.fn(() => false),
    warnIfCellLocked: vi.fn(() => false),
  };
  const socketRef = { current: { emit: vi.fn() } };
  const item = task('t1', '确认图');
  const params = {
    hasUser: true,
    warnIfOfflineEdit: spies.warnIfOfflineEdit,
    warnIfCellLocked: spies.warnIfCellLocked,
    getSelectedTaskPayloads: vi.fn(() => [{ item, designerId: 'd1', date: '2026-11-26' }]),
    addToast: spies.addToast,
    addToHistory: spies.addToHistory,
    fetchSheets: spies.fetchSheets,
    upsertSheet: spies.upsertSheet,
    emitTaskUpdated: spies.emitTaskUpdated,
    stopEditingCell: spies.stopEditingCell,
    setSelectedTasks: spies.setSelectedTasks,
    setSelectedCell: spies.setSelectedCell,
    socketRef,
    ...overrides,
  };
  const view = renderHook(() => useTaskClipboard(params as any));
  return { ...spies, ...view, item, params, socketRef };
};

const fire = async (name: string, detail: Record<string, unknown>) => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  });
};

// 每个用例结束把挂载的 hook 卸载掉：监听器挂在 window 上，不清理会串到下一个用例
// （vitest 的 globals 关着，Testing Library 的自动 cleanup 不会生效）
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  post.mockReset();
  del.mockReset();
  post.mockResolvedValue({ data: { sheet, items: [{ id: 'new-1' }] } });
  del.mockResolvedValue({ data: {} });
});

describe('task-copy', () => {
  it('把选中的任务放进剪贴板并提示', async () => {
    const ctx = setup();
    await fire('task-copy', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });

    await waitFor(() => expect(ctx.result.current.clipboardRef.current).toHaveLength(1));
    expect(ctx.result.current.clipboardRef.current?.[0]).toEqual(ctx.item);
    expect(ctx.addToast).toHaveBeenCalledWith('粘贴已准备', 'success');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('task-cut', () => {
  it('先删库、再登记 batchDelete 历史，并刷新数据', async () => {
    const ctx = setup();
    await fire('task-copy', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });
    await fire('task-cut', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });

    await waitFor(() => expect(ctx.addToHistory).toHaveBeenCalledWith('batchDelete', {
      items: [{ designerId: 'd1', date: '2026-11-26', item: ctx.item }],
    }));
    expect(del).toHaveBeenCalledWith('/tasks/item', {
      data: { designerId: 'd1', date: '2026-11-26', itemId: 't1' },
    });
    expect(ctx.socketRef.current.emit).toHaveBeenCalledWith('task_updated');
    expect(ctx.setSelectedTasks).toHaveBeenCalledWith([]);
  });

  it('单元格被他人锁定时整批都不动', async () => {
    const ctx = setup({ warnIfCellLocked: vi.fn(() => true) });
    await fire('task-cut', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });

    expect(del).not.toHaveBeenCalled();
    expect(ctx.addToHistory).not.toHaveBeenCalled();
  });

  it('删除失败时提示剪切失败，不登记历史', async () => {
    const ctx = setup();
    del.mockRejectedValue(new Error('boom'));
    await fire('task-cut', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });

    await waitFor(() => expect(ctx.addToast).toHaveBeenCalledWith('剪切失败', 'error'));
    expect(ctx.addToHistory).not.toHaveBeenCalled();
  });
});

describe('task-paste', () => {
  it('把剪贴板内容批量写入目标单元格，并按新 id 登记 batchAdd 历史', async () => {
    const ctx = setup();
    await fire('task-copy', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });
    await waitFor(() => expect(ctx.result.current.clipboardRef.current).toHaveLength(1));

    await fire('task-paste', { designerId: 'd2', date: '2026-11-27' });

    await waitFor(() => expect(post).toHaveBeenCalledWith('/tasks/item/batch', {
      designerId: 'd2',
      date: '2026-11-27',
      items: [ctx.item],
    }));
    expect(ctx.addToHistory).toHaveBeenCalledWith('batchAdd', [
      { designerId: 'd2', date: '2026-11-27', itemId: 'new-1', item: ctx.item },
    ]);
    expect(ctx.upsertSheet).toHaveBeenCalledWith(sheet);
    expect(ctx.emitTaskUpdated).toHaveBeenCalledWith('d2');
    expect(ctx.stopEditingCell).toHaveBeenCalledWith('d2', '2026-11-27');
  });

  it('剪贴板为空时提示「请先复制任务」，不发请求', async () => {
    const ctx = setup();
    await fire('task-paste', { designerId: 'd2', date: '2026-11-27' });

    expect(ctx.addToast).toHaveBeenCalledWith('请先复制任务', 'error');
    expect(post).not.toHaveBeenCalled();
  });

  it('离线时被拦截，不发请求', async () => {
    const ctx = setup({ warnIfOfflineEdit: vi.fn(() => true) });
    await fire('task-copy', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });
    await fire('task-paste', { designerId: 'd2', date: '2026-11-27' });

    expect(post).not.toHaveBeenCalled();
  });

  it('接口失败时提示粘贴失败', async () => {
    const ctx = setup();
    post.mockRejectedValue(new Error('boom'));
    await fire('task-copy', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });
    await fire('task-paste', { designerId: 'd2', date: '2026-11-27' });

    await waitFor(() => expect(ctx.addToast).toHaveBeenCalledWith('粘贴失败', 'error'));
  });
});

describe('单元格上的 handlePaste', () => {
  it('与事件入口走同一条写库 + 历史路径', async () => {
    const ctx = setup();
    await fire('task-copy', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });
    await waitFor(() => expect(ctx.result.current.clipboardRef.current).toHaveLength(1));

    await act(async () => {
      await ctx.result.current.handlePaste('d3', '2026-11-28');
    });

    expect(post).toHaveBeenCalledWith('/tasks/item/batch', {
      designerId: 'd3',
      date: '2026-11-28',
      items: [ctx.item],
    });
    expect(ctx.addToHistory).toHaveBeenCalledWith('batchAdd', [
      { designerId: 'd3', date: '2026-11-28', itemId: 'new-1', item: ctx.item },
    ]);
  });

  it('卸载后监听被移除：事件不再触发写库', async () => {
    const ctx = setup();
    await fire('task-copy', { item: ctx.item, designerId: 'd1', date: '2026-11-26' });
    ctx.unmount();
    await fire('task-paste', { designerId: 'd2', date: '2026-11-27' });
    expect(post).not.toHaveBeenCalled();
  });
});
