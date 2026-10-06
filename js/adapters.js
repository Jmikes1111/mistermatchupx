/** Optional licensed-provider boundary. Caller supplies data; no scraping or fetching. */
export function licensedPffAdjustment({licensed,teamSide,points,source,availableAt}) {
  if(licensed!==true)throw Error('Licensed PFF input is required');
  if(!['a','b'].includes(teamSide) || !Number.isFinite(points) || Math.abs(points)>5 || !source || !Number.isFinite(Date.parse(availableAt)))throw Error('Invalid licensed input');
  return {kind:'pff',side:teamSide,points,source,availableAt};
}
