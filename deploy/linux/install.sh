#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

EXPECTED_ROOT=/opt/obara/obara-task-manager
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
PROJECT_ROOT="$(realpath "${SCRIPT_DIR}/../..")"
SERVICE_NAME=obara-task-manager.service
APP_USER=obara
APP_GROUP=obara
APP_ROOT=/opt/obara/obara-task-manager
CONFIG_DIR=/etc/obara-task-manager
ENV_FILE="${CONFIG_DIR}/obara.env"
SMB_CREDENTIALS="${CONFIG_DIR}/smb.credentials"
DATA_DIR=/var/lib/obara-task-manager
TARGET_DB="${DATA_DIR}/data.db"
WEB_DIR=/var/www/obara-task-manager
SPEC_MOUNT=/mnt/obara/spec
SCHEDULE_MOUNT=/mnt/obara/schedule
SOURCE_ENV="${PROJECT_ROOT}/backend/.env"
SOURCE_DB="${PROJECT_ROOT}/backend/data.db"
TEMP_FILES=()

log() {
  printf '[linux-install] %s\n' "$*"
}

fail() {
  printf '[linux-install] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local file
  for file in "${TEMP_FILES[@]:-}"; do
    [[ -n "$file" && -f "$file" ]] && rm -f -- "$file"
  done
}
trap cleanup EXIT

port_in_use() {
  [[ -n "$(ss -ltnH "( sport = :$1 )")" ]]
}

[[ ${EUID} -eq 0 ]] || fail '请使用 sudo bash deploy/linux/install.sh 执行。'
[[ "$PROJECT_ROOT" == "$EXPECTED_ROOT" ]] || fail "项目必须位于 ${EXPECTED_ROOT}，当前为 ${PROJECT_ROOT}。"
[[ -f "$SOURCE_ENV" ]] || fail "缺少 ${SOURCE_ENV}。"
[[ -f "$SOURCE_DB" ]] || fail "缺少数据快照 ${SOURCE_DB}。"
[[ -f "${SCRIPT_DIR}/obara-task-manager.service" ]] || fail '缺少 systemd 配置。'
[[ -f "${SCRIPT_DIR}/nginx.conf" ]] || fail '缺少 Nginx 配置。'

if port_in_use 5000 && ! systemctl is-active --quiet "$SERVICE_NAME"; then
  fail '5000 端口已被其他进程占用。'
fi
if port_in_use 5173 && [[ ! -L /etc/nginx/sites-enabled/obara-task-manager ]]; then
  fail '5173 端口已被其他进程占用。'
fi

log '安装 Node.js、npm、Nginx 和 CIFS 工具。'
export DEBIAN_FRONTEND=noninteractive
apt-get update
# 宿主机的 Chrome 已处于 unpacked 状态；先补齐 fonts-liberation 等既有依赖。
# 已用 apt-get -s 验证：该修复只新增字体包并完成 Chrome 配置，不卸载软件包。
apt-get -y --fix-broken install
apt-get install -y nodejs npm nginx cifs-utils

# 版本下限统一由 tools/check-node-version.js 判定（22.3，取依赖交集），避免三处规则各写一遍走味。
node "${PROJECT_ROOT}/tools/check-node-version.js" --quiet \
  || fail 'Node.js 版本必须不低于 22.3（详见上方提示）。'
npm -v >/dev/null

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

install -d -o root -g "$APP_GROUP" -m 0750 "$CONFIG_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$DATA_DIR"
install -d -o root -g root -m 0755 /var/www
install -d -o root -g root -m 0755 "$WEB_DIR"
install -d -o root -g root -m 0755 /mnt/obara
install -d -o root -g "$APP_GROUP" -m 0750 "$SPEC_MOUNT" "$SCHEDULE_MOUNT"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$APP_ROOT/logs" "$APP_ROOT/backend/backups"

log '以原项目用户安装依赖并执行测试、lint 和生产构建。'
runuser -u gaojian -- env HOME=/home/gaojian npm --prefix "$PROJECT_ROOT" ci
runuser -u gaojian -- env HOME=/home/gaojian node -e \
  "const req=require('module').createRequire('${PROJECT_ROOT}/backend/server.js'); req('better-sqlite3');" \
  || fail 'better-sqlite3 Linux 原生模块加载失败。'
