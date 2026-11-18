/* Exact production bilingual renderer; public prepared translations only. */
window.BVCreateTranslationUI = function() {
 const displaySources=new WeakMap();
 const destroyed=false,epoch=0,translationsHidden=false;
 const confirmedEntry=()=>null,clearPending=()=>{},clearFailure=()=>{},persistRecord=()=>{};
 const checkNavigation=()=>true,sourceMatches=record=>record.element.textContent===record.text;
 /* production:paintTranslation:start */
        function paintTranslation(record, translatedText, { partial = false } = {}) {
            const confirmed = confirmedEntry(record);
            if (confirmed?.manuallyEdited && translatedText !== confirmed.translatedText) return;
            if (!partial) clearPending(record);
            clearFailure(record);
            if (!record.translation?.isConnected) {
                record.translation = document.createElement('div');
                record.translation.className = 'sci-bilingual-translation';
                record.translation.setAttribute('data-sci-plugin-ui', '');
                record.translation.setAttribute('data-sci-translation', '');
                record.translation.setAttribute('lang', 'zh');
                record.translation.setAttribute('dir', 'auto');
                record.translation.setAttribute('translate', 'no');
                record.translation.addEventListener('input', () => {
                    if (destroyed || record.epoch !== epoch || !checkNavigation() || !sourceMatches(record)) return;
                    const entry = confirmedEntry(record);
                    if (entry?.manuallyEdited) persistRecord(record, entry);
                });
                displaySources.set(record.translation, record.element);
            }
            record.partial = partial;
            if (partial) record.translation.setAttribute('data-sci-translation-partial', '');
            else record.translation.removeAttribute('data-sci-translation-partial');
            record.translation.textContent = translatedText;
            record.lastPaintedText = translatedText;
            record.translation.hidden = translationsHidden;
            record.anchor.after(record.translation);
        }
/* production:paintTranslation:end */
 return {paint:paintTranslation};
};
