const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');
const securityConfig = require('./config/security');

// 使用 Sequelize 连接 SQLite 数据库
const dbPath = path.resolve(__dirname, securityConfig.database.sqlitePath || './database.sqlite');
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});

// 定义用户模型
const User = sequelize.define('User', {
  id: { type: DataTypes.STRING, primaryKey: true },
  username: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, defaultValue: 'user' },
  name: { type: DataTypes.STRING },
  group: { type: DataTypes.STRING, defaultValue: '' },
  disabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  forcePasswordChange: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// 定义设计师模型
const Designer = sequelize.define('Designer', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  group: { type: DataTypes.STRING },
  role: { type: DataTypes.STRING }
});

// 定义任务表模型 (对应之前的 sheet)
const TaskSheet = sequelize.define('TaskSheet', {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },
  year: { type: DataTypes.INTEGER, allowNull: false },
  month: { type: DataTypes.INTEGER, allowNull: false },
  days: { type: DataTypes.JSON, defaultValue: {} } // 存储每日任务明细
});

// 定义登录日志模型
const LoginLog = sequelize.define('LoginLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.STRING },
  username: { type: DataTypes.STRING },
  ip: { type: DataTypes.STRING },
  userAgent: { type: DataTypes.STRING },
  timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// 定义设置模型
const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.JSON }
});

// 初始化数据库
const initDb = async () => {
  await sequelize.sync();
  
  // 初始化默认设置
  const defaultSettings = {
    leaderboard: { enabled: true, allowAdmins: true, allowViewers: false },
    workHours: { enabled: true, allowAdmins: true, allowViewers: false },
    statusTracking: { enabled: true, allowAdmins: true, allowViewers: false },
    systemSettings: { enabled: true, allowAdmins: true, allowViewers: false },
    workdayOverrides: {},
    system: { 
      allowGuestView: true, 
      allowMultiDevice: true, 
      allowUserDesignPlanColorMark: true, 
      allowUserEditOwnTaskColor: true 
    },
    _migrations: { forcePasswordChangeMigrated: true }
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    const [setting, created] = await Setting.findOrCreate({
      where: { key },
      defaults: { value }
    });
  }
};

// 兼容旧代码的 readDb 和 writeDb 函数
let cachedDb = null;

const readDb = () => {
  // 由于旧代码大量使用同步 readDb，我们这里返回一个代理或之前的缓存
  // 但为了真正的 SQLite 迁移，我们需要重构路由。
  // 暂时提供一个同步获取缓存的方法，并在初始化时加载
  return cachedDb;
};

const refreshCache = async () => {
  const users = await User.findAll();
  const tasks = await TaskSheet.findAll();
  const designers = await Designer.findAll();
  const loginLogs = await LoginLog.findAll();
  const settingsRecords = await Setting.findAll();
  
  const settings = {};
  settingsRecords.forEach(r => {
    settings[r.key] = r.value;
  });

  cachedDb = {
    users: users.map(u => u.toJSON()),
    tasks: tasks.map(t => t.toJSON()),
    designers: designers.map(d => d.toJSON()),
    loginLogs: loginLogs.map(l => l.toJSON()),
    settings
  };
  return cachedDb;
};

const writeDb = async (data) => {
  if (data.users) {
    for (const u of data.users) {
      await User.upsert(u);
    }
  }
  if (data.tasks) {
    for (const t of data.tasks) {
      await TaskSheet.upsert(t);
    }
  }
  if (data.designers) {
    for (const d of data.designers) {
      await Designer.upsert(d);
    }
  }
  if (data.settings) {
    for (const [key, value] of Object.entries(data.settings)) {
      await Setting.upsert({ key, value });
    }
  }
  await refreshCache();
};

const initAdmin = async () => {
  await initDb();
  await refreshCache();
  const superAdmin = await User.findOne({ where: { role: 'superadmin' } });
  if (!superAdmin) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
    await User.create({
      id: Date.now().toString(),
      username: process.env.DEFAULT_ADMIN_USERNAME || 'superadmin',
      password: hashedPassword,
      role: 'superadmin',
      name: '超级管理员',
      disabled: false,
      forcePasswordChange: true
    });
    await refreshCache();
    console.log(`SuperAdmin account created: ${process.env.DEFAULT_ADMIN_USERNAME || 'superadmin'} / ${defaultPassword}`);
  }
};

module.exports = {
  sequelize,
  User,
  Designer,
  TaskSheet,
  LoginLog,
  Setting,
  readDb,
  writeDb,
  initAdmin,
  initDb
};
