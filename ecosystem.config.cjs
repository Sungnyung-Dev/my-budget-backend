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
    // 자격증명과 HOST/PORT는 자식 앱이 프로젝트의 .env에서 직접 읽습니다.
    filter_env: ['DATABASE_URL', 'ENV_FILE', 'HOST', 'PORT'],
    env: { NODE_ENV: 'production' },
  }],
};
