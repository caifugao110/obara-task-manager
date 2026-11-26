/* eslint-env node */
/**
 * 后端 ESLint 配置（ESLint 8 legacy 格式，与前端同一版本）
 *
 * 为什么之前没有：后端一直是「跑得起来就算过」，`npm test` 覆盖的是行为，
 * 而 `no-undef`（拼错变量名）、`no-dupe-keys`（重复键）、`require-atomic-updates`
 * 这类**静态**缺陷测试照不到——这类错误的表现通常是「某个分支才报错」，等到线上才发现。
 *
 * 规则集与前端同一原则：只启用「当前代码库能通过」且能真实反映缺陷的规则，
 * 既有技术债（大量的参数未使用、深层嵌套回调）显式关闭或降级并注明原因，
 * 避免 `--max-warnings 0` 长期不可达而被人整体忽略。
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script', // 后端是 CommonJS，没有 ESM
  },
  extends: ['eslint:recommended'],
  // 运行期产物与第三方包不参与检查：vendor 里的 xlsx 是打包分发件，backups 是运行数据
  ignorePatterns: [
    'node_modules/',
    'vendor/',
    'backups/',
    'tests/.tmp/',
    '*.min.js',
  ],
  rules: {
    // ---- 降级/关闭：既有技术债，逐个修是独立工程 ----
    // 大量 `(req, res)` 里只用到 res、回调签名必须凑参数位数，未使用参数是常态而非缺陷
    'no-unused-vars': ['warn', {
      args: 'none',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],
    // 空 catch 在本仓库是刻意的「吞掉但继续」写法（探测、清理、可选字段解析），
    // 而且调用处都写了注释说明为什么可以吞
    'no-empty': ['error', { allowEmptyCatch: true }],
    // console 是后端唯一的日志通道（写文件由 pm2/watchdog 侧重定向），不能禁
    'no-console': 'off',
    // `while (true) { ... break }` 是流式读取的正当写法
    'no-constant-condition': ['error', { checkLoops: false }],

    // ---- 开启：能真实反映缺陷 ----
    eqeqeq: ['error', 'smart'],
    'no-var': 'error',
    'prefer-const': ['warn', { ignoreReadBeforeAssign: true }],
    // 重复的对象字面量键：后写的静默覆盖前面的，是典型的复制粘贴事故
    'no-dupe-keys': 'error',
    // 正则里的空字符类 / 无效转义这类问题在 SQL 匹配里很容易写错
    'no-useless-escape': 'warn',
    // ANSI 转义序列清洗（systemMonitor 剥日志颜色）必须匹配 \x1b，不是笔误
    'no-control-regex': 'off',
    // 把 Promise 当同步值用（漏 await）在异步路由里会造成「接口先返回、写库还在跑」
    'require-atomic-updates': 'off', // 本仓库的写队列是显式设计，该规则会大量误报
  },
  overrides: [
    {
      // 测试脚本允许更长、更随意的写法：prepare/teardown 里有大量一次性表达式
      files: ['tests/**/*.js'],
      rules: {
        'no-unused-vars': 'off',
      },
    },
    {
      // 仕样 PDF 定位/解析是 2024 年留下的老代码（specSource 是它的一部分，从 routes/spec.js 搬出来的），全篇 var + 同名变量重复声明（函数作用域里
      // 靠 var 提升工作）。逐条改成 let/const 会与 no-redeclare 冲突，属于独立重构；
      // 这两个文件的其他规则仍然生效（id 拼错、重复键照样报）
      files: ['routes/spec.js', 'utils/specPdfParser.js', 'utils/specSource.js'],
      rules: {
        'no-var': 'off',
        'no-redeclare': 'off',
      },
    },
    {
      // tests/pdf 下是排查 PDF 解析问题时的临时脚本，不参与生产构建
      files: ['tests/pdf/**/*.js'],
      rules: {
        'no-var': 'off',
        'no-redeclare': 'off',
      },
    },
  ],
};
