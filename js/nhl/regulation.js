/** Coherent finite regulation-score distributions. Team-strength inputs stay frozen. */
import {goalPmf} from '../shared/statistics.js';
export const MAX_SCORE=40;
const logistic=x=>1/(1+Math.exp(-x));
function checkMeans(a,b){if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0||a>7||b>7)throw Error('Invalid NHL goal rates');}
export function regulationDistribution(expected,config={}){
 const {a,b}=expected;checkMeans(a,b);const spec=config.regulation??{family:config.distribution==='negative-binomial'?'negative-binomial':'poisson',dispersion:config.dispersion??20},family=spec.family;
 const size=MAX_SCORE+1,matrix=new Float64Array(size*size);let A,B;
 if(family==='bivariate-poisson'){
  if(!Number.isFinite(spec.sharedFraction)||spec.sharedFraction<0||spec.sharedFraction>=1)throw Error('Invalid shared-goal fraction');
  const common=spec.sharedFraction*Math.min(a,b),U=goalPmf(a-common),V=goalPmf(b-common),C=goalPmf(common);
  for(let k=0;k<size;k++)for(let i=k;i<size;i++)for(let j=k;j<size;j++)matrix[i*size+j]+=C[k]*U[i-k]*V[j-k];
 }else if(family==='shared-gamma'){
  const k=spec.shape;if(!Number.isFinite(k)||k<=0)throw Error('Invalid shared-gamma shape');const total=k+a+b;
  matrix[0]=(k/total)**k;
  for(let i=1;i<size;i++)matrix[i*size]=matrix[(i-1)*size]*(k+i-1)/i*a/total;
  for(let i=0;i<size;i++)for(let j=1;j<size;j++)matrix[i*size+j]=matrix[i*size+j-1]*(k+i+j-1)/j*b/total;
 }else{
  if(!['poisson','negative-binomial','dixon-coles','draw-logit'].includes(family))throw Error('Unknown regulation score model');
  const dispersion=spec.dispersion??config.dispersion??20;if(family==='negative-binomial'&&(!Number.isFinite(dispersion)||dispersion<=0))throw Error('Invalid dispersion');
  A=goalPmf(a,family==='negative-binomial'?'negative-binomial':'poisson',dispersion);B=goalPmf(b,family==='negative-binomial'?'negative-binomial':'poisson',dispersion);
  for(let i=0;i<size;i++)for(let j=0;j<size;j++)matrix[i*size+j]=A[i]*B[j];
  if(family==='dixon-coles'){
   const r=spec.rho;if(!Number.isFinite(r))throw Error('Invalid Dixon-Coles parameter');const factors=[1-a*b*r,1+a*r,1+b*r,1-r];if(factors.some(x=>x<0))throw Error('Negative Dixon-Coles cell');
   for(const [index,factor] of [[0,factors[0]],[1,factors[1]],[size,factors[2]],[size+1,factors[3]]])matrix[index]*=factor;
  }
 }
 let rawMass=matrix.reduce((s,p)=>s+p,0);if(!Number.isFinite(rawMass)||rawMass<=0)throw Error('Invalid score mass');
 for(let n=0;n<matrix.length;n++)matrix[n]/=rawMass;
 if(family==='draw-logit'){
  const coefficients=spec.coefficients;if(!Array.isArray(coefficients)||![1,3].includes(coefficients.length)||coefficients.some(c=>!Number.isFinite(c)))throw Error('Invalid draw coefficients');
  let diagonal=0;for(let i=0;i<size;i++)diagonal+=matrix[i*size+i];
  const features=[1,Math.abs(a-b)-.75,a+b-6];const adjustment=coefficients.reduce((s,c,i)=>s+c*features[i],0);
  const target=logistic(Math.log(diagonal/(1-diagonal))+adjustment),drawWeight=target/diagonal,otherWeight=(1-target)/(1-diagonal);
  for(let i=0;i<size;i++)for(let j=0;j<size;j++)matrix[i*size+j]*=i===j?drawWeight:otherWeight;
 }
 let regulationA=0,regulationB=0,overtime=0,meanA=0,meanB=0,secondA=0,secondB=0,cross=0;
 for(let i=0;i<size;i++)for(let j=0;j<size;j++){const p=matrix[i*size+j];if(!Number.isFinite(p)||p<0)throw Error('Invalid regulation probability');if(i>j)regulationA+=p;else if(j>i)regulationB+=p;else overtime+=p;meanA+=i*p;meanB+=j*p;secondA+=i*i*p;secondB+=j*j*p;cross+=i*j*p;}
 const mass=regulationA+regulationB+overtime;return{size,matrix,rawMass,omittedTail:Math.max(0,1-rawMass),regulationA:regulationA/mass,regulationB:regulationB/mass,overtime:overtime/mass,meanA,meanB,varianceA:secondA-meanA*meanA,varianceB:secondB-meanB*meanB,covariance:cross-meanA*meanB};
}
export function outcomeProbabilities(expected,config={},distribution=regulationDistribution(expected,config)){
 const {regulationA,regulationB,overtime}=distribution;
 const overtimeConditionalA=config.overtimeMode==='neutral'?.5:(1-(config.shootoutShare??.25))*expected.a/(expected.a+expected.b)+(config.shootoutShare??.25)*.5;
 const fullGameA=regulationA+overtime*overtimeConditionalA;
 return{regulationA,regulationB,overtime,fullGameA,fullGameB:1-fullGameA,overtimeConditionalA,regulationMeanA:distribution.meanA,regulationMeanB:distribution.meanB};
}
export function scoreSampler(distribution){
 const cdf=new Float64Array(distribution.matrix.length);let total=0;for(let n=0;n<cdf.length;n++){total+=distribution.matrix[n];cdf[n]=total;}cdf[cdf.length-1]=1;
 return random=>{const u=random();let low=0,high=cdf.length-1;while(low<high){const mid=(low+high)>>>1;if(u<cdf[mid])high=mid;else low=mid+1;}return[Math.floor(low/distribution.size),low%distribution.size];};
}
