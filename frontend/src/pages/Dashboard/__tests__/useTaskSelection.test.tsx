import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskDeletion, useTaskSelection } from '../hooks/useTaskSelection'
import type { SelectedTask, TaskItem } from '../types'

/**
 * 选中态与批量删除的行为锁定：
 *   - 选中是「点击替换 / Ctrl 点击切换」，ref 必须与 state 同步（快捷键靠 ref 读最新值）；
 *   - Delete 键只在有选中、无弹窗、焦点不在输入框时生效；
 *   - 删除单条与多选在撤销栈里是两种操作（delete / batchDelete），错了就撤销不回来。
 */
const { del } = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock('../../../services/api', () => ({
  axiosInstance: { delete: del, post: vi.fn() },
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  del.mockReset();
  del.mockResolvedValue({ data: {} });
});

const item = (id: string, name: string): TaskItem => ({ id, taskName: name, hours: 1 });
const sel = (itemId: string, date = '2026-11-26'): SelectedTask => ({ itemId, designerId: 'd1', date });

describe('useTaskSelection', () => {
  it('普通点击替换选中，Ctrl 点击追加/取消', async () => {
    const { result } = renderHook(() => useTaskSelection());

    act(() => result.current.handleSelectTask('t1', 'd1', '2026-11-26', false));
    expect(result.current.selectedTasks).toEqual([sel('t1')]);

    act(() => result.current.handleSelectTask('t2', 'd1', '2026-11-26', true));
    expect(result.current.selectedTasks).toEqual([sel('t1'), sel('t2')]);

    // 再点一次已选中的：取消
    act(() => result.current.handleSelectTask('t1', 'd1', '2026-11-26', true));
    expect(result.current.selectedTasks).toEqual([sel('t2')]);

    // 不带 append：替换
    act(() => result.current.handleSelectTask('t3', 'd1', '2026-11-26', false));
    expect(result.current.selectedTasks).toEqual([sel('t3')]);
  })

  it('ref 与 state 同步（快捷键读 ref，不能拿到过期值）', async () => {
    const { result } = renderHook(() => useTaskSelection());

    act(() => result.current.handleSelectTask('t1', 'd1', '2026-11-26', false));
    await waitFor(() => expect(result.current.selectedTasksRef.current).toEqual([sel('t1')]));

    act(() => result.current.setSelectedCell({ designerId: 'd1', date: '2026-11-27' }));
    await waitFor(() => expect(result.current.selectedCellRef.current).toEqual({ designerId: 'd1', date: '2026-11-27' }));
  })

  it('clearSelection 同时清掉任务选中与单元格选中', async () => {
    const { result } = renderHook(() => useTaskSelection());

    act(() => {
      result.current.handleSelectTask('t1', 'd1', '2026-11-26', false);
      result.current.setSelectedCell({ designerId: 'd1', date: '2026-11-26' });
    });
    act(() => result.current.clearSelection());

    expect(result.current.selectedTasks).toEqual([]);
    expect(result.current.selectedCell).toBeNull();
  })
});

const setupDeletion = (overrides: Record<string, unknown> = {}) => {
  const ref: { current: SelectedTask[] } = { current: [] };
  const spies = {
    addToast: vi.fn(),
    addToHistory: vi.fn(),
    fetchSheets: vi.fn(),
    stopEditingCell: vi.fn(),
    warnIfOfflineEdit: vi.fn(() => false),
    warnIfCellLocked: vi.fn(() => false),
    getSelectedTaskPayloads: vi.fn((fallback: { item: TaskItem; designerId: string; date: string }) => [fallback]),
  };
  const allItems: TaskItem[] = [item('t1', '确认图'), item('t2', '设计')];
  const setSelectedTasks = vi.fn();
  const setSelectedCell = vi.fn();

  const params = {
    canEditTasks: true,
    isOfflineMode: false,
    addToast: spies.addToast,
    warnIfOfflineEdit: spies.warnIfOfflineEdit,
    warnIfCellLocked: spies.warnIfCellLocked,
    getSelectedTaskPayloads: spies.getSelectedTaskPayloads,
    getAllItems: vi.fn(() => allItems),
    addToHistory: spies.addToHistory,
    fetchSheets: spies.fetchSheets,
    stopEditingCell: spies.stopEditingCell,
    socketRef: { current: { emit: vi.fn() } },
    selectedTasksRef: ref,
    setSelectedTasks,
    setSelectedCell,
    isHotkeyBlocked: false,
    ...overrides,
  };
  const view = renderHook(() => useTaskDeletion(params as any));
  return { ...spies, ...view, ref, allItems, setSelectedTasks, setSelectedCell, socketRef: params.socketRef };
};

describe('useTaskDeletion', () => {
  it('多选逐条删除，并登记 batchDelete 历史', async () => {
    const ctx = setupDeletion();
    ctx.ref.current = [sel('t1'), sel('t2')];

    await act(async () => {
      await ctx.result.current.deleteSelectedTasks();
    });

    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith('/tasks/item', { data: { designerId: 'd1', date: '2026-11-26', itemId: 't1' } });
    expect(ctx.addToHistory).toHaveBeenCalledWith('batchDelete', {
      items: [
        { designerId: 'd1', date: '2026-11-26', item: ctx.allItems[0] },
        { designerId: 'd1', date: '2026-11-26', item: ctx.allItems[1] },
      ],
    });
    expect(ctx.addToast).toHaveBeenCalledWith('已删除 2 个任务', 'success');
    expect(ctx.setSelectedTasks).toHaveBeenCalledWith([]);
    expect(ctx.socketRef.current.emit).toHaveBeenCalledWith('task_updated');
  });

  it('只选中一条时登记 delete（撤销语义不同）', async () => {
    const ctx = setupDeletion();
    ctx.ref.current = [sel('t1')];

    await act(async () => {
      await ctx.result.current.deleteSelectedTasks();
    });

    expect(del).toHaveBeenCalledTimes(1);
    expect(ctx.addToHistory).toHaveBeenCalledWith('delete', {
      designerId: 'd1', date: '2026-11-26', item: ctx.allItems[0],
    });
    expect(ctx.addToast).toHaveBeenCalledWith('任务已删除', 'success');
  });

  it('传 fallback 时按那一条删（右键菜单单条删除）', async () => {
    const ctx = setupDeletion();
    ctx.ref.current = [sel('t1'), sel('t2')];

    await act(async () => {
      await ctx.result.current.deleteSelectedTasks({ item: ctx.allItems[1], designerId: 'd1', date: '2026-11-26' });
    });

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/tasks/item', { data: { designerId: 'd1', date: '2026-11-26', itemId: 't2' } });
  });

  it('没有选中时什么都不做', async () => {
    const ctx = setupDeletion();
    await act(async () => {
      await ctx.result.current.deleteSelectedTasks();
    });
    expect(del).not.toHaveBeenCalled();
    expect(ctx.addToHistory).not.toHaveBeenCalled();
  });

  it('任一单元格被锁定时整批都不删', async () => {
    const ctx = setupDeletion({ warnIfCellLocked: vi.fn(() => true) });
    ctx.ref.current = [sel('t1'), sel('t2')];

    await act(async () => {
      await ctx.result.current.deleteSelectedTasks();
    });

    expect(del).not.toHaveBeenCalled();
    expect(ctx.addToHistory).not.toHaveBeenCalled();
  });

  it('没有编辑权限时给出离线提示并退出', async () => {
    const ctx = setupDeletion({ canEditTasks: false, isOfflineMode: true });
    ctx.ref.current = [sel('t1')];

    await act(async () => {
      await ctx.result.current.deleteSelectedTasks();
    });

    expect(del).not.toHaveBeenCalled();
    expect(ctx.addToast).toHaveBeenCalledWith('当前离线，禁止编辑', 'error');
  });

  it('Delete 键在有选中时触发删除', async () => {
    const ctx = setupDeletion();
    ctx.ref.current = [sel('t1')];

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });

  it('Delete 键在弹窗打开 / 焦点在输入框 / 无选中时不触发', async () => {
    const blocked = setupDeletion({ isHotkeyBlocked: true });
    blocked.ref.current = [sel('t1')];
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    expect(del).not.toHaveBeenCalled();
    blocked.unmount();

    del.mockReset();
    const empty = setupDeletion();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    expect(del).not.toHaveBeenCalled();
    empty.unmount();

    // 焦点在输入框里：Delete 是删字，不是删任务
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const typing = setupDeletion();
    typing.ref.current = [sel('t1')];
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(del).not.toHaveBeenCalled();
    input.remove();
  });
});
