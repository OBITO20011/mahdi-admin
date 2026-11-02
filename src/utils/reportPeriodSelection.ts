// Presentation selection only. The report service/SQL retain their period contract.
export interface ReportPeriodSelection {dateFrom: string; dateTo: string}
const key='nawasrah-report-period-session-v1';
export function reportToday(now=new Date()): string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
}
function validDay(value: unknown): value is string {return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function readReportPeriod(now=new Date(),storage?: Pick<Storage,'getItem'>|null): ReportPeriodSelection {
 const today=reportToday(now);
 try {const selected=storage===undefined?(typeof window==='undefined'?null:window.sessionStorage):storage;const saved=JSON.parse(selected?.getItem(key)??'null');if(saved&&validDay(saved.dateFrom)&&validDay(saved.dateTo)&&saved.dateFrom<=saved.dateTo)return {dateFrom:saved.dateFrom,dateTo:saved.dateTo};} catch {/* Unavailable/invalid display storage must not prevent a report. */}
 return {dateFrom:today,dateTo:today};
}
export function saveReportPeriod(value: ReportPeriodSelection): void {
 try {if(typeof window!=='undefined'&&validDay(value.dateFrom)&&validDay(value.dateTo)&&value.dateFrom<=value.dateTo)window.sessionStorage.setItem(key,JSON.stringify(value));} catch {/* Keep the current in-memory choice when storage is unavailable. */}
}
