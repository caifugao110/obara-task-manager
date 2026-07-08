const fs = require('fs');
const path = require('path');
const { User, Designer, TaskSheet, Setting, initDb } = require('./db');
const securityConfig = require('./config/security');

const jsonDbPath = path.resolve(__dirname, securityConfig.database.path);

const migrate = async () => {
  try {
    console.log('Starting migration...');
    await initDb();

    if (!fs.existsSync(jsonDbPath)) {
      console.log('No JSON database found, skipping migration.');
      return;
    }

    const data = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
    console.log('JSON database loaded.');

    // 迁移用户
    if (data.users && Array.isArray(data.users)) {
      console.log(`Migrating ${data.users.length} users...`);
      for (const u of data.users) {
        await User.upsert(u);
      }
    }

    // 迁移设计师
    if (data.designers && Array.isArray(data.designers)) {
      console.log(`Migrating ${data.designers.length} designers...`);
      for (const d of data.designers) {
        await Designer.upsert(d);
      }
    }

    // 迁移任务
    if (data.tasks && Array.isArray(data.tasks)) {
      console.log(`Migrating ${data.tasks.length} task sheets...`);
      for (const t of data.tasks) {
        await TaskSheet.upsert(t);
      }
    }

    // 迁移设置
    if (data.settings) {
      console.log('Migrating settings...');
      for (const [key, value] of Object.entries(data.settings)) {
        await Setting.upsert({ key, value });
      }
    }

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

migrate();
