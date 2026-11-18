#!/usr/bin/env bash
# Puts the learning database's settings into this shell's environment, read from the site's own settings (never printed).
#   source scripts/learn-env.sh      then e.g.   cd api && npm run test:sql
SUB=65c0ccca-69f7-43eb-9246-3bd6a6a06b24; RG=rg-spartanreferee-uksouth
eval "$(az staticwebapp appsettings list --name spartanreferee -g $RG --subscription $SUB -o json --query properties | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);
for(const k of ['LEARN_SQL_SERVER','LEARN_SQL_DATABASE','LEARN_SQL_USER','LEARN_SQL_PASSWORD','LEARN_SPEECH_REGION','LEARN_SPEECH_KEY'])
  if(p[k]) console.log('export '+k+'='+JSON.stringify(p[k]));});")"
