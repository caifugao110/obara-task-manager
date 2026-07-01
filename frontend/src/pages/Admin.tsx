import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { UserPlus, Trash2, Shield, User, ChevronLeft, ChevronDown, ChevronRight, LogOut, AlertCircle, CheckCircle, RefreshCw, EyeOff, Eye, GripVertical, Key, Edit2, X, ToggleLeft, Upload, Download } from 'lucide-react';
import { format } from 'date-fns';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DesignerData {
  id: string;
  name: string;
  group: string;
  hidden?: boolean;
}

const SortableDesignerRow = ({ 
  designer, 
  selected,
  onSelect,
  onEdit,
  onToggleHide, 
  onDelete 
}: { 
  designer: DesignerData, 
  selected: boolean,
  onSelect: (id: string, selected: boolean) => void,
  onEdit: (id: string) => void,
  onToggleHide: (id: string, hidden: boolean) => void,
  onDelete: (id: string) => void 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: designer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <tr 
      ref={setNodeRef} 
      style={style} 
      className={`hover:bg-blue-50/30 transition group ${designer.hidden ? 'opacity-50' : ''}`}
    >
      <td className="px-6 py-4 align-middle">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          checked={selected}
          onChange={(e) => onSelect(designer.id, e.target.checked)}
        />
      </td>
      <td className="px-6 py-4 font-bold text-gray-700 align-middle">
        <div className="flex items-center gap-2">
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 rounded">
            <GripVertical size={16} className="text-gray-400" />
          </div>
          <span className="align-middle">{designer.name}</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className="text-gray-600 font-medium">{designer.group || '未分组'}</span>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <button 
            onClick={() => onEdit(designer.id)}
            className="p-2 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
            title="编辑人员信息"
          >
            <Edit2 size={18} />
          </button>
          <button 
            onClick={() => onToggleHide(designer.id, !designer.hidden)}
            className={`p-2 rounded-lg transition-all duration-200 ${designer.hidden ? 'text-blue-500 bg-blue-50' : 'text-gray-300 hover:text-blue-600 hover:bg-blue-50'}`}
            title={designer.hidden ? '取消隐藏' : '隐藏人员'}
          >
            {designer.hidden ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          <button 
            onClick={() => onDelete(designer.id)}
            className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
            title="移除人员"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </td>
    </tr>
  );
};

interface UserData {
  id: string;
  username: string;
  name: string;
  role: 'superadmin' | 'admin' | 'user';
  group?: string;
  disabled?: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const initialDesigners = [
  { name: '陈青松', group: '设计一课第一组' },
  { name: '王福跃', group: '设计二课' },
  { name: '张明', group: '设计一课张明组' },
  { name: '孙茂余', group: '设计一课第一组' },
  { name: '高剑', group: '设计一课张明组' },
  { name: '杨虹', group: '设计一课第一组' },
  { name: '张万利', group: '设计二课' },
  { name: '翟世学', group: '设计一课第一组' },
  { name: '戴红琴', group: '设计一课张明组' },
  { name: '陈爱珍', group: '设计一课第一组' },
  { name: '陈大仪', group: '设计一课第一组' },
  { name: '韩同进', group: '设计二课' },
  { name: '侯桂英', group: '设计一课第一组' },
  { name: '张啸', group: '设计一课第一组' },
  { name: '袁林', group: '设计一课张明组' },
  { name: '佘鲁明', group: '设计一课第一组' },
  { name: '朱海洋', group: '设计一课第一组' },
  { name: '郁钰', group: '设计一课第一组' },
  { name: '丁代远', group: '设计一课第一组' },
  { name: '周骅', group: '设计一课第一组' },
  { name: '周椿杰', group: '设计二课' },
  { name: '徐绍洋', group: '设计一课第一组' },
  { name: '张艳珍', group: '设计一课第一组' },
  { name: '林慈贤', group: '设计一课张明组' },
  { name: '吴健', group: '设计一课张明组' },
  { name: '朱栋栋', group: '设计一课张明组' }
];

const initialLoginUsers = [
  { username: 'chengqs', password: 'nj.chengqs', name: '陈青松', role: 'admin' },
  { username: 'wangfy', password: 'nj.wangfy', name: '王福跃', role: 'admin' },
  { username: 'zhangm', password: 'nj.zhangm', name: '张明', role: 'admin' },
  { username: 'sunmy', password: 'nj.sunmy', name: '孙茂余', role: 'user' },
  { username: 'gaoj', password: 'nj.gaoj', name: '高剑', role: 'user' },
  { username: 'yangh', password: 'nj.yangh', name: '杨虹', role: 'user' },
  { username: 'zhangwl', password: 'nj.zhangwl', name: '张万利', role: 'user' },
  { username: 'zhaisx', password: 'nj.zhaisx', name: '翟世学', role: 'user' },
  { username: 'daihq', password: 'nj.daihq', name: '戴红琴', role: 'user' },
  { username: 'chenaz', password: 'nj.chenaz', name: '陈爱珍', role: 'user' },
  { username: 'chendy', password: 'nj.chendy', name: '陈大仪', role: 'admin' },
  { username: 'hantj', password: 'nj.hantj', name: '韩同进', role: 'user' },
  { username: 'hougy', password: 'nj.hougy', name: '侯桂英', role: 'user' },
  { username: 'zhangx', password: 'nj.zhangx', name: '张啸', role: 'admin' },
  { username: 'yuanl', password: 'nj.yuanl', name: '袁林', role: 'user' },
  { username: 'shelm', password: 'nj.shelm', name: '佘鲁明', role: 'user' },
  { username: 'zhuhy', password: 'nj.zhuhy', name: '朱海洋', role: 'user' },
  { username: 'yuy', password: 'nj.yuy', name: '郁钰', role: 'user' },
  { username: 'dingdy', password: 'nj.dingdy', name: '丁代远', role: 'user' },
  { username: 'zhouh', password: 'nj.zhouh', name: '周骅', role: 'user' },
  { username: 'zhoucj', password: 'nj.zhoucj', name: '周椿杰', role: 'user' },
  { username: 'xusy', password: 'nj.xusy', name: '徐绍洋', role: 'user' },
  { username: 'zhangyz', password: 'nj.zhangyz', name: '张艳珍', role: 'user' },
  { username: 'lincx', password: 'nj.lincx', name: '林慈贤', role: 'user' },
  { username: 'wuj', password: 'nj.wuj', name: '吴健', role: 'user' },
  { username: 'zhudd', password: 'nj.zhudd', name: '朱栋栋', role: 'user' }
] as const;

const Admin = () => {
  const { token, logout, user: currentUser, authReady } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [designers, setDesigners] = useState<DesignerData[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Login User Form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('admin');
  
  // Designer Form
  const [newDesignerName, setNewDesignerName] = useState('');
  const [newDesignerGroup, setNewDesignerGroup] = useState('');

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetPasswordSubmitting, setResetPasswordSubmitting] = useState(false);
  
  // Edit Designer Modal
  const [editDesignerModalOpen, setEditDesignerModalOpen] = useState(false);
  const [editingDesignerId, setEditingDesignerId] = useState<string | null>(null);
  const [editingDesignerName, setEditingDesignerName] = useState('');
  const [editingDesignerGroup, setEditingDesignerGroup] = useState('');
  const [bulkImportType, setBulkImportType] = useState<'designers' | 'users' | null>(null);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportSubmitting, setBulkImportSubmitting] = useState(false);
  const [selectedDesignerIds, setSelectedDesignerIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [initializingDesigners, setInitializingDesigners] = useState(false);
  const [initializingUsers, setInitializingUsers] = useState(false);
  const [designersCollapsed, setDesignersCollapsed] = useState(false);
  const [usersCollapsed, setUsersCollapsed] = useState(false);
  
  const isSuperAdmin = currentUser?.role === 'superadmin';
  const canInitializeDesigners = isSuperAdmin && designers.length === 0;
  const canInitializeUsers = isSuperAdmin && users.filter(u => u.role !== 'superadmin').length === 0;
  const authHeader = useMemo(
    () => (token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
    [token]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const parseTableText = (text: string) => {
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const delimiter = line.includes('\t') ? '\t' : ',';
        return line.split(delimiter).map(cell => cell.trim().replace(/^\uFEFF/, '').replace(/^"|"$/g, ''));
      });
  };

  const normalizeRole = (role?: string): 'admin' | 'user' => {
    const value = (role || '').trim().toLowerCase();
    if (value === 'user' || value === '普通用户') return 'user';
    return 'admin';
  };

  const getRoleLabel = (role: UserData['role']) => {
    if (role === 'superadmin') return '超级管理员';
    if (role === 'admin') return '一般管理员';
    return '普通用户';
  };

  const normalizeKey = (value: string) => value.trim().toLowerCase();

  const formatElapsed = (startedAt: number) => `${((performance.now() - startedAt) / 1000).toFixed(2)} 秒`;

  const selectableUserIds = useMemo(
    () => users.filter(u => u.id !== currentUser?.id && u.role !== 'superadmin').map(u => u.id),
    [currentUser?.id, users]
  );

  const isMissingBatchRoute = (err: any) => err?.response?.status === 404;

  const downloadTemplate = (type: 'designers' | 'users') => {
    const csv = type === 'designers'
      ? 'name,group\n张三,设计一课\n李四,设计二课\n'
      : 'username,password,name,role\nuser001,123456,普通用户A,user\nadmin001,123456,管理员A,admin\n';
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = type === 'designers' ? '设计人员导入模板.csv' : '登录用户导入模板.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBulkImportText(text);
    e.target.value = '';
  };

  const handleBulkImport = async () => {
    if (!bulkImportType || !authHeader) return;
    const rows = parseTableText(bulkImportText);
    if (rows.length === 0) {
      addToast('请先粘贴或选择要导入的表格内容', 'error');
      return;
    }

    const dataRows = rows[0]?.some(cell => ['name', 'group', 'username', 'password', 'role'].includes(cell.toLowerCase()))
      ? rows.slice(1)
      : rows;

    setBulkImportSubmitting(true);
    const startedAt = performance.now();
    try {
      let successCount = 0;
      let skippedCount = 0;
      if (bulkImportType === 'designers') {
        const existingNames = new Set(designers.map(d => normalizeKey(d.name)));
        for (const row of dataRows) {
          const [name, group = ''] = row;
          if (!name) continue;
          const key = normalizeKey(name);
          if (!key || existingNames.has(key)) {
            skippedCount++;
            continue;
          }
          await axios.post('/api/designers', { name, group }, authHeader);
          existingNames.add(key);
          successCount++;
        }
      } else {
        const existingUsernames = new Set(users.map(u => normalizeKey(u.username)));
        for (const row of dataRows) {
          const [username, password, name, role] = row;
          if (!username || !password || !name) continue;
          const key = normalizeKey(username);
          if (!key || existingUsernames.has(key)) {
            skippedCount++;
            continue;
          }
          await axios.post('/api/users', {
            username,
            password,
            name,
            role: isSuperAdmin ? normalizeRole(role) : 'user'
          }, authHeader);
          existingUsernames.add(key);
          successCount++;
        }
      }

      const elapsed = formatElapsed(startedAt);
      addToast(`已导入 ${successCount} 条，跳过 ${skippedCount} 条重复数据，耗时 ${elapsed}`, 'success');
      setBulkImportType(null);
      setBulkImportText('');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '批量导入失败', 'error');
    } finally {
      setBulkImportSubmitting(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!token || !authHeader) return;

    setLoading(true);
    try {
      const usersRes = await axios.get('/api/users', authHeader);
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      addToast('无法加载管理员列表', 'error');
    }

    try {
      const designersRes = await axios.get('/api/designers/manage', authHeader);
      setDesigners(Array.isArray(designersRes.data) ? designersRes.data : []);
    } catch (err: any) {
      console.error('Error fetching designers:', err);
      addToast('无法加载设计人员列表', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, authHeader]);

  useEffect(() => {
    if (!authReady || !token) return;
    fetchData();
  }, [authReady, token, fetchData]);

  useEffect(() => {
    if (!isSuperAdmin && newRole !== 'user') {
      setNewRole('user');
    }
  }, [isSuperAdmin, newRole]);

  useEffect(() => {
    setSelectedDesignerIds(prev => prev.filter(id => designers.some(d => d.id === id)));
  }, [designers]);

  useEffect(() => {
    setSelectedUserIds(prev => prev.filter(id => users.some(u => u.id === id)));
  }, [users]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin && newRole !== 'user') {
      addToast('一般管理员只能创建普通用户', 'error');
      return;
    }
    try {
      await axios.post('/api/users', {
        username: newUsername,
        password: newPassword,
        name: newName || newUsername,
        role: isSuperAdmin ? newRole : 'user'
      }, authHeader);
      
      addToast('登录用户创建成功', 'success');
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      setNewRole('admin');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '创建失败', 'error');
    }
  };

  const handleCreateDesigner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (designers.some(d => normalizeKey(d.name) === normalizeKey(newDesignerName))) {
      addToast('设计人员姓名已存在', 'error');
      return;
    }
    try {
      await axios.post('/api/designers', {
        name: newDesignerName,
        group: newDesignerGroup
      }, authHeader);
      
      addToast('设计人员添加成功', 'success');
      setNewDesignerName('');
      setNewDesignerGroup('');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '添加失败', 'error');
    }
  };

  const handleInitializeDesigners = async () => {
    if (!authHeader || !canInitializeDesigners) return;
    if (!window.confirm(`确定要初始化 ${initialDesigners.length} 位设计人员吗？`)) return;

    setInitializingDesigners(true);
    try {
      await Promise.all(initialDesigners.map(designer => axios.post('/api/designers', designer, authHeader)));
      addToast(`已初始化 ${initialDesigners.length} 位设计人员`, 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '初始化设计人员失败', 'error');
    } finally {
      setInitializingDesigners(false);
    }
  };

  const handleInitializeUsers = async () => {
    if (!authHeader || !canInitializeUsers) return;
    if (!window.confirm(`确定要初始化 ${initialLoginUsers.length} 个登录用户吗？`)) return;

    setInitializingUsers(true);
    try {
      await Promise.all(initialLoginUsers.map(user => axios.post('/api/users', user, authHeader)));
      addToast(`已初始化 ${initialLoginUsers.length} 个登录用户`, 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '初始化登录用户失败', 'error');
    } finally {
      setInitializingUsers(false);
    }
  };

  const handleToggleHideDesigner = async (id: string, hidden: boolean) => {
    const designer = designers.find(d => d.id === id);
    if (!designer) return;
    try {
      await axios.put(`/api/designers/${id}`, { name: designer.name, group: designer.group, hidden }, authHeader);
      addToast(hidden ? '人员已隐藏' : '已取消隐藏', 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '操作失败', 'error');
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = designers.findIndex((d) => d.id === active.id);
      const newIndex = designers.findIndex((d) => d.id === over.id);
      const newDesigners = arrayMove(designers, oldIndex, newIndex);
      
      setDesigners(newDesigners);
      
      try {
        await axios.post('/api/designers/reorder', { ids: newDesigners.map(d => d.id) }, authHeader);
        addToast('排序已保存', 'success');
      } catch (err) {
        addToast('排序保存失败', 'error');
        fetchData();
      }
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!isSuperAdmin) return;
    if (id === currentUser?.id) {
      addToast('不能删除自己', 'error');
      return;
    }
    if (!window.confirm('确定要删除该登录用户吗？')) return;
    try {
      await axios.delete(`/api/users/${id}`, authHeader);
      addToast('账号已删除', 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '删除失败', 'error');
    }
  };

  const handleBatchDeleteUsers = async () => {
    if (!isSuperAdmin) return;
    const ids = selectedUserIds.filter(id => id !== currentUser?.id);
    const selectedUsers = users.filter(u => ids.includes(u.id));
    if (ids.length === 0) {
      addToast('请先选择要删除的登录用户', 'error');
      return;
    }
    if (selectedUsers.some(u => u.role === 'superadmin')) {
      addToast('不能批量删除超级管理员账号', 'error');
      return;
    }
    if (!window.confirm(`确定要删除选中的 ${ids.length} 个登录用户吗？`)) return;
    try {
      try {
        await axios.post('/api/users/batch-delete', { ids }, authHeader);
      } catch (err: any) {
        if (!isMissingBatchRoute(err)) throw err;
        await Promise.all(ids.map(id => axios.delete(`/api/users/${id}`, authHeader)));
      }
      addToast(`已删除 ${ids.length} 个登录用户`, 'success');
      setSelectedUserIds([]);
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '批量删除失败', 'error');
    }
  };

  const handleResetPassword = async (id: string) => {
    if (!isSuperAdmin) return;
    setResetPasswordUserId(id);
    setResetPasswordValue('');
  };

  const handleToggleUserDisabled = async (id: string) => {
    if (!isSuperAdmin) return;
    const user = users.find(u => u.id === id);
    if (!user) return;
    try {
      await axios.put(`/api/users/${id}`, { disabled: !user.disabled }, authHeader);
      addToast(user.disabled ? '账号已启用' : '账号已禁用', 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '操作失败', 'error');
    }
  };

  const submitResetPassword = async () => {
    if (!isSuperAdmin) return;
    if (!resetPasswordUserId) return;
    if (resetPasswordValue.length < 6) {
      addToast('密码至少6位', 'error');
      return;
    }
    setResetPasswordSubmitting(true);
    try {
      await axios.put(`/api/users/${resetPasswordUserId}`, { password: resetPasswordValue }, authHeader);
      addToast('密码已重置', 'success');
      setResetPasswordUserId(null);
      setResetPasswordValue('');
    } catch (err: any) {
      addToast(err.response?.data?.message || '重置失败', 'error');
    } finally {
      setResetPasswordSubmitting(false);
    }
  };

  const handleDeleteDesigner = async (id: string) => {
    if (!window.confirm('确定要从表格中移除该设计人员吗？其任务数据将保留在数据库中但不再显示。')) return;
    try {
      await axios.delete(`/api/designers/${id}`, authHeader);
      addToast('人员已移除', 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '移除失败', 'error');
    }
  };

  const handleBatchDeleteDesigners = async () => {
    const ids = [...selectedDesignerIds];
    if (ids.length === 0) {
      addToast('请先选择要删除的设计人员', 'error');
      return;
    }
    if (!window.confirm(`确定要从表格中移除选中的 ${ids.length} 位设计人员吗？其任务数据将保留在数据库中但不再显示。`)) return;
    try {
      try {
        await axios.post('/api/designers/batch-delete', { ids }, authHeader);
      } catch (err: any) {
        if (!isMissingBatchRoute(err)) throw err;
        await Promise.all(ids.map(id => axios.delete(`/api/designers/${id}`, authHeader)));
      }
      addToast(`已移除 ${ids.length} 位设计人员`, 'success');
      setSelectedDesignerIds([]);
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '批量移除失败', 'error');
    }
  };

  const handleEditDesigner = (id: string) => {
    const designer = designers.find(d => d.id === id);
    if (designer) {
      setEditingDesignerId(id);
      setEditingDesignerName(designer.name);
      setEditingDesignerGroup(designer.group || '');
      setEditDesignerModalOpen(true);
    }
  };

  const handleSaveDesigner = async () => {
    if (!editingDesignerId) return;
    try {
      const designer = designers.find(d => d.id === editingDesignerId);
      if (!designer) return;
      await axios.put(`/api/designers/${editingDesignerId}`, { 
        name: editingDesignerName, 
        group: editingDesignerGroup, 
        hidden: designer.hidden 
      }, authHeader);
      addToast('设计人员信息已更新', 'success');
      setEditDesignerModalOpen(false);
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '更新失败', 'error');
    }
  };

  if (!authReady || loading) return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
      <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
      <div className="text-gray-600 font-medium">正在加载用户数据...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {resetPasswordUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/40" 
            onClick={() => {
              if (resetPasswordSubmitting) return;
              setResetPasswordUserId(null);
              setResetPasswordValue('');
            }} 
          />
          <div className="relative bg-white rounded-lg shadow-2xl w-[520px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="font-bold text-gray-800">
                重置密码 - {users.find(u => u.id === resetPasswordUserId)?.name}
              </div>
              <button
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
                onClick={() => {
                  if (resetPasswordSubmitting) return;
                  setResetPasswordUserId(null);
                  setResetPasswordValue('');
                }}
              >
                ×
              </button>
            </div>
            <div className="p-5">
              <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">新密码</label>
              <input
                type="password"
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                placeholder="至少6位"
                disabled={resetPasswordSubmitting}
              />
            </div>
            <div className="px-5 py-4 bg-white border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition"
                onClick={() => {
                  if (resetPasswordSubmitting) return;
                  setResetPasswordUserId(null);
                  setResetPasswordValue('');
                }}
                disabled={resetPasswordSubmitting}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 transition disabled:opacity-50"
                onClick={submitResetPassword}
                disabled={resetPasswordSubmitting}
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {editDesignerModalOpen && editingDesignerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/40" 
            onClick={() => setEditDesignerModalOpen(false)} 
          />
          <div className="relative bg-white rounded-lg shadow-2xl w-[520px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-[#217346] text-white border-b border-gray-200 flex items-center justify-between">
              <div className="font-bold text-lg">编辑设计人员</div>
              <button
                className="p-1 rounded hover:bg-[#1a5c38] transition"
                onClick={() => setEditDesignerModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">姓名</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={editingDesignerName}
                  onChange={(e) => setEditingDesignerName(e.target.value)}
                  placeholder="输入姓名"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">所属分组</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={editingDesignerGroup}
                  onChange={(e) => setEditingDesignerGroup(e.target.value)}
                  placeholder="例如：设计一课"
                />
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition"
                onClick={() => setEditDesignerModalOpen(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 transition"
                onClick={handleSaveDesigner}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkImportType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (bulkImportSubmitting) return;
              setBulkImportType(null);
              setBulkImportText('');
            }}
          />
          <div className="relative bg-white rounded-lg shadow-2xl w-[680px] max-w-[94vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="font-bold text-gray-800">
                {bulkImportType === 'designers' ? '批量添加设计人员' : '批量添加登录用户'}
              </div>
              <button
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
                onClick={() => {
                  if (bulkImportSubmitting) return;
                  setBulkImportType(null);
                  setBulkImportText('');
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadTemplate(bulkImportType)}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  <Download size={16} />
                  下载模板
                </button>
                <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer">
                  <Upload size={16} />
                  选择表格文件
                  <input
                    type="file"
                    accept=".csv,.txt,.tsv"
                    className="hidden"
                    onChange={handleBulkFileChange}
                  />
                </label>
              </div>
              <textarea
                className="h-64 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm font-mono outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
                placeholder={
                  bulkImportType === 'designers'
                    ? '可直接从外部表格复制两列：姓名、分组'
                    : isSuperAdmin
                      ? '可直接从外部表格复制四列：用户名、密码、姓名、角色(admin/user)'
                      : '可直接从外部表格复制三列：用户名、密码、姓名；将自动创建为普通用户'
                }
              />
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                支持 CSV、TSV，或从 Excel/WPS 复制后直接粘贴。第一行可以保留模板表头。重复数据会自动跳过并显示耗时。
              </div>
            </div>
            <div className="px-5 py-4 bg-white border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition"
                onClick={() => {
                  if (bulkImportSubmitting) return;
                  setBulkImportType(null);
                  setBulkImportText('');
                }}
                disabled={bulkImportSubmitting}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 transition disabled:opacity-50"
                onClick={handleBulkImport}
                disabled={bulkImportSubmitting}
              >
                {bulkImportSubmitting ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h1 className="text-xl font-bold text-gray-800 tracking-tight">用户管理中心</h1>
        </div>
        
        <div className="flex items-center space-x-6">
          <div className="flex flex-col items-end">
            <span className="text-xs text-gray-400">当前管理员</span>
            <span className="text-sm font-bold text-gray-700">{currentUser?.name}</span>
          </div>
          <button 
            onClick={logout}
            className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition"
          >
            <LogOut size={18} />
            <span>退出</span>
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-8 max-w-7xl mx-auto w-full">
        {/* Designers Management (Task Table Members) */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <button
                type="button"
                onClick={() => setDesignersCollapsed(prev => !prev)}
                className="inline-flex items-center gap-2 rounded-lg px-2 py-1 -ml-2 text-lg font-bold text-gray-800 hover:bg-gray-100 transition"
                title={designersCollapsed ? '展开设计人员列表' : '折叠设计人员列表'}
              >
                {designersCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                设计人员列表
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleInitializeDesigners}
                  disabled={!canInitializeDesigners || initializingDesigners}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!isSuperAdmin ? '仅超级管理员可使用' : designers.length > 0 ? '设计人员为空时可初始化' : '初始化设计人员'}
                >
                  <UserPlus size={14} />
                  {initializingDesigners ? '初始化中...' : '初始化设计人员'}
                </button>
                <button
                  type="button"
                  onClick={handleBatchDeleteDesigners}
                  disabled={selectedDesignerIds.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                  批量删除
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkImportType('designers');
                    setBulkImportText('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-100 transition"
                >
                  <Upload size={14} />
                  批量添加设计人员
                </button>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{designers.length} 位设计人员</span>
              </div>
            </div>
            {!designersCollapsed && (
            <div className="overflow-x-auto">
              <DndContext 
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white text-gray-400 text-[10px] font-black uppercase tracking-widest border-b border-gray-100">
                      <th className="px-6 py-4 w-12">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={designers.length > 0 && selectedDesignerIds.length === designers.length}
                          onChange={(e) => setSelectedDesignerIds(e.target.checked ? designers.map(d => d.id) : [])}
                        />
                      </th>
                      <th className="px-6 py-4">姓名</th>
                      <th className="px-6 py-4">分组</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <SortableContext
                    items={designers.map(d => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <tbody className="text-sm divide-y divide-gray-50 align-middle">
                      {designers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center">
                            <p className="font-bold text-gray-500">暂无设计人员</p>
                            <p className="text-sm text-gray-400 mt-1">请在右侧表单添加第一位设计人员，添加后将显示在工作台表格中</p>
                          </td>
                        </tr>
                      ) : (
                        designers.map(d => (
                          <SortableDesignerRow
                            key={d.id}
                            designer={d}
                            selected={selectedDesignerIds.includes(d.id)}
                            onSelect={(id, selected) => {
                              setSelectedDesignerIds(prev => selected ? [...prev, id] : prev.filter(item => item !== id));
                            }}
                            onEdit={handleEditDesigner}
                            onToggleHide={handleToggleHideDesigner}
                            onDelete={handleDeleteDesigner}
                          />
                        ))
                      )}
                    </tbody>
                  </SortableContext>
                </table>
              </DndContext>
            </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden h-fit">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <UserPlus size={20} className="mr-2 text-blue-600" /> 添加设计人员
              </h2>
            </div>
            <form onSubmit={handleCreateDesigner} className="p-6 space-y-5">
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">人员姓名</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={newDesignerName}
                  onChange={(e) => setNewDesignerName(e.target.value)}
                  placeholder="例如: 张三"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">所属分组</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={newDesignerGroup}
                  onChange={(e) => setNewDesignerGroup(e.target.value)}
                  placeholder="例如: 设计一课"
                />
              </div>
              <button 
                type="submit" 
                className="w-full bg-blue-600 text-white py-3.5 rounded-lg font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all duration-200 active:scale-[0.98]"
              >
                添加到表格
              </button>
            </form>
          </div>
        </section>

        {/* Login Users Management (Admins) */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-8 border-t border-gray-200">
          <div className="lg:col-span-2 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <button
                type="button"
                onClick={() => setUsersCollapsed(prev => !prev)}
                className="inline-flex items-center gap-2 rounded-lg px-2 py-1 -ml-2 text-lg font-bold text-gray-800 hover:bg-gray-100 transition"
                title={usersCollapsed ? '展开登录用户列表' : '折叠登录用户列表'}
              >
                {usersCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                登录用户列表
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleInitializeUsers}
                  disabled={!canInitializeUsers || initializingUsers}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!isSuperAdmin ? '仅超级管理员可使用' : !canInitializeUsers ? '仅剩超级管理员账号时可初始化' : '初始化登录用户'}
                >
                  <UserPlus size={14} />
                  {initializingUsers ? '初始化中...' : '初始化登录用户'}
                </button>
                <button
                  type="button"
                  onClick={handleBatchDeleteUsers}
                  disabled={!isSuperAdmin || selectedUserIds.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                  批量删除
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkImportType('users');
                    setBulkImportText('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-600 hover:bg-purple-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload size={14} />
                  批量添加登录用户
                </button>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{users.length} 个用户</span>
              </div>
            </div>
            {!usersCollapsed && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-white text-gray-400 text-[10px] font-black uppercase tracking-widest border-b border-gray-100">
                    <th className="px-6 py-4 w-12">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        checked={selectableUserIds.length > 0 && selectableUserIds.every(id => selectedUserIds.includes(id))}
                        onChange={(e) => {
                          setSelectedUserIds(e.target.checked ? selectableUserIds : []);
                        }}
                        disabled={!isSuperAdmin || selectableUserIds.length === 0}
                      />
                    </th>
                    <th className="px-6 py-4">姓名</th>
                    <th className="px-6 py-4">用户名</th>
                    <th className="px-6 py-4">权限</th>
                    <th className="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-50">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-purple-50/30 transition group">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 disabled:opacity-40"
                          checked={selectedUserIds.includes(u.id)}
                          onChange={(e) => {
                            setSelectedUserIds(prev => e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id));
                          }}
                          disabled={!isSuperAdmin || u.id === currentUser?.id || u.role === 'superadmin'}
                        />
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-700">{u.name}</td>
                      <td className="px-6 py-4 text-gray-500 font-medium">{u.username}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black flex items-center w-fit ring-1 ${
                          u.role === 'superadmin'
                            ? 'bg-red-100 text-red-700 ring-red-200'
                            : u.role === 'admin'
                              ? 'bg-purple-100 text-purple-700 ring-purple-200'
                              : 'bg-gray-100 text-gray-700 ring-gray-200'
                        }`}>
                          <Shield size={12} className="mr-1.5" /> {getRoleLabel(u.role)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isSuperAdmin && u.id !== currentUser?.id && (
                            <button 
                              onClick={() => handleToggleUserDisabled(u.id)}
                              className={`p-2 rounded-lg transition-all duration-200 ${u.disabled ? 'text-gray-400 hover:text-green-600 hover:bg-green-50' : 'text-green-600 hover:text-gray-400 hover:bg-gray-50'}`}
                              title={u.disabled ? '启用账号' : '禁用账号'}
                            >
                              <ToggleLeft size={18} className={u.disabled ? 'opacity-50' : ''} />
                            </button>
                          )}
                          {isSuperAdmin && u.role !== 'superadmin' && (
                            <button 
                              onClick={() => handleResetPassword(u.id)}
                              className="p-2 text-gray-300 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all duration-200"
                              title="重置密码"
                            >
                              <Key size={18} />
                            </button>
                          )}
                          {isSuperAdmin && u.id !== currentUser?.id && (
                            <button 
                              onClick={() => handleDeleteUser(u.id)}
                              className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
                              title="删除账号"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden h-fit">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <Shield size={20} className="mr-2 text-purple-600" /> 新增登录用户
              </h2>
              {!isSuperAdmin && <p className="text-[10px] text-gray-500 mt-1">一般管理员仅可创建普通用户</p>}
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-5">
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">显示姓名</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如: 管理员A"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">登录用户名</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="登录账号"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">登录密码</label>
                <input 
                  type="password" 
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少6位"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">角色权限</label>
                <select 
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition cursor-pointer"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
                >
                  {isSuperAdmin && <option value="admin">一般管理员</option>}
                  <option value="user">普通用户</option>
                </select>
              </div>
              <button 
                type="submit" 
                className="w-full bg-purple-600 text-white py-3.5 rounded-lg font-bold hover:bg-purple-700 shadow-lg shadow-purple-200 transition-all duration-200 active:scale-[0.98]"
              >
                创建登录用户
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Admin;
