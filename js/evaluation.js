/** Score recorded predictions; market lines must have their own pre-kickoff timestamp. */
export function evaluate(predictions) {
  if(!predictions.length)throw Error('No predictions to evaluate');
  const bins=Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,count:0,probabilitySum:0,outcomeSum:0}));
  let brier=0,loss=0,correct=0,decisive=0,atsWins=0,atsLosses=0,atsPushes=0;
  for(const r of predictions){
    if(!Number.isFinite(r.probability) || r.probability<0 || r.probability>1 || ![0,.5,1].includes(r.outcome))throw Error('Invalid prediction outcome');
    const p=Math.max(1e-6,Math.min(1-1e-6,r.probability));
    brier+=(r.probability-r.outcome)**2;loss-=r.outcome*Math.log(p)+(1-r.outcome)*Math.log(1-p);
    if(r.outcome!==.5){decisive++;if((r.probability>=.5)===(r.outcome===1))correct++;}
    const bin=bins[Math.min(9,Math.floor(r.probability*10))];bin.count++;bin.probabilitySum+=r.probability;bin.outcomeSum+=r.outcome;
    if(r.market && Number.isFinite(r.market.homeHandicap) && Number.isFinite(Date.parse(r.market.observedAt)) && Number.isFinite(Date.parse(r.kickoff)) && Date.parse(r.market.observedAt)<Date.parse(r.kickoff) && Number.isFinite(r.predictedMargin) && Number.isFinite(r.actualMargin)){
      const selection=r.predictedMargin+r.market.homeHandicap;
      const cover=r.actualMargin+r.market.homeHandicap;
      if(selection===0)continue;
      if(cover===0)atsPushes++;else if((selection>0)===(cover>0))atsWins++;else atsLosses++;
    }
  }
  return {games:predictions.length,decisiveGames:decisive,accuracy:decisive?correct/decisive:null,brier:brier/predictions.length,logLoss:loss/predictions.length,calibration:bins.map(b=>({lower:b.lower,upper:b.upper,count:b.count,meanProbability:b.count?b.probabilitySum/b.count:null,observedRate:b.count?b.outcomeSum/b.count:null})),ats:{wins:atsWins,losses:atsLosses,pushes:atsPushes,accuracy:atsWins+atsLosses?atsWins/(atsWins+atsLosses):null}};
}
