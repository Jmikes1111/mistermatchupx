/** Pure model: input observations, cutoff and explicit context; no network or DOM. */
export const MODEL_VERSION = '2.0.0';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const finite = Number.isFinite;
export function seededRandom(seed=1) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function validateSnapshot(data) {
  if (data?.metadata?.schemaVersion !== 2 || Object.keys(data.teams || {}).length !== 32 || !Array.isArray(data.games)) throw Error('Invalid V2 snapshot');
  if (!finite(Date.parse(data.metadata.asOf))) throw Error('Invalid data cutoff');
  const ids = new Set();
  for (const g of data.games) {
    if (ids.has(g.id) || !data.teams[g.home] || !data.teams[g.away] || g.home===g.away || !finite(g.homeScore) || !finite(g.awayScore) || g.homeScore<0 || g.awayScore<0 || !finite(Date.parse(g.availableAt)) || g.availableAt<=g.date) throw Error('Invalid game observation');
    ids.add(g.id);
    for (const s of Object.values(g.stats || {})) {
      for (const k of ['epaPerPlay','successRate','plays']) if (s[k]!=null && !finite(s[k])) throw Error(`Invalid ${k}`);
      if (s.successRate!=null && (s.successRate<0 || s.successRate>1)) throw Error('Invalid success rate');
    }
  }
  return data;
}
// Every feature uses completed games strictly before the requested cutoff.
export function buildRatings(data, {asOf=data.metadata.asOf, season=data.metadata.season, useStarters=true}={}) {
  if (!finite(Date.parse(asOf)) || Date.parse(asOf)>Date.parse(data.metadata.asOf)) throw Error('Cutoff exceeds snapshot or is invalid');
  const games=data.games.filter(g=>Date.parse(g.availableAt)<Date.parse(asOf) && g.season<=season && g.season>=season-1);
  const rows=Object.fromEntries(Object.keys(data.teams).map(t=>[t,[]]));
  for (const g of games) for (const [t,opp,pf,pa] of [[g.home,g.away,g.homeScore,g.awayScore],[g.away,g.home,g.awayScore,g.homeScore]]) {
    const age=(Date.parse(asOf)-Date.parse(g.date))/86400000;
    const weight=(g.season===season ? 1 : .3)*(.25+.75*Math.pow(.5, age/42));
    const s=g.stats?.[t] || {}, ds=g.stats?.[opp] || {};
    rows[t].push({g,opp,pf,pa,weight,...s,defEpa:ds.epaPerPlay,defSuccess:ds.successRate});
  }
  const all=Object.values(rows).flat();
  const league=mean(all.map(r=>r.pf)) ?? 22; // explicit neutral prior, never a claimed observation
  const leagueEpa=mean(all.map(r=>r.epaPerPlay).filter(finite)) ?? 0;
  const leagueSuccess=mean(all.map(r=>r.successRate).filter(finite)) ?? .42;
  const weighted=(rs,key,prior)=>{
    const usable=rs.filter(r=>finite(r[key]));
    if (!usable.length) return prior;
    const sum=usable.reduce((s,r)=>s+r.weight,0);
    const recent=usable.reduce((s,r)=>s+r.weight*r[key],0)/sum;
    const seasonRows=usable.filter(r=>r.g.season===season);
    const avg=mean((seasonRows.length?seasonRows:usable).map(r=>r[key]));
    return (.75*recent+.25*avg)*(sum/(sum+2.5))+prior*(2.5/(sum+2.5));
  };
  const raw={};
  for (const [t,rs] of Object.entries(rows)) raw[t]={pf:weighted(rs,'pf',league),pa:weighted(rs,'pa',league),epa:weighted(rs,'epaPerPlay',leagueEpa),defEpa:weighted(rs,'defEpa',leagueEpa),success:weighted(rs,'successRate',leagueSuccess),defSuccess:weighted(rs,'defSuccess',leagueSuccess)};
  const ratings={};
  for (const [t,rs] of Object.entries(rows)) {
    const r=raw[t];
    // One damped opponent adjustment, avoiding unstable iterative fitting on four weeks.
    const opponentDefense=weighted(rs.map(x=>({...x,v:raw[x.opp].pa-league})),'v',0);
    const opponentOffense=weighted(rs.map(x=>({...x,v:raw[x.opp].pf-league})),'v',0);
    const offense=.65*(r.pf-league-.35*opponentDefense)+12*(r.epa-leagueEpa)+5*(r.success-leagueSuccess);
    const defense=.65*(league-r.pa+.35*opponentOffense)+12*(leagueEpa-r.defEpa)+5*(leagueSuccess-r.defSuccess);
    const qbs=new Map();
    for (const row of rs) for (const qb of row.qbs || []) {
      if (!finite(qb.epa) || !finite(qb.dropbacks) || qb.dropbacks<=0) continue;
      const agg=qbs.get(qb.id) || {id:qb.id,name:qb.name,epa:0,n:0,cpoe:0,ngsN:0};
      agg.epa+=qb.epa*row.weight;agg.n+=qb.dropbacks*row.weight;
      if (finite(qb.ngsCpoe)) {agg.cpoe+=qb.ngsCpoe*qb.dropbacks*row.weight;agg.ngsN+=qb.dropbacks*row.weight;}
      qbs.set(qb.id,agg);
    }
    const starter=useStarters && Date.parse(data.starters?.[t]?.observedAt)<Date.parse(asOf) ? data.starters[t] : null;
    const qb=starter ? qbs.get(starter.id) : [...qbs.values()].sort((a,b)=>b.n-a.n)[0];
    const qbBaseline=[...qbs.values()].reduce((a,b)=>[a[0]+b.epa,a[1]+b.n],[0,0]);
    // Only a starter change adjusts team EPA already incorporating QB performance.
    const qbAdjustment=qb && qbBaseline[1]>0 ? clamp(8*(qb.epa/qb.n-qbBaseline[0]/qbBaseline[1])*(qb.n/(qb.n+100)),-2,2) : 0;
    const ngsAdjustment=qb?.ngsN>0 ? clamp(.03*(qb.cpoe/qb.ngsN)*(qb.ngsN/(qb.ngsN+100)),-.5,.5) : 0;
    const skill=new Map();
    for (const row of rs.filter(x=>x.g.season===season)) for (const player of row.skill || []) {
      const entry=skill.get(player.id) || {...player,usage:0,yards:0};entry.usage+=player.usage;entry.yards+=player.yards;skill.set(player.id,entry);
    }
    ratings[t]={name:data.teams[t],offense:clamp(offense,-12,12),defense:clamp(defense,-12,12),qbAdjustment,ngsAdjustment,qb:qb?{id:qb.id,name:qb.name,epaPerDropback:qb.epa/qb.n,ngsCpoe:qb.ngsN? qb.cpoe/qb.ngsN:null}:null,starter:starter || null,skill:[...skill.values()].sort((a,b)=>b.usage-a.usage).slice(0,3),games:rs.filter(x=>x.g.season===season).length,epa:r.epa,defEpa:r.defEpa};
  }
  // Derive dispersion from historical score observations; conservative bounded estimate.
  const sd=all.length>1 ? Math.sqrt(all.reduce((s,r)=>s+(r.pf-league)**2,0)/all.length) : 10;
  return {ratings,league,scoreStd:clamp(sd,8,14),asOf,season,observations:games.length};
}
export function expectedScores(model,a,b,context={}) {
  if (a===b || !model.ratings[a] || !model.ratings[b]) throw Error('Select two different valid teams');
  const A=model.ratings[a],B=model.ratings[b];
  const home=context.homeA ? 1.7 : 0;
  const rest=finite(context.restA) && finite(context.restB) ? clamp((context.restA-context.restB)*.12,-.6,.6) : 0;
  const adjustments=context.adjustments || [];
  let extraA=0,extraB=0;
  for (const item of adjustments) {
    if (!['injury','roster','pff','advanced'].includes(item.kind) || !['a','b'].includes(item.side) || !finite(item.points) || Math.abs(item.points)>5 || !item.source || !finite(Date.parse(item.availableAt)) || Date.parse(item.availableAt)>=Date.parse(model.asOf)) throw Error('Invalid or future context adjustment');
    if (item.side==='a') extraA+=item.points;else extraB+=item.points;
  }
  return {a:clamp(model.league+A.offense-B.defense+A.qbAdjustment+A.ngsAdjustment+home+rest+extraA,7,45),b:clamp(model.league+B.offense-A.defense+B.qbAdjustment+B.ngsAdjustment+extraB,7,45),home,rest};
}
function normal(random) {
  const u=clamp(random(),Number.EPSILON,1-Number.EPSILON),v=random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
export function simulate(model,a,b,context={}, {trials=10000,random=Math.random}={}) {
  if (!Number.isInteger(trials) || trials<1 || trials>1000000) throw Error('Invalid trials');
  const expected=expectedScores(model,a,b,context);
  let winsA=0,winsB=0,totalA=0,totalB=0,ties=0;
  for (let i=0;i<trials;i++) {
    // Shared game pace introduces positive score correlation.
    const pace=normal(random)*2;
    const scoreA=Math.max(0,Math.round(expected.a+pace+normal(random)*model.scoreStd));
    const scoreB=Math.max(0,Math.round(expected.b+pace+normal(random)*model.scoreStd));
    totalA+=scoreA;totalB+=scoreB;
    if (scoreA>scoreB) winsA++;else if (scoreB>scoreA) winsB++;else {ties++;if(random()<.5)winsA++;else winsB++;}
  }
  return {winsA,winsB,ties,probabilityA:winsA/trials,probabilityB:winsB/trials,averageA:totalA/trials,averageB:totalB/trials,trials,expected};
}
export function explain(model,a,b,result,context={}) {
  const first=result.probabilityA>=.5, t=first?a:b, other=first?b:a;
  const winner=model.ratings[t], loser=model.ratings[other],reasons=[];
  if(winner.offense>loser.offense)reasons.push('stronger recent offensive scoring and efficiency');
  if(winner.defense>loser.defense)reasons.push('better opponent-adjusted defense');
  if(first && context.homeA)reasons.push('Team 1’s home-field advantage');
  if(winner.qb)reasons.push(`${winner.qb.name}’s observed passing performance`);
  return `${winner.name} is favored at ${(Math.max(result.probabilityA,result.probabilityB)*100).toFixed(1)}% with ${reasons.slice(0,3).join(', ') || 'a small combined model edge'}. Based on ${winner.games} current-season games and a regressed prior-season baseline. ${winner.skill[0] ? `Key contributor: ${winner.skill[0].name} (${winner.skill[0].yards} scrimmage yards). ` : ''}Injuries are not modeled; listed depth-chart starters are not confirmed game-day starters. Tied trials are split randomly, so these are two-way probabilities.`;
}
export function selfTest(model) {
  const codes=Object.keys(model.ratings);let passed=0;
  for(let i=0;i<50;i++) {
    const r=simulate(model,codes[i%32],codes[(i+1)%32],{homeA:i%2===0},{random:seededRandom(i+1)});
    if(r.trials===10000 && r.winsA+r.winsB===10000 && finite(r.averageA) && finite(r.averageB) && Math.abs(r.probabilityA+r.probabilityB-1)<1e-9)passed++;
  }
  if(passed!==50)throw Error(`Engine self-test failed: ${passed}/50`);
  return passed;
}
