import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { UserPlus, Trash2, Shield, User, ChevronLeft, LogOut, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';

interface DesignerData {
  id: string;
  name: string;
  group: string;
}

interface UserData {
  id: string;
  username: string;
  name: string;
  role: 'superadmin' | 'admin';
  group?: string;
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
  const [newRole, setNewRole] = useState<'superadmin' | 'admin'>('admin');
  
  // Designer Form
  const [newDesignerName, setNewDesignerName] = useState('');
  const [newDesignerGroup, setNewDesignerGroup] = useState('');

  const [toasts, setToasts] = useState<Toast[]>([]);

  const isSuperAdmin = currentUser?.role === 'superadmin';
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

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
        role: newRole
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

  const handleUpdateDesignerGroup = async (id: string, group: string) => {
    const designer = designers.find(d => d.id === id);
    if (!designer) return;
    try {
      await axios.put(`/api/designers/${id}`, { name: designer.name, group }, authHeader);
      addToast('分组更新成功', 'success');
      fetchData();
    } catch (err: any) {
      addToast(err.response?.data?.message || '更新失败', 'error');
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
              <h2 className="text-lg font-bold text-gray-800">任务表格人员名单</h2>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{designers.length} 位设计人员</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-white text-gray-400 text-[10px] font-black uppercase tracking-widest border-b border-gray-100">
                    <th className="px-6 py-4">姓名</th>
                    <th className="px-6 py-4">分组</th>
                    <th className="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-50">
                  {designers.map(d => (
                    <tr key={d.id} className="hover:bg-blue-50/30 transition group">
                      <td className="px-6 py-4 font-bold text-gray-700">{d.name}</td>
                      <td className="px-6 py-4">
                        <input 
                          type="text" 
                          className="bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none text-gray-600 transition w-32"
                          defaultValue={d.group || ''}
                          onBlur={(e) => handleUpdateDesignerGroup(d.id, e.target.value)}
                          placeholder="未分组"
                        />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => handleDeleteDesigner(d.id)}
                          className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
                          title="移除人员"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                  placeholder="例如: 设计一部"
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
                        {isSuperAdmin && u.id !== currentUser?.id && (
                          <button 
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
                            title="删除账号"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
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
                  onChange={(e) => setNewRole(e.target.value as 'superadmin' | 'admin')}
                >
                  <option value="admin">一般管理员</option>
                  <option value="superadmin">超级管理员</option>
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
