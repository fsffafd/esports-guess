@echo off
chcp 65001 >nul
echo ================================
echo   电竞竞猜系统 - 本地启动
echo ================================
echo.

REM Check if .env exists
if not exist .env (
  echo [警告] 未检测到 .env 文件
  echo 本地运行需要创建 .env 文件，包含：
  echo TURSO_DATABASE_URL=你的数据库地址
  echo TURSO_AUTH_TOKEN=你的Token
  echo JWT_SECRET=随便填一串字符
  echo.
  pause
  exit /b 1
)

echo 正在启动服务...
node server.js
pause
