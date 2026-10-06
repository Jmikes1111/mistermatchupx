import {validateSnapshot,buildRatings,simulate,explain,selfTest} from './model.js';
const el=id=>document.getElementById(id);
let model;
function invalidate(){el('results').classList.remove('show');}
function run(){
  const a=el('team1').value,b=el('team2').value;
  if(a===b){alert('Please select two different teams.');return;}
  const context={homeA:el('homeTeam').checked};
  el('runButton').disabled=true;el('again').disabled=true;el('runButton').textContent='SIMULATING...';
  el('status').textContent='Running 10,000 simulated games...';
  setTimeout(()=>{
    try {
      const result=simulate(model,a,b,context), first=result.probabilityA>=.5;
      el('winner').textContent=model.ratings[first?a:b].name;
      el('confidence').textContent='MODEL EDGE · '+(Math.max(result.probabilityA,result.probabilityB)*100).toFixed(1)+'%';
      for(const [i,t,p,s] of [[1,a,result.probabilityA,result.averageA],[2,b,result.probabilityB,result.averageB]]){
        el(`team${i}Result`).textContent=model.ratings[t].name;el(`prob${i}`).textContent=(i===1 ? result.probabilityA*100 : 100-Number((result.probabilityA*100).toFixed(1))).toFixed(1)+'%';el(`score${i}`).textContent='Projected score: '+Math.round(s);
      }
      el('whyText').textContent=explain(model,a,b,result,context);
      el('results').classList.add('show');el('status').textContent='Simulation complete — 10,000 games simulated.';
      el('results').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){el('status').textContent='Simulation failed: '+error.message;}
    finally{el('runButton').disabled=false;el('again').disabled=false;el('runButton').textContent='RUN 10,000 SIMULATIONS';}
  },30);
}
async function initialize(){
  try{
    const response=await fetch(new URL('../data/snapshot.json',import.meta.url),{cache:'no-cache'});
    if(!response.ok)throw Error(`Data request failed (${response.status})`);
    const data=validateSnapshot(await response.json());model=buildRatings(data);
    for(const [code,name] of Object.entries(data.teams))for(const id of ['team1','team2'])el(id).add(new Option(name,code));
    el('team1').value='CIN';el('team2').value='BAL';
    const meta=data.metadata;
    el('dataInfo').textContent=`Data through: ${meta.season} Week ${meta.latestWeek} · Games through ${meta.latestGameDate} (${meta.currentGames} completed games).`;
    const sources=meta.sourcesRetrieved;
    const format=value=>value ? new Date(value).toLocaleString() : 'unknown';
    const retrieved=sources?.earliest && sources?.latest ? `${format(sources.earliest)} – ${format(sources.latest)}` : 'unknown';
    el('dataDetails').textContent=`Sources retrieved: ${retrieved}${sources?.unknown?.length ? ' (some retrieval times unknown)' : ''}. Model built: ${format(meta.modelBuiltAt)} · Model V${meta.modelVersion} · Observation cutoff: ${format(meta.asOf)}. ${sources?.cacheUsageUnknown?.length ? 'Original cache usage unknown for legacy sources;' : `${sources?.cached?.length || 0} sources used from cache;`} ${sources?.unavailable?.length || 0} unavailable. Injuries unavailable; prior-season data provides a small-sample baseline.`;
    el('status').textContent=`Engine self-test: ${selfTest(model)}/50 matchup runs passed. Ready.`;
    el('runButton').disabled=false;
    el('runButton').addEventListener('click',run);el('again').addEventListener('click',run);
    el('newMatchup').addEventListener('click',()=>{invalidate();window.scrollTo({top:0,behavior:'smooth'});});
    for(const id of ['team1','team2','homeTeam'])el(id).addEventListener('change',invalidate);
  }catch(error){el('status').textContent='Unable to load verified model data. Please reload. '+error.message;el('dataInfo').textContent='Data unavailable — no substitute ratings generated.';}
}
initialize();
