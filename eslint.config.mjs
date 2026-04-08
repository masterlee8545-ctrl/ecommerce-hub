import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // 헌법: 더미 데이터 금지 (CLAUDE.md §1 P-1)
      'no-warning-comments': [
        'error',
        {
          terms: ['todo', 'fixme', 'xxx', 'hack', 'dummy', 'mock'],
          location: 'anywhere',
        },
      ],
      // 헌법: any 금지 (CLAUDE.md §2 Q4)
      '@typescript-eslint/no-explicit-any': 'error',
      // 헌법: ts-ignore 금지 (CLAUDE.md §2 Q4)
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      // 사용하지 않는 코드 금지
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // import 정렬
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          pathGroups: [
            {
              pattern: 'react',
              group: 'external',
              position: 'before',
            },
            {
              pattern: 'next/**',
              group: 'external',
              position: 'before',
            },
            {
              pattern: '@/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['react', 'next/**'],
        },
      ],
      // 콘솔 사용 제한 (warn/error만 허용)
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // 매직 넘버 경고 (DB ID, 인덱스, 시간 상수 제외)
      'no-magic-numbers': [
        'warn',
        {
          ignore: [-1, 0, 1, 2, 100, 1000],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
    },
  },
  {
    // 테스트 파일은 일부 룰 완화
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**/*'],
    rules: {
      'no-warning-comments': 'off',
      'no-magic-numbers': 'off',
    },
  },
  {
    // 설정 파일은 일부 룰 완화
    files: [
      '*.config.ts',
      '*.config.mjs',
      '*.config.js',
      'drizzle.config.ts',
    ],
    rules: {
      'no-magic-numbers': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      'public/**',
      'drizzle/migrations/**',
    ],
  },
];

export default config;
