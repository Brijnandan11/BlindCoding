import{spawnSync}from'node:child_process';
import{readFileSync,writeFileSync}from'node:fs';
import{Queue}from'bullmq';
const stamp=process.argv[2];if(!/^\d{14}$/.test(stamp||''))throw new Error('Expected test timestamp');
const dir=`artifacts/load-tests/${stamp}`;const report=JSON.parse(readFileSync(`${dir}/report.json`,'utf8'));if(!report.tableId.startsWith('load-'+stamp))throw new Error('Not an isolated test');
const d=JSON.parse(spawnSync('docker',['inspect','bc-load-'+stamp],{encoding:'utf8'}).stdout)[0];
const port=Number(d.NetworkSettings.Ports['6379/tcp'][0].HostPort);
const q=new Queue('blind-judge',{connection:{host:'127.0.0.1',port}});
try{const jobs=await q.getJobs(['completed'],0,1000);const durations=jobs.map(j=>j.finishedOn-j.processedOn).sort((a,b)=>a-b);const first=Math.min(...jobs.map(j=>j.timestamp));const last=Math.max(...jobs.map(j=>j.finishedOn));const result={jobs:jobs.length,firstEnqueuedAt:new Date(first).toISOString(),lastFinishedAt:new Date(last).toISOString(),totalQueueWallSeconds:(last-first)/1000,processingP50Seconds:durations[Math.floor(durations.length*.5)]/1000,processingP95Seconds:durations[Math.floor(durations.length*.95)]/1000,diagnosticHold:JSON.parse(readFileSync(`${dir}/diagnostic-hold.json`,'utf8'))};writeFileSync(`${dir}/judging-timings.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{await q.close();}
