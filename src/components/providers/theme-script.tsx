import { THEME_STORAGE_KEY } from "@/lib/theme/theme-state";

const SCRIPT = `(function(){try{
var raw=localStorage.getItem('${THEME_STORAGE_KEY}');
var s=raw?JSON.parse(raw):null;
var mode=s&&['light','dark','auto'].indexOf(s.mode)>=0?s.mode:'light';
var root=document.documentElement;
root.setAttribute('data-theme',mode);
var p=(s&&typeof s.customPrimary==='string')?s.customPrimary:'#db2777';
var sec=(s&&typeof s.customSecondary==='string')?s.customSecondary:'#ec4899';
root.style.setProperty('--brand-primary',p);
root.style.setProperty('--brand-secondary',sec);
}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
