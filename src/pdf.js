/*
  pdf.js — PDF譜面の表示（pdfjs はグローバル window.pdfjsLib）。
  元 cello-finger.html L3127–3153 より無改変で移植。
    pdfDoc/pdfPage/openPdf/renderPdfPage
  依存: dom(toast)。pdfjsLib は index.html でグローバル読み込み。
  ページ送りボタン（pdfprev/pdfnext）は配線側で pdfPage±1 → renderPdfPage。
*/
import { toast } from './dom.js';

export let pdfDoc=null, pdfPage=1;
export async function openPdf(file){
  if(window.__noPdf || !window.pdfjsLib){ toast('PDF表示ライブラリを読み込めませんでした。'); return; }
  try{
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf=await file.arrayBuffer();
    pdfDoc=await pdfjsLib.getDocument({data:buf}).promise;
    pdfPage=1;
    document.getElementById('pdfempty').style.display='none';
    renderPdfPage();
    toast(`PDF：${pdfDoc.numPages}ページ`);
  }catch(e){ toast('PDFを開けません：'+e.message); console.error(e); }
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