runuser -u gaojian -- env HOME=/home/gaojian npm --prefix "$PROJECT_ROOT" test
# Dashboard 中已有 2 条与本次部署无关的未使用变量警告；仍执行完整 ESLint，错误和新增警告会失败。
runuser -u gaojian -- env HOME=/home/gaojian npm --prefix "$PROJECT_ROOT/frontend" run lint -- --max-warnings 2
# 前端 base 默认即为根路径（与 Windows 的 npm run dev 一致），此处不再覆盖。
# 产物校验兼作护栏：若默认 base 将来被子路径化，这里会立刻失败而不是静默白屏。
runuser -u gaojian -- env HOME=/home/gaojian npm --prefix "$PROJECT_ROOT" run build
[[ -f "$PROJECT_ROOT/frontend/dist/index.html" ]] || fail '前端构建产物不完整。'
grep -q 'src="/assets/' "$PROJECT_ROOT/frontend/dist/index.html" \
  || fail '前端未按根路径构建（index.html 未引用 /assets/），请检查 vite base 与 VITE_BASE 设置。'
find "$WEB_DIR" -mindepth 1 -delete
cp -a "$PROJECT_ROOT/frontend/dist/." "$WEB_DIR/"
chown -R root:root "$WEB_DIR"
chmod -R u=rwX,go=rX "$WEB_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  log '生成独立 Linux 环境配置；源 backend/.env 保持不变。'
  TEMP_ENV="$(mktemp)"
  TEMP_FILES+=("$TEMP_ENV")
  python3 - "$SOURCE_ENV" "$TEMP_ENV" <<'PY'
import re
import secrets
import sys
from pathlib import Path

source, target = sys.argv[1:]
excluded = {
    'NODE_ENV', 'OBARA_HOST', 'PORT', 'SQLITE_DB_PATH', 'CORS_ORIGIN',
    'JWT_SECRET', 'SPEC_SHARE_PATH', 'PRODUCTION_SCHEDULE_PATH',
    'PRODUCTION_SCHEDULE_UNC_USER', 'PRODUCTION_SCHEDULE_UNC_PASSWORD',
    'UNC_CREDENTIALS'
}
preserved = {}
for raw in Path(source).read_text(encoding='utf-8-sig').splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    key = key.strip()
    if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) and key not in excluded:
        preserved[key] = value.strip()
preserved.update({
    'NODE_ENV': 'production',
    'OBARA_HOST': '127.0.0.1',
    'PORT': '5000',
    'TZ': 'Asia/Shanghai',
    'SQLITE_DB_PATH': '/var/lib/obara-task-manager/data.db',
    'CORS_ORIGIN': 'http://192.168.160.42:5173',
    'JWT_SECRET': secrets.token_hex(32),
    'JWT_EXPIRES_IN': preserved.get('JWT_EXPIRES_IN', '3d'),
    'SPEC_SHARE_PATH': '/mnt/obara/spec',
    'PRODUCTION_SCHEDULE_PATH': '/mnt/obara/schedule/各产品大日程.xls'
})
Path(target).write_text(''.join(f'{key}={value}\n' for key, value in preserved.items()), encoding='utf-8')
PY
  install -o root -g "$APP_GROUP" -m 0640 "$TEMP_ENV" "$ENV_FILE"
else
  log '保留已有 Linux 环境配置。'
fi

# 服务账号 obara 与仓库属主不同，Git 2.35+ 会以 dubious ownership 拒绝读取，
# 导致版本检查把 currentVersion 判为「未知」并一直提示有新版本。
python3 - "$ENV_FILE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
required = {
    'GIT_CONFIG_COUNT': '1',
    'GIT_CONFIG_KEY_0': 'safe.directory',
    'GIT_CONFIG_VALUE_0': '/opt/obara/obara-task-manager'
}
lines = [line for line in path.read_text(encoding='utf-8').splitlines()
         if line.split('=', 1)[0].strip() not in required]
lines.extend(f'{key}={value}' for key, value in required.items())
path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
PY

log '生成 root-only CIFS 凭据，不输出账号或密码。'
TEMP_SMB="$(mktemp)"
TEMP_FILES+=("$TEMP_SMB")
python3 - "$SOURCE_ENV" "$TEMP_SMB" <<'PY'
import sys
from pathlib import Path

source, target = sys.argv[1:]
values = {}
for raw in Path(source).read_text(encoding='utf-8-sig').splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    values[key.strip()] = value.strip()
user = values.get('PRODUCTION_SCHEDULE_UNC_USER', '')
password = values.get('PRODUCTION_SCHEDULE_UNC_PASSWORD', '')
if len(user) >= 2 and user[0] == user[-1] and user[0] in ('\"', "'"):
    user = user[1:-1]
