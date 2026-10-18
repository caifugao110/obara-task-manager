/* eslint-env node */
/**
 * ESLint 配置（ESLint 8 legacy 格式）
 *
 * 说明：仓库此前只声明了 `npm run lint` 脚本，却既没有 ESLint 依赖也没有配置文件，
 * 脚本必然失败。这里补全配置，规则集按「当前代码库能通过」为准绳选取：
 * 只启用能真实反映缺陷的规则，把属于既有技术债（大量 any、useEffect 依赖数组
 * 不完整）的规则显式关闭并注明原因，避免 `--max-warnings 0` 让 lint 长期处于
 * 不可通过状态而被人忽略。
 */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended'
  ],
  ignorePatterns: ['dist', 'node_modules', '*.config.js', '.vite'],
  rules: {
    // ---- 关闭：属于既有技术债，改起来是独立的大工程，不应阻塞 lint ----
    // 全仓约 150 处显式 any（集中在 Dashboard / GunLedger / SystemSettings 巨型组件）
    '@typescript-eslint/no-explicit-any': 'off',
    // 巨型组件的 useEffect 依赖数组普遍不完整，强行修正会改变运行时行为
    'react-hooks/exhaustive-deps': 'off',

    // ---- 开启：能真实反映缺陷 ----
    // 未使用变量/参数是死代码信号（noUnusedLocals 未在 tsconfig 打开，由 lint 兜住）
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_'
    }],
    'no-undef': 'off', // TypeScript 已负责，避免与 TS 内置类型冲突误报
    'no-empty': ['error', { allowEmptyCatch: true }],
    // 关闭循环条件检查：SSE 流式读取常用 `while (true) { ... break }`，是正当写法
    'no-constant-condition': ['error', { checkLoops: false }],
    eqeqeq: ['error', 'smart'],
    'no-var': 'error',
    // ignoreReadBeforeAssign：TS 里 `let timer: number | undefined;` 先被闭包读取、
    // 后赋值的写法，会被 prefer-const 误判为「从未重新赋值」
    'prefer-const': ['warn', { ignoreReadBeforeAssign: true }],
    // 只要求有 default 分支意识，不强制穷尽所有分支
    'consistent-return': 'off'
  }
};
