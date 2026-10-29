import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { axiosInstance } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { buildLoginUrl } from '../utils/redirect';
import { UserPlus, Trash2, Shield, User, Users, ChevronLeft, ChevronDown, LogOut, AlertCircle, CheckCircle, RefreshCw, EyeOff, Eye, Key, Edit2, X, ToggleLeft, ToggleRight, Upload, Download, Settings, Search, Plus, MoreHorizontal, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

interface DesignerData {
  id: string;
  name: string;
  group: string;
  hidden?: boolean;
}

// 抽屉/工具栏共用的样式常量：保证表单与菜单在各模式下的排版完全一致
const FIELD_LABEL = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-500';
const FIELD_INPUT = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100';
const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

// 中文排序统一用 Intl.Collator：ICU 的 zh 排序规则按拼音（姓氏 A-Z）比较，
// 不使用 localeCompare 逐次调用是为了避免长列表排序时的重复构造开销。
const zhCollator = (() => {
  try {
    return new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  } catch {
    return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  }
})();

const compareZh = (a: string, b: string) => zhCollator.compare(a || '', b || '');

// 多音字姓氏：ICU 给出的默认读音与姓氏读音不一致（如“翟”姓读 zhái，ICU 读 dí），
// 比较前先把首字换成同音字，保证按姓氏拼音落位。
const POLYPHONIC_SURNAME: Record<string, string> = {
  翟: '宅', 曾: '增', 单: '山', 解: '谢', 仇: '求', 区: '欧',
  查: '扎', 缪: '妙', 覃: '秦', 朴: '票', 盖: '葛', 乐: '岳',
  尉: '玉', 秘: '必', 折: '舌', 长: '常'
};

const nameSortKey = (name: string) => {
  const first = name.slice(0, 1);
  const replacement = POLYPHONIC_SURNAME[first];
  return replacement ? replacement + name.slice(1) : name;
};

const compareByName = (a: string, b: string) => compareZh(nameSortKey(a), nameSortKey(b));

type SortDir = 'asc' | 'desc';
interface SortState<T extends string> { key: T; dir: SortDir }

// 表头排序按钮：同一列再次点击反转方向，切换列时回到升序
const SortHeader = <T extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className = ''
}: {
  label: string;
  sortKey: T;
  sort: SortState<T>;
  onSort: (key: T) => void;
  className?: string;
}) => {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`px-3 py-2.5 ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`按${label}排序`}
        className={`group/th inline-flex items-center gap-1 rounded transition hover:text-gray-800 ${active ? 'text-gray-800' : ''}`}
      >
        {label}
        <Icon size={12} className={active ? 'text-blue-600' : 'text-gray-300 group-hover/th:text-gray-500'} />
      </button>
    </th>
  );
};

const DesignerRow = ({
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
  return (
    <tr className="group transition-colors hover:bg-blue-50/40">
      <td className="w-10 py-2.5 pl-4 pr-0 align-middle">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
          checked={selected}
          onChange={(e) => onSelect(designer.id, e.target.checked)}
        />
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-700">
            {designer.name.slice(0, 1)}
          </span>
          <span className={`truncate font-semibold ${designer.hidden ? 'text-gray-400 line-through decoration-gray-300' : 'text-gray-800'}`}>
            {designer.name}
          </span>
          {designer.hidden && (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
              已隐藏
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200/70">
          {designer.group || '未分组'}
        </span>
      </td>
      <td className="w-[120px] px-4 py-2.5 text-right align-middle">
        <div className="flex items-center justify-end gap-0.5">
          <button
            onClick={() => onEdit(designer.id)}
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-blue-50 hover:text-blue-600"
            title="编辑人员信息"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={() => onToggleHide(designer.id, !designer.hidden)}
            className={`rounded-md p-1.5 transition ${
              designer.hidden
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-400 hover:bg-blue-50 hover:text-blue-600'
            }`}
            title={designer.hidden ? '取消隐藏' : '隐藏人员'}
          >
            {designer.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            onClick={() => onDelete(designer.id)}
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
            title="移除人员"
          >
            <Trash2 size={16} />
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

// 初始登录用户名单。初始密码不再硬编码：执行初始化时由浏览器 CSPRNG
// 为每个账号随机生成，仅在结果弹窗中展示一次，需线下分发给本人。
const initialLoginUsers = [
  { username: 'chenqs', name: '陈青松', role: 'admin' },
  { username: 'wangfy', name: '王福跃', role: 'admin' },
  { username: 'zhangm', name: '张明', role: 'admin' },
  { username: 'sunmy', name: '孙茂余', role: 'user' },
  { username: 'gaoj', name: '高剑', role: 'user' },
  { username: 'yangh', name: '杨虹', role: 'user' },
  { username: 'zhangwl', name: '张万利', role: 'user' },
  { username: 'zhaisx', name: '翟世学', role: 'admin' },
  { username: 'daihq', name: '戴红琴', role: 'user' },
  { username: 'chenaz', name: '陈爱珍', role: 'user' },
  { username: 'chendy', name: '陈大仪', role: 'admin' },
  { username: 'hantj', name: '韩同进', role: 'user' },
  { username: 'hougy', name: '侯桂英', role: 'user' },
  { username: 'zhangx', name: '张啸', role: 'admin' },
  { username: 'shelm', name: '佘鲁明', role: 'user' },
  { username: 'zhuhy', name: '朱海洋', role: 'admin' },
  { username: 'yuy', name: '郁钰', role: 'user' },
  { username: 'dingdy', name: '丁代远', role: 'user' },
  { username: 'zhouh', name: '周骅', role: 'user' },
  { username: 'zhoucj', name: '周椿杰', role: 'user' },
  { username: 'xusy', name: '徐绍洋', role: 'user' },
  { username: 'zhangyz', name: '张艳珍', role: 'user' },
  { username: 'lincx', name: '林慈贤', role: 'user' },
  { username: 'wuj', name: '吴健', role: 'user' },
  { username: 'zhudd', name: '朱栋栋', role: 'user' },
  { username: 'zhangj', name: '张杰', role: 'admin' },
  { username: 'zhangzw', name: '张祖旺', role: 'admin' },
  { username: 'geh', name: '葛慧', role: 'user' },
  { username: 'yanxx', name: '严新星', role: 'user' },
  { username: 'chenhd', name: '陈浩东', role: 'user' }
] as const;

// 使用浏览器 CSPRNG 生成 12 位初始密码（base64url 字符集）
const generateInitialPassword = (): string => {
  const bytes = new Uint8Array(9);
  window.crypto.getRandomValues(bytes);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// 生成12位强随机密码（排除易混淆字符 0/O/1/l/I），满足后端最少6位要求
const generateRandomPassword = (): string => {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
  const length = 12;
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
};

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
  const [showNewPassword, setShowNewPassword] = useState(true);
  
  // Designer Form
  const [newDesignerName, setNewDesignerName] = useState('');
  const [newDesignerGroup, setNewDesignerGroup] = useState('');

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  // 重置本人密码时必填的当前密码（后端自助改密强制校验旧密码）
  const [resetPasswordOldValue, setResetPasswordOldValue] = useState('');
  const [resetPasswordSubmitting, setResetPasswordSubmitting] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  // 批量重置密码弹窗（仅超级管理员）
  const [batchResetModalOpen, setBatchResetModalOpen] = useState(false);
  const [batchResetMode, setBatchResetMode] = useState<'manual' | 'auto'>('auto');
  const [batchResetPassword, setBatchResetPassword] = useState('');
  const [batchResetShowPassword, setBatchResetShowPassword] = useState(false);
  const [batchResetSubmitting, setBatchResetSubmitting] = useState(false);
  const [setRoleUserId, setSetRoleUserId] = useState<string | null>(null);
  const [setRoleValue, setSetRoleValue] = useState<'admin' | 'user'>('user');
  const [setRoleSubmitting, setSetRoleSubmitting] = useState(false);
  
  // Edit Designer Modal
  const [editingDesignerId, setEditingDesignerId] = useState<string | null>(null);
  const [editingDesignerName, setEditingDesignerName] = useState('');
  const [editingDesignerGroup, setEditingDesignerGroup] = useState('');
  const [bulkImportType, setBulkImportType] = useState<'designers' | 'users' | null>(null);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportSubmitting, setBulkImportSubmitting] = useState(false);
  const [selectedDesignerIds, setSelectedDesignerIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  // 禁用/启用确认弹窗（单个与批量通用）：待操作的 id 列表 + 目标状态
  const [disableConfirm, setDisableConfirm] = useState<{ ids: string[]; disabled: boolean } | null>(null);
  const [disableSubmitting, setDisableSubmitting] = useState(false);
  const [initializingDesigners, setInitializingDesigners] = useState(false);
  const [confirmInitDesigners, setConfirmInitDesigners] = useState(false);
  // 删除确认弹窗（登录用户/设计人员共用，单个与批量通用，记录类型与待删除 id 列表）
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState<{ kind: 'users' | 'designers'; ids: string[] } | null>(null);
  const [initializingUsers, setInitializingUsers] = useState(false);
  const [confirmInitUsers, setConfirmInitUsers] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // —— 布局状态：单页 Tab + 工具栏筛选 + 右侧抽屉表单 ——
  const [activeTab, setActiveTab] = useState<'designers' | 'users'>('designers');
  const [designerQuery, setDesignerQuery] = useState('');
  const [designerGroup, setDesignerGroup] = useState('all');
  const [userQuery, setUserQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'admin' | 'user' | 'disabled'>('all');
  // 表头排序状态：设计人员默认按姓名拼音 A-Z，登录用户默认同样按姓名 A-Z
  const [designerSort, setDesignerSort] = useState<SortState<'name' | 'group'>>({ key: 'name', dir: 'asc' });
  const [userSort, setUserSort] = useState<SortState<'name' | 'role' | 'status'>>({ key: 'name', dir: 'asc' });
  // 抽屉模式：新增/编辑设计人员、新增登录用户共用同一侧滑容器
  const [drawerMode, setDrawerMode] = useState<'designer-add' | 'designer-edit' | 'user-add' | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const isOffline = !isOnline;

  // 初始化用户后一次性展示的初始凭据（关闭后不再可查）
  const [initialCredentials, setInitialCredentials] = useState<Array<{
    username: string; name: string; role: string; password: string; ok: boolean;
  }>>([]);
  // 凭据展示弹窗来源：init=初始化登录用户，batchReset=批量重置密码（仅影响弹窗文案）
  const [credentialKind, setCredentialKind] = useState<'init' | 'batchReset'>('init');
  
  const isSuperAdmin = currentUser?.role === 'superadmin';
  // 账号管理能力分层：禁用/启用、删除（含批量）一般管理员也可执行；
  // 设置权限与重置密码仍为超级管理员专属。
  const canManageUsers = isSuperAdmin || currentUser?.role === 'admin';
  // 只能操作「权限低于自己」的账号：超管可管所有非超管账号，一般管理员只能管普通用户
  const canManageTarget = (target: UserData) => isSuperAdmin || target.role === 'user';
  const canInitializeDesigners = isSuperAdmin && designers.length === 0;
  const canInitializeUsers = isSuperAdmin && users.filter(u => u.role !== 'superadmin').length === 0;

  // 凭据展示弹窗文案：初始化建号 vs 批量重置密码共用同一弹窗
  const credentialMeta = credentialKind === 'batchReset'
    ? { title: '批量重置后的新密码', passwordHeader: '新密码', okLabel: '已重置', copyLabel: '新密码', copyToast: '已复制全部新密码' }
    : { title: '初始登录密码', passwordHeader: '初始密码', okLabel: '已创建', copyLabel: '初始密码', copyToast: '已复制成功用户的初始密码' };

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // 网络错误（断网/服务不可达）时标记离线，触发页面禁止编辑
  const markOfflineIfNetworkError = useCallback((err: any) => {
    if (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
      setIsOnline(false);
      return true;
    }
    return false;
  }, []);

  // 离线时拦截一切写操作
  const guardOffline = () => {
    if (!isOffline) return false;
    addToast('当前离线，禁止编辑', 'error');
    return true;
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
    () => users
      .filter(u => u.id !== currentUser?.id && u.role !== 'superadmin' && (isSuperAdmin || u.role === 'user'))
      .map(u => u.id),
    [currentUser?.id, users, isSuperAdmin]
  );

  // —— 工具栏筛选：分组/角色下拉与搜索关键词（本地过滤，不发请求）——
  const designerGroupOptions = useMemo(() => {
    const set = new Set<string>();
    designers.forEach(d => { if (d.group) set.add(d.group); });
    return Array.from(set).sort();
  }, [designers]);

  const filteredDesigners = useMemo(() => {
    const q = designerQuery.trim().toLowerCase();
    return designers.filter(d => {
      if (designerGroup !== 'all' && (d.group || '') !== designerGroup) return false;
      if (!q) return true;
      return d.name.toLowerCase().includes(q) || (d.group || '').toLowerCase().includes(q);
    });
  }, [designers, designerQuery, designerGroup]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return users.filter(u => {
      if (userRoleFilter === 'disabled') {
        if (!u.disabled) return false;
      } else if (userRoleFilter !== 'all' && u.role !== userRoleFilter) {
        return false;
      }
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
    });
  }, [users, userQuery, userRoleFilter]);

  const activeRows = activeTab === 'designers' ? filteredDesigners.length : filteredUsers.length;
  const activeTotal = activeTab === 'designers' ? designers.length : users.length;
  const isFiltered = activeRows !== activeTotal;
  const allFilteredDesignersSelected =
    filteredDesigners.length > 0 && filteredDesigners.every(d => selectedDesignerIds.includes(d.id));
  const selectableFilteredUserIds = filteredUsers
    .filter(u => selectableUserIds.includes(u.id))
    .map(u => u.id);

  // 点击表头：同列再次点击切换升降序，换列时默认升序
  const toggleDesignerSort = (key: SortState<'name' | 'group'>['key']) => {
    setDesignerSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  };
  const toggleUserSort = (key: SortState<'name' | 'role' | 'status'>['key']) => {
    setUserSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  };

  // 角色排序权重：超级管理员恒置顶（不参与排序），其余按 管理员 → 普通用户
  const roleRank: Record<UserData['role'], number> = { superadmin: 0, admin: 1, user: 2 };

  // 表头排序后的展示列表：纯前端排序，不改变筛选结果，也不写回后端顺序
  const sortedDesigners = useMemo(() => {
    const factor = designerSort.dir === 'asc' ? 1 : -1;
    return [...filteredDesigners].sort((a, b) => {
      if (designerSort.key === 'group') {
        // 空分组统一排在最后（不随升降序翻转），同组内仍按姓名 A-Z
        const ga = a.group || '';
        const gb = b.group || '';
        if (!ga && gb) return 1;
        if (ga && !gb) return -1;
        const byGroup = compareZh(ga, gb) * factor;
        if (byGroup !== 0) return byGroup;
        return compareByName(a.name, b.name);
      }
      return compareByName(a.name, b.name) * factor;
    });
  }, [filteredDesigners, designerSort]);

  const sortedUsers = useMemo(() => {
    const factor = userSort.dir === 'asc' ? 1 : -1;
    const superAdmins = filteredUsers.filter(u => u.role === 'superadmin');
    const others = filteredUsers.filter(u => u.role !== 'superadmin');
    others.sort((a, b) => {
      let result = 0;
      if (userSort.key === 'role') {
        result = (roleRank[a.role] - roleRank[b.role]) * factor;
      } else if (userSort.key === 'status') {
        result = (Number(!!a.disabled) - Number(!!b.disabled)) * factor;
      }
      // 主键相同时按姓名 A-Z 兜底，保证列表顺序稳定
      if (result === 0) result = compareByName(a.name, b.name);
      if (result === 0) result = compareZh(a.username, b.username);
      return result;
    });
    return [...superAdmins, ...others];
  }, [filteredUsers, userSort]);

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
    if (guardOffline()) return;
    if (!bulkImportType) return;
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
          await axiosInstance.post('/designers', { name, group });
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
          await axiosInstance.post('/users', {
            username,
            password,
            name,
            role: isSuperAdmin ? normalizeRole(role) : 'user'
          });
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
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '批量导入失败', 'error');
    } finally {
      setBulkImportSubmitting(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    try {
      const usersRes = await axiosInstance.get('/users');
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      markOfflineIfNetworkError(err);
      addToast('无法加载管理员列表', 'error');
    }

    try {
      const designersRes = await axiosInstance.get('/designers/manage');
      setDesigners(Array.isArray(designersRes.data) ? designersRes.data : []);
    } catch (err: any) {
      console.error('Error fetching designers:', err);
      markOfflineIfNetworkError(err);
      addToast('无法加载设计人员列表', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, markOfflineIfNetworkError]);

  useEffect(() => {
    if (!authReady || !token) return;
    fetchData();
  }, [authReady, token, fetchData]);

  // 网络恢复后自动重新加载数据
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchData();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchData]);

  // 后端服务停止/恢复（navigator.onLine 感知不到本机服务停止，由 axiosInstance 拦截器广播）
  useEffect(() => {
    const handleServerUnreachable = () => setIsOnline(false);
    const handleServerOnline = () => {
      setIsOnline(true);
      fetchData();
    };
    window.addEventListener('server-unreachable', handleServerUnreachable);
    window.addEventListener('server-online', handleServerOnline);
    return () => {
      window.removeEventListener('server-unreachable', handleServerUnreachable);
      window.removeEventListener('server-online', handleServerOnline);
    };
  }, [fetchData]);

  // 离线期间每 5 秒轻量探测后端是否恢复（成功时拦截器自动广播 server-online）
  useEffect(() => {
    if (!isOffline) return;
    const timer = setInterval(() => {
      axiosInstance.get('/auth/validate').catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [isOffline]);

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
    if (guardOffline()) return;
    if (!isSuperAdmin && newRole !== 'user') {
      addToast('一般管理员只能创建普通用户', 'error');
      return;
    }
    try {
      await axiosInstance.post('/users', {
        username: newUsername,
        password: newPassword,
        name: newName || newUsername,
        role: isSuperAdmin ? newRole : 'user'
      });
      
      addToast('登录用户创建成功', 'success');
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      setNewRole('admin');
      setShowNewPassword(true);
      setDrawerMode(null);
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '创建失败', 'error');
    }
  };

  const handleCreateDesigner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardOffline()) return;
    if (designers.some(d => normalizeKey(d.name) === normalizeKey(newDesignerName))) {
      addToast('设计人员姓名已存在', 'error');
      return;
    }
    try {
      await axiosInstance.post('/designers', {
        name: newDesignerName,
        group: newDesignerGroup || ''
      });
      
      addToast('设计人员添加成功', 'success');
      setNewDesignerName('');
      setNewDesignerGroup('');
      setDrawerMode(null);
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '添加失败', 'error');
    }
  };

  const handleInitializeDesigners = () => {
    if (guardOffline()) return;
    if (!canInitializeDesigners) return;
    setConfirmInitDesigners(true);
  };

  const runInitializeDesigners = async () => {
    if (guardOffline()) return;
    setInitializingDesigners(true);
    try {
      await Promise.all(initialDesigners.map(designer => axiosInstance.post('/designers', designer)));
      addToast(`已初始化 ${initialDesigners.length} 位设计人员`, 'success');
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '初始化设计人员失败', 'error');
    } finally {
      setInitializingDesigners(false);
    }
  };

  const handleInitializeUsers = () => {
    if (guardOffline()) return;
    if (!canInitializeUsers) return;
    setConfirmInitUsers(true);
  };

  const runInitializeUsers = async () => {
    if (guardOffline()) return;
    // 先在本地生成全部随机密码：即使部分请求失败，密码仍可展示，
    // 便于重试或手动建号
    const credentials = initialLoginUsers.map(user => ({
      username: user.username,
      name: user.name,
      role: user.role,
      password: generateInitialPassword(),
      ok: false
    }));

    setInitializingUsers(true);
    try {
      const results = await Promise.allSettled(
        credentials.map(c => axiosInstance.post('/users', {
          username: c.username,
          name: c.name,
          role: c.role,
          password: c.password
        }))
      );
      results.forEach((r, i) => {
        credentials[i].ok = r.status === 'fulfilled';
      });
      const okCount = credentials.filter(c => c.ok).length;
      const failCount = credentials.length - okCount;
      addToast(
        failCount === 0 ? `已初始化 ${okCount} 个登录用户` : `已初始化 ${okCount} 个，${failCount} 个失败`,
        failCount === 0 ? 'success' : 'error'
      );
      setCredentialKind('init');
      setInitialCredentials(credentials);
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '初始化登录用户失败', 'error');
    } finally {
      setInitializingUsers(false);
    }
  };

  const handleToggleHideDesigner = async (id: string, hidden: boolean) => {
    if (guardOffline()) return;
    const designer = designers.find(d => d.id === id);
    if (!designer) return;
    try {
      await axiosInstance.put(`/designers/${id}`, { name: designer.name, group: designer.group, hidden });
      addToast(hidden ? '人员已隐藏' : '已取消隐藏', 'success');
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '操作失败', 'error');
    }
  };

  const handleDeleteUser = (id: string) => {
    if (guardOffline()) return;
    if (!canManageUsers) return;
    const target = users.find(u => u.id === id);
    if (!target) return;
    if (id === currentUser?.id) {
      addToast('不能删除自己', 'error');
      return;
    }
    // 超级管理员账号不可删除：删掉最后一个超管会让系统失去唯一权限入口
    if (target.role === 'superadmin') {
      addToast('不能删除超级管理员账号', 'error');
      return;
    }
    if (!canManageTarget(target)) {
      addToast('只能操作权限低于自己的账号', 'error');
      return;
    }
    setBatchDeleteConfirm({ kind: 'users', ids: [id] });
  };

  const handleBatchDeleteUsers = () => {
    if (guardOffline()) return;
    if (!canManageUsers) return;
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
    if (selectedUsers.some(u => !canManageTarget(u))) {
      addToast('只能操作权限低于自己的账号', 'error');
      return;
    }
    setBatchDeleteConfirm({ kind: 'users', ids });
  };

  const runBatchDeleteUsers = async (ids: string[]) => {
    if (guardOffline()) return;
    try {
      try {
        await axiosInstance.post('/users/batch-delete', { ids });
      } catch (err: any) {
        if (!isMissingBatchRoute(err)) throw err;
        await Promise.all(ids.map(id => axiosInstance.delete(`/users/${id}`)));
      }
      addToast(`已删除 ${ids.length} 个登录用户`, 'success');
      setSelectedUserIds([]);
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '批量删除失败', 'error');
    }
  };

  const handleResetPassword = async (id: string) => {
    if (guardOffline()) return;
    if (!isSuperAdmin) return;
    setResetPasswordUserId(id);
    setResetPasswordValue(generateRandomPassword());
    setResetPasswordOldValue('');
    setShowResetPassword(true);
  };

  // 单个禁用/启用：先弹确认框，确认后才写后端
  const handleToggleUserDisabled = (id: string) => {
    if (guardOffline()) return;
    if (!canManageUsers) return;
    const user = users.find(u => u.id === id);
    if (!user) return;
    // 超级管理员账号不允许禁用（含自己）：禁用最后一个超管会导致系统失去唯一权限入口
    if (user.role === 'superadmin') {
      addToast('超级管理员账号不可禁用', 'error');
      return;
    }
    if (user.id === currentUser?.id) {
      addToast('不能禁用当前登录账号', 'error');
      return;
    }
    if (!canManageTarget(user)) {
      addToast('只能操作权限低于自己的账号', 'error');
      return;
    }
    setDisableConfirm({ ids: [id], disabled: !user.disabled });
  };

  // 执行禁用/启用：一次性提交，后端原子写入；老版本后端无该路由时降级为逐个 PUT
  const runToggleDisabled = async (ids: string[], disabled: boolean) => {
    if (guardOffline()) return;
    if (disableSubmitting) return;
    setDisableSubmitting(true);
    try {
      try {
        await axiosInstance.post('/users/batch-disabled', { ids, disabled });
      } catch (err: any) {
        if (!isMissingBatchRoute(err)) throw err;
        await Promise.all(ids.map(id => axiosInstance.put(`/users/${id}`, { disabled })));
      }
      const single = ids.length === 1;
      addToast(
        disabled
          ? (single ? '账号已禁用' : `已禁用 ${ids.length} 个账号`)
          : (single ? '账号已启用' : `已启用 ${ids.length} 个账号`),
        'success'
      );
      setSelectedUserIds(prev => prev.filter(id => !ids.includes(id)));
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || (disabled ? '禁用失败' : '启用失败'), 'error');
    } finally {
      setDisableSubmitting(false);
      setDisableConfirm(null);
    }
  };

  // 批量禁用/启用：先校验作用域，再弹确认框
  const handleBatchToggleDisabled = (disabled: boolean) => {
    if (guardOffline()) return;
    if (!canManageUsers) return;
    const ids = selectedUserIds.filter(id => id !== currentUser?.id);
    if (ids.length === 0) {
      addToast('请先选择要操作的登录用户', 'error');
      return;
    }
    const targets = users.filter(u => ids.includes(u.id));
    if (disabled && targets.some(u => u.role === 'superadmin')) {
      addToast('不能批量禁用超级管理员账号', 'error');
      return;
    }
    if (targets.some(u => !canManageTarget(u))) {
      addToast('只能操作权限低于自己的账号', 'error');
      return;
    }
    setDisableConfirm({ ids, disabled });
  };

  const submitResetPassword = async () => {
    if (guardOffline()) return;
    if (!isSuperAdmin) return;
    if (!resetPasswordUserId) return;
    if (resetPasswordValue.length < 6) {
      addToast('密码至少6位', 'error');
      return;
    }
    const isSelf = resetPasswordUserId === currentUser?.id;
    // 自助改密后端强制校验旧密码：本人重置必须提供当前密码
    if (isSelf && !resetPasswordOldValue) {
      addToast('请输入当前密码', 'error');
      return;
    }
    setResetPasswordSubmitting(true);
    try {
      await axiosInstance.put(`/users/${resetPasswordUserId}`, {
        password: resetPasswordValue,
        ...(isSelf ? { oldPassword: resetPasswordOldValue } : {})
      });
      addToast(
        isSelf ? '密码已重置，请使用新密码重新登录' : '密码已重置，对方可直接用新密码登录',
        'success'
      );
      setResetPasswordUserId(null);
      setResetPasswordValue('');
      setResetPasswordOldValue('');
      setShowResetPassword(false);
      // 重置本人密码会吊销当前令牌：跳转登录页重新认证
      if (isSelf) {
        setTimeout(() => { window.location.href = buildLoginUrl(); }, 800);
      }
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '重置失败', 'error');
    } finally {
      setResetPasswordSubmitting(false);
    }
  };

  // 批量重置密码：打开模式选择弹窗
  const handleBatchResetPassword = () => {
    if (guardOffline()) return;
    if (!isSuperAdmin) return;
    if (selectedUserIds.length === 0) {
      addToast('请先选择要重置密码的登录用户', 'error');
      return;
    }
    setBatchResetMode('auto');
    setBatchResetPassword('');
    setBatchResetShowPassword(false);
    setBatchResetModalOpen(true);
  };

  const closeBatchResetModal = () => {
    if (batchResetSubmitting) return;
    setBatchResetModalOpen(false);
    setBatchResetPassword('');
    setBatchResetShowPassword(false);
  };

  const submitBatchResetPassword = async () => {
    if (guardOffline()) return;
    if (!isSuperAdmin) return;
    if (selectedUserIds.length === 0) {
      addToast('请先选择要重置密码的登录用户', 'error');
      return;
    }
    if (batchResetMode === 'manual' && batchResetPassword.length < 6) {
      addToast('密码至少6位', 'error');
      return;
    }
    setBatchResetSubmitting(true);
    try {
      const resp = await axiosInstance.post('/users/batch-reset-password', {
        ids: selectedUserIds,
        mode: batchResetMode,
        ...(batchResetMode === 'manual' ? { password: batchResetPassword } : {})
      });
      const credentials: Array<{ id: string; username: string; name: string; password: string }> =
        resp.data?.credentials || [];
      setCredentialKind('batchReset');
      setInitialCredentials(credentials.map(c => ({
        username: c.username,
        name: c.name,
        role: '',
        password: c.password,
        ok: true
      })));
      setBatchResetModalOpen(false);
      setBatchResetPassword('');
      setBatchResetShowPassword(false);
      setSelectedUserIds([]);
      addToast(`已重置 ${credentials.length} 个账号的密码`, 'success');
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '批量重置失败', 'error');
    } finally {
      setBatchResetSubmitting(false);
    }
  };

  const handleSetRole = async (id: string) => {
    if (guardOffline()) return;
    if (!isSuperAdmin) return;
    const user = users.find(u => u.id === id);
    if (!user) return;
    setSetRoleUserId(id);
    setSetRoleValue(user.role === 'admin' ? 'admin' : 'user');
  };

  const submitSetRole = async () => {
    if (guardOffline()) return;
    if (!isSuperAdmin) return;
    if (!setRoleUserId) return;
    setSetRoleSubmitting(true);
    try {
      await axiosInstance.put(`/users/${setRoleUserId}`, { role: setRoleValue });
      addToast('权限已更新', 'success');
      setSetRoleUserId(null);
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '权限更新失败', 'error');
    } finally {
      setSetRoleSubmitting(false);
    }
  };

  const handleDeleteDesigner = (id: string) => {
    if (guardOffline()) return;
    setBatchDeleteConfirm({ kind: 'designers', ids: [id] });
  };

  const handleBatchDeleteDesigners = () => {
    if (guardOffline()) return;
    const ids = [...selectedDesignerIds];
    if (ids.length === 0) {
      addToast('请先选择要删除的设计人员', 'error');
      return;
    }
    setBatchDeleteConfirm({ kind: 'designers', ids });
  };

  const runBatchDeleteDesigners = async (ids: string[]) => {
    if (guardOffline()) return;
    try {
      try {
        await axiosInstance.post('/designers/batch-delete', { ids });
      } catch (err: any) {
        if (!isMissingBatchRoute(err)) throw err;
        await Promise.all(ids.map(id => axiosInstance.delete(`/designers/${id}`)));
      }
      addToast(`已移除 ${ids.length} 位设计人员`, 'success');
      setSelectedDesignerIds([]);
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '批量移除失败', 'error');
    }
  };

  const handleEditDesigner = (id: string) => {
    if (guardOffline()) return;
    const designer = designers.find(d => d.id === id);
    if (designer) {
      setEditingDesignerId(id);
      setEditingDesignerName(designer.name);
      setEditingDesignerGroup(designer.group || '');
      setDrawerMode('designer-edit');
    }
  };

  const handleSaveDesigner = async () => {
    if (guardOffline()) return;
    if (!editingDesignerId) return;
    try {
      const designer = designers.find(d => d.id === editingDesignerId);
      if (!designer) return;
      await axiosInstance.put(`/designers/${editingDesignerId}`, { 
        name: editingDesignerName, 
        group: editingDesignerGroup, 
        hidden: designer.hidden 
      });
      addToast('设计人员信息已更新', 'success');
      setDrawerMode(null);
      fetchData();
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      addToast(err.response?.data?.message || '更新失败', 'error');
    }
  };

  if (!authReady || loading) return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-gray-200 bg-white px-6">
        <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
      </div>
      <div className="mx-auto w-full max-w-[1440px] px-6 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="h-10 w-60 animate-pulse rounded-xl bg-gray-200" />
          <div className="h-9 w-36 animate-pulse rounded-lg bg-gray-200" />
        </div>
        <div className="mb-3 h-9 w-full max-w-sm animate-pulse rounded-lg bg-gray-200" />
        <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );

  const drawerTitle = drawerMode === 'user-add'
    ? '新增登录用户'
    : drawerMode === 'designer-edit' ? '编辑设计人员' : '添加设计人员';
  const drawerHint = drawerMode === 'user-add'
    ? '创建后请把初始密码线下告知本人'
    : drawerMode === 'designer-edit' ? '修改会立即同步到工作台表格' : '添加后显示在工作台任务表格中';

  // 禁用/启用确认弹窗的展示数据：目标账号列表（取姓名用于文案）
  const disableConfirmTargets = disableConfirm
    ? users.filter(u => disableConfirm.ids.includes(u.id))
    : [];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Toast Notifications */}
      <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2">
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
              setResetPasswordOldValue('');
              setShowResetPassword(false);
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
                  setResetPasswordOldValue('');
                  setShowResetPassword(false);
                }}
              >
                ×
              </button>
            </div>
            <div className="p-5">
              {resetPasswordUserId === currentUser?.id && (
                <div className="mb-4">
                  <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">当前密码</label>
                  <input
                    type="password"
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                    value={resetPasswordOldValue}
                    onChange={(e) => setResetPasswordOldValue(e.target.value)}
                    placeholder="重置本人密码需验证当前密码"
                    disabled={resetPasswordSubmitting}
                  />
                </div>
              )}
              <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">新密码</label>
              <div className="relative">
                <input
                  type={showResetPassword ? 'text' : 'password'}
                  className="w-full p-3 pr-20 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={resetPasswordValue}
                  onChange={(e) => setResetPasswordValue(e.target.value)}
                  placeholder="至少6位"
                  disabled={resetPasswordSubmitting}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-gray-200 text-gray-500"
                    title={showResetPassword ? '隐藏' : '显示'}
                    onClick={() => setShowResetPassword(v => !v)}
                    disabled={resetPasswordSubmitting}
                  >
                    {showResetPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-gray-200 text-gray-500"
                    title="重新生成随机密码"
                    onClick={() => setResetPasswordValue(generateRandomPassword())}
                    disabled={resetPasswordSubmitting}
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-gray-400 ml-1">已生成随机密码，可直接确认或手动修改</p>
            </div>
            <div className="px-5 py-4 bg-white border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition"
                onClick={() => {
                  if (resetPasswordSubmitting) return;
                  setResetPasswordUserId(null);
                  setResetPasswordValue('');
                  setResetPasswordOldValue('');
                  setShowResetPassword(false);
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

      {/* 批量重置密码弹窗（仅超级管理员）：手动统一密码 / 自动逐个随机 */}
      {batchResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeBatchResetModal}
          />
          <div className="relative bg-white rounded-lg shadow-2xl w-[520px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="font-bold text-gray-800">
                批量重置密码（已选 {selectedUserIds.length} 个账号）
              </div>
              <button
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
                onClick={closeBatchResetModal}
                disabled={batchResetSubmitting}
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setBatchResetMode('auto')}
                  disabled={batchResetSubmitting}
                  className={`text-left p-3 rounded-lg border-2 transition ${
                    batchResetMode === 'auto'
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  } disabled:opacity-60`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
                    <RefreshCw size={14} className={batchResetMode === 'auto' ? 'text-purple-600' : 'text-gray-400'} />
                    自动生成随机密码
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">为每个账号生成独立随机密码，结果仅展示一次</p>
                </button>
                <button
                  type="button"
                  onClick={() => setBatchResetMode('manual')}
                  disabled={batchResetSubmitting}
                  className={`text-left p-3 rounded-lg border-2 transition ${
                    batchResetMode === 'manual'
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  } disabled:opacity-60`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
                    <Key size={14} className={batchResetMode === 'manual' ? 'text-purple-600' : 'text-gray-400'} />
                    手动设置统一密码
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">所有选中账号改为同一个密码</p>
                </button>
              </div>
              {batchResetMode === 'manual' && (
                <div>
                  <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">统一新密码</label>
                  <div className="relative">
                    <input
                      type={batchResetShowPassword ? 'text' : 'password'}
                      className="w-full p-3 pr-12 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                      value={batchResetPassword}
                      onChange={(e) => setBatchResetPassword(e.target.value)}
                      placeholder="至少6位"
                      disabled={batchResetSubmitting}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-gray-200 text-gray-500"
                      title={batchResetShowPassword ? '隐藏' : '显示'}
                      onClick={() => setBatchResetShowPassword(v => !v)}
                      disabled={batchResetSubmitting}
                    >
                      {batchResetShowPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              )}
              <p className="text-xs text-red-600 font-bold">
                重置后这些账号的当前登录会话将立即失效，需使用新密码重新登录。
                {batchResetMode === 'auto' && ' 新密码仅展示一次，请提前准备保存方式。'}
              </p>
            </div>
            <div className="px-5 py-4 bg-white border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition"
                onClick={closeBatchResetModal}
                disabled={batchResetSubmitting}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 transition disabled:opacity-50"
                onClick={submitBatchResetPassword}
                disabled={batchResetSubmitting || (batchResetMode === 'manual' && batchResetPassword.length < 6)}
              >
                {batchResetSubmitting ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {setRoleUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (setRoleSubmitting) return;
              setSetRoleUserId(null);
            }}
          />
          <div className="relative bg-white rounded-lg shadow-2xl w-[520px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="font-bold text-gray-800">
                设置权限 - {users.find(u => u.id === setRoleUserId)?.name}
              </div>
              <button
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
                onClick={() => {
                  if (setRoleSubmitting) return;
                  setSetRoleUserId(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-2">
              <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">权限角色</label>
              <button
                type="button"
                className={`w-full p-3 rounded-lg border text-left transition flex items-center justify-between ${setRoleValue === 'admin' ? 'border-purple-500 bg-purple-50 text-purple-700 font-bold' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
                onClick={() => setSetRoleValue('admin')}
                disabled={setRoleSubmitting}
              >
                <span className="flex items-center">
                  <Shield size={16} className="mr-2" />
                  一般管理员
                </span>
                {setRoleValue === 'admin' && <CheckCircle size={18} />}
              </button>
              <button
                type="button"
                className={`w-full p-3 rounded-lg border text-left transition flex items-center justify-between ${setRoleValue === 'user' ? 'border-purple-500 bg-purple-50 text-purple-700 font-bold' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
                onClick={() => setSetRoleValue('user')}
                disabled={setRoleSubmitting}
              >
                <span className="flex items-center">
                  <User size={16} className="mr-2" />
                  普通用户
                </span>
                {setRoleValue === 'user' && <CheckCircle size={18} />}
              </button>
            </div>
            <div className="px-5 py-4 bg-white border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition"
                onClick={() => {
                  if (setRoleSubmitting) return;
                  setSetRoleUserId(null);
                }}
                disabled={setRoleSubmitting}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 transition disabled:opacity-50"
                onClick={submitSetRole}
                disabled={setRoleSubmitting}
              >
                确认设置
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
      <header className="sticky top-0 z-40 bg-white shadow-sm px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h1 className="text-xl font-bold text-blue-600 flex items-center">
            <Users className="text-blue-500 mr-2" size={24} />
            用户管理中心
          </h1>
        </div>

        <div className="flex items-center space-x-6">
          <span className="text-sm font-bold text-red-600">{currentUser?.name}</span>
          <button
            onClick={logout}
            className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition"
          >
            <LogOut size={18} />
            <span>退出</span>
          </button>
        </div>
      </header>

      {isOffline && (
        <div className="sticky top-12 z-40 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>当前处于离线模式，网络恢复后将自动加载最新数据，此页面禁止编辑！</span>
        </div>
      )}

      <main className={`mx-auto w-full max-w-[1440px] flex-1 px-4 py-4 sm:px-6 ${isOffline ? 'offline-locked' : ''}`}>
        {/* 页签 + 主操作：同一时刻只呈现一份列表，替代原「两段式」布局 */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveTab('designers')}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${
                activeTab === 'designers' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              设计人员
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                activeTab === 'designers' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>{designers.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${
                activeTab === 'users' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              登录用户
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                activeTab === 'users' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>{users.length}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerMode(activeTab === 'designers' ? 'designer-add' : 'user-add')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
            >
              <Plus size={16} />
              {activeTab === 'designers' ? '添加设计人员' : '新增登录用户'}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreMenuOpen(v => !v)}
                className={BTN_SECONDARY}
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
              >
                <MoreHorizontal size={16} />
                更多
                <ChevronDown size={14} className={`text-gray-400 transition ${moreMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {moreMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMoreMenuOpen(false)} />
                  <div className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
                    <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">批量导入</p>
                    <button
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => { setBulkImportType('designers'); setBulkImportText(''); setMoreMenuOpen(false); }}
                    >
                      <Upload size={15} className="text-gray-400" />
                      批量添加设计人员
                    </button>
                    <button
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => { setBulkImportType('users'); setBulkImportText(''); setMoreMenuOpen(false); }}
                    >
                      <Upload size={15} className="text-gray-400" />
                      批量添加登录用户
                    </button>
                    <div className="my-1 h-px bg-gray-100" />
                    <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">初始化（一次性）</p>
                    <button
                      type="button"
                      className={MENU_ITEM}
                      disabled={!canInitializeDesigners}
                      title={!isSuperAdmin ? '仅超级管理员可使用' : designers.length > 0 ? '设计人员为空时可初始化' : '初始化设计人员'}
                      onClick={() => { setMoreMenuOpen(false); handleInitializeDesigners(); }}
                    >
                      <UserPlus size={15} className="text-gray-400" />
                      {initializingDesigners ? '初始化中...' : '初始化设计人员'}
                    </button>
                    <button
                      type="button"
                      className={MENU_ITEM}
                      disabled={!canInitializeUsers}
                      title={!isSuperAdmin ? '仅超级管理员可使用' : !canInitializeUsers ? '仅剩超级管理员账号时可初始化' : '初始化登录用户'}
                      onClick={() => { setMoreMenuOpen(false); handleInitializeUsers(); }}
                    >
                      <UserPlus size={15} className="text-gray-400" />
                      {initializingUsers ? '初始化中...' : '初始化登录用户'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 工具栏：搜索、筛选与结果计数 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={activeTab === 'designers' ? designerQuery : userQuery}
              onChange={(e) => (activeTab === 'designers' ? setDesignerQuery(e.target.value) : setUserQuery(e.target.value))}
              placeholder={activeTab === 'designers' ? '搜索姓名 / 分组' : '搜索姓名 / 用户名'}
              className="h-9 w-60 rounded-lg border border-gray-200 bg-white pl-9 pr-8 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            {(activeTab === 'designers' ? designerQuery : userQuery) && (
              <button
                type="button"
                onClick={() => (activeTab === 'designers' ? setDesignerQuery('') : setUserQuery(''))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="清除搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {activeTab === 'designers' ? (
            <select
              value={designerGroup}
              onChange={(e) => setDesignerGroup(e.target.value)}
              className="h-9 cursor-pointer rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">全部分组</option>
              {designerGroupOptions.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          ) : (
            <select
              value={userRoleFilter}
              onChange={(e) => setUserRoleFilter(e.target.value as 'all' | 'admin' | 'user' | 'disabled')}
              className="h-9 cursor-pointer rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">全部角色</option>
              <option value="admin">一般管理员</option>
              <option value="user">普通用户</option>
              <option value="disabled">已禁用</option>
            </select>
          )}

          <span className="ml-auto text-xs font-medium text-gray-500">
            {isFiltered ? `筛选出 ${activeRows} / 共 ${activeTotal} 条` : `共 ${activeTotal} 条`}
          </span>
        </div>

        {/* 批量操作条：仅在选中后出现，避免常驻按钮挤占头部 */}
        {activeTab === 'designers' && selectedDesignerIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
            <span className="text-xs font-bold text-blue-700">已选 {selectedDesignerIds.length} 位设计人员</span>
            <button
              type="button"
              onClick={handleBatchDeleteDesigners}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-red-600 ring-1 ring-inset ring-red-200 transition hover:bg-red-50"
            >
              <Trash2 size={13} />
              批量移除
            </button>
            <button
              type="button"
              onClick={() => setSelectedDesignerIds([])}
              className="ml-auto text-xs font-bold text-blue-700 transition hover:text-blue-900"
            >
              取消选择
            </button>
          </div>
        )}

        {activeTab === 'users' && selectedUserIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
            <span className="text-xs font-bold text-blue-700">已选 {selectedUserIds.length} 个账号</span>
            {/* 批量重置密码为超级管理员专属：一般管理员不展示，避免出现点了无响应的按钮 */}
            {isSuperAdmin && (
              <button
                type="button"
                onClick={handleBatchResetPassword}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-50"
              >
                <Key size={13} />
                批量重置密码
              </button>
            )}
            <button
              type="button"
              onClick={() => handleBatchToggleDisabled(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-50"
            >
              <ToggleLeft size={13} />
              批量禁用
            </button>
            <button
              type="button"
              onClick={() => handleBatchToggleDisabled(false)}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200 transition hover:bg-emerald-50"
            >
              <ToggleRight size={13} />
              批量启用
            </button>
            <button
              type="button"
              onClick={handleBatchDeleteUsers}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-red-600 ring-1 ring-inset ring-red-200 transition hover:bg-red-50"
            >
              <Trash2 size={13} />
              批量删除
            </button>
            <button
              type="button"
              onClick={() => setSelectedUserIds([])}
              className="ml-auto text-xs font-bold text-blue-700 transition hover:text-blue-900"
            >
              取消选择
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {activeTab === 'designers' ? (
            filteredDesigners.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                  {designers.length === 0 ? <Users size={22} className="text-blue-600" /> : <Search size={22} className="text-blue-600" />}
                </div>
                {designers.length === 0 ? (
                  <>
                    <p className="text-sm font-bold text-gray-700">还没有设计人员</p>
                    <p className="mt-1 text-xs text-gray-500">添加后会按排序显示在工作台任务表格中</p>
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDrawerMode('designer-add')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                      >
                        <Plus size={16} />
                        添加第一位
                      </button>
                      {canInitializeDesigners && (
                        <button type="button" onClick={handleInitializeDesigners} className={BTN_SECONDARY}>
                          初始化名单
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-gray-700">没有匹配的设计人员</p>
                    <p className="mt-1 text-xs text-gray-500">换个关键词，或清除筛选条件</p>
                    <button
                      type="button"
                      onClick={() => { setDesignerQuery(''); setDesignerGroup('all'); }}
                      className="mt-4 rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                      清除筛选
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="max-h-[calc(100vh-13.5rem)] overflow-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky-thead sticky top-0 z-10 bg-gray-50">
                    <tr className="border-b border-gray-200 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      <th className="w-10 py-2.5 pl-4 pr-0">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                          checked={allFilteredDesignersSelected}
                          onChange={(e) => {
                            const visibleIds = filteredDesigners.map(d => d.id);
                            setSelectedDesignerIds(prev => e.target.checked
                              ? Array.from(new Set([...prev, ...visibleIds]))
                              : prev.filter(id => !visibleIds.includes(id)));
                          }}
                        />
                      </th>
                      <SortHeader label="姓名" sortKey="name" sort={designerSort} onSort={toggleDesignerSort} />
                      <SortHeader label="分组" sortKey="group" sort={designerSort} onSort={toggleDesignerSort} />
                      <th className="w-[120px] px-4 py-2.5 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedDesigners.map(d => (
                      <DesignerRow
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
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : filteredUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                  {users.length === 0 ? <Shield size={22} className="text-blue-600" /> : <Search size={22} className="text-blue-600" />}
                </div>
                {users.length === 0 ? (
                  <>
                    <p className="text-sm font-bold text-gray-700">还没有登录用户</p>
                    <p className="mt-1 text-xs text-gray-500">创建账号后，成员才能登录系统</p>
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDrawerMode('user-add')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                      >
                        <Plus size={16} />
                        新建账号
                      </button>
                      {canInitializeUsers && (
                        <button type="button" onClick={handleInitializeUsers} className={BTN_SECONDARY}>
                          初始化名单
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-gray-700">没有匹配的登录用户</p>
                    <p className="mt-1 text-xs text-gray-500">换个关键词，或清除筛选条件</p>
                    <button
                      type="button"
                      onClick={() => { setUserQuery(''); setUserRoleFilter('all'); }}
                      className="mt-4 rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                      清除筛选
                    </button>
                  </>
                )}
              </div>
          ) : (
            <div className="max-h-[calc(100vh-13.5rem)] overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="sticky-thead sticky top-0 z-10 bg-gray-50">
                  <tr className="border-b border-gray-200 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                    {canManageUsers && (
                      <th className="w-10 py-2.5 pl-4 pr-0">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 disabled:cursor-not-allowed"
                          checked={selectableFilteredUserIds.length > 0 && selectableFilteredUserIds.every(id => selectedUserIds.includes(id))}
                          onChange={(e) => {
                            setSelectedUserIds(prev => e.target.checked
                              ? Array.from(new Set([...prev, ...selectableFilteredUserIds]))
                              : prev.filter(id => !selectableFilteredUserIds.includes(id)));
                          }}
                          disabled={selectableFilteredUserIds.length === 0}
                        />
                      </th>
                    )}
                    <SortHeader label="姓名" sortKey="name" sort={userSort} onSort={toggleUserSort} />
                    <th className="px-3 py-2.5">用户名</th>
                    <SortHeader label="角色" sortKey="role" sort={userSort} onSort={toggleUserSort} />
                    <SortHeader label="状态" sortKey="status" sort={userSort} onSort={toggleUserSort} />
                    <th className="w-[152px] px-4 py-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedUsers.map(u => (
                    <tr key={u.id} className={`group transition-colors hover:bg-blue-50/40 ${u.disabled ? 'bg-gray-50/70' : ''}`}>
                      {canManageUsers && (
                        <td className="w-10 py-2.5 pl-4 pr-0">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-40"
                            checked={selectedUserIds.includes(u.id)}
                            onChange={(e) => {
                              setSelectedUserIds(prev => e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id));
                            }}
                            disabled={u.id === currentUser?.id || u.role === 'superadmin' || !canManageTarget(u)}
                          />
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            u.disabled ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-700'
                          }`}>{u.name.slice(0, 1)}</span>
                          <span className={`truncate font-semibold ${u.disabled ? 'text-gray-400' : 'text-gray-800'}`}>{u.name}</span>
                          {u.id === currentUser?.id && (
                            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">当前登录</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{u.username}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ring-1 ring-inset ${
                          u.role === 'superadmin'
                            ? 'bg-red-50 text-red-700 ring-red-200'
                            : u.role === 'admin'
                              ? 'bg-blue-50 text-blue-700 ring-blue-200'
                              : 'bg-gray-50 text-gray-600 ring-gray-200'
                        }`}>
                          <Shield size={11} />
                          {getRoleLabel(u.role)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.disabled ? 'text-amber-600' : 'text-emerald-600'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.disabled ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                          {u.disabled ? '已禁用' : '正常'}
                        </span>
                      </td>
                      <td className="w-[152px] px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {canManageUsers && u.id !== currentUser?.id && u.role !== 'superadmin' && canManageTarget(u) && (
                            <button
                              onClick={() => handleToggleUserDisabled(u.id)}
                              className={`rounded-md p-1.5 transition ${
                                u.disabled
                                  ? 'text-emerald-600 hover:bg-emerald-50'
                                  : 'text-gray-400 hover:bg-amber-50 hover:text-amber-600'
                              }`}
                              title={u.disabled ? '启用账号' : '禁用账号'}
                            >
                              {u.disabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                            </button>
                          )}
                          {isSuperAdmin && u.role !== 'superadmin' && (
                            <button
                              onClick={() => handleSetRole(u.id)}
                              className="rounded-md p-1.5 text-gray-400 transition hover:bg-blue-50 hover:text-blue-600"
                              title="设置权限"
                            >
                              <Settings size={16} />
                            </button>
                          )}
                          {/* 重置密码：他人账号限非超管；本人账号始终可重置，作为超管自助改密的唯一入口 */}
                          {isSuperAdmin && (u.role !== 'superadmin' || u.id === currentUser?.id) && (
                            <button
                              onClick={() => handleResetPassword(u.id)}
                              className="rounded-md p-1.5 text-gray-400 transition hover:bg-blue-50 hover:text-blue-600"
                              title={u.id === currentUser?.id ? '修改我的密码' : '重置密码'}
                            >
                              <Key size={16} />
                            </button>
                          )}
                          {canManageUsers && u.id !== currentUser?.id && u.role !== 'superadmin' && canManageTarget(u) && (
                            <button
                              onClick={() => handleDeleteUser(u.id)}
                              className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                              title="删除账号"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          {/* 同级或更高权限账号：一般管理员无可用操作，用一条淡色占位说明原因 */}
                          {canManageUsers && !isSuperAdmin && u.id !== currentUser?.id && u.role !== 'superadmin' && !canManageTarget(u) && (
                            <span
                              className="select-none px-1.5 text-[11px] font-bold text-gray-300"
                              title="只能操作权限低于自己的账号（普通用户）"
                            >
                              —
                            </span>
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

        {/* 右侧抽屉：新增设计人员 / 编辑设计人员 / 新增登录用户共用 */}
        {drawerMode && (
          <div className="fixed inset-0 z-[55] flex justify-end">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => { if (!bulkImportSubmitting) setDrawerMode(null); }}
            />
            <aside className="relative flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-gray-800">
                    {drawerMode === 'user-add' ? <Shield size={17} className="text-blue-600" /> : <UserPlus size={17} className="text-blue-600" />}
                    {drawerTitle}
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">{drawerHint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerMode(null)}
                  className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                  aria-label="关闭"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5">
                {drawerMode === 'user-add' ? (
                  <form id="admin-user-form" onSubmit={handleCreateUser} className="space-y-4">
                    <div>
                      <label className={FIELD_LABEL}>显示姓名</label>
                      <input
                        type="text"
                        className={FIELD_INPUT}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="例如：管理员A"
                        required
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>登录用户名</label>
                      <input
                        type="text"
                        className={FIELD_INPUT}
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        onBlur={() => {
                          if (newUsername.trim() && !newPassword) {
                            setNewPassword(generateRandomPassword());
                          }
                        }}
                        placeholder="登录账号"
                        required
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>登录密码</label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          className={`${FIELD_INPUT} pr-20`}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="输入用户名后自动生成"
                          required
                        />
                        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
                            title={showNewPassword ? '隐藏' : '显示'}
                            onClick={() => setShowNewPassword(v => !v)}
                          >
                            {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                          <button
                            type="button"
                            className="rounded p-1.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
                            title="重新生成随机密码"
                            onClick={() => setNewPassword(generateRandomPassword())}
                          >
                            <RefreshCw size={15} />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] text-gray-400">
                        {newPassword ? '已生成随机密码，可直接创建或手动修改' : '清空用户名重新输入会自动生成'}
                      </p>
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>角色权限</label>
                      <select
                        className={`${FIELD_INPUT} cursor-pointer`}
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
                      >
                        {isSuperAdmin && <option value="admin">一般管理员</option>}
                        <option value="user">普通用户</option>
                      </select>
                    </div>
                  </form>
                ) : (
                  <form
                    id="admin-designer-form"
                    onSubmit={drawerMode === 'designer-edit'
                      ? (e) => { e.preventDefault(); handleSaveDesigner(); }
                      : handleCreateDesigner}
                    className="space-y-4"
                  >
                    <div>
                      <label className={FIELD_LABEL}>人员姓名</label>
                      <input
                        type="text"
                        className={FIELD_INPUT}
                        value={drawerMode === 'designer-edit' ? editingDesignerName : newDesignerName}
                        onChange={(e) => (drawerMode === 'designer-edit'
                          ? setEditingDesignerName(e.target.value)
                          : setNewDesignerName(e.target.value))}
                        placeholder="例如：张三"
                        autoFocus
                        required
                      />
                    </div>
                    <div>
                      <label className={FIELD_LABEL}>所属分组</label>
                      <input
                        type="text"
                        className={FIELD_INPUT}
                        value={drawerMode === 'designer-edit' ? editingDesignerGroup : newDesignerGroup}
                        onChange={(e) => (drawerMode === 'designer-edit'
                          ? setEditingDesignerGroup(e.target.value)
                          : setNewDesignerGroup(e.target.value))}
                        placeholder="例如：设计一课"
                      />
                      <p className="mt-1.5 text-[11px] text-gray-400">分组会显示在列表与工作台的成员标签上</p>
                    </div>
                    {designerGroupOptions.length > 0 && (
                      <div>
                        <label className={FIELD_LABEL}>已有分组</label>
                        <div className="flex flex-wrap gap-1.5">
                          {designerGroupOptions.map(g => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => (drawerMode === 'designer-edit' ? setEditingDesignerGroup(g) : setNewDesignerGroup(g))}
                              className="rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200 transition hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200"
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </form>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
                <button type="button" onClick={() => setDrawerMode(null)} className={BTN_SECONDARY}>取消</button>
                <button
                  type="submit"
                  form={drawerMode === 'user-add' ? 'admin-user-form' : 'admin-designer-form'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 active:scale-[0.98]"
                >
                  {drawerMode === 'designer-edit' ? '保存修改' : drawerMode === 'user-add' ? '创建用户' : '添加人员'}
                </button>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* 禁用/启用确认弹窗（单个与批量通用，应用内居中，替代浏览器原生 confirm） */}
      {disableConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 px-6 py-5">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${disableConfirm.disabled ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                {disableConfirm.disabled
                  ? <ToggleLeft size={20} className="text-amber-600" />
                  : <ToggleRight size={20} className="text-emerald-600" />}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-gray-800">
                  {disableConfirm.ids.length > 1
                    ? (disableConfirm.disabled ? '确认批量禁用账号' : '确认批量启用账号')
                    : (disableConfirm.disabled ? '确认禁用账号' : '确认启用账号')}
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  {disableConfirm.ids.length > 1
                    ? <>将{disableConfirm.disabled ? '禁用' : '启用'}选中的 <span className="font-bold text-gray-800">{disableConfirm.ids.length}</span> 个账号
                        {disableConfirmTargets.length > 0 && (
                          <span className="text-gray-500">
                            （{disableConfirmTargets.slice(0, 3).map(u => u.name).join('、')}
                            {disableConfirmTargets.length > 3 ? ` 等 ${disableConfirmTargets.length} 人` : ''}）
                          </span>
                        )}
                        。</>
                    : <>将{disableConfirm.disabled ? '禁用' : '启用'}账号 <span className="font-bold text-gray-800">{disableConfirmTargets[0]?.name || '该账号'}</span>
                        {disableConfirmTargets[0]?.username && <span className="font-mono text-xs text-gray-500">（{disableConfirmTargets[0].username}）</span>}。</>}
                </p>
                <p className={`mt-2 text-xs font-bold ${disableConfirm.disabled ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {disableConfirm.disabled
                    ? '禁用后该账号立即无法登录，已登录会话在下一次请求即被拒绝。'
                    : '启用后该账号可立即恢复登录，权限保持不变。'}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setDisableConfirm(null)}
                disabled={disableSubmitting}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => runToggleDisabled(disableConfirm.ids, disableConfirm.disabled)}
                disabled={disableSubmitting}
                className={`rounded-lg px-4 py-2 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  disableConfirm.disabled ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {disableSubmitting ? '处理中…' : (disableConfirm.disabled ? '确认禁用' : '确认启用')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗（登录用户/设计人员共用，单个与批量通用，应用内居中，替代浏览器原生 confirm） */}
      {batchDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-5 flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-800">
                  {batchDeleteConfirm.kind === 'users'
                    ? batchDeleteConfirm.ids.length === 1 ? '确认删除登录用户' : '确认批量删除登录用户'
                    : batchDeleteConfirm.ids.length === 1 ? '确认移除设计人员' : '确认批量移除设计人员'}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {batchDeleteConfirm.kind === 'users'
                    ? batchDeleteConfirm.ids.length === 1
                      ? <>将删除该登录用户账号。</>
                      : <>将删除选中的 <span className="font-bold text-gray-800">{batchDeleteConfirm.ids.length}</span> 个登录用户账号。</>
                    : batchDeleteConfirm.ids.length === 1
                      ? <>将从表格中移除该设计人员。</>
                      : <>将从表格中移除选中的 <span className="font-bold text-gray-800">{batchDeleteConfirm.ids.length}</span> 位设计人员。</>}
                </p>
                <p className="text-xs text-red-600 font-bold mt-2">
                  {batchDeleteConfirm.kind === 'users'
                    ? '删除后账号无法恢复，请确认无误后操作。'
                    : '其任务数据将保留在数据库中但不再显示。'}
                </p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBatchDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-bold hover:bg-gray-100 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const { kind, ids } = batchDeleteConfirm;
                  setBatchDeleteConfirm(null);
                  if (kind === 'users') runBatchDeleteUsers(ids);
                  else runBatchDeleteDesigners(ids);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition"
              >
                {batchDeleteConfirm.kind === 'users' ? '确认删除' : '确认移除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 初始化设计人员确认弹窗（应用内居中，替代浏览器原生 confirm） */}
      {confirmInitDesigners && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-5 flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertCircle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-800">确认初始化设计人员</h3>
                <p className="text-sm text-gray-600 mt-1">
                  将为 <span className="font-bold text-gray-800">{initialDesigners.length}</span> 位设计人员创建任务表条目。
                </p>
                <p className="text-xs text-red-600 font-bold mt-2">仅可在设计人员为空时执行，请确认当前没有已有数据。</p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmInitDesigners(false)}
                className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-bold hover:bg-gray-100 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmInitDesigners(false);
                  runInitializeDesigners();
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition"
              >
                确认初始化
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 初始化登录用户确认弹窗（应用内居中，替代浏览器原生 confirm） */}
      {confirmInitUsers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-5 flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertCircle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-800">确认初始化登录用户</h3>
                <p className="text-sm text-gray-600 mt-1">
                  将为 <span className="font-bold text-gray-800">{initialLoginUsers.length}</span> 个登录用户创建账号。
                </p>
                <p className="text-xs text-red-600 font-bold mt-2">初始密码将随机生成且仅展示一次，关闭后无法再次查看，请提前准备保存方式。</p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmInitUsers(false)}
                className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-bold hover:bg-gray-100 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmInitUsers(false);
                  runInitializeUsers();
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition"
              >
                确认初始化
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 初始密码一次性展示弹窗（置于 main 外，避免 space-y-8 的 margin-top 使遮罩下移偏离视口中心） */}
      {initialCredentials.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Key size={18} className="text-emerald-600" /> {credentialMeta.title}
                </h3>
                <p className="text-xs text-red-600 font-bold mt-1">密码仅显示这一次，关闭后无法再次查看，请立即复制并线下分发给本人。</p>
              </div>
              <button
                type="button"
                onClick={() => setInitialCredentials([])}
                className="p-1 text-gray-400 hover:text-gray-700 rounded"
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-[10px] font-black uppercase tracking-widest border-b border-gray-100">
                    <th className="py-2 pr-2 text-left">姓名</th>
                    <th className="py-2 pr-2 text-left">用户名</th>
                    <th className="py-2 pr-2 text-left">{credentialMeta.passwordHeader}</th>
                    <th className="py-2 text-left">结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {initialCredentials.map(c => (
                    <tr key={c.username}>
                      <td className="py-2 pr-2 font-bold text-gray-700">{c.name}</td>
                      <td className="py-2 pr-2 text-gray-500">{c.username}</td>
                      <td className="py-2 pr-2">
                        <code className="px-2 py-0.5 bg-gray-100 rounded text-gray-800 font-bold whitespace-nowrap">{c.password}</code>
                      </td>
                      <td className="py-2">
                        {c.ok
                          ? <span className="text-green-600 text-xs font-bold">{credentialMeta.okLabel}</span>
                          : <span className="text-red-600 text-xs font-bold">失败</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  const text = initialCredentials
                    .filter(c => c.ok)
                    .map(c => `${c.name} ${c.username} ${credentialMeta.copyLabel}:${c.password}`)
                    .join('\n');
                  navigator.clipboard.writeText(text);
                  addToast(credentialMeta.copyToast, 'success');
                }}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200 transition"
              >
                复制全部
              </button>
              <button
                type="button"
                onClick={() => setInitialCredentials([])}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition"
              >
                我已保存，关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