if len(password) >= 2 and password[0] == password[-1] and password[0] in ('\"', "'"):
    password = password[1:-1]
if not user or not password or any(c in user + password for c in '\r\n'):
    raise SystemExit('现有 backend/.env 缺少有效的大日程共享账号。')
Path(target).write_text(f'username={user}\npassword={password}\n', encoding='utf-8')
PY
install -o root -g root -m 0600 "$TEMP_SMB" "$SMB_CREDENTIALS"

if [[ ! -f "$TARGET_DB" ]]; then
  log '通过 SQLite 在线备份 API 迁移一致性数据快照。'
  TEMP_DB="$(mktemp "${DATA_DIR}/.data.db.XXXXXX")"
  TEMP_FILES+=("$TEMP_DB")
  python3 - "$SOURCE_DB" "$TEMP_DB" <<'PY'
import sqlite3
import sys

source_path, target_path = sys.argv[1:]
source = sqlite3.connect(f'file:{source_path}?mode=ro', uri=True)
try:
    result = source.execute('PRAGMA integrity_check').fetchone()[0]
    if result != 'ok':
        raise SystemExit(f'源数据库完整性检查失败：{result}')
    target = sqlite3.connect(target_path)
    try:
        source.backup(target)
        result = target.execute('PRAGMA integrity_check').fetchone()[0]
        if result != 'ok':
            raise SystemExit(f'目标数据库完整性检查失败：{result}')
    finally:
        target.close()
finally:
    source.close()
PY
  chown "$APP_USER:$APP_GROUP" "$TEMP_DB"
  chmod 0640 "$TEMP_DB"
  mv "$TEMP_DB" "$TARGET_DB"
else
  log '目标数据库已存在，跳过迁移且不覆盖数据。'
fi

log '写入两条独立只读 CIFS 挂载配置。'
python3 - <<'PY'
from pathlib import Path
import re

path = Path('/etc/fstab')
text = path.read_text(encoding='utf-8')
pattern = re.compile(
    r'\n?# BEGIN OBARA TASK MANAGER LINUX\n.*?# END OBARA TASK MANAGER LINUX\n?',
    re.DOTALL
)
text = pattern.sub('\n', text).rstrip()
block = '''# BEGIN OBARA TASK MANAGER LINUX
//192.168.160.6/仕样书$ /mnt/obara/spec cifs credentials=/etc/obara-task-manager/smb.credentials,ro,iocharset=utf8,uid=obara,gid=obara,file_mode=0440,dir_mode=0550,noexec,nosuid,nodev,_netdev,nofail,noauto 0 0
//192.168.160.70/各产品大日程 /mnt/obara/schedule cifs credentials=/etc/obara-task-manager/smb.credentials,ro,iocharset=utf8,uid=obara,gid=obara,file_mode=0440,dir_mode=0550,noexec,nosuid,nodev,_netdev,nofail,noauto 0 0
# END OBARA TASK MANAGER LINUX'''
path.write_text(f'{text}\n\n{block}\n', encoding='utf-8')
PY

install -o root -g root -m 0644 "${SCRIPT_DIR}/obara-task-manager.service" "/etc/systemd/system/${SERVICE_NAME}"
install -o root -g root -m 0644 "${SCRIPT_DIR}/nginx.conf" /etc/nginx/sites-available/obara-task-manager
ln -sfn /etc/nginx/sites-available/obara-task-manager /etc/nginx/sites-enabled/obara-task-manager
rm -f /etc/nginx/sites-enabled/default
systemctl daemon-reload

log '按当前部署选择跳过 SMB 挂载；共享配置保留为 noauto，后续授权后可启用。'

nginx -t
systemctl enable "$SERVICE_NAME" nginx.service
systemctl restart "$SERVICE_NAME"
systemctl restart nginx.service

log '等待后端与 Nginx 健康检查通过。'
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:5000/api/system/ping >/dev/null \
    && curl -fsS --max-time 3 http://127.0.0.1:5173/api/system/ping >/dev/null; then
    log '部署完成：http://192.168.160.42:5173/'
    exit 0
  fi
  sleep 1
done

journalctl -u "$SERVICE_NAME" -n 30 --no-pager >&2 || true
fail '服务健康检查未通过，请根据上方日志排查。'
