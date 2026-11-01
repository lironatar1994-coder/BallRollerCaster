@echo off
rem Starts the Ball Coaster game server and opens it in the browser.
cd /d "%~dp0"
start "" http://localhost:5173
node serve.cjs
