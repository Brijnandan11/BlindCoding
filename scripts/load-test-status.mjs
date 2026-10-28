import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {Pool} from 'pg';
import {Queue} from 'bullmq';
const stamp=process.argv[2];
if(!/^\d{14}$/.test(stamp||'')) throw new Error('Expected test timestamp');
const dir=`artifacts/load-tests/${stamp}`;
const report=JSON.parse(readFileSync(`${dir}/report.json`,'utf8'));
if(report.storage!=='postgres'||!report.tableId.startsWith('load-'+stamp)) throw new Error('Not an isolated PostgreSQL test');
const inspect=name=>JSON.parse(spawnSync('docker',['inspect',name],{encoding:'utf8'}).stdout)[0];
const db=inspect('bc-load-pg-'+stamp),redis=inspect('bc-load-'+stamp);
const password=db.Config.Env.find(v=>v.startsWith('POSTGRES_PASSWORD=')).slice(18);
const port=db.NetworkSettings.Ports['5432/tcp'][0].HostPort,redisPort=redis.NetworkSettings.Ports['6379/tcp'][0].HostPort;
const pool=new Pool({connectionString:`postgres://postgres:${password}@127.0.0.1:${port}/postgres`,max:1});
const queue=new Queue('blind-judge',{connection:{host:'127.0.0.1',port:Number(redisPort)}});
try {
 const statuses=(await pool.query(`SELECT payload->>'status' AS status,payload->>'score' AS score,count(*)::int AS count FROM "${report.tableId}" WHERE kind=$1 GROUP BY 1,2`,['submission'])).rows;
 const counts=await queue.getJobCounts('waiting','active','completed','failed','delayed');
 const result={sampledAt:new Date().toISOString(),statuses,queue:counts};
 writeFileSync(`${dir}/judge-status.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
} finally {await pool.end();await queue.close();}
