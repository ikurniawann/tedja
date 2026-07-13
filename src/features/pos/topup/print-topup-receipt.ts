export type TopupReceiptPrintPayload = {
  customerName: string;
  phone?: string;
  amount: number;
  arkAmountLabel: string;
  paymentMethod: string;
  balanceBeforeLabel: string;
  balanceAfterLabel: string;
  amountLabel: string;
  cardId?: string | null;
};

export function printTopupReceipt(payload: TopupReceiptPrintPayload) {
  const popupWidth = Math.min(720, Math.max(480, window.screen.availWidth - 80));
  const popupHeight = Math.min(900, Math.max(640, window.screen.availHeight - 80));
  const left = Math.max(0, Math.round((window.screen.availWidth - popupWidth) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - popupHeight) / 2));
  const win = window.open(
    "",
    "_blank",
    `width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );

  if (!win) {
    throw new Error("Allow popups to print the receipt.");
  }

  const when = new Date().toLocaleString("id-ID");

  win.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>TOPUP RECEIPT</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        background: #f3f4f6;
        padding: 24px 16px;
        display: flex;
        justify-content: center;
      }
      .ticket {
        width: 72mm;
        max-width: 100%;
        background: #fff;
        padding: 6mm 4mm;
        box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      }
      h1 { font-size:15px; text-align:center; letter-spacing:2px; margin-bottom:4px; }
      .center { text-align:center; }
      .divider { border-top:1px dashed #000; margin:6px 0; }
      .big { font-size:16px; font-weight:bold; text-align:center; margin:4px 0; }
      .row { display:flex; justify-content:space-between; gap:8px; margin:2px 0; }
      .row.total { font-weight:bold; font-size:14px; margin-top:4px; }
      @media print {
        body { background:#fff; padding:0; display:block; }
        .ticket { width:72mm; box-shadow:none; }
        @page { margin:0; size:72mm auto; }
      }
    </style>
  </head>
  <body>
    <div class="ticket">
      <h1>--- TOPUP ---</h1>
      <div class="center">ARK E-MONEY</div>
      <div class="center">${when}</div>
      <div class="divider"></div>
      <div class="center">${payload.customerName}</div>
      ${payload.phone ? `<div class="center">${payload.phone}</div>` : ""}
      ${payload.cardId ? `<div class="center">Card ${payload.cardId}</div>` : ""}
      <div class="divider"></div>
      <div class="big">${payload.arkAmountLabel}</div>
      <div class="center">${payload.amountLabel}</div>
      <div class="divider"></div>
      <div class="row"><span>Method</span><span>${payload.paymentMethod.toUpperCase()}</span></div>
      <div class="row"><span>Before</span><span>${payload.balanceBeforeLabel}</span></div>
      <div class="row total"><span>Balance</span><span>${payload.balanceAfterLabel}</span></div>
      <div class="divider"></div>
      <div class="center">--- TOPUP COPY ---</div>
    </div>
  </body>
</html>`);

  win.document.close();
  win.focus();
  window.setTimeout(() => {
    win.print();
    win.close();
  }, 400);
}
