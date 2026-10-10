import assert from 'node:assert/strict';

const names=['prior_debt','financial_positions','active_payments','completion_history',
  'completion_operations','principals','ordered','allocated'];

function uncomment(text){
  let result='',quote=null;
  for(let n=0;n<text.length;n++){
    const c=text[n],next=text[n+1];
    if(quote){result+=c;if(c===quote){if(next===quote){result+=next;n++;}else quote=null;}continue;}
    if(c==="'"||c==='"'){quote=c;result+=c;continue;}
    if(c==='-'&&next==='-'){while(n<text.length&&text[n]!=='\n')n++;result+='\n';continue;}
    if(c==='/'&&next==='*'){n+=2;while(n<text.length&&!(text[n]==='*'&&text[n+1]==='/'))n++;n++;result+=' ';continue;}
    result+=c;
  }
  assert.equal(quote,null,'Unterminated SQL literal');return result;
}
function compact(text){
  let result='',quote=null;
  for(let n=0;n<text.length;n++){
    const c=text[n],next=text[n+1];
    if(quote){result+=c;if(c===quote){if(next===quote){result+=next;n++;}else quote=null;}continue;}
    if(c==="'"||c==='"'){quote=c;result+=c;continue;}
    if(!/\s/u.test(c))result+=c.toLowerCase();
  }
  return result;
}
export function normalizeDebtCtes(sql,{directory=false}={}){
  const source=uncomment(sql),result={};
  for(const name of names){
    const pattern=new RegExp('\\b'+name+'\\s+AS\\s+(?:(?:NOT\\s+)?MATERIALIZED\\s+)?\\(','giu');
    const matches=[...source.matchAll(pattern)];assert.equal(matches.length,1,name+' exact CTE boundary');
    const start=matches[0].index+matches[0][0].length;let depth=1,quote=null,end=start;
    for(;end<source.length;end++){
      const c=source[end],next=source[end+1];
      if(quote){if(c===quote){if(next===quote)end++;else quote=null;}continue;}
      if(c==="'"||c==='"'){quote=c;continue;}
      if(c==='(')depth++;if(c===')'&&--depth===0)break;
    }
    assert.equal(depth,0,name+' balanced body');
    let body=source.slice(start,end);
    if(directory){
      // Only these literal137 query-scope gates differ. They restrict work to
      // the overdue filter,not the balance/FIFO/date/evidence semantics.
      if(['active_payments','completion_history'].includes(name))
        body=body.replace(/\bWHERE\s+v_status\s*=\s*'overdue'\s+AND\s+/iu,'WHERE ');
      if(['completion_operations','principals'].includes(name))
        body=body.replace(/\bWHERE\s+v_status\s*=\s*'overdue'\s*(?=GROUP BY|$)/iu,'');
    }
    result[name]=compact(body);
  }
  return result;
}
