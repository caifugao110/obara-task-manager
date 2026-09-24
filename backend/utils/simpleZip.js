// 极简 ZIP 打包器：仅使用 STORE（不压缩）方式，零第三方依赖。
// 用于"多个分类导出"场景，把每个分类对应的独立 xls 文件打包为单个 zip 下载。
// 文件名支持中文：通用位标记置 0x0800（UTF-8 名称）。

// CRC32 校验表
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

// DOS 时间/日期（ZIP 规范）
const getDosDateTime = (date = new Date()) => {
  const dosTime = ((date.getHours() & 0x1F) << 11)
    | ((date.getMinutes() & 0x3F) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
  const dosDate = (((date.getFullYear() - 1980) & 0x7F) << 9)
    | (((date.getMonth() + 1) & 0x0F) << 5)
    | (date.getDate() & 0x1F);
  return { dosTime, dosDate };
};

/**
 * 打包文件列表
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {Buffer} zip 文件内容
 */
const createZipBuffer = (entries, now = new Date()) => {
  const { dosTime, dosDate } = getDosDateTime(now);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(String(entry.name), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const crc = crc32(data);
    const size = data.length;

    // ===== 本地文件头 =====
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);   // 签名
    local.writeUInt16LE(20, 4);            // 解压所需版本
    local.writeUInt16LE(0x0800, 6);        // 标记：UTF-8 文件名
    local.writeUInt16LE(0, 8);             // 压缩方式：STORE
    local.writeUInt16LE(dosTime, 10);      // 修改时间
    local.writeUInt16LE(dosDate, 12);      // 修改日期
    local.writeUInt32LE(crc, 14);          // CRC-32
    local.writeUInt32LE(size, 18);         // 压缩后大小
    local.writeUInt32LE(size, 22);         // 原始大小
    local.writeUInt16LE(nameBuffer.length, 26); // 文件名长度
    local.writeUInt16LE(0, 28);            // 扩展字段长度
    localParts.push(local, nameBuffer, data);

    // ===== 中央目录记录 =====
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);  // 签名
    central.writeUInt16LE(20, 4);          // 制作版本
    central.writeUInt16LE(20, 6);          // 解压所需版本
    central.writeUInt16LE(0x0800, 8);      // 标记：UTF-8 文件名
    central.writeUInt16LE(0, 10);          // 压缩方式：STORE
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);          // 扩展字段长度
    central.writeUInt16LE(0, 32);          // 注释长度
    central.writeUInt16LE(0, 34);          // 起始磁盘号
    central.writeUInt16LE(0, 36);          // 内部属性
    central.writeUInt32LE(0, 38);          // 外部属性
    central.writeUInt32LE(offset, 42);     // 本地头偏移
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  });

  const centralBuffer = Buffer.concat(centralParts);

  // ===== 中央目录结束记录（EOCD） =====
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);       // 签名
  eocd.writeUInt16LE(0, 4);                // 当前磁盘号
  eocd.writeUInt16LE(0, 6);                // 中央目录起始磁盘
  eocd.writeUInt16LE(entries.length, 8);   // 本磁盘记录数
  eocd.writeUInt16LE(entries.length, 10);  // 总记录数
  eocd.writeUInt32LE(centralBuffer.length, 12); // 中央目录大小
  eocd.writeUInt32LE(offset, 16);          // 中央目录偏移
  eocd.writeUInt16LE(0, 20);               // 注释长度

  return Buffer.concat([...localParts, centralBuffer, eocd]);
};

module.exports = { createZipBuffer };
