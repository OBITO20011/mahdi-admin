import React from 'react';
import {receiptLineDescription,receiptMoney,type ReceiptDocumentData} from './commercialReceipt';

/** One stateless template for POS, order-history reprints and token-authorized public receipts. */
export function ReceiptDocument({receipt}:{receipt:ReceiptDocumentData}){
  return <article dir="rtl" data-testid="sale-receipt-document" className="pos-receipt-print" style={{background:'#fff',color:'#111827',padding:'12px',fontFamily:'Arial,Tahoma,sans-serif',fontSize:'12px',lineHeight:1.8,overflowWrap:'anywhere'}}>
    <header style={{textAlign:'center',borderBottom:'1px dashed #9ca3af',paddingBottom:8}}>
      <h2 style={{fontSize:15,fontWeight:800,margin:0}}>{receipt.businessName}</h2>
      {receipt.branch.name&&<p style={{margin:0}}>{receipt.branch.name}</p>}
      {(receipt.branch.address||receipt.branch.phone)&&<p style={{margin:0}}>{[receipt.branch.address,receipt.branch.phone].filter(Boolean).join(' | ')}</p>}
      <p style={{margin:0}}>رقم الفاتورة: <bdi dir="ltr">{receipt.number}</bdi></p>
      <p style={{margin:0}}>{receipt.createdAt?new Date(receipt.createdAt).toLocaleString('ar-JO-u-nu-latn'):'التاريخ في الإيصال المحفوظ'}</p>
    </header>
    {receipt.customerName&&<p>العميل: {receipt.customerName}</p>}
    <ul aria-label="أصناف الوصل" style={{padding:0,margin:'8px 0',listStyle:'none'}}>
      {receipt.lines.map(line=><li key={line.key} data-receipt-line style={{display:'flex',alignItems:'start',justifyContent:'space-between',gap:12,padding:'6px 0',borderBottom:'1px dashed #d1d5db'}}>
        <span><strong>{line.name}</strong><br/><span data-receipt-line-description>{receiptLineDescription(line)}</span></span>
        <bdi dir="ltr" style={{whiteSpace:'nowrap'}}>{receiptMoney(line.totalInMinorUnits)}</bdi>
      </li>)}
    </ul>
    <dl style={{margin:0}}>
      <ReceiptAmount label="المجموع الفرعي" amount={receipt.subtotalInMinorUnits}/>
      {receipt.discountInMinorUnits>0&&<ReceiptAmount label="الخصم" amount={receipt.discountInMinorUnits}/>}
      {receipt.deliveryInMinorUnits>0&&<ReceiptAmount label="التوصيل" amount={receipt.deliveryInMinorUnits}/>}
      <ReceiptAmount label="الإجمالي" amount={receipt.totalInMinorUnits}/>
      <div style={{display:'flex',justifyContent:'space-between',gap:12}}><dt>طريقة الدفع</dt><dd style={{margin:0}}>{receipt.paymentLabel}</dd></div>
      {(receipt.remainingInMinorUnits??0)>0&&<ReceiptAmount label="المتبقي على العميل" amount={receipt.remainingInMinorUnits!}/>}
      {(receipt.changeInMinorUnits??0)>0&&<ReceiptAmount label="الباقي للزبون" amount={receipt.changeInMinorUnits!}/>}
    </dl>
    <footer style={{textAlign:'center',borderTop:'1px dashed #9ca3af',marginTop:8,paddingTop:8}}>شكراً لتعاملكم معنا</footer>
  </article>;
}
function ReceiptAmount({label,amount}:{label:string;amount:number}){
  return <div style={{display:'flex',justifyContent:'space-between',gap:12}}><dt>{label}</dt><dd style={{margin:0,fontWeight:700}}><bdi dir="ltr">{receiptMoney(amount)}</bdi></dd></div>;
}
export function ReceiptPrintStyle(){return <style>{`@media print {
  @page { size:80mm auto; margin:4mm; }
  html,body { background:#fff!important; }
  body * { visibility:hidden!important; }
  .pos-receipt-print,.pos-receipt-print * { visibility:visible!important; }
  .pos-receipt-print { position:absolute!important;inset:0!important;width:72mm!important;margin:0 auto!important;padding:3mm!important;border:0!important;box-shadow:none!important;color:#111827!important;background:#fff!important;direction:rtl!important; }
}`}</style>;}
