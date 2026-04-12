/**
 * useTasks Hook
 * 管理任务相关的状态和操作
 */

import { useState, useCallback, useEffect } from 'react';
import { tasksAPI } from '../services/api';
import type { TaskSheet, TaskItem } from '../types';

interface UseTasksOptions {
  month: number;
  year: number;
  designerId?: string;
  autoFetch?: boolean;
}

interface UseTasksReturn {
  sheets: TaskSheet[];
  loading: boolean;
  error: Error | null;
  fetchTasks: () => Promise<void>;
  createTask: (params: {
    designerId: string;
    date: string;
    taskName: string;
    hours: number;
    color?: string;
    guns?: any[];
    leaveType?: 'sick' | 'vacation' | 'illness' | 'trip' | null;
  }) => Promise<TaskItem>;
  updateTask: (params: {
    designerId: string;
    date: string;
    itemId: string;
    field: 'taskName' | 'hours' | 'color' | 'guns' | 'leaveType';
    value: any;
  }) => Promise<TaskItem>;
  deleteTask: (params: {
    designerId: string;
    date: string;
    itemId: string;
  }) => Promise<void>;
  moveTask: (params: {
    sourceDesignerId: string;
    sourceDate: string;
    itemId: string;
    targetDesignerId: string;
    targetDate: string;
    newIndex?: number;
  }) => Promise<void>;
  getItems: (designerId: string, date: string) => TaskItem[];
  calculateDailyTotal: (designerId: string, date: string) => number;
  calculateMonthlyTotal: (designerId: string) => number;
}

/**
 * 任务管理 Hook
 */
export const useTasks = (options: UseTasksOptions): UseTasksReturn => {
  const { month, year, designerId, autoFetch = true } = options;
  
  const [sheets, setSheets] = useState<TaskSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * 获取任务数据
   */
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await tasksAPI.getTasks(month, year, designerId);
      setSheets(data);
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error('获取任务数据失败'));
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [month, year, designerId]);

  /**
   * 创建任务
   */
  const createTask = useCallback(async (params: {
    designerId: string;
    date: string;
    taskName: string;
    hours: number;
    color?: string;
    guns?: any[];
    leaveType?: 'sick' | 'vacation' | 'illness' | 'trip' | null;
  }): Promise<TaskItem> => {
    const response = await tasksAPI.createTask(params);
    // 更新本地状态
    setSheets(prev => {
      const existingIndex = prev.findIndex(
        s => s.designerId === response.designerId && 
             s.month === response.month && 
             s.year === response.year
      );
      
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = response.sheet;
        return updated;
      }
      
      return [...prev, response.sheet];
    });
    
    return response.item;
  }, []);

  /**
   * 更新任务
   */
  const updateTask = useCallback(async (params: {
    designerId: string;
    date: string;
    itemId: string;
    field: 'taskName' | 'hours' | 'color' | 'guns' | 'leaveType';
    value: any;
  }): Promise<TaskItem> => {
    const response = await tasksAPI.updateTask(params);
    // 更新本地状态
    setSheets(prev => {
      const existingIndex = prev.findIndex(
        s => s.designerId === response.designerId && 
             s.month === response.month && 
             s.year === response.year
      );
      
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = response.sheet;
        return updated;
      }
      
      return [...prev, response.sheet];
    });
    
    return response.item;
  }, []);

  /**
   * 删除任务
   */
  const deleteTask = useCallback(async (params: {
    designerId: string;
    date: string;
    itemId: string;
  }): Promise<void> => {
    const response = await tasksAPI.deleteTask(params);
    // 更新本地状态
    setSheets(prev => {
      const existingIndex = prev.findIndex(
        s => s.designerId === response.designerId && 
             s.month === response.month && 
             s.year === response.year
      );
      
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = response.sheet;
        return updated;
      }
      
      return prev.filter(s => 
        !(s.designerId === response.designerId && 
          s.month === response.month && 
          s.year === response.year &&
          (!s.days[response.date] || s.days[response.date].length === 0))
      );
    });
  }, []);

  /**
   * 移动任务
   */
  const moveTask = useCallback(async (params: {
    sourceDesignerId: string;
    sourceDate: string;
    itemId: string;
    targetDesignerId: string;
    targetDate: string;
    newIndex?: number;
  }): Promise<void> => {
    const response = await tasksAPI.moveTask(params);
    // 更新本地状态
    setSheets(prev => {
      const updated = [...prev];
      
      // 更新源工作表
      const sourceIndex = updated.findIndex(
        s => s.designerId === response.sourceSheet.designerId &&
             s.month === response.sourceSheet.month &&
             s.year === response.sourceSheet.year
      );
      
      if (sourceIndex !== -1) {
        updated[sourceIndex] = response.sourceSheet;
      }
      
      // 更新目标工作表
      const targetIndex = updated.findIndex(
        s => s.designerId === response.targetSheet.designerId &&
             s.month === response.targetSheet.month &&
             s.year === response.targetSheet.year
      );
      
      if (targetIndex !== -1) {
        updated[targetIndex] = response.targetSheet;
      }
      
      return updated;
    });
  }, []);

  /**
   * 获取指定日期的任务列表
   */
  const getItems = useCallback((designerId: string, date: string): TaskItem[] => {
    const sheet = sheets.find(
      s => s.designerId === designerId && s.month === month && s.year === year
    );
    
    if (!sheet?.days?.[date]) {
      return [];
    }
    
    // 过滤掉无效的任务
    return sheet.days[date].filter(item => {
      if (item.leaveType) return true;
      const taskName = (item.taskName || '').trim();
      const gunsEmpty = !item.guns || item.guns.length === 0 || 
                        item.guns.every(g => !g.name || g.name.trim() === '未命名');
      if (!taskName && gunsEmpty) return false;
      return true;
    });
  }, [sheets, month, year]);

  /**
   * 计算每日总工时
   */
  const calculateDailyTotal = useCallback((designerId: string, date: string): number => {
    const items = getItems(designerId, date);
    
    return items.reduce((sum, item) => {
      // 跳过请假任务
      if (item.leaveType === 'sick' || item.leaveType === 'vacation' || item.leaveType === 'illness') {
        return sum;
      }
      
      const mainHours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours as string) || 0);
      const gunsHours = (item.guns || []).reduce((gSum, gun) => {
        return gSum + (typeof gun.hours === 'number' ? gun.hours : (parseFloat(gun.hours as string) || 0));
      }, 0);
      
      return sum + (item.guns && item.guns.length > 0 ? gunsHours : mainHours);
    }, 0);
  }, [getItems]);

  /**
   * 计算月度总工时
   */
  const calculateMonthlyTotal = useCallback((designerId: string): number => {
    const sheet = sheets.find(
      s => s.designerId === designerId && s.month === month && s.year === year
    );
    
    if (!sheet?.days) {
      return 0;
    }
    
    return Object.entries(sheet.days).reduce((sum, [date]) => {
      return sum + calculateDailyTotal(designerId, date);
    }, 0);
  }, [sheets, month, year, calculateDailyTotal]);

  // 自动获取数据
  useEffect(() => {
    if (autoFetch) {
      fetchTasks();
    }
  }, [autoFetch, fetchTasks]);

  return {
    sheets,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    moveTask,
    getItems,
    calculateDailyTotal,
    calculateMonthlyTotal,
  };
};

export default useTasks;
