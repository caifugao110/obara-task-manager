const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'db.json');

let isWriting = false;
const writeQueue = [];

const processQueue = async () => {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  const { data, resolve, reject } = writeQueue.shift();
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    resolve();
  } catch (err) {
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
      const initialDb = { users: [], tasks: [] };
      fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2));
      return initialDb;
    }
    const data = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(data);
    const migratedRes = migrateTasksIfNeeded(parsed);
    const normalizedRes = normalizeSheetDatesIfNeeded(migratedRes.db);
    if (migratedRes.migrated || normalizedRes.changed) {
      fs.writeFileSync(dbPath, JSON.stringify(normalizedRes.db, null, 2));
    }
    return normalizedRes.db;
  } catch (err) {
    console.error('Error reading database:', err);
    return { users: [], tasks: [] };
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
  const adminExists = db.users.find(u => u.username === 'admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.users.push({
      id: Date.now().toString(),
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      name: '管理员'
    });
    await writeDb(db);
    console.log('Admin account created: admin / admin123');
  }
};

module.exports = {
  readDb,
  writeDb,
  initAdmin
};
