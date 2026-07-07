const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const securityConfig = require('./config/security');

const dbPath = path.resolve(__dirname, securityConfig.database.path);

let isWriting = false;
const writeQueue = [];

const safeJsonStringify = (data) => {
  const seen = new WeakSet();
  return JSON.stringify(data, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    return value;
  }, 2);
};

const processQueue = async () => {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  const { data, resolve, reject } = writeQueue.shift();
  try {
    const jsonString = safeJsonStringify(data);
    if (jsonString.length > 50 * 1024 * 1024) {
      console.error('Database file too large (>50MB), aborting write');
      reject(new Error('Database file too large'));
      return;
    }
    fs.writeFileSync(dbPath, jsonString);
    resolve();
  } catch (err) {
    console.error('Error writing database:', err);
    reject(err);
  } finally {
    isWriting = false;
    processQueue();
  }
};

const migrateTasksIfNeeded = (db) => {
  const tasks = Array.isArray(db.tasks) ? db.tasks : [];
  const hasOld = tasks.some(t => t && typeof t === 'object' && t.hours && !t.days);
  if (!hasOld) return { migrated: false, db };

  const sheetMap = new Map();

  for (const t of tasks) {
    if (!t || typeof t !== 'object') continue;

    if (t.days && typeof t.days === 'object') {
      const key = `${t.userId}::${t.year}::${t.month}`;
      const normalized = {
        id: t.id || `sheet-${t.userId}-${t.year}-${t.month}`,
        userId: t.userId,
        month: t.month,
        year: t.year,
        days: t.days && typeof t.days === 'object' ? t.days : {}
      };
      sheetMap.set(key, normalized);
      continue;
    }

    if (!t.userId || !t.month || !t.year || !t.hours || typeof t.hours !== 'object') continue;

    const key = `${t.userId}::${t.year}::${t.month}`;
    const sheet = sheetMap.get(key) || {
      id: `sheet-${t.userId}-${t.year}-${t.month}`,
      userId: t.userId,
      month: t.month,
      year: t.year,
      days: {}
    };

    for (const [date, rawHours] of Object.entries(t.hours)) {
      if (!sheet.days[date]) sheet.days[date] = [];
      const hours = typeof rawHours === 'number' ? rawHours : (parseFloat(rawHours) || 0);
      sheet.days[date].push({
        id: `${t.id || 'task'}-${date}`,
        taskName: t.taskName || '',
        hours
      });
    }

    sheetMap.set(key, sheet);
  }

  const migratedDb = { ...db, tasks: Array.from(sheetMap.values()) };
  return { migrated: true, db: migratedDb };
};

const normalizeSheetDatesIfNeeded = (db) => {
  const tasks = Array.isArray(db.tasks) ? db.tasks : [];
  let changed = false;

  const normalizedTasks = tasks.map(t => {
    if (!t || typeof t !== 'object' || !t.days || typeof t.days !== 'object') return t;

    const nextDays = {};
    for (const [rawDate, items] of Object.entries(t.days)) {
      const date = typeof rawDate === 'string' && rawDate.length >= 10 ? rawDate.slice(0, 10) : rawDate;
      if (date !== rawDate) changed = true;

      const arr = Array.isArray(items) ? items : [];
      if (!nextDays[date]) nextDays[date] = [];
      nextDays[date] = nextDays[date].concat(arr);
    }

    return { ...t, days: nextDays };
  });

  return { changed, db: changed ? { ...db, tasks: normalizedTasks } : db };
};

const readDb = () => {
  try {
    if (!fs.existsSync(dbPath)) {
      const initialDb = {
        users: [],
        tasks: [],
        designers: [],
        loginLogs: [],
        settings: {
          leaderboard: { enabled: true, allowAdmins: true, allowViewers: false },
          workHours: { enabled: true, allowAdmins: true, allowViewers: false },
          statusTracking: { enabled: true, allowAdmins: true, allowViewers: false },
          systemSettings: { enabled: true, allowAdmins: true, allowViewers: false },
          system: { allowGuestView: true, allowMultiDevice: true, allowUserDesignPlanColorMark: false, allowUserEditOwnTaskColor: false }
        }
      };
      fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2));
      return initialDb;
    }
    const data = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed.designers) parsed.designers = [];
    if (!parsed.settings) parsed.settings = {};
    if (!parsed.settings.leaderboard) parsed.settings.leaderboard = { enabled: true, allowAdmins: true, allowViewers: false };
    if (!parsed.settings.workHours) {
      parsed.settings.workHours = parsed.settings.leaderboard
        ? { ...parsed.settings.leaderboard }
        : { enabled: true, allowAdmins: true, allowViewers: false };
    }
    if (!parsed.settings.statusTracking) {
      parsed.settings.statusTracking = parsed.settings.workHours
        ? { ...parsed.settings.workHours }
        : { enabled: true, allowAdmins: true, allowViewers: false };
    }
    if (!parsed.settings.systemSettings) {
      parsed.settings.systemSettings = { enabled: true, allowAdmins: true, allowViewers: false };
    }
    if (!parsed.settings.system) {
      parsed.settings.system = { allowGuestView: true, allowMultiDevice: true, allowUserDesignPlanColorMark: false, allowUserEditOwnTaskColor: false };
    }
    const allowOwnDesignPlanColor = Boolean(
      parsed.settings.system.allowUserDesignPlanColorMark ||
      parsed.settings.system.allowUserEditOwnTaskColor
    );
    parsed.settings.system.allowUserDesignPlanColorMark = allowOwnDesignPlanColor;
    parsed.settings.system.allowUserEditOwnTaskColor = allowOwnDesignPlanColor;
    if (!parsed.loginLogs) parsed.loginLogs = [];
    
    let migratedUsers = false;
    parsed.users.forEach(u => {
      if (u.forcePasswordChange === undefined) {
        u.forcePasswordChange = false;
        migratedUsers = true;
      }
    });
    
    if (migratedUsers) {
      fs.writeFileSync(dbPath, JSON.stringify(parsed, null, 2));
    }
    
    const migratedRes = migrateTasksIfNeeded(parsed);
    const normalizedRes = normalizeSheetDatesIfNeeded(migratedRes.db);
    if (migratedRes.migrated || normalizedRes.changed) {
      fs.writeFileSync(dbPath, JSON.stringify(normalizedRes.db, null, 2));
    }
    return normalizedRes.db;
  } catch (err) {
    console.error('Error reading database:', err);
    return { users: [], tasks: [], designers: [] };
  }
};

const writeDb = (data) => {
  return new Promise((resolve, reject) => {
    writeQueue.push({ data, resolve, reject });
    processQueue();
  });
};

const initAdmin = async () => {
  const db = readDb();
  const superAdminExists = db.users.find(u => u.username === 'superadmin');
  if (!superAdminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.users.push({
      id: Date.now().toString(),
      username: 'superadmin',
      password: hashedPassword,
      role: 'superadmin',
      name: '超级管理员',
      disabled: false,
      forcePasswordChange: true
    });
    await writeDb(db);
    console.log('SuperAdmin account created: superadmin / admin123');
  }
};

module.exports = {
  readDb,
  writeDb,
  initAdmin
};
