#!/bin/bash
cd ~/techasset
git pull --ff-only origin main
docker compose up --build -d

