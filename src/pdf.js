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
/* 描画中のタスク。ページ送りや画面回転で描き直しが重なると pdfjs が
   「同じcanvasで多重render」で落ちるので、前のものを取り消してから始める */
let renderTask=null;
/* 端末の実画素に合わせるときの上限。canvasの面積制限（iOSは約16.7M画素）に当てない */
const PDF_MAX_PIXELS = 12e6;

export async function renderPdfPage(){
  if(!pdfDoc) return;
  const page=await pdfDoc.getPage(pdfPage);
  const canvas=document.getElementById('pdfcanvas');
  const box=canvas.parentElement;

  /* clientWidth は padding を含む。引かないと絵を置ける幅より広く描いてしまい、
     CSS 側で縮められて眠い絵になる */
  const cs=getComputedStyle(box);
  const inner=box.clientWidth - (parseFloat(cs.paddingLeft)||0) - (parseFloat(cs.paddingRight)||0);
  const cssW=Math.max(160, Math.min(inner, 900));      /* 見た目の幅（CSSピクセル） */

  const vp0=page.getViewport({scale:1});
  /* CSSピクセルのまま描くと Retina 系（devicePixelRatio 2〜3）では実画素の1/2〜1/3しか
     密度が出ず、五線と符頭が潰れて楽譜として読めない。実画素に合わせて描く */
  const dpr=Math.min(window.devicePixelRatio||1, 3);
  let scale=(cssW*dpr)/vp0.width;
  const px=(vp0.width*scale)*(vp0.height*scale);
  if(px>PDF_MAX_PIXELS) scale*=Math.sqrt(PDF_MAX_PIXELS/px);

  const vp=page.getViewport({scale});
  canvas.width=Math.round(vp.width);
  canvas.height=Math.round(vp.height);
  /* 表示サイズはCSSで指定する（高さは styles.css の height:auto が比率を保つ）。
     描画画素 ÷ 表示サイズ ＝ 実画素密度になる */
  canvas.style.width=cssW+'px';

  if(renderTask){ try{ renderTask.cancel(); }catch(e){} }
  renderTask=page.render({canvasContext:canvas.getContext('2d'), viewport:vp});
  try{
    await renderTask.promise;
  }catch(e){
    /* 取り消しは正常系（あとから始まった描画が続いている） */
    if(!e || e.name!=='RenderingCancelledException') console.error(e);
    return;
  }finally{
    renderTask=null;
  }

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
