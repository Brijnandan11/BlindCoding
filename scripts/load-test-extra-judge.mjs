import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,createWriteStream} from 'node:fs';
for(const f of ['.env.local','.env']) if(existsSync(f)) process.loadEnvFile(f);
const stamp=process.argv[2];
if(!/^\d{14}$/.test(stamp||'')) throw new Error('Expected an isolated test timestamp');
const dir=`artifacts/load-tests/${stamp}`;
const report=JSON.parse(readFileSync(`${dir}/report.json`,'utf8'));
if(report.storage!=='postgres'||!report.tableId.startsWith('load-'+stamp)) throw new Error('Refusing non-test data');
const inspect=name=>JSON.parse(spawnSync('docker',['inspect',name],{encoding:'utf8'}).stdout)[0];
const database=inspect('bc-load-pg-'+stamp), cache=inspect('bc-load-'+stamp);
const password=database.Config.Env.find(v=>v.startsWith('POSTGRES_PASSWORD=')).slice(18);
const port=database.NetworkSettings.Ports['5432/tcp'][0].HostPort;
const redisPort=cache.NetworkSettings.Ports['6379/tcp'][0].HostPort;
const env={...process.env,DATABASE_URL:`postgres://postgres:${password}@127.0.0.1:${port}/postgres`,STORE_TABLE_ID:report.tableId,REDIS_URL:`redis://127.0.0.1:${redisPort}`,JUDGE_CONCURRENCY:process.argv[3] || '4',JUDGE_TIMINGS:'true',JUDGE_IMAGE:process.argv[4] || process.env.JUDGE_IMAGE || 'blind-coding-sandbox'};
const log=createWriteStream(`${dir}/judge-extra-${process.pid}.log`);
const child=spawn(process.execPath,['scripts/run.mjs','judge'],{env,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log);child.stderr.pipe(log);
const {Queue}=await import('bullmq');
const queue=new Queue('blind-judge',{connection:{host:'127.0.0.1',port:Number(redisPort)}});
const timer=setInterval(async()=>{
  try {
    const counts=await queue.getJobCounts('waiting','active','delayed');
    if(!counts.waiting&&!counts.active&&!counts.delayed){child.kill('SIGTERM');clearInterval(timer);await queue.close();}
  }catch{child.kill('SIGTERM');clearInterval(timer);await queue.close();}
},5000);
const stop=()=>{clearInterval(timer);child.kill('SIGTERM');queue.close().catch(()=>{});};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('exit',code=>{clearInterval(timer);queue.close().finally(()=>process.exit(code||0));});
console.log('Additional isolated judge started with per-stage timing.');
