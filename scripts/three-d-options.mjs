/** Planning switches shared by the normal 3D command and its 2D adapter. */
export const townOptionFlags=['--seed','--size','--coast','--harbor','--river','--river-harbor','--walls','--castle','--plaza'];

export function readTownOptions(args) {
  const value=(flag,fallback)=>{
    const i=args.indexOf(flag);
    if(i<0)return fallback;
    if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing value for ${flag}`);
    return args[i+1];
  };
  if(args.includes('--input')&&townOptionFlags.some(flag=>args.includes(flag)))throw new Error('--input preserves the saved plan; omit --seed, --size and terrain/feature switches when importing JSON.');
  const choice=(flag,fallback,auto=false)=>{
    const text=value(flag,String(fallback));
    if(text==='true')return true;
    if(text==='false')return false;
    if(auto&&text==='auto')return 'auto';
    throw new Error(`${flag} requires true${auto?', false or auto':' or false'}`);
  };
  const options={seed:Number(value('--seed','7')),size:Number(value('--size','6')),
    walls:choice('--walls',true,true),castle:choice('--castle',false,true),plaza:choice('--plaza',true,true)};
  if(args.includes('--coast')) {
    const coast=value('--coast');
    if(!['false','auto','east','south','west','north'].includes(coast))throw new Error('--coast requires false, auto, east, south, west or north');
    options.coast=coast==='false'?false:coast;
  }
  for(const flag of ['--harbor','--river'])if(args.includes(flag))options[flag.slice(2)]=choice(flag,false);
  if(args.includes('--river-harbor'))options.riverHarbor=choice('--river-harbor',false);
  return options;
}
