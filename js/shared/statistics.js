/** New sport-agnostic utilities. Existing NFL code deliberately remains untouched. */
export const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
export function randomSeed(seed=1){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
export function probabilityMetrics(rows){
 if(!rows.length)throw Error('No evaluated games');let brier=0,logLoss=0,correct=0;
 const bins=Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,n:0,p:0,y:0}));
 for(const r of rows){const p=r.p,y=r.y;if(!Number.isFinite(p)||p<0||p>1||![0,1].includes(y))throw Error('Invalid probability observation');brier+=(p-y)**2;const bounded=clamp(p,1e-8,1-1e-8);logLoss-=y*Math.log(bounded)+(1-y)*Math.log(1-bounded);correct+=(p>=.5)===(y===1)?1:0;const b=bins[Math.min(9,Math.floor(p*10))];b.n++;b.p+=p;b.y+=y;}
 return{games:rows.length,accuracy:correct/rows.length,brier:brier/rows.length,logLoss:logLoss/rows.length,calibration:bins.map(b=>({lower:b.lower,upper:b.upper,n:b.n,meanProbability:b.n?b.p/b.n:null,observedRate:b.n?b.y/b.n:null}))};
}
export function poissonSample(mean,random){let product=1,n=0,limit=Math.exp(-mean);do{n++;product*=Math.max(Number.EPSILON,random());}while(product>limit);return n-1;}
function gaussian(random){return Math.sqrt(-2*Math.log(Math.max(Number.EPSILON,random())))*Math.cos(2*Math.PI*random());}
export function gammaSample(shape,random){
 if(shape<1)return gammaSample(shape+1,random)*Math.max(Number.EPSILON,random())**(1/shape);
 const d=shape-1/3,c=1/Math.sqrt(9*d);
 for(;;){const x=gaussian(random),v0=1+c*x;if(v0<=0)continue;const v=v0**3,u=random();if(u<1-.0331*x**4||Math.log(Math.max(Number.EPSILON,u))<.5*x*x+d*(1-v+Math.log(v)))return d*v;}
}
export function goalSample(mean,distribution,dispersion,random){return poissonSample(distribution==='negative-binomial'?gammaSample(dispersion,random)*mean/dispersion:mean,random);}
export function goalPmf(mean,distribution='poisson',dispersion=20,max=40){
 const values=[distribution==='negative-binomial'?(dispersion/(dispersion+mean))**dispersion:Math.exp(-mean)];
 for(let k=1;k<=max;k++)values.push(values[k-1]*(distribution==='negative-binomial'?(k-1+dispersion)/k*mean/(dispersion+mean):mean/k));return values;
}
