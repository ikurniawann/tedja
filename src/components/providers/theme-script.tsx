import { THEME_STORAGE_KEY } from "@/lib/theme/theme-state";

/** Blocking anti-flash script. Keep in sync with THEME_PRESETS + pickForeground. */
const SCRIPT = `(function(){try{
var raw=localStorage.getItem('${THEME_STORAGE_KEY}');
var s=raw?JSON.parse(raw):null;
var mode=s&&['light','dark','auto'].indexOf(s.mode)>=0?s.mode:'light';
var root=document.documentElement;
root.setAttribute('data-theme',mode);
var presets={wonderland:['#db2777','#ec4899'],ocean:['#0ea5e9','#6366f1'],emerald:['#10b981','#14b8a6'],graphite:['#334155','#64748b'],sunset:['#f97316','#ef4444']};
var preset=(s&&typeof s.presetId==='string'&&presets[s.presetId])?presets[s.presetId]:presets.wonderland;
var p=(s&&typeof s.customPrimary==='string')?s.customPrimary:preset[0];
var sec=(s&&typeof s.customSecondary==='string')?s.customSecondary:preset[1];
function lum(hex){hex=String(hex).replace('#','');if(hex.length===3)hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];var r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;function c(v){return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}r=c(r);g=c(g);b=c(b);return 0.2126*r+0.7152*g+0.0722*b}
function ratio(a,b){var L1=lum(a),L2=lum(b);var hi=Math.max(L1,L2),lo=Math.min(L1,L2);return(hi+0.05)/(lo+0.05)}
var fg=ratio('#ffffff',p)>=ratio('#000000',p)?'#ffffff':'#000000';
root.style.setProperty('--brand-primary',p);
root.style.setProperty('--brand-secondary',sec);
root.style.setProperty('--primary-foreground',fg);
}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
