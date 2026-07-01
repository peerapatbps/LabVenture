@echo off
title LabVenture Server
echo Starting LabVenture...

cd /d "%~dp0server"
node index.js
