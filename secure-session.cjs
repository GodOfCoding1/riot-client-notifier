'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
function transform(action,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'protect-session.ps1'),'-Action',action],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('session protection unavailable'));},10000);
    child.stdout.on('data',d=>output+=d);child.on('error',()=>{clearTimeout(timer);reject(new Error('session protection unavailable'));});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error('session protection unavailable'));});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
async function load(root=__dirname) {try{return JSON.parse(await transform('Unprotect',fs.readFileSync(path.join(root,'session.dpapi'),'utf8')));}catch{return null;}}
async function save(data,root=__dirname) {const output=await transform('Protect',JSON.stringify(data));const f=path.join(root,'session.dpapi');fs.writeFileSync(f+'.tmp',output,{mode:0o600});fs.renameSync(f+'.tmp',f);}
module.exports={load,save};
