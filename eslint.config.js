import antfu from '@antfu/eslint-config';

export default antfu({
  typescript: true,
  type: 'lib',
  stylistic: {
    semi: true,
    quotes: 'single',
  },
  rules: {
    'no-console': 'error',
    'ts/no-explicit-any': 'error',
  },
  ignores: ['dist/', 'coverage/'],
});
