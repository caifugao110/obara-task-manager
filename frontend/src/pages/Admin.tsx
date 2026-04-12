import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { UserPlus, Trash2, Shield, User, ChevronLeft, LogOut, AlertCircle, CheckCircle, RefreshCw, EyeOff, Eye, GripVertical, Key, Edit2, X, ToggleLeft } from 'lucide-react';
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
  onEdit,
  onToggleHide, 
  onDelete 
}: { 
  designer: DesignerData, 
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
  role: 'superadmin' | 'admin';
  group?: string;
  disabled?: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const Admin = () => {
  const { token, logout, user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [designers, setDesigners] = useState<DesignerData[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Login User Form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin'>('admin');
  
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
  
  const isSuperAdmin = currentUser?.role === 'superadmin';
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

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

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, designersRes] = await Promise.all([
        axios.get('/api/users', authHeader),
        axios.get('/api/designers')
      ]);
      setUsers(usersRes.data);
      setDesigners(designersRes.data);
    } catch (err: any) {
      console.error('Error fetching data:', err);
      addToast('无法加载数据', 'error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    try {
      await axios.post('/api/users', {
        username: newUsername,
        password: newPassword,
        name: newName || newUsername,
        role: 'admin'
      }, authHeader);
      
      addToast('管理员账号创建成功', 'success');
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '创建失败', 'error');
    }
  };

  const handleCreateDesigner = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (!window.confirm('确定要删除该管理员吗？')) return;
    try {
      await axios.delete(`/api/users/${id}`, authHeader);
      addToast('账号已删除', 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '删除失败', 'error');
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

  if (loading) return (
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
              <h2 className="text-lg font-bold text-gray-800">设计人员表格名单</h2>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{designers.length} 位设计人员</span>
            </div>
            <div className="overflow-x-auto">
              <DndContext 
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white text-gray-400 text-[10px] font-black uppercase tracking-widest border-b border-gray-100">
                      <th className="px-6 py-4">姓名</th>
                      <th className="px-6 py-4">分组</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-gray-50 align-middle">
                    <SortableContext 
                      items={designers.map(d => d.id)} 
                      strategy={verticalListSortingStrategy}
                    >
                      {designers.map(d => (
                        <SortableDesignerRow 
                          key={d.id} 
                          designer={d} 
                          onEdit={handleEditDesigner}
                          onToggleHide={handleToggleHideDesigner}
                          onDelete={handleDeleteDesigner}
                        />
                      ))}
                    </SortableContext>
                  </tbody>
                </table>
              </DndContext>
            </div>
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
              <h2 className="text-lg font-bold text-gray-800">系统管理员列表</h2>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{users.length} 个管理员</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-white text-gray-400 text-[10px] font-black uppercase tracking-widest border-b border-gray-100">
                    <th className="px-6 py-4">姓名</th>
                    <th className="px-6 py-4">用户名</th>
                    <th className="px-6 py-4">权限</th>
                    <th className="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-50">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-purple-50/30 transition group">
                      <td className="px-6 py-4 font-bold text-gray-700">{u.name}</td>
                      <td className="px-6 py-4 text-gray-500 font-medium">{u.username}</td>
                      <td className="px-6 py-4">
                        {u.role === 'superadmin' ? (
                          <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[10px] font-black flex items-center w-fit ring-1 ring-red-200">
                            <Shield size={12} className="mr-1.5" /> 超级管理员
                          </span>
                        ) : (
                          <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-[10px] font-black flex items-center w-fit ring-1 ring-purple-200">
                            <Shield size={12} className="mr-1.5" /> 一般管理员
                          </span>
                        )}
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
                          {isSuperAdmin && u.role === 'admin' && (
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
          </div>

          <div className={`bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden h-fit ${!isSuperAdmin ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <Shield size={20} className="mr-2 text-purple-600" /> 新增管理员
              </h2>
              {!isSuperAdmin && <p className="text-[10px] text-red-500 mt-1">仅超级管理员可操作</p>}
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
                  onChange={(e) => setNewRole(e.target.value as 'admin')}
                >
                  <option value="admin">一般管理员</option>
                </select>
              </div>
              <button 
                type="submit" 
                className="w-full bg-purple-600 text-white py-3.5 rounded-lg font-bold hover:bg-purple-700 shadow-lg shadow-purple-200 transition-all duration-200 active:scale-[0.98]"
              >
                创建账号
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Admin;
