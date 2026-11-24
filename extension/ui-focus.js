/* Text inputs match :focus-visible after a click too; track actual input modality. */
(() => {
  document.documentElement.dataset.brevessFocus='pointer';
  document.addEventListener('pointerdown',()=>{document.documentElement.dataset.brevessFocus='pointer';},true);
  document.addEventListener('keydown',event=>{if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))document.documentElement.dataset.brevessFocus='keyboard';},true);
})();
