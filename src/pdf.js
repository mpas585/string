/*
  pdf.js — PDF譜面の表示（pdfjs はグローバル window.pdfjsLib）。
  元 cello-finger.html L3127–3153 より無改変で移植。
    pdfDoc/pdfPage/openPdf/renderPdfPage
  依存: dom(toast)。pdfjsLib は index.html でグローバル読み込み。
  ページ送りボタン（pdfprev/pdfnext）は配線側で pdfPage±1 → renderPdfPage。
*/
import { toast } from './dom.js';
import { tt } from './util.js';

export let pdfDoc=null, pdfPage=1;
export function setPdfPage(v){ pdfPage=v; }  /* 分割対応: 外部からのページ変更用 */
export async function openPdf(file){
  if(window.__noPdf || !window.pdfjsLib){ toast(tt('msg.pdf_lib_fail')); return; }
  try{
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf=await file.arrayBuffer();
    pdfDoc=await pdfjsLib.getDocument({data:buf}).promise;
    pdfPage=1;
    document.getElementById('pdfempty').style.display='none';
    renderPdfPage();
    toast(tt('msg.pdf_pages', pdfDoc.numPages));
  }catch(e){ toast(tt('msg.pdf_open_fail', e.message)); console.error(e); }
}
export async function renderPdfPage(){
  if(!pdfDoc) return;
  const page=await pdfDoc.getPage(pdfPage);
  const canvas=document.getElementById('pdfcanvas');
  const wrapW=Math.min(canvas.parentElement.clientWidth, 900);
  const vp0=page.getViewport({scale:1});
  const scale=wrapW/vp0.width;
  const vp=page.getViewport({scale});
  canvas.width=vp.width; canvas.height=vp.height;
  await page.render({canvasContext:canvas.getContext('2d'), viewport:vp}).promise;
  document.getElementById('pdfpage').textContent=`${pdfPage} / ${pdfDoc.numPages}`;
  document.getElementById('pdfprev').disabled=pdfPage<=1;
  document.getElementById('pdfnext').disabled=pdfPage>=pdfDoc.numPages;
}

/* ===== OMR用：検出解像度でのオフスクリーン描画 =====
   表示用の renderPdfPage() は最大900px幅に合わせて縮小するため、1ページに五線が
   20段以上あるスキャンだと線間隔が3〜4pxしか出ず、水平投影が成立しない。
   検出は別スケール（既定300dpi相当）で描く。表示用 #pdfcanvas には一切触れない。 */
export const OMR_DPI = 300;
export async function renderPageForOmr(pageNo, opts = {}){
  if(!pdfDoc) throw new Error(tt('msg.pdf_not_open'));
  const { dpi = OMR_DPI, maxPixels = 40e6 } = opts;
  const no = pageNo || pdfPage;
  const page = await pdfDoc.getPage(no);
  const vp1 = page.getViewport({scale:1});
  let scale = dpi/72;
  /* 端末のメモリ上限で落ちないよう、総画素数で頭を打つ */
  const px = (vp1.width*scale)*(vp1.height*scale);
  if(px > maxPixels) scale *= Math.sqrt(maxPixels/px);
  const vp = page.getViewport({scale});

  const cv = document.createElement('canvas');   /* DOMに挿さない＝表示に影響しない */
  cv.width = Math.ceil(vp.width);
  cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d', {willReadFrequently:true});
  /* PDFの地は透明なので、白で埋めてから描く。埋めないと二値化で全面インク扱いになる */
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
  await page.render({canvasContext:ctx, viewport:vp}).promise;

  const imageData = ctx.getImageData(0,0,cv.width,cv.height);
  cv.width = cv.height = 0;                      /* 明示的に解放（モバイルで効く） */
  return { imageData, width:imageData.width, height:imageData.height,
           scale, dpi:scale*72, page:no };
}
