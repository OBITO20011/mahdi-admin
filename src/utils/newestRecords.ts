/** Presentation only, for COMPLETE histories. Never reverse a server-paged slice. */
export function newestRecords<T>(rows: readonly T[], at: (row:T)=>string|null|undefined, id?: (row:T)=>string): T[] {
  const time=(row:T)=>{const raw=at(row),value=raw?Date.parse(raw):NaN;return Number.isFinite(value)?value:Number.NEGATIVE_INFINITY;};
  return rows.map((row,index)=>({row,index,time:time(row)})).sort((a,b)=>{
    if(a.time!==b.time)return a.time>b.time?-1:1;
    const left=id?.(a.row)??'',right=id?.(b.row)??'';
    return left===right?a.index-b.index:left>right?-1:1;
  }).map(item=>item.row);
}
