module.exports = {
  apps: [{
    name: 'my-budget-backend',
    cwd: __dirname,
    script: './dist/server.js',
    interpreter: process.execPath,
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    autorestart: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 3000,
    // 서버의 최대 10초 종료 처리보다 길게 기다립니다.
    kill_timeout: 12000,
    time: true,
    // 운영 설정은 저장소 밖의 단일 환경파일에서 읽습니다.
    filter_env: [
      'DATABASE_URL', 'HOST', 'PORT',
      'AUTH_USERNAME', 'AUTH_PASSWORD_HASH', 'AUTH_ORIGIN',
      'DATABASE_RSA_PUBLIC_KEY_FILE', 'DATABASE_TLS_CA_FILE',
    ],
    env: { NODE_ENV: 'production', ENV_FILE: '/etc/my-budget/production.env' },
  }],
};
