@echo off
echo Starting Qin Shi Huang App...

start "Qin Shi Huang Backend" cmd /k "cd server && node server.js"

start "Qin Shi Huang Frontend" cmd /k "cd client && npm run dev"

timeout /t 3 /nobreak >nul
start http://localhost:5173

echo Both servers are launching!