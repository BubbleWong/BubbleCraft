module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true
  },
  extends: ['standard'],
  parserOptions: {
    sourceType: 'module'
  },
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }]
  },
  globals: {
    BABYLON: 'readonly'
  }
};
